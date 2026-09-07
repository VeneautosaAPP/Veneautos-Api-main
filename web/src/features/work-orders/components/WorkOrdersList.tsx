import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { WorkOrderSummary } from '../../../api/types'
import { portalPath } from '../../../constants/portalPath'
import {
  formatColombianPlateDisplay,
  formatWorkOrderListDate,
  WO_GRID_PLATE_RIVET_CLASS,
  WO_WARRANTY_BADGE_CLASS,
  WORK_ORDER_LIST_STATUS as STATUS,
  type WoListView,
} from '../services/workOrdersListPresentation'

export type WorkOrdersListProps = {
  rows: WorkOrderSummary[] | null
  listView: WoListView
  canViewWoFinancials: boolean
  selectedIds: ReadonlySet<string>
  toggleSelect: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  /** Prefetch de detalle (hover/focus) para abrir la OT al instante. */
  onPrefetchWorkOrder?: (id: string) => void
}

const WoSelectCheckbox = memo(function WoSelectCheckbox({
  id,
  selected,
  toggleSelect,
}: {
  id: string
  selected: boolean
  toggleSelect: (id: string) => void
}) {
  return (
    <label className="flex shrink-0 cursor-pointer items-start pt-1">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 dark:border-slate-500"
        checked={selected}
        onChange={() => toggleSelect(id)}
        onClick={(e) => e.stopPropagation()}
      />
    </label>
  )
})

/**
 * Listado de órdenes (grid / lista / detalle). Solo render; el filtrado sigue en el hook/página.
 * `memo`: evita reconciliar el map cuando el padre cambia por modales u otros estados.
 */
export const WorkOrdersList = memo(function WorkOrdersList({
  rows,
  listView,
  selectedIds,
  toggleSelect,
  selectAll,
  clearSelection,
  onPrefetchWorkOrder,
}: WorkOrdersListProps) {
  const ulClass =
    listView === 'grid'
      ? 'grid gap-2 grid-cols-1 items-stretch sm:grid-cols-2 lg:grid-cols-4'
      : listView === 'list'
        ? 'divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200/90 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900'
        : 'space-y-2'

  const showBulk = rows != null && rows.length > 0

  return (
    <div className="space-y-3">
      {showBulk ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 text-sm dark:border-slate-700">
          <button type="button" className="va-btn-secondary !min-h-0 px-3 py-1.5 text-xs" onClick={selectAll}>
            Seleccionar página
          </button>
          <button
            type="button"
            className="va-btn-secondary !min-h-0 px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={clearSelection}
            disabled={selectedIds.size === 0}
          >
            Limpiar selección
          </button>
          {selectedIds.size > 0 ? (
            <span className="text-slate-600 dark:text-slate-300">
              {selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ) : null}
      <ul className={ulClass}>
      {rows?.map((wo) => {
        const st = STATUS[wo.status]
        const warrantyBadge = wo.parentWorkOrder ? (
          <span className={WO_WARRANTY_BADGE_CLASS}>Garantía</span>
        ) : null

        if (listView === 'list') {
          return (
            <li key={wo.id} className="flex gap-2">
              <WoSelectCheckbox id={wo.id} selected={selectedIds.has(wo.id)} toggleSelect={toggleSelect} />
              <Link
                to={portalPath(`/ordenes/${wo.id}`)}
                onPointerEnter={() => onPrefetchWorkOrder?.(wo.id)}
                onFocus={() => onPrefetchWorkOrder?.(wo.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 border-l-4 px-3 py-2 text-left transition hover:bg-slate-50/90 dark:hover:bg-slate-800/70 ${st.listRow}`}
              >
                <div className="flex w-[5.5rem] shrink-0 flex-col gap-0.5">
                  <span className="text-[11px] font-semibold leading-tight tracking-tight text-slate-800 dark:text-slate-100">
                    {wo.publicCode}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">#{wo.orderNumber}</span>
                  {warrantyBadge}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight text-slate-900 dark:text-slate-50">
                    {wo.description}
                  </p>
                  <p className="truncate text-[11px] leading-tight text-slate-500 dark:text-slate-300">
                    {[wo.customerName, wo.vehiclePlate, wo.assignedTo?.fullName ? wo.assignedTo.fullName : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.badge}`}>
                  {st.label}
                </span>
              </Link>
            </li>
          )
        }

        if (listView === 'details') {
          return (
            <li key={wo.id} className="flex gap-2">
              <WoSelectCheckbox id={wo.id} selected={selectedIds.has(wo.id)} toggleSelect={toggleSelect} />
              <Link
                to={portalPath(`/ordenes/${wo.id}`)}
                onPointerEnter={() => onPrefetchWorkOrder?.(wo.id)}
                onFocus={() => onPrefetchWorkOrder?.(wo.id)}
                className={`block min-w-0 flex-1 rounded-xl border border-slate-200/90 border-l-4 p-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:hover:border-brand-600 ${st.cardBody}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                      {wo.publicCode}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">#{wo.orderNumber}</span>
                    {warrantyBadge}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.badge}`}>
                    {st.label}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-slate-900 dark:text-slate-50">
                  {wo.description}
                </p>
                <dl className="mt-2 grid gap-x-3 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-2 dark:text-slate-300">
                  <div className="min-w-0">
                    <dt className="text-slate-400 dark:text-slate-500">Alta</dt>
                    <dd className="truncate font-medium text-slate-800 dark:text-slate-100">
                      {formatWorkOrderListDate(wo.createdAt)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-slate-400 dark:text-slate-500">Técnico</dt>
                    <dd className="truncate font-medium text-slate-800 dark:text-slate-100">
                      {wo.assignedTo?.fullName ?? '—'}
                    </dd>
                  </div>
                  {wo.customerName ? (
                    <div className="min-w-0 sm:col-span-1">
                      <dt className="text-slate-400 dark:text-slate-500">Cliente</dt>
                      <dd className="truncate font-medium text-slate-800 dark:text-slate-100">{wo.customerName}</dd>
                    </div>
                  ) : null}
                  {wo.vehiclePlate ? (
                    <div>
                      <dt className="text-slate-400 dark:text-slate-500">Patente</dt>
                      <dd>
                        <span className="rounded bg-slate-100 px-1 py-0 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                          {wo.vehiclePlate}
                        </span>
                      </dd>
                    </div>
                  ) : null}
                  {wo.parentWorkOrder ? (
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="text-slate-400 dark:text-slate-500">Orden origen (garantía)</dt>
                      <dd className="truncate font-medium text-slate-800 dark:text-slate-100">
                        {wo.parentWorkOrder.publicCode}{' '}
                        <span className="font-mono text-[10px] font-normal text-slate-400 dark:text-slate-500">
                          #{wo.parentWorkOrder.orderNumber}
                        </span>{' '}
                        <span className="font-normal text-slate-500 dark:text-slate-300">
                          ({STATUS[wo.parentWorkOrder.status].label})
                        </span>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </Link>
            </li>
          )
        }

        return (
          <li key={wo.id} className="flex min-h-0 gap-2">
            <WoSelectCheckbox id={wo.id} selected={selectedIds.has(wo.id)} toggleSelect={toggleSelect} />
            <Link
              to={portalPath(`/ordenes/${wo.id}`)}
              onPointerEnter={() => onPrefetchWorkOrder?.(wo.id)}
              onFocus={() => onPrefetchWorkOrder?.(wo.id)}
              className={`flex h-full min-h-[10.5rem] min-w-0 flex-1 flex-col rounded-xl border border-slate-200/90 border-l-4 p-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:hover:border-brand-600 ${st.cardBody}`}
            >
              <div className="flex shrink-0 items-start justify-between gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                    {wo.publicCode}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">#{wo.orderNumber}</span>
                  {warrantyBadge}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.badge}`}>
                  {st.label}
                </span>
              </div>
              <p className="mt-1 min-h-0 flex-1 text-sm font-medium leading-snug text-slate-900 line-clamp-2 dark:text-slate-50">
                {wo.description}
              </p>
              <div className="mt-auto flex shrink-0 items-end justify-between gap-2 pt-2">
                <div className="min-w-0 flex-1 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-300">
                  {wo.customerName ? (
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{wo.customerName}</p>
                  ) : null}
                  <p className="text-slate-600 dark:text-slate-300">
                    Téc.: {wo.assignedTo?.fullName ?? '—'}
                  </p>
                </div>
                {wo.vehiclePlate ? (
                  <span
                    className="relative inline-flex shrink-0 items-center justify-center rounded-[10px] border-2 border-black bg-[#EBC012] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35),0_3px_0_rgba(0,0,0,0.28)]"
                    title="Patente"
                  >
                    <span className={`${WO_GRID_PLATE_RIVET_CLASS} left-1 top-1`} aria-hidden />
                    <span className={`${WO_GRID_PLATE_RIVET_CLASS} right-1 top-1`} aria-hidden />
                    <span className={`${WO_GRID_PLATE_RIVET_CLASS} bottom-1 left-1`} aria-hidden />
                    <span className={`${WO_GRID_PLATE_RIVET_CLASS} bottom-1 right-1`} aria-hidden />
                    <span className="relative z-[1] text-center font-sans text-[15px] font-black uppercase leading-none tracking-[0.14em] text-black [font-stretch:condensed] [text-shadow:0_1px_0_rgba(255,255,255,0.35)] sm:text-[16px]">
                      {formatColombianPlateDisplay(wo.vehiclePlate)}
                    </span>
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
    </div>
  )
})
