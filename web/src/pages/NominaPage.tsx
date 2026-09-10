import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../components/layout/PageHeader'
import { PayrollPercentageCalculator } from '../features/payroll/components/PayrollPercentageCalculator'
import { NominaMechanicCard } from '../features/payroll/components/NominaMechanicCard'
import { usePayrollWeekly } from '../features/payroll/hooks/usePayrollWeekly'
import { queryKeys } from '../lib/queryKeys'
import { updatePayrollCommissionPct } from '../features/payroll/services/payrollApi'

export function NominaPage() {
  const { can, user } = useAuth()
  const queryClient = useQueryClient()
  const { weekRangeLabel, summary, isLoading, isError, refetch } = usePayrollWeekly()

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

  const pageHeader = (
    <PageHeader
      eyebrow="Semana lunes–sábado"
      title="Nómina"
      description={`${weekRangeLabel}. Se paga un porcentaje configurable de la mano de obra (sin IVA) por orden entregada. ${
        summary?.isOwnOnly ? 'Estás viendo tu propia nómina.' : 'Estás viendo la nómina de todos los mecánicos.'
      }`}
    />
  )

  const calculator = <PayrollPercentageCalculator ratePercent={50} />

  const loadingOrError = isError || !summary

  return (
    <div className="space-y-6">
      {pageHeader}
      {calculator}
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
              <div className="grid gap-4 lg:grid-cols-2">
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