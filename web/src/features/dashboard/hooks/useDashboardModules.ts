import { useMemo } from 'react'
import { useAuth } from '../../../auth/AuthContext'
import { createDashboardSections, deriveDashboardLayout } from '../model/dashboardLayout'
import { useCashSummary } from './useCashSummary'

/**
 * Modelo completo del panel módulos (permisos + caja + derivados).
 * Un solo pipeline evita recalcular secciones en varios sitios.
 */
export function useDashboardModules() {
  const { can, user } = useAuth()
  const { open: cashSessionOpen } = useCashSummary()

  return useMemo(() => {
    const raw = createDashboardSections(can)
    const layout = deriveDashboardLayout(raw)
    return {
      user,
      cashSessionOpen,
      ...layout,
    }
  }, [can, cashSessionOpen, user])
}
