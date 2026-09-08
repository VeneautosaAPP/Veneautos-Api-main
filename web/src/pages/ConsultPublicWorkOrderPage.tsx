import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { portalPath } from '../constants/portalPath'
import type { PublicWorkOrderLookupResponse, WorkOrderStatus } from '../api/types'

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

const STATUS: Record<
  WorkOrderStatus,
  { label: string; tone: string }
> = {
  UNASSIGNED: {
    label: 'Sin asignar',
    tone: 'bg-slate-200 text-slate-900 dark:bg-slate-600 dark:text-white',
  },
  RECEIVED: { label: 'Recibida', tone: 'bg-slate-300 text-slate-900 dark:bg-slate-500 dark:text-white' },
  IN_WORKSHOP: { label: 'En taller', tone: 'bg-brand-700 text-white' },
  WAITING_PARTS: {
    label: 'Esperando repuestos',
    tone: 'bg-amber-500 text-amber-950',
  },
  READY: { label: 'Lista para retiro', tone: 'bg-emerald-700 text-white' },
  DELIVERED: { label: 'Entregada', tone: 'bg-slate-600 text-white' },
  CANCELLED: { label: 'Cancelada', tone: 'bg-red-700 text-white' },
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function ConsultPublicWorkOrderPage() {
  const prefersDark = usePrefersColorSchemeDark()
  const [publicCode, setPublicCode] = useState('')
  const [plate, setPlate] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<PublicWorkOrderLookupResponse | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setResult(null)
    setLoading(true)
    try {
      const data = await api<PublicWorkOrderLookupResponse>('/work-orders/public/lookup', {
        method: 'POST',
        body: JSON.stringify({
          publicCode: publicCode.trim(),
          plate: plate.trim(),
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

  const st = result ? STATUS[result.status] : null

  return (
    <div className={prefersDark ? 'dark' : ''} style={{ colorScheme: prefersDark ? 'dark' : 'light' }}>
      <div className="va-landing-commercial-brand min-h-dvh bg-[#f8f9fc] text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
      <nav className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-black">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center transition hover:opacity-80"
            aria-label="Inicio Vene Autos"
          >
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
          Consultar orden de trabajo
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Ingresá el código que figura en tu comprobante (por ejemplo{' '}
          <span className="font-medium text-slate-900 dark:text-slate-50">VEN-0001</span>) y la placa del vehículo tal
          como la diste de alta en el taller. No necesitás cuenta.
        </p>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200/85 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
            <div>
              <label htmlFor="wo-public-code" className="va-label text-xs">
                Código de la orden
              </label>
              <input
                id="wo-public-code"
                autoComplete="off"
                spellCheck={false}
                placeholder="VEN-0001"
                value={publicCode}
                onChange={(e) => setPublicCode(e.target.value)}
                className="va-field mt-2 w-full py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="wo-plate" className="va-label text-xs">
                Placa del vehículo
              </label>
              <input
                id="wo-plate"
                autoComplete="off"
                spellCheck={false}
                placeholder="Ej. ABC 123"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                className="va-field mt-2 w-full py-2.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="va-btn-primary w-full rounded-lg py-3 text-sm font-semibold tracking-tight disabled:opacity-50 sm:w-auto sm:px-10"
            >
              {loading ? 'Consultando…' : 'Validar orden'}
            </button>
          </form>

          {err ? (
            <p className="mt-6 va-alert-error" role="alert">
              {err}
            </p>
          ) : null}

          {result && st ? (
            <div className="mt-8 border-t border-slate-200 pt-8 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-md px-2.5 py-1 text-xs font-semibold tracking-tight ${st.tone}`}>
                  {st.label}
                </span>
                <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{result.publicCode}</span>
              </div>
              <dl className="mt-6 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-300">Vehículo</dt>
                  <dd className="text-slate-900 dark:text-slate-50">
                    {[result.vehiclePlate, result.vehicleBrand, result.vehicleModel].filter(Boolean).join(' · ') ||
                      '—'}
                  </dd>
                </div>
                {result.customerName ? (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                    <dt className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-300">Cliente</dt>
                    <dd className="text-slate-900 dark:text-slate-50">{result.customerName}</dd>
                  </div>
                ) : null}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-300">Ingreso</dt>
                  <dd>{formatWhen(result.createdAt)}</dd>
                </div>
                {result.deliveredAt || result.cancelledAt ? (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                    <dt className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-300">Cierre</dt>
                    <dd>{formatWhen(result.deliveredAt ?? result.cancelledAt ?? '')}</dd>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                  <dt className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-300">Trabajo</dt>
                  <dd className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{result.description}</dd>
                </div>
              </dl>
              <p className="mt-6 text-xs text-slate-500 dark:text-slate-300">
                Los importes y el detalle de repuestos no se muestran en esta consulta pública. Para facturación o
                dudas, contactá al taller.
              </p>
            </div>
          ) : null}
        </div>
      </main>
      </div>
    </div>
  )
}
