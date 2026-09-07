import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type {
  CreateFiscalResolutionPayload,
  FiscalResolution,
  FiscalResolutionKind,
} from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { useConfirm } from '../../components/confirm/ConfirmProvider'
import { portalPath } from '../../constants/portalPath'
import { PageHeader } from '../../components/layout/PageHeader'

const KIND_LABEL: Record<FiscalResolutionKind, string> = {
  ELECTRONIC_INVOICE: 'Factura electrónica',
  POS: 'POS / Documento equivalente',
  CONTINGENCY: 'Contingencia',
}

type DraftForm = {
  kind: FiscalResolutionKind
  resolutionNumber: string
  prefix: string
  rangeFrom: string
  rangeTo: string
  validFrom: string
  validUntil: string
  technicalKey: string
  testSetId: string
  notes: string
  isDefault: boolean
}

const EMPTY_FORM: DraftForm = {
  kind: 'ELECTRONIC_INVOICE',
  resolutionNumber: '',
  prefix: '',
  rangeFrom: '',
  rangeTo: '',
  validFrom: '',
  validUntil: '',
  technicalKey: '',
  testSetId: '',
  notes: '',
  isDefault: true,
}

export function FiscalResolutionsPage() {
  const { can } = useAuth()
  const confirmDlg = useConfirm()
  const canManage = can('fiscal_resolutions:manage')

  const [items, setItems] = useState<FiscalResolution[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<FiscalResolution[]>('/fiscal-resolutions')
      setItems(res)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se pudieron cargar las resoluciones fiscales.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !canManage) return
    setBusy(true)
    setMsg(null)
    try {
      const rangeFrom = Number(form.rangeFrom)
      const rangeTo = Number(form.rangeTo)
      if (!Number.isInteger(rangeFrom) || !Number.isInteger(rangeTo) || rangeFrom < 1 || rangeTo < rangeFrom) {
        throw new Error('El rango debe ser de enteros positivos y rangeTo ≥ rangeFrom.')
      }
      const payload: CreateFiscalResolutionPayload = {
        kind: form.kind,
        resolutionNumber: form.resolutionNumber.trim(),
        prefix: form.prefix.trim().toUpperCase(),
        rangeFrom,
        rangeTo,
        isDefault: form.isDefault,
      }
      if (form.validFrom) payload.validFrom = form.validFrom
      if (form.validUntil) payload.validUntil = form.validUntil
      if (form.technicalKey.trim()) payload.technicalKey = form.technicalKey.trim()
      if (form.testSetId.trim()) payload.testSetId = form.testSetId.trim()
      if (form.notes.trim()) payload.notes = form.notes.trim()

      await api<FiscalResolution>('/fiscal-resolutions', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setMsg('Resolución creada correctamente.')
      await load()
    } catch (e) {
      setMsg(e instanceof ApiError || e instanceof Error ? e.message : 'Error al crear la resolución.')
    } finally {
      setBusy(false)
    }
  }

  async function onDeactivate(id: string) {
    if (!canManage) return
    const ok = await confirmDlg({
      title: 'Desactivar resolución',
      message: '¿Desactivar esta resolución? Ya no se podrán emitir documentos con ella.',
      variant: 'danger',
      confirmLabel: 'Desactivar',
    })
    if (!ok) return
    try {
      await api(`/fiscal-resolutions/${id}/deactivate`, { method: 'POST' })
      await load()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se pudo desactivar la resolución.')
    }
  }

  async function onToggleDefault(resolution: FiscalResolution) {
    if (!canManage || resolution.isDefault) return
    try {
      await api(`/fiscal-resolutions/${resolution.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      })
      await load()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se pudo marcar como predeterminada.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Configuración"
        title="Resoluciones fiscales"
        description="Prefijos y rangos de numeración autorizados por la DIAN. El sistema usa la resolución predeterminada de cada tipo al crear facturas."
        actions={
          <Link
            to={portalPath('/facturacion')}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            ← Volver a facturación
          </Link>
        }
      />

      {msg && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
          {msg}
        </p>
      )}

      {canManage && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Nueva resolución</h2>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              {showForm ? 'Cancelar' : 'Añadir resolución'}
            </button>
          </div>
          {showForm && (
            <form onSubmit={onCreate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Tipo</span>
                <select
                  value={form.kind}
                  onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as FiscalResolutionKind }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="ELECTRONIC_INVOICE">Factura electrónica</option>
                  <option value="POS">POS / Documento equivalente</option>
                  <option value="CONTINGENCY">Contingencia</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Número de resolución (DIAN)</span>
                <input
                  value={form.resolutionNumber}
                  onChange={(e) => setForm((f) => ({ ...f, resolutionNumber: e.target.value }))}
                  required
                  placeholder="18760000001"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Prefijo</span>
                <input
                  value={form.prefix}
                  onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value.toUpperCase() }))}
                  required
                  placeholder="FEV"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Consecutivo inicial (rangeFrom)</span>
                <input
                  value={form.rangeFrom}
                  onChange={(e) => setForm((f) => ({ ...f, rangeFrom: e.target.value }))}
                  required
                  inputMode="numeric"
                  placeholder="1"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-mono dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Consecutivo final (rangeTo)</span>
                <input
                  value={form.rangeTo}
                  onChange={(e) => setForm((f) => ({ ...f, rangeTo: e.target.value }))}
                  required
                  inputMode="numeric"
                  placeholder="5000"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-mono dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Válida desde</span>
                <input
                  type="date"
                  value={form.validFrom}
                  onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Válida hasta</span>
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Clave técnica (opcional)</span>
                <input
                  value={form.technicalKey}
                  onChange={(e) => setForm((f) => ({ ...f, technicalKey: e.target.value }))}
                  placeholder="fc8...e2"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-mono dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">TestSetId (habilitación DIAN)</span>
                <input
                  value={form.testSetId}
                  onChange={(e) => setForm((f) => ({ ...f, testSetId: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-mono dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">Notas</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>Marcar como resolución predeterminada para este tipo.</span>
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {busy ? 'Guardando…' : 'Crear resolución'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Prefijo</th>
              <th className="px-4 py-3">N° resolución</th>
              <th className="px-4 py-3">Rango</th>
              <th className="px-4 py-3">Próximo consecutivo</th>
              <th className="px-4 py-3">Vigencia</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {!items ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  No hay resoluciones registradas. Crea una para habilitar la numeración fiscal.
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{KIND_LABEL[r.kind]}</td>
                  <td className="px-4 py-3 font-mono">{r.prefix}</td>
                  <td className="px-4 py-3 font-mono">{r.resolutionNumber}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-xs">
                    {r.rangeFrom}–{r.rangeTo}
                    <div className="text-[11px] text-slate-500">
                      consumidos {r.consumedCount} / restan {r.remainingCount}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">{r.nextNumber}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {r.validFrom ? r.validFrom : '—'}
                    {' → '}
                    {r.validUntil ? r.validUntil : 'sin límite'}
                  </td>
                  <td className="px-4 py-3">
                    {!r.isActive ? (
                      <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        Inactiva
                      </span>
                    ) : r.exhausted ? (
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        Agotada
                      </span>
                    ) : r.isDefault ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        Predeterminada
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                        Activa
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && r.isActive && (
                      <div className="flex justify-end gap-2">
                        {!r.isDefault && (
                          <button
                            onClick={() => onToggleDefault(r)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                          >
                            Marcar predeterminada
                          </button>
                        )}
                        <button
                          onClick={() => onDeactivate(r.id)}
                          className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950"
                        >
                          Desactivar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
