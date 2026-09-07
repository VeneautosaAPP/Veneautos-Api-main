import { memo, useCallback } from 'react'
import { NotesMinCharCounter } from '../../components/NotesMinCharCounter'
import { notesMinHint } from '../../config/operationalNotes'
import {
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../../utils/copFormat'
import { useCashMovementDraft } from './hooks/useCashMovementDraft'
import type { CashCategory, CashMovementDraftValues } from './types'

type MovementDir = 'income' | 'expense'

const COPY: Record<
  MovementDir,
  {
    title: string
    submitLabel: string
    amountLabel: string
    amountHelp: string
    tenderLabel: string
    tenderHelp: string
    tenderPlaceholder: string
    noteLabel: string
    notePlaceholder: string
    ackLabel: string
  }
> = {
  income: {
    title: 'Registrar ingreso',
    submitLabel: 'Registrar ingreso',
    amountLabel: 'Importe que queda registrado en caja',
    amountHelp:
      'Ej. monto del cobro o ingreso real (lo que suma al saldo del sistema). Solo pesos enteros; miles con punto (es-CO).',
    tenderLabel: 'Efectivo que te entregan (opcional)',
    tenderHelp:
      'Para billete grande: el vuelto se calcula solo. Dejá vacío si coincide con el importe o es transferencia.',
    tenderPlaceholder: 'Ej. billete de 100000 si el importe arriba es menor',
    noteLabel: 'Nota del ingreso',
    notePlaceholder: 'Ej. cobro a cliente X por concepto…',
    ackLabel: 'Confirmo categoría, importe, efectivo recibido (si aplica) y nota.',
  },
  expense: {
    title: 'Registrar egreso',
    submitLabel: 'Registrar egreso',
    amountLabel: 'Importe del egreso (en caja)',
    amountHelp:
      'Lo que sale del efectivo según el comprobante (neto del movimiento). Solo pesos enteros; miles con punto.',
    tenderLabel: 'Efectivo que das / billete usado (opcional)',
    tenderHelp: 'Vuelto que vuelve a caja = efectivo indicado − importe del egreso.',
    tenderPlaceholder: 'Si pagás con billete mayor al importe, indicá cuánto entregás',
    noteLabel: 'Nota del egreso',
    notePlaceholder: 'Ej. compra de insumos, pago a proveedor…',
    ackLabel: 'Confirmo categoría, importe, efectivo usado (si aplica) y nota.',
  },
}

export type CashMovementFormPanelProps = {
  direction: MovementDir
  categories: CashCategory[]
  notesMin: number
  narrowFormClass: string
  submitButtonClass: string
  onSubmit: (payload: CashMovementDraftValues) => Promise<boolean>
}

function CashMovementFormPanelInner({
  direction,
  categories,
  notesMin,
  narrowFormClass,
  submitButtonClass,
  onSubmit,
}: CashMovementFormPanelProps) {
  const c = COPY[direction]
  const {
    movCat,
    setMovCat,
    movAmt,
    setMovAmt,
    movTender,
    setMovTender,
    movNote,
    setMovNote,
    movAck,
    setMovAck,
    movTwoCopies,
    setMovTwoCopies,
    movVueltoHint,
    resetAfterSuccess,
  } = useCashMovementDraft(direction, categories)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const payload: CashMovementDraftValues = {
        movCat,
        movAmt,
        movTender,
        movNote,
        movAck,
        movTwoCopies,
      }
      const ok = await onSubmit(payload)
      if (ok) resetAfterSuccess()
    },
    [
      movCat,
      movAmt,
      movTender,
      movNote,
      movAck,
      movTwoCopies,
      onSubmit,
      resetAfterSuccess,
    ],
  )

  return (
    <form className={narrowFormClass} onSubmit={(e) => void handleSubmit(e)}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-50">{c.title}</h2>
      <label className="block">
        <span className="va-label">Categoría</span>
        <select value={movCat} onChange={(e) => setMovCat(e.target.value)} className="va-field">
          {categories.map((cat) => (
            <option key={cat.id} value={cat.slug}>
              {cat.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="va-label">{c.amountLabel}</span>
        <input
          required
          inputMode="decimal"
          autoComplete="off"
          value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(movAmt))}
          onChange={(e) => setMovAmt(normalizeMoneyDecimalStringForApi(e.target.value))}
          className="va-field"
        />
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">{c.amountHelp}</span>
      </label>
      <label className="block">
        <span className="va-label">{c.tenderLabel}</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(movTender))}
          onChange={(e) => setMovTender(normalizeMoneyDecimalStringForApi(e.target.value))}
          className="va-field"
          placeholder={c.tenderPlaceholder}
        />
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">{c.tenderHelp}</span>
        {movVueltoHint && (
          <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900 dark:border-brand-600 dark:bg-brand-900 dark:text-brand-50">
            {movVueltoHint}
          </p>
        )}
      </label>
      <label className="block">
        <span className="va-label">{c.noteLabel}</span>
        <textarea
          required
          rows={2}
          value={movNote}
          onChange={(e) => setMovNote(e.target.value)}
          className="va-field resize-y"
          placeholder={c.notePlaceholder}
        />
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">{notesMinHint(notesMin)}</span>
        <NotesMinCharCounter value={movNote} minLength={notesMin} />
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 dark:border-slate-500"
          checked={movAck}
          onChange={(e) => setMovAck(e.target.checked)}
        />
        <span>{c.ackLabel}</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 dark:border-slate-500"
          checked={movTwoCopies}
          onChange={(e) => setMovTwoCopies(e.target.checked)}
        />
        <span>Imprimir 2 copias del ticket</span>
      </label>
      <button type="submit" className={submitButtonClass}>
        {c.submitLabel}
      </button>
    </form>
  )
}

export const CashMovementFormPanel = memo(CashMovementFormPanelInner)
