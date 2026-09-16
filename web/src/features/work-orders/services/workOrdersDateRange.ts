/**
 * Rango de fechas del listado de órdenes («Entrega desde / hasta»).
 *
 * - La URL guarda **ISO 8601** (instante exacto) para no perder precisión ni depender de la
 *   zona del servidor; es el mismo `Date` con el que las tarjetas del panel piden su resumen,
 *   así que el conteo de la tarjeta y el del listado coinciden.
 * - Los `<input type="date">` trabajan con `yyyy-mm-dd` en hora **local**; de ahí las
 *   conversiones de esta utilidad.
 */

/** Normaliza un parámetro de URL a ISO; '' si no viene o no es una fecha válida. */
export function parseIsoDateParam(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

/** ISO → `yyyy-mm-dd` local para `<input type="date">`. */
export function isoToDateInputValue(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * `yyyy-mm-dd` local → ISO. `edge` fija el extremo del día: `from` a las 00:00:00.000 y
 * `to` a las 23:59:59.999, de modo que el rango sea inclusivo en ambos extremos.
 */
export function dateInputValueToIso(day: string, edge: 'from' | 'to'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  if (!m) return ''
  const d =
    edge === 'from'
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
      : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

/** Etiqueta legible (es-CO) del rango activo, tolerando que falte un extremo. */
export function formatDeliveredRangeLabel(fromIso: string, toIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const from = fromIso ? new Date(fromIso) : null
  const to = toIso ? new Date(toIso) : null
  const fromLabel =
    from && !Number.isNaN(from.getTime()) ? from.toLocaleDateString('es-CO', opts) : ''
  const toLabel = to && !Number.isNaN(to.getTime()) ? to.toLocaleDateString('es-CO', opts) : ''
  if (fromLabel && toLabel) return `entre ${fromLabel} y ${toLabel}`
  if (fromLabel) return `desde ${fromLabel}`
  if (toLabel) return `hasta ${toLabel}`
  return ''
}
