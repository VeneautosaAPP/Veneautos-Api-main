import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, downloadFile } from '../api/client'
import type { SparePart } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../components/layout/PageHeader'
import { useConfirm } from '../components/confirm/ConfirmProvider'
import { queryKeys } from '../lib/queryKeys'
import {
  formatCopFromString,
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../utils/copFormat'

const PAGE_LIMIT = 200

type ImportSummary = { created: number; updated: number; skipped: number; invalid: number }

type Draft = { sku: string; name: string; precio: string }

const emptyDraft: Draft = { sku: '', name: '', precio: '' }

/** Normalización live del SKU (coincide con el backend: mayúsculas alfanumérico). */
function normalizeSkuInput(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function RepuestosPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const mayCreate = can('repuestos:create')
  const mayUpdate = can('repuestos:update')
  const mayDelete = can('repuestos:delete')
  const confirm = useConfirm()

  const [rows, setRows] = useState<SparePart[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 220)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    const term = debouncedQ.slice(0, 100)
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (term) params.set('q', term)
    api<{ items: SparePart[]; total: number }>(`/spare-parts?${params.toString()}`)
      .then((r) => {
        if (cancelled) return
        setRows(r.items)
        setTotal(r.total)
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e instanceof ApiError ? e.message : 'Error al cargar repuestos')
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ])

  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const validateSku = (sku: string): string | null => {
    if (!sku) return 'El SKU no puede quedar vacío.'
    if (sku.length > 80) return 'El SKU supera los 80 caracteres.'
    return null
  }

  const validateNombre = (name: string): string | null => {
    if (!name.trim()) return 'La descripción no puede quedar vacía.'
    if (name.trim().length > 500) return 'La descripción supera los 500 caracteres.'
    return null
  }

  const validatePrecio = (precio: string): string | null => {
    if (!precio.trim()) return null
    const norm = normalizeMoneyDecimalStringForApi(precio)
    if (!/^\d+$/.test(norm)) return 'Precio: solo pesos enteros; miles con punto (ej. 25.000).'
    return null
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!mayCreate) return
    setMsg(null)
    const sku = normalizeSkuInput(createDraft.sku)
    const skuIssue = validateSku(sku)
    const nombreIssue = validateNombre(createDraft.name)
    const precioIssue = validatePrecio(createDraft.precio)
    if (skuIssue || nombreIssue || precioIssue) {
      setMsg([skuIssue, nombreIssue, precioIssue].filter(Boolean).join(' '))
      return
    }
    setCreateBusy(true)
    try {
      await api('/spare-parts', {
        method: 'POST',
        body: JSON.stringify({
          sku,
          name: createDraft.name.trim(),
          precio: createDraft.precio.trim() ? normalizeMoneyDecimalStringForApi(createDraft.precio) : '0',
        }),
      })
      setCreateOpen(false)
      setCreateDraft(emptyDraft)
      setMsg(`Repuesto ${sku} creado`)
      await reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error al crear el repuesto')
    } finally {
      setCreateBusy(false)
    }
  }

  function startEdit(row: SparePart) {
    setEditingId(row.id)
    setEditDraft({
      sku: row.sku,
      name: row.name,
      precio: String(row.price),
    })
  }

  async function saveEdit(row: SparePart) {
    if (!mayUpdate) return
    setMsg(null)
    const sku = normalizeSkuInput(editDraft.sku)
    const skuIssue = validateSku(sku)
    const nombreIssue = validateNombre(editDraft.name)
    const precioIssue = validatePrecio(editDraft.precio)
    if (skuIssue || nombreIssue || precioIssue) {
      setMsg([skuIssue, nombreIssue, precioIssue].filter(Boolean).join(' '))
      return
    }
    setBusyId(row.id)
    try {
      await api(`/spare-parts/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sku,
          name: editDraft.name.trim(),
          precio: editDraft.precio.trim() ? normalizeMoneyDecimalStringForApi(editDraft.precio) : '0',
        }),
      })
      setEditingId(null)
      await reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error al guardar')
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(row: SparePart) {
    if (!mayDelete) return
    const ok = await confirm({
      title: 'Eliminar repuesto',
      message: [
        `¿Eliminar del catálogo?`,
        '',
        `SKU: ${row.sku}`,
        `Nombre: ${row.name}`,
        '',
        'Las líneas de órdenes de trabajo ya emitidas conservan sus datos (snapshot); no se modifica el historial ni los comprobantes.',
      ].join('\n'),
      confirmLabel: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    setBusyId(row.id)
    try {
      await api(`/spare-parts/${row.id}`, { method: 'DELETE' })
      setMsg(`Repuesto ${row.sku} eliminado`)
      await reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error al eliminar')
    } finally {
      setBusyId(null)
    }
  }

  async function reload() {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim().slice(0, 100))
    try {
      const r = await api<{ items: SparePart[]; total: number }>(`/spare-parts?${params.toString()}`)
      setRows(r.items)
      setTotal(r.total)
      /**
       * Esta pantalla mantiene su propio estado, pero la OT usa una copia del catálogo en memoria
       * (caché de 3 h). Al crear/editar/borrar/importar hay que avisarle, si no el buscador de la
       * OT seguiría mostrando el catálogo viejo.
       */
      void queryClient.invalidateQueries({ queryKey: queryKeys.spareParts.root })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Error al cargar repuestos')
    }
  }

  async function onExport() {
    try {
      setMsg(null)
      await downloadFile('/spare-parts/export', 'repuestos.xlsx')
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error al exportar')
    }
  }

  async function onImportFile(file: File) {
    if (!mayCreate) return
    setImporting(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api<ImportSummary>('/spare-parts/import', { method: 'POST', body: fd })
      setMsg(
        `Importación: ${r.created} creados, ${r.updated} actualizados, ${r.skipped} sin cambios, ${r.invalid} inválidos.`,
      )
      await reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error al importar')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (!can('repuestos:read')) {
    return (
      <div className="va-alert-error-block">
        No tenés acceso al catálogo de repuestos. Consultá a un administrador o dueño del taller.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administración"
        title="Repuestos"
        description="Catálogo de repuestos del taller. Stock ilimitado: no se valida stock ni se descuenta. El precio 0 significa «variable» y se carga en cada orden. Los repuestos se facturan sin impuesto (precio final)."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="va-btn-secondary"
              disabled={importing || rows === null}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? 'Importando…' : 'Importar XLSX'}
            </button>
            <button type="button" className="va-btn-secondary" disabled={rows === null} onClick={() => void onExport()}>
              Exportar XLSX
            </button>
            {mayCreate ? (
              <button type="button" className="va-btn-primary" onClick={() => setCreateOpen((v) => !v)}>
                {createOpen ? 'Cerrar formulario' : 'Nuevo repuesto'}
              </button>
            ) : null}
          </div>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImportFile(f)
        }}
      />

      {(msg || err) && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {err ?? msg}
        </p>
      )}

      {createOpen && mayCreate && (
        <form onSubmit={onCreate} className="va-card space-y-3 border-slate-200 p-4 dark:border-slate-700">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="va-label">SKU (código)</span>
              <input
                required
                autoComplete="off"
                className="va-field mt-1 font-mono uppercase"
                value={createDraft.sku}
                placeholder="ACEITE-15W40"
                onChange={(e) => setCreateDraft((d) => ({ ...d, sku: normalizeSkuInput(e.target.value) }))}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="va-label">Descripción</span>
              <input
                required
                className="va-field mt-1"
                value={createDraft.name}
                placeholder="ej. Aceite motor 15W-40 cuñete"
                onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="va-label">Precio al cliente (0 = variable)</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                className="va-field mt-1"
                placeholder="ej. 180.000"
                value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(createDraft.precio))}
                onChange={(e) => setCreateDraft((d) => ({ ...d, precio: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createBusy} className="va-btn-primary">
              {createBusy ? 'Creando…' : 'Crear repuesto'}
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

      <label className="block max-w-md text-sm">
        <span className="va-label">Buscar por SKU o descripción</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="va-field mt-1"
          placeholder="ej. ACEITE o filtro"
          autoComplete="off"
        />
      </label>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {total !== null
          ? q.trim()
            ? `${total} repuestos que coinciden con «${q.trim().slice(0, 100)}».`
            : `${total} repuestos en el catálogo.`
          : 'Cargando…'}
      </p>

      {rows === null && q !== debouncedQ ? <p className="text-slate-500 dark:text-slate-300">Cargando…</p> : null}
      {rows && rows.length === 0 && (
        <p className="text-slate-500 dark:text-slate-300">
          {q.trim() ? 'Sin coincidencias en el catálogo.' : 'El catálogo está vacío. Importá un XLSX o creá el primer repuesto.'}
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 text-right">Precio</th>
                {(mayUpdate || mayDelete) && <th className="px-3 py-2 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => {
                const editing = editingId === row.id
                const busy = busyId === row.id
                return (
                  <tr key={row.id} className="align-middle">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {editing ? (
                        <input
                          autoComplete="off"
                          className="va-field w-40 font-mono uppercase"
                          value={editDraft.sku}
                          onChange={(e) => setEditDraft((d) => ({ ...d, sku: normalizeSkuInput(e.target.value) }))}
                        />
                      ) : (
                        row.sku
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
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
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-50">
                      {editing ? (
                        <input
                          inputMode="decimal"
                          autoComplete="off"
                          className="va-field w-32 text-right font-mono tabular-nums"
                          value={formatMoneyInputDisplayFromNormalized(
                            normalizeMoneyDecimalStringForApi(editDraft.precio),
                          )}
                          onChange={(e) => setEditDraft((d) => ({ ...d, precio: e.target.value }))}
                        />
                      ) : Number(row.price) > 0 ? (
                        `$${formatCopFromString(String(row.price))}`
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                          Variable
                        </span>
                      )}
                    </td>
                    {(mayUpdate || mayDelete) && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          {mayUpdate ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => (editing ? void saveEdit(row) : startEdit(row))}
                              className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-300"
                            >
                              {editing ? (busy ? 'Guardando…' : 'Guardar') : 'Editar'}
                            </button>
                          ) : null}
                          {editing && (
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                            >
                              Cancelar
                            </button>
                          )}
                          {mayDelete ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onDelete(row)}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                            >
                              Eliminar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total !== null && total > PAGE_LIMIT && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Mostrando los primeros {PAGE_LIMIT}. Usá la búsqueda para acotar el catálogo.
        </p>
      )}
    </div>
  )
}