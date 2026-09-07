import type { WorkOrderLine } from '../../../api/types'
import { formatCopInteger } from '../../../utils/copFormat'

/** Importe de una línea (usa los totales del backend cuando existen). */
export function lineMoney(ln: WorkOrderLine): string {
  if (ln.totals?.grossAmount != null) {
    const g = Number(ln.totals.grossAmount)
    if (!Number.isNaN(g)) return formatCopInteger(g)
  }
  const q = Number(ln.quantity)
  const p = ln.unitPrice != null ? Number(ln.unitPrice) : 0
  if (Number.isNaN(q) || Number.isNaN(p)) return '—'
  return formatCopInteger(q * p)
}

/** Suma de brutos por línea (alineado con `computeWorkOrderTotals` cuando hay `totals` por línea). */
export function linesSubtotalFromLines(lines: WorkOrderLine[]): string {
  let sum = 0
  for (const ln of lines) {
    if (ln.totals?.grossAmount != null) {
      const g = Number(ln.totals.grossAmount)
      if (!Number.isNaN(g)) sum += g
      continue
    }
    const q = Number(ln.quantity)
    const p = ln.unitPrice != null ? Number(ln.unitPrice) : 0
    if (!Number.isNaN(q) && !Number.isNaN(p)) sum += q * p
  }
  return formatCopInteger(sum)
}
