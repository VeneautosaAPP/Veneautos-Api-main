import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { WorkOrderListResponse, WorkOrderStatus, WorkOrderSummary } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { portalPath } from '../constants/portalPath'
import { PageHeader } from '../components/layout/PageHeader'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'

type Customer = {
  id: string
  displayName: string
  primaryPhone: string | null
  email: string | null
  documentId: string | null
  notes: string | null
  isActive: boolean
}

type VehicleBrief = {
  id: string
  plate: string
  brand: string | null
  model: string | null
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

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const { can } = useAuth()
  const [c, setC] = useState<Customer | null>(null)
  const [vehicles, setVehicles] = useState<VehicleBrief[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const [dn, setDn] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [doc, setDoc] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)

  const [plate, setPlate] = useState('')
  const [brand, setBrand] = useState('')
  const [newWoVehicleId, setNewWoVehicleId] = useState('')
  const [customerWorkOrders, setCustomerWorkOrders] = useState<WorkOrderSummary[] | null>(null)
  const pageClass = isSaas ? 'space-y-7' : 'space-y-8'
  const sectionCardClass = isSaas ? 'va-saas-page-section' : 'va-card'
  const backLinkClass = isSaas
    ? 'text-sm font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300'
    : 'text-sm font-medium text-brand-700 hover:underline dark:text-brand-300'

  async function load() {
    if (!id) return
    const bust = `_=${Date.now()}`
    const woReq = can('work_orders:read')
      ? api<WorkOrderListResponse>(`/work-orders?customerId=${encodeURIComponent(id)}&pageSize=50&${bust}`).catch(
          () => ({ items: [], total: 0 }),
        )
      : Promise.resolve(null)

    const [cust, veh, woRes] = await Promise.all([
      api<Customer>(`/customers/${id}`),
      can('vehicles:read') ? api<VehicleBrief[]>(`/customers/${id}/vehicles`) : Promise.resolve([]),
      woReq,
    ])
    setC(cust)
    setVehicles(veh)
    setCustomerWorkOrders(woRes ? woRes.items : null)
    setDn(cust.displayName)
    setPhone(cust.primaryPhone ?? '')
    setEmail(cust.email ?? '')
    setDoc(cust.documentId ?? '')
    setNotes(cust.notes ?? '')
    setActive(cust.isActive)
  }

  useEffect(() => {
    void load().catch(() => setMsg('Cliente no encontrado'))
  }, [id])

  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setMsg(null)
    try {
      await api(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: dn.trim(),
          primaryPhone: phone.trim() || null,
          email: email.trim() || null,
          documentId: doc.trim() || null,
          notes: notes.trim() || null,
          isActive: active,
        }),
      })
      setMsg('Cliente actualizado')
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
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
      setPlate('')
      setBrand('')
      setMsg('Vehículo registrado')
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  if (!c && msg === 'Cliente no encontrado') {
    return (
      <div className="va-alert-error-block">
        Cliente no encontrado
        <Link
          to={portalPath('/clientes')}
          className="mt-4 block text-sm font-medium text-brand-800 underline dark:text-brand-300"
        >
          ← Clientes
        </Link>
      </div>
    )
  }

  if (!c) return <p className="text-slate-500 dark:text-slate-300">Cargando…</p>

  return (
    <div className={pageClass}>
      <PageHeader
        beforeTitle={
          <Link to={portalPath('/clientes')} className={backLinkClass}>
            ← Clientes
          </Link>
        }
        title={c.displayName}
      />
      {msg && <p className="va-card-muted">{msg}</p>}

      {can('customers:update') && (
        <form onSubmit={saveCustomer} className={`${sectionCardClass} space-y-3`}>
          <h2 className="va-section-title">Datos del cliente</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="va-label">Nombre</span>
              <input required value={dn} onChange={(e) => setDn(e.target.value)} className="va-field mt-1" />
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
            <label className="block text-sm sm:col-span-2">
              <span className="va-label">Notas</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="va-field mt-1" />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 dark:text-slate-300">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Cliente activo
            </label>
          </div>
          <button type="submit" className="va-btn-primary">
            Guardar
          </button>
        </form>
      )}

      {can('vehicles:read') && (
        <section className={sectionCardClass}>
          <h2 className="va-section-title">Vehículos</h2>
          <ul className="mt-3 space-y-2">
            {vehicles.map((v) => (
              <li key={v.id}>
                <Link
                  to={portalPath(`/vehiculos/${v.id}`)}
                  className="block rounded-xl border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="font-mono font-medium text-slate-900 dark:text-slate-50">{v.plate}</span>
                  {(v.brand || v.model) && (
                    <span className="ml-2 text-slate-500 dark:text-slate-300">
                      {[v.brand, v.model].filter(Boolean).join(' ')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
            {vehicles.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-300">Sin vehículos.</p>
            )}
          </ul>
          {can('vehicles:create') && (
            <form onSubmit={addVehicle} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-3">
              <input
                required
                placeholder="Placa"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                className="va-field"
              />
              <input
                placeholder="Marca (opc.)"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="va-field"
              />
              <button type="submit" className="rounded-xl bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600">
                Agregar vehículo
              </button>
            </form>
          )}
        </section>
      )}

      {can('work_orders:read') && customerWorkOrders !== null && (
        <section className={sectionCardClass}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="va-section-title">Órdenes de trabajo</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                Historial de este cliente en todos sus vehículos registrados (solo órdenes vinculadas al maestro).
              </p>
            </div>
            <Link
              to={portalPath(`/ordenes?customerId=${encodeURIComponent(id!)}`)}
              className="shrink-0 text-sm font-medium text-brand-700 underline hover:text-brand-800 dark:text-brand-300"
            >
              Ver en listado…
            </Link>
          </div>
          {customerWorkOrders.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-300">Sin órdenes aún para este cliente.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {customerWorkOrders.map((wo) => (
                <li key={wo.id} className="py-2.5 first:pt-0">
                  <Link
                    to={portalPath(`/ordenes/${wo.id}`)}
                    className="block text-sm font-medium text-slate-900 hover:text-brand-700 dark:text-slate-50 dark:hover:text-brand-300"
                  >
                    OT {wo.publicCode}{' '}
                    <span className="font-mono text-[11px] font-normal text-slate-400 dark:text-slate-500">
                      #{wo.orderNumber}
                    </span>{' '}
                    <span className="font-normal text-slate-500 dark:text-slate-300">
                      · {WO_STATUS_LABEL[wo.status] ?? wo.status}
                    </span>
                  </Link>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{wo.description}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-300">
                    {[wo.vehicle?.plate ?? wo.vehiclePlate, wo.vehicleBrand ?? wo.vehicle?.brand].filter(Boolean).join(' · ') ||
                      '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {can('work_orders:create') && (
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Nueva orden</p>
              {vehicles.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                  Registrá al menos un vehículo arriba para crear una OT vinculada al maestro.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="block min-w-[12rem] flex-1 text-sm">
                    <span className="va-label">Vehículo</span>
                    <select
                      value={newWoVehicleId}
                      onChange={(e) => setNewWoVehicleId(e.target.value)}
                      className="va-field mt-1"
                    >
                      <option value="">Elegí unidad…</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plate}
                          {(v.brand || v.model) ? ` · ${[v.brand, v.model].filter(Boolean).join(' ')}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!newWoVehicleId}
                    onClick={() => {
                      const v = vehicles.find((x) => x.id === newWoVehicleId)
                      const pl = v?.plate ?? ''
                      navigate(
                        portalPath(
                          `/ordenes?openCreate=1&vehicleId=${encodeURIComponent(newWoVehicleId)}&plate=${encodeURIComponent(pl)}`,
                        ),
                      )
                    }}
                    className="va-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Crear orden con este vehículo…
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
