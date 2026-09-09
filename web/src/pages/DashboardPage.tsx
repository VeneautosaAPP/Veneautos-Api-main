import { PageHeader } from '../components/layout/PageHeader'
import { useAuth } from '../auth/AuthContext'
import { DashboardWorkshopOrdersCard } from '../features/dashboard/components/DashboardWorkshopOrdersCard'
import { DashboardWeeklyDeliveredCard } from '../features/dashboard/components/DashboardWeeklyDeliveredCard'
import { DashboardReadyOrdersCard } from '../features/dashboard/components/DashboardReadyOrdersCard'

export function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inicio"
        description={
          user?.fullName
            ? `Hola, ${user.fullName}.`
            : 'Bienvenido al panel.'
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <DashboardWorkshopOrdersCard />
        <DashboardReadyOrdersCard />
        <DashboardWeeklyDeliveredCard />
      </div>
    </div>
  )
}