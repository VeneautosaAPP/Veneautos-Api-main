/**
 * Smoke test del renderizador de recibos (Fase 7.5): no verifica pixel-perfect HTML,
 * sólo garantiza que (a) el encabezado incluye los datos del taller activos, (b) las
 * líneas, totales y pagos se imprimen y (c) la leyenda fiscal cambia según el régimen.
 */
import { ReceiptsService, type WorkOrderForReceipt } from './receipts.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkshopLogoService } from './workshop-logo.service';

type WorkshopRow = { key: string; value: unknown };

function makePrismaStub(rows: WorkshopRow[]): PrismaService {
  return {
    workshopSetting: {
      findMany: jest.fn(async () => rows),
    },
  } as unknown as PrismaService;
}

/** Stub que siempre devuelve null: los recibos se renderizan sin logo en los tests. */
function makeLogosStub(): WorkshopLogoService {
  return {
    getLogo: jest.fn(async () => null),
    getDataUrl: jest.fn(async () => null),
  } as unknown as WorkshopLogoService;
}

describe('ReceiptsService', () => {
  const workshopRows: WorkshopRow[] = [
    { key: 'workshop.legal_name', value: 'Vene Autos S.A.S.' },
    { key: 'workshop.document_kind', value: 'NIT' },
    { key: 'workshop.document_id', value: '900123456' },
    { key: 'workshop.address', value: 'Cra 7 #20-30' },
    { key: 'workshop.city', value: 'Bogotá' },
    { key: 'workshop.phone', value: '601-555-0101' },
    { key: 'workshop.regime', value: 'natural_no_obligado' },
  ];

  it('incluye encabezado del taller, leyenda de persona natural, líneas y totales en el recibo de OT', async () => {
    const prisma = makePrismaStub(workshopRows);
    const service = new ReceiptsService(prisma, makeLogosStub());

    const wo: WorkOrderForReceipt = {
      id: 'wo1',
      publicCode: 'OT-0001',
      orderNumber: 1,
      status: 'DELIVERED',
      description: 'Cambio de aceite y revisión general',
      createdAt: new Date('2026-04-10T10:00:00Z'),
      deliveredAt: new Date('2026-04-11T15:00:00Z'),
      customerName: 'Juan Pérez',
      customerPhone: '3001112233',
      customerEmail: 'juan@example.com',
      vehicle: { plate: 'ABC123', brand: 'Mazda', model: '3', year: 2020 },
      /** Instante de la OT: debe mandar sobre el maestro (mismo vehículo o maestro desactualizado). */
      vehicleBrand: 'Toyota',
      vehicleModel: 'Hilux',
      lines: [
        {
          lineType: 'LABOR',
          description: 'Mano de obra cambio de aceite',
          quantity: { toString: () => '1' },
          unitPrice: { toString: () => '80000' },
          discountAmount: { toString: () => '0' },
          totals: { lineTotal: '80000' },
        },
        {
          lineType: 'PART',
          description: 'Filtro de aceite',
          quantity: { toString: () => '1' },
          unitPrice: { toString: () => '35000' },
          discountAmount: { toString: () => '5000' },
          totals: { lineTotal: '30000' },
        },
      ],
      totals: {
        grandTotal: '110000',
        totalDiscount: '5000',
        totalTax: '0',
        linesSubtotal: '115000',
      },
      paymentSummary: { totalPaid: '50000' },
      amountDue: '60000',
      payments: [
        {
          amount: { toString: () => '50000' },
          createdAt: new Date('2026-04-11T16:00:00Z'),
          cashMovement: { category: { name: 'Abono caja' } },
        },
      ],
    };

    const html = await service.renderWorkOrderReceipt(wo);

    expect(html).toContain('Vene Autos S.A.S.');
    expect(html).toContain('NIT 900123456');
    expect(html).toContain('Cra 7 #20-30');
    expect(html).toContain('OT-0001');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('ABC123');
    expect(html).toContain('Filtro de aceite');
    /** LABOR: en PDF/recibo se muestra la descripción de línea (servicio cargado o texto libre). */
    expect(html).toContain('Mano de obra cambio de aceite');
    expect(html).toContain('Cambio de aceite y revisión general');
    expect(html).toContain('$110.000');
    expect(html).toContain('Abono caja');
    expect(html).toContain('Toyota');
    expect(html).toContain('Hilux');
    expect(html).toContain('Documento no fiscal');
    expect(html).toContain('Persona natural no obligada a facturar');
    expect(html).toContain('Saldo pendiente');
  });

  it('cambia la leyenda cuando el taller es persona jurídica responsable de IVA', async () => {
    const prisma = makePrismaStub([
      ...workshopRows.filter((r) => r.key !== 'workshop.regime'),
      { key: 'workshop.regime', value: 'juridica_responsable_iva' },
    ]);
    const service = new ReceiptsService(prisma, makeLogosStub());

    const wo: WorkOrderForReceipt = {
      id: 'wo2',
      publicCode: 'OT-0002',
      orderNumber: 2,
      status: 'DELIVERED',
      description: null,
      createdAt: new Date('2026-04-15T10:00:00Z'),
      deliveredAt: new Date('2026-04-15T10:05:00Z'),
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      lines: [
        {
          lineType: 'PART',
          description: 'Pastillas de freno',
          quantity: { toString: () => '2' },
          unitPrice: { toString: () => '90000' },
          discountAmount: { toString: () => '0' },
        },
      ],
      totals: { grandTotal: '180000', linesSubtotal: '180000', totalTax: '0', totalDiscount: '0' },
      amountDue: '0',
      paymentSummary: { totalPaid: '180000' },
    };

    const html = await service.renderWorkOrderReceipt(wo);

    expect(html).toContain('OT-0002');
    expect(html).toContain('Pastillas de freno');
    expect(html).toContain('factura electrónica DIAN');
    expect(html).not.toContain('no obligada a facturar electrónicamente');
  });

  it('usa un nombre por defecto "Taller" si no hay razón social configurada', async () => {
    const prisma = makePrismaStub([]);
    const service = new ReceiptsService(prisma, makeLogosStub());

    const wo: WorkOrderForReceipt = {
      id: 'wo3',
      publicCode: 'OT-0001',
      orderNumber: 1,
      status: 'UNASSIGNED',
      description: null,
      createdAt: new Date('2026-04-15T10:00:00Z'),
      deliveredAt: null,
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      lines: [],
    };

    const html = await service.renderWorkOrderReceipt(wo);
    expect(html).toContain('Taller');
  });
});
