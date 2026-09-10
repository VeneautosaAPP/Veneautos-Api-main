import type { PayrollWeeklySummary } from './payrollApi'

/**
 * Caché persistente (localStorage) de la vista Nómina.
 *
 * Mismo patrón que `dashboardCache` (panel): se siembra como `initialData` al entrar,
 * se actualiza con cada respuesta exitosa del servidor y se descarta al modificar la OT
 * (la semana ya no calza si cambió la fecha de entrega). El scope incluye el rango ISO
 * para que una semana vieja no calce en la actual, y va por usuario (mecánico vs. admin).
 */
const STORAGE_PREFIX = 'vene:autos:payroll:'

type CachedEnvelope<T> = { value: T; savedAt: number }

function storageKey(scopeKey: string, userId: string): string {
  return `${STORAGE_PREFIX}weekly:${scopeKey}:${userId}`
}

function readCached<T>(key: string): CachedEnvelope<T> | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedEnvelope<T>
    if (!parsed || typeof parsed.savedAt !== 'number' || parsed.value == null) return null
    return parsed
  } catch {
    return null
  }
}

function writeCached<T>(scopeKey: string, userId: string, value: T): void {
  try {
    const key = storageKey(scopeKey, userId)
    window.localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }))
    pruneLegacyEntries(userId, key)
  } catch {
    // localStorage no disponible / quota llena: la UI no debe romperse.
  }
}

/** Descarta entradas viejas del MISMO usuario (semanas previas). */
function pruneLegacyEntries(userId: string, currentKey: string): void {
  try {
    const suffix = `:${userId}`
    const stale: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k !== currentKey && k.startsWith(STORAGE_PREFIX) && k.endsWith(suffix)) {
        stale.push(k)
      }
    }
    for (const k of stale) window.localStorage.removeItem(k)
  } catch {
    // no-op
  }
}

/**
 * Nómina semanal — el scope incluye rango ISO + alcance (`all` = todas las filas, `own` = solo la
 * propia) para que una semana vieja —o una vista preview de rol mecánico— no calce en la actual.
 */
export const payrollWeeklyCache = {
  read(
    userId: string,
    fromIso: string,
    toIso: string,
    readAll: boolean,
  ): CachedEnvelope<PayrollWeeklySummary> | null {
    return readCached<PayrollWeeklySummary>(storageKey(`${scopeSlug(readAll)}:${fromIso}--${toIso}`, userId))
  },
  write(
    userId: string,
    fromIso: string,
    toIso: string,
    readAll: boolean,
    value: PayrollWeeklySummary,
  ): void {
    writeCached<PayrollWeeklySummary>(`${scopeSlug(readAll)}:${fromIso}--${toIso}`, userId, value)
  },
}

function scopeSlug(readAll: boolean): string {
  return readAll ? 'all' : 'own'
}