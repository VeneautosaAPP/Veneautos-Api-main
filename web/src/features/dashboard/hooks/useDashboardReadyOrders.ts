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
  // Entradas guardadas antes de existir el saldo pendiente: hay que refrescar para traerlo.
  const cached = useMemo(() => {
    const raw = readyOrdersCache.read(userId)
    if (!raw) return null
    return { ...raw, hasBalancePending: raw.value.balancePending !== undefined }
  }, [userId])

  useEffect(() => {
    const onChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.readyOrders() })
    }
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onChanged)
  }, [queryClient])

  const query = useQuery({
    queryKey,
    // queryFn solo corre ante respuestas reales del servidor → cachear ahí (nunca el placeholder initialData).
    queryFn: ({ signal }) =>
      fetchReadyOrdersSummary(signal).then((data) => {
        readyOrdersCache.write(userId, data)
        return data
      }),
    staleTime: cached && !cached.hasBalancePending ? 0 : STALE_DASHBOARD_MS,
    initialData: cached?.value,
    initialDataUpdatedAt: cached?.savedAt,
  })

  return {
    count: query.data?.count ?? null,
    totalValue: query.data?.totalValue ?? null,
    balancePending: query.data?.balancePending ?? null,
    isLoading: query.isPending,
    isError: query.isError,
  }
}