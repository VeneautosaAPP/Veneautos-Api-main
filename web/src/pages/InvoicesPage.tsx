import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { InvoiceListResponse, InvoiceStatus } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { portalPath } from '../constants/portalPath'
import { PageHeader } from '../components/layout/PageHeader'
import { formatCopFromString } from '../utils/copFormat'

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitida DIAN',
  VOIDED: 'Anulada',
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const tone =
    status === 'ISSUED'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : status === 'VOIDED'
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
        : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function InvoicesPage() {
  const { can } = useAuth()
  const canManageResolutions = can('fiscal_resolutions:manage')

  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as InvoiceStatus | null) ?? ''
  const search = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? '1'))
  const pageSize = 20

  const [data, setData] = useState<InvoiceListResponse | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchDraft, setSearchDraft] = useState(search)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setMsg(null)
      const qs = new URLSearchParams()
      qs.set('page', String(page))
      qs.set('pageSize', String(pageSize))
      if (status) qs.set('status', status)
      if (search) qs.set('search', search)
      const res = await api<InvoiceListResponse>(`/invoices?${qs.toString()}`)
      setData(res)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se pudieron cargar las facturas.')
    } finally {
      setLoading(false)
    }
  }, [status, search, page])

  useEffect(() => {
    void load()
  }, [load])

  function setStatus(next: string) {
    const np = new URLSearchParams(params)
    if (next) np.set('status', next)
    else np.delete('status')
    np.set('page', '1')
    setParams(np, { replace: true })
  }

  function applySearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const np = new URLSearchParams(params)
    if (searchDraft.trim()) np.set('q', searchDraft.trim())
    else np.delete('q')
    np.set('page', '1')
    setParams(np, { replace: true })
  }

  function gotoPage(next: number) {
    const np = new URLSearchParams(params)
    np.set('page', String(next))
    setParams(np, { replace: true })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturación electrónica"
        description="Facturas y documentos equivalentes DIAN. Si el proveedor DIAN está apagado, las facturas quedan en borrador local."
        actions={
          canManageResolutions ? (
            <div className="flex gap-2">
              <Link
                to={portalPath('/admin/resoluciones-fiscales')}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Resoluciones
              </Link>
              <Link
                to={`${portalPath('/admin/configuracion')}#cfg-dian`}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Configurar DIAN
              </Link>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600 dark:text-slate-300">Estado:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="">Todos</option>
            <option value="DRAFT">Borrador</option>
            <option value="ISSUED">Emitida DIAN</option>
            <option value="VOIDED">Anulada</option>
          </select>
        </div>
        <form onSubmit={applySearch} className="flex items-center gap-2">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Documento, cliente o NIT…"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-800 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >
            Buscar
          </button>
        </form>
      </div>

      {msg && (
        <div className="rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {msg}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Origen</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Creada</th>
              <th className="px-4 py-3">Emitida</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : data && data.items.length > 0 ? (
              data.items.map((inv) => (
                <tr key={inv.id} className="text-sm">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={portalPath(`/facturacion/${inv.id}`)}
                      className="text-sky-700 hover:underline dark:text-sky-300"
                    >
                      {inv.documentNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{inv.customerName}</div>
                    {inv.customerDocumentId && (
                      <div className="text-xs text-slate-500">{inv.customerDocumentId}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {inv.saleId ? (
                      <Link to={portalPath(`/ventas/${inv.saleId}`)} className="text-sky-600 hover:underline">
                        Venta
                      </Link>
                    ) : inv.workOrderId ? (
                      <Link
                        to={portalPath(`/ordenes/${inv.workOrderId}`)}
                        className="text-sky-600 hover:underline"
                      >
                        OT
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCopFromString(inv.grandTotal)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {new Date(inv.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {inv.issuedAt ? new Date(inv.issuedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                  Sin facturas por ahora.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-slate-500">
            {data.total} facturas · página {data.page} de {Math.ceil(data.total / data.pageSize)}
          </div>
          <div className="flex gap-2">
            <button
              disabled={data.page <= 1}
              onClick={() => gotoPage(data.page - 1)}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50 dark:border-slate-600"
            >
              Anterior
            </button>
            <button
              disabled={data.page * data.pageSize >= data.total}
              onClick={() => gotoPage(data.page + 1)}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50 dark:border-slate-600"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
