import { BadRequestException } from '@nestjs/common';
import { CashMovementDirection, InvoiceStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';

/**
 * Fase 8 · Tests unitarios para los nuevos reportes. Se mockea `PrismaService` al
 * nivel mínimo necesario (sólo los métodos que cada reporte realmente usa), para
 * no depender de una base real. Los tests de integración con DB ya viven en
 * `test/integration/workshop-phase8-reports.int.spec.ts` para los flujos de Fase 6.
 */
describe('ReportsService · Fase 8', () => {
  function makePrismaMock(overrides: Partial<Record<string, unknown>> = {}): PrismaService {
    return overrides as unknown as PrismaService;
  }

  describe('salesByPaymentMethod', () => {
    it('agrupa ingresos por `CashMovementCategory.slug` y calcula % del total', async () => {
      const prisma = makePrismaMock({
        cashMovement: {
          findMany: jest.fn().mockResolvedValue([
            {
              amount: new Prisma.Decimal(50000),
              referenceType: 'Sale',
              category: { slug: 'ingreso_cobro', name: 'Cobro en efectivo' },
            },
            {
              amount: new Prisma.Decimal(30000),
              referenceType: 'WorkOrder',
              category: { slug: 'ingreso_cobro', name: 'Cobro en efectivo' },
            },
            {
              amount: new Prisma.Decimal(20000),
              referenceType: 'Invoice',
              category: { slug: 'ingreso_transferencia', name: 'Cobro por transferencia bancaria' },
            },
          ]),
        },
      });
      const svc = new ReportsService(prisma);
      const r = await svc.salesByPaymentMethod({ from: '2026-04-01', to: '2026-04-30' });
      expect(r.totals.amount).toBe('100000');
      expect(r.totals.count).toBe(3);
      expect(r.totals.methods).toBe(2);
      const efectivo = r.rows.find((x) => x.slug === 'ingreso_cobro');
      const transfer = r.rows.find((x) => x.slug === 'ingreso_transferencia');
      expect(efectivo?.amount).toBe('80000');
      expect(efectivo?.count).toBe(2);
      expect(efectivo?.sharePct).toBe('80');
      expect(efectivo?.label).toBe('Efectivo');
      expect(transfer?.sharePct).toBe('20');
      expect(transfer?.label).toBe('Transferencia');
      expect(r.rows[0].slug).toBe('ingreso_cobro'); // ordenado por monto desc
    });

    it('usa el nombre de la categoría para slugs desconocidos y devuelve sharePct null con total 0', async () => {
      const prisma = makePrismaMock({
        cashMovement: {
          findMany: jest.fn().mockResolvedValue([
            {
              amount: new Prisma.Decimal(0),
              referenceType: 'Sale',
              category: { slug: 'ingreso_legado', name: 'Categoría legada' },
            },
          ]),
        },
      });
      const svc = new ReportsService(prisma);
      const r = await svc.salesByPaymentMethod({ from: '2026-04-01', to: '2026-04-01' });
      expect(r.rows[0].label).toBe('Categoría legada');
      expect(r.rows[0].sharePct).toBeNull();
    });

    it('rechaza rangos invertidos y rangos mayores a 366 días', async () => {
      const svc = new ReportsService(makePrismaMock({ cashMovement: { findMany: jest.fn() } }));
      await expect(
        svc.salesByPaymentMethod({ from: '2026-04-10', to: '2026-04-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.salesByPaymentMethod({ from: '2024-01-01', to: '2026-06-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('taxCausado', () => {
    it('separa IVA de INC y expone base + impuesto por tarifa', async () => {
      const prisma = makePrismaMock({
        invoiceLine: {
          findMany: jest.fn().mockResolvedValue([
            {
              lineTotal: new Prisma.Decimal(11900),
              taxAmount: new Prisma.Decimal(1900),
              taxRatePercentSnapshot: new Prisma.Decimal(19),
              taxRateKindSnapshot: 'VAT',
              taxRateId: 'tr-iva19',
              taxRate: {
                id: 'tr-iva19',
                slug: 'iva_19',
                name: 'IVA 19%',
                kind: 'VAT',
                ratePercent: new Prisma.Decimal(19),
              },
            },
            {
              lineTotal: new Prisma.Decimal(10800),
              taxAmount: new Prisma.Decimal(800),
              taxRatePercentSnapshot: new Prisma.Decimal(8),
              taxRateKindSnapshot: 'INC',
              taxRateId: 'tr-inc8',
              taxRate: {
                id: 'tr-inc8',
                slug: 'inc_8',
                name: 'INC 8%',
                kind: 'INC',
                ratePercent: new Prisma.Decimal(8),
              },
            },
          ]),
        },
      });
      const svc = new ReportsService(prisma);
      const r = await svc.taxCausado({ from: '2026-04-01', to: '2026-04-30' });
      expect(r.totals.totalVat).toBe('1900');
      expect(r.totals.totalInc).toBe('800');
      expect(r.totals.totalTax).toBe('2700');
      expect(r.totals.taxableBase).toBe('20000');
      expect(r.rows).toHaveLength(2);
      const vat = r.rows.find((x) => x.taxRateId === 'tr-iva19');
      expect(vat?.taxableBase).toBe('10000');
      expect(vat?.taxAmount).toBe('1900');
      expect(vat?.kind).toBe('VAT');
      // Filtra solo facturas ISSUED en rango.
      const findMany = (prisma as unknown as { invoiceLine: { findMany: jest.Mock } }).invoiceLine
        .findMany;
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            invoice: expect.objectContaining({ status: InvoiceStatus.ISSUED }),
            taxRateId: { not: null },
          }),
        }),
      );
    });
  });

  describe('dianStatus', () => {
    it('cuenta facturas por estado y el último dispatch event por factura emitida', async () => {
      const prisma = makePrismaMock({
        invoice: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'inv-1',
              status: InvoiceStatus.ISSUED,
              grandTotal: new Prisma.Decimal(100000),
              dispatchEvents: [{ status: 'ACCEPTED' }],
            },
            {
              id: 'inv-2',
              status: InvoiceStatus.ISSUED,
              grandTotal: new Prisma.Decimal(50000),
              dispatchEvents: [{ status: 'REJECTED' }],
            },
            {
              id: 'inv-3',
              status: InvoiceStatus.ISSUED,
              grandTotal: new Prisma.Decimal(25000),
              dispatchEvents: [],
            },
            {
              id: 'inv-4',
              status: InvoiceStatus.DRAFT,
              grandTotal: new Prisma.Decimal(10000),
              dispatchEvents: [],
            },
            {
              id: 'inv-5',
              status: InvoiceStatus.VOIDED,
              grandTotal: new Prisma.Decimal(5000),
              dispatchEvents: [],
            },
          ]),
        },
      });
      const svc = new ReportsService(prisma);
      const r = await svc.dianStatus({ from: '2026-04-01', to: '2026-04-30' });
      expect(r.byStatus.ISSUED.count).toBe(3);
      expect(r.byStatus.ISSUED.amount).toBe('175000');
      expect(r.byStatus.DRAFT.count).toBe(1);
      expect(r.byStatus.VOIDED.count).toBe(1);
      expect(r.dispatch.ACCEPTED).toBe(1);
      expect(r.dispatch.REJECTED).toBe(1);
      expect(r.dispatch.NO_DISPATCH).toBe(1);
      // DRAFT/VOIDED no cuentan dispatch.
      expect(r.dispatch.PENDING).toBe(0);
      expect(r.totals.invoiceCount).toBe(5);
    });
  });

  describe('profitabilityByTechnician', () => {
    it('agrupa por `assignedTo.id`, separa OT sin técnico y cuenta las de costo desconocido aparte', async () => {
      const prisma = makePrismaMock({
        workOrder: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'wo-1',
              assignedTo: { id: 'tech-1', fullName: 'Téc 1', email: 't1@v.a' },
              lines: [
                {
                  id: 'l1',
                  lineType: 'PART',
                  quantity: new Prisma.Decimal(1),
                  unitPrice: new Prisma.Decimal(10000),
                  discountAmount: null,
                  costSnapshot: new Prisma.Decimal(4000),
                  taxRateId: null,
                  taxRatePercentSnapshot: null,
                  taxRate: null,
                },
              ],
            },
            {
              id: 'wo-2',
              assignedTo: { id: 'tech-1', fullName: 'Téc 1', email: 't1@v.a' },
              lines: [
                {
                  id: 'l2',
                  lineType: 'PART',
                  quantity: new Prisma.Decimal(1),
                  unitPrice: new Prisma.Decimal(8000),
                  discountAmount: null,
                  costSnapshot: null,
                  taxRateId: null,
                  taxRatePercentSnapshot: null,
                  taxRate: null,
                },
              ],
            },
            {
              id: 'wo-3',
              assignedTo: null,
              lines: [
                {
                  id: 'l3',
                  lineType: 'LABOR',
                  quantity: new Prisma.Decimal(1),
                  unitPrice: new Prisma.Decimal(5000),
                  discountAmount: null,
                  costSnapshot: null,
                  taxRateId: null,
                  taxRatePercentSnapshot: null,
                  taxRate: null,
                },
              ],
            },
          ]),
        },
      });
      const svc = new ReportsService(prisma);
      const r = await svc.profitabilityByTechnician({ from: '2026-04-01', to: '2026-04-30' });
      const tech = r.rows.find((x) => x.technicianId === 'tech-1');
      const unassigned = r.rows.find((x) => x.technicianId === null);
      expect(tech?.workOrdersConsidered).toBe(2);
      expect(tech?.workOrdersCounted).toBe(1);
      expect(tech?.workOrdersUnknownCost).toBe(1);
      expect(tech?.profitTotal).toBe('6000');
      expect(tech?.label).toBe('Téc 1');
      expect(unassigned?.workOrdersConsidered).toBe(1);
      expect(unassigned?.workOrdersCounted).toBe(1); // LABOR sin costSnapshot cuenta con profit = revenue
      expect(unassigned?.label).toBe('Sin técnico');
    });
  });

  describe('profitabilityByService', () => {
    it('agrupa líneas LABOR de OT por descripción (texto libre) y deja «Sin descripción» cuando está vacía', async () => {
      const prisma = makePrismaMock({
        workOrderLine: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'wol1',
              description: 'Diagnóstico',
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(8000),
              discountAmount: null,
              costSnapshot: null,
              taxRateId: null,
              taxRatePercentSnapshot: null,
              taxRate: null,
            },
            {
              id: 'wol2',
              description: 'diagnóstico',
              quantity: new Prisma.Decimal(2),
              unitPrice: new Prisma.Decimal(8000),
              discountAmount: null,
              costSnapshot: null,
              taxRateId: null,
              taxRatePercentSnapshot: null,
              taxRate: null,
            },
            {
              id: 'wol3',
              description: null,
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(3000),
              discountAmount: null,
              costSnapshot: null,
              taxRateId: null,
              taxRatePercentSnapshot: null,
              taxRate: null,
            },
          ]),
        },
      });
      const svc = new ReportsService(prisma);
      const r = await svc.profitabilityByService({ from: '2026-04-01', to: '2026-04-30' });
      expect(r.totals.serviceCount).toBe(2);
      expect(r.totals.lineCount).toBe(3);
      const diag = r.rows.find((x) => x.name === 'Diagnóstico');
      const noDesc = r.rows.find((x) => x.name === 'Sin descripción');
      expect(diag).toBeDefined();
      expect(diag?.lineCount).toBe(2);
      expect(diag?.revenueTotal).toBe('24000');
      expect(noDesc?.revenueTotal).toBe('3000');
    });
  });

  it('paymentMethodLabel: CashMovementDirection.INCOME es el filtro base de salesByPaymentMethod', async () => {
    // Sanity check defensivo: asegurar que la constante del ORM todavía se llama como el código asume.
    expect(CashMovementDirection.INCOME).toBe('INCOME');
  });
});
