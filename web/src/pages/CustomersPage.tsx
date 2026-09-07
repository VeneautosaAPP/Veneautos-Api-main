import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { WorkOrderDetail, WorkOrderListResponse, WorkOrderStatus } from '../api/types'
import { portalPath } from '../constants/portalPath'
import { useAuth } from '../auth/AuthContext'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'
import { formatCopFromString } from '../utils/copFormat'

type Customer = {
  id: string
  displayName: string
  primaryPhone: string | null
  email: string | null
  documentId: string | null
  notes: string | null
  isActive: boolean
  _count?: { vehicles: number }
}

type CustomerDetail = Customer & {
  vehicles: {
    id: string
    plate: string
    brand: string | null
    model: string | null
    year: number | null
    isActive: boolean
  }[]
}

type CustomerSummary = {
  totalOrders: number
  /** Sumas en pesos (string API); `null` si el perfil no puede ver importes. */
  worked: string | null
  paid: string | null
  due: string | null
}

type CustomerFile = {
  customer: CustomerDetail
  workOrders: WorkOrderDetail[]
  summary: CustomerSummary
}

type CustomerPatch = {
  displayName: string
  primaryPhone: string | null
  email: string | null
  documentId: string | null
  notes: string | null
  isActive: boolean
}

const WO_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  UNASSIGNED: 'Sin asignar',
  RECEIVED: 'Recibida',
  IN_WORKSHOP: 'En taller',
  WAITING_PARTS: 'Esperando repuestos',
  READY: 'Lista',
  DELIVERED: 'Entregada',
  CANCELLED: 'Cancelada',
}

/** Máximo de órdenes de las que se trae el detalle (totales) al desplegar un cliente. */
const WORK_ORDER_DETAIL_LIMIT = 15

function moneyOrDash(v: string | null | undefined): string {
  return v == null || v === '' ? '—' : formatCopFromString(v)
}

function sumMoney(values: (string | null | undefined)[]): string | null {
  let total = 0
  let seen = 0
  for (const v of values) {
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) {
      total += n
      seen++
    }
  }
  return seen === 0 ? null : String(Math.round(total))
}

function vehicleLabel(wo: Pick<WorkOrderDetail, 'vehicle' | 'vehiclePlate' | 'vehicleBrand'>): string {
  const plate = wo.vehicle?.plate ?? wo.vehiclePlate
  const brand = wo.vehicleBrand ?? wo.vehicle?.brand
  return [plate, brand].filter(Boolean).join(' · ') || '—'
}

function CustomerEditForm({
  customer,
  onSave,
  onCancel,
}: {
  customer: CustomerDetail
  onSave: (data: CustomerPatch) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(customer.displayName)
  const [phone, setPhone] = useState(customer.primaryPhone ?? '')
  const [email, setEmail] = useState(customer.email ?? '')
  const [doc, setDoc] = useState(customer.documentId ?? '')
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [active, setActive] = useState(customer.isActive)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const ok = await onSave({
        displayName: name.trim(),
        primaryPhone: phone.trim() || null,
        email: email.trim() || null,
        documentId: doc.trim() || null,
        notes: notes.trim() || null,
        isActive: active,
      })
      if (ok) onCancel()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="va-label">Nombre</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="va-field mt-1" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Teléfono</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="va-field mt-1" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="va-field mt-1" />
        </label>
        <label className="block text-sm">
          <span className="va-label">Documento</span>
          <input value={doc} onChange={(e) => setDoc(e.target.value)} className="va-field mt-1" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Cliente activo
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="va-label">Notas</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="va-field mt-1" />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="submit" className="va-btn-primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="va-btn-secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function NewOrderConfirmModal({
  vehicles,
  onConfirm,
  onCancel,
}: {
  vehicles: CustomerDetail['vehicles']
  onConfirm: (vehicleId: string) => void
  onCancel: () => void
}) {
  const [vehicleId, setVehicleId] = useState(() => vehicles[0]?.id ?? '')
  const selected = vehicles.find((v) => v.id === vehicleId)
  const multiple = vehicles.length > 1

  return (
    <div className="va-modal-overlay" role="presentation">
      <div
        className="va-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-order-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="quick-order-confirm-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Nueva orden de trabajo
        </h2>
        {multiple && (
          <label className="mt-3 block text-sm">
            <span className="va-label">Vehículo</span>
            <select className="va-field mt-1 w-full" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate}
                  {v.brand ? ` · ${v.brand}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          ¿Crear la orden para <span className="font-mono font-medium">{selected?.plate ?? '—'}</span>
          {selected?.brand ? ` · ${selected.brand}` : ''}?
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="va-btn-primary"
            disabled={!selected}
            onClick={() => {
              if (selected) onConfirm(selected.id)
            }}
          >
            Crear orden
          </button>
          <button type="button" className="va-btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function CustomerFilePanel({
  file,
  loading,
  onClose,
  onNewOrder,
  onSaveCustomer,
  onAddVehicle,
}: {
  file: CustomerFile | null
  loading: boolean
  onClose: () => void
  onNewOrder: (vehicleId: string, plate: string, brand: string | null) => void
  onSaveCustomer: (id: string, data: CustomerPatch) => Promise<boolean>
  onAddVehicle: (id: string, plate: string, brand: string) => Promise<boolean>
}) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const c = file?.customer
  const vehicles = c?.vehicles ?? []
  const summary = file?.summary
  const [editOpen, setEditOpen] = useState(false)
  const [newPlate, setNewPlate] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [addingVehicle, setAddingVehicle] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function submitVehicle(e: React.FormEvent) {
    e.preventDefault()
    if (!c) return
    setAddingVehicle(true)
    try {
      const ok = await onAddVehicle(c.id, newPlate, newBrand)
      if (ok) {
        setNewPlate('')
        setNewBrand('')
      }
    } finally {
      setAddingVehicle(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            Historial del cliente
          </p>
          <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900 dark:text-slate-50">
            {c?.displayName ?? '…'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
            {[c?.documentId, c?.primaryPhone, c?.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
          </p>
        </div>
        {summary && !loading && (
          <div className="flex flex-wrap gap-2">
            {[
              {
                label: 'Órdenes',
                value: String(summary.totalOrders),
                tone: 'text-slate-900 dark:text-slate-50',
              },
              {
                label: 'Total trabajado',
                value: moneyOrDash(summary.worked),
                tone: 'text-slate-900 dark:text-slate-50',
              },
              {
                label: 'Cobrado',
                value: moneyOrDash(summary.paid),
                tone: 'text-slate-900 dark:text-slate-50',
              },
              {
                label: 'Saldo pendiente',
                value: moneyOrDash(summary.due),
                tone:
                  summary.due != null && Number(summary.due) > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400',
              },
            ].map((card) => (
              <div
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                key={card.label}
              >
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {card.label}
                </p>
                <p className={`m-0 font-mono text-[13px] font-semibold tabular-nums ${card.tone}`}>{card.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {can('work_orders:create') && c && (
          <button
            type="button"
            disabled={vehicles.length === 0}
            className="va-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setConfirmOpen(true)}
          >
            Nueva orden…
          </button>
        )}
        {can('customers:update') && c && (
          <button type="button" onClick={() => setEditOpen((x) => !x)} className="va-btn-secondary">
            {editOpen ? 'Cancelar edición' : 'Editar datos'}
          </button>
        )}
        {c?.primaryPhone && (
          <a
            href={`https://wa.me/${c.primaryPhone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="va-btn-secondary"
          >
            WhatsApp
          </a>
        )}
        <button type="button" onClick={onClose} className="va-btn-secondary ml-auto">
          Cerrar
        </button>
      </div>

      {editOpen && c && (
        <CustomerEditForm
          customer={c}
          onCancel={() => setEditOpen(false)}
          onSave={(data) => onSaveCustomer(c.id, data)}
        />
      )}

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
          Cargando historial del cliente…
        </p>
      ) : !can('work_orders:read') ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
          Sin permiso para ver órdenes de trabajo.
        </p>
      ) : file && file.workOrders.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
          No hay órdenes registradas para este cliente.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="va-table min-w-[760px]">
              <thead>
                <tr className="va-table-head-row">
                  <th className="va-table-th">Órden de trabajo</th>
                  <th className="va-table-th">Fecha</th>
                  <th className="va-table-th">Vehículo</th>
                  <th className="va-table-th">Estado</th>
                  <th className="va-table-th text-right">Trabajado</th>
                  <th className="va-table-th text-right">Cobrado</th>
                  <th className="va-table-th text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(file?.workOrders ?? []).map((wo) => (
                  <tr
                    key={wo.id}
                    className="va-table-body-row cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    onClick={() => navigate(portalPath(`/ordenes/${wo.id}`))}
                    title={`Abrir ${wo.publicCode}`}
                  >
                    <td className="va-table-td py-3.5 font-medium text-slate-900 dark:text-slate-50">
                      {wo.publicCode}{' '}
                      <span className="font-mono text-[11px] font-normal text-slate-400 dark:text-slate-500">
                        #{wo.orderNumber}
                      </span>
                    </td>
                    <td className="va-table-td py-3.5 text-slate-600 dark:text-slate-300">
                      {new Date(wo.createdAt).toLocaleDateString('es-CO')}
                    </td>
                    <td className="va-table-td py-3.5 text-slate-600 dark:text-slate-300">{vehicleLabel(wo)}</td>
                    <td className="va-table-td py-3.5">
                      <span className="text-slate-600 dark:text-slate-300">
                        {WO_STATUS_LABEL[wo.status] ?? wo.status}
                      </span>
                    </td>
                    <td className="va-table-td py-3.5 text-right font-mono text-slate-800 dark:text-slate-100">
                      {moneyOrDash(wo.linesSubtotal ?? '0')}
                    </td>
                    <td className="va-table-td py-3.5 text-right font-mono text-slate-800 dark:text-slate-100">
                      {moneyOrDash(wo.paymentSummary?.totalPaid ?? '0')}
                    </td>
                    <td
                      className={`va-table-td py-3.5 text-right font-mono ${Number(wo.amountDue) > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}`}
                    >
                      {moneyOrDash(wo.amountDue ?? '0')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('work_orders:read') && file && file.workOrders.length > 0 && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Últimas {file.workOrders.length} órdenes. Las cifras toman el detalle actual de cada orden.
            </p>
          )}
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {can('vehicles:read') && (
          <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Vehículos
            </h3>
            {vehicles.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Sin vehículos.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {vehicles.map((v) => (
                  <li key={v.id}>
                    <Link
                      to={portalPath(`/vehiculos/${v.id}`)}
                      className="inline-block rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-800 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-brand-300"
                    >
                      <span className="font-mono font-medium">{v.plate}</span>
                      {(v.brand || v.model) && (
                        <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                          {[v.brand, v.model].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {can('vehicles:create') && c && (
              <form
                onSubmit={submitVehicle}
                className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700"
              >
                <input
                  required
                  placeholder="Placa"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  className="va-field w-32 py-1.5 text-sm"
                />
                <input
                  placeholder="Marca (opc.)"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  className="va-field w-40 py-1.5 text-sm"
                />
                <button type="submit" className="va-btn-secondary" disabled={addingVehicle}>
                  {addingVehicle ? 'Agregando…' : 'Agregar vehículo'}
                </button>
              </form>
            )}
          </section>
        )}
        {c && (c.notes || c.isActive === false) && (
          <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Notas
            </h3>
            <p className="mt-2 text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">
              {c.notes ?? '—'}
              {c.isActive === false && ' (cliente inactivo)'}
            </p>
          </section>
        )}
      </div>

      {confirmOpen && c && (
        <NewOrderConfirmModal
          vehicles={c.vehicles}
          onConfirm={(vehicleId) => {
            const v = c.vehicles.find((x) => x.id === vehicleId)
            if (v) onNewOrder(v.id, v.plate, v.brand)
            setConfirmOpen(false)
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </section>
  )
}

export function CustomersPage() {
  const { can } = useAuth()
  const isSaas = panelUsesModernShell(usePanelTheme())
  const navigate = useNavigate()
  const [rows, setRows] = useState<Customer[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, CustomerFile>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const createBtnClass = 'va-btn-primary'

  async function load(search = '') {
    const q = search.trim()
    setBusy(true)
    try {
      if (q.length >= 2) {
        const data = await api<Customer[]>(`/customers/search?q=${encodeURIComponent(q)}`)
        setRows(data)
      } else {
        const data = await api<Customer[]>('/customers')
        setRows(data)
      }
    } catch {
      setMsg('Error al cargar clientes')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load().catch(() => setMsg('Error al cargar clientes'))
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    try {
      await api('/customers', {
        method: 'POST',
        body: JSON.stringify({
          displayName: displayName.trim(),
          primaryPhone: phone.trim() || undefined,
        }),
      })
      setOpen(false)
      setDisplayName('')
      setPhone('')
      setMsg('Cliente creado')
      await load(query)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  async function loadFile(customer: Customer) {
    if (files[customer.id]) return
    setLoadingId(customer.id)
    try {
      const [cust, woRes] = await Promise.all([
        api<CustomerDetail>(`/customers/${customer.id}`),
        can('work_orders:read')
          ? api<WorkOrderListResponse>(
              `/work-orders?customerId=${encodeURIComponent(customer.id)}&pageSize=${WORK_ORDER_DETAIL_LIMIT}`,
            ).catch(() => ({ items: [], total: 0 }))
          : Promise.resolve(null),
      ])
      const list = woRes?.items ?? []
      const details = await Promise.all(
        list.map((wo) => api<WorkOrderDetail>(`/work-orders/${wo.id}`).catch(() => null)),
      )
      const workOrders = details.filter((d): d is WorkOrderDetail => d !== null)
      const summary: CustomerSummary = {
        totalOrders: workOrders.length,
        worked: sumMoney(workOrders.map((d) => d.linesSubtotal)),
        paid: sumMoney(workOrders.map((d) => d.paymentSummary?.totalPaid)),
        due: sumMoney(workOrders.map((d) => d.amountDue)),
      }
      setFiles((prev) => ({ ...prev, [customer.id]: { customer: cust, workOrders, summary } }))
    } catch {
      setMsg('Error al cargar los datos del cliente')
    } finally {
      setLoadingId((cur) => (cur === customer.id ? null : cur))
    }
  }

  function toggle(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    const row = rows?.find((r) => r.id === id)
    if (row) void loadFile(row)
  }

  async function saveCustomer(id: string, data: CustomerPatch): Promise<boolean> {
    setMsg(null)
    try {
      const updated = await api<Customer>(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      setFiles((prev) =>
        prev[id] ? { ...prev, [id]: { ...prev[id], customer: { ...prev[id].customer, ...updated } } } : prev,
      )
      setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...updated } : r)) : prev))
      setMsg('Cliente actualizado')
      return true
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
      return false
    }
  }

  async function addVehicle(id: string, plate: string, brand: string): Promise<boolean> {
    setMsg(null)
    try {
      await api('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          customerId: id,
          plate: plate.trim(),
          brand: brand.trim() || undefined,
        }),
      })
      const cust = await api<CustomerDetail>(`/customers/${id}`)
      setFiles((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], customer: cust } } : prev))
      setRows((prev) =>
        prev ? prev.map((r) => (r.id === id ? { ...r, _count: { vehicles: cust.vehicles.length } } : r)) : prev,
      )
      setMsg('Vehículo registrado')
      return true
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
      return false
    }
  }

  async function quickOrder(vehicleId: string, plate: string, brand: string | null) {
    setMsg(null)
    try {
      const created = await api<{ id: string }>('/work-orders', {
        method: 'POST',
        body: JSON.stringify({
          description: [plate, brand].filter(Boolean).join(' · '),
          vehicleId,
          vehiclePlate: plate,
          vehicleBrand: brand ?? undefined,
        }),
      })
      setMsg('Orden creada')
      navigate(portalPath(`/ordenes/${created.id}`))
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error al crear la orden')
    }
  }

  return (
    <div className={isSaas ? 'space-y-7' : 'space-y-6'}>
      {msg && <p className="va-card-muted">{msg}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(query)
          }}
          placeholder="Buscar por nombre, teléfono o documento…"
          className="va-field w-full max-w-md"
        />
        <button type="button" onClick={() => void load(query)} disabled={busy} className="va-btn-secondary">
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
        {can('customers:create') && (
          <button type="button" onClick={() => setOpen(true)} className={createBtnClass}>
            Nuevo cliente
          </button>
        )}
      </div>

      {!rows ? (
        <p className="text-slate-500 dark:text-slate-300">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-300">
          {query.trim().length >= 2 ? 'Sin resultados para esa búsqueda.' : 'Sin clientes aún. Creá el primero.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="va-table min-w-[720px]">
              <thead>
                <tr className="va-table-head-row">
                  <th className="va-table-th">Cliente</th>
                  <th className="va-table-th">Documento</th>
                  <th className="va-table-th">Contacto</th>
                  <th className="va-table-th">Vehículos</th>
                  <th className="va-table-th">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const expanded = expandedId === c.id
                  return (
                    <Fragment key={c.id}>
                      <tr
                        aria-expanded={expanded}
                        tabIndex={0}
                        onClick={() => toggle(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggle(c.id)
                          }
                        }}
                        className="va-table-body-row cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="va-table-td py-4 font-medium text-slate-900 dark:text-slate-50">{c.displayName}</td>
                        <td className="va-table-td py-4 text-slate-600 dark:text-slate-300">{c.documentId ?? '—'}</td>
                        <td className="va-table-td py-4 text-slate-600 dark:text-slate-300">{c.primaryPhone ?? c.email ?? '—'}</td>
                        <td className="va-table-td py-4 text-slate-600 dark:text-slate-300">{c._count?.vehicles ?? 0}</td>
                        <td className="va-table-td py-4">
                          <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                            Activo
                          </span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={5} className="bg-slate-50/70 px-4 py-5 dark:bg-slate-900/40 sm:px-6">
                            <CustomerFilePanel
                              file={files[c.id] ?? null}
                              loading={loadingId === c.id}
                              onClose={() => setExpandedId(null)}
                              onNewOrder={(vehicleId, plate, brand) => void quickOrder(vehicleId, plate, brand)}
                              onSaveCustomer={saveCustomer}
                              onAddVehicle={addVehicle}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <div className="va-modal-overlay" role="presentation">
          <div
            className="va-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-customer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="new-customer-title"
              className={
                isSaas ? 'va-section-title text-base' : 'text-lg font-semibold text-slate-900 dark:text-slate-50'
              }
            >
              Nuevo cliente
            </h2>
            <form className="mt-4 space-y-3" onSubmit={create}>
              <label className="block text-sm">
                <span className="va-label">Nombre</span>
                <input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="va-field mt-1"
                />
              </label>
              <label className="block text-sm">
                <span className="va-label">Teléfono (opcional)</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="va-field mt-1" />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="va-btn-primary">
                  Crear
                </button>
                <button type="button" className="va-btn-secondary" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}