/**
 * Líneas de OT: repuesto (PART) o mano de obra (LABOR). Ambas son texto libre
 * (se auto-guardan en el diccionario de autocompletado al crearse/editarse).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkOrderLineType,
  WorkOrderStatus,
} from '@prisma/client';
import { ceilWholeCop, decimalFromMoneyApiString } from '../../common/money/cop-money';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import type { CreateWorkOrderLineDto } from './dto/create-work-order-line.dto';
import type { UpdateWorkOrderLineDto } from './dto/update-work-order-line.dto';
import { WorkOrdersService } from './work-orders.service';
import { normalizeSparePartSku } from '../spare-parts/spare-parts.service';
import {
  actorMayViewWorkOrderCosts,
  actorMayViewWorkOrderFinancials,
} from './work-orders.visibility';
import {
  computeLineTotals,
  computeWorkOrderTotals,
  serializeLineTotals,
  serializeWorkOrderTotals,
  type LineForTotals,
} from './work-order-totals';

/** Solo estos perfiles pueden editar o quitar líneas PART (repuesto) ya agregadas a la OT. */
const WORK_ORDER_PART_LINE_MANAGER_ROLE_SLUGS = new Set([
  'cajero',
  'cajero_autorizado',
  'administrador',
  'dueno',
])

const lineInclude = {
  taxRate: { select: { id: true, slug: true, name: true, kind: true, ratePercent: true } },
} as const;

@Injectable()
export class WorkOrderLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  /**
   * Quien ve importes en OT puede ver `unitPrice`; los demás lo ven nulo junto con los totales.
   * `costSnapshot` (precio proveedor) es más sensible: solo `reports:read` (administración / dueño).
   */
  private redactLineForActor<
    T extends { unitPrice: unknown; totals?: unknown; costSnapshot?: unknown },
  >(actor: JwtUserPayload, line: T): T {
    const mayFin = actorMayViewWorkOrderFinancials(actor);
    const mayCosts = actorMayViewWorkOrderCosts(actor);
    if (mayFin && mayCosts) return line;
    return {
      ...line,
      ...(mayFin ? {} : { unitPrice: null, totals: null }),
      ...(mayCosts ? {} : { costSnapshot: null }),
    } as T;
  }

  private async assertWorkOrderPartLineManagersOnly(actor: JwtUserPayload, lineType: WorkOrderLineType): Promise<void> {
    if (lineType !== WorkOrderLineType.PART) return

    const previewSlug = actor.previewRole?.slug
    if (previewSlug) {
      if (!WORK_ORDER_PART_LINE_MANAGER_ROLE_SLUGS.has(previewSlug)) {
        throw new ForbiddenException(
          'Solo cajero, administrador o dueño pueden modificar o quitar repuestos ya cargados en la orden.',
        )
      }
      return
    }

    const rows = await this.prisma.userRole.findMany({
      where: { userId: actor.sub },
      include: { role: { select: { slug: true } } },
    })
    const ok = rows.some((r) => WORK_ORDER_PART_LINE_MANAGER_ROLE_SLUGS.has(r.role.slug))
    if (!ok) {
      throw new ForbiddenException(
        'Solo cajero, administrador o dueño pueden modificar o quitar repuestos ya cargados en la orden.',
      )
    }
  }

  async list(workOrderId: string, actor: JwtUserPayload) {
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);
    const rows = await this.prisma.workOrderLine.findMany({
      where: { workOrderId },
      orderBy: { sortOrder: 'asc' },
      include: lineInclude,
    });
    const mayFin = actorMayViewWorkOrderFinancials(actor);
    return rows.map((ln) => {
      if (!mayFin) {
        return this.redactLineForActor(actor, ln);
      }
      const linesForTotals: LineForTotals = {
        id: ln.id,
        lineType: ln.lineType,
        quantity: ln.quantity,
        unitPrice: ln.unitPrice,
        discountAmount: ln.discountAmount,
        costSnapshot: ln.costSnapshot,
        taxRateId: ln.taxRateId,
        taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
        taxRate: ln.taxRate ? { kind: ln.taxRate.kind } : null,
      };
      return this.redactLineForActor(actor, {
        ...ln,
        totals: serializeLineTotals(computeLineTotals(linesForTotals)),
      });
    });
  }

  /**
   * Devuelve el desglose oficial de la OT (Fase 2): subtotal bruto, descuento, IVA/INC,
   * total a cobrar, costo y utilidad si corresponde. Mantiene el campo `subtotal` por
   * compatibilidad con los consumidores actuales (suma bruta antes de impuestos).
   */
  async subtotal(workOrderId: string, actor: JwtUserPayload) {
    if (!actorMayViewWorkOrderFinancials(actor)) {
      throw new ForbiddenException(
        'No tenés permiso para consultar importes de la orden. Pedile a caja o administración.',
      );
    }
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);
    const lines = await this.prisma.workOrderLine.findMany({
      where: { workOrderId },
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
    });
    const totals = computeWorkOrderTotals(
      lines.map((ln) => ({
        id: ln.id,
        lineType: ln.lineType,
        quantity: ln.quantity,
        unitPrice: ln.unitPrice,
        discountAmount: ln.discountAmount,
        costSnapshot: ln.costSnapshot,
        taxRateId: ln.taxRateId,
        taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
        taxRate: ln.taxRate ? { kind: ln.taxRate.kind } : null,
      })),
    );
    const serialized = serializeWorkOrderTotals(totals);
    const mayViewCosts = actorMayViewWorkOrderCosts(actor);
    return {
      workOrderId,
      subtotal: ceilWholeCop(totals.linesSubtotal).toString(),
      ...serialized,
      totalCost: mayViewCosts ? serialized.totalCost : null,
      totalProfit: mayViewCosts ? serialized.totalProfit : null,
    };
  }

  async create(
    workOrderId: string,
    actor: JwtUserPayload,
    dto: CreateWorkOrderLineDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const description = dto.description?.trim();
    if (!description) {
      throw new BadRequestException(
        dto.lineType === WorkOrderLineType.PART
          ? 'La línea de repuesto requiere una descripción'
          : 'La línea de mano de obra requiere una descripción',
      );
    }

    const qty = new Prisma.Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);

    let taxRatePercentSnapshotForSave: Prisma.Decimal | null = null;
    let taxRateIdForSave: string | null = null;
    // Regla de negocio: los repuestos (PART) son precio final sin IVA (como Autopiezas Tegui).
    const isPart = dto.lineType === WorkOrderLineType.PART;
    if (!isPart && dto.taxRateId) {
      const tax = await this.prisma.taxRate.findUnique({
        where: { id: dto.taxRateId },
      });
      if (!tax) throw new NotFoundException('Tarifa de impuesto no encontrada');
      if (!tax.isActive) {
        throw new BadRequestException('La tarifa de impuesto seleccionada está desactivada');
      }
      taxRatePercentSnapshotForSave = tax.ratePercent;
      taxRateIdForSave = dto.taxRateId;
    }

    const sparePartSkuForSave =
      isPart && dto.sparePartSku?.trim() ? normalizeSparePartSku(dto.sparePartSku).slice(0, 80) : null;

    const mayFinancials = actorMayViewWorkOrderFinancials(actor);
    const unitPriceForSave =
      mayFinancials && dto.unitPrice?.trim()
        ? decimalFromMoneyApiString(dto.unitPrice)
        : null

    const discountForSave =
      mayFinancials && dto.discountAmount?.trim()
        ? decimalFromMoneyApiString(dto.discountAmount)
        : null

    // Precio proveedor: sensible, solo `reports:read` (administración / dueño).
    const costForSave =
      actorMayViewWorkOrderCosts(actor) && dto.costSnapshot?.trim()
        ? decimalFromMoneyApiString(dto.costSnapshot)
        : null

    const line = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkOrder(tx, workOrderId);
      await this.assertWorkOrderEditable(tx, workOrderId);

      const sortOrder = await this.nextSortOrder(tx, workOrderId);

      const created = await tx.workOrderLine.create({
        data: {
          workOrderId,
          lineType: dto.lineType,
          sortOrder,
          sparePartSku: sparePartSkuForSave,
          taxRateId: isPart ? null : taxRateIdForSave,
          taxRatePercentSnapshot: isPart ? null : taxRatePercentSnapshotForSave,
          description,
          quantity: qty,
          unitPrice: unitPriceForSave,
          discountAmount: discountForSave,
          costSnapshot: costForSave,
        },
        include: lineInclude,
      });

      await this.upsertCatalogEntry(tx, description);

      return created;
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_order_lines.created',
      entityType: 'WorkOrderLine',
      entityId: line.id,
      previousPayload: null,
      nextPayload: {
        workOrderId,
        lineType: line.lineType,
        description,
        quantity: dto.quantity,
        sparePartSku: line.sparePartSku,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.redactLineForActor(actor, line);
  }

  async update(
    workOrderId: string,
    lineId: string,
    actor: JwtUserPayload,
    dto: UpdateWorkOrderLineDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const keys = Object.keys(dto).filter((k) => dto[k as keyof UpdateWorkOrderLineDto] !== undefined);
    if (keys.length === 0) {
      throw new BadRequestException('No hay campos para actualizar');
    }

    if (
      (dto.unitPrice !== undefined || dto.discountAmount !== undefined) &&
      !actorMayViewWorkOrderFinancials(actor)
    ) {
      throw new ForbiddenException(
        'No tenés permiso para cargar o cambiar importes en líneas de orden. Pedile a caja o administración.',
      )
    }

    if (dto.costSnapshot !== undefined && !actorMayViewWorkOrderCosts(actor)) {
      throw new ForbiddenException(
        'No tenés permiso para cargar o cambiar el precio proveedor. Pedile a administración.',
      )
    }

    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);

    const existingLine = await this.prisma.workOrderLine.findFirst({
      where: { id: lineId, workOrderId },
    });
    if (!existingLine) {
      throw new NotFoundException('Línea no encontrada en esta orden')
    }

    const isPart = existingLine.lineType === WorkOrderLineType.PART;
    await this.assertWorkOrderPartLineManagersOnly(actor, existingLine.lineType)

    // Si el cambio incluye tarifa de impuesto, calculamos el nuevo snapshot %.
    // - undefined  → no tocamos snapshot.
    // - null       → limpiamos tasa y snapshot.
    // - string id  → validamos tasa, activa, y guardamos su ratePercent actual.
    // Regla de negocio: en líneas PART (repuestos) el impuesto se fuerza a null
    // (precio final sin IVA, igual que Autopiezas Tegui).
    let taxRatePercentSnapshotPatch: Prisma.Decimal | null | undefined = undefined;
    let taxRateIdPatch: string | null | undefined = undefined;
    if (isPart) {
      taxRatePercentSnapshotPatch = null;
      taxRateIdPatch = null;
    } else if (dto.taxRateId === null) {
      taxRatePercentSnapshotPatch = null;
      taxRateIdPatch = null;
    } else if (dto.taxRateId !== undefined) {
      const tax = await this.prisma.taxRate.findUnique({ where: { id: dto.taxRateId } });
      if (!tax) throw new NotFoundException('Tarifa de impuesto no encontrada');
      if (!tax.isActive) {
        throw new BadRequestException('La tarifa de impuesto seleccionada está desactivada');
      }
      taxRatePercentSnapshotPatch = tax.ratePercent;
      taxRateIdPatch = dto.taxRateId;
    }

    let sparePartSkuPatch: string | null | undefined = undefined;
    if (dto.sparePartSku !== undefined) {
      sparePartSkuPatch =
        isPart && dto.sparePartSku?.trim()
          ? normalizeSparePartSku(dto.sparePartSku).slice(0, 80)
          : null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkOrder(tx, workOrderId);
      await this.assertWorkOrderEditable(tx, workOrderId);

      let quantityPatch: Prisma.Decimal | undefined;
      if (dto.quantity !== undefined) {
        const rawQty = new Prisma.Decimal(dto.quantity);
        if (rawQty.lte(0)) {
          throw new BadRequestException('La cantidad debe ser mayor a cero');
        }
        quantityPatch = rawQty;
      }

      let unitPricePatch: Prisma.Decimal | null | undefined = undefined;
      if (dto.unitPrice !== undefined) {
        unitPricePatch = dto.unitPrice === null ? null : decimalFromMoneyApiString(dto.unitPrice);
      }

      const descriptionPatch =
        dto.description !== undefined ? dto.description?.trim() ?? null : undefined;
      if (descriptionPatch !== undefined) {
        if (!descriptionPatch) {
          throw new BadRequestException('La descripción de la línea no puede quedar vacía');
        }
        await this.upsertCatalogEntry(tx, descriptionPatch);
      }

      return tx.workOrderLine.update({
        where: { id: lineId },
        data: {
          quantity: quantityPatch,
          unitPrice: unitPricePatch,
          discountAmount:
            dto.discountAmount === undefined
              ? undefined
              : dto.discountAmount === null
                ? null
                : decimalFromMoneyApiString(dto.discountAmount),
          taxRateId: taxRateIdPatch,
          taxRatePercentSnapshot: taxRatePercentSnapshotPatch,
          sparePartSku: sparePartSkuPatch,
          description: descriptionPatch,
          costSnapshot:
            dto.costSnapshot === undefined
              ? undefined
              : dto.costSnapshot === null
                ? null
                : decimalFromMoneyApiString(dto.costSnapshot),
        },
        include: lineInclude,
      });
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_order_lines.updated',
      entityType: 'WorkOrderLine',
      entityId: lineId,
      previousPayload: { workOrderId },
      nextPayload: { workOrderId, fields: keys },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.redactLineForActor(actor, updated);
  }

  async remove(workOrderId: string, lineId: string, actor: JwtUserPayload, meta: { ip?: string; userAgent?: string }) {
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockWorkOrder(tx, workOrderId);
      await this.assertWorkOrderEditable(tx, workOrderId);

      const line = await tx.workOrderLine.findFirst({
        where: { id: lineId, workOrderId },
      });
      if (!line) {
        throw new NotFoundException('Línea no encontrada en esta orden');
      }

      await this.assertWorkOrderPartLineManagersOnly(actor, line.lineType)

      await tx.workOrderLine.delete({ where: { id: lineId } });
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_order_lines.deleted',
      entityType: 'WorkOrderLine',
      entityId: lineId,
      previousPayload: { workOrderId },
      nextPayload: null,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }

  private async lockWorkOrder(tx: Prisma.TransactionClient, workOrderId: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT id FROM "work_orders" WHERE id = ${workOrderId} FOR UPDATE`);
  }

  private async assertWorkOrderEditable(tx: Prisma.TransactionClient, workOrderId: string): Promise<void> {
    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { status: true },
    });
    if (!wo) {
      throw new NotFoundException('Orden de trabajo no encontrada');
    }
    if (wo.status === WorkOrderStatus.DELIVERED || wo.status === WorkOrderStatus.CANCELLED) {
      throw new ConflictException('La orden está cerrada; no admite cambios en líneas');
    }
  }

  private async nextSortOrder(tx: Prisma.TransactionClient, workOrderId: string): Promise<number> {
    const agg = await tx.workOrderLine.aggregate({
      where: { workOrderId },
      _max: { sortOrder: true },
    });
    return (agg._max.sortOrder ?? -1) + 1;
  }

  /** Guarda la descripción en el diccionario de autocompletado (idempotente). */
  private async upsertCatalogEntry(
    tx: Prisma.TransactionClient,
    description: string,
  ): Promise<void> {
    await tx.otLineCatalog.upsert({
      where: { label: description },
      create: { label: description },
      update: { lastUsedAt: new Date() },
    });
  }

  /**
   * Sugerencias del diccionario de líneas de OT para el autocompletado del front.
   * Con `q` vacío devuelve las más recientes (ordenadas por `lastUsedAt`).
   */
  async suggestCatalogDescriptions(
    q: string | undefined,
    limit = 15,
  ): Promise<Array<{ label: string; lastUsedAt: Date | null }>> {
    const trimmed = q?.trim();
    const where: Prisma.OtLineCatalogWhereInput = trimmed
      ? { label: { contains: trimmed, mode: 'insensitive' } }
      : {};
    const rows = await this.prisma.otLineCatalog.findMany({
      where,
      orderBy: [{ lastUsedAt: 'desc' }, { label: 'asc' }],
      take: Math.min(Math.max(limit, 1), 50),
      select: { label: true, lastUsedAt: true },
    });
    return rows;
  }
}