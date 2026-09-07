import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, downloadFile } from '../api/client'
import { PageHeader } from '../components/layout/PageHeader'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'

type Granularity = 'day' | 'week' | 'fortnight' | 'month'

type SeriesRow = {
  periodKey: string
  periodLabel: string
  incomeTotal: string
  expenseTotal: string
  netCash: string
  otPaymentsTotal: string
  workOrdersOpened: number
  workOrdersDelivered: number
  distinctVehiclesTouched: number
}

type EconomicSummary = {
  from: string
  to: string
  granularity: Granularity
  disclaimer: string
  series: SeriesRow[]
  totals: {
    incomeTotal: string
    expenseTotal: string
    otPaymentsTotal: string
    netCash: string
    workOrdersOpened: number
    workOrdersDelivered: number
    distinctVehiclesTouched: number
  }
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDaysUtc(d: Date, days: number): Date {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + days)
  return x
}

function parseUtcYmd(ymd: string): Date {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))))
}

/** Inclusive day count between two YYYY-MM-DD (UTC calendar dates). */
function daysInclusiveUtc(fromYmd: string, toYmd: string): number {
  const a = parseUtcYmd(fromYmd).getTime()
  const b = parseUtcYmd(toYmd).getTime()
  return Math.floor((b - a) / 86_400_000) + 1
}

/** Same number of days as [from, to], ending the day before `from`. */
function previousSameLengthRange(from: string, to: string): { from: string; to: string } {
  const n = daysInclusiveUtc(from, to)
  const fromD = parseUtcYmd(from)
  const compareTo = addDaysUtc(fromD, -1)
  const compareFrom = addDaysUtc(compareTo, -(n - 1))
  return { from: ymdUtc(compareFrom), to: ymdUtc(compareTo) }
}

/** Full calendar month UTC immediately before the month of `boundaryFrom`. */
function previousFullMonthUtc(boundaryFrom: string): { from: string; to: string } {
  const d = parseUtcYmd(boundaryFrom)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const firstThis = new Date(Date.UTC(y, m, 1))
  const lastPrev = addDaysUtc(firstThis, -1)
  const y2 = lastPrev.getUTCFullYear()
  const m2 = lastPrev.getUTCMonth()
  const firstPrev = new Date(Date.UTC(y2, m2, 1))
  const lastDay = new Date(Date.UTC(y2, m2 + 1, 0)).getUTCDate()
  const endPrev = new Date(Date.UTC(y2, m2, lastDay))
  return { from: ymdUtc(firstPrev), to: ymdUtc(endPrev) }
}

type Preset = { id: string; label: string; range: () => { from: string; to: string } }

const PRESETS: Preset[] = [
  {
    id: '7d',
    label: 'Últimos 7 días',
    range: () => {
      const to = new Date()
      const from = addDaysUtc(to, -6)
      return { from: ymdUtc(from), to: ymdUtc(to) }
    },
  },
  {
    id: '30d',
    label: 'Últimos 30 días',
    range: () => {
      const to = new Date()
      const from = addDaysUtc(to, -29)
      return { from: ymdUtc(from), to: ymdUtc(to) }
    },
  },
  {
    id: 'week',
    label: 'Esta semana (lun–dom UTC)',
    range: () => {
      const to = new Date()
      const dow = (to.getUTCDay() + 6) % 7
      const from = addDaysUtc(to, -dow)
      return { from: ymdUtc(from), to: ymdUtc(to) }
    },
  },
  {
    id: 'fortnight',
    label: 'Quincena calendario (mitad actual)',
    range: () => {
      const to = new Date()
      const y = to.getUTCFullYear()
      const m = to.getUTCMonth()
      const d = to.getUTCDate()
      const startDay = d <= 15 ? 1 : 16
      const from = new Date(Date.UTC(y, m, startDay, 0, 0, 0, 0))
      const last = d <= 15 ? 15 : new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const end = new Date(Date.UTC(y, m, last, 23, 59, 59, 999))
      return { from: ymdUtc(from), to: ymdUtc(end) }
    },
  },
  {
    id: 'month',
    label: 'Este mes (calendario UTC)',
    range: () => {
      const to = new Date()
      const y = to.getUTCFullYear()
      const m = to.getUTCMonth()
      const from = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const end = new Date(Date.UTC(y, m, last, 23, 59, 59, 999))
      return { from: ymdUtc(from), to: ymdUtc(end) }
    },
  },
]

type PresetId = (typeof PRESETS)[number]['id'] | 'custom'

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Diario' },
  { value: 'week', label: 'Semanal' },
  { value: 'fortnight', label: 'Quincenal' },
  { value: 'month', label: 'Mensual' },
]

function moneyEs(n: string): string {
  const x = Number.parseFloat(n)
  if (Number.isNaN(x)) return n
  return x.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function pctDeltaVsRef(current: number, ref: number): string {
  if (ref === 0) return current === 0 ? '—' : 'nuevo'
  const p = ((current - ref) / Math.abs(ref)) * 100
  const s = p >= 0 ? '+' : ''
  return `${s}${p.toFixed(1)}%`
}

function BarChart({
  rows,
  getNumeric,
  format,
  label,
  color,
}: {
  rows: SeriesRow[]
  getNumeric: (r: SeriesRow) => number
  format: (r: SeriesRow) => string
  label: string
  color: string
}) {
  const nums = rows.map(getNumeric)
  const max = Math.max(1e-6, ...nums.map((n) => Math.abs(n)))
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</p>
      <div className="space-y-2">
        {rows.map((r) => {
          const v = getNumeric(r)
          const w = Math.min(100, (Math.abs(v) / max) * 100)
          return (
            <div key={r.periodKey + label}>
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="truncate pr-2">{r.periodLabel}</span>
                <span className="shrink-0 tabular-nums">{format(r)}</span>
              </div>
              <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className={`h-2 rounded-full ${color}`} style={{ width: `${w}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type CompareKind = 'previous_block' | 'prev_month' | 'custom_b'

function ComparisonBlock({
  labelA,
  labelB,
  a,
  b,
  loadingB,
  hintB,
}: {
  labelA: string
  labelB: string
  a: EconomicSummary['totals']
  b: EconomicSummary['totals'] | null
  loadingB: boolean
  hintB?: string
}) {
  const isSaas = panelUsesModernShell(usePanelTheme())
  const rows: Array<{ key: string; fmt: (t: EconomicSummary['totals']) => string; numA: number; numB: (t: EconomicSummary['totals']) => number }> = [
    { key: 'Ingresos caja', fmt: (t) => moneyEs(t.incomeTotal), numA: Number.parseFloat(a.incomeTotal), numB: (t) => Number.parseFloat(t.incomeTotal) },
    { key: 'Egresos caja', fmt: (t) => moneyEs(t.expenseTotal), numA: Number.parseFloat(a.expenseTotal), numB: (t) => Number.parseFloat(t.expenseTotal) },
    { key: 'Resultado caja', fmt: (t) => moneyEs(t.netCash), numA: Number.parseFloat(a.netCash), numB: (t) => Number.parseFloat(t.netCash) },
    { key: 'Cobros en OT', fmt: (t) => moneyEs(t.otPaymentsTotal), numA: Number.parseFloat(a.otPaymentsTotal), numB: (t) => Number.parseFloat(t.otPaymentsTotal) },
    { key: 'OT abiertas', fmt: (t) => String(t.workOrdersOpened), numA: a.workOrdersOpened, numB: (t) => t.workOrdersOpened },
    { key: 'OT entregadas', fmt: (t) => String(t.workOrdersDelivered), numA: a.workOrdersDelivered, numB: (t) => t.workOrdersDelivered },
    { key: 'Vehículos distintos', fmt: (t) => String(t.distinctVehiclesTouched), numA: a.distinctVehiclesTouched, numB: (t) => t.distinctVehiclesTouched },
  ]

  const intro = (
    <>
      <h2 className={isSaas ? 'va-section-title text-sm' : 'text-sm font-semibold text-slate-900 dark:text-slate-50'}>
        Comparación de períodos
      </h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
        Columna izquierda: período seleccionado. Derecha: período de referencia. La variación es{' '}
        <span className="font-medium">(seleccionado − referencia) / |referencia|</span>; en montos sirve para ver si
        mejoró respecto al otro tramo.
      </p>
      {hintB ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{hintB}</p> : null}
    </>
  )

  const tableBody = rows.map((row) => {
    const nb = b ? row.numB(b) : null
    const delta = b && nb !== null ? pctDeltaVsRef(row.numA, nb) : loadingB ? '…' : '—'
    if (isSaas) {
      return (
        <tr key={row.key} className="va-table-body-row">
          <td className="va-table-td text-slate-600 dark:text-slate-300">{row.key}</td>
          <td className="va-table-td tabular-nums text-slate-900 dark:text-slate-50">{row.fmt(a)}</td>
          <td className="va-table-td tabular-nums text-slate-700 dark:text-slate-200">
            {loadingB ? '…' : b ? row.fmt(b) : '—'}
          </td>
          <td className="va-table-td tabular-nums text-slate-600 dark:text-slate-300">{delta}</td>
        </tr>
      )
    }
    return (
      <tr key={row.key} className="border-b border-slate-200 dark:border-slate-800">
        <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{row.key}</td>
        <td className="py-2 pr-3 tabular-nums text-slate-900 dark:text-slate-50">{row.fmt(a)}</td>
        <td className="py-2 pr-3 tabular-nums text-slate-700 dark:text-slate-200">
          {loadingB ? '…' : b ? row.fmt(b) : '—'}
        </td>
        <td className="py-2 tabular-nums text-slate-600 dark:text-slate-300">{delta}</td>
      </tr>
    )
  })

  if (isSaas) {
    return (
      <div className="va-saas-page-section overflow-hidden !p-0">
        <div className="border-b border-[var(--va-surface-border)] bg-[var(--va-surface-muted)] px-4 py-3 sm:px-5">
          {intro}
        </div>
        <div className="va-table-scroll">
          <table className="va-table min-w-[28rem]">
            <thead>
              <tr className="va-table-head-row">
                <th className="va-table-th">Métrica</th>
                <th className="va-table-th">{labelA}</th>
                <th className="va-table-th">{labelB}</th>
                <th className="va-table-th">Variación</th>
              </tr>
            </thead>
            <tbody>{tableBody}</tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
      {intro}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
              <th className="py-2 pr-3 font-medium">Métrica</th>
              <th className="py-2 pr-3 font-medium">{labelA}</th>
              <th className="py-2 pr-3 font-medium">{labelB}</th>
              <th className="py-2 font-medium">Variación</th>
            </tr>
          </thead>
          <tbody>{tableBody}</tbody>
        </table>
      </div>
    </div>
  )
}

type ReportsTab =
  | 'resumen'
  | 'ingresos_unificados'
  | 'rentabilidad_ot'
  | 'libro_diario'
  | 'medios_pago'
  | 'impuestos'
  | 'dian_status'
  | 'utilidad_tecnico'
  | 'utilidad_servicio'

const TABS: Array<{ id: ReportsTab; label: string }> = [
  { id: 'resumen', label: 'Resumen económico' },
  { id: 'ingresos_unificados', label: 'Ingresos unificados' },
  { id: 'medios_pago', label: 'Medios de pago' },
  { id: 'rentabilidad_ot', label: 'Rentabilidad por OT' },
  { id: 'utilidad_tecnico', label: 'Utilidad por técnico' },
  { id: 'utilidad_servicio', label: 'Utilidad por servicio' },
  { id: 'impuestos', label: 'IVA/INC causado' },
  { id: 'dian_status', label: 'Estado DIAN' },
  { id: 'libro_diario', label: 'Libro diario (caja)' },
]

export function ReportsPage() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const [activeTab, setActiveTab] = useState<ReportsTab>('resumen')
  const [preset, setPreset] = useState<PresetId>('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [data, setData] = useState<EconomicSummary | null>(null)
  const [compareData, setCompareData] = useState<EconomicSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingCompare, setLoadingCompare] = useState(false)

  const [compareOn, setCompareOn] = useState(false)
  const [compareKind, setCompareKind] = useState<CompareKind>('previous_block')
  const [compareBFrom, setCompareBFrom] = useState('')
  const [compareBTo, setCompareBTo] = useState('')

  const range = useMemo(() => {
    if (preset === 'custom') {
      let from = customFrom.trim()
      let to = customTo.trim()
      if (!from || !to) {
        const fb = PRESETS[0].range()
        return fb
      }
      if (from > to) [from, to] = [to, from]
      return { from, to }
    }
    const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]
    return p.range()
  }, [preset, customFrom, customTo])

  const compareRange = useMemo(() => {
    if (!compareOn) return null
    if (compareKind === 'previous_block') return previousSameLengthRange(range.from, range.to)
    if (compareKind === 'prev_month') return previousFullMonthUtc(range.from)
    let cf = compareBFrom.trim()
    let ct = compareBTo.trim()
    if (!cf || !ct) return null
    if (cf > ct) [cf, ct] = [ct, cf]
    return { from: cf, to: ct }
  }, [compareOn, compareKind, range.from, range.to, compareBFrom, compareBTo])

  const compareHint = useMemo(() => {
    if (!compareOn) return undefined
    if (compareKind === 'custom_b' && !compareRange) return 'Definí fecha desde y hasta del período B (calendario).'
    return undefined
  }, [compareOn, compareKind, compareRange])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    const fetchCompare = Boolean(compareOn && compareRange)
    if (fetchCompare) setLoadingCompare(true)
    try {
      const qs = new URLSearchParams({
        from: range.from,
        to: range.to,
        granularity,
      })
      const res = await api<EconomicSummary>(`/reports/economic-summary?${qs}`)
      setData(res)

      if (fetchCompare && compareRange) {
        const qs2 = new URLSearchParams({
          from: compareRange.from,
          to: compareRange.to,
          granularity,
        })
        const res2 = await api<EconomicSummary>(`/reports/economic-summary?${qs2}`)
        setCompareData(res2)
      } else {
        setCompareData(null)
      }
    } catch (e) {
      setData(null)
      setCompareData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar informes')
    } finally {
      setLoading(false)
      setLoadingCompare(false)
    }
  }, [range.from, range.to, granularity, compareOn, compareRange?.from, compareRange?.to])

  useEffect(() => {
    void load()
  }, [load])

  function onPresetChange(next: PresetId) {
    if (next === 'custom' && preset !== 'custom') {
      const r = PRESETS.find((p) => p.id === preset)?.range() ?? PRESETS[0].range()
      setCustomFrom(r.from)
      setCustomTo(r.to)
    }
    setPreset(next)
  }

  const compareKindLabel: Record<CompareKind, string> = {
    previous_block: 'Bloque anterior (misma cantidad de días)',
    prev_month: 'Mes calendario UTC previo (al mes de inicio del rango A)',
    custom_b: 'Otro rango (calendario B)',
  }
  const filtersCardClass = isSaas
    ? 'va-saas-page-section'
    : 'space-y-4 rounded-2xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900'
  const statsCardClass = isSaas ? 'va-saas-panel-tile' : 'rounded-2xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900'
  const actionBtnClass = isSaas
    ? 'rounded-lg border border-slate-200/90 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
    : 'rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'

  const tabBtnClass = (active: boolean): string => {
    if (isSaas) {
      return active
        ? 'rounded-lg border border-[var(--va-brand-border)] bg-[var(--va-brand-surface)] px-3 py-1.5 text-sm font-medium text-[var(--va-brand-ink)]'
        : 'rounded-lg border border-[var(--va-surface-border)] bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
    }
    return active
      ? 'rounded-lg border border-brand-500 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
      : 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Informes"
        description="Vista agregada de caja, cobros en órdenes y actividad de OT. Los períodos usan fechas UTC (coinciden con el API). Podés fijar un rango con el calendario o comparar contra otro tramo."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={tabBtnClass(activeTab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'ingresos_unificados' && <RevenueUnifiedPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'rentabilidad_ot' && <WorkOrderProfitabilityPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'libro_diario' && <CashJournalPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'medios_pago' && <SalesByPaymentMethodPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'impuestos' && <TaxCausadoPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'dian_status' && <DianStatusPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'utilidad_tecnico' && <ProfitabilityByTechnicianPanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}
      {activeTab === 'utilidad_servicio' && <ProfitabilityByServicePanel statsCardClass={statsCardClass} actionBtnClass={actionBtnClass} />}

      {activeTab === 'resumen' && <>

      <div className={filtersCardClass}>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block text-sm">
            <span className="va-label">Período</span>
            <select
              value={preset}
              onChange={(e) => onPresetChange(e.target.value as PresetId)}
              className="va-field mt-1 min-w-[12rem]"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Rango personalizado (calendario)</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="va-label">Agrupación</span>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              className="va-field mt-1 min-w-[10rem]"
            >
              {GRANULARITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={actionBtnClass}
          >
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="block text-sm">
              <span className="va-label">Desde (UTC)</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="va-field mt-1 min-w-[11rem]"
              />
            </label>
            <label className="block text-sm">
              <span className="va-label">Hasta (UTC)</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="va-field mt-1 min-w-[11rem]"
              />
            </label>
            <p className="max-w-md text-xs text-slate-600 dark:text-slate-300">
              El navegador muestra el selector de calendario. Las fechas se envían como día calendario UTC al API.
            </p>
          </div>
        )}

        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={compareOn}
              onChange={(e) => setCompareOn(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
            />
            <span className="font-medium">Comparar con otro período</span>
          </label>
          {compareOn && (
            <div className="mt-3 space-y-3">
              <label className="block max-w-xl text-sm">
                <span className="va-label">Modo de comparación</span>
                <select
                  value={compareKind}
                  onChange={(e) => setCompareKind(e.target.value as CompareKind)}
                  className="va-field mt-1 w-full"
                >
                  {(Object.keys(compareKindLabel) as CompareKind[]).map((k) => (
                    <option key={k} value={k}>
                      {compareKindLabel[k]}
                    </option>
                  ))}
                </select>
              </label>
              {compareKind === 'custom_b' && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="block text-sm">
                    <span className="va-label">Período B — desde</span>
                    <input
                      type="date"
                      value={compareBFrom}
                      onChange={(e) => setCompareBFrom(e.target.value)}
                      className="va-field mt-1 min-w-[11rem]"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="va-label">Período B — hasta</span>
                    <input
                      type="date"
                      value={compareBTo}
                      onChange={(e) => setCompareBTo(e.target.value)}
                      className="va-field mt-1 min-w-[11rem]"
                    />
                  </label>
                </div>
              )}
              {compareRange && (
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
                  Referencia (B): {compareRange.from} → {compareRange.to} · {granularity}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {err && (
        <p className="va-alert-error">
          {err}
        </p>
      )}

      {loading && !data && <p className="text-slate-600 dark:text-slate-300">Cargando…</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>
          <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
            Seleccionado (A): {data.from} → {data.to} · {data.granularity}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Ingresos caja', moneyEs(data.totals.incomeTotal), 'text-emerald-700 dark:text-emerald-300'],
              ['Egresos caja', moneyEs(data.totals.expenseTotal), 'text-red-700 dark:text-red-300'],
              ['Resultado caja (neto)', moneyEs(data.totals.netCash), 'text-brand-800 dark:text-brand-100'],
              ['Cobros en OT', moneyEs(data.totals.otPaymentsTotal), 'text-slate-800 dark:text-slate-100'],
            ].map(([k, v, cls]) => (
              <div key={String(k)} className={statsCardClass}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">{k}</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${cls}`}>{v}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={statsCardClass}>
              <p className="text-xs text-slate-600 dark:text-slate-300">OT abiertas en período</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{data.totals.workOrdersOpened}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs text-slate-600 dark:text-slate-300">OT entregadas (fecha entrega)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{data.totals.workOrdersDelivered}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs text-slate-600 dark:text-slate-300">Vehículos distintos (aprox. atendidos)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{data.totals.distinctVehiclesTouched}</p>
            </div>
          </div>

          {compareOn && (
            <ComparisonBlock
              labelA={`A: ${data.from} → ${data.to}`}
              labelB={compareRange ? `B: ${compareRange.from} → ${compareRange.to}` : 'B: (definí fechas)'}
              a={data.totals}
              b={compareData?.totals ?? null}
              loadingB={loadingCompare}
              hintB={compareHint}
            />
          )}

          {data.series.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className={statsCardClass}>
                <BarChart
                  rows={data.series}
                  getNumeric={(r) => Number.parseFloat(r.incomeTotal)}
                  format={(r) => moneyEs(r.incomeTotal)}
                  label="Ingresos por período"
                  color="bg-emerald-500"
                />
              </div>
              <div className={statsCardClass}>
                <BarChart
                  rows={data.series}
                  getNumeric={(r) => Number.parseFloat(r.netCash)}
                  format={(r) => moneyEs(r.netCash)}
                  label="Resultado caja por período"
                  color="bg-brand-500"
                />
              </div>
            </div>
          )}
        </>
      )}

      </>}
    </div>
  )
}

function moneyCOP(n: string | number): string {
  const x = typeof n === 'string' ? Number.parseFloat(n) : n
  if (Number.isNaN(x)) return String(n)
  return x.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function todayYmdUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function startOfMonthYmdUtc(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

type RevenueUnifiedResponse = {
  from: string
  to: string
  granularity: Granularity
  disclaimer: string
  series: Array<{
    periodKey: string
    periodLabel: string
    invoicesTotal: string
    salesTotal: string
    workOrdersTotal: string
    grandTotal: string
    documentCount: number
  }>
  counts: { invoices: number; sales: number; workOrders: number }
  totals: {
    invoicesTotal: string
    salesTotal: string
    workOrdersTotal: string
    grandTotal: string
    documentCount: number
  }
}

function RevenueUnifiedPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [data, setData] = useState<RevenueUnifiedResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to, granularity })
      const res = await api<RevenueUnifiedResponse>(`/reports/revenue-unified?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar ingresos unificados')
    } finally {
      setLoading(false)
    }
  }, [from, to, granularity])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Agrupación</span>
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)} className="va-field mt-1 min-w-[10rem]">
            {GRANULARITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Facturas</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-100">{moneyCOP(data.totals.invoicesTotal)}</p>
              <p className="text-xs text-slate-500">{data.counts.invoices} doc.</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Ventas</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{moneyCOP(data.totals.salesTotal)}</p>
              <p className="text-xs text-slate-500">{data.counts.sales} doc.</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">OT (sin venta/factura)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{moneyCOP(data.totals.workOrdersTotal)}</p>
              <p className="text-xs text-slate-500">{data.counts.workOrders} doc.</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Total unificado</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{moneyCOP(data.totals.grandTotal)}</p>
              <p className="text-xs text-slate-500">{data.totals.documentCount} doc.</p>
            </div>
          </div>

          {data.series.length > 0 && (
            <div className="va-table-scroll">
              <table className="va-table min-w-[40rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">Período</th>
                    <th className="va-table-th">Facturas</th>
                    <th className="va-table-th">Ventas</th>
                    <th className="va-table-th">OT</th>
                    <th className="va-table-th">Total</th>
                    <th className="va-table-th">Docs.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((r) => (
                    <tr key={r.periodKey} className="va-table-body-row">
                      <td className="va-table-td">{r.periodLabel}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.invoicesTotal)}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.salesTotal)}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.workOrdersTotal)}</td>
                      <td className="va-table-td tabular-nums font-semibold">{moneyCOP(r.grandTotal)}</td>
                      <td className="va-table-td tabular-nums">{r.documentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type WoProfitabilityResponse = {
  from: string
  to: string
  disclaimer: string
  rows: Array<{
    workOrderId: string
    publicCode: string
    orderNumber: number
    customerName: string | null
    vehiclePlate: string | null
    deliveredAt: string | null
    assignedTo: { id: string; fullName: string | null; email: string } | null
    lineCount: number
    grandTotal: string
    totalCost: string | null
    totalProfit: string | null
    marginPct: string | null
    costUnknown: boolean
  }>
  totals: {
    workOrdersConsidered: number
    workOrdersCounted: number
    revenueTotal: string
    costTotal: string
    profitTotal: string
    marginPctAvg: string | null
  }
}

function WorkOrderProfitabilityPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [data, setData] = useState<WoProfitabilityResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      const res = await api<WoProfitabilityResponse>(`/reports/work-order-profitability?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar rentabilidad')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Ingreso (OT entregadas)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{moneyCOP(data.totals.revenueTotal)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Costo (repuestos)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-red-700 dark:text-red-300">{moneyCOP(data.totals.costTotal)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Utilidad</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-100">{moneyCOP(data.totals.profitTotal)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Margen promedio</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.marginPctAvg ? `${data.totals.marginPctAvg}%` : '—'}</p>
              <p className="text-xs text-slate-500">{data.totals.workOrdersCounted} de {data.totals.workOrdersConsidered} OT</p>
            </div>
          </div>

          {data.rows.length > 0 && (
            <div className="va-table-scroll">
              <table className="va-table min-w-[52rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">OT</th>
                    <th className="va-table-th">Cliente / Placa</th>
                    <th className="va-table-th">Entregada</th>
                    <th className="va-table-th">Ingreso</th>
                    <th className="va-table-th">Costo</th>
                    <th className="va-table-th">Utilidad</th>
                    <th className="va-table-th">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.workOrderId} className="va-table-body-row">
                      <td className="va-table-td font-mono text-xs">{r.publicCode}</td>
                      <td className="va-table-td">
                        <div>{r.customerName ?? '—'}</div>
                        <div className="text-xs text-slate-500">{r.vehiclePlate ?? '—'}</div>
                      </td>
                      <td className="va-table-td text-xs">{r.deliveredAt ? r.deliveredAt.slice(0, 10) : '—'}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.grandTotal)}</td>
                      <td className="va-table-td tabular-nums">
                        {r.costUnknown ? <span className="text-amber-600 dark:text-amber-400" title="Línea PART sin costSnapshot; margen no confiable">sin snapshot</span> : moneyCOP(r.totalCost ?? '0')}
                      </td>
                      <td className="va-table-td tabular-nums">{r.totalProfit ? moneyCOP(r.totalProfit) : '—'}</td>
                      <td className="va-table-td tabular-nums">{r.marginPct ? `${r.marginPct}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type CashJournalResponse = {
  from: string
  to: string
  sessionId: string | null
  rows: Array<{
    id: string
    sessionId: string
    createdAt: string
    direction: 'INCOME' | 'EXPENSE'
    amount: string
    category: { slug: string; name: string } | null
    referenceType: string | null
    referenceTypeLabel: string
    referenceId: string | null
    note: string | null
    createdBy: { id: string; fullName: string | null; email: string } | null
  }>
  totals: { count: number; incomeTotal: string; expenseTotal: string; netTotal: string }
}

function CashJournalPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [sessionId, setSessionId] = useState('')
  const [data, setData] = useState<CashJournalResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      if (sessionId.trim()) qs.set('sessionId', sessionId.trim())
      const res = await api<CashJournalResponse>(`/reports/cash-journal?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar libro diario')
    } finally {
      setLoading(false)
    }
  }, [from, to, sessionId])

  useEffect(() => { void load() }, [load])

  async function onExportXlsx() {
    setErr(null)
    setExporting(true)
    try {
      const qs = new URLSearchParams({ from, to })
      if (sessionId.trim()) qs.set('sessionId', sessionId.trim())
      await downloadFile(`/reports/cash-journal.xlsx?${qs}`, `libro-diario_${from}_${to}.xlsx`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al exportar XLSX')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Sesión (opcional)</span>
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="id de sesión"
            className="va-field mt-1 min-w-[18rem]"
          />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
        <button type="button" onClick={() => void onExportXlsx()} disabled={exporting || !data} className={actionBtnClass}>
          {exporting ? 'Exportando…' : 'Exportar XLSX'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Movimientos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.count}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Ingresos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{moneyCOP(data.totals.incomeTotal)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Egresos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-red-700 dark:text-red-300">{moneyCOP(data.totals.expenseTotal)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Neto</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-100">{moneyCOP(data.totals.netTotal)}</p>
            </div>
          </div>

          {data.rows.length > 0 ? (
            <div className="va-table-scroll">
              <table className="va-table min-w-[60rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">Fecha (UTC)</th>
                    <th className="va-table-th">Dir.</th>
                    <th className="va-table-th">Monto</th>
                    <th className="va-table-th">Categoría</th>
                    <th className="va-table-th">Referencia</th>
                    <th className="va-table-th">Nota</th>
                    <th className="va-table-th">Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="va-table-body-row">
                      <td className="va-table-td text-xs font-mono">{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                      <td className="va-table-td">
                        {r.direction === 'INCOME' ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">Ingreso</span>
                        ) : (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900/50 dark:text-red-200">Egreso</span>
                        )}
                      </td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.amount)}</td>
                      <td className="va-table-td">{r.category?.name ?? '—'}</td>
                      <td className="va-table-td text-xs">
                        <div>{r.referenceTypeLabel}</div>
                        {r.referenceId && <div className="font-mono text-slate-500">{r.referenceId.slice(0, 12)}…</div>}
                      </td>
                      <td className="va-table-td max-w-xs truncate" title={r.note ?? ''}>{r.note ?? '—'}</td>
                      <td className="va-table-td text-xs">{r.createdBy?.fullName ?? r.createdBy?.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Sin movimientos en el rango seleccionado.</p>
          )}
        </>
      )}
    </div>
  )
}

// ============================================================================
// Fase 8 · Reportes y paneles de negocio.
// ============================================================================

type SalesByPaymentMethodResponse = {
  from: string
  to: string
  disclaimer: string
  rows: Array<{
    slug: string
    label: string
    amount: string
    count: number
    sharePct: string | null
  }>
  totals: { count: number; amount: string; methods: number }
}

function SalesByPaymentMethodPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [data, setData] = useState<SalesByPaymentMethodResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      const res = await api<SalesByPaymentMethodResponse>(`/reports/sales-by-payment-method?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar medios de pago')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Cobros totales</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{moneyCOP(data.totals.amount)}</p>
              <p className="text-xs text-slate-500">{data.totals.count} movimientos</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Medios distintos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.methods}</p>
            </div>
          </div>

          {data.rows.length > 0 ? (
            <div className="va-table-scroll">
              <table className="va-table min-w-[36rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">Medio de pago</th>
                    <th className="va-table-th">Monto</th>
                    <th className="va-table-th">% del total</th>
                    <th className="va-table-th">Movimientos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.slug} className="va-table-body-row">
                      <td className="va-table-td">
                        <div>{r.label}</div>
                        <div className="font-mono text-xs text-slate-500">{r.slug}</div>
                      </td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.amount)}</td>
                      <td className="va-table-td tabular-nums">{r.sharePct ? `${r.sharePct}%` : '—'}</td>
                      <td className="va-table-td tabular-nums">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Sin cobros vinculados a venta, OT o factura en el rango.</p>
          )}
        </>
      )}
    </div>
  )
}

type TaxCausadoResponse = {
  from: string
  to: string
  disclaimer: string
  rows: Array<{
    taxRateId: string
    slug: string
    name: string
    kind: 'VAT' | 'INC'
    ratePercent: string
    taxableBase: string
    taxAmount: string
    lineCount: number
  }>
  totals: {
    lineCount: number
    taxableBase: string
    totalTax: string
    totalVat: string
    totalInc: string
  }
}

function TaxCausadoPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [data, setData] = useState<TaxCausadoResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      const res = await api<TaxCausadoResponse>(`/reports/tax-causado?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar impuestos causados')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Base gravable</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{moneyCOP(data.totals.taxableBase)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">IVA causado</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{moneyCOP(data.totals.totalVat)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">INC causado</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-100">{moneyCOP(data.totals.totalInc)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Impuesto total</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{moneyCOP(data.totals.totalTax)}</p>
              <p className="text-xs text-slate-500">{data.totals.lineCount} líneas</p>
            </div>
          </div>

          {data.rows.length > 0 ? (
            <div className="va-table-scroll">
              <table className="va-table min-w-[40rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">Tarifa</th>
                    <th className="va-table-th">Tipo</th>
                    <th className="va-table-th">%</th>
                    <th className="va-table-th">Base gravable</th>
                    <th className="va-table-th">Impuesto</th>
                    <th className="va-table-th">Líneas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.taxRateId} className="va-table-body-row">
                      <td className="va-table-td">
                        <div>{r.name}</div>
                        <div className="font-mono text-xs text-slate-500">{r.slug}</div>
                      </td>
                      <td className="va-table-td">{r.kind === 'VAT' ? 'IVA' : 'INC'}</td>
                      <td className="va-table-td tabular-nums">{r.ratePercent}%</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.taxableBase)}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.taxAmount)}</td>
                      <td className="va-table-td tabular-nums">{r.lineCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Sin facturas emitidas con impuesto en el rango.</p>
          )}
        </>
      )}
    </div>
  )
}

type DianStatusResponse = {
  from: string
  to: string
  disclaimer: string
  byStatus: {
    DRAFT: { count: number; amount: string }
    ISSUED: { count: number; amount: string }
    VOIDED: { count: number; amount: string }
  }
  dispatch: {
    NO_DISPATCH: number
    PENDING: number
    SUBMITTED: number
    ACCEPTED: number
    REJECTED: number
    ERROR: number
    NOT_CONFIGURED: number
  }
  totals: { invoiceCount: number }
}

const DISPATCH_LABELS: Record<keyof DianStatusResponse['dispatch'], { label: string; color: string }> = {
  ACCEPTED: { label: 'Aceptadas', color: 'text-emerald-700 dark:text-emerald-300' },
  REJECTED: { label: 'Rechazadas', color: 'text-red-700 dark:text-red-300' },
  PENDING: { label: 'Pendientes', color: 'text-amber-700 dark:text-amber-300' },
  SUBMITTED: { label: 'Enviadas (en espera)', color: 'text-blue-700 dark:text-blue-300' },
  ERROR: { label: 'Con error', color: 'text-red-700 dark:text-red-300' },
  NOT_CONFIGURED: { label: 'Sin proveedor configurado', color: 'text-slate-500 dark:text-slate-400' },
  NO_DISPATCH: { label: 'Emitidas sin intento de envío', color: 'text-slate-500 dark:text-slate-400' },
}

function DianStatusPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [data, setData] = useState<DianStatusResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      const res = await api<DianStatusResponse>(`/reports/dian-status?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar estado DIAN')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Borradores (DRAFT)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.byStatus.DRAFT.count}</p>
              <p className="text-xs text-slate-500">{moneyCOP(data.byStatus.DRAFT.amount)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Emitidas (ISSUED)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{data.byStatus.ISSUED.count}</p>
              <p className="text-xs text-slate-500">{moneyCOP(data.byStatus.ISSUED.amount)}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Anuladas (VOIDED)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-red-700 dark:text-red-300">{data.byStatus.VOIDED.count}</p>
              <p className="text-xs text-slate-500">{moneyCOP(data.byStatus.VOIDED.amount)}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Estado de envío DIAN (último evento por factura emitida)</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(DISPATCH_LABELS) as Array<keyof DianStatusResponse['dispatch']>).map((k) => (
                <div key={k} className={statsCardClass}>
                  <p className={`text-xs font-medium uppercase tracking-wide ${DISPATCH_LABELS[k].color}`}>{DISPATCH_LABELS[k].label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{data.dispatch[k]}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

type ProfitabilityByTechnicianResponse = {
  from: string
  to: string
  disclaimer: string
  rows: Array<{
    technicianId: string | null
    fullName: string | null
    email: string | null
    label: string
    workOrdersConsidered: number
    workOrdersCounted: number
    workOrdersUnknownCost: number
    revenueTotal: string
    costTotal: string
    profitTotal: string
    marginPct: string | null
  }>
  totals: { technicianCount: number; workOrdersConsidered: number }
}

function ProfitabilityByTechnicianPanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [data, setData] = useState<ProfitabilityByTechnicianResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      const res = await api<ProfitabilityByTechnicianResponse>(`/reports/profitability-by-technician?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar utilidad por técnico')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Técnicos involucrados</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.technicianCount}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">OT entregadas</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.workOrdersConsidered}</p>
            </div>
          </div>

          {data.rows.length > 0 ? (
            <div className="va-table-scroll">
              <table className="va-table min-w-[52rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">Técnico</th>
                    <th className="va-table-th">OT</th>
                    <th className="va-table-th">Ingreso</th>
                    <th className="va-table-th">Costo</th>
                    <th className="va-table-th">Utilidad</th>
                    <th className="va-table-th">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.technicianId ?? 'unassigned'} className="va-table-body-row">
                      <td className="va-table-td">
                        <div>{r.label}</div>
                        {r.email && r.fullName && <div className="text-xs text-slate-500">{r.email}</div>}
                      </td>
                      <td className="va-table-td text-xs">
                        <div>{r.workOrdersCounted} contadas / {r.workOrdersConsidered} total</div>
                        {r.workOrdersUnknownCost > 0 && (
                          <div className="text-amber-600 dark:text-amber-400">{r.workOrdersUnknownCost} sin snapshot</div>
                        )}
                      </td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.revenueTotal)}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.costTotal)}</td>
                      <td className="va-table-td tabular-nums font-semibold">{moneyCOP(r.profitTotal)}</td>
                      <td className="va-table-td tabular-nums">{r.marginPct ? `${r.marginPct}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Sin OT entregadas en el rango.</p>
          )}
        </>
      )}
    </div>
  )
}

type ProfitabilityByServiceResponse = {
  from: string
  to: string
  disclaimer: string
  rows: Array<{
    serviceKey: string
    name: string
    lineCount: number
    revenue: string
    cost: string
    profit: string
  }>
  totals: { serviceCount: number; lineCount: number }
}

function ProfitabilityByServicePanel({ statsCardClass, actionBtnClass }: { statsCardClass: string; actionBtnClass: string }) {
  const [from, setFrom] = useState(startOfMonthYmdUtc())
  const [to, setTo] = useState(todayYmdUtc())
  const [data, setData] = useState<ProfitabilityByServiceResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      const res = await api<ProfitabilityByServiceResponse>(`/reports/profitability-by-service?${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Error al cargar utilidad por servicio')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm">
          <span className="va-label">Desde (UTC)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Hasta (UTC)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="va-field mt-1 min-w-[11rem]" />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className={actionBtnClass}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="va-alert-error">{err}</p>}

      {data && (
        <>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{data.disclaimer}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Servicios distintos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.serviceCount}</p>
            </div>
            <div className={statsCardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Líneas LABOR</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{data.totals.lineCount}</p>
            </div>
          </div>

          {data.rows.length > 0 ? (
            <div className="va-table-scroll">
              <table className="va-table min-w-[48rem]">
                <thead>
                  <tr className="va-table-head-row">
                    <th className="va-table-th">Servicio</th>
                    <th className="va-table-th">Líneas</th>
                    <th className="va-table-th">Ingreso</th>
                    <th className="va-table-th">Costo</th>
                    <th className="va-table-th">Utilidad</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.serviceKey} className="va-table-body-row">
                      <td className="va-table-td">{r.name}</td>
                      <td className="va-table-td tabular-nums">{r.lineCount}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.revenue)}</td>
                      <td className="va-table-td tabular-nums">{moneyCOP(r.cost)}</td>
                      <td className="va-table-td tabular-nums font-semibold">{moneyCOP(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Sin líneas LABOR en OT del rango.</p>
          )}
        </>
      )}
    </div>
  )
}
