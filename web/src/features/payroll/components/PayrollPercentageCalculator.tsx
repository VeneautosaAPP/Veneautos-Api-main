import { useMemo, useState } from 'react'
import {
  formatCopFromString,
  formatCopInteger,
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../../../utils/copFormat'

type Props = {
  /** Mano de obra (sin IVA) sobre la que se calcula, p. ej. la de una OT o el total del mecánico. */
  base: string
  /** Etiqueta corta de la base (p. ej. "OT VEN-0271" o "Total de la semana"). */
  baseLabel: string
  /** Porcentaje por defecto (50 para el 50%). */
  ratePercent: number
}

function toPesos(raw: string): number {
  const digits = raw.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function formatPercent(n: number): string {
  return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Calculadora de porcentaje de nómina: dado un valor a pagar muestra el % de la mano de obra,
 * y al revés. Los dos campos se editan en ambas direcciones (última edición gana).
 * Un cambio en la base (total o una OT) re-siembra el 50% por defecto.
 */
export function PayrollPercentageCalculator({ base, baseLabel, ratePercent }: Props) {
  const baseNum = useMemo(() => {
    const n = Number(base)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [base])

  const [amountRaw, setAmountRaw] = useState(() =>
    baseNum > 0 ? String(Math.round((baseNum * ratePercent) / 100)) : '',
  )
  const [percentRaw, setPercentRaw] = useState(() => String(ratePercent))

  const amountNum = toPesos(amountRaw)
  const percentNum = Number.parseFloat(percentRaw.replace(',', '.')) || 0

  if (baseNum <= 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
        Calculadora de porcentaje — sin mano de obra registrada en {baseLabel} para calcular.
      </div>
    )
  }

  const onAmountChange = (raw: string) => {
    setAmountRaw(raw)
    const n = toPesos(raw)
    if (n > 0) setPercentRaw(formatPercent((n / baseNum) * 100))
  }

  const onPercentChange = (raw: string) => {
    setPercentRaw(raw)
    const p = Number.parseFloat(raw.replace(',', '.'))
    if (Number.isFinite(p) && p > 0) setAmountRaw(String(Math.round((baseNum * p) / 100)))
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Calculadora de porcentaje
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Base {baseLabel}: <span className="font-medium text-slate-700 dark:text-slate-200">${formatCopFromString(base)}</span>
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="va-label">Valor a pagar (COP)</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            className="va-field mt-1 tabular-nums"
            placeholder="ej. 1.300.000"
            value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(amountRaw))}
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="va-label">Porcentaje (%)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            className="va-field mt-1 tabular-nums"
            placeholder="ej. 46,43"
            value={percentRaw}
            onChange={(e) => onPercentChange(e.target.value)}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
        Pagar <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">${formatCopInteger(amountNum)}</span>{' '}
        equivale al <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatPercent(percentNum)}%</span> de la mano de obra.
      </p>
    </div>
  )
}