import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardModule } from './dashboardTypes'

export type DashboardChartsProps = {
  /** Tarjetas destacadas “operación diaria” habilitadas. */
  todayFocus: DashboardModule[]
  lockedToday: DashboardModule[]
  cashSessionOpen: boolean | null
  sectionClass: string
  cardClass: string
}

/**
 * Bloque “En foco hoy”: prioridades operativas + aviso de módulos bloqueados (no hay gráficos chart.js en este panel).
 */
export const DashboardCharts = memo(function DashboardCharts({
  todayFocus,
  lockedToday,
  cashSessionOpen,
  sectionClass,
  cardClass,
}: DashboardChartsProps) {
  if (todayFocus.length === 0) return null

  return (
    <section className={sectionClass}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="va-section-title">En foco hoy</h2>
          <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-slate-500 dark:text-slate-300">
            Prioridades operativas sugeridas para esta sesión.
          </p>
        </div>
        <span className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200">
          {cashSessionOpen ? 'Caja abierta' : 'Caja cerrada'}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {todayFocus.map((module) => {
          const Icon = module.icon
          return (
            <Link key={`focus-${module.to}`} to={module.to} className={cardClass}>
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200">
                  <Icon className="size-7" strokeWidth={1.65} aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{module.title}</p>
                  <p className="mt-1 text-sm leading-snug text-slate-600 dark:text-slate-300 [overflow-wrap:anywhere]">
                    {module.description}
                  </p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      {lockedToday.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {lockedToday.map((module) => module.hint).filter(Boolean).join(' · ')}
        </div>
      )}
    </section>
  )
})
