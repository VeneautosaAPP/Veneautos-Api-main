import type { FormEvent } from 'react'
import { NotesMinCharCounter } from './NotesMinCharCounter'
import { notesMinHint } from '../config/operationalNotes'
import { formatMoneyInputDisplayFromNormalized, normalizeMoneyDecimalStringForApi } from '../utils/copFormat'

type Props = {
  open: boolean
  onClose: () => void
  notesMin: number
  openAmt: string
  setOpenAmt: (v: string) => void
  openNote: string
  setOpenNote: (v: string) => void
  onSubmit: (e: FormEvent) => void | Promise<void>
}

/**
 * Mismo formulario de apertura de sesión que antes estaba en la pestaña Sesión, en modal.
 */
export function CashOpenSessionModal({
  open,
  onClose,
  notesMin,
  openAmt,
  setOpenAmt,
  openNote,
  setOpenNote,
  onSubmit,
}: Props) {
  if (!open) return null

  return (
    <div className="va-modal-overlay" role="presentation">
      <div
        className="va-modal-panel-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-open-session-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-4 py-3 sm:px-6 dark:border-slate-800">
          <h2 id="cash-open-session-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Abrir sesión
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
            Indicá el efectivo inicial en caja y una nota operativa (turno, responsable, acuerdo con el dueño, etc.).
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-6">
            <label className="block">
              <span className="va-label">Monto inicial en caja</span>
              <input
                required
                inputMode="decimal"
                autoComplete="off"
                value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(openAmt))}
                onChange={(e) => setOpenAmt(normalizeMoneyDecimalStringForApi(e.target.value))}
                className="va-field"
              />
            </label>
            <label className="block">
              <span className="va-label">Nota de apertura</span>
              <textarea
                required
                rows={3}
                value={openNote}
                onChange={(e) => setOpenNote(e.target.value)}
                className="va-field resize-y"
                placeholder="Ej. turno mañana, cajero Juan, fondo inicial acordado con el dueño…"
              />
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">{notesMinHint(notesMin)}</span>
              <NotesMinCharCounter value={openNote} minLength={notesMin} />
            </label>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-6 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 ring-1 ring-emerald-300 transition hover:from-emerald-400 hover:to-emerald-500 hover:shadow-lg hover:ring-emerald-200 active:translate-y-px dark:from-emerald-500 dark:to-emerald-700 dark:shadow-emerald-950/40 dark:ring-emerald-400 dark:hover:from-emerald-400 dark:hover:to-emerald-600"
            >
              Abrir caja
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
