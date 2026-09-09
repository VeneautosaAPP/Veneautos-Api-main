import type {
  MonthlyDeliveredSummary,
  ReadyOrdersSummary,
  WeeklyDeliveredSummary,
  WorkOrdersValueSummary,
} from '../../work-orders/services/workOrdersListApi'

/**
 * Caché persistente (localStorage) de las tarjetas del panel.
 *
 * - Se siembra como `initialData` al entrar: las tarjetas pintan su último valor al instante.
 * - Se actualiza con cada respuesta exitosa del servidor (refetch por staleTime o por
 *   WORK_ORDER_CHANGED_EVENT), así que "en local vive hasta que haya una modificación".
 * - Cada entrada va scopeada por usuario (`kind:scopeKey:userId`) para no mezclar datos
 *   entre cuentas que comparten el navegador/TV del taller.
 */

const STORAGE_PREFIX = 'vene:autos:dashboard:'

type CachedEnvelope<T> = { value: T; savedAt: number }

function storageKey(kind: string, scopeKey: string, userId: string): string {
  return `${STORAGE_PREFIX}${kind}:${scopeKey}:${userId}`
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

function writeCached<T>(kind: string, scopeKey: string, userId: string, value: T): void {
  try {
    const key = storageKey(kind, scopeKey, userId)
    window.localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }))
    pruneLegacyEntries(kind, userId, key)
  } catch {
    // localStorage no disponible / quota llena: la UI no debe romperse.
  }
}

/** Descarta entradas viejas del MISMO usuario y tipo (p. ej. semanas previas). */
function pruneLegacyEntries(kind: string, userId: string, currentKey: string): void {
  try {
    const kindPrefix = `${STORAGE_PREFIX}${kind}:`
    const suffix = `:${userId}`
    const stale: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k !== currentKey && k.startsWith(kindPrefix) && k.endsWith(suffix)) {
        stale.push(k)
      }
    }
    for (const k of stale) window.localStorage.removeItem(k)
  } catch {
    // no-op
  }
}

/** Tarjeta "En taller" — cantidad + valor total de OTs activas. */
export const workshopCounterCache = {
  read(userId: string): CachedEnvelope<WorkOrdersValueSummary> | null {
    return readCached<WorkOrdersValueSummary>(storageKey('work-orders-in-workshop', 'count', userId))
  },
  write(userId: string, value: WorkOrdersValueSummary): void {
    writeCached<WorkOrdersValueSummary>('work-orders-in-workshop', 'count', userId, value)
  },
}

/** Tarjeta "Entregadas esta semana" — el scope incluye el rango ISO para que una semana vieja no calce en la actual. */
export const weeklyDeliveredCache = {
  read(userId: string, fromIso: string, toIso: string): CachedEnvelope<WeeklyDeliveredSummary> | null {
    return readCached<WeeklyDeliveredSummary>(storageKey('weekly-delivered', `${fromIso}--${toIso}`, userId))
  },
  write(userId: string, fromIso: string, toIso: string, value: WeeklyDeliveredSummary): void {
    writeCached<WeeklyDeliveredSummary>('weekly-delivered', `${fromIso}--${toIso}`, userId, value)
  },
}

/** Tarjeta "Entregadas este mes" — el scope incluye el rango ISO para que un mes viejo no calce en el actual. */
export const monthlyDeliveredCache = {
  read(userId: string, fromIso: string, toIso: string): CachedEnvelope<MonthlyDeliveredSummary> | null {
    return readCached<MonthlyDeliveredSummary>(storageKey('monthly-delivered', `${fromIso}--${toIso}`, userId))
  },
  write(userId: string, fromIso: string, toIso: string, value: MonthlyDeliveredSummary): void {
    writeCached<MonthlyDeliveredSummary>('monthly-delivered', `${fromIso}--${toIso}`, userId, value)
  },
}

/** Tarjeta "Listas" — resumen global de OTs en READY. */
export const readyOrdersCache = {
  read(userId: string): CachedEnvelope<ReadyOrdersSummary> | null {
    return readCached<ReadyOrdersSummary>(storageKey('ready-orders', 'summary', userId))
  },
  write(userId: string, value: ReadyOrdersSummary): void {
    writeCached<ReadyOrdersSummary>('ready-orders', 'summary', userId, value)
  },
}