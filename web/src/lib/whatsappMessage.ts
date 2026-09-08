import type { WorkOrderDetail, WorkOrderLine, WorkOrderStatus } from '../api/types'

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  UNASSIGNED: 'Sin asignar',
  RECEIVED: 'Recibida',
  IN_WORKSHOP: 'En taller',
  WAITING_PARTS: 'Esperando repuestos',
  READY: 'Lista para entrega',
  DELIVERED: 'Entregada',
  CANCELLED: 'Cancelada',
}

const MAX_LINES = 8

/** Formatea un string decimal COP (ej. "123456.00") como moneda (ej. "$ 123.456"). */
export function formatCop(
  value: string | null | undefined,
  fallback = '—',
): string {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  })
    .format(n)
    .replace(/\u00A0/g, ' ')
}

export function workOrderStatusLabel(status: WorkOrderStatus): string {
  return STATUS_LABELS[status] ?? status
}

/** ISO → dd/mm/aaaa hh:mm */
export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatLineAmount(line: WorkOrderLine): string {
  return formatCop(line.totals?.lineTotal ?? line.unitPrice)
}

/**
 * Texto resumen de la OT para WhatsApp: datos del comprobante, líneas (hasta 8),
 * totales y saldo. `footer` suele ser el nombre legal del taller.
 */
export function buildWhatsAppMessage(
  wo: WorkOrderDetail,
  footer = 'Vene Autos',
): string {
  const lines = Array.isArray(wo.lines) ? wo.lines : []
  const shown = lines.slice(0, MAX_LINES)
  const lineTexts = shown.map((l) => {
    const qty = l.quantity ? l.quantity.replace(/\.?0+$/, '') : '1'
    const desc = (l.description ?? 'Línea').trim()
    return `${qty}× ${desc} — ${formatLineAmount(l)}`
  })
  const hiddenCount = lines.length - shown.length

  const totals = wo.totals
  const pay = wo.paymentSummary
  const parts: string[] = [
    `🧾 *Comprobante OT ${wo.publicCode}*`,
    shortDate(wo.createdAt),
    `Cliente: ${wo.customerName ?? '—'}`,
    `Patente: ${wo.vehiclePlate ?? '—'}`,
    `Estado: ${workOrderStatusLabel(wo.status)}`,
    '',
    ...lineTexts,
  ]
  if (hiddenCount > 0) parts.push(`+ ${hiddenCount} línea(s) más`)
  parts.push('', '──────────────')
  parts.push(`Subtotal: ${formatCop(totals?.linesSubtotal)}`)
  if (Number(totals?.totalDiscount) > 0) {
    parts.push(`Descuentos: ${formatCop(totals?.totalDiscount)}`)
  }
  parts.push(`IVA: ${formatCop(totals?.totalTax)}`)
  parts.push(`*Total: ${formatCop(totals?.grandTotal)}*`)
  parts.push('', `Pagado: ${formatCop(pay?.totalPaid)}`)
  parts.push(`Saldo: ${formatCop(pay?.remaining)}`)
  parts.push('', footer)
  return parts.join('\n')
}

/** Link Click-to-Chat (`wa.me`) con el texto precargado; no admite adjuntos. */
export function waMeLink(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`
}