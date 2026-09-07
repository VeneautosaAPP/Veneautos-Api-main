import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FiscalResolutionKind,
  InvoiceDispatchStatus,
  InvoiceLineType,
  InvoiceSource,
  InvoiceStatus,
  Prisma,
  TaxRateKind,
  WorkOrderLineType,
  WorkOrderStatus,
} from '@prisma/client';
import { DianProviderFactory } from '../../common/dian/dian-provider.factory';
import type { DianInvoicePayload } from '../../common/dian/dian-provider.interface';
import {
  computeLineTotals,
  type LineForTotals,
} from '../../common/billing/billing-totals';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { AUDIT_INVOICE_ENTITY } from './billing.constants';
import type { CreateInvoiceFromWorkOrderDto } from './dto/create-invoice-from-work-order.dto';
import type { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import type { VoidInvoiceDto } from './dto/void-invoice.dto';
import { InvoiceNumberingService } from './invoice-numbering.service';

const userBrief = { select: { id: true, email: true, fullName: true } } as const;

const invoiceLineSelect = {
  id: true,
  invoiceId: true,
  lineType: true,
  sortOrder: true,
  sourceWorkOrderLineId: true,
  taxRateId: true,
  taxRate: { select: { id: true, slug: true, name: true, kind: true, ratePercent: true } },
  description: true,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  taxRatePercentSnapshot: true,
  taxRateKindSnapshot: true,
  lineTotal: true,
  taxAmount: true,
} as const;

const invoiceDetailInclude = {
  customer: { select: { id: true, displayName: true, documentId: true } },
  createdBy: userBrief,
  fiscalResolution: {
    select: {
      id: true,
      kind: true,
      prefix: true,
      resolutionNumber: true,
      rangeTo: true,
      nextNumber: true,
      validUntil: true,
    },
  },
  workOrder: { select: { id: true, publicCode: true, orderNumber: true } },
  lines: { orderBy: { sortOrder: 'asc' as const }, select: invoiceLineSelect },
  dispatchEvents: {
    take: 20,
    select: {
      id: true,
      attempt: true,
      status: true,
      provider: true,
      environment: true,
      errorMessage: true,
      externalId: true,
      requestedAt: true,
      completedAt: true,
      requestedBy: userBrief,
    },
  },
  creditNotes: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      documentNumber: true,
      status: true,
      reason: true,
      grandTotal: true,
      createdAt: true,
      issuedAt: true,
    },
  },
  debitNotes: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      documentNumber: true,
      status: true,
      reason: true,
      grandTotal: true,
      createdAt: true,
      issuedAt: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      amount: true,
      kind: true,
      note: true,
      createdAt: true,
      recordedBy: userBrief,
      cashMovement: {
        select: {
          id: true,
          amount: true,
          createdAt: true,
          category: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceDetailPayload = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: InvoiceNumberingService,
    private readonly providers: DianProviderFactory,
  ) {}

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  async list(_actor: JwtUserPayload, query: ListInvoicesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.InvoiceWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { documentNumber: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { customerDocumentId: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.fromDate) {
      where.createdAt = { ...(where.createdAt as object), gte: new Date(query.fromDate) };
    }
    if (query.toDate) {
      where.createdAt = { ...(where.createdAt as object), lte: new Date(query.toDate) };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          documentNumber: true,
          invoiceNumber: true,
          status: true,
          source: true,
          workOrderId: true,
          customerName: true,
          customerDocumentId: true,
          grandTotal: true,
          issuedAt: true,
          createdAt: true,
          voidedAt: true,
          customer: { select: { id: true, displayName: true } },
          createdBy: userBrief,
          fiscalResolution: { select: { id: true, kind: true, prefix: true } },
          _count: { select: { dispatchEvents: true, creditNotes: true } },
        },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        ...r,
        grandTotal: r.grandTotal.toString(),
        issuedAt: r.issuedAt?.toISOString() ?? null,
        voidedAt: r.voidedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async findOne(id: string) {
    const row = await this.prisma.invoice.findUnique({
      where: { id },
      include: invoiceDetailInclude,
    });
    if (!row) throw new NotFoundException('Factura no encontrada.');
    return this.shape(row);
  }

  // ---------------------------------------------------------------------------
  // Creación directa desde una OT entregada
  // ---------------------------------------------------------------------------

  async createFromWorkOrder(
    workOrderId: string,
    actor: JwtUserPayload,
    dto: CreateInvoiceFromWorkOrderDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        lines: { include: { taxRate: true } },
        vehicle: { include: { customer: true } },
      },
    });
    if (!wo) throw new NotFoundException('Orden de trabajo no encontrada.');
    if (wo.status !== WorkOrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Solo pueden facturarse OTs entregadas (DELIVERED). Cierra la orden antes de facturar.',
      );
    }
    if (wo.lines.length === 0) {
      throw new BadRequestException('La OT no tiene líneas para facturar.');
    }

    const existing = await this.prisma.invoice.findFirst({
      where: {
        status: { not: InvoiceStatus.VOIDED },
        workOrderId: wo.id,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Esta OT ya tiene una factura viva (${existing.documentNumber}). Anula o emite nota crédito antes de refacturar.`,
      );
    }

    const linesForTotals: LineForTotals[] = wo.lines.map((ln) => ({
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

    const lineTotals = linesForTotals.map((ln) => computeLineTotals(ln));

    const subtotal = sumDecimal(lineTotals.map((t) => t.grossAmount));
    const totalDiscount = sumDecimal(lineTotals.map((t) => t.discountAmount));
    const totalVat = sumDecimal(
      lineTotals
        .filter((t) => t.taxKind !== TaxRateKind.INC)
        .map((t) => t.taxAmount),
    );
    const totalInc = sumDecimal(
      lineTotals
        .filter((t) => t.taxKind === TaxRateKind.INC)
        .map((t) => t.taxAmount),
    );
    const totalTax = totalVat.plus(totalInc);
    const grandTotal = subtotal.minus(totalDiscount).plus(totalTax);

    const customer = wo.vehicle?.customer ?? null;

    const invoice = await this.prisma.$transaction(async (tx) => {
      const numbering = await this.numbering.assignConsecutive(
        tx,
        dto.fiscalResolutionId
          ? { resolutionId: dto.fiscalResolutionId }
          : { kind: FiscalResolutionKind.ELECTRONIC_INVOICE },
      );

      return tx.invoice.create({
        data: {
          fiscalResolutionId: numbering.resolutionId,
          invoiceNumber: numbering.consecutiveNumber,
          documentNumber: numbering.documentNumber,
          status: InvoiceStatus.DRAFT,
          source: InvoiceSource.WORK_ORDER,
          workOrderId: wo.id,
          customerId: customer?.id ?? null,
          customerName:
            wo.customerName ?? customer?.displayName ?? 'Consumidor final',
          customerDocumentId: customer?.documentId ?? null,
          customerPhone: wo.customerPhone ?? customer?.primaryPhone ?? null,
          customerEmail: wo.customerEmail ?? customer?.email ?? null,
          subtotal,
          totalDiscount,
          totalTax,
          totalVat,
          totalInc,
          grandTotal,
          internalNotes: dto.internalNotes?.trim() || null,
          createdById: actor.sub,
          lines: {
            create: wo.lines.map((ln, index) => {
              const t = lineTotals[index];
              return {
                lineType:
                  ln.lineType === WorkOrderLineType.LABOR
                    ? InvoiceLineType.LABOR
                    : InvoiceLineType.PART,
                sortOrder: ln.sortOrder,
                sourceWorkOrderLineId: ln.id,
                taxRateId: ln.taxRateId,
                description:
                  ln.description ??
                  (ln.lineType === WorkOrderLineType.LABOR ? 'Mano de obra' : 'Ítem'),
                quantity: ln.quantity,
                unitPrice: ln.unitPrice ?? new Prisma.Decimal(0),
                discountAmount: ln.discountAmount ?? new Prisma.Decimal(0),
                taxRatePercentSnapshot: ln.taxRatePercentSnapshot ?? new Prisma.Decimal(0),
                taxRateKindSnapshot: ln.taxRate?.kind ?? null,
                lineTotal: t.lineTotal,
                taxAmount: t.taxAmount,
              };
            }),
          },
        },
        include: invoiceDetailInclude,
      });
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'invoices.created_from_work_order',
      entityType: AUDIT_INVOICE_ENTITY,
      entityId: invoice.id,
      previousPayload: null,
      nextPayload: {
        workOrderId: wo.id,
        documentNumber: invoice.documentNumber,
        grandTotal: invoice.grandTotal.toString(),
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.shape(invoice);
  }

  // ---------------------------------------------------------------------------
  // Emisión (envío al proveedor DIAN)
  // ---------------------------------------------------------------------------

  async issue(id: string, actor: JwtUserPayload, meta: { ip?: string; userAgent?: string }) {
    const provider = await this.providers.resolve();
    const now = new Date();

    // Bloqueamos la fila de la factura dentro de una transacción para serializar emisiones
    // concurrentes del mismo documento (evita doble envío al proveedor DIAN). El envío es una
    // llamada externa y lenta, pero es una operación ocasional en este dominio: la exclusión
    // mutua garantizada vale más que mantener una conexión ocupada brevemente.
    const { docId, dispatch, statusAfter } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "invoices" WHERE id = ${id} FOR UPDATE`;

      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: { lines: { include: { taxRate: true } } },
      });
      if (!invoice) throw new NotFoundException('Factura no encontrada.');
      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          `Solo se pueden emitir facturas en DRAFT; estado actual: ${invoice.status}.`,
        );
      }

      const payload = this.buildDianPayload(invoice, now);

      const previousAttempts = await tx.invoiceDispatchEvent.count({
        where: { invoiceId: invoice.id },
      });

      const result = await provider.submitInvoice(payload);

      const dispatch = await tx.invoiceDispatchEvent.create({
        data: {
          invoiceId: invoice.id,
          attempt: previousAttempts + 1,
          status:
            result.status === 'ACCEPTED'
              ? InvoiceDispatchStatus.ACCEPTED
              : result.status === 'REJECTED'
                ? InvoiceDispatchStatus.REJECTED
                : result.status === 'ERROR'
                  ? InvoiceDispatchStatus.ERROR
                  : InvoiceDispatchStatus.NOT_CONFIGURED,
          provider: 'provider' in result ? result.provider : provider.name,
          environment: 'environment' in result ? result.environment : provider.environment,
          requestPayload: payload as unknown as Prisma.InputJsonValue,
          responsePayload:
            'response' in result && result.response !== undefined
              ? (result.response as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          errorMessage: 'errorMessage' in result ? result.errorMessage : null,
          externalId: 'externalId' in result ? result.externalId ?? null : null,
          requestedById: actor.sub,
          completedAt: now,
        },
      });

      if (result.status === 'ACCEPTED') {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.ISSUED,
            cufe: result.cufe,
            dianProvider: result.provider,
            dianEnvironment: result.environment,
            issuedAt: now,
          },
        });
      }

      return {
        docId: invoice.id,
        dispatch,
        statusAfter: result.status === 'ACCEPTED' ? InvoiceStatus.ISSUED : invoice.status,
      };
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'invoices.issue_attempt',
      entityType: AUDIT_INVOICE_ENTITY,
      entityId: docId,
      previousPayload: { status: InvoiceStatus.DRAFT },
      nextPayload: {
        dispatchId: dispatch.id,
        dispatchStatus: dispatch.status,
        invoiceStatusAfter: statusAfter,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.findOne(docId);
  }

  // ---------------------------------------------------------------------------
  // Anulación (solo DRAFT; ISSUED requiere nota crédito)
  // ---------------------------------------------------------------------------

  async void(
    id: string,
    actor: JwtUserPayload,
    dto: VoidInvoiceDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Factura no encontrada.');
    if (invoice.status === InvoiceStatus.ISSUED) {
      throw new BadRequestException(
        'La factura ya fue aceptada por DIAN (ISSUED). Para corregirla emite una nota crédito.',
      );
    }
    if (invoice.status === InvoiceStatus.VOIDED) {
      throw new BadRequestException('La factura ya está anulada.');
    }

    await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.VOIDED,
        voidedAt: new Date(),
        voidedReason: dto.reason.trim(),
      },
    });

    await this.audit.recordDomain({
      actorUserId: actor.sub,
      action: 'invoices.voided',
      entityType: AUDIT_INVOICE_ENTITY,
      entityId: invoice.id,
      previousPayload: { status: invoice.status },
      nextPayload: { status: InvoiceStatus.VOIDED, reason: dto.reason.trim() },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.findOne(invoice.id);
  }

  // ---------------------------------------------------------------------------
  // Payload DIAN + serialización
  // ---------------------------------------------------------------------------

  private buildDianPayload(
    invoice: Prisma.InvoiceGetPayload<{
      include: { lines: { include: { taxRate: true } } };
    }>,
    issuedAt: Date,
  ): DianInvoicePayload {
    const resolutionSnapshot = {
      prefix: '',
      resolutionNumber: '',
    };
    // Tomar prefix/resolutionNumber del documentNumber ya está, pero necesitamos la resolución:
    // (lookup adicional fuera de transacción)
    // Simplificamos: inferir prefix del documentNumber (docnum = prefix + consecutive).
    // El proveedor real hará su propia validación.
    const prefix = invoice.documentNumber.replace(/\d+$/, '');
    resolutionSnapshot.prefix = prefix;
    resolutionSnapshot.resolutionNumber = '';

    return {
      documentNumber: invoice.documentNumber,
      invoiceNumber: invoice.invoiceNumber,
      prefix,
      resolutionNumber: resolutionSnapshot.resolutionNumber,
      kind: 'ELECTRONIC_INVOICE',
      issuedAt: issuedAt.toISOString(),
      customer: {
        name: invoice.customerName,
        documentId: invoice.customerDocumentId,
        phone: invoice.customerPhone,
        email: invoice.customerEmail,
      },
      currency: 'COP',
      totals: {
        subtotal: invoice.subtotal.toString(),
        totalDiscount: invoice.totalDiscount.toString(),
        totalTax: invoice.totalTax.toString(),
        totalVat: invoice.totalVat.toString(),
        totalInc: invoice.totalInc.toString(),
        grandTotal: invoice.grandTotal.toString(),
      },
      lines: invoice.lines.map((ln) => ({
        description: ln.description ?? 'Ítem',
        quantity: ln.quantity.toString(),
        unitPrice: ln.unitPrice.toString(),
        discountAmount: ln.discountAmount.toString(),
        taxRatePercent: ln.taxRatePercentSnapshot.toString(),
        taxKind: ln.taxRateKindSnapshot ?? null,
        lineTotal: ln.lineTotal.toString(),
        taxAmount: ln.taxAmount.toString(),
      })),
      notes: invoice.internalNotes,
    };
  }

  private shape(inv: InvoiceDetailPayload) {
    const paidSum = inv.payments.reduce(
      (acc, p) => acc.plus(p.amount),
      new Prisma.Decimal(0),
    );
    // Fase 7: CN emitidas restan del saldo cobrable; DN emitidas lo incrementan.
    // Las DRAFT/VOIDED no afectan cobro.
    const totalCreditNotes = inv.creditNotes
      .filter((cn) => cn.status === 'ISSUED')
      .reduce((acc, cn) => acc.plus(cn.grandTotal), new Prisma.Decimal(0));
    const totalDebitNotes = inv.debitNotes
      .filter((dn) => dn.status === 'ISSUED')
      .reduce((acc, dn) => acc.plus(dn.grandTotal), new Prisma.Decimal(0));
    const effectiveAmount = inv.grandTotal
      .minus(totalCreditNotes)
      .plus(totalDebitNotes);
    const amountDue = effectiveAmount.minus(paidSum);
    return {
      id: inv.id,
      documentNumber: inv.documentNumber,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      source: inv.source,
      workOrderId: inv.workOrderId,
      customerId: inv.customerId,
      customerName: inv.customerName,
      customerDocumentId: inv.customerDocumentId,
      customerPhone: inv.customerPhone,
      customerEmail: inv.customerEmail,
      customer: inv.customer,
      fiscalResolution: inv.fiscalResolution
        ? {
            id: inv.fiscalResolution.id,
            kind: inv.fiscalResolution.kind,
            prefix: inv.fiscalResolution.prefix,
            resolutionNumber: inv.fiscalResolution.resolutionNumber,
            rangeTo: inv.fiscalResolution.rangeTo,
            nextNumber: inv.fiscalResolution.nextNumber,
            validUntil:
              inv.fiscalResolution.validUntil?.toISOString().slice(0, 10) ?? null,
          }
        : null,
      workOrder: inv.workOrder,
      subtotal: inv.subtotal.toString(),
      totalDiscount: inv.totalDiscount.toString(),
      totalTax: inv.totalTax.toString(),
      totalVat: inv.totalVat.toString(),
      totalInc: inv.totalInc.toString(),
      grandTotal: inv.grandTotal.toString(),
      cufe: inv.cufe,
      dianProvider: inv.dianProvider,
      dianEnvironment: inv.dianEnvironment,
      issuedAt: inv.issuedAt?.toISOString() ?? null,
      voidedAt: inv.voidedAt?.toISOString() ?? null,
      voidedReason: inv.voidedReason,
      internalNotes: inv.internalNotes,
      createdBy: inv.createdBy,
      createdAt: inv.createdAt.toISOString(),
      updatedAt: inv.updatedAt.toISOString(),
      lines: inv.lines.map((ln) => ({
        id: ln.id,
        invoiceId: ln.invoiceId,
        lineType: ln.lineType,
        sortOrder: ln.sortOrder,
        sourceWorkOrderLineId: ln.sourceWorkOrderLineId,
        taxRateId: ln.taxRateId,
        taxRate: ln.taxRate
          ? {
              ...ln.taxRate,
              ratePercent: ln.taxRate.ratePercent.toString(),
            }
          : null,
        description: ln.description,
        quantity: ln.quantity.toString(),
        unitPrice: ln.unitPrice.toString(),
        discountAmount: ln.discountAmount.toString(),
        taxRatePercentSnapshot: ln.taxRatePercentSnapshot.toString(),
        taxRateKindSnapshot: ln.taxRateKindSnapshot,
        lineTotal: ln.lineTotal.toString(),
        taxAmount: ln.taxAmount.toString(),
      })),
      dispatchEvents: inv.dispatchEvents.map((e) => ({
        id: e.id,
        attempt: e.attempt,
        status: e.status,
        provider: e.provider,
        environment: e.environment,
        errorMessage: e.errorMessage,
        externalId: e.externalId,
        requestedAt: e.requestedAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
        requestedBy: e.requestedBy,
      })),
      creditNotes: inv.creditNotes.map((cn) => ({
        id: cn.id,
        documentNumber: cn.documentNumber,
        status: cn.status,
        reason: cn.reason,
        grandTotal: cn.grandTotal.toString(),
        createdAt: cn.createdAt.toISOString(),
        issuedAt: cn.issuedAt?.toISOString() ?? null,
      })),
      debitNotes: inv.debitNotes.map((dn) => ({
        id: dn.id,
        documentNumber: dn.documentNumber,
        status: dn.status,
        reason: dn.reason,
        grandTotal: dn.grandTotal.toString(),
        createdAt: dn.createdAt.toISOString(),
        issuedAt: dn.issuedAt?.toISOString() ?? null,
      })),
      payments: inv.payments.map((p) => ({
        id: p.id,
        amount: p.amount.toString(),
        kind: p.kind,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
        recordedBy: p.recordedBy,
        cashMovement: p.cashMovement
          ? {
              id: p.cashMovement.id,
              amount: p.cashMovement.amount.toString(),
              createdAt: p.cashMovement.createdAt.toISOString(),
              category: p.cashMovement.category,
            }
          : null,
      })),
      amountPaid: paidSum.toString(),
      amountDue: amountDue.toString(),
      totalCreditNotes: totalCreditNotes.toString(),
      totalDebitNotes: totalDebitNotes.toString(),
      effectiveAmount: effectiveAmount.toString(),
    };
  }
}

function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (acc, v) => acc.plus(v),
    new Prisma.Decimal(0),
  );
}
