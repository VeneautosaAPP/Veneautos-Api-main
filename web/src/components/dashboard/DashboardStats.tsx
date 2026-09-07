import { memo } from 'react'

export type DashboardStatsProps = {
  totalModules: number
  enabledModules: number
  blockedCount: number
}

/**
 * Tarjetas de resumen numérico (módulos visibles / disponibles / bloqueados).
 */
export const DashboardStats = memo(function DashboardStats({
  totalModules,
  enabledModules,
  blockedCount,
}: DashboardStatsProps) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 min-[520px]:grid-cols-3">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800 dark:ring-1 dark:ring-slate-600">
        <p
          className="text-xs font-medium leading-snug tracking-tight text-slate-600 dark:text-slate-300"
          title="Módulos del panel que ves con tu perfil actual"
        >
          Módulos visibles
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalModules}</p>
      </div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800 dark:ring-1 dark:ring-slate-600">
        <p
          className="text-xs font-medium leading-snug tracking-tight text-slate-600 dark:text-slate-300"
          title="Módulos que podés abrir en este momento (sin bloqueos temporales)"
        >
          Disponibles ahora
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{enabledModules}</p>
      </div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800 dark:ring-1 dark:ring-slate-600">
        <p
          className="text-xs font-medium leading-snug tracking-tight text-slate-600 dark:text-slate-300"
          title="Módulos visibles pero no disponibles (p. ej. requieren caja abierta)"
        >
          Bloqueados temporalmente
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{blockedCount}</p>
      </div>
    </div>
  )
})
