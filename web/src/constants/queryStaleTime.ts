/**
 * Tiempos de frescura (TanStack Query) alineados con UX + menos carga al backend.
 * El cliente global usa 30s por defecto; las queries pueden refinar.
 */
/** Listados operativos (OT, movimientos de caja, sesión actual). */
export const STALE_OPERATIONAL_MS = 30_000

/** Catálogos y datos que cambian pocas veces al día. */
export const STALE_SEMI_STATIC_MS = 60_000

/** Listado GET /work-orders: al volver desde el detalle se reutiliza la grilla sin refetch inmediato. */
export const STALE_WORK_ORDERS_LIST_MS = 120_000

/** GET /work-orders/:id y cobros: prefetch + reentrada a la misma OT sin pegarle al servidor al instante. */
export const STALE_WORK_ORDER_DETAIL_MS = 180_000

/** GET /settings y GET /users en Configuración: sección poco frecuente; reutilizar datos varios minutos. */
export const STALE_SETTINGS_ADMIN_MS = 10 * 60_000

/**
 * Tarjetas del panel: los datos se persisten en localStorage y se muestran al entrar.
 * El refetch de fondo solo ocurre si vencieron (10 min) o si hubo una modificación (WORK_ORDER_CHANGED_EVENT).
 */
export const STALE_DASHBOARD_MS = 10 * 60_000
