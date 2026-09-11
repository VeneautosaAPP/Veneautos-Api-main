import type { WorkOrderDetail, WorkOrderLine, WorkOrderLinesMutationResult } from '../../../api/types'
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

/**
 * Proyección local de una línea en edición (para el optimistic update). `totals: null` fuerza al
 * renderizado a usar `quantity * unitPrice` de la línea mientras llega el snapshot del servidor.
 */
export function projectLineEdit(
  ln: WorkOrderLine,
  fields: {
    quantity: string
    description: string
    unitPrice: string | null | undefined
    discountAmount: string | null | undefined
    costSnapshot: string | null | undefined
    taxRateId: string | null
  },
): WorkOrderLine {
  return {
    ...ln,
    quantity: fields.quantity,
    description: fields.description,
    unitPrice: fields.unitPrice ?? null,
    discountAmount: fields.discountAmount ?? null,
    costSnapshot: fields.costSnapshot ?? null,
    taxRateId: fields.taxRateId,
    totals: null,
  }
}

/**
 * Aplica el snapshot que devuelven POST/PATCH/DELETE de líneas (una sola llamada) sin un segundo
 * GET del detalle. Si un campo llegara redactado (null), conserva el valor previo del cliente.
 */
export function applyLinesSnapshotToDetail(
  prev: WorkOrderDetail,
  snap: WorkOrderLinesMutationResult,
): WorkOrderDetail {
  return {
    ...prev,
    lines: snap.lines,
    linesSubtotal: snap.linesSubtotal ?? prev.linesSubtotal,
    totals: snap.totals ?? prev.totals,
    amountDue: snap.amountDue ?? prev.amountDue,
    paymentSummary: snap.paymentSummary ?? prev.paymentSummary,
  }
}
