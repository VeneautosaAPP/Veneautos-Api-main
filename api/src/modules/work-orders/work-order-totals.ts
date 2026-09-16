/**
 * Fase 2 · Totales de OT.
 *
 * La lógica se promovió a `common/billing/billing-totals` para reutilizarla desde
 * el módulo de ventas (Fase 3). Este archivo mantiene los nombres históricos como
 * re-exports para no dispersar cambios en los consumidores de la OT.
 */
export {
  computeLineTotals,
  computeBillingTotals as computeWorkOrderTotals,
  serializeBillingTotals as serializeWorkOrderTotals,
  serializeLineTotals,
  type LineForTotals,
  type LineTotals,
  type BillingTotals as WorkOrderTotals,
} from '../../common/billing/billing-totals';

import { Prisma, WorkOrderLineType } from '@prisma/client';
import { ceilWholeCop } from '../../common/money/cop-money';
import type { LineForTotals } from '../../common/billing/billing-totals';

/** % de la mano de obra que se lleva el mecánico cuando la OT no tiene % propio (Nómina). */
export const DEFAULT_LABOR_COMMISSION_PCT = new Prisma.Decimal(50);

/**
 * **Utilidad del taller** (la que se muestra en la OT), a diferencia de `totalProfit`
 * (utilidad contable que usan los reportes: descuenta descuentos y toma la mano de obra completa):
 *
 * - Repuesto: `precio unitario − precio proveedor`, por cantidad.
 * - Mano de obra: el % que **no** es comisión del mecánico (50% por defecto).
 *
 * No resta descuentos de línea ni suma impuestos (el IVA/INC no es ingreso del taller).
 *
 * @returns `null` si algún repuesto no tiene precio proveedor cargado: preferimos no
 * mostrar un número antes que inventarlo.
 */
export function computeWorkshopProfit(
  lines: LineForTotals[],
  laborCommissionPct?: Prisma.Decimal | null,
): Prisma.Decimal | null {
  const pct = laborCommissionPct ?? DEFAULT_LABOR_COMMISSION_PCT;
  const workshopShare = new Prisma.Decimal(100).minus(pct).div(100);
  const zero = new Prisma.Decimal(0);

  let total = new Prisma.Decimal(0);
  for (const ln of lines) {
    const gross = ceilWholeCop(ln.quantity.mul(ln.unitPrice ?? zero));
    if (ln.lineType === WorkOrderLineType.LABOR) {
      total = total.plus(ceilWholeCop(gross.mul(workshopShare)));
      continue;
    }
    if (ln.costSnapshot == null) return null;
    total = total.plus(gross.minus(ceilWholeCop(ln.quantity.mul(ln.costSnapshot))));
  }
  return total;
}
