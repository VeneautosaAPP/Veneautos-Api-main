import { useState } from 'react'
import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { usePanelTheme } from '../../../theme/PanelThemeProvider'
import { panelUsesModernShell } from '../../../config/operationalNotes'
import { formatCopFromString } from '../../../utils/copFormat'
import type { PayrollMechanicRow } from '../services/payrollApi'

const DEFAULT_PCT = 50

type Props = {
  mechanic: PayrollMechanicRow
  /** % de nómina por OT (fuente de verdad en la página). */
  pctByOrder: Record<string, number>
  /** false para mecánicos (solo lectura); true para dueño/admin. */
  canEdit: boolean
  onChangePercent: (orderId: string, pct: number) => void
  /** OTs cuyo guardado está en curso. */
  savingIds: ReadonlySet<string>
  /** OTs cuyo último guardado falló (el valor volvió al del servidor). */
  failedIds: ReadonlySet<string>
}

function toLaborNum(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function formatPctInput(n: number): string {
  if (!Number.isFinite(n)) return ''
  const s = n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
  return s === 'NaN' ? '' : s
}

/** Input de % con borrador local para permitir decimales mientras se escribe. */
function PercentDraftInput({ initial, onChange }: { initial: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(() => formatPctInput(initial))
  const [prevInitial, setPrevInitial] = useState(initial)
  const [focused, setFocused] = useState(false)

  // Ajuste de estado durante render: refleja un valor externo nuevo mientras no se está editando.
  if (!focused && prevInitial !== initial) {
    setPrevInitial(initial)
    setDraft(formatPctInput(initial))
  }

  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      aria-label="Porcentaje de nómina"
      className="va-field w-16 px-2 py-1 text-right tabular-nums"
      value={draft}
      onFocus={() => {
        setPrevInitial(initial)
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
        setDraft(formatPctInput(initial))
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        const clean = e.target.value.trim().replace(',', '.').replace(/[^\d.]/g, '')
        if (!clean || clean === '.') return
        const n = Number(clean)
        if (Number.isFinite(n)) {
          onChange(n)
        }
      }}
    />
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function NominaMechanicCard({
  mechanic,
  pctByOrder,
  canEdit,
  onChangePercent,
  savingIds,
  failedIds,
}: Props) {
  const isSaas = panelUsesModernShell(usePanelTheme())

  const rows = mechanic.orders.map((o) => {
    const labor = toLaborNum(o.laborTotal)
    const pct = pctByOrder[o.id] ?? (toLaborNum(o.commissionPct) || DEFAULT_PCT)
    return { o, labor, pct, payable: Math.round((labor * pct) / 100) }
  })
  const laborTotal = toLaborNum(mechanic.laborTotal)
  const payableTotal = rows.reduce((sum, r) => sum + r.payable, 0)
  const effectivePct = laborTotal > 0 ? (payableTotal / laborTotal) * 100 : 0

  const cardClass = isSaas
    ? 'va-saas-module-card'
    : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900'

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
        {mechanic.ordersCount > 0 && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
            {Math.round(effectivePct)}% efectivo a pagar
          </span>
        )}
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
            A pagar
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
            ${formatCopFromString(String(payableTotal))}
          </p>
          <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70">Esta semana</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(({ o, labor, pct, payable }) => {
            const saving = savingIds.has(o.id)
            const failed = failedIds.has(o.id)
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{o.publicCode}</span>
                    {o.description ? ` · ${o.description}` : null}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    {o.plate ?? 'Sin placa'} · {shortDate(o.deliveredAt)}
                  </p>
                </div>

                {canEdit ? (
                  <label className="flex items-center gap-1 text-sm">
                    <PercentDraftInput initial={pct} onChange={(n) => onChangePercent(o.id, n)} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
                  </label>
                ) : (
                  <span className="text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
                    {formatPctInput(pct)}%
                  </span>
                )}

                <div className="shrink-0 text-right">
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      failed ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    ${formatCopFromString(String(payable))}
                  </p>
                  <p className="flex items-center justify-end gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                    {saving ? (
                      <>
                        <Clock3 className="size-3" aria-hidden />
                        <span className="text-amber-600 dark:text-amber-400">Guardando…</span>
                      </>
                    ) : null}
                    {failed ? (
                      <>
                        <XCircle className="size-3" aria-hidden />
                        <span className="text-rose-600 dark:text-rose-400">No se guardó</span>
                      </>
                    ) : null}
                    {!saving && !failed ? `de $${formatCopFromString(String(labor))}` : null}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {canEdit && rows.length > 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <CheckCircle2 className="size-3" aria-hidden />
          El porcentaje se guarda automáticamente por OT al terminar de escribir.
        </p>
      ) : null}
    </section>
  )
}