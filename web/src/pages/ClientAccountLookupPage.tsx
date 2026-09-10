import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { portalPath } from '../constants/portalPath'
import { formatCopFromString } from '../utils/copFormat'
import { downloadPortalPdf } from '../lib/portalPdf'
import type {
  ClientPortalAccount,
  PortalInvoice,
  PortalOrder,
  PortalVehicle,
  WorkOrderStatus,
} from '../api/types'

function usePrefersColorSchemeDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

const STATUS: Record<WorkOrderStatus, { label: string; tone: string }> = {
  UNASSIGNED: { label: 'Sin asignar', tone: 'bg-slate-200 text-slate-900 dark:bg-slate-600 dark:text-white' },
  RECEIVED: { label: 'Recibida', tone: 'bg-slate-300 text-slate-900 dark:bg-slate-500 dark:text-white' },
  IN_WORKSHOP: { label: 'En taller', tone: 'bg-brand-700 text-white' },
  WAITING_PARTS: { label: 'Esperando repuestos', tone: 'bg-amber-500 text-amber-950' },
  READY: { label: 'Lista para retiro', tone: 'bg-emerald-700 text-white' },
  DELIVERED: { label: 'Entregada', tone: 'bg-slate-600 text-white' },
  CANCELLED: { label: 'Cancelada', tone: 'bg-red-700 text-white' },
}

const INVOICE_STATUS: Record<PortalInvoice['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Borrador', tone: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
  ISSUED: { label: 'Aceptada', tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200' },
  VOIDED: { label: 'Anulada', tone: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200' },
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function money(s: string | null | undefined): string {
  if (!s) return '$0'
  return `$${formatCopFromString(s)}`
}

const TOTAL_LABEL: Record<'subtotal' | 'totalDiscount' | 'totalTax' | 'grandTotal' | 'amountPaid' | 'amountDue', string> = {
  subtotal: 'Subtotal',
  totalDiscount: 'Descuentos',
  totalTax: 'Impuestos',
  grandTotal: 'Total',
  amountPaid: 'Pagado',
  amountDue: 'Saldo',
}

function TotalsList({ order }: { order: PortalOrder }) {
  const items: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: TOTAL_LABEL.subtotal, value: money(order.subtotal) },
  ]
  if (Number(order.totalDiscount) > 0) {
    items.push({ label: TOTAL_LABEL.totalDiscount, value: `−${money(order.totalDiscount)}` })
  }
  if (Number(order.totalTax) > 0) {
    items.push({ label: TOTAL_LABEL.totalTax, value: money(order.totalTax) })
  }
  items.push({ label: TOTAL_LABEL.grandTotal, value: money(order.grandTotal), strong: true })
  if (Number(order.amountPaid) > 0) {
    items.push({ label: TOTAL_LABEL.amountPaid, value: `−${money(order.amountPaid)}` })
  }
  items.push({ label: TOTAL_LABEL.amountDue, value: money(order.amountDue), strong: true })

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-slate-500 dark:text-slate-300">{it.label}</dt>
          <dd className={`tabular-nums text-sm ${it.strong ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function LinesTable({ lines }: { lines: PortalOrder['lines'] }) {
  if (lines.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-300">Sin líneas registradas.</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
      <table className="va-table min-w-[560px]">
        <thead>
          <tr>
            <th className="va-table-th">Detalle</th>
            <th className="va-table-th text-right">Cant.</th>
            <th className="va-table-th text-right">Unitario</th>
            <th className="va-table-th text-right">IVA</th>
            <th className="va-table-th text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) => (
            <tr key={i}>
              <td className="va-table-td">
                <span className="text-xs text-slate-500 dark:text-slate-300">
                  {ln.lineType === 'LABOR' ? 'Mano de obra' : 'Repuesto'}
                </span>
                <div className="text-sm text-slate-800 dark:text-slate-100">{ln.description || '—'}</div>
              </td>
              <td className="va-table-td text-right tabular-nums">{ln.quantity}</td>
              <td className="va-table-td text-right tabular-nums">{money(ln.unitPrice)}</td>
              <td className="va-table-td text-right tabular-nums">{Number(ln.taxPercent) > 0 ? `${Number(ln.taxPercent)}%` : '—'}</td>
              <td className="va-table-td text-right font-medium tabular-nums">{money(ln.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InvoiceBlock({ invoice }: { invoice: PortalInvoice }) {
  const st = INVOICE_STATUS[invoice.status]
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{invoice.documentNumber}</span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
        <span className="text-xs text-slate-500 dark:text-slate-300">{formatWhen(invoice.issuedAt ?? invoice.createdAt)}</span>
      </div>
      {invoice.status === 'ISSUED' && invoice.cufe ? (
        <p className="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">CUFE: {invoice.cufe}</p>
      ) : null}
      <div className="mt-3">
        <LinesTable lines={invoice.lines} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-slate-500 dark:text-slate-300">Subtotal</dt>
          <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{money(invoice.subtotal)}</dd>
        </div>
        {Number(invoice.totalDiscount) > 0 ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-slate-500 dark:text-slate-300">Descuentos</dt>
            <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">−{money(invoice.totalDiscount)}</dd>
          </div>
        ) : null}
        {Number(invoice.totalTax) > 0 ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-slate-500 dark:text-slate-300">Impuestos</dt>
            <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{money(invoice.totalTax)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-300">Total</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{money(invoice.grandTotal)}</dd>
        </div>
        {invoice.creditNotes.length > 0 ? (
          <div className="col-span-2">
            <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">Notas crédito emitidas</p>
            <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
              {invoice.creditNotes.map((cn) => (
                <li key={cn.documentNumber} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {cn.documentNumber} — {cn.reason || 'sin motivo'}
                  </span>
                  <span className="tabular-nums">−{money(cn.grandTotal)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-slate-500 dark:text-slate-300">Pagado</dt>
          <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">−{money(invoice.amountPaid)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-300">Saldo</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{money(invoice.amountDue)}</dd>
        </div>
      </dl>
    </div>
  )
}

function OrderBlock({
  vehicle,
  order,
  onDownload,
  downloading,
}: {
  vehicle: PortalVehicle
  order: PortalOrder
  onDownload: (v: PortalVehicle, o: PortalOrder) => void
  downloading: boolean
}) {
  const st = STATUS[order.status]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2 py-1 text-xs font-semibold tracking-tight ${st.tone}`}>{st.label}</span>
        <span className="font-mono text-sm text-slate-700 dark:text-slate-200">{order.publicCode}</span>
        <span className="text-xs text-slate-500 dark:text-slate-300">{formatWhen(order.createdAt)}</span>
        <button
          type="button"
          onClick={() => onDownload(vehicle, order)}
          disabled={downloading}
          className="ml-auto va-btn-secondary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
        >
          {downloading ? 'Generando PDF…' : 'Descargar PDF'}
        </button>
      </div>

      {order.description ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{order.description}</p>
      ) : null}

      {order.lines.length > 0 ? (
        <div className="mt-4">
          <LinesTable lines={order.lines} />
        </div>
      ) : null}

      <div className="mt-4">
        <TotalsList order={order} />
      </div>

      {order.invoices.length > 0 ? (
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">Facturas</p>
          {order.invoices.map((inv) => (
            <InvoiceBlock key={inv.documentNumber} invoice={inv} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function VehicleBlock({
  vehicle,
  onDownload,
  downloadingKey,
}: {
  vehicle: PortalVehicle
  onDownload: (v: PortalVehicle, o: PortalOrder) => void
  downloadingKey: string | null
}) {
  return (
    <section className="rounded-2xl border border-slate-200/85 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{vehicle.plate}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {[vehicle.brand, vehicle.model, vehicle.year ? String(vehicle.year) : null, vehicle.color]
            .filter(Boolean)
            .join(' · ') || 'Vehículo'}
        </p>
      </div>
      <div className="mt-4 space-y-4">
        {vehicle.orders.map((order) => (
          <OrderBlock
            key={order.publicCode}
            vehicle={vehicle}
            order={order}
            onDownload={onDownload}
            downloading={downloadingKey === order.publicCode}
          />
        ))}
      </div>
    </section>
  )
}

export function ClientAccountLookupPage() {
  const prefersDark = usePrefersColorSchemeDark()
  const [plate, setPlate] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<ClientPortalAccount | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setResult(null)
    setLoading(true)
    try {
      const data = await api<ClientPortalAccount>('/client-portal/account', {
        method: 'POST',
        body: JSON.stringify({
          plate: plate.trim(),
          phone: phone.trim(),
        }),
      })
      setResult(data)
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message)
      } else {
        setErr('No se pudo completar la consulta.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function onDownload(vehicle: PortalVehicle, order: PortalOrder) {
    if (!result) return
    setDownloadingKey(order.publicCode)
    try {
      await downloadPortalPdf(result, vehicle, order)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setDownloadingKey(null)
    }
  }

  return (
    <div className={prefersDark ? 'dark' : ''} style={{ colorScheme: prefersDark ? 'dark' : 'light' }}>
      <div className="va-landing-commercial-brand min-h-dvh bg-[#f8f9fc] text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
        <nav className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-black">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link to="/" className="inline-flex items-center transition hover:opacity-80" aria-label="Inicio Vene Autos">
              <img
                src="/logo_landing.png"
                alt="Vene Autos"
                className="h-9 w-auto max-w-[200px] select-none sm:h-10 sm:max-w-[220px]"
                draggable={false}
              />
            </Link>
            <div className="flex flex-wrap items-center gap-3 text-xs font-medium tracking-tight text-slate-600 dark:text-slate-300">
              <Link to={portalPath('/login')} className="transition hover:text-brand-700 dark:hover:text-brand-300">
                Acceso taller
              </Link>
              <Link to="/#inicio" className="transition hover:text-brand-700 dark:hover:text-brand-300">
                Sitio
              </Link>
            </div>
          </div>
        </nav>

        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="rounded-2xl border border-slate-200/85 bg-white px-5 py-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:px-7">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-500">Cliente</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-700 dark:text-brand-500 sm:text-4xl">
              Consultar estado de cuenta
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Ingresá la placa de uno de tus vehículos y el celular con el que lo registraste en el taller. Verás tus
              órdenes de trabajo y facturas (consulta de solo lectura). No necesitás cuenta.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200/85 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
              <div>
                <label htmlFor="cc-plate" className="va-label text-xs">
                  Placa del vehículo
                </label>
                <input
                  id="cc-plate"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Ej. ABC 123"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  className="va-field mt-2 w-full py-2.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="cc-phone" className="va-label text-xs">
                  Celular / WhatsApp
                </label>
                <input
                  id="cc-phone"
                  autoComplete="off"
                  inputMode="tel"
                  spellCheck={false}
                  placeholder="Ej. 300 555 0199"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="va-field mt-2 w-full py-2.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="va-btn-primary w-full rounded-lg py-3 text-sm font-semibold tracking-tight disabled:opacity-50 sm:w-auto sm:px-10"
              >
                {loading ? 'Buscando…' : 'Consultar mi cuenta'}
              </button>
            </form>

            {err ? (
              <p className="mt-6 va-alert-error" role="alert">
                {err}
              </p>
            ) : null}
          </div>

          {result ? (
            <div className="mt-8 space-y-6">
              <section className="rounded-2xl border border-slate-200/85 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-300">Cliente</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">
                      {result.cliente.displayName || '—'}
                    </p>
                  </div>
                  {result.cliente.documentId ? (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-300">Documento</p>
                      <p className="text-sm text-slate-700 dark:text-slate-200">{result.cliente.documentId}</p>
                    </div>
                  ) : null}
                  {result.cliente.maskedPhone ? (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-300">Celular verificado</p>
                      <p className="text-sm text-slate-700 dark:text-slate-200">{result.cliente.maskedPhone}</p>
                    </div>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-4 dark:border-zinc-800">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-300">Vehículos</dt>
                    <dd className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                      {result.resumen.vehiclesCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-300">Órdenes activas</dt>
                    <dd className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                      {result.resumen.openOrders}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-300">Facturas</dt>
                    <dd className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                      {result.resumen.invoicesCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-300">Saldo pendiente</dt>
                    <dd className="text-xl font-semibold tabular-nums text-brand-700 dark:text-brand-400">
                      {money(result.resumen.openBalance)}
                    </dd>
                  </div>
                </dl>
              </section>

              {result.vehicles.map((vehicle) => (
                <VehicleBlock
                  key={vehicle.plate}
                  vehicle={vehicle}
                  onDownload={(v, o) => void onDownload(v, o)}
                  downloadingKey={downloadingKey}
                />
              ))}

              <p className="text-xs text-slate-500 dark:text-slate-300">
                Consulta de solo lectura. Para abonos, facturación o dudas, contactá al taller.
              </p>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}