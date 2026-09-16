import { Prisma, TaxRateKind, WorkOrderLineType } from '@prisma/client';
import {
  computeLineTotals,
  computeWorkOrderTotals,
  computeWorkshopProfit,
  type LineForTotals,
} from './work-order-totals';

function d(v: string | number): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function labor(overrides: Partial<LineForTotals>): LineForTotals {
  return {
    id: overrides.id ?? 'l1',
    lineType: WorkOrderLineType.LABOR,
    quantity: overrides.quantity ?? d(1),
    unitPrice: overrides.unitPrice ?? null,
    discountAmount: overrides.discountAmount ?? null,
    costSnapshot: null,
    taxRateId: overrides.taxRateId ?? null,
    taxRatePercentSnapshot: overrides.taxRatePercentSnapshot ?? null,
    taxRate: overrides.taxRate ?? null,
  };
}

function part(overrides: Partial<LineForTotals>): LineForTotals {
  return {
    id: overrides.id ?? 'p1',
    lineType: WorkOrderLineType.PART,
    quantity: overrides.quantity ?? d(1),
    unitPrice: overrides.unitPrice ?? null,
    discountAmount: overrides.discountAmount ?? null,
    costSnapshot: overrides.costSnapshot ?? null,
    taxRateId: overrides.taxRateId ?? null,
    taxRatePercentSnapshot: overrides.taxRatePercentSnapshot ?? null,
    taxRate: overrides.taxRate ?? null,
  };
}

describe('work-order-totals · persona natural (sin IVA)', () => {
  it('Línea LABOR sin impuesto y sin descuento: total = cantidad × precio', () => {
    const t = computeLineTotals(labor({ quantity: d(1), unitPrice: d(50_000) }));
    expect(t.grossAmount.toString()).toBe('50000');
    expect(t.taxAmount.toString()).toBe('0');
    expect(t.lineTotal.toString()).toBe('50000');
    expect(t.taxKind).toBeNull();
  });

  it('Línea PART con costSnapshot computa utilidad = base - costo', () => {
    const t = computeLineTotals(
      part({
        quantity: d(2),
        unitPrice: d(30_000),
        costSnapshot: d(18_000),
      }),
    );
    expect(t.grossAmount.toString()).toBe('60000');
    expect(t.lineCost?.toString()).toBe('36000');
    expect(t.lineProfit?.toString()).toBe('24000');
  });

  it('Totales agregados sin impuestos ni descuentos', () => {
    const totals = computeWorkOrderTotals([
      labor({ unitPrice: d(80_000) }),
      part({ quantity: d(2), unitPrice: d(30_000), costSnapshot: d(20_000) }),
    ]);
    expect(totals.linesSubtotal.toString()).toBe('140000');
    expect(totals.totalTax.toString()).toBe('0');
    expect(totals.grandTotal.toString()).toBe('140000');
    expect(totals.totalCost?.toString()).toBe('40000');
    expect(totals.totalProfit?.toString()).toBe('100000');
  });
});

describe('work-order-totals · persona jurídica (con IVA/INC)', () => {
  it('Línea con IVA 19% sobre base con descuento aplica tax tras el descuento', () => {
    const t = computeLineTotals(
      labor({
        quantity: d(1),
        unitPrice: d(100_000),
        discountAmount: d(10_000),
        taxRateId: 'vat',
        taxRatePercentSnapshot: d(19),
        taxRate: { kind: TaxRateKind.VAT },
      }),
    );
    expect(t.grossAmount.toString()).toBe('100000');
    expect(t.discountAmount.toString()).toBe('10000');
    expect(t.taxableBase.toString()).toBe('90000');
    expect(t.taxAmount.toString()).toBe('17100');
    expect(t.lineTotal.toString()).toBe('107100');
    expect(t.taxKind).toBe(TaxRateKind.VAT);
  });

  it('Descuento que supera el bruto se trunca (no genera base negativa ni impuesto negativo)', () => {
    const t = computeLineTotals(
      labor({
        unitPrice: d(20_000),
        discountAmount: d(50_000),
        taxRatePercentSnapshot: d(19),
        taxRate: { kind: TaxRateKind.VAT },
      }),
    );
    expect(t.taxableBase.toString()).toBe('0');
    expect(t.taxAmount.toString()).toBe('0');
    expect(t.lineTotal.toString()).toBe('0');
  });

  it('Separa IVA de INC en los totales de la OT', () => {
    const totals = computeWorkOrderTotals([
      labor({
        unitPrice: d(100_000),
        taxRatePercentSnapshot: d(19),
        taxRate: { kind: TaxRateKind.VAT },
      }),
      labor({
        id: 'l2',
        unitPrice: d(50_000),
        taxRatePercentSnapshot: d(8),
        taxRate: { kind: TaxRateKind.INC },
      }),
    ]);
    expect(totals.taxVatAmount.toString()).toBe('19000');
    expect(totals.taxIncAmount.toString()).toBe('4000');
    expect(totals.totalTax.toString()).toBe('23000');
    expect(totals.grandTotal.toString()).toBe('173000');
  });

  it('Usa snapshot congelado, aunque la tarifa base cambie después', () => {
    // Simula una OT vieja con IVA 19 snapshotado; el sistema hoy tuviese la tarifa en 21.
    const t = computeLineTotals(
      labor({
        unitPrice: d(100_000),
        taxRatePercentSnapshot: d('19.00'),
        taxRate: { kind: TaxRateKind.VAT },
      }),
    );
    expect(t.taxAmount.toString()).toBe('19000');
  });
});

describe('computeWorkshopProfit (utilidad del taller)', () => {
  it('Repuesto: precio unitario − precio proveedor, por cantidad', () => {
    const profit = computeWorkshopProfit([
      part({ quantity: d(1), unitPrice: d(100_000), costSnapshot: d(75_000) }),
      part({ quantity: d(1), unitPrice: d(250_000), costSnapshot: d(200_000) }),
    ]);
    expect(profit?.toString()).toBe('75000');
  });

  it('Mano de obra: el 50% es utilidad (lo demás es comisión del mecánico)', () => {
    const profit = computeWorkshopProfit([
      labor({ quantity: d(1), unitPrice: d(180_000) }),
      labor({ quantity: d(2), unitPrice: d(50_000) }),
    ]);
    expect(profit?.toString()).toBe('140000');
  });

  it('No resta descuentos de línea (a diferencia de `totalProfit`)', () => {
    const lines = [labor({ quantity: d(1), unitPrice: d(150_000), discountAmount: d(20_000) })];
    expect(computeWorkshopProfit(lines)?.toString()).toBe('75000');
    expect(computeWorkOrderTotals(lines).totalProfit?.toString()).toBe('130000');
  });

  it('Respeta el % de comisión de la OT cuando está configurado', () => {
    const lines = [labor({ quantity: d(1), unitPrice: d(200_000) })];
    expect(computeWorkshopProfit(lines, d(60))?.toString()).toBe('80000');
  });

  it('null si algún repuesto no tiene precio proveedor cargado', () => {
    expect(
      computeWorkshopProfit([
        part({ quantity: d(1), unitPrice: d(100_000), costSnapshot: d(75_000) }),
        part({ quantity: d(1), unitPrice: d(50_000) }),
      ]),
    ).toBeNull();
  });
});
