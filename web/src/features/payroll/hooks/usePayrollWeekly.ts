import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthContext'
import { STALE_DASHBOARD_MS } from '../../../constants/queryStaleTime'
import { queryKeys } from '../../../lib/queryKeys'
import { WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import { currentWeekDeliveredRange, formatWeekRangeLabel } from '../../dashboard/services/weekCycle'
import { payrollWeeklyCache } from '../services/payrollCache'
import { fetchPayrollWeeklySummary } from '../services/payrollApi'

export function usePayrollWeekly() {
  const queryClient = useQueryClient()
  const { user, can } = useAuth()
  const userId = user?.id ?? 'anon'
  /** El servidor filtra por rol; el alcance fija la key para no mezclar vistas (admin vs. preview). */
  const readAll = can('payroll:read_all')

  const range = useMemo(() => currentWeekDeliveredRange(), [])
  const fromIso = range.from.toISOString()
  const toIso = range.to.toISOString()
  const queryKey = useMemo(
    () => queryKeys.payroll.weekly(fromIso, toIso, readAll),
    [fromIso, toIso, readAll],
  )
  const cached = useMemo(
    () => payrollWeeklyCache.read(userId, fromIso, toIso, readAll),
    [userId, fromIso, toIso, readAll],
  )

  useEffect(() => {
    const onChanged = () => {
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.payroll.root] })
    }
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
  }, [queryClient])

  const query = useQuery({
    queryKey,
    // queryFn solo corre ante respuestas reales del servidor → cachear ahí (nunca el placeholder initialData).
    queryFn: ({ signal }) =>
      fetchPayrollWeeklySummary(range.from, range.to, signal).then((data) => {
        payrollWeeklyCache.write(userId, fromIso, toIso, readAll, data)
        return data
      }),
    staleTime: STALE_DASHBOARD_MS,
    initialData: cached?.value,
    initialDataUpdatedAt: cached?.savedAt,
  })

  return {
    from: range.from,
    to: range.to,
    weekRangeLabel: formatWeekRangeLabel(range.from, range.to),
    summary: query.data ?? null,
    isLoading: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  }
}