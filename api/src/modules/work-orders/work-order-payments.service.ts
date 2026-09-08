/**
 * Cobros de orden de trabajo: ingreso en caja + `WorkOrderPayment` (1:1 con el movimiento).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashMovementDirection,
  CashSessionStatus,
  Prisma,
  WorkOrderPaymentKind,
  WorkOrderStatus,
} from '@prisma/client';
import { ceilWholeCop, decimalFromMoneyApiString } from '../../common/money/cop-money';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { CASH_WORK_ORDER_REFERENCE_TYPE } from '../cash/cash.constants';
import { resolveTenderAndChange } from '../cash/cash-tender.util';
import type { DeleteWorkOrderPaymentDto } from './dto/delete-work-order-payment.dto';
import type { RecordWorkOrderPaymentDto } from './dto/record-work-order-payment.dto';
import { WorkOrdersService } from './work-orders.service';
import { actorMayViewWorkOrderFinancials } from './work-orders.visibility';
import { billingTotalsCeiledForWorkOrder } from './work-order-grand-total';

const userBrief = { select: { id: true, email: true, fullName: true } };

/** Cobro en caja desde la OT: no en cola sin flujo, ni entregada, ni cancelada. */
const WORK_ORDER_STATUSES_ALLOWING_CASH_PAYMENT: readonly WorkOrderStatus[] = [
  WorkOrderStatus.RECEIVED,
  WorkOrderStatus.IN_WORKSHOP,
  WorkOrderStatus.WAITING_PARTS,
  WorkOrderStatus.READY,
];

function workOrderStatusAllowsPaymentRecord(status: WorkOrderStatus): boolean {
  return (WORK_ORDER_STATUSES_ALLOWING_CASH_PAYMENT as readonly WorkOrderStatus[]).includes(status);
}

@Injectable()
export class WorkOrderPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notes: NotesPolicyService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  async list(workOrderId: string, actor: JwtUserPayload) {
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);
    if (!actorMayViewWorkOrderFinancials(actor)) {
      throw new ForbiddenException(
        'No tenés permiso para ver cobros ni montos de esta orden.',
      );
    }
    return this.prisma.workOrderPayment.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'desc' },
      include: {
        recordedBy: userBrief,
        cashMovement: { include: { category: true } },
      },
    });
  }

  async summary(workOrderId: string, actor: JwtUserPayload) {
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);
    if (!actorMayViewWorkOrderFinancials(actor)) {
      throw new ForbiddenException(
        'No tenés permiso para ver el resumen económico de esta orden.',
      );
    }
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, status: true, orderNumber: true, publicCode: true },
    });
    if (!wo) {
      throw new NotFoundException('Orden de trabajo no encontrada');
    }
    const agg = await this.prisma.workOrderPayment.aggregate({
      where: { workOrderId },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const totalPaid = agg._sum.amount ?? new Prisma.Decimal(0);
    const { linesSubtotal, grandTotal } = await billingTotalsCeiledForWorkOrder(
      this.prisma.workOrderLine,
      workOrderId,
    );
    const dueBase = grandTotal;
    const amountDueDec = dueBase.minus(totalPaid);
    const amountDue = amountDueDec.lt(0) ? '0' : ceilWholeCop(amountDueDec).toString();
    const remaining = amountDue;
    return {
      workOrderId: wo.id,
      orderNumber: wo.orderNumber,
      publicCode: wo.publicCode,
      status: wo.status,
      authorizedAmount: null,
      totalPaid: totalPaid.toString(),
      paymentCount: agg._count._all,
      remaining,
      linesSubtotal: linesSubtotal.toString(),
      amountDue,
    };
  }

  async record(
    workOrderId: string,
    actor: JwtUserPayload,
    dto: RecordWorkOrderPaymentDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);

    const amount = decimalFromMoneyApiString(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }

    const paymentNote = await this.notes.requireOperationalNote(
      'Nota del cobro a la orden',
      dto.note,
      'work_order_payment',
    );

    const { tenderAmount, changeAmount } = resolveTenderAndChange(amount, dto.tenderAmount);

    const slug = (dto.categorySlug?.trim() || 'ingreso_cobro').toLowerCase();

    const prismaKind: WorkOrderPaymentKind =
      dto.paymentKind === 'full' ? WorkOrderPaymentKind.FULL_SETTLEMENT : WorkOrderPaymentKind.PARTIAL;

    /**
     * Bloqueo de fila en la OT + lecturas/escrituras en la misma transacción para evitar cobros
     * concurrentes que desalineen el saldo.
     */
    const { movement, payment, wo, session, statusAfter } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "work_orders" WHERE id = ${workOrderId} FOR UPDATE`);

        const wo = await tx.workOrder.findUnique({
          where: { id: workOrderId },
          select: {
            id: true,
            orderNumber: true,
            publicCode: true,
            status: true,
          },
        });
        if (!wo) {
          throw new NotFoundException('Orden de trabajo no encontrada');
        }
        if (!workOrderStatusAllowsPaymentRecord(wo.status)) {
          throw new ConflictException(
            'No se pueden registrar cobros con la orden en Sin asignar, Entregada o Cancelada. Registrá cobros mientras la orden está en Recibida, En taller, Esperando repuestos o Lista.',
          );
        }

        const { grandTotal: totalDue } = await billingTotalsCeiledForWorkOrder(tx.workOrderLine, wo.id);
        if (totalDue.lte(0)) {
          throw new BadRequestException(
            'No hay saldo pendiente: el total de líneas (con impuestos y descuentos) es cero. Cargá importes antes de cobrar.',
          );
        }

        const paidSum = await tx.workOrderPayment.aggregate({
          where: { workOrderId: wo.id },
          _sum: { amount: true },
        });
        const already = paidSum._sum.amount ?? new Prisma.Decimal(0);

        const newTotalPaid = already.plus(amount);
        if (dto.paymentKind === 'partial') {
          if (!newTotalPaid.lt(totalDue)) {
            throw new BadRequestException(
              'En un abono el monto debe dejar saldo pendiente. Si liquidás el total, elegí «Pago total» y cobrá exactamente el saldo.',
            );
          }
        } else {
          if (!newTotalPaid.equals(totalDue)) {
            throw new BadRequestException(
              `El pago total debe igualar el saldo pendiente (${totalDue.toString()}). Con este cobro el saldo quedaría ${newTotalPaid.toString()}.`,
            );
          }
        }

        const session = await tx.cashSession.findFirst({
          where: { status: CashSessionStatus.OPEN },
        });
        if (!session) {
          throw new ConflictException('No hay sesión de caja abierta');
        }

        const category = await tx.cashMovementCategory.findUnique({
          where: { slug },
        });
        if (!category) {
          throw new NotFoundException('Categoría no encontrada');
        }
        if (category.direction !== CashMovementDirection.INCOME) {
          throw new BadRequestException('La categoría no corresponde a un ingreso');
        }

        const movement = await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            categoryId: category.id,
            direction: CashMovementDirection.INCOME,
            amount,
            tenderAmount,
            changeAmount,
            referenceType: CASH_WORK_ORDER_REFERENCE_TYPE,
            referenceId: wo.id,
            note: paymentNote,
            createdById: actor.sub,
          },
          include: { category: true, createdBy: userBrief },
        });

        const payment = await tx.workOrderPayment.create({
          data: {
            workOrderId: wo.id,
            amount,
            kind: prismaKind,
            cashMovementId: movement.id,
            note: paymentNote,
            recordedById: actor.sub,
          },
          include: { recordedBy: userBrief, cashMovement: { include: { category: true } } },
        });

        let statusAfter: WorkOrderStatus = wo.status;
        if (dto.paymentKind === 'full') {
          await tx.workOrder.update({
            where: { id: wo.id },
            data: {
              status: WorkOrderStatus.DELIVERED,
              deliveredAt: new Date(),
            },
          });
          statusAfter = WorkOrderStatus.DELIVERED;
        }

        return { movement, payment, wo, session, statusAfter };
      },
      { maxWait: 5000, timeout: 15_000 },
    );

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_orders.payment_recorded',
      entityType: 'WorkOrderPayment',
      entityId: payment.id,
      previousPayload: null,
      nextPayload: {
        workOrderId: wo.id,
        orderNumber: wo.orderNumber,
        publicCode: wo.publicCode,
        paymentKind: dto.paymentKind,
        workOrderStatusAfter: statusAfter,
        amount: dto.amount,
        tenderAmount: tenderAmount?.toString() ?? null,
        changeAmount: changeAmount?.toString() ?? null,
        cashMovementId: movement.id,
        categorySlug: slug,
        note: paymentNote,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'cash_movements.income',
      entityType: 'CashMovement',
      entityId: movement.id,
      previousPayload: null,
      nextPayload: {
        sessionId: session.id,
        categorySlug: slug,
        direction: CashMovementDirection.INCOME,
        amount: dto.amount,
        tenderAmount: tenderAmount?.toString() ?? null,
        changeAmount: changeAmount?.toString() ?? null,
        referenceType: CASH_WORK_ORDER_REFERENCE_TYPE,
        referenceId: wo.id,
        workOrderId: wo.id,
        note: paymentNote,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    if (dto.paymentKind === 'full') {
      await this.audit.recordDomain({
        actorUserId: actor.sub,
        action: 'work_orders.delivered_by_full_payment',
        entityType: 'WorkOrder',
        entityId: wo.id,
        previousPayload: { status: wo.status, orderNumber: wo.orderNumber, publicCode: wo.publicCode },
        nextPayload: {
          status: WorkOrderStatus.DELIVERED,
          workOrderPaymentId: payment.id,
          amount: dto.amount,
        },
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }

    return payment;
  }

  /**
   * Elimina un abono (pago `PARTIAL`) de una OT abierta: borra la fila de cobro y su ingreso
   * de caja 1:1 en la misma transacción. Bloqueado para OT Entregada/Cancelada y para la
   * liquidación total (`FULL_SETTLEMENT`). Requiere motivo y deja auditoría.
   */
  async remove(
    workOrderId: string,
    paymentId: string,
    actor: JwtUserPayload,
    dto: DeleteWorkOrderPaymentDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    await this.workOrders.assertWorkOrderVisible(actor, workOrderId);

    const reason = await this.notes.requireOperationalNote(
      'Motivo de la eliminación del abono',
      dto.reason,
      'general',
    );

    const { wo, payment } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "work_orders" WHERE id = ${workOrderId} FOR UPDATE`);

        const wo = await tx.workOrder.findUnique({
          where: { id: workOrderId },
          select: {
            id: true,
            orderNumber: true,
            publicCode: true,
            status: true,
          },
        });
        if (!wo) {
          throw new NotFoundException('Orden de trabajo no encontrada');
        }
        if (
          wo.status === WorkOrderStatus.DELIVERED ||
          wo.status === WorkOrderStatus.CANCELLED
        ) {
          throw new ConflictException(
            'La orden está cerrada; no admite cambios. Solo se pueden eliminar abonos de una orden abierta (Recibida, En taller, Esperando repuestos o Lista).',
          );
        }

        const payment = await tx.workOrderPayment.findFirst({
          where: { id: paymentId, workOrderId: wo.id },
          include: { cashMovement: { select: { id: true } } },
        });
        if (!payment) {
          throw new NotFoundException('El cobro no existe o no pertenece a esta orden');
        }
        if (payment.kind === WorkOrderPaymentKind.FULL_SETTLEMENT) {
          throw new BadRequestException(
            'Solo se pueden eliminar abonos; la liquidación total de la orden no se puede borrar.',
          );
        }

        await tx.workOrderPayment.delete({ where: { id: payment.id } });
        if (payment.cashMovement) {
          await tx.cashMovement.delete({ where: { id: payment.cashMovement.id } });
        }

        return { wo, payment };
      },
      { maxWait: 5000, timeout: 15_000 },
    );

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'work_orders.payment_deleted',
      entityType: 'WorkOrderPayment',
      entityId: payment.id,
      previousPayload: {
        workOrderId: wo.id,
        orderNumber: wo.orderNumber,
        publicCode: wo.publicCode,
        workOrderStatus: wo.status,
        paymentKind: payment.kind,
        amount: payment.amount.toString(),
        cashMovementId: payment.cashMovement?.id ?? null,
        note: payment.note ?? null,
      },
      nextPayload: {
        workOrderId: wo.id,
        orderNumber: wo.orderNumber,
        publicCode: wo.publicCode,
        workOrderStatusAfter: wo.status,
        amount: payment.amount.toString(),
        cashMovementId: payment.cashMovement?.id ?? null,
        reason,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }
}
