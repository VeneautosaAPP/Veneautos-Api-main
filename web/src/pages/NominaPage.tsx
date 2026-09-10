import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../components/layout/PageHeader'
import { NominaMechanicCard } from '../features/payroll/components/NominaMechanicCard'
import { usePayrollWeekly } from '../features/payroll/hooks/usePayrollWeekly'

export function NominaPage() {
  const { can, user } = useAuth()
  const { weekRangeLabel, summary, isLoading, isError, refetch } = usePayrollWeekly()

  if (!can('payroll:read')) {
    return (
      <div className="va-alert-error-block">
        No tenés acceso a la nómina. Consultá a un administrador o dueño del taller.
      </div>
    )
  }

  const pageHeader = (
    <PageHeader
      eyebrow="Semana lunes–sábado"
      title="Nómina"
      description={`${weekRangeLabel}. Se paga el 50% de la mano de obra (sin IVA) de las órdenes entregadas. ${
        summary?.isOwnOnly ? 'Estás viendo tu propia nómina.' : 'Estás viendo la nómina de todos los mecánicos.'
      }`}
    />
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <p className="text-slate-500 dark:text-slate-400">Cargando nómina…</p>
      </div>
    )
  }

  if (isError || !summary) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <p className="va-alert-error" role="alert">
          No se pudo cargar la nómina de la semana.
        </p>
        <button type="button" className="va-btn-secondary" onClick={() => void refetch()}>
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {pageHeader}
      {summary.mechanics.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No hay mecánicos con entregas esta semana. La nómina solo considera órdenes entregadas de lunes a
          sábado.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {summary.mechanics.map((m) => (
            <NominaMechanicCard
              key={m.mechanicId}
              mechanic={m}
              ratePercent={Math.round(Number(summary.rate) * 100)}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {user?.fullName ? `Sesión: ${user.fullName}. ` : ''}
        Esta vista es informativa; el pago se concilia aparte con cada mecánico.
      </p>
    </div>
  )
}