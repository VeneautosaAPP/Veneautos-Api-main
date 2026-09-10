import { useState } from 'react'
import { Calculator, ChevronDown } from 'lucide-react'
import { usePanelTheme } from '../../../theme/PanelThemeProvider'
import { panelUsesModernShell } from '../../../config/operationalNotes'
import { formatCopFromString } from '../../../utils/copFormat'
import type { PayrollMechanicRow } from '../services/payrollApi'
import { PayrollPercentageCalculator } from './PayrollPercentageCalculator'

type Props = {
  mechanic: PayrollMechanicRow
  /** Porcentaje de comisión sobre la mano de obra (50 para el 50%). */
  ratePercent: number
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function NominaMechanicCard({ mechanic, ratePercent }: Props) {
  const isSaas = panelUsesModernShell(usePanelTheme())
  const [calcOpen, setCalcOpen] = useState(false)
  const [calcBaseKey, setCalcBaseKey] = useState('total')

  const cardClass = isSaas
    ? 'va-saas-module-card'
    : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900'

  const bases = [
    {
      key: 'total',
      label: `Total de la semana (${mechanic.ordersCount} ${mechanic.ordersCount === 1 ? 'OT' : 'OTs'})`,
      base: mechanic.laborTotal,
    },
    ...mechanic.orders.map((o) => ({
      key: o.id,
      label: `${o.publicCode}${o.plate ? ` · ${o.plate}` : ''}`,
      base: o.laborTotal,
    })),
  ]
  const activeBase = bases.find((b) => b.key === calcBaseKey) ?? bases[0]!

  return (
    <section className={`${cardClass} flex flex-col gap-4`} aria-label={`Nómina de ${mechanic.fullName}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{mechanic.fullName}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {mechanic.ordersCount === 0
              ? 'Sin entregas esta semana'
              : `${mechanic.ordersCount} ${mechanic.ordersCount === 1 ? 'orden entregada' : 'órdenes entregadas'}`}{' '}
            · lunes a sábado
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
          {ratePercent}% a pagar
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Mano de obra
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            ${formatCopFromString(mechanic.laborTotal)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Sin IVA</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/60">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            A pagar ({ratePercent}%)
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
            ${formatCopFromString(mechanic.payable)}
          </p>
          <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70">Esta semana</p>
        </div>
      </div>

      {mechanic.orders.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {mechanic.orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{o.publicCode}</span>
                  {o.description ? ` · ${o.description}` : null}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {o.plate ?? 'Sin placa'} · {shortDate(o.deliveredAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                  ${formatCopFromString(o.payable)}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">de ${formatCopFromString(o.laborTotal)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="space-y-2">
        <button
          type="button"
          onClick={() => setCalcOpen((v) => !v)}
          aria-expanded={calcOpen}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Calculator className="size-3.5" strokeWidth={1.75} aria-hidden />
          Calculadora de porcentaje
          <ChevronDown
            className={`size-3.5 transition-transform ${calcOpen ? '' : '-rotate-90'}`}
            strokeWidth={2}
            aria-hidden
          />
        </button>
        {calcOpen && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="va-label">Base de cálculo</span>
              <select
                className="va-field mt-1"
                value={calcBaseKey}
                onChange={(e) => setCalcBaseKey(e.target.value)}
              >
                {bases.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <PayrollPercentageCalculator
              base={activeBase.base}
              baseLabel={activeBase.label}
              ratePercent={ratePercent}
            />
          </div>
        )}
      </footer>
    </section>
  )
}