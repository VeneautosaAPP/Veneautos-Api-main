/**
 * Órdenes de trabajo (Fase 3): unidad operativa del taller antes de cobros/inventario formales.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CashMovementDirection,
  CashSessionStatus,
  Prisma,
  WorkOrderLineType,
  WorkOrderPaymentKind,
  WorkOrderStatus,
} from '@prisma/client';
import { CASH_WORK_ORDER_REFERENCE_TYPE } from '../cash/cash.constants';
import { ceilWholeCop } from '../../common/money/cop-money';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { WORK_ORDER_ALLOWED_TRANSITIONS } from './work-orders.constants';
import type { CreateWorkOrderDto } from './dto/create-work-order.dto';
import type { ListWorkOrdersQueryDto } from './dto/list-work-orders.query.dto';
import type { ReopenDeliveredWorkOrderDto } from './dto/reopen-delivered-work-order.dto';
import type { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { comparableVehiclePlate } from '../vehicles/vehicle-plate.util';
import { canonicalPublicCodeFromLookupInput, formatWorkOrderPublicCode } from './work-order-public-code';
import { actorMayViewWorkOrderCosts, actorMayViewWorkOrderFinancials } from './work-orders.visibility';
import {
  computeWorkOrderTotals,
  computeWorkshopProfit,
  serializeLineTotals,
  serializeWorkOrderTotals,
  computeLineTotals,
  type LineForTotals,
} from './work-order-totals';

const LIST_PAGE_SIZE_DEFAULT = 50;
const LIST_PAGE_SIZE_MAX = 100;

/**
 * Categoría del egreso que reversa un cobro cuando se reabre una orden entregada.
 * El movimiento original de ingreso NO se borra (caja es append-only y la sesión puede
 * estar cerrada): se genera el contra-asiento en la sesión abierta.
 */
const REVERSAL_CATEGORY_SLUG = 'reverso_cobro_ot';
const REVERSAL_CATEGORY_NAME = 'Reverso de cobro · OT reabierta';

/**
 * Resumen (panel) de OTs en un estado: cantidad, valor total a cobrar y **saldo pendiente**
 * (lo que aún nos deben = total − cobrado). `null` en los importes si el perfil no ve
 * información financiera.
 */
export type WorkOrdersValueSummary = {
  count: number;
  totalValue: string | null;
  balancePending: string | null;
};

const PUBLIC_WO_LOOKUP_NOT_FOUND =
  'No encontramos una orden con ese código y placa. Verificá los datos o consultá en recepción.';

/** Ver listados y detalle de OT ajenas (cajeros, recepción); sin esto solo se ven las creadas por el usuario. */
export const WORK_ORDERS_READ_ALL = 'work_orders:read_all' as const;

/** Reapertura de OT entregada (típ. administrador/dueño): nota + justificación obligatorias. */
export const WORK_ORDERS_REOPEN_DELIVERED = 'work_orders:reopen_delivered' as const;

const userBrief = { select: { id: true, email: true, fullName: true, isActive: true } };

const vehicleWithCustomer = {
  include: {
    customer: { select: { id: true, displayName: true, primaryPhone: true, documentId: true, email: true } },
  },
};

const workOrderLineInclude = {
  taxRate: { select: { id: true, slug: true, name: true, kind: true, ratePercent: true } },
} as const;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notes: NotesPolicyService,
  ) {}

  async create(
    actor: JwtUserPayload,
    dto: CreateWorkOrderDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const actorUserId = actor.sub;
    const parentId = dto.parentWorkOrderId?.trim();

    let vehicleIdToConnect: string | undefined = dto.vehicleId?.trim();

    if (parentId) {
      await this.assertWorkOrderVisible(actor, parentId);
      const parent = await this.prisma.workOrder.findUnique({
        where: { id: parentId },
        select: {
          id: true,
          status: true,
          vehicleId: true,
          parentWorkOrderId: true,
        },
      });
      if (!parent) {
        throw new NotFoundException('Orden origen no encontrada');
      }
      if (parent.status !== WorkOrderStatus.DELIVERED) {
        throw new BadRequestException(
          'Solo se puede crear una orden de garantía vinculada a una OT origen en estado Entregada.',
        );
      }
      if (parent.parentWorkOrderId) {
        throw new BadRequestException(
          'No se puede encadenar: la orden origen ya es una garantía. Usá la OT principal como origen.',
        );
      }
      if (parent.vehicleId) {
        vehicleIdToConnect = parent.vehicleId;
      }
    }

    if (!vehicleIdToConnect?.trim()) {
      throw new BadRequestException(
        'La orden debe vincularse a un vehículo registrado.',
      );
    }

    /** La OT nace sin técnico asignado; la asignación se hace después con PATCH. `publicCode` se setea en la transacción. */
    const data: Omit<Prisma.WorkOrderCreateInput, 'publicCode'> = {
      description: dto.description.trim(),
      customerName: dto.customerName?.trim() ?? null,
      customerPhone: dto.customerPhone?.trim() ?? null,
      customerEmail: dto.customerEmail?.trim() || null,
      vehiclePlate: dto.vehiclePlate?.trim() ?? null,
      vehicleModel: dto.vehicleModel?.trim() || null,
      vehicleLine: dto.vehicleLine?.trim() || null,
      vehicleCylinderCc: dto.vehicleCylinderCc?.trim() || null,
      vehicleColor: dto.vehicleColor?.trim() || null,
      vehicleNotes: dto.vehicleNotes?.trim() ?? null,
      internalNotes: dto.internalNotes?.trim() ?? null,
      status: WorkOrderStatus.UNASSIGNED,
      createdBy: { connect: { id: actorUserId } },
      ...(parentId ? { parentWorkOrder: { connect: { id: parentId } } } : {}),
    };

    if (dto.intakeOdometerKm !== undefined) {
      data.intakeOdometerKm = dto.intakeOdometerKm === null ? null : dto.intakeOdometerKm;
    }

    if (vehicleIdToConnect) {
      const v = await this.prisma.vehicle.findUnique({
        where: { id: vehicleIdToConnect },
        include: { customer: true },
      });
      if (!v || !v.isActive) {
        throw new NotFoundException('Vehículo no encontrado o inactivo');
      }
      data.vehicle = { connect: { id: v.id } };
      data.customerName = dto.customerName?.trim() ?? v.customer.displayName;
      data.customerPhone = dto.customerPhone?.trim() ?? v.customer.primaryPhone ?? null;
      data.customerEmail =
        dto.customerEmail !== undefined
          ? dto.customerEmail?.trim() || null
          : v.customer.email?.trim() ?? null;
      data.vehiclePlate = dto.vehiclePlate?.trim() ?? v.plate;
      data.vehicleBrand =
        dto.vehicleBrand !== undefined ? dto.vehicleBrand.trim() || null : v.brand?.trim() ?? null;
      data.vehicleModel =
        dto.vehicleModel !== undefined ? dto.vehicleModel?.trim() || null : v.model?.trim() ?? null;
      if (dto.vehicleLine !== undefined) {
        data.vehicleLine = dto.vehicleLine.trim() || null;
      }
      if (dto.vehicleCylinderCc !== undefined) {
        data.vehicleCylinderCc = dto.vehicleCylinderCc.trim() || null;
      }
      if (dto.vehicleColor !== undefined) {
        data.vehicleColor = dto.vehicleColor.trim() || null;
      } else {
        data.vehicleColor = v.color?.trim() ?? null;
      }
      if (dto.vehicleNotes?.trim()) {
        data.vehicleNotes = dto.vehicleNotes.trim();
      } else if (v.notes) {
        data.vehicleNotes = v.notes;
      }
    } else if (dto.vehicleBrand !== undefined) {
      data.vehicleBrand = dto.vehicleBrand.trim() || null;
    }

    const includeAfterCreate = {
      createdBy: userBrief,
      assignedTo: userBrief,
      vehicle: vehicleWithCustomer,
    } as const;

    /** Valor único temporal: `public_code` es NOT NULL y se reemplaza en el mismo commit por `VEN-…`. */
    const pendingPublicCode = `T${randomBytes(10).toString('hex')}`;

    let seededLaborLineId: string | null = null;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: { ...data, publicCode: pendingPublicCode },
        include: includeAfterCreate,
      });
      // Línea inicial de mano de obra: se edita directo en la tabla (descripción, precio, impuesto).
      const laborLine = await tx.workOrderLine.create({
        data: {
          workOrderId: created.id,
          lineType: WorkOrderLineType.LABOR,
          description: 'MANO DE OBRA',
          quantity: new Prisma.Decimal(1),
          sortOrder: 0,
        },
      });
      seededLaborLineId = laborLine.id;
      const publicCode = formatWorkOrderPublicCode(created.orderNumber);
      return tx.workOrder.update({
        where: { id: created.id },
        data: { publicCode },
        include: includeAfterCreate,
      });
    });

    await this.audit.recordDomain({
      actorUserId,
      action: 'work_orders.created',
      entityType: 'WorkOrder',
      entityId: row.id,
      previousPayload: null,
      nextPayload: {
        orderNumber: row.orderNumber,
        publicCode: row.publicCode,
        status: row.status,
        description: row.description,
        vehicleId: row.vehicleId,
        parentWorkOrderId: row.parentWorkOrderId ?? null,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    if (seededLaborLineId) {
      await this.audit.recordDomain({
        actorUserId,
        action: 'work_order_lines.created',
        entityType: 'WorkOrderLine',
        entityId: seededLaborLineId,
        previousPayload: null,
        nextPayload: {
          workOrderId: row.id,
          lineType: WorkOrderLineType.LABOR,
          description: 'MANO DE OBRA',
          quantity: '1',
        },
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }

    return this.stripWorkOrderSnapshotFinancials(actor, row);
  }

  /**
   * Restricción de visibilidad:
   * - `read_all`: ve todas las OT.
   * - `read` sin `read_all`: ve OT que creó, las asignadas a él y la cola (sin técnico, estado sin asignar).
   * - `read_portal`: solo OT con vehículo del cliente enlazado al usuario (`portalCustomerId` en JWT).
   * - sin lo anterior: por defecto solo creadas por el actor.
   */
  workOrderVisibilityWhere(actor: JwtUserPayload): Prisma.WorkOrderWhereInput {
    if (actor.permissions.includes(WORK_ORDERS_READ_ALL)) {
      return {};
    }
    if (actor.permissions.includes('work_orders:read')) {
      return {
        OR: [
          { createdById: actor.sub },
          { assignedToId: actor.sub },
          {
            assignedToId: null,
            status: WorkOrderStatus.UNASSIGNED,
          },
        ],
      };
    }
    if (actor.permissions.includes('work_orders:read_portal')) {
      if (actor.portalCustomerId) {
        return {
          vehicle: { is: { customerId: actor.portalCustomerId } },
        };
      }
      return { id: { in: [] } };
    }
    return { createdById: actor.sub };
  }

  /**
   * Comprueba que la OT exista y el actor pueda verla según {@link workOrderVisibilityWhere}.
   * Usa 404 si no aplica (no filtrar existencia de IDs ajenos).
   */
  async assertWorkOrderVisible(actor: JwtUserPayload, workOrderId: string): Promise<void> {
    const row = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...this.workOrderVisibilityWhere(actor) },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException('Orden de trabajo no encontrada');
    }
  }

  /**
   * Consulta pública sin JWT: código de comprobante + placa del vehículo.
   * No expone importes, líneas ni identificadores internos.
   */
  async lookupPublicByCodeAndPlate(dto: { publicCode: string; plate: string }) {
    const publicCode = canonicalPublicCodeFromLookupInput(dto.publicCode);
    const inputComparable = comparableVehiclePlate(dto.plate);

    const row = await this.prisma.workOrder.findUnique({
      where: { publicCode },
      select: {
        status: true,
        publicCode: true,
        orderNumber: true,
        description: true,
        createdAt: true,
        deliveredAt: true,
        cancelledAt: true,
        customerName: true,
        vehiclePlate: true,
        vehicleBrand: true,
        vehicleModel: true,
        vehicleId: true,
        vehicle: { select: { plateNorm: true, plate: true, brand: true, isActive: true } },
      },
    });

    if (!row) {
      throw new NotFoundException(PUBLIC_WO_LOOKUP_NOT_FOUND);
    }

    /** Placas “válidas” para esta OT: snapshot en la orden + maestro (activo o no). Evita falsos negativos si hubo correcciones en el vehículo o datos desalineados. */
    const plateCandidates = new Set<string>();
    const pushComparable = (raw: string | null | undefined) => {
      const t = raw?.trim();
      if (!t) return;
      try {
        plateCandidates.add(comparableVehiclePlate(t));
      } catch {
        /* valor ilegible en BD: se omite */
      }
    };
    pushComparable(row.vehiclePlate);
    if (row.vehicle) {
      pushComparable(row.vehicle.plateNorm);
      pushComparable(row.vehicle.plate);
    }

    const plateMatches =
      plateCandidates.size > 0 && [...plateCandidates].some((c) => c === inputComparable);

    if (!plateMatches) {
      throw new NotFoundException(PUBLIC_WO_LOOKUP_NOT_FOUND);
    }

    const vehiclePlate = row.vehiclePlate ?? row.vehicle?.plate ?? null;

    return {
      publicCode: row.publicCode,
      status: row.status,
      orderNumber: row.orderNumber,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      customerName: row.customerName,
      vehiclePlate,
      vehicleBrand: row.vehicleBrand,
      vehicleModel: row.vehicleModel,
    };
  }

  /**
   * Rango por fecha de entrega (`deliveredAt`, inclusivo en ambos extremos). Sin parámetros
   * no filtra: el listado operativo sigue mostrando todo. Es el mismo campo que usan las
   * tarjetas «Entregadas» del panel, así que los conteos coinciden al navegar desde ellas.
   */
  private deliveredAtRangeClause(
    from: Date | undefined,
    to: Date | undefined,
  ): Prisma.WorkOrderWhereInput | null {
    const validFrom = from instanceof Date && !Number.isNaN(from.getTime()) ? from : null;
    const validTo = to instanceof Date && !Number.isNaN(to.getTime()) ? to : null;
    if (!validFrom && !validTo) return null;
    if (validFrom && validTo && validFrom.getTime() > validTo.getTime()) {
      throw new BadRequestException('El rango de fechas de entrega es inválido.');
    }
    return {
      deliveredAt: {
        ...(validFrom ? { gte: validFrom } : {}),
        ...(validTo ? { lte: validTo } : {}),
      },
    };
  }

  async list(actor: JwtUserPayload, query: ListWorkOrdersQueryDto) {
    const visibility = this.workOrderVisibilityWhere(actor);
    const clauses: Prisma.WorkOrderWhereInput[] = [];
    if (Object.keys(visibility).length > 0) {
      clauses.push(visibility);
    }
    if (query.status) {
      clauses.push({ status: query.status });
    }
    if (query.vehicleId) {
      clauses.push({ vehicleId: query.vehicleId });
    }
    if (query.customerId) {
      clauses.push({ vehicle: { is: { customerId: query.customerId } } });
    }
    const term = query.search?.trim();
    if (term) {
      clauses.push({
        OR: [
          { publicCode: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { customerPhone: { contains: term, mode: 'insensitive' } },
          { vehiclePlate: { contains: term, mode: 'insensitive' } },
          { vehicleBrand: { contains: term, mode: 'insensitive' } },
          { vehicleModel: { contains: term, mode: 'insensitive' } },
          { invoices: { some: { documentNumber: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }
    const deliveredRange = this.deliveredAtRangeClause(query.from, query.to);
    if (deliveredRange) {
      clauses.push(deliveredRange);
    }
    const where: Prisma.WorkOrderWhereInput = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0]! : { AND: clauses };
    const page = query.page && query.page > 0 ? query.page : 1;
    const rawSize = query.pageSize && query.pageSize > 0 ? query.pageSize : LIST_PAGE_SIZE_DEFAULT;
    const pageSize = Math.min(LIST_PAGE_SIZE_MAX, rawSize);
    const skip = (page - 1) * pageSize;

    const include = {
      createdBy: userBrief,
      assignedTo: userBrief,
      vehicle: vehicleWithCustomer,
      parentWorkOrder: { select: { id: true, orderNumber: true, publicCode: true, status: true } },
    } as const;

    const [items, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include,
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return {
      total,
      items: items.map((it) => ({ ...it, authorizedAmount: null })),
    };
  }

  /**
   * Resumen (panel) de entregas: OTs en estado Entregada con `deliveredAt` dentro del rango
   * (semana Lun–Sáb en el cliente) y, para perfiles con visibilidad financiera, el total pagado.
   * Respeta la misma visibilidad de listado (`workOrderVisibilityWhere`).
   */
  async weeklyDeliveredSummary(
    actor: JwtUserPayload,
    query: { from?: Date; to?: Date },
  ): Promise<{
    week: { from: string; to: string };
    count: number;
    paymentsTotal: string | null;
  }> {
    const now = new Date();
    const from = query.from ? new Date(query.from.getTime()) : new Date(now.getTime() - 6 * 24 * 3600 * 1000);
    const to = query.to ? new Date(query.to.getTime()) : now;
    const { fromIso, toIso, count, paymentsTotal } = await this.deliveredSummaryInRange(actor, from, to);
    return { week: { from: fromIso, to: toIso }, count, paymentsTotal };
  }

  /**
   * Resumen (panel) de entregas del mes corriente (1° al último día, calculado en el cliente)
   * y, para perfiles con visibilidad financiera, el total pagado. Misma visibilidad de listado.
   */
  async monthlyDeliveredSummary(
    actor: JwtUserPayload,
    query: { from?: Date; to?: Date },
  ): Promise<{
    month: { from: string; to: string };
    count: number;
    paymentsTotal: string | null;
  }> {
    const now = new Date();
    const from = query.from ? new Date(query.from.getTime()) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to.getTime()) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const { fromIso, toIso, count, paymentsTotal } = await this.deliveredSummaryInRange(actor, from, to);
    return { month: { from: fromIso, to: toIso }, count, paymentsTotal };
  }

  /** Entregas en un rango: cantidad + total pagado (null si el perfil no ve importes). El rango máximo es de 31 días. */
  private async deliveredSummaryInRange(
    actor: JwtUserPayload,
    from: Date,
    to: Date,
  ): Promise<{ fromIso: string; toIso: string; count: number; paymentsTotal: string | null }> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
      throw new BadRequestException('Rango de fechas inválido.');
    }
    if (to.getTime() - from.getTime() > 31 * 24 * 3600 * 1000) {
      throw new BadRequestException('El rango máximo del resumen es de 31 días.');
    }

    const scope: Prisma.WorkOrderWhereInput = {
      ...this.workOrderVisibilityWhere(actor),
      status: WorkOrderStatus.DELIVERED,
      cancelledAt: null,
      deliveredAt: { gte: from, lte: to },
    };

    const [count, paid] = await Promise.all([
      this.prisma.workOrder.count({ where: scope }),
      this.prisma.workOrderPayment.aggregate({
        where: { workOrder: scope },
        _sum: { amount: true },
      }),
    ]);

    const mayViewFinancials = actorMayViewWorkOrderFinancials(actor);
    return {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      count,
      paymentsTotal: mayViewFinancials ? (paid._sum.amount ?? new Prisma.Decimal(0)).toString() : null,
    };
  }

  /**
   * Resumen (panel) de órdenes en un estado operativo (READY/IN_WORKSHOP): cantidad, suma
   * del total a cobrar (grandTotal, líneas + descuentos + IVA/INC) y **saldo pendiente**
   * (total − cobrado) para perfiles con visibilidad financiera. Respeta la misma
   * visibilidad de listado (`workOrderVisibilityWhere`).
   */
  private async ordersValueSummary(
    actor: JwtUserPayload,
    status: WorkOrderStatus,
  ): Promise<WorkOrdersValueSummary> {
    const scope: Prisma.WorkOrderWhereInput = {
      ...this.workOrderVisibilityWhere(actor),
      status,
      cancelledAt: null,
    };

    const [count, rows] = await Promise.all([
      this.prisma.workOrder.count({ where: scope }),
      this.prisma.workOrder.findMany({
        where: scope,
        select: {
          id: true,
          lines: {
            select: {
              id: true,
              lineType: true,
              quantity: true,
              unitPrice: true,
              discountAmount: true,
              costSnapshot: true,
              taxRateId: true,
              taxRatePercentSnapshot: true,
              taxRate: { select: { kind: true } },
            },
          },
        },
      }),
    ]);

    const mayViewFinancials = actorMayViewWorkOrderFinancials(actor);
    if (!mayViewFinancials) {
      return { count, totalValue: null, balancePending: null };
    }

    // Cobrado por OT: se descuenta orden por orden para que las ya saldadas (o con
    // sobrepago) no "presten" saldo a las demás.
    const paidByOrder = new Map<string, Prisma.Decimal>();
    if (rows.length > 0) {
      const paid = await this.prisma.workOrderPayment.groupBy({
        by: ['workOrderId'],
        where: { workOrder: scope },
        _sum: { amount: true },
      });
      for (const agg of paid) {
        paidByOrder.set(agg.workOrderId, agg._sum.amount ?? new Prisma.Decimal(0));
      }
    }

    let total = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const row of rows) {
      const linesForTotals: LineForTotals[] = row.lines.map((ln) => ({
        id: ln.id,
        lineType: ln.lineType,
        quantity: ln.quantity,
        unitPrice: ln.unitPrice,
        discountAmount: ln.discountAmount,
        costSnapshot: ln.costSnapshot,
        taxRateId: ln.taxRateId,
        taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
        taxRate: ln.taxRate ? { kind: ln.taxRate.kind } : null,
      }));
      const due = ceilWholeCop(computeWorkOrderTotals(linesForTotals).grandTotal);
      total = total.plus(due);
      const rowPending = due.minus(paidByOrder.get(row.id) ?? new Prisma.Decimal(0));
      pending = pending.plus(rowPending.lt(0) ? new Prisma.Decimal(0) : ceilWholeCop(rowPending));
    }

    return { count, totalValue: total.toString(), balancePending: pending.toString() };
  }

  /** Resumen (panel) de órdenes «Lista» (READY). */
  readyOrdersSummary(actor: JwtUserPayload): Promise<WorkOrdersValueSummary> {
    return this.ordersValueSummary(actor, WorkOrderStatus.READY);
  }

  /** Resumen (panel) de órdenes «En taller» (IN_WORKSHOP). */
  inWorkshopSummary(actor: JwtUserPayload): Promise<WorkOrdersValueSummary> {
    return this.ordersValueSummary(actor, WorkOrderStatus.IN_WORKSHOP);
  }

  /**
   * Usuarios activos para selector de reasignación (recepción / jefe de taller).
   * Solo perfiles cuyo ÚNICO rol es «Mecánico»: el técnico asignado a una OT
   * siempre es un mecánico, no administradores, cajeros, dueño ni clientes.
   */
  async listAssignableUsers() {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        AND: [
          { roles: { some: { role: { slug: 'mecanico' } } } },
          { NOT: { roles: { some: { role: { slug: { not: 'mecanico' } } } } } },
        ],
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(id: string, actor: JwtUserPayload) {
    const row = await this.prisma.workOrder.findFirst({
      where: { id, ...this.workOrderVisibilityWhere(actor) },
      include: {
        createdBy: userBrief,
        assignedTo: userBrief,
        vehicle: vehicleWithCustomer,
        parentWorkOrder: { select: { id: true, orderNumber: true, publicCode: true, status: true } },
        warrantyFollowUps: {
          select: { id: true, orderNumber: true, publicCode: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
        lines: { orderBy: { sortOrder: 'asc' }, include: workOrderLineInclude },
        _count: { select: { payments: true, warrantyFollowUps: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Orden de trabajo no encontrada');
    }

    const paid = await this.prisma.workOrderPayment.aggregate({
      where: { workOrderId: id },
      _sum: { amount: true },
    });
    const totalPaid = paid._sum.amount ?? new Prisma.Decimal(0);

    const lineRows = row.lines ?? [];
    const linesForTotals: LineForTotals[] = lineRows.map((ln) => ({
      id: ln.id,
      lineType: ln.lineType,
      quantity: ln.quantity,
      unitPrice: ln.unitPrice,
      discountAmount: ln.discountAmount,
      costSnapshot: ln.costSnapshot,
      taxRateId: ln.taxRateId,
      taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
      taxRate: ln.taxRate ? { kind: ln.taxRate.kind } : null,
    }));
    const totals = computeWorkOrderTotals(linesForTotals);
    const linesSubtotalCeiled = ceilWholeCop(totals.linesSubtotal);

    const dueBase = ceilWholeCop(totals.grandTotal);
    const amountDueDec = dueBase.minus(totalPaid);
    const amountDue = amountDueDec.lt(0) ? '0' : ceilWholeCop(amountDueDec).toString();
    const remaining = amountDue;

    const linesWithTotals = lineRows.map((ln, idx) => ({
      ...ln,
      totals: serializeLineTotals(computeLineTotals(linesForTotals[idx])),
    }));
    const { _count, ...rest } = row;
    const mayViewFinancials = actorMayViewWorkOrderFinancials(actor);
    const mayViewCosts = actorMayViewWorkOrderCosts(actor);
    // Precio proveedor (`costSnapshot`): solo `reports:read`; importes: solo perfiles financieros.
    const linesForActor = linesWithTotals.map((ln) => ({
      ...ln,
      ...(mayViewFinancials ? {} : { unitPrice: null, totals: null }),
      ...(mayViewCosts ? {} : { costSnapshot: null }),
    }));
    const totalsSerialized = serializeWorkOrderTotals(totals);
    // Costo / utilidad son sensibles; solo para `reports:read` (administración / dueño).
    const workshopProfit = mayViewCosts
      ? computeWorkshopProfit(linesForTotals, row.laborCommissionPct)
      : null;
    const totalsForActor = mayViewCosts
      ? { ...totalsSerialized, workshopProfit: workshopProfit ? workshopProfit.toString() : null }
      : { ...totalsSerialized, totalCost: null, totalProfit: null, workshopProfit: null };

    const detail = {
      ...rest,
      authorizedAmount: null,
      lines: linesForActor,
      linesSubtotal: linesSubtotalCeiled.toString(),
      amountDue,
      totals: totalsForActor,
      paymentSummary: {
        paymentCount: _count.payments,
        totalPaid: totalPaid.toString(),
        remaining,
      },
      warrantyFollowUpCount: _count.warrantyFollowUps,
    };
    if (mayViewFinancials) {
      return detail;
    }
    // Perfil sin visibilidad financiera (p.ej. técnico): ocultamos importes pero dejamos la estructura.
    return {
      ...detail,
      authorizedAmount: null,
      lines: linesForActor,
      linesSubtotal: null,
      amountDue: null,
      totals: null,
      paymentSummary: {
        paymentCount: _count.payments,
        totalPaid: null,
        remaining: null,
      },
    };
  }

  /**
   * Vuelve una OT de «Entregada» a «Lista» para permitir correcciones de importes/líneas.
   * Solo quien tenga `work_orders:reopen_delivered` (semilla: administrador/dueño).
   */
  /**
   * Reversa TODOS los cobros de una orden **dentro de una transacción**: por cada cobro
   * genera un egreso espejo en la sesión de caja abierta y borra el cobro (la orden vuelve
   * a deber). El ingreso original NO se borra: caja es append-only y su sesión puede estar
   * cerrada, así que queda el histórico + el contra-asiento en la sesión vigente.
   *
   * Si hay cobros y no hay sesión abierta, lanza Conflict: el dinero no puede “salir” de
   * una caja cerrada sin dejar el arqueo inconsistente.
   */
  private async reverseWorkOrderPayments(
    tx: Prisma.TransactionClient,
    args: {
      workOrderId: string
      orderNumber: number
      publicCode: string | null
      actor: JwtUserPayload
      reason: 'reapertura' | 'cancelación'
    },
  ): Promise<{
    reversed: Array<{
      paymentId: string
      kind: WorkOrderPaymentKind
      amount: string
      reversalMovementId: string
    }>
    total: Prisma.Decimal
  }> {
    const payments = await tx.workOrderPayment.findMany({
      where: { workOrderId: args.workOrderId },
    })
    if (payments.length === 0) {
      return { reversed: [], total: new Prisma.Decimal(0) }
    }

    // Lock de la sesión OPEN: serializa contra un cierre de caja concurrente.
    await tx.$queryRaw`SELECT 1 FROM "cash_sessions" WHERE status::text = ${CashSessionStatus.OPEN} ORDER BY "created_at" ASC LIMIT 1 FOR UPDATE`;
    const session = await tx.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      select: { id: true },
    })
    if (!session) {
      const paid = payments.reduce((acc, p) => acc.plus(p.amount), new Prisma.Decimal(0));
      throw new ConflictException(
        `No hay sesión de caja abierta: hay $${paid.toString()} cobrados en la orden que deben revertirse. Abrí la caja y volvé a intentar.`,
      );
    }

    const category = await tx.cashMovementCategory.upsert({
      where: { slug: REVERSAL_CATEGORY_SLUG },
      update: {},
      create: {
        slug: REVERSAL_CATEGORY_SLUG,
        name: REVERSAL_CATEGORY_NAME,
        direction: CashMovementDirection.EXPENSE,
        sortOrder: 50,
      },
    });

    const reversed: Array<{
      paymentId: string
      kind: WorkOrderPaymentKind
      amount: string
      reversalMovementId: string
    }> = [];
    let total = new Prisma.Decimal(0);

    for (const payment of payments) {
      const movement = await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          categoryId: category.id,
          direction: CashMovementDirection.EXPENSE,
          amount: payment.amount,
          referenceType: CASH_WORK_ORDER_REFERENCE_TYPE,
          referenceId: args.workOrderId,
          note: `Reverso automático por ${args.reason} de la OT #${args.orderNumber}${args.publicCode ? ` (${args.publicCode})` : ''}: se devuelve el cobro registrado (${payment.kind === WorkOrderPaymentKind.FULL_SETTLEMENT ? 'liquidación total' : 'abono'}).`,
          createdById: args.actor.sub,
        },
        select: { id: true },
      });
      await tx.workOrderPayment.delete({ where: { id: payment.id } });
      reversed.push({
        paymentId: payment.id,
        kind: payment.kind,
        amount: payment.amount.toString(),
        reversalMovementId: movement.id,
      });
      total = total.plus(payment.amount);
    }

    return { reversed, total };
  }

  async reopenDelivered(
    id: string,
    actor: JwtUserPayload,
    dto: ReopenDeliveredWorkOrderDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    if (!actor.permissions.includes(WORK_ORDERS_REOPEN_DELIVERED)) {
      throw new ForbiddenException(
        'No tenés permiso para reabrir una orden entregada. Solo administración o dueño.',
      );
    }
    await this.assertWorkOrderVisible(actor, id);

    const note = await this.notes.requireOperationalNote('Nota de reapertura', dto.note, 'general');
    const justification = await this.notes.requireOperationalNote(
      'Justificación de reapertura',
      dto.justification,
      'general',
    );

    const before = await this.prisma.workOrder.findFirst({
      where: { id, ...this.workOrderVisibilityWhere(actor) },
    });
    if (!before) {
      throw new NotFoundException('Orden de trabajo no encontrada');
    }
    if (before.status !== WorkOrderStatus.DELIVERED) {
      throw new ConflictException('Solo se puede reabrir una orden en estado Entregada.');
    }

    /**
     * Reapertura + reverso de cobros en la MISMA transacción: o la orden vuelve a Lista y
     * la caja queda compensada, o no pasa nada. Si la orden tiene cobros y no hay sesión
     * abierta, se bloquea: el operario tiene que abrir caja para poder devolver el dinero.
     */
    const { row, reversedPayments, reversedTotal } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "work_orders" WHERE id = ${id} FOR UPDATE`);

        const current = await tx.workOrder.findFirst({
          where: { id, ...this.workOrderVisibilityWhere(actor) },
          select: { id: true, status: true, orderNumber: true, publicCode: true, internalNotes: true },
        });
        if (!current) {
          throw new NotFoundException('Orden de trabajo no encontrada');
        }
        if (current.status !== WorkOrderStatus.DELIVERED) {
          throw new ConflictException('Solo se puede reabrir una orden en estado Entregada.');
        }

        const { reversed, total } = await this.reverseWorkOrderPayments(tx, {
          workOrderId: current.id,
          orderNumber: current.orderNumber,
          publicCode: current.publicCode ?? null,
          actor,
          reason: 'reapertura',
        });

        const stamp =
          `\n\n--- Reapertura OT #${current.orderNumber} (${new Date().toISOString()}) ---\n` +
          `Usuario: ${actor.fullName} (${actor.email})\n` +
          `Justificación:\n${justification}\n\n` +
          `Nota:\n${note}\n` +
          (reversed.length > 0
            ? `\nCobros revertidos en caja: $${total.toString()} (${reversed.length} movimiento(s) de egreso generados; el ingreso original queda en su sesión como histórico).\n`
            : '');
        const internalNotes = `${current.internalNotes?.trim() ?? ''}${stamp}`.trim();

        const updated = await tx.workOrder.update({
          where: { id },
          data: {
            status: WorkOrderStatus.READY,
            deliveredAt: null,
            internalNotes,
          },
          include: {
            createdBy: userBrief,
            assignedTo: userBrief,
            vehicle: vehicleWithCustomer,
          },
        });

        return { row: updated, reversedPayments: reversed, reversedTotal: total.toString() };
      },
      { maxWait: 5000, timeout: 15_000 },
    );

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_orders.reopened_from_delivered',
      entityType: 'WorkOrder',
      entityId: id,
      previousPayload: { status: before.status, orderNumber: before.orderNumber },
      nextPayload: {
        status: row.status,
        orderNumber: row.orderNumber,
        note,
        justification,
        reversedPayments,
        reversedTotal: Number(reversedTotal) > 0 ? reversedTotal : null,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return row;
  }

  async update(
    id: string,
    actor: JwtUserPayload,
    dto: UpdateWorkOrderDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const keys = Object.keys(dto).filter((k) => dto[k as keyof UpdateWorkOrderDto] !== undefined);
    if (keys.length === 0) {
      throw new BadRequestException('No hay campos para actualizar');
    }

    const before = await this.prisma.workOrder.findFirst({
      where: { id, ...this.workOrderVisibilityWhere(actor) },
    });
    if (!before) {
      throw new NotFoundException('Orden de trabajo no encontrada');
    }

    if (
      before.status === WorkOrderStatus.DELIVERED ||
      before.status === WorkOrderStatus.CANCELLED
    ) {
      throw new ConflictException('La orden está cerrada; no admite cambios');
    }

    if (
      dto.status === WorkOrderStatus.UNASSIGNED &&
      dto.assignedToId !== undefined &&
      dto.assignedToId !== null
    ) {
      throw new BadRequestException(
        'El estado «Sin asignar» no admite técnico asignado en el mismo guardado.',
      );
    }

    this.assertAssignmentChangeAllowed(actor, before, dto);

    if (dto.assignedToId !== undefined && dto.assignedToId !== null) {
      await this.assertAssignableUser(dto.assignedToId);
    }

    if (dto.status !== undefined && dto.status !== before.status) {
      if (
        (dto.status === WorkOrderStatus.DELIVERED ||
          dto.status === WorkOrderStatus.CANCELLED) &&
        !actor.permissions.includes('work_orders:set_terminal_status')
      ) {
        throw new ForbiddenException(
          'No tenés permiso para marcar la orden como entregada o cancelada.',
        );
      }
      if (!this.canTransition(before.status, dto.status)) {
        throw new BadRequestException(
          `Transición de estado no permitida: ${before.status} → ${dto.status}`,
        );
      }
    }

    if (
      dto.status === WorkOrderStatus.RECEIVED &&
      before.status === WorkOrderStatus.UNASSIGNED &&
      before.assignedToId === null &&
      dto.assignedToId === undefined
    ) {
      throw new BadRequestException(
        'Asigná la orden a un técnico antes de pasarla a «Recibida» (o tomala con el botón de asignación).',
      );
    }

    const consentFieldsSent =
      dto.clientSignaturePngBase64 !== undefined || dto.clientConsentTextSnapshot !== undefined;
    let consentPngBase64: string | null = null;
    let consentTextSnapshot: string | null = null;
    if (consentFieldsSent) {
      if (
        dto.clientSignaturePngBase64 === undefined ||
        dto.clientConsentTextSnapshot === undefined
      ) {
        throw new BadRequestException(
          'La firma del cliente requiere enviar juntos `clientConsentTextSnapshot` y `clientSignaturePngBase64`.',
        );
      }
      if (before.clientConsentSignedAt) {
        throw new ConflictException('Esta orden ya tiene registrada la firma de consentimiento del cliente.');
      }
      consentPngBase64 = this.normalizeClientSignaturePngBase64(dto.clientSignaturePngBase64);
      this.assertClientSignaturePngPayloadOk(consentPngBase64);
      consentTextSnapshot = dto.clientConsentTextSnapshot.trim();
    }

    const data: Prisma.WorkOrderUpdateInput = {};
    if (dto.description !== undefined) {
      data.description = dto.description.trim();
    }
    if (dto.customerName !== undefined) {
      data.customerName = dto.customerName?.trim() ?? null;
    }
    if (dto.customerPhone !== undefined) {
      data.customerPhone = dto.customerPhone?.trim() ?? null;
    }
    if (dto.customerEmail !== undefined) {
      data.customerEmail = dto.customerEmail === null ? null : dto.customerEmail?.trim() || null;
    }
    if (dto.vehiclePlate !== undefined) {
      data.vehiclePlate = dto.vehiclePlate?.trim() ?? null;
    }
    if (dto.vehicleBrand !== undefined) {
      data.vehicleBrand = dto.vehicleBrand?.trim() ?? null;
    }
    if (dto.vehicleModel !== undefined) {
      data.vehicleModel = dto.vehicleModel === null ? null : dto.vehicleModel?.trim() || null;
    }
    if (dto.vehicleLine !== undefined) {
      data.vehicleLine = dto.vehicleLine === null ? null : dto.vehicleLine?.trim() || null;
    }
    if (dto.vehicleCylinderCc !== undefined) {
      data.vehicleCylinderCc =
        dto.vehicleCylinderCc === null ? null : dto.vehicleCylinderCc?.trim() || null;
    }
    if (dto.vehicleColor !== undefined) {
      data.vehicleColor = dto.vehicleColor === null ? null : dto.vehicleColor?.trim() || null;
    }
    if (dto.intakeOdometerKm !== undefined) {
      data.intakeOdometerKm = dto.intakeOdometerKm === null ? null : dto.intakeOdometerKm;
    }
    if (dto.vehicleNotes !== undefined) {
      data.vehicleNotes = dto.vehicleNotes?.trim() ?? null;
    }
    if (dto.internalNotes !== undefined) {
      data.internalNotes = dto.internalNotes?.trim() ?? null;
    }
    /** Tope de cobro deshabilitado: columna legada se limpia en cada guardado. */
    data.authorizedAmount = null;

    const impliedDisconnectAssignee =
      dto.status === WorkOrderStatus.UNASSIGNED &&
      dto.status !== before.status &&
      before.assignedToId !== null;

    if (dto.assignedToId !== undefined || impliedDisconnectAssignee) {
      const assignPatchId = impliedDisconnectAssignee ? null : dto.assignedToId;
      data.assignedTo = assignPatchId
        ? { connect: { id: assignPatchId } }
        : { disconnect: true };
      if (
        assignPatchId !== null &&
        before.assignedToId === null &&
        dto.status === undefined &&
        before.status === WorkOrderStatus.UNASSIGNED
      ) {
        data.status = WorkOrderStatus.RECEIVED;
      }
    }

    if (dto.vehicleId !== undefined) {
      if (dto.vehicleId === null) {
        data.vehicle = { disconnect: true };
      } else {
        const v = await this.prisma.vehicle.findUnique({
          where: { id: dto.vehicleId },
          include: { customer: true },
        });
        if (!v || !v.isActive) {
          throw new NotFoundException('Vehículo no encontrado o inactivo');
        }
        data.vehicle = { connect: { id: v.id } };
        if (dto.customerName === undefined) {
          data.customerName = v.customer.displayName;
        }
        if (dto.customerPhone === undefined) {
          data.customerPhone = v.customer.primaryPhone;
        }
        if (dto.vehiclePlate === undefined) {
          data.vehiclePlate = v.plate;
        }
        if (dto.vehicleBrand === undefined) {
          data.vehicleBrand = v.brand?.trim() ?? null;
        }
        if (dto.customerEmail === undefined) {
          data.customerEmail = v.customer.email?.trim() ?? null;
        }
        if (dto.vehicleModel === undefined) {
          data.vehicleModel = v.model?.trim() ?? null;
        }
        if (dto.vehicleColor === undefined) {
          data.vehicleColor = v.color?.trim() ?? null;
        }
      }
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === WorkOrderStatus.DELIVERED) {
        data.deliveredAt = new Date();
        data.cancelledAt = null;
      } else if (dto.status === WorkOrderStatus.CANCELLED) {
        data.cancelledAt = new Date();
        data.deliveredAt = null;
      } else {
        data.deliveredAt = null;
        data.cancelledAt = null;
      }
    }

    if (consentPngBase64 !== null && consentTextSnapshot !== null) {
      data.clientSignaturePngBase64 = consentPngBase64;
      data.clientConsentTextSnapshot = consentTextSnapshot;
      data.clientConsentSignedAt = new Date();
    }

    /**
     * Cancelar también reversa los cobros (mismo criterio que la reapertura): si la orden se
     * cancela, el dinero no puede quedar como ingreso del taller. Va en la misma transacción
     * que el cambio de estado: o se cancela y se compensa la caja, o no pasa nada.
     */
    // (si `before.status` fuese CANCELLED ya se rechazó más arriba: “la orden está cerrada”)
    const isCancelling = dto.status === WorkOrderStatus.CANCELLED;

    const updateArgs = {
      where: { id },
      data,
      include: {
        createdBy: userBrief,
        assignedTo: userBrief,
        vehicle: vehicleWithCustomer,
      },
    } as const;

    let row: Awaited<ReturnType<typeof this.prisma.workOrder.update>>
    let reversedPayments: Array<Record<string, unknown>> = [];
    let reversedTotal: string | null = null;

    if (isCancelling) {
      const result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "work_orders" WHERE id = ${id} FOR UPDATE`);
          const { reversed, total } = await this.reverseWorkOrderPayments(tx, {
            workOrderId: id,
            orderNumber: before.orderNumber,
            publicCode: before.publicCode ?? null,
            actor,
            reason: 'cancelación',
          });
          const updated = await tx.workOrder.update(updateArgs as never);
          return { updated, reversed, total };
        },
        { maxWait: 5000, timeout: 15_000 },
      );
      row = result.updated;
      reversedPayments = result.reversed;
      reversedTotal = Number(result.total) > 0 ? result.total.toString() : null;
    } else {
      row = await this.prisma.workOrder.update(updateArgs as never);
    }

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_orders.updated',
      entityType: 'WorkOrder',
      entityId: id,
      previousPayload: {
        status: before.status,
        orderNumber: before.orderNumber,
        assignedToId: before.assignedToId,
        vehicleId: before.vehicleId,
      },
      nextPayload: {
        status: row.status,
        orderNumber: row.orderNumber,
        assignedToId: row.assignedToId,
        vehicleId: row.vehicleId,
        fields: keys,
        ...(reversedTotal ? { reversedPayments, reversedTotal } : {}),
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.stripWorkOrderSnapshotFinancials(actor, row);
  }

  private stripWorkOrderSnapshotFinancials<T extends Record<string, unknown>>(actor: JwtUserPayload, row: T): T {
    if (actorMayViewWorkOrderFinancials(actor)) {
      return row;
    }
    return { ...row, authorizedAmount: null } as T;
  }

  private assertAssignmentChangeAllowed(
    actor: JwtUserPayload,
    before: { assignedToId: string | null; status: WorkOrderStatus },
    dto: UpdateWorkOrderDto,
  ): void {
    const impliedClearForUnassignedStatus =
      dto.status === WorkOrderStatus.UNASSIGNED &&
      dto.status !== before.status &&
      before.assignedToId !== null;

    const effectiveNext: string | null | undefined =
      dto.assignedToId !== undefined ? dto.assignedToId : impliedClearForUnassignedStatus ? null : undefined;

    if (effectiveNext === undefined) {
      return;
    }
    const next = effectiveNext;
    if (next === before.assignedToId) {
      return;
    }
    if (next === null) {
      if (before.assignedToId === null) {
        return;
      }
      if (!actor.permissions.includes('work_orders:reassign')) {
        throw new ForbiddenException(
          'Solo quien tiene permiso de reasignación puede dejar la orden sin técnico asignado.',
        );
      }
      return;
    }
    if (before.assignedToId === null) {
      if (next === actor.sub) {
        return;
      }
      if (actor.permissions.includes('work_orders:reassign')) {
        return;
      }
      throw new ForbiddenException(
        'Solo podés asignarte la orden a vos mismo. Para asignar a otra persona hace falta permiso de reasignación.',
      );
    }
    if (!actor.permissions.includes('work_orders:reassign')) {
      throw new ForbiddenException('No tenés permiso para pasar esta orden a otro técnico.');
    }
  }

  private normalizeClientSignaturePngBase64(raw: string): string {
    const t = raw.trim();
    const m = /^data:image\/png;base64,(.+)$/i.exec(t);
    return (m?.[1] ?? t).replace(/\s/g, '');
  }

  private assertClientSignaturePngPayloadOk(base64: string): void {
    const MAX_BYTES = 4 * 1024 * 1024;
    const MIN_BYTES = 80;
    let buf: Buffer;
    try {
      buf = Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('Firma inválida: no es base64 válido.');
    }
    if (buf.length < MIN_BYTES) {
      throw new BadRequestException('La firma está vacía o es demasiado pequeña.');
    }
    if (buf.length > MAX_BYTES) {
      throw new BadRequestException('La imagen de firma es demasiado grande.');
    }
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      throw new BadRequestException('La firma debe ser un PNG válido.');
    }
  }

  private canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
    const allowed = WORK_ORDER_ALLOWED_TRANSITIONS[from];
    return (allowed as readonly WorkOrderStatus[]).includes(to);
  }

  private async assertAssignableUser(userId: string): Promise<void> {
    const u = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        AND: [
          { roles: { some: { role: { slug: 'mecanico' } } } },
          { NOT: { roles: { some: { role: { slug: { not: 'mecanico' } } } } } },
        ],
      },
      select: { id: true },
    });
    if (!u) {
      throw new ForbiddenException(
        'El usuario asignado debe estar activo y tener como único rol «Mecánico»',
      );
    }
  }
}
