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

export function useDashboardWorkshopCount() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const cached = useMemo(() => {
    const raw = workshopCounterCache.read(userId)
    if (!raw) return undefined
    // Migración: entradas viejas guardaban solo `{ total }` (sin el valor total).
    const legacy = raw.value as WorkOrdersValueSummary & { total?: number }
    return {
      count: legacy.count ?? legacy.total ?? 0,
      totalValue: legacy.totalValue ?? null,
      savedAt: raw.savedAt,
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
    // queryFn solo corre ante respuestas reales del servidor → cachear ahí (nunca el placeholder initialData).
    queryFn: ({ signal }) =>
      fetchInWorkshopSummary(signal).then((data) => {
        workshopCounterCache.write(userId, data)
        return data
      }),
    // Caché sin valor (entrada vieja `{total}` o un placeholder guardado sin el monto):
    // forzamos refetch de fondo aunque la entrada sea reciente, para que el total aparezca.
    staleTime: cached && cached.totalValue == null ? 0 : STALE_DASHBOARD_MS,
    initialData: cached ? { count: cached.count, totalValue: cached.totalValue } : undefined,
    initialDataUpdatedAt: cached?.savedAt,
  })

  return {
    count: query.data?.count ?? null,
    totalValue: query.data?.totalValue ?? null,
    isLoading: query.isPending,
    isError: query.isError,
  }
}