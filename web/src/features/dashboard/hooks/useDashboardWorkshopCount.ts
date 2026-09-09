import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthContext'
import { STALE_DASHBOARD_MS } from '../../../constants/queryStaleTime'
import { queryKeys } from '../../../lib/queryKeys'
import { WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import {
  fetchInWorkshopSummary,
  type WorkOrdersValueSummary,
} from '../../work-orders/services/workOrdersListApi'
import { workshopCounterCache } from '../services/dashboardCache'

type LegacyWorkshopCacheValue = { total?: number }

export function useDashboardWorkshopCount() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const cached = useMemo(() => {
    const raw = workshopCounterCache.read(userId)
    if (!raw) return { entry: undefined, legacyNoValue: false }
    const legacy = raw.value as WorkOrdersValueSummary & LegacyWorkshopCacheValue
    const legacyNoValue = legacy.count == null && legacy.total != null && legacy.totalValue == null
    return {
      entry: {
        value: { count: legacy.count ?? legacy.total ?? 0, totalValue: legacy.totalValue ?? null },
        savedAt: raw.savedAt,
      },
      legacyNoValue,
    }
  }, [userId])

  useEffect(() => {
    const onChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.workOrdersInWorkshop() })
    }
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
  }, [queryClient])

  const query = useQuery<WorkOrdersValueSummary>({
    queryKey: queryKeys.dashboard.workOrdersInWorkshop(),
    queryFn: ({ signal }) => fetchInWorkshopSummary(signal),
    staleTime: cached.legacyNoValue ? 0 : STALE_DASHBOARD_MS,
    initialData: cached.entry?.value,
    initialDataUpdatedAt: cached.entry?.savedAt,
  })

  useEffect(() => {
    if (query.data) workshopCounterCache.write(userId, query.data)
  }, [query.data, query.dataUpdatedAt, userId])

  return {
    count: query.data?.count ?? null,
    totalValue: query.data?.totalValue ?? null,
    isLoading: query.isPending,
    isError: query.isError,
  }
}