import { useMemo, useState } from 'react'
import {
  formatCopFromString,
  formatCopInteger,
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../../../utils/copFormat'

type Props = {
  /** Porcentaje inicial sugerido (50 para el 50%). */
  ratePercent?: number
  /** Compacta (dentro del banner): sin tarjeta y con inputs más angostos. */
  compact?: boolean
}

function toPesos(raw: string): number {
  const digits = raw.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function formatPercent(n: number): string {
  return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Calculadora de porcentaje de nómina (única, en la parte superior de la Nómina): de uso libre.
 *
 * - Ingresás base y porcentaje → muestra el monto a pagar.
 * - Ingresás base y monto → muestra el porcentaje equivalente.
 * Los tres campos se editan; la última edición recalcula el campo derivado.
 */
export function PayrollPercentageCalculator({ ratePercent = 50, compact = false }: Props) {
  const [baseRaw, setBaseRaw] = useState('')
  const [percentRaw, setPercentRaw] = useState(String(ratePercent))
  const [amountRaw, setAmountRaw] = useState('')

  const baseNum = useMemo(() => toPesos(baseRaw), [baseRaw])
  const percentNum = Number.parseFloat(percentRaw.replace(',', '.')) || 0
  const amountNum = toPesos(amountRaw)

  const onBaseChange = (raw: string) => {
    setBaseRaw(raw)
    const base = toPesos(raw)
    if (base > 0 && percentNum > 0) setAmountRaw(String(Math.round((base * percentNum) / 100)))
  }

  const onPercentChange = (raw: string) => {
    setPercentRaw(raw)
    const p = Number.parseFloat(raw.replace(',', '.'))
    if (baseNum > 0 && Number.isFinite(p) && p >= 0) {
      setAmountRaw(String(Math.round((baseNum * p) / 100)))
    }
  }

  const onAmountChange = (raw: string) => {
    setAmountRaw(raw)
    const amount = toPesos(raw)
    if (baseNum > 0 && amount > 0) setPercentRaw(formatPercent((amount / baseNum) * 100))
  }

  return (
    <div className={compact ? '' : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5'}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Calculadora de porcentaje
      </p>
      <div className={compact ? 'mt-2 grid gap-2 sm:grid-cols-3' : 'mt-3 grid gap-3 sm:grid-cols-3'}>
        <label className="text-sm">
          <span className="va-label whitespace-nowrap">{compact ? 'Base (COP)' : 'Base — mano de obra (COP)'}</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            className={`va-field mt-1 tabular-nums${compact ? ' max-w-[11rem] !py-1.5' : ''}`}
            placeholder="ej. 1.000.000"
            value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(baseRaw))}
            onChange={(e) => onBaseChange(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="va-label">Porcentaje (%)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            className={`va-field mt-1 tabular-nums${compact ? ' max-w-[11rem] !py-1.5' : ''}`}
            placeholder="ej. 10"
            value={percentRaw}
            onChange={(e) => onPercentChange(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="va-label whitespace-nowrap">{compact ? 'Monto (COP)' : 'Monto a pagar (COP)'}</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            className={`va-field mt-1 tabular-nums${compact ? ' max-w-[11rem] !py-1.5' : ''}`}
            placeholder="ej. 100.000"
            value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(amountRaw))}
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </label>
      </div>
      {!compact && baseNum > 0 && percentNum > 0 ? (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          El <span className="font-semibold tabular-nums">{formatPercent(percentNum)}%</span> de{' '}
          <span className="font-semibold tabular-nums">${formatCopInteger(baseNum)}</span> es{' '}
          <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            ${formatCopInteger(Math.round((baseNum * percentNum) / 100))}
          </span>
          {amountNum > 0 ? (
            <>
              {' '}
              — en tu campo de monto escribiste{' '}
              <span className="font-semibold tabular-nums">${formatCopFromString(String(amountNum))}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}