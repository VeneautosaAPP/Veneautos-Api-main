import type { WorkOrderStatus } from '../../../api/types'

export const WORK_ORDER_LIST_STATUS: Record<
  WorkOrderStatus,
  { label: string; badge: string; cardBody: string; listRow: string }
> = {
  UNASSIGNED: {
    label: 'Sin asignar',
    badge:
      'bg-slate-200 text-slate-800 ring-1 ring-slate-300 dark:bg-slate-600 dark:text-slate-100 dark:ring-slate-500',
    cardBody:
      'border-l-slate-400 bg-gradient-to-br from-slate-50 to-white dark:border-l-slate-500 dark:from-slate-800 dark:to-slate-900',
    listRow: 'border-l-slate-400 bg-slate-50 dark:border-l-slate-500 dark:bg-slate-800',
  },
  RECEIVED: {
    label: 'Recibida',
    badge:
      'bg-sky-100 text-sky-950 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-600',
    cardBody:
      'border-l-sky-500 bg-gradient-to-br from-sky-50 to-white dark:border-l-sky-400 dark:from-sky-950 dark:to-slate-900',
    listRow: 'border-l-sky-500 bg-sky-50 dark:border-l-sky-400 dark:bg-sky-950',
  },
  IN_WORKSHOP: {
    label: 'En taller',
    badge:
      'bg-indigo-100 text-indigo-950 ring-1 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-100 dark:ring-indigo-700',
    cardBody:
      'border-l-indigo-500 bg-gradient-to-br from-indigo-50 to-white dark:border-l-indigo-400 dark:from-indigo-950 dark:to-slate-900',
    listRow: 'border-l-indigo-500 bg-indigo-50 dark:border-l-indigo-400 dark:bg-indigo-950',
  },
  WAITING_PARTS: {
    label: 'Esperando repuestos',
    badge:
      'bg-amber-100 text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-50 dark:ring-amber-700',
    cardBody:
      'border-l-amber-500 bg-gradient-to-br from-amber-50 to-white dark:border-l-amber-400 dark:from-amber-950 dark:to-slate-900',
    listRow: 'border-l-amber-500 bg-amber-50 dark:border-l-amber-400 dark:bg-amber-950',
  },
  READY: {
    label: 'Lista',
    badge:
      'bg-emerald-100 text-emerald-950 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-700',
    cardBody:
      'border-l-emerald-500 bg-gradient-to-br from-emerald-50 to-white dark:border-l-emerald-400 dark:from-emerald-950 dark:to-slate-900',
    listRow: 'border-l-emerald-500 bg-emerald-50 dark:border-l-emerald-400 dark:bg-emerald-950',
  },
  DELIVERED: {
    label: 'Entregada',
    badge:
      'bg-teal-100 text-teal-950 ring-1 ring-teal-200 dark:bg-teal-950 dark:text-teal-100 dark:ring-teal-700',
    cardBody:
      'border-l-teal-500 bg-gradient-to-br from-teal-50 to-white dark:border-l-teal-400 dark:from-teal-950 dark:to-slate-900',
    listRow: 'border-l-teal-500 bg-teal-50 dark:border-l-teal-400 dark:bg-teal-950',
  },
  CANCELLED: {
    label: 'Cancelada',
    badge:
      'bg-rose-100 text-rose-950 ring-1 ring-rose-200 dark:bg-rose-950 dark:text-rose-100 dark:ring-rose-700',
    cardBody:
      'border-l-rose-500 bg-gradient-to-br from-rose-50 to-white dark:border-l-rose-400 dark:from-rose-950 dark:to-slate-900',
    listRow: 'border-l-rose-500 bg-rose-50 dark:border-l-rose-400 dark:bg-rose-950',
  },
}

export const WORK_ORDER_LIST_STATUS_KEYS = Object.keys(WORK_ORDER_LIST_STATUS) as WorkOrderStatus[]

export const WO_LIST_VIEW_KEY = 'vene.workOrders.listView'
export const WO_PAGE_SIZE_KEY = 'vene.workOrders.pageSize'

/** Tamaños de página del listado (API hasta 100). */
export const WO_PAGE_SIZE_OPTIONS = [12, 24, 36, 50, 100] as const

export type WoListView = 'grid' | 'list' | 'details'

export function readStoredListView(): WoListView {
  try {
    const raw = localStorage.getItem(WO_LIST_VIEW_KEY)
    if (raw === 'grid' || raw === 'list' || raw === 'details') return raw
  } catch {
    /* ignore */
  }
  return 'grid'
}

export function readStoredPageSize(): (typeof WO_PAGE_SIZE_OPTIONS)[number] {
  try {
    const n = Number(localStorage.getItem(WO_PAGE_SIZE_KEY))
    if (WO_PAGE_SIZE_OPTIONS.includes(n as (typeof WO_PAGE_SIZE_OPTIONS)[number])) {
      return n as (typeof WO_PAGE_SIZE_OPTIONS)[number]
    }
  } catch {
    /* ignore */
  }
  return 24
}

export function parseWorkOrderListStatusParam(raw: string | null): WorkOrderStatus | '' {
  if (!raw) return ''
  return WORK_ORDER_LIST_STATUS_KEYS.includes(raw as WorkOrderStatus) ? (raw as WorkOrderStatus) : ''
}

/** Filtros del listado derivados de la query (URL). */
export type WorkOrderListFilterParams = {
  statusFilter: WorkOrderStatus | ''
  vehicleIdFilter: string
  customerIdFilter: string
  vehiclePlateLabel: string
  textSearch: string
}

export function parseWorkOrderListFilters(searchParams: URLSearchParams): WorkOrderListFilterParams {
  return {
    statusFilter: parseWorkOrderListStatusParam(searchParams.get('status')),
    vehicleIdFilter: (searchParams.get('vehicleId') ?? '').trim(),
    customerIdFilter: (searchParams.get('customerId') ?? '').trim(),
    vehiclePlateLabel: (searchParams.get('plate') ?? '').trim(),
    textSearch: (searchParams.get('search') ?? '').trim(),
  }
}

/**
 * Firma estable de los parámetros que afectan el fetch del listado (sin `plate`, solo etiqueta en UI).
 * Debe coincidir con la lógica de bump de página al cambiar filtros.
 */
export function workOrderListFetchFilterKey(f: WorkOrderListFilterParams): string {
  return `${f.statusFilter}|${f.vehicleIdFilter}|${f.customerIdFilter}|${f.textSearch}`
}

/** True si hay filtros que afectan el resultado del listado (misma base que la petición). */
export function workOrderListHasFetchFilters(f: WorkOrderListFilterParams): boolean {
  return !!(f.statusFilter || f.vehicleIdFilter || f.customerIdFilter || f.textSearch)
}

/**
 * Patente estilo CO visual (letras · números).
 */
export function formatColombianPlateDisplay(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!s) return raw.trim().toUpperCase()
  const mercosur = s.match(/^([A-Z]{3})(\d{2}[A-Z0-9]+)$/)
  if (mercosur) return `${mercosur[1]} • ${mercosur[2]}`
  const i = s.search(/\d/)
  if (i > 0) return `${s.slice(0, i)} • ${s.slice(i)}`
  return s
}

export function formatWorkOrderListDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export const WO_WARRANTY_BADGE_CLASS =
  'shrink-0 rounded px-1 py-0 text-[9px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-100'

export const WO_GRID_PLATE_RIVET_CLASS =
  'pointer-events-none absolute size-1 rounded-full bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
