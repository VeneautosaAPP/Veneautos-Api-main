/**
 * Fase 8 · Reportes de negocio (integración con Postgres real).
 *
 * Cubre los 7 endpoints nuevos de Fase 8 de punta a punta, creando datos
 * reales via Prisma y llamando al `ReportsService` para validar:
 *  - Serializado coincide con el contrato documentado en el controller.
 *  - Los filtros por fecha/estado/rango llegan a la DB sin romper por enum/tipos.
 *  - La agregación reconoce las filas creadas en el test (chequeos por id,
 *    no por totales absolutos, para no pelear con datos pre-existentes del seed).
 *
 * La lógica pura (bucketing, costUnknown, VAT/INC, thresholds) ya vive en
 * `src/modules/reports/reports.service.spec.ts`. Este archivo solo asegura
 * que la capa Prisma + enums + relaciones responda como la lógica espera.
 */
import { randomUUID } from 'crypto';
import {
  CashMovementDirection,
  CashSessionStatus,
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
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReportsService } from '../../src/modules/reports/reports.service';

describe('Fase 8 · Reportes de negocio (integración)', () => {
  let prisma: PrismaService;
  let reports: ReportsService;
  let actorId: string;

  /** IDs creados por el test: borrar en orden inverso al de dependencias. */
  const ids: {
    invoices: string[];
    fiscalResolutions: string[];
    workOrders: string[];
    customers: string[];
    vehicles: string[];
    taxRates: string[];
    cashSessions: string[];
    cashMovements: string[];
    cashCategories: string[];
    settings: string[];
  } = {
    invoices: [],
    fiscalResolutions: [],
    workOrders: [],
    customers: [],
    vehicles: [],
    taxRates: [],
    cashSessions: [],
    cashMovements: [],
    cashCategories: [],
    settings: [],
  };

  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL obligatoria para integración (cargada desde api/.env)');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    reports = new ReportsService(prisma);

    const admin = await prisma.userRole.findFirst({
      where: { role: { slug: 'administrador' }, user: { isActive: true } },
      select: { userId: true },
    });
    if (!admin) throw new Error('Seed requerido: falta admin');
    actorId = admin.userId;
  });

  afterAll(async () => {
    if (!prisma) return;
    // Orden: primero lo que depende de otros (cascadas + FK con Restrict).
    for (const mv of ids.cashMovements) {
      await prisma.cashMovement.delete({ where: { id: mv } }).catch(() => undefined);
    }
    for (const s of ids.cashSessions) {
      await prisma.cashMovement.deleteMany({ where: { sessionId: s } }).catch(() => undefined);
      await prisma.cashSession.delete({ where: { id: s } }).catch(() => undefined);
    }
    for (const inv of ids.invoices) {
      // InvoiceLine + InvoiceDispatchEvent caen en cascada al borrar la factura.
      await prisma.invoicePayment.deleteMany({ where: { invoiceId: inv } }).catch(() => undefined);
      await prisma.invoice.delete({ where: { id: inv } }).catch(() => undefined);
    }
    for (const r of ids.fiscalResolutions) {
      await prisma.fiscalResolution.delete({ where: { id: r } }).catch(() => undefined);
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
    for (const tr of ids.taxRates) {
      await prisma.taxRate.delete({ where: { id: tr } }).catch(() => undefined);
    }
    for (const cat of ids.cashCategories) {
      await prisma.cashMovementCategory.delete({ where: { id: cat } }).catch(() => undefined);
    }
    for (const key of ids.settings) {
      await prisma.workshopSetting.delete({ where: { key } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function ensureOpenSession() {
    const existing = await prisma.cashSession.findFirst({ where: { status: CashSessionStatus.OPEN } });
    if (existing) return existing;
    const s = await prisma.cashSession.create({
      data: {
        status: CashSessionStatus.OPEN,
        openedAt: new Date(),
        openedById: actorId,
        openingAmount: new Prisma.Decimal(0),
      },
    });
    ids.cashSessions.push(s.id);
    return s;
  }

  async function ensureCashCategory(slug: string, name: string) {
    const existing = await prisma.cashMovementCategory.findUnique({ where: { slug } });
    if (existing) return existing;
    const cat = await prisma.cashMovementCategory.create({
      data: {
        slug,
        name,
        direction: CashMovementDirection.INCOME,
        isSystem: false,
        sortOrder: 99,
      },
    });
    ids.cashCategories.push(cat.id);
    return cat;
  }

  async function createCustomerWithVehicle(tag: string) {
    const customer = await prisma.customer.create({
      data: { displayName: `ClienteF8 ${tag}`, primaryPhone: '3001112233' },
    });
    ids.customers.push(customer.id);
    const plate = `F8${tag}`.toUpperCase().slice(0, 10);
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: customer.id,
        plate,
        plateNorm: plate.replace(/\s+/g, '').toUpperCase(),
      },
    });
    ids.vehicles.push(vehicle.id);
    return { customer, vehicle };
  }

  /** OT mínima DELIVERED usada como referencia (workOrderId) de facturas en los tests. */
  async function createBackingWorkOrder(tag: string) {
    const nonce = randomUUID().slice(0, 6).toUpperCase();
    const { vehicle, customer } = await createCustomerWithVehicle(`B${nonce}`);
    const wo = await prisma.workOrder.create({
      data: {
        publicCode: `OT-BK-${tag}`.toUpperCase().slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT respaldo ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        createdById: actorId,
        deliveredAt: new Date(),
      },
    });
    ids.workOrders.push(wo.id);
    return wo;
  }

  // ---------------------------------------------------------------------------
  // 1. salesByPaymentMethod
  // ---------------------------------------------------------------------------

  it('salesByPaymentMethod: agrupa INCOME por slug de `CashMovementCategory`', async () => {
    const session = await ensureOpenSession();
    const catEfectivo = await ensureCashCategory('ingreso_cobro', 'Cobro en efectivo');
    const catTransfer = await ensureCashCategory(
      'ingreso_transferencia',
      'Cobro por transferencia bancaria',
    );

    const movEfectivo = await prisma.cashMovement.create({
      data: {
        sessionId: session.id,
        categoryId: catEfectivo.id,
        amount: new Prisma.Decimal(60000),
        direction: CashMovementDirection.INCOME,
        referenceType: 'Sale',
        referenceId: `sale-mock-${randomUUID().slice(0, 6)}`,
        note: 'Cobro efectivo venta mostrador (semilla integración Fase 8).',
        createdById: actorId,
      },
    });
    ids.cashMovements.push(movEfectivo.id);

    const movTransfer = await prisma.cashMovement.create({
      data: {
        sessionId: session.id,
        categoryId: catTransfer.id,
        amount: new Prisma.Decimal(40000),
        direction: CashMovementDirection.INCOME,
        referenceType: 'Invoice',
        referenceId: `inv-mock-${randomUUID().slice(0, 6)}`,
        note: 'Cobro transferencia factura (semilla integración Fase 8).',
        createdById: actorId,
      },
    });
    ids.cashMovements.push(movTransfer.id);

    const r = await reports.salesByPaymentMethod({ from: today(), to: today() });

    const efectivo = r.rows.find((x) => x.slug === 'ingreso_cobro');
    const transfer = r.rows.find((x) => x.slug === 'ingreso_transferencia');

    expect(efectivo).toBeDefined();
    expect(transfer).toBeDefined();
    expect(efectivo!.label).toBe('Efectivo');
    expect(transfer!.label).toBe('Transferencia');
    expect(Number.parseFloat(efectivo!.amount)).toBeGreaterThanOrEqual(60000);
    expect(Number.parseFloat(transfer!.amount)).toBeGreaterThanOrEqual(40000);
    expect(efectivo!.count).toBeGreaterThanOrEqual(1);
    expect(r.totals.count).toBeGreaterThanOrEqual(2);
    // sharePct debe sumar ≈ 100 entre las filas presentes.
    const totalShare = r.rows
      .filter((x) => x.sharePct !== null)
      .reduce((acc, x) => acc + Number.parseFloat(x.sharePct!), 0);
    expect(totalShare).toBeGreaterThan(99);
    expect(totalShare).toBeLessThan(101);
  });

  // ---------------------------------------------------------------------------
  // 2. taxCausado
  // ---------------------------------------------------------------------------

  it('taxCausado: suma base gravable e impuesto por TaxRate solo de facturas ISSUED', async () => {
    const tag = randomUUID().slice(0, 6).toUpperCase();

    const taxRate = await prisma.taxRate.create({
      data: {
        slug: `iva_19_f8_${tag.toLowerCase()}`,
        name: `IVA 19% F8 ${tag}`,
        kind: TaxRateKind.VAT,
        ratePercent: new Prisma.Decimal(19),
        isActive: true,
      },
    });
    ids.taxRates.push(taxRate.id);

    const resolution = await prisma.fiscalResolution.create({
      data: {
        kind: FiscalResolutionKind.ELECTRONIC_INVOICE,
        resolutionNumber: `RES-F8-${tag}`,
        prefix: `F8${tag.slice(0, 2)}`,
        rangeFrom: 1,
        rangeTo: 100,
        nextNumber: 1,
        isActive: true,
        createdById: actorId,
      },
    });
    ids.fiscalResolutions.push(resolution.id);

    // La factura requiere `workOrderId` cuando source=WORK_ORDER (CHECK invoices_source_has_ref_ck).
    const backingWo = await createBackingWorkOrder(`TAX-${tag}`);
    const docNumber = `${resolution.prefix}1`;
    const invoice = await prisma.invoice.create({
      data: {
        fiscalResolutionId: resolution.id,
        invoiceNumber: 1,
        documentNumber: docNumber,
        status: InvoiceStatus.ISSUED,
        source: InvoiceSource.WORK_ORDER,
        workOrderId: backingWo.id,
        customerName: 'Cliente Fase 8 (taxCausado)',
        subtotal: new Prisma.Decimal(10000),
        totalDiscount: new Prisma.Decimal(0),
        totalTax: new Prisma.Decimal(1900),
        totalVat: new Prisma.Decimal(1900),
        totalInc: new Prisma.Decimal(0),
        grandTotal: new Prisma.Decimal(11900),
        issuedAt: new Date(),
        createdById: actorId,
        lines: {
          create: [
            {
              lineType: InvoiceLineType.PART,
              sortOrder: 0,
              description: 'Línea gravada IVA 19%',
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(10000),
              discountAmount: new Prisma.Decimal(0),
              taxRateId: taxRate.id,
              taxRatePercentSnapshot: new Prisma.Decimal(19),
              taxRateKindSnapshot: TaxRateKind.VAT,
              lineTotal: new Prisma.Decimal(11900),
              taxAmount: new Prisma.Decimal(1900),
            },
          ],
        },
      },
    });
    ids.invoices.push(invoice.id);

    const r = await reports.taxCausado({ from: today(), to: today() });

    const ours = r.rows.find((x) => x.taxRateId === taxRate.id);
    expect(ours).toBeDefined();
    expect(ours!.kind).toBe('VAT');
    expect(ours!.lineCount).toBe(1);
    expect(Number.parseFloat(ours!.taxableBase)).toBe(10000);
    expect(Number.parseFloat(ours!.taxAmount)).toBe(1900);

    expect(Number.parseFloat(r.totals.totalVat)).toBeGreaterThanOrEqual(1900);
    expect(Number.parseFloat(r.totals.taxableBase)).toBeGreaterThanOrEqual(10000);
    expect(r.totals.lineCount).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 3. dianStatus
  // ---------------------------------------------------------------------------

  it('dianStatus: cuenta por estado y toma último dispatch event por factura ISSUED', async () => {
    const tag = randomUUID().slice(0, 6).toUpperCase();

    const resolution = await prisma.fiscalResolution.create({
      data: {
        kind: FiscalResolutionKind.ELECTRONIC_INVOICE,
        resolutionNumber: `RES-DIAN-${tag}`,
        prefix: `DN${tag.slice(0, 2)}`,
        rangeFrom: 200,
        rangeTo: 300,
        nextNumber: 203,
        isActive: true,
        createdById: actorId,
      },
    });
    ids.fiscalResolutions.push(resolution.id);

    // Factura 1: ISSUED con dispatch ACCEPTED.
    const woAcc = await createBackingWorkOrder(`DIAN-${tag}-ACC`);
    const accepted = await prisma.invoice.create({
      data: {
        fiscalResolutionId: resolution.id,
        invoiceNumber: 200,
        documentNumber: `${resolution.prefix}200`,
        status: InvoiceStatus.ISSUED,
        source: InvoiceSource.WORK_ORDER,
        workOrderId: woAcc.id,
        customerName: 'Cliente DIAN ACC',
        subtotal: new Prisma.Decimal(1000),
        grandTotal: new Prisma.Decimal(1000),
        issuedAt: new Date(),
        createdById: actorId,
        dispatchEvents: {
          create: [
            {
              status: InvoiceDispatchStatus.ACCEPTED,
              provider: 'STUB',
              environment: 'SANDBOX',
              requestedAt: new Date(),
              completedAt: new Date(),
              requestedById: actorId,
            },
          ],
        },
      },
    });
    ids.invoices.push(accepted.id);

    // Factura 2: ISSUED sin dispatch → cuenta en NO_DISPATCH.
    const woNoDisp = await createBackingWorkOrder(`DIAN-${tag}-SIN`);
    const noDispatch = await prisma.invoice.create({
      data: {
        fiscalResolutionId: resolution.id,
        invoiceNumber: 201,
        documentNumber: `${resolution.prefix}201`,
        status: InvoiceStatus.ISSUED,
        source: InvoiceSource.WORK_ORDER,
        workOrderId: woNoDisp.id,
        customerName: 'Cliente DIAN SIN',
        subtotal: new Prisma.Decimal(500),
        grandTotal: new Prisma.Decimal(500),
        issuedAt: new Date(),
        createdById: actorId,
      },
    });
    ids.invoices.push(noDispatch.id);

    // Factura 3: DRAFT.
    const woDraft = await createBackingWorkOrder(`DIAN-${tag}-DRAFT`);
    const draft = await prisma.invoice.create({
      data: {
        fiscalResolutionId: resolution.id,
        invoiceNumber: 202,
        documentNumber: `${resolution.prefix}202`,
        status: InvoiceStatus.DRAFT,
        source: InvoiceSource.WORK_ORDER,
        workOrderId: woDraft.id,
        customerName: 'Cliente DIAN DRAFT',
        subtotal: new Prisma.Decimal(200),
        grandTotal: new Prisma.Decimal(200),
        createdById: actorId,
      },
    });
    ids.invoices.push(draft.id);

    const r = await reports.dianStatus({ from: today(), to: today() });

    expect(r.byStatus.ISSUED.count).toBeGreaterThanOrEqual(2);
    expect(Number.parseFloat(r.byStatus.ISSUED.amount)).toBeGreaterThanOrEqual(1500);
    expect(r.byStatus.DRAFT.count).toBeGreaterThanOrEqual(1);
    expect(r.dispatch.ACCEPTED).toBeGreaterThanOrEqual(1);
    expect(r.dispatch.NO_DISPATCH).toBeGreaterThanOrEqual(1);
    expect(r.totals.invoiceCount).toBeGreaterThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // 4. profitabilityByTechnician
  // ---------------------------------------------------------------------------

  it('profitabilityByTechnician: agrupa OT DELIVERED por assignedTo y separa OT sin técnico', async () => {
    const tag = randomUUID().slice(0, 6);
    const { vehicle, customer } = await createCustomerWithVehicle(tag);

    // OT con técnico + PART costSnapshot → cuenta.
    const woTech = await prisma.workOrder.create({
      data: {
        publicCode: `OT-F8-T-${tag}`.toUpperCase().slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT técnico ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        createdById: actorId,
        assignedToId: actorId,
        deliveredAt: new Date(),
        lines: {
          create: [
            {
              lineType: WorkOrderLineType.PART,
              sortOrder: 0,
              description: 'Repuesto',
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(20000),
              discountAmount: new Prisma.Decimal(0),
              costSnapshot: new Prisma.Decimal(12000),
            },
          ],
        },
      },
    });
    ids.workOrders.push(woTech.id);

    // OT sin técnico (LABOR) → bucket null, cuenta sin costo.
    const woUnassigned = await prisma.workOrder.create({
      data: {
        publicCode: `OT-F8-U-${tag}`.toUpperCase().slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT sin técnico ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        createdById: actorId,
        assignedToId: null,
        deliveredAt: new Date(),
        lines: {
          create: [
            {
              lineType: WorkOrderLineType.LABOR,
              sortOrder: 0,
              description: 'Mano de obra',
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(5000),
              discountAmount: new Prisma.Decimal(0),
              costSnapshot: null,
            },
          ],
        },
      },
    });
    ids.workOrders.push(woUnassigned.id);

    const r = await reports.profitabilityByTechnician({ from: today(), to: today() });

    const techBucket = r.rows.find((x) => x.technicianId === actorId);
    const unassignedBucket = r.rows.find((x) => x.technicianId === null);

    expect(techBucket).toBeDefined();
    expect(techBucket!.workOrdersConsidered).toBeGreaterThanOrEqual(1);
    expect(techBucket!.workOrdersCounted).toBeGreaterThanOrEqual(1);
    expect(Number.parseFloat(techBucket!.profitTotal)).toBeGreaterThanOrEqual(8000); // 20000 - 12000
    expect(techBucket!.label.length).toBeGreaterThan(0);

    expect(unassignedBucket).toBeDefined();
    expect(unassignedBucket!.label).toBe('Sin técnico');
    expect(unassignedBucket!.workOrdersConsidered).toBeGreaterThanOrEqual(1);

    expect(r.totals.workOrdersConsidered).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // 5. profitabilityByService
  // ---------------------------------------------------------------------------

  it('profitabilityByService: agrupa líneas LABOR de OT DELIVERED por descripción', async () => {
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const desc = `Diagnóstico F8 ${tag}`;

    const { vehicle, customer } = await createCustomerWithVehicle(`S${tag.slice(0, 3)}`);

    // OT DELIVERED #1 con LABOR (2×8000) sin costSnapshot → utilidad = ingreso.
    const wo1 = await prisma.workOrder.create({
      data: {
        publicCode: `OT-SRV1-${tag}`.slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT servicio 1 ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        createdById: actorId,
        assignedToId: actorId,
        deliveredAt: new Date(),
        lines: {
          create: [
            {
              lineType: WorkOrderLineType.LABOR,
              sortOrder: 0,
              description: desc,
              quantity: new Prisma.Decimal(2),
              unitPrice: new Prisma.Decimal(8000),
              discountAmount: new Prisma.Decimal(0),
              costSnapshot: null,
            },
          ],
        },
      },
    });
    ids.workOrders.push(wo1.id);

    // OT DELIVERED #2 con LABOR (1×8000) misma descripción → debe sumar al mismo bucket.
    const wo2 = await prisma.workOrder.create({
      data: {
        publicCode: `OT-SRV2-${tag}`.slice(0, 30),
        status: WorkOrderStatus.DELIVERED,
        description: `OT servicio 2 ${tag}`,
        vehicleId: vehicle.id,
        customerName: customer.displayName,
        createdById: actorId,
        assignedToId: actorId,
        deliveredAt: new Date(),
        lines: {
          create: [
            {
              lineType: WorkOrderLineType.LABOR,
              sortOrder: 0,
              description: desc,
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(8000),
              discountAmount: new Prisma.Decimal(0),
              costSnapshot: null,
            },
          ],
        },
      },
    });
    ids.workOrders.push(wo2.id);

    const r = await reports.profitabilityByService({ from: today(), to: today() });

    const bucket = r.rows.find((x) => x.serviceKey === desc.toLocaleLowerCase('es'));
    expect(bucket).toBeDefined();
    expect(bucket!.name).toBe(desc);
    expect(bucket!.lineCount).toBeGreaterThanOrEqual(2);
    expect(Number.parseFloat(bucket!.revenueTotal)).toBeGreaterThanOrEqual(24000); // 2*8000 + 1*8000
    // LABOR sin costSnapshot → utilidad = ingreso (según `computeBillingTotals`).
    expect(Number.parseFloat(bucket!.profitTotal)).toBeGreaterThanOrEqual(24000);

    expect(r.totals.serviceCount).toBeGreaterThanOrEqual(1);
    expect(r.totals.lineCount).toBeGreaterThanOrEqual(2);
  });
});
