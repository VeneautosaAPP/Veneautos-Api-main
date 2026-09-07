import { Link } from 'react-router-dom'
import { portalPath } from '../constants/portalPath'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'
import { formatCopFromString } from '../utils/copFormat'

/** Coincide con `CASH_WORK_ORDER_REFERENCE_TYPE` en el API. */
const REF_WORK_ORDER = 'WorkOrder'
/** Coincide con `CASH_EXPENSE_REQUEST_REFERENCE_TYPE` en el API. */
const REF_EXPENSE_REQUEST = 'CashExpenseRequest'

export type SessionMovementRow = {
  id: string
  direction: string
  amount: string
  tenderAmount?: string | null
  changeAmount?: string | null
  referenceType: string | null
  referenceId: string | null
  note: string | null
  createdAt: string
  category: { slug: string; name: string }
  createdBy: { fullName: string; email: string }
}

type CashSessionMovementsCurrent =
  | undefined
  | null
  | {
      movements?: SessionMovementRow[]
    }

function tenderVueltoLine(m: SessionMovementRow): string | null {
  if (m.tenderAmount == null || m.changeAmount == null) return null
  return `Efectivo ${formatCopFromString(m.tenderAmount)} → vuelto ${formatCopFromString(m.changeAmount)}`
}

function movementRefLabel(m: SessionMovementRow): { text: string; to?: string } {
  if (m.referenceType === REF_WORK_ORDER && m.referenceId) {
    return { text: 'Cobro de orden de trabajo', to: portalPath(`/ordenes/${m.referenceId}`) }
  }
  if (m.referenceType === REF_EXPENSE_REQUEST && m.referenceId) {
    return { text: 'Egreso por solicitud aprobada' }
  }
  if (m.referenceType?.trim() && m.referenceId?.trim()) {
    return { text: `${m.referenceType} · ${m.referenceId.slice(0, 8)}…` }
  }
  return { text: '—' }
}

type Props = {
  current: CashSessionMovementsCurrent
  /**
   * Fase 7.7 · Si está provisto, muestra una columna «Acciones» con un botón
   * «Reimprimir» que llama al puente local para emitir nuevamente el ticket
   * térmico del movimiento.
   */
  onReprintMovement?: (movementId: string) => void
}

/**
 * Listado de movimientos de la sesión de caja abierta (misma data que `GET /cash/sessions/current`).
 */
export function CashSessionMovementsPanel({ current, onReprintMovement }: Props) {
  const surfaceClass = panelUsesModernShell(usePanelTheme()) ? 'va-saas-page-section' : 'va-card'

  if (current === undefined) {
    return (
      <div className={surfaceClass}>
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">Movimientos de esta sesión</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Cargando…</p>
      </div>
    )
  }

  if (current === null) {
    return (
      <div className={surfaceClass}>
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">Movimientos de esta sesión</h2>
        <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-100">No hay sesión abierta.</p>
      </div>
    )
  }

  return (
    <div className={surfaceClass}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-50">Movimientos de esta sesión</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-300">
        Si registraste un cobro desde una orden, el ingreso aparece aquí con vínculo a esa OT (referencia{' '}
        <span className="font-mono">{REF_WORK_ORDER}</span> en el sistema). No hace falta volver a cargar el ingreso en
        la pestaña «Ingreso» salvo cobros generales sin OT.
      </p>
      {current.movements && current.movements.length > 0 ? (
        <div className="va-table-scroll-ring mt-3">
          <table className="va-table min-w-[640px]">
            <thead>
              <tr className="va-table-head-row">
                <th className="va-table-th">Fecha</th>
                <th className="va-table-th">Tipo</th>
                <th className="va-table-th">Categoría</th>
                <th className="va-table-th">Importe</th>
                <th className="va-table-th">Efectivo / vuelto</th>
                <th className="va-table-th">Vínculo</th>
                <th className="va-table-th">Registró</th>
                {onReprintMovement ? <th className="va-table-th"> </th> : null}
              </tr>
            </thead>
            <tbody>
              {current.movements.map((m) => {
                const ref = movementRefLabel(m)
                const isInc = m.direction === 'INCOME'
                return (
                  <tr key={m.id} className="va-table-body-row">
                    <td className="va-table-td whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="va-table-td">
                      <span
                        className={
                          isInc
                            ? 'rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                            : 'rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-900 dark:bg-rose-950 dark:text-rose-200'
                        }
                      >
                        {isInc ? 'Ingreso' : 'Egreso'}
                      </span>
                    </td>
                    <td className="va-table-td text-slate-700 dark:text-slate-200">{m.category.name}</td>
                    <td className="va-table-td font-medium tabular-nums text-slate-900 dark:text-slate-50">
                      ${formatCopFromString(m.amount)}
                    </td>
                    <td className="va-table-td max-w-[12rem] text-xs text-slate-600 dark:text-slate-300">
                      {tenderVueltoLine(m) ?? '—'}
                    </td>
                    <td className="va-table-td max-w-[14rem] text-xs text-slate-600 dark:text-slate-300">
                      {ref.to ? (
                        <Link
                          to={ref.to}
                          className="font-medium text-brand-700 underline decoration-brand-300 hover:no-underline dark:text-brand-300"
                        >
                          {ref.text}
                        </Link>
                      ) : (
                        <span>{ref.text}</span>
                      )}
                    </td>
                    <td className="va-table-td text-xs text-slate-600 dark:text-slate-300">{m.createdBy.fullName}</td>
                    {onReprintMovement ? (
                      <td className="va-table-td">
                        <button
                          type="button"
                          onClick={() => onReprintMovement(m.id)}
                          className="text-xs font-semibold text-brand-700 underline dark:text-brand-300"
                          title="Reimprimir ticket térmico de este movimiento"
                        >
                          Reimprimir
                        </button>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Todavía no hay movimientos en esta sesión.</p>
      )}
    </div>
  )
}
