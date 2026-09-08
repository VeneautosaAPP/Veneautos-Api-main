import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { WorkOrderSummary } from '../../../api/types'
import { portalPath } from '../../../constants/portalPath'
import {
  formatColombianPlateDisplay,
  WO_GRID_PLATE_RIVET_CLASS,
  WO_WARRANTY_BADGE_CLASS,
  WORK_ORDER_LIST_STATUS as STATUS,
} from '../services/workOrdersListPresentation'

function formatDate(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('es-CO')
  } catch {
    return null
  }
}

export type WorkOrdersListProps = {
  rows: WorkOrderSummary[] | null
  /** Prefetch de detalle (hover/focus) para abrir la OT al instante. */
  onPrefetchWorkOrder?: (id: string) => void
}

/**
 * Listado de órdenes. Solo render; el filtrado sigue en el hook/página.
 * `memo`: evita reconciliar el map cuando el padre cambia por modales u otros estados.
 */
export const WorkOrdersList = memo(function WorkOrdersList({
  rows,
  onPrefetchWorkOrder,
}: WorkOrdersListProps) {
  const ulClass = 'grid gap-2 grid-cols-1 items-stretch sm:grid-cols-2 lg:grid-cols-4'

  return (
    <div className="space-y-3">
      <ul className={ulClass}>
        {rows?.map((wo) => {
          const st = STATUS[wo.status]
          const warrantyBadge = wo.parentWorkOrder ? (
            <span className={WO_WARRANTY_BADGE_CLASS}>Garantía</span>
          ) : null

          return (
            <li key={wo.id} className="flex min-h-0">
              <Link
                to={portalPath(`/ordenes/${wo.id}`)}
                onPointerEnter={() => onPrefetchWorkOrder?.(wo.id)}
                onFocus={() => onPrefetchWorkOrder?.(wo.id)}
                className={`flex h-full min-h-[10.5rem] min-w-0 flex-1 flex-col rounded-xl border border-slate-200 border-l-4 p-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:hover:border-brand-600 ${st.cardBody}`}
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
                <div className="mt-1 shrink-0 space-y-0.5 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                  <p>Creación: {formatDate(wo.createdAt)}</p>
                  {(wo.status === 'DELIVERED' || wo.status === 'CANCELLED') && (
                    <p>Cierre: {formatDate(wo.deliveredAt ?? wo.cancelledAt)}</p>
                  )}
                </div>
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