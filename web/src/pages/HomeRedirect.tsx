import { Navigate } from 'react-router-dom'
import { portalPath } from '../constants/portalPath'
import { useAuth } from '../auth/AuthContext'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'

export function HomeRedirect() {
  const { can } = useAuth()
  const isSaas = panelUsesModernShell(usePanelTheme())
  if (can('work_orders:read') || can('work_orders:read_portal')) return <Navigate to={portalPath('/ordenes')} replace />
  if (can('customers:read')) return <Navigate to={portalPath('/clientes')} replace />
  if (can('reports:read')) return <Navigate to={portalPath('/informes')} replace />
  if (can('cash_sessions:read')) return <Navigate to={portalPath('/caja')} replace />
  if (can('users:read')) return <Navigate to={portalPath('/admin/usuarios')} replace />
  if (can('roles:read')) return <Navigate to={portalPath('/admin/roles')} replace />
  if (can('settings:read') || can('tax_rates:read')) return <Navigate to={portalPath('/admin/configuracion')} replace />
  if (can('audit:read')) return <Navigate to={portalPath('/admin/auditoria')} replace />
  return (
    <div
      className={`py-8 text-center text-slate-600 dark:text-slate-300 ${isSaas ? 'va-saas-page-section' : 'va-card'}`}
    >
      <p className="font-medium text-slate-800 dark:text-slate-100">No hay secciones disponibles para tu usuario.</p>
      <p className="mt-2 text-sm">Pedile a un administrador que te asigne permisos.</p>
    </div>
  )
}
