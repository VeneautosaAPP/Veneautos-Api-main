import { memo } from 'react'
import type { WorkOrderStatus } from '../../../api/types'
import { WoPaginationBar } from './WoPaginationBar'
import {
  WO_PAGE_SIZE_OPTIONS,
  WORK_ORDER_LIST_STATUS as STATUS,
} from '../services/workOrdersListPresentation'

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

  onSetStatus: (s: WorkOrderStatus | '') => void
  onSetTextSearch: (next: string) => void

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
  onSetStatus,
  onSetTextSearch,
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

      {showPagination ? (
        <WoPaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          loading={listBusy}
          isSaas={isSaas}
          statusFilter={statusFilter}
          onStatusChange={onSetStatus}
          textSearch={textSearch}
          onSearchChange={onSetTextSearch}
          canCreateWorkOrder={canCreateWorkOrder}
          onOpenNewOrder={onOpenNewOrder}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  )
})
