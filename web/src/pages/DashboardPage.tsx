import { PageHeader } from '../components/layout/PageHeader'
import { useAuth } from '../auth/AuthContext'

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
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <p className="text-sm">El panel se está construyendo.</p>
        <p className="text-xs">
          Pronto encontrarás aquí tu resumen del taller. Por ahora, usá el menú lateral para moverte.
        </p>
      </div>
    </div>
  )
}