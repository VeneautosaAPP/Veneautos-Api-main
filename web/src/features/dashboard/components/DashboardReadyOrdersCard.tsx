import { Link } from 'react-router-dom'
import { ArrowRight, ListChecks } from 'lucide-react'
import { useAuth } from '../../../auth/AuthContext'
import { panelUsesModernShell } from '../../../config/operationalNotes'
import { portalPath } from '../../../constants/portalPath'
import { usePanelTheme } from '../../../theme/PanelThemeProvider'
import { formatCopFromString } from '../../../utils/copFormat'
import { useDashboardReadyOrders } from '../hooks/useDashboardReadyOrders'

const CARD_CLASS = (isSaas: boolean) =>
  isSaas
    ? 'va-saas-module-card block'
    : 'block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-amber-600 dark:focus-visible:ring-offset-slate-900'

export function DashboardReadyOrdersCard() {
  const { can } = useAuth()
  const isSaas = panelUsesModernShell(usePanelTheme())
  const { count, totalValue, isLoading, isError } = useDashboardReadyOrders()

  if (!can('work_orders:read')) return null

  const countValue = isLoading ? '…' : isError || count == null ? '—' : String(count)
  const amountValue =
    isLoading || count == null
      ? '…'
      : isError || totalValue == null
        ? null
        : `$${formatCopFromString(totalValue)}`

  return (
    <Link
      to={`${portalPath('/ordenes')}?status=READY`}
      className={CARD_CLASS(isSaas)}
      aria-label={`Órdenes listas para entrega: ${countValue}${
        amountValue ? `, valor total ${amountValue}` : ''
      }. Ver listado.`}
    >
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Listas
            </p>
            <p className="mt-1 text-base font-medium text-slate-800 dark:text-slate-100">
              Órdenes listas para entrega
            </p>
          </div>
          <span className="shrink-0 rounded-xl bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <ListChecks className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
        </div>
        <div>
          <p
            className={`text-4xl font-bold tabular-nums leading-none text-slate-900 dark:text-white ${
              isLoading ? 'animate-pulse' : ''
            }`}
          >
            {countValue}
          </p>
          {amountValue ? (
            <p className="mt-2 text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">
              {amountValue}{' '}
              <span className="font-normal text-slate-500 dark:text-slate-400">valor total</span>
            </p>
          ) : null}
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300">
            Ver listado
            <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
          </p>
        </div>
      </div>
    </Link>
  )
}