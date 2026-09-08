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
import { Prisma, WorkOrderStatus } from '@prisma/client';
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
  serializeLineTotals,
  serializeWorkOrderTotals,
  computeLineTotals,
  type LineForTotals,
} from './work-order-totals';

const LIST_PAGE_SIZE_DEFAULT = 50;
const LIST_PAGE_SIZE_MAX = 100;

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

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: { ...data, publicCode: pendingPublicCode },
        include: includeAfterCreate,
      });
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

  /** Usuarios activos para selector de reasignación (recepción / jefe de taller). */
  async listAssignableUsers() {
    return this.prisma.user.findMany({
      where: { isActive: true },
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
    const totalsForActor = mayViewCosts
      ? totalsSerialized
      : { ...totalsSerialized, totalCost: null, totalProfit: null };

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

    const stamp =
      `\n\n--- Reapertura OT #${before.orderNumber} (${new Date().toISOString()}) ---\n` +
      `Usuario: ${actor.fullName} (${actor.email})\n` +
      `Justificación:\n${justification}\n\n` +
      `Nota:\n${note}\n`;
    const internalNotes = `${before.internalNotes?.trim() ?? ''}${stamp}`.trim();

    const row = await this.prisma.workOrder.update({
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

    const row = await this.prisma.workOrder.update({
      where: { id },
      data,
      include: {
        createdBy: userBrief,
        assignedTo: userBrief,
        vehicle: vehicleWithCustomer,
      },
    });

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
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!u || !u.isActive) {
      throw new ForbiddenException('Usuario asignado inválido o inactivo');
    }
  }
}
