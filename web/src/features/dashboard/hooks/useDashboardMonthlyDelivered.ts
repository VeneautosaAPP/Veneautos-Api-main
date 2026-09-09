import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthContext'
import { STALE_DASHBOARD_MS } from '../../../constants/queryStaleTime'
import { queryKeys } from '../../../lib/queryKeys'
import { WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import { fetchMonthlyDeliveredSummary } from '../../work-orders/services/workOrdersListApi'
import { monthlyDeliveredCache } from '../services/dashboardCache'
import { currentMonthDeliveredRange } from '../services/monthCycle'

export function useDashboardMonthlyDelivered() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const range = useMemo(() => currentMonthDeliveredRange(), [])
  const fromIso = range.from.toISOString()
  const toIso = range.to.toISOString()
  const queryKey = useMemo(
    () => queryKeys.dashboard.monthlyDelivered(fromIso, toIso),
    [fromIso, toIso],
  )
  const cached = useMemo(
    () => monthlyDeliveredCache.read(userId, fromIso, toIso),
    [userId, fromIso, toIso],
  )

  useEffect(() => {
    const onChanged = () => {
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.dashboard.root, 'work-orders'] })
    }
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
  }, [queryClient])

  const query = useQuery({
    queryKey,
    // queryFn solo corre ante respuestas reales del servidor → cachear ahí (nunca el placeholder initialData).
    queryFn: ({ signal }) =>
      fetchMonthlyDeliveredSummary(range.from, range.to, signal).then((data) => {
        monthlyDeliveredCache.write(userId, fromIso, toIso, data)
        return data
      }),
    staleTime: STALE_DASHBOARD_MS,
    initialData: cached?.value,
    initialDataUpdatedAt: cached?.savedAt,
  })

  return {
    from: range.from,
    to: range.to,
    count: query.data?.count ?? null,
    paymentsTotal: query.data?.paymentsTotal ?? null,
    isLoading: query.isPending,
    isError: query.isError,
  }
}