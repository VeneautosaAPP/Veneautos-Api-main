/**
 * Cobro en caja contra una factura (Fase 5).
 *
 * Regla central: el saldo pendiente de la factura es `grandTotal − SUM(payments.amount)`.
 * Un cobro nunca altera la factura DIAN (número, totales, CUFE); solo produce un
 * `CashMovement` (ingreso) vinculado 1:1 con una fila de `InvoicePayment`.
 *
 * Permitido sobre facturas en estado DRAFT o ISSUED. En VOIDED se rechaza (no
 * puede entrar plata a una factura anulada).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashMovementDirection,
  CashSessionStatus,
  CreditNoteStatus,
  DebitNoteStatus,
  InvoicePaymentKind,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { ceilWholeCop, decimalFromMoneyApiString } from '../../common/money/cop-money';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { CASH_INVOICE_REFERENCE_TYPE } from '../cash/cash.constants';
import { resolveTenderAndChange } from '../cash/cash-tender.util';
import type { RecordInvoicePaymentDto } from './dto/record-invoice-payment.dto';

const userBrief = { select: { id: true, email: true, fullName: true } };

@Injectable()
export class InvoicePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notes: NotesPolicyService,
  ) {}

  async list(invoiceId: string) {
    const exists = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Factura no encontrada.');
    return this.prisma.invoicePayment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
      include: {
        recordedBy: userBrief,
        cashMovement: { include: { category: true } },
      },
    });
  }

  async record(
    invoiceId: string,
    actor: JwtUserPayload,
    dto: RecordInvoicePaymentDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const amount = decimalFromMoneyApiString(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('El monto debe ser mayor a cero.');
    }

    const paymentNote = await this.notes.requireOperationalNote(
      'Nota del cobro de la factura',
      dto.note,
      'work_order_payment',
    );

    const { tenderAmount, changeAmount } = resolveTenderAndChange(amount, dto.tenderAmount);
    const slug = (dto.categorySlug?.trim() || 'ingreso_cobro').toLowerCase();
    const prismaKind: InvoicePaymentKind =
      dto.paymentKind === 'full'
        ? InvoicePaymentKind.FULL_SETTLEMENT
        : InvoicePaymentKind.PARTIAL;

    const { movement, payment, invoice, session } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT 1 FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE`,
        );

        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            documentNumber: true,
            status: true,
            grandTotal: true,
            workOrderId: true,
          },
        });
        if (!invoice) throw new NotFoundException('Factura no encontrada.');
        if (invoice.status === InvoiceStatus.VOIDED) {
          throw new ConflictException(
            'No se pueden registrar cobros sobre una factura anulada.',
          );
        }

        // Fase 7: saldo efectivo = grandTotal - SUM(CN issued) + SUM(DN issued).
        // Una DN emitida después de liquidar reabre el cobro; una CN emitida reduce
        // el saldo (o deja la factura con saldo a favor si ya se había cobrado).
        const [creditNoteAgg, debitNoteAgg] = await Promise.all([
          tx.creditNote.aggregate({
            where: { invoiceId: invoice.id, status: CreditNoteStatus.ISSUED },
            _sum: { grandTotal: true },
          }),
          tx.debitNote.aggregate({
            where: { invoiceId: invoice.id, status: DebitNoteStatus.ISSUED },
            _sum: { grandTotal: true },
          }),
        ]);
        const cnTotal = creditNoteAgg._sum.grandTotal ?? new Prisma.Decimal(0);
        const dnTotal = debitNoteAgg._sum.grandTotal ?? new Prisma.Decimal(0);
        const effective = invoice.grandTotal.minus(cnTotal).plus(dnTotal);
        const totalDue = ceilWholeCop(effective);
        if (totalDue.lte(0)) {
          throw new BadRequestException(
            'La factura no tiene saldo por cobrar (neto de notas crédito/débito emitidas).',
          );
        }

        const paidSum = await tx.invoicePayment.aggregate({
          where: { invoiceId: invoice.id },
          _sum: { amount: true },
        });
        const already = paidSum._sum.amount ?? new Prisma.Decimal(0);
        const newTotalPaid = already.plus(amount);
        if (newTotalPaid.gt(totalDue)) {
          throw new BadRequestException(
            `El cobro excede el saldo efectivo (${totalDue.toString()}). Quedaría en ${newTotalPaid.toString()}.`,
          );
        }
        if (dto.paymentKind === 'partial') {
          if (!newTotalPaid.lt(totalDue)) {
            throw new BadRequestException(
              'Un abono debe dejar saldo pendiente. Si liquidás el total, elegí «Pago total».',
            );
          }
        } else if (!newTotalPaid.equals(totalDue)) {
          throw new BadRequestException(
            `El pago total debe igualar el saldo pendiente (${totalDue.toString()}). Con este cobro quedaría ${newTotalPaid.toString()}.`,
          );
        }

        const session = await tx.cashSession.findFirst({
          where: { status: CashSessionStatus.OPEN },
        });
        if (!session) throw new ConflictException('No hay sesión de caja abierta.');

        const category = await tx.cashMovementCategory.findUnique({ where: { slug } });
        if (!category) throw new NotFoundException('Categoría no encontrada.');
        if (category.direction !== CashMovementDirection.INCOME) {
          throw new BadRequestException('La categoría no corresponde a un ingreso.');
        }

        const movement = await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            categoryId: category.id,
            direction: CashMovementDirection.INCOME,
            amount,
            tenderAmount,
            changeAmount,
            referenceType: CASH_INVOICE_REFERENCE_TYPE,
            referenceId: invoice.id,
            note: paymentNote,
            createdById: actor.sub,
          },
          include: { category: true, createdBy: userBrief },
        });

        const payment = await tx.invoicePayment.create({
          data: {
            invoiceId: invoice.id,
            amount,
            kind: prismaKind,
            cashMovementId: movement.id,
            note: paymentNote,
            recordedById: actor.sub,
          },
          include: {
            recordedBy: userBrief,
            cashMovement: { include: { category: true } },
          },
        });

        return { movement, payment, invoice, session };
      },
      { maxWait: 5000, timeout: 15_000 },
    );

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'invoices.payment_recorded',
      entityType: 'InvoicePayment',
      entityId: payment.id,
      previousPayload: null,
      nextPayload: {
        invoiceId: invoice.id,
        documentNumber: invoice.documentNumber,
        paymentKind: dto.paymentKind,
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
        referenceType: CASH_INVOICE_REFERENCE_TYPE,
        referenceId: invoice.id,
        invoiceId: invoice.id,
        note: paymentNote,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return payment;
  }
}
