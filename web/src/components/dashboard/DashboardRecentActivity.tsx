import { LocateFixed } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardModule } from './dashboardTypes'

export type DashboardRecentActivityProps = {
  resumeModule: DashboardModule | null
  /** Accesos rápidos ya filtrados (sin duplicar resume si aplica). */
  quickActions: DashboardModule[]
}

/**
 * Continuar último módulo + enlaces rápidos (equivalente a “actividad reciente” en este dashboard).
 */
export const DashboardRecentActivity = memo(function DashboardRecentActivity({
  resumeModule,
  quickActions,
}: DashboardRecentActivityProps) {
  if (!resumeModule && quickActions.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {resumeModule ? (
        <Link
          to={resumeModule.to}
          className="inline-flex max-w-full min-h-[40px] flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-brand-500 dark:bg-brand-950 dark:text-brand-50 dark:hover:bg-brand-900 dark:focus-visible:ring-offset-slate-900"
        >
          <LocateFixed className="size-6 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 break-words">Continuar: {resumeModule.title}</span>
        </Link>
      ) : null}
      {quickActions.map((action) => {
        const Icon = action.icon
        return (
          <Link
            key={action.to}
            to={action.to}
            className="inline-flex max-w-full min-h-[40px] flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-200 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:text-brand-200 dark:focus-visible:ring-offset-slate-900"
          >
            <Icon className="size-6 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 break-words">{action.title}</span>
          </Link>
        )
      })}
    </div>
  )
})
