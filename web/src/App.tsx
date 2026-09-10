import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { PORTAL_BASE, portalPath } from './constants/portalPath'
import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RouteSuspense } from './components/RouteSuspense'
import { RolePreviewPage } from './pages/admin/RolePreviewPage'
import { RoleDetailPage } from './pages/admin/RoleDetailPage'
import { RolesPage } from './pages/admin/RolesPage'
import { SettingsPage } from './pages/admin/SettingsPage'
import { FiscalResolutionsPage } from './pages/admin/FiscalResolutionsPage'
import { TaxRatesPage } from './pages/admin/TaxRatesPage'
import { RepuestosPage } from './pages/RepuestosPage'
import { UsersPage } from './pages/admin/UsersPage'
import { CashPage } from './pages/CashPage'
import { CustomerDetailPage } from './pages/CustomerDetailPage'
import { CustomersPage } from './pages/CustomersPage'
import { CommercialLandingPage } from './pages/CommercialLandingPage'
import { DashboardPage } from './pages/DashboardPage'
import { ClientAccountLookupPage } from './pages/ClientAccountLookupPage'
import { LoginPage } from './pages/LoginPage'
import { VehicleDetailPage } from './pages/VehicleDetailPage'
import { InvoiceDetailPage } from './pages/InvoiceDetailPage'

/** Rutas con tablas grandes o bloques tipo gráficos: fuera del bundle inicial. */
const AuditPage = lazy(() => import('./pages/admin/AuditPage').then((m) => ({ default: m.AuditPage })))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const WorkOrderDetailPage = lazy(() =>
  import('./pages/WorkOrderDetailPage').then((m) => ({ default: m.WorkOrderDetailPage })),
)
const WorkOrdersPage = lazy(() => import('./pages/WorkOrdersPage').then((m) => ({ default: m.WorkOrdersPage })))
const NominaPage = lazy(() => import('./pages/NominaPage').then((m) => ({ default: m.NominaPage })))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CommercialLandingPage />} />
      {/** SEO/compat: la consulta OT ahora vive en /consulta-cliente */}
      <Route path="/consultar-ot" element={<Navigate to="/consulta-cliente" replace />} />
      <Route path="/consulta-cliente" element={<ClientAccountLookupPage />} />
      <Route path="/login" element={<Navigate to={portalPath('/login')} replace />} />
      <Route path={`${PORTAL_BASE}/login`} element={<LoginPage />} />
      <Route path={PORTAL_BASE} element={<AppShell />}>
        <Route element={<ProtectedRoute />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="ordenes"
            element={
              <RouteSuspense>
                <WorkOrdersPage />
              </RouteSuspense>
            }
          />
          <Route
            path="ordenes/:id"
            element={
              <RouteSuspense>
                <WorkOrderDetailPage />
              </RouteSuspense>
            }
          />
          <Route
            path="nomina"
            element={
              <RouteSuspense>
                <NominaPage />
              </RouteSuspense>
            }
          />
          <Route path="clientes" element={<CustomersPage />} />
          <Route path="clientes/:id" element={<CustomerDetailPage />} />
          <Route path="vehiculos/:id" element={<VehicleDetailPage />} />
          <Route path="caja" element={<CashPage />} />
          <Route
            path="facturacion"
            element={
              <RouteSuspense>
                <InvoicesPage />
              </RouteSuspense>
            }
          />
          <Route path="facturacion/:id" element={<InvoiceDetailPage />} />
          <Route
            path="informes"
            element={
              <RouteSuspense>
                <ReportsPage />
              </RouteSuspense>
            }
          />
          <Route path="admin/usuarios" element={<UsersPage />} />
          <Route path="admin/roles" element={<RolesPage />} />
          <Route path="admin/roles/:id" element={<RoleDetailPage />} />
          <Route path="admin/impuestos" element={<TaxRatesPage />} />
          <Route path="repuestos" element={<RepuestosPage />} />
          <Route path="admin/configuracion" element={<SettingsPage />} />
          <Route path="admin/resoluciones-fiscales" element={<FiscalResolutionsPage />} />
          <Route
            path="admin/auditoria"
            element={
              <RouteSuspense>
                <AuditPage />
              </RouteSuspense>
            }
          />
          <Route path="admin/vista-rol" element={<RolePreviewPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
