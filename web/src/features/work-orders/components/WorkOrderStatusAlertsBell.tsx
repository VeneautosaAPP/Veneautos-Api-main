import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../auth/AuthContext'
import { portalPath } from '../../../constants/portalPath'
import { WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import type { AlertPipelineStatus } from '../services/alertPipeline'
import { WO_ALERT_ROWS, WO_STATUS_TITLE_ES } from '../services/alertPipeline'
import { fetchWorkOrderStatusTotal } from '../services/workOrderAlertsApi'

export function WorkOrderStatusAlertsBell({
  iconButtonClassName,
}: {
  iconButtonClassName: string
}) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [counts, setCounts] = useState<Partial<Record<AlertPipelineStatus, number>>>({})
  const [loading, setLoading] = useState(false)

  const allowed = can('work_orders:read') || can('work_orders:read_portal')

  const loadCounts = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    try {
      const results = await Promise.all(
        WO_ALERT_ROWS.map(async ({ status }) => {
          const total = await fetchWorkOrderStatusTotal(status)
          return [status, total] as const
        }),
      )
      setCounts(Object.fromEntries(results) as Record<AlertPipelineStatus, number>)
    } catch {
      setCounts({})
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

  useEffect(() => {
    if (!allowed) return
    const onWoChanged = () => void loadCounts()
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onWoChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onWoChanged)
  }, [allowed, loadCounts])

  useEffect(() => {
    if (!open) return
    void loadCounts()
  }, [open, loadCounts])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const badgeTotal = WO_ALERT_ROWS.reduce((acc, { status }) => {
    const n = counts[status]
    return acc + (typeof n === 'number' ? n : 0)
  }, 0)

  if (!allowed) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={`relative ${iconButtonClassName}`}
        title="Órdenes pendientes (hasta entrega)"
        aria-label="Órdenes pendientes hasta entrega"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
        {badgeTotal > 0 ? (
          <span className="absolute -right-1 -top-1 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-none text-white dark:bg-brand-500">
            {badgeTotal > 99 ? '99+' : badgeTotal}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Órdenes pendientes por estado"
          className="absolute right-0 top-[calc(100%+0.35rem)] z-[80] w-[min(calc(100vw-1.5rem),20rem)] rounded-xl border border-slate-200 bg-white py-2 shadow-lg dark:border-slate-600 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-3 pb-2 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Pendientes hasta entrega
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              El número baja cuando marcás la OT como entregada; no al abrir el listado.
            </p>
            {loading ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Actualizando…</p>
            ) : null}
          </div>
          <ul className="max-h-[min(70vh,22rem)] overflow-y-auto py-1">
            {WO_ALERT_ROWS.map(({ status, description }) => {
              const n = counts[status]
              const display = typeof n === 'number' ? n : '—'
              return (
                <li key={status}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      void navigate(`${portalPath('/ordenes')}?status=${encodeURIComponent(status)}`)
                    }}
                  >
                    <span className="min-w-[2.25rem] shrink-0 tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {display}
                    </span>
                    <span className="min-w-0 leading-snug text-slate-600 dark:text-slate-300">
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {WO_STATUS_TITLE_ES[status]}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                        {description}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
