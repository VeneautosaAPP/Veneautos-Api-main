import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../components/layout/PageHeader'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'
import { PayrollPercentageCalculator } from '../features/payroll/components/PayrollPercentageCalculator'
import { NominaMechanicCard } from '../features/payroll/components/NominaMechanicCard'
import { usePayrollWeekly } from '../features/payroll/hooks/usePayrollWeekly'
import { queryKeys } from '../lib/queryKeys'
import { updatePayrollCommissionPct } from '../features/payroll/services/payrollApi'
import { formatCopInteger } from '../utils/copFormat'

export function NominaPage() {
  const { can, user } = useAuth()
  const queryClient = useQueryClient()
  const { weekRangeLabel, summary, isLoading, isError, refetch } = usePayrollWeekly()

  const isSaas = panelUsesModernShell(usePanelTheme())
  const canEdit = can('payroll:read_all')

  /** % de nómina por OT (solo las editadas; el resto usa el valor del servidor). */
  const [pctByOrder, setPctByOrder] = useState<Record<string, number>>(() => ({}))
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set())

  const summaryRef = useRef(summary)
  useEffect(() => {
    summaryRef.current = summary
  }, [summary])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const failedClear = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const handlePercentChange = useCallback(
    (orderId: string, pct: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(pct * 100) / 100))
      setPctByOrder((prev) => {
        if (prev[orderId] === clamped) return prev
        return { ...prev, [orderId]: clamped }
      })

      if (timers.current[orderId]) clearTimeout(timers.current[orderId])
      timers.current[orderId] = setTimeout(() => {
        const value = clamped
        setSavingIds((prev) => new Set(prev).add(orderId))
        updatePayrollCommissionPct(orderId, value)
          .then(() => {
            setSavingIds((prev) => {
              const next = new Set(prev)
              next.delete(orderId)
              return next
            })
            void queryClient.invalidateQueries({ queryKey: [...queryKeys.payroll.root] })
          })
          .catch(() => {
            setSavingIds((prev) => {
              const next = new Set(prev)
              next.delete(orderId)
              return next
            })
            const server = summaryRef.current?.mechanics
              .flatMap((m) => m.orders)
              .find((o) => o.id === orderId)
            const fallback = Number(server?.commissionPct)
            if (Number.isFinite(fallback)) {
              setPctByOrder((prev) => (prev[orderId] === value ? { ...prev, [orderId]: fallback } : prev))
            }
            setFailedIds((prev) => new Set(prev).add(orderId))
            if (failedClear.current[orderId]) clearTimeout(failedClear.current[orderId])
            failedClear.current[orderId] = setTimeout(() => {
              setFailedIds((prev) => {
                const next = new Set(prev)
                next.delete(orderId)
                return next
              })
            }, 4000)
          })
      }, 600)
    },
    [queryClient],
  )

  useEffect(() => {
    const t = timers.current
    const f = failedClear.current
    return () => {
      Object.values(t).forEach(clearTimeout)
      Object.values(f).forEach(clearTimeout)
    }
  }, [])

  if (!can('payroll:read')) {
    return (
      <div className="va-alert-error-block">
        No tenés acceso a la nómina. Consultá a un administrador o dueño del taller.
      </div>
    )
  }

  /** Suma del a pagar de todas las nóminas, en vivo con los % editados (igual que las tarjetas). */
  const totalNomina = (summary?.mechanics ?? []).reduce((sum, m) => {
    for (const o of m.orders) {
      const labor = Number(o.laborTotal)
      if (!Number.isFinite(labor)) continue
      const pct = pctByOrder[o.id] ?? (Number(o.commissionPct) || 50)
      sum += Math.round((labor * pct) / 100)
    }
    return sum
  }, 0)

  const banner = summary ? (
    <div
      className={isSaas ? 'va-saas-page-hero' : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5'}
      style={isSaas ? { paddingTop: 12, paddingBottom: 12 } : undefined}
    >
      <div className="grid w-full grid-cols-1 divide-y divide-slate-200 xl:grid-cols-3 xl:items-center xl:divide-y-0 xl:divide-x dark:divide-slate-700">
        <div className="min-w-0 first:pt-0 pt-4 xl:pt-0 xl:pr-6">
          <p className="va-page-eyebrow">Semana lunes–sábado</p>
          <h1 className="va-page-title">Nómina</h1>
          <p className="va-page-desc">
            {weekRangeLabel}
            {summary.isOwnOnly ? ' Estás viendo tu propia nómina.' : ''}
          </p>
        </div>
        <div className="min-w-0 pt-4 xl:pt-0 xl:px-8">
          <PayrollPercentageCalculator ratePercent={50} compact />
        </div>
        <div className="flex items-center justify-center pt-4 xl:pt-0 xl:pl-6">
          <p className="text-center">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total nómina
            </span>
            <span className="block text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
              ${formatCopInteger(totalNomina)}
            </span>
          </p>
        </div>
      </div>
    </div>
  ) : (
    <PageHeader eyebrow="Semana lunes–sábado" title="Nómina" description={weekRangeLabel} />
  )

  const loadingOrError = isError || !summary

  return (
    <div className="space-y-6">
      {banner}
      {isLoading && !summary
        ? (
          <p className="text-slate-500 dark:text-slate-400">Cargando nómina…</p>
        )
        : loadingOrError
          ? (
            <div className="space-y-3">
              <p className="va-alert-error" role="alert">
                No se pudo cargar la nómina de la semana.
              </p>
              <button type="button" className="va-btn-secondary" onClick={() => void refetch()}>
                Reintentar
              </button>
            </div>
          )
          : summary.mechanics.length === 0
            ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                No hay mecánicos con entregas esta semana. La nómina solo considera órdenes entregadas de lunes a
                sábado.
              </p>
            )
            : (
              <div className="grid gap-4">
                {summary.mechanics.map((m) => (
                  <NominaMechanicCard
                    key={m.mechanicId}
                    mechanic={m}
                    pctByOrder={pctByOrder}
                    canEdit={canEdit}
                    onChangePercent={handlePercentChange}
                    savingIds={savingIds}
                    failedIds={failedIds}
                  />
                ))}
              </div>
            )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {user?.fullName ? `Sesión: ${user.fullName}. ` : ''}
        {canEdit
          ? 'El porcentaje de cada OT se guarda automáticamente en el servidor.'
          : 'Estás viendo tu nómina en solo lectura; el porcentaje lo define el dueño o administrador.'}
      </p>
    </div>
  )
}