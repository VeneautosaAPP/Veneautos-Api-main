import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthContext'
import { STALE_DASHBOARD_MS } from '../../../constants/queryStaleTime'
import { queryKeys } from '../../../lib/queryKeys'
import { WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import { fetchWeeklyDeliveredSummary } from '../../work-orders/services/workOrdersListApi'
import { weeklyDeliveredCache } from '../services/dashboardCache'
import { currentWeekDeliveredRange } from '../services/weekCycle'

export function useDashboardWeeklyDelivered() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const range = useMemo(() => currentWeekDeliveredRange(), [])
  const fromIso = range.from.toISOString()
  const toIso = range.to.toISOString()
  const queryKey = useMemo(
    () => queryKeys.dashboard.weeklyDelivered(fromIso, toIso),
    [fromIso, toIso],
  )
  const cached = useMemo(
    () => weeklyDeliveredCache.read(userId, fromIso, toIso),
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
    queryFn: ({ signal }) => fetchWeeklyDeliveredSummary(range.from, range.to, signal),
    staleTime: STALE_DASHBOARD_MS,
    initialData: cached?.value,
    initialDataUpdatedAt: cached?.savedAt,
  })

  useEffect(() => {
    if (query.data) weeklyDeliveredCache.write(userId, fromIso, toIso, query.data)
  }, [query.data, query.dataUpdatedAt, userId, fromIso, toIso])

  return {
    from: range.from,
    to: range.to,
    count: query.data?.count ?? null,
    paymentsTotal: query.data?.paymentsTotal ?? null,
    isLoading: query.isPending,
    isError: query.isError,
  }
}