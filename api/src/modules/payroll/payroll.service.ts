/**
 * Nómina de mecánicos (Fase 9): remuneración semanal por técnico.
 *
 * Reglas de negocio:
 * - La semana se maneja de lunes a sábado; el rango lo calcula el cliente en hora local
 *   y se envía como `from`/`to`. El servidor solo pone el rango por defecto (semana actual,
 *   en UTC) cuando no llega ninguno.
 * - Solo cuentan OTs en estado `DELIVERED` con `deliveredAt` dentro del rango y sin
 *   `cancelledAt`. El trabajo pagado es el entregado en la semana.
 * - La base de la comisión es la suma de las líneas LABOR **sin IVA** (`taxableBase`),
 *   la misma matemática que usa facturación/informes (`computeBillingTotals`), para que
 *   el valor cuadre con lo cobrado al cliente.
 * - La comisión es el **50%** de la mano de obra (`PAYROLL_RATE`), redondeada entera.
 * - Un perfil sin `payroll:read_all` (p. ej. mecánico) solo ve su propia nómina; el
 *   administrador/dueño ven la de todos los mecánicos activos.
 *
 * Rendimiento: una sola consulta de OTs (índice `[assignedToId, deliveredAt]`) más, solo
 * para perfiles amplios, una consulta de la lista de mecánicos. Cero N+1: los totales se
 * agrupan en memoria.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, WorkOrderLineType, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import {
  computeBillingTotals,
  type LineForTotals,
} from '../../common/billing/billing-totals';

/** Acceso a la sección Nómina; sin `read_all` el alcance es la propia nómina del actor. */
export const PAYROLL_READ = 'payroll:read' as const;

/** Ver la nómina de todos los mecánicos (administrador/dueño). */
export const PAYROLL_READ_ALL = 'payroll:read_all' as const;

/** Porcentaje de la mano de obra que recibe el mecánico (50%). */
const PAYROLL_RATE = new Prisma.Decimal('0.5');
const PAYROLL_RATE_STR = PAYROLL_RATE.toString();

/** Shape para cargar líneas LABOR desde Prisma y pasarlas a `computeBillingTotals`. */
const lineTotalsSelect = {
  id: true,
  lineType: true,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  costSnapshot: true,
  taxRateId: true,
  taxRatePercentSnapshot: true,
  taxRate: { select: { kind: true } },
} as const;

type LaborLineRow = {
  id: string;
  lineType: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal | null;
  costSnapshot: Prisma.Decimal | null;
  taxRateId: string | null;
  taxRatePercentSnapshot: Prisma.Decimal | null;
  taxRate: { kind: 'VAT' | 'INC' } | null;
};

function laborLinesToForTotals(rows: LaborLineRow[]): LineForTotals[] {
  return rows.map((r) => ({
    id: r.id,
    lineType: r.lineType as LineForTotals['lineType'],
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    discountAmount: r.discountAmount,
    costSnapshot: r.costSnapshot,
    taxRateId: r.taxRateId,
    taxRatePercentSnapshot: r.taxRatePercentSnapshot,
    taxRate: r.taxRate,
  }));
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resumen de nómina de la semana (lunes–sábado): por mecánico, la mano de obra
   * entregada (sin IVA) y el 50% a pagar, con desglose por OT.
   */
  async weeklySummary(
    actor: JwtUserPayload,
    query: { from?: Date; to?: Date },
  ): Promise<{
    week: { from: string; to: string };
    rate: string;
    isOwnOnly: boolean;
    mechanics: Array<{
      mechanicId: string;
      fullName: string;
      ordersCount: number;
      laborTotal: string;
      payable: string;
      orders: Array<{
        id: string;
        publicCode: string;
        description: string | null;
        plate: string | null;
        deliveredAt: string;
        laborTotal: string;
        payable: string;
      }>;
    }>;
  }> {
    const { from, to } = this.resolveWeekRange(query);

    const mayViewAll = actor.permissions.includes(PAYROLL_READ_ALL);

    const [orders, mechanics] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: {
          status: WorkOrderStatus.DELIVERED,
          cancelledAt: null,
          deliveredAt: { gte: from, lte: to, not: null },
          assignedToId: { not: null },
          ...(mayViewAll ? {} : { assignedToId: actor.sub }),
        },
        orderBy: [{ deliveredAt: 'asc' }, { publicCode: 'asc' }],
        select: {
          id: true,
          publicCode: true,
          description: true,
          deliveredAt: true,
          assignedTo: { select: { id: true, fullName: true } },
          vehicle: { select: { plate: true } },
          lines: {
            where: { lineType: WorkOrderLineType.LABOR },
            select: lineTotalsSelect,
          },
        },
      }),
      mayViewAll
        ? this.prisma.user.findMany({
            where: {
              isActive: true,
              AND: [
                { roles: { some: { role: { slug: 'mecanico' } } } },
                { NOT: { roles: { some: { role: { slug: { not: 'mecanico' } } } } } },
              ],
            },
            select: { id: true, fullName: true },
            orderBy: { fullName: 'asc' },
          })
        : Promise.resolve([{ id: actor.sub, fullName: actor.fullName }]),
    ]);

    type OrderEntry = {
      id: string;
      publicCode: string;
      description: string | null;
      plate: string | null;
      deliveredAt: string;
      laborTotal: string;
      payable: string;
    };
    type Bucket = {
      mechanicId: string;
      fullName: string;
      ordersCount: number;
      laborTotal: Prisma.Decimal;
      orders: OrderEntry[];
    };
    const byMechanic = new Map<string, Bucket>();

    for (const m of mechanics) {
      byMechanic.set(m.id, {
        mechanicId: m.id,
        fullName: m.fullName,
        ordersCount: 0,
        laborTotal: new Prisma.Decimal(0),
        orders: [],
      });
    }

    for (const wo of orders) {
      if (!wo.assignedTo || !wo.deliveredAt) continue;
      const key = wo.assignedTo.id;
      const bucket = byMechanic.get(key) ?? {
        mechanicId: key,
        fullName: wo.assignedTo.fullName,
        ordersCount: 0,
        laborTotal: new Prisma.Decimal(0),
        orders: [],
      };
      const laborTotal = computeBillingTotals(
        laborLinesToForTotals(wo.lines as unknown as LaborLineRow[]),
      ).taxableBase;
      const payable = this.commissionOf(laborTotal);
      bucket.ordersCount += 1;
      bucket.laborTotal = bucket.laborTotal.plus(laborTotal);
      bucket.orders.push({
        id: wo.id,
        publicCode: wo.publicCode,
        description: wo.description,
        plate: wo.vehicle?.plate ?? null,
        deliveredAt: wo.deliveredAt.toISOString(),
        laborTotal: laborTotal.toString(),
        payable: payable.toString(),
      });
      byMechanic.set(key, bucket);
    }

    const mechanicsRows = Array.from(byMechanic.values())
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((b) => ({
        mechanicId: b.mechanicId,
        fullName: b.fullName,
        ordersCount: b.ordersCount,
        laborTotal: b.laborTotal.toString(),
        payable: this.commissionOf(b.laborTotal).toString(),
        orders: b.orders,
      }));

    return {
      week: { from: from.toISOString(), to: to.toISOString() },
      rate: PAYROLL_RATE_STR,
      isOwnOnly: !mayViewAll,
      mechanics: mechanicsRows,
    };
  }

  /** Comisión 50% de la mano de obra, redondeada al peso más cercano. */
  private commissionOf(laborTotal: Prisma.Decimal): Prisma.Decimal {
    return laborTotal.mul(PAYROLL_RATE).toDecimalPlaces(0);
  }

  /** Rango de la semana: válido el que llega el cliente; fallback lun–sáb actual (UTC). */
  private resolveWeekRange(query: { from?: Date; to?: Date }): { from: Date; to: Date } {
    let from = query.from;
    let to = query.to;
    if (!from || !to) {
      const now = new Date();
      const day = now.getUTCDay();
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
      monday.setUTCHours(0, 0, 0, 0);
      const saturday = new Date(now);
      saturday.setUTCDate(now.getUTCDate() + (6 - day));
      saturday.setUTCHours(23, 59, 59, 999);
      from = from ?? monday;
      to = to ?? saturday;
    }
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
      throw new BadRequestException('Rango de fechas inválido.');
    }
    if (to.getTime() - from.getTime() > 31 * 24 * 3600 * 1000) {
      throw new BadRequestException('El rango máximo del resumen es de 31 días.');
    }
    return { from, to };
  }
}