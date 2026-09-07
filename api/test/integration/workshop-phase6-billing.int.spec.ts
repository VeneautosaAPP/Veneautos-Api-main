/**
 * Fase 6 · Facturación electrónica (preparación DIAN).
 *
 * Exige migraciones aplicadas + seed (usuario administrador).
 * Verifica:
 *  - Alta de resolución DIAN (ELECTRONIC_INVOICE) marcada default.
 *  - Creación de factura a partir de una OT entregada → snapshot de líneas y totales.
 *  - Intento de emisión con NoopDianProvider deja la factura en DRAFT + dispatch NOT_CONFIGURED.
 *  - Anular DRAFT está permitido; `VOIDED` bloquea segunda anulación.
 *  - `createCreditNote` contra una factura ISSUED (la marcamos manualmente) genera NC en DRAFT.
 *  - Un segundo `createFromWorkOrder` a la misma OT es rechazado mientras la factura viva exista.
 */
import { randomUUID } from 'crypto';
import {
  CreditNoteReason,
  FiscalResolutionKind,
  InvoiceStatus,
  Prisma,
  WorkOrderStatus,
} from '@prisma/client';
import { DianProviderFactory } from '../../src/common/dian/dian-provider.factory';
import { CreditNotesService } from '../../src/modules/billing/credit-notes.service';
import { FiscalResolutionsService } from '../../src/modules/billing/fiscal-resolutions.service';
import { InvoiceNumberingService } from '../../src/modules/billing/invoice-numbering.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { JwtUserPayload } from '../../src/modules/auth/types/jwt-user.payload';

describe('Phase 6 · Billing DIAN (integración)', () => {
  let prisma: PrismaService;
  let actorId: string;
  let resolutions: FiscalResolutionsService;
  let numbering: InvoiceNumberingService;
  let invoices: InvoicesService;
  let creditNotes: CreditNotesService;
  const audit = { recordDomain: jest.fn().mockResolvedValue(undefined) };

  const ids: {
    resolutions: string[];
    invoices: string[];
    creditNotes: string[];
    workOrders: string[];
    customers: string[];
    vehicles: string[];
  } = { resolutions: [], invoices: [], creditNotes: [], workOrders: [], customers: [], vehicles: [] };

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
      'credit_notes:create',
      'credit_notes:read',
      'fiscal_resolutions:read',
      'fiscal_resolutions:manage',
    ],
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL es obligatoria para tests de integración');
    }
    prisma = new PrismaService();
    await prisma.$connect();

    const adminMembership = await prisma.userRole.findFirst({
      where: { role: { slug: 'administrador' }, user: { isActive: true } },
      select: { userId: true },
    });
    if (!adminMembership) {
      throw new Error('Seed requerido: falta usuario con rol administrador');
    }
    actorId = adminMembership.userId;

    resolutions = new FiscalResolutionsService(prisma, audit as never);
    numbering = new InvoiceNumberingService(prisma);
    const providerFactory = new DianProviderFactory(prisma);
    invoices = new InvoicesService(prisma, audit as never, numbering, providerFactory);
    creditNotes = new CreditNotesService(prisma, audit as never, numbering, providerFactory);
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const cn of ids.creditNotes) {
      await prisma.creditNoteLine.deleteMany({ where: { creditNoteId: cn } }).catch(() => undefined);
      await prisma.creditNote.delete({ where: { id: cn } }).catch(() => undefined);
    }
    for (const inv of ids.invoices) {
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
    for (const vid of ids.vehicles) {
      await prisma.vehicle.delete({ where: { id: vid } }).catch(() => undefined);
    }
    for (const cid of ids.customers) {
      await prisma.customer.delete({ where: { id: cid } }).catch(() => undefined);
    }
    for (const rid of ids.resolutions) {
      await prisma.fiscalResolution.delete({ where: { id: rid } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  async function createDeliveredWorkOrder(lineCount = 1) {
    const tag = randomUUID().slice(0, 8);
    const customer = await prisma.customer.create({
      data: { displayName: `Cliente fact ${tag}`, primaryPhone: '3001111111' },
    });
    ids.customers.push(customer.id);

    const plate = `FAC${tag.slice(0, 6)}`.toUpperCase().slice(0, 10);
    const vehicle = await prisma.vehicle.create({
      data: { customerId: customer.id, plate, plateNorm: plate.replace(/\s+/g, '').toUpperCase() },
    });
    ids.vehicles.push(vehicle.id);

    const wo = await prisma.workOrder.create({
      data: {
        publicCode: `OT-FAC-${tag.toUpperCase()}`.slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT facturable ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        customerEmail: `ot-${tag}@test.local`,
        createdById: actorId,
        deliveredAt: new Date(),
        lines: {
          create: Array.from({ length: lineCount }).map((_, i) => ({
            lineType: i % 2 === 0 ? 'PART' : 'LABOR',
            sortOrder: i,
            description: `Ítem ${i + 1}`,
            quantity: new Prisma.Decimal(i % 2 === 0 ? 2 : 1),
            unitPrice: new Prisma.Decimal(i % 2 === 0 ? 1500 : 3000),
            discountAmount: new Prisma.Decimal(0),
            costSnapshot: i % 2 === 0 ? new Prisma.Decimal(900) : null,
          })),
        },
      },
    });
    ids.workOrders.push(wo.id);
    return wo;
  }

  it('registra resolución default activa y asigna consecutivos monotónicos', async () => {
    const tag = Date.now().toString(36).slice(-4).toUpperCase();
    const res = await resolutions.create(
      actor(),
      {
        kind: FiscalResolutionKind.ELECTRONIC_INVOICE,
        resolutionNumber: `RES-${tag}`,
        prefix: `F${tag}`,
        rangeFrom: 1,
        rangeTo: 100,
        isDefault: true,
      },
      {},
    );
    ids.resolutions.push(res.id);
    expect(res.nextNumber).toBe(1);
    expect(res.isDefault).toBe(true);
    expect(res.isActive).toBe(true);

    const first = await prisma.$transaction(async (tx) =>
      numbering.assignConsecutive(tx, { resolutionId: res.id }),
    );
    const second = await prisma.$transaction(async (tx) =>
      numbering.assignConsecutive(tx, { resolutionId: res.id }),
    );
    expect(first.consecutiveNumber).toBe(1);
    expect(second.consecutiveNumber).toBe(2);
    expect(second.documentNumber.startsWith(`F${tag}`)).toBe(true);

    const after = await resolutions.findOne(res.id);
    expect(after.nextNumber).toBe(3);
  });

  it('crea factura desde OT entregada: snapshot de líneas + totales consistentes', async () => {
    const wo = await createDeliveredWorkOrder(2);
    const invoice = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
    ids.invoices.push(invoice.id);

    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.workOrderId).toBe(wo.id);
    expect(invoice.lines).toHaveLength(2);
    // Línea 0: 2×1500 PART; línea 1: 1×3000 LABOR → subtotal 6000.
    expect(Number(invoice.subtotal)).toBeCloseTo(6000, 2);
    expect(Number(invoice.grandTotal)).toBeCloseTo(Number(invoice.subtotal), 2);

    // Re-facturar la misma OT mientras la factura vive está prohibido.
    await expect(
      invoices.createFromWorkOrder(wo.id, actor(), {}, {}),
    ).rejects.toThrow(/ya tiene una factura viva/i);
  });

  it('emitir con DIAN apagado deja la factura en DRAFT con dispatch NOT_CONFIGURED', async () => {
    const wo = await createDeliveredWorkOrder(1);
    const created = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
    ids.invoices.push(created.id);

    const afterIssue = await invoices.issue(created.id, actor(), {});
    expect(afterIssue.status).toBe(InvoiceStatus.DRAFT);
    expect(afterIssue.dispatchEvents).toHaveLength(1);
    expect(afterIssue.dispatchEvents[0].status).toBe('NOT_CONFIGURED');
  });

  it('anula factura en DRAFT; bloquea segunda anulación', async () => {
    const wo = await createDeliveredWorkOrder(1);
    const inv = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
    ids.invoices.push(inv.id);

    const voided = await invoices.void(inv.id, actor(), { reason: 'Cliente canceló pedido' }, {});
    expect(voided.status).toBe(InvoiceStatus.VOIDED);
    expect(voided.voidedReason).toContain('Cliente');

    await expect(
      invoices.void(inv.id, actor(), { reason: 'segundo intento' }, {}),
    ).rejects.toThrow(/ya está anulada/i);
  });

  it('emite NC contra una factura marcada ISSUED (simulación)', async () => {
    const wo = await createDeliveredWorkOrder(1);
    const inv = await invoices.createFromWorkOrder(wo.id, actor(), {}, {});
    ids.invoices.push(inv.id);

    // Simular aceptación DIAN: promover DRAFT → ISSUED directamente en BD para el test.
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: InvoiceStatus.ISSUED,
        cufe: 'test-cufe-abc123',
        dianProvider: 'noop',
        dianEnvironment: 'sandbox',
        issuedAt: new Date(),
      },
    });

    const cn = await creditNotes.createFromInvoice(
      inv.id,
      actor(),
      {
        reason: CreditNoteReason.VOID,
        reasonDescription: 'Cliente devolvió la mercadería',
      },
      {},
    );
    ids.creditNotes.push(cn.id);
    expect(cn.status).toBe('DRAFT');
    expect(cn.lines).toHaveLength(1);
    expect(Number(cn.grandTotal)).toBeGreaterThan(0);
  });
});
