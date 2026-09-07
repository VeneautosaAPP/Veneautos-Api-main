import type { ReactNode } from 'react'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'

type Props = {
  /** Etiqueta accesible del `role="tablist"` */
  tablistLabel: string
  children: ReactNode
  /** Botón(es) al final de la fila (p. ej. Cerrar sesión) */
  endAction?: ReactNode
}

const tabScrollerClass =
  'flex min-w-0 flex-1 gap-1 overflow-x-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

const stripClassicClass =
  'flex min-w-0 items-stretch gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 dark:shadow-inner'

const actionsClassicClass =
  'flex shrink-0 items-stretch border-l border-slate-200 pl-1.5 dark:border-slate-600'

/**
 * Franja de pestañas + acción final (Fase 2). Encapsula el `isSaas` que antes repetía CashPage.
 */
export function TabRow({ tablistLabel, children, endAction }: Props) {
  const isSaas = panelUsesModernShell(usePanelTheme())

  return (
    <div className={isSaas ? 'va-saas-tab-strip' : stripClassicClass}>
      <div className={tabScrollerClass} role="tablist" aria-label={tablistLabel}>
        {children}
      </div>
      {endAction ? <div className={isSaas ? 'va-saas-tab-row-actions' : actionsClassicClass}>{endAction}</div> : null}
    </div>
  )
}
