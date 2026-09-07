import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { TaxRate, TaxRateKind } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader } from '../../components/layout/PageHeader'

type CreateDraft = {
  slug: string
  name: string
  kind: TaxRateKind
  ratePercent: string
  isDefault: boolean
  sortOrder: string
}

const KIND_LABELS: Record<TaxRateKind, string> = {
  VAT: 'IVA',
  INC: 'Impuesto al consumo (INC)',
}

const emptyDraft: CreateDraft = {
  slug: '',
  name: '',
  kind: 'VAT',
  ratePercent: '',
  isDefault: false,
  sortOrder: '100',
}

export function TaxRatesPage({ embed = false }: { embed?: boolean }) {
  const { can } = useAuth()
  const mayCreate = can('tax_rates:create')
  const mayUpdate = can('tax_rates:update')

  const [rows, setRows] = useState<TaxRate[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ name: string; ratePercent: string; sortOrder: string }>({
    name: '',
    ratePercent: '',
    sortOrder: '0',
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyDraft)
  const [createBusy, setCreateBusy] = useState(false)

  const load = async () => {
    try {
      const data = await api<TaxRate[]>('/tax-rates')
      setRows(data)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al cargar impuestos')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const visibleRows = useMemo(() => {
    if (!rows) return null
    return showInactive ? rows : rows.filter((r) => r.isActive)
  }, [rows, showInactive])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mayCreate) return
    setMsg(null)
    const slug = createDraft.slug.trim().toLowerCase()
    const rate = createDraft.ratePercent.trim()
    if (!/^[a-z0-9_]{2,40}$/.test(slug)) {
      setMsg('Identificador: minúsculas, dígitos y guion bajo. Ej. iva_19.')
      return
    }
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate)) {
      setMsg('Porcentaje 0–100 con hasta 2 decimales.')
      return
    }
    setCreateBusy(true)
    try {
      await api('/tax-rates', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          name: createDraft.name.trim(),
          kind: createDraft.kind,
          ratePercent: rate,
          isDefault: createDraft.isDefault,
          sortOrder: Number(createDraft.sortOrder) || 0,
        }),
      })
      setCreateDraft(emptyDraft)
      setCreateOpen(false)
      setMsg('Tarifa creada')
      await load()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al crear')
    } finally {
      setCreateBusy(false)
    }
  }

  const startEdit = (row: TaxRate) => {
    setEditingId(row.id)
    setEditDraft({
      name: row.name,
      ratePercent: row.ratePercent,
      sortOrder: String(row.sortOrder),
    })
  }

  const saveEdit = async (row: TaxRate) => {
    if (!mayUpdate) return
    setBusyId(row.id)
    try {
      await api(`/tax-rates/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editDraft.name.trim(),
          ratePercent: editDraft.ratePercent.trim(),
          sortOrder: Number(editDraft.sortOrder) || 0,
        }),
      })
      setEditingId(null)
      await load()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al guardar')
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (row: TaxRate, isActive: boolean) => {
    if (!mayUpdate) return
    setBusyId(row.id)
    try {
      await api(`/tax-rates/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      })
      await load()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al actualizar')
    } finally {
      setBusyId(null)
    }
  }

  const makeDefault = async (row: TaxRate) => {
    if (!mayUpdate) return
    setBusyId(row.id)
    try {
      await api(`/tax-rates/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      })
      await load()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al marcar por defecto')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      {embed ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Impuestos</h2>
          {mayCreate ? (
            <button type="button" className="va-btn-primary" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? 'Cerrar formulario' : 'Nueva tarifa'}
            </button>
          ) : null}
        </div>
      ) : (
        <PageHeader
          eyebrow="Administración"
          title="Impuestos"
          description="Catálogo de tarifas de impuestos (IVA / INC) que se aplican a servicios, repuestos y ventas. Las tarifas históricas no se borran: se desactivan para preservar auditoría fiscal."
          actions={
            mayCreate ? (
              <button type="button" className="va-btn-primary" onClick={() => setCreateOpen((v) => !v)}>
                {createOpen ? 'Cerrar formulario' : 'Nueva tarifa'}
              </button>
            ) : null
          }
        />
      )}

      {msg && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {msg}
        </p>
      )}

      {createOpen && mayCreate && (
        <form
          onSubmit={onCreate}
          className="va-card space-y-3 border-slate-200 p-4 dark:border-slate-700"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="va-label">Identificador (slug)</span>
              <input
                required
                className="va-field mt-1 font-mono"
                value={createDraft.slug}
                placeholder="iva_19"
                onChange={(e) => setCreateDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="va-label">Nombre visible</span>
              <input
                required
                className="va-field mt-1"
                value={createDraft.name}
                placeholder="IVA 19%"
                onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="va-label">Tipo</span>
              <select
                className="va-field mt-1"
                value={createDraft.kind}
                onChange={(e) => setCreateDraft((d) => ({ ...d, kind: e.target.value as TaxRateKind }))}
              >
                <option value="VAT">IVA</option>
                <option value="INC">Impuesto al consumo (INC)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="va-label">Porcentaje (%)</span>
              <input
                required
                className="va-field mt-1 font-mono tabular-nums"
                value={createDraft.ratePercent}
                placeholder="19"
                inputMode="decimal"
                onChange={(e) => setCreateDraft((d) => ({ ...d, ratePercent: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="va-label">Orden</span>
              <input
                className="va-field mt-1 w-32 font-mono tabular-nums"
                value={createDraft.sortOrder}
                inputMode="numeric"
                onChange={(e) => setCreateDraft((d) => ({ ...d, sortOrder: e.target.value }))}
              />
            </label>
            <label className="inline-flex items-center gap-2 self-end pb-1 text-sm">
              <input
                type="checkbox"
                checked={createDraft.isDefault}
                onChange={(e) => setCreateDraft((d) => ({ ...d, isDefault: e.target.checked }))}
              />
              Marcar como tarifa por defecto
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createBusy} className="va-btn-primary">
              {createBusy ? 'Creando…' : 'Crear tarifa'}
            </button>
            <button
              type="button"
              className="va-btn-secondary"
              onClick={() => {
                setCreateOpen(false)
                setCreateDraft(emptyDraft)
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Mostrar tarifas inactivas
      </label>

      {!visibleRows && <p className="text-slate-500 dark:text-slate-300">Cargando…</p>}
      {visibleRows && visibleRows.length === 0 && (
        <p className="text-slate-500 dark:text-slate-300">Sin tarifas para mostrar.</p>
      )}
      {visibleRows && visibleRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Identificador</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">%</th>
                <th className="px-3 py-2">Por defecto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleRows.map((row) => {
                const editing = editingId === row.id
                const busy = busyId === row.id
                return (
                  <tr key={row.id} className="align-middle">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{row.slug}</td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <input
                          className="va-field"
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                        />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{KIND_LABELS[row.kind]}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {editing ? (
                        <input
                          className="va-field w-24 text-right font-mono tabular-nums"
                          value={editDraft.ratePercent}
                          onChange={(e) => setEditDraft((d) => ({ ...d, ratePercent: e.target.value }))}
                        />
                      ) : (
                        `${Number(row.ratePercent).toFixed(2)} %`
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.isDefault ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                          Sí
                        </span>
                      ) : mayUpdate && row.isActive ? (
                        <button
                          type="button"
                          onClick={() => void makeDefault(row)}
                          disabled={busy}
                          className="text-xs text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-300"
                        >
                          Marcar
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.isActive
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }
                      >
                        {row.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-sm">
                      {mayUpdate && editing ? (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            className="va-btn-primary px-3 py-1"
                            disabled={busy}
                            onClick={() => void saveEdit(row)}
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="va-btn-secondary px-3 py-1"
                            onClick={() => setEditingId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : mayUpdate ? (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                            onClick={() => startEdit(row)}
                            disabled={busy}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-600 hover:underline dark:text-slate-300"
                            onClick={() => void toggleActive(row, !row.isActive)}
                            disabled={busy}
                          >
                            {row.isActive ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
