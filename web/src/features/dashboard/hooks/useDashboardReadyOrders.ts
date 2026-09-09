import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthContext'
import { STALE_DASHBOARD_MS } from '../../../constants/queryStaleTime'
import { queryKeys } from '../../../lib/queryKeys'
import { WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import { fetchReadyOrdersSummary } from '../../work-orders/services/workOrdersListApi'
import { readyOrdersCache } from '../services/dashboardCache'

export function useDashboardReadyOrders() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const queryKey = queryKeys.dashboard.readyOrders()
  const cached = useMemo(() => readyOrdersCache.read(userId), [userId])

  useEffect(() => {
    const onChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.readyOrders() })
    }
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
  }, [queryClient])

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchReadyOrdersSummary(signal),
    staleTime: STALE_DASHBOARD_MS,
    initialData: cached?.value,
    initialDataUpdatedAt: cached?.savedAt,
  })

  useEffect(() => {
    if (query.data) readyOrdersCache.write(userId, query.data)
  }, [query.data, query.dataUpdatedAt, userId])

  return {
    count: query.data?.count ?? null,
    totalValue: query.data?.totalValue ?? null,
    isLoading: query.isPending,
    isError: query.isError,
  }
}