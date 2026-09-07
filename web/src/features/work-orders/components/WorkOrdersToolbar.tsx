import { memo } from 'react'
import type { WorkOrderStatus } from '../../../api/types'
import { ListViewToggle } from './ListViewToggle'
import { WoPaginationBar } from './WoPaginationBar'
import {
  WO_PAGE_SIZE_OPTIONS,
  WORK_ORDER_LIST_STATUS as STATUS,
  WORK_ORDER_LIST_STATUS_KEYS as STATUS_KEYS,
} from '../services/workOrdersListPresentation'
import type { WoListView } from '../services/workOrdersListPresentation'

export type WoPageSize = (typeof WO_PAGE_SIZE_OPTIONS)[number]

export type WorkOrdersToolbarProps = {
  createMsgClass: string
  activeFiltersClass: string
  clearFiltersBtnClass: string
  err: string | null
  createMsg: string | null
  createOpen: boolean
  onDismissCreateMsg: () => void

  statusFilter: WorkOrderStatus | ''
  vehicleIdFilter: string
  customerIdFilter: string
  textSearch: string
  vehiclePlateLabel: string
  onClearListFilters: () => void

  listView: WoListView
  onListViewChange: (v: WoListView) => void
  onSetStatus: (s: WorkOrderStatus | '') => void

  canCreateWorkOrder: boolean
  onOpenNewOrder: () => void

  showPagination: boolean
  page: number
  pageSize: WoPageSize
  total: number
  listBusy: boolean
  isSaas: boolean
  onPageChange: (n: number) => void
  onPageSizeChange: (n: WoPageSize) => void
}

export const WorkOrdersToolbar = memo(function WorkOrdersToolbar({
  createMsgClass,
  activeFiltersClass,
  clearFiltersBtnClass,
  err,
  createMsg,
  createOpen,
  onDismissCreateMsg,
  statusFilter,
  vehicleIdFilter,
  customerIdFilter,
  textSearch,
  vehiclePlateLabel,
  onClearListFilters,
  listView,
  onListViewChange,
  onSetStatus,
  canCreateWorkOrder,
  onOpenNewOrder,
  showPagination,
  page,
  pageSize,
  total,
  listBusy,
  isSaas,
  onPageChange,
  onPageSizeChange,
}: WorkOrdersToolbarProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        {canCreateWorkOrder ? (
          <button type="button" onClick={onOpenNewOrder} className="va-btn-primary">
            Nueva orden
          </button>
        ) : null}
      </div>

      {err ? <p className="va-alert-error-lg">{err}</p> : null}

      {createMsg && !createOpen ? (
        <div className={createMsgClass} role="status">
          <p>{createMsg}</p>
          <button
            type="button"
            className="shrink-0 text-sm font-medium text-brand-700 underline hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
            onClick={onDismissCreateMsg}
          >
            Cerrar aviso
          </button>
        </div>
      ) : null}

      {(statusFilter || vehicleIdFilter || customerIdFilter || textSearch) && !err ? (
        <div className={activeFiltersClass}>
          <p>
            <span className="font-medium">Filtros activos:</span>{' '}
            {textSearch ? (
              <>
                búsqueda «<span className="font-medium">{textSearch}</span>»
                {statusFilter || vehicleIdFilter || customerIdFilter ? '; ' : '.'}
              </>
            ) : null}
            {statusFilter ? (
              <>
                estado «{STATUS[statusFilter].label}»
                {vehicleIdFilter || customerIdFilter ? '; ' : '.'}
              </>
            ) : null}
            {customerIdFilter ? (
              <>
                cliente maestro <span className="font-mono text-xs">{customerIdFilter}</span>
                {vehicleIdFilter ? '; ' : '.'}
              </>
            ) : null}
            {vehicleIdFilter ? (
              <>
                vehículo{' '}
                {vehiclePlateLabel ? (
                  <span className="font-mono">{vehiclePlateLabel}</span>
                ) : (
                  <span className="font-mono text-xs">{vehicleIdFilter}</span>
                )}
                .
              </>
            ) : null}
          </p>
          <button type="button" onClick={onClearListFilters} className={clearFiltersBtnClass}>
            Quitar filtros
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Estado
          </span>
          <div
            className="va-tabstrip va-tabstrip--wrap va-tabstrip--compact max-w-full"
            role="tablist"
            aria-label="Filtrar listado por estado de orden"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!statusFilter}
              onClick={() => onSetStatus('')}
              className={`va-tab max-sm:min-h-[44px] ${!statusFilter ? 'va-tab-active' : 'va-tab-inactive'}`}
            >
              Todas
            </button>
            {STATUS_KEYS.map((key) => {
              const st = STATUS[key]
              const on = statusFilter === key
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => onSetStatus(key)}
                  className={`va-tab max-sm:min-h-[44px] ${on ? 'va-tab-active' : 'va-tab-inactive'}`}
                >
                  {st.label}
                </button>
              )
            })}
          </div>
        </div>
        <ListViewToggle value={listView} onChange={onListViewChange} />
      </div>

      {showPagination ? (
        <WoPaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          loading={listBusy}
          isSaas={isSaas}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  )
})
