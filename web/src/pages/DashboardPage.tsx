import { lazy, Suspense } from 'react'
import { PageHeader } from '../components/layout/PageHeader'
import { DashboardRecentActivity } from '../components/dashboard/DashboardRecentActivity'
import { DashboardStats } from '../components/dashboard/DashboardStats'
import { useDashboardModules } from '../features/dashboard/hooks/useDashboardModules'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'

const DashboardCharts = lazy(() =>
  import('../components/dashboard/DashboardCharts').then((m) => ({ default: m.DashboardCharts })),
)
const DashboardModuleSections = lazy(() =>
  import('../components/dashboard/DashboardModuleSections').then((m) => ({
    default: m.DashboardModuleSections,
  })),
)

function DashboardChunkFallback() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      Cargando…
    </div>
  )
}

export function DashboardPage() {
  const d = useDashboardModules()
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)

  const cardClass = isSaas
    ? 'group va-saas-module-card'
    : 'group min-h-[9.5rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-900 dark:focus-visible:ring-offset-slate-900'
  const mutedCardClass =
    'rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
  const sectionClass = isSaas ? 'va-saas-page-section' : 'space-y-3'

  const {
    user,
    visibleSections,
    orderedSections,
    cashSessionOpen,
    totalModules,
    enabledModules,
    blockedCount,
    quickActions,
    resumeModule,
    quickActionsWithoutResume,
    todayFocus,
    lockedToday,
  } = d

  if (visibleSections.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Panel principal"
          description={`Hola, ${user?.fullName ?? 'equipo'}. No hay módulos visibles con tus permisos actuales.`}
        />
        <div className={mutedCardClass}>
          Pedile a un administrador que te asigne permisos para ver las secciones operativas.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 lg:space-y-7">
      <PageHeader
        title="Panel principal"
        description={
          <>
            <p className="break-words">Accesos rápidos por módulo para optimizar el flujo diario del taller.</p>
            {quickActions.length > 0 ? (
              <DashboardRecentActivity resumeModule={resumeModule} quickActions={quickActionsWithoutResume} />
            ) : null}
            <DashboardStats
              totalModules={totalModules}
              enabledModules={enabledModules}
              blockedCount={blockedCount}
            />
          </>
        }
      />

      <Suspense fallback={<DashboardChunkFallback />}>
        <DashboardCharts
          todayFocus={todayFocus}
          lockedToday={lockedToday}
          cashSessionOpen={cashSessionOpen}
          sectionClass={sectionClass}
          cardClass={cardClass}
        />
      </Suspense>

      <Suspense fallback={<DashboardChunkFallback />}>
        <DashboardModuleSections
          sections={orderedSections}
          sectionClass={sectionClass}
          cardClass={cardClass}
          mutedCardClass={mutedCardClass}
        />
      </Suspense>
    </div>
  )
}
