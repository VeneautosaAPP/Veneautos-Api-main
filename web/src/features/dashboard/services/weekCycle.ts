export function currentWeekDeliveredRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now)
  const weekday = from.getDay()
  const daysSinceMonday = (weekday + 6) % 7
  from.setDate(from.getDate() - daysSinceMonday)
  from.setHours(0, 0, 0, 0)

  const to = new Date(from)
  to.setDate(to.getDate() + 5)
  to.setHours(23, 59, 59, 999)

  return { from, to }
}

export function formatWeekRangeLabel(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${from.toLocaleDateString('es-CO', opts)} – ${to.toLocaleDateString('es-CO', opts)}`
}