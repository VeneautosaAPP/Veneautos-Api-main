import { useMemo } from 'react'
import { useAuth } from '../../../auth/AuthContext'
import { createDashboardSections, deriveDashboardLayout } from '../model/dashboardLayout'

export type DashboardStatsModel = {
  totalModules: number
  enabledModules: number
  blockedCount: number
}

/**
 * Solo KPIs del panel. Si la página ya usa `useDashboardModules()`, no llames este hook en el mismo árbol (duplica el cálculo).
 */
export function useDashboardStats(): DashboardStatsModel {
  const { can } = useAuth()
  return useMemo(() => {
    const layout = deriveDashboardLayout(createDashboardSections(can))
    return {
      totalModules: layout.totalModules,
      enabledModules: layout.enabledModules,
      blockedCount: layout.blockedCount,
    }
  }, [can])
}
