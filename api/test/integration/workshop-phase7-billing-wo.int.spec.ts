/**
 * Fase 5 · Facturación desde OT + Pagos de factura en caja.
 *
 * Verifica:
 *  - `createFromWorkOrder`: OT DELIVERED genera factura DRAFT con snapshot de líneas + cliente.
 *  - Duplicado bloqueado: una segunda factura viva para la misma OT se rechaza.
 *  - OT en estado != DELIVERED no se puede facturar.
 *  - Pago de factura: crea `InvoicePayment` 1:1 con `CashMovement` (ingreso); valida saldo.
 *  - Pago parcial deja saldo pendiente; pago final liquida la factura.
 */
import { randomUUID } from 'crypto';
import {
  CashMovementDirection,
  CashSessionStatus,
  FiscalResolutionKind,
  InvoicePaymentKind,
  InvoiceStatus,
  Prisma,
  WorkOrderStatus,
} from '@prisma/client';
import { DianProviderFactory } from '../../src/common/dian/dian-provider.factory';
import { NotesPolicyService } from '../../src/common/notes-policy/notes-policy.service';
import { FiscalResolutionsService } from '../../src/modules/billing/fiscal-resolutions.service';
import { InvoiceNumberingService } from '../../src/modules/billing/invoice-numbering.service';
import { InvoicePaymentsService } from '../../src/modules/billing/invoice-payments.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { CreditNotesService } from '../../src/modules/billing/credit-notes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { JwtUserPayload } from '../../src/modules/auth/types/jwt-user.payload';

describe('Phase 7 · Billing OT + pagos (integración)', () => {
  let prisma: PrismaService;
  let actorId: string;
  let resolutions: FiscalResolutionsService;
  let numbering: InvoiceNumberingService;
  let invoices: InvoicesService;
  let payments: InvoicePaymentsService;
  const audit = { recordDomain: jest.fn().mockResolvedValue(undefined) };

  const ids: {
    resolutions: string[];
    invoices: string[];
    workOrders: string[];
    customers: string[];
    vehicles: string[];
    cashSessions: string[];
  } = {
    resolutions: [],
    invoices: [],
    workOrders: [],
    customers: [],
    vehicles: [],
    cashSessions: [],
  };

  const actor: () => JwtUserPayload = () => ({
    sub: actorId,
    sid: 'integration',
    email: 'int@test',
    fullName: 'Integration',
    permissions: [
      'invoices:read',
      'invoices:create',
      'invoices:issue',
      'invoices:void',
      'invoices:record_payment',
      'fiscal_resolutions:manage',
      'cash_movements:create_income',
    ],
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL obligatoria para integración');
    }
    prisma = new PrismaService();
    await prisma.$connect();

    const adminMembership = await prisma.userRole.findFirst({
      where: { role: { slug: 'administrador' }, user: { isActive: true } },
      select: { userId: true },
    });
    if (!adminMembership) throw new Error('Seed requerido: falta admin');
    actorId = adminMembership.userId;

    resolutions = new FiscalResolutionsService(prisma, audit as never);
    numbering = new InvoiceNumberingService(prisma);
    const providerFactory = new DianProviderFactory(prisma);
    invoices = new InvoicesService(prisma, audit as never, numbering, providerFactory);
    new CreditNotesService(prisma, audit as never, numbering, providerFactory);
    const notes = new NotesPolicyService(prisma);
    payments = new InvoicePaymentsService(prisma, audit as never, notes);
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const inv of ids.invoices) {
      await prisma.invoicePayment.deleteMany({ where: { invoiceId: inv } }).catch(() => undefined);
      await prisma.invoiceDispatchEvent
        .deleteMany({ where: { invoiceId: inv } })
        .catch(() => undefined);
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: inv } }).catch(() => undefined);
      await prisma.invoice.delete({ where: { id: inv } }).catch(() => undefined);
    }
    for (const wo of ids.workOrders) {
      await prisma.workOrderLine.deleteMany({ where: { workOrderId: wo } }).catch(() => undefined);
      await prisma.workOrder.delete({ where: { id: wo } }).catch(() => undefined);
    }
    for (const v of ids.vehicles) {
      await prisma.vehicle.delete({ where: { id: v } }).catch(() => undefined);
    }
    for (const c of ids.customers) {
      await prisma.customer.delete({ where: { id: c } }).catch(() => undefined);
    }
    for (const r of ids.resolutions) {
      await prisma.fiscalResolution.delete({ where: { id: r } }).catch(() => undefined);
    }
    for (const s of ids.cashSessions) {
      await prisma.cashMovement.deleteMany({ where: { sessionId: s } }).catch(() => undefined);
      await prisma.cashSession.delete({ where: { id: s } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  async function ensureResolution() {
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const res = await resolutions.create(
      actor(),
      {
        kind: FiscalResolutionKind.ELECTRONIC_INVOICE,
        resolutionNumber: `RES-WO-${tag}`,
        prefix: `W${tag}`,
        rangeFrom: 1,
        rangeTo: 100,
        isDefault: true,
      },
      {},
    );
    ids.resolutions.push(res.id);
    return res;
  }

  async function createDeliveredWorkOrder(options: { lines: number; unitPrice?: number; quantity?: number }) {
    const tag = randomUUID().slice(0, 8);
    const customer = await prisma.customer.create({
      data: { displayName: `Cliente OT ${tag}`, primaryPhone: '3001112222', documentId: `10${tag}` },
    });
    ids.customers.push(customer.id);

    const plate = `OT${tag.slice(0, 6)}`.toUpperCase().slice(0, 10);
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: customer.id,
        plate,
        plateNorm: plate.replace(/\s+/g, '').toUpperCase(),
      },
    });
    ids.vehicles.push(vehicle.id);

    const wo = await prisma.workOrder.create({
      data: {
        publicCode: `OT-TEST-${tag.toUpperCase()}`.slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT de prueba ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        customerPhone: '3001112222',
        customerEmail: `ot-${tag}@test.local`,
        createdById: actorId,
        deliveredAt: new Date(),
        lines: {
          create: Array.from({ length: options.lines }).map((_, i) => ({
            lineType: i % 2 === 0 ? 'PART' : 'LABOR',
            sortOrder: i,
            description: `Línea ${i + 1}`,
            quantity: new Prisma.Decimal(options.quantity ?? 1),
            unitPrice: new Prisma.Decimal(options.unitPrice ?? 1000),
            discountAmount: new Prisma.Decimal(0),
          })),
        },
      },
    });
    ids.workOrders.push(wo.id);
    return wo;
  }

  it('factura una OT entregada: snapshot de líneas + cliente', async () => {
    await ensureResolution();
    const wo = await createDeliveredWorkOrder({ lines: 2, quantity: 2, unitPrice: 5000 });

    const invoice = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
    ids.invoices.push(invoice.id);

    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.source).toBe('WORK_ORDER');
    expect(invoice.workOrderId).toBe(wo.id);
    expect(invoice.lines).toHaveLength(2);
    expect(Number(invoice.subtotal)).toBeCloseTo(2 * 2 * 5000, 2);
    expect(Number(invoice.grandTotal)).toBeCloseTo(Number(invoice.subtotal), 2);
    expect(invoice.customerName).toBe(wo.customerName);
  });

  it('bloquea segunda factura viva contra la misma OT', async () => {
    await ensureResolution();
    const wo = await createDeliveredWorkOrder({ lines: 1, quantity: 1, unitPrice: 3000 });
    const first = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
    ids.invoices.push(first.id);

    await expect(invoices.createFromWorkOrder(wo.id, actor(), {}, {})).rejects.toThrow(
      /ya tiene una factura viva/i,
    );
  });

  it('rechaza facturar una OT no entregada', async () => {
    await ensureResolution();
    const tag = randomUUID().slice(0, 6);
    const customer = await prisma.customer.create({
      data: { displayName: `Cliente NoDel ${tag}`, primaryPhone: '3001113333' },
    });
    ids.customers.push(customer.id);
    const wo = await prisma.workOrder.create({
      data: {
        publicCode: `OT-NODEL-${tag.toUpperCase()}`.slice(0, 30),
        status: WorkOrderStatus.IN_WORKSHOP,
        description: 'OT no entregada',
        customerName: 'Tester',
        createdById: actorId,
        lines: {
          create: [
            {
              lineType: 'PART',
              sortOrder: 0,
              description: 'x',
              quantity: '1',
              unitPrice: '1000',
              discountAmount: '0',
            },
          ],
        },
      },
    });
    ids.workOrders.push(wo.id);

    await expect(invoices.createFromWorkOrder(wo.id, actor(), {}, {})).rejects.toThrow(/DELIVERED/);
  });

  describe('pagos en caja contra factura', () => {
    let sessionId: string;
    let categorySlug: string;

    beforeAll(async () => {
      // Asegura categoría de ingreso para cobros.
      const cat = await prisma.cashMovementCategory.upsert({
        where: { slug: 'ingreso_cobro' },
        create: {
          slug: 'ingreso_cobro',
          name: 'Cobro a clientes',
          direction: CashMovementDirection.INCOME,
          sortOrder: 5,
        },
        update: {},
      });
      categorySlug = cat.slug;

      // Si ya hay sesión abierta (p.ej. seed), reutilízala; si no, abre una para el test.
      const existing = await prisma.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
      });
      if (existing) {
        sessionId = existing.id;
      } else {
        const created = await prisma.cashSession.create({
          data: {
            status: CashSessionStatus.OPEN,
            openedAt: new Date(),
            openedById: actorId,
            openingAmount: new Prisma.Decimal(0),
          },
        });
        sessionId = created.id;
        ids.cashSessions.push(sessionId);
      }
    });

    it('registra abono y liquidación final sobre una factura', async () => {
      await ensureResolution();
      const wo = await createDeliveredWorkOrder({ lines: 1, quantity: 1, unitPrice: 10000 });
      const inv = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
      ids.invoices.push(inv.id);
      expect(Number(inv.grandTotal)).toBe(10000);

      const partial = await payments.record(
        inv.id,
        actor(),
        {
          paymentKind: 'partial',
          amount: '4000',
          note: 'Abono inicial del cliente al recoger vehículo: entrega en efectivo en caja principal del taller.',
          categorySlug,
        },
        {},
      );
      expect(partial.kind).toBe(InvoicePaymentKind.PARTIAL);
      expect(partial.cashMovement.sessionId).toBe(sessionId);
      expect(partial.cashMovement.direction).toBe(CashMovementDirection.INCOME);

      const detailMid = await invoices.findOne(inv.id);
      expect(detailMid.amountPaid).toBe('4000');
      expect(detailMid.amountDue).toBe('6000');

      // Intentar pago total por un monto distinto al saldo debe fallar.
      await expect(
        payments.record(
          inv.id,
          actor(),
          {
          paymentKind: 'full',
          amount: '5000',
          note: 'Intento erróneo marcado como total: valor no iguala el saldo pendiente actual.',
          categorySlug,
          },
          {},
        ),
      ).rejects.toThrow(/saldo pendiente/i);

      const final = await payments.record(
        inv.id,
        actor(),
        {
          paymentKind: 'full',
          amount: '6000',
          note: 'Liquidación del saldo al entregar factura: cliente pagó en efectivo el resto del total.',
          categorySlug,
        },
        {},
      );
      expect(final.kind).toBe(InvoicePaymentKind.FULL_SETTLEMENT);

      const detailFinal = await invoices.findOne(inv.id);
      expect(detailFinal.amountPaid).toBe('10000');
      expect(detailFinal.amountDue).toBe('0');
      expect(detailFinal.payments).toHaveLength(2);
    });

    it('rechaza pagos contra facturas anuladas', async () => {
      await ensureResolution();
      const wo = await createDeliveredWorkOrder({ lines: 1, quantity: 1, unitPrice: 4000 });
      const inv = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
      ids.invoices.push(inv.id);

      await invoices.void(inv.id, actor(), { reason: 'Cliente canceló servicio' }, {});

      await expect(
        payments.record(
          inv.id,
          actor(),
          {
            paymentKind: 'full',
            amount: '4000',
            note: 'Intento de cobro sobre factura anulada, debe ser rechazado por la política.',
            categorySlug,
          },
          {},
        ),
      ).rejects.toThrow(/anulada/i);
    });
  });
});
