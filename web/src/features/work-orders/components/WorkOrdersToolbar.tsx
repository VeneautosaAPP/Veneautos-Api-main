import { Fragment, memo } from 'react'
import type { ReactNode } from 'react'
import type { WorkOrderStatus } from '../../../api/types'
import { WoPaginationBar } from './WoPaginationBar'
import {
  WO_PAGE_SIZE_OPTIONS,
  WORK_ORDER_LIST_STATUS as STATUS,
} from '../services/workOrdersListPresentation'
import { formatDeliveredRangeLabel } from '../services/workOrdersDateRange'

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
  deliveredFromIso: string
  deliveredToIso: string
  onClearListFilters: () => void

  onSetStatus: (s: WorkOrderStatus | '') => void
  onSetTextSearch: (next: string) => void
  onSetDeliveredFrom: (iso: string) => void
  onSetDeliveredTo: (iso: string) => void

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
  deliveredFromIso,
  deliveredToIso,
  onClearListFilters,
  onSetStatus,
  onSetTextSearch,
  onSetDeliveredFrom,
  onSetDeliveredTo,
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
  const deliveredRangeLabel = formatDeliveredRangeLabel(deliveredFromIso, deliveredToIso)
  const activeFilterChips: ReactNode[] = []
  if (textSearch) {
    activeFilterChips.push(
      <>
        búsqueda «<span className="font-medium">{textSearch}</span>»
      </>,
    )
  }
  if (statusFilter) {
    activeFilterChips.push(<>estado «{STATUS[statusFilter].label}»</>)
  }
  if (customerIdFilter) {
    activeFilterChips.push(
      <>
        cliente maestro <span className="font-mono text-xs">{customerIdFilter}</span>
      </>,
    )
  }
  if (vehicleIdFilter) {
    activeFilterChips.push(
      <>
        vehículo{' '}
        {vehiclePlateLabel ? (
          <span className="font-mono">{vehiclePlateLabel}</span>
        ) : (
          <span className="font-mono text-xs">{vehicleIdFilter}</span>
        )}
      </>,
    )
  }
  if (deliveredRangeLabel) {
    activeFilterChips.push(
      <>
        entrega <span className="font-medium">{deliveredRangeLabel}</span>
      </>,
    )
  }

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

      {activeFilterChips.length > 0 && !err ? (
        <div className={activeFiltersClass}>
          <p>
            <span className="font-medium">Filtros activos:</span>{' '}
            {activeFilterChips.map((chip, i) => (
              <Fragment key={i}>
                {chip}
                {i < activeFilterChips.length - 1 ? '; ' : '.'}
              </Fragment>
            ))}
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
          deliveredFromIso={deliveredFromIso}
          deliveredToIso={deliveredToIso}
          onDeliveredFromChange={onSetDeliveredFrom}
          onDeliveredToChange={onSetDeliveredTo}
          canCreateWorkOrder={canCreateWorkOrder}
          onOpenNewOrder={onOpenNewOrder}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  )
})
