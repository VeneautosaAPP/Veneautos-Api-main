export function currentMonthDeliveredRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { from, to }
}

export function formatMonthNumberLabel(from: Date, to: Date): string {
  const fromOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const toOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  return `${from.toLocaleDateString('es-CO', fromOpts)} al ${to.toLocaleDateString('es-CO', toOpts)}`
}

export function formatMonthTitle(from: Date): string {
  const label = from.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}