import { memo, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { WorkOrderStatus } from '../../../api/types'
import {
  WO_PAGE_SIZE_OPTIONS,
  WORK_ORDER_LIST_STATUS as STATUS,
  WORK_ORDER_LIST_STATUS_KEYS as STATUS_KEYS,
} from '../services/workOrdersListPresentation'

export const WoPaginationBar = memo(function WoPaginationBar({
  page,
  pageSize,
  total,
  loading,
  isSaas,
  statusFilter,
  onStatusChange,
  textSearch,
  onSearchChange,
  canCreateWorkOrder,
  onOpenNewOrder,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  loading: boolean
  isSaas?: boolean
  statusFilter: WorkOrderStatus | ''
  onStatusChange: (s: WorkOrderStatus | '') => void
  textSearch: string
  onSearchChange: (next: string) => void
  canCreateWorkOrder: boolean
  onOpenNewOrder: () => void
  onPageChange: (next: number) => void
  onPageSizeChange: (next: (typeof WO_PAGE_SIZE_OPTIONS)[number]) => void
}) {
  const [searchDraft, setSearchDraft] = useState(textSearch)
  useEffect(() => {
    setSearchDraft(textSearch)
  }, [textSearch])
  useEffect(() => {
    if (searchDraft === textSearch) return
    const t = setTimeout(() => onSearchChange(searchDraft), 300)
    return () => clearTimeout(t)
  }, [searchDraft, textSearch, onSearchChange])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const wrapClass = isSaas
    ? 'flex flex-col gap-3 rounded-xl border border-slate-200 bg-[var(--va-surface-elevated)] px-3 py-2.5 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between'
    : 'flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between'
  const inputClass = isSaas
    ? 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
    : 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  const searchInputClass = isSaas
    ? 'w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-brand-400 dark:focus:ring-brand-400'
    : 'w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-brand-400 dark:focus:ring-brand-400'
  const pagerBtnClass = isSaas
    ? 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
    : 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'

  return (
    <div className={wrapClass}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-slate-300"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Buscar: cliente, placa, marca, factura, celular…"
            aria-label="Buscar órdenes por cliente, placa, marca, factura o celular"
            className={searchInputClass}
          />
        </div>
        {canCreateWorkOrder ? (
          <button type="button" onClick={onOpenNewOrder} className="va-btn-primary !min-h-0 px-3 py-1.5 text-xs sm:px-4 sm:text-sm">
            Nueva orden
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span>Estado</span>
          <select
            value={statusFilter}
            disabled={loading}
            onChange={(e) => onStatusChange(e.target.value as WorkOrderStatus | '')}
            className={inputClass}
          >
            <option value="">Todas</option>
            {STATUS_KEYS.map((key) => (
              <option key={key} value={key}>
                {STATUS[key].label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span>Por página</span>
          <select
            value={pageSize}
            disabled={loading}
            onChange={(e) =>
              onPageSizeChange(Number(e.target.value) as (typeof WO_PAGE_SIZE_OPTIONS)[number])
            }
            className={inputClass}
          >
            {WO_PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
            title="Anterior"
            aria-label="Página anterior"
            className={pagerBtnClass}
          >
            {'<'}
          </button>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            title="Siguiente"
            aria-label="Página siguiente"
            className={pagerBtnClass}
          >
            {'>'}
          </button>
        </div>
      </div>
    </div>
  )
})