import { api } from '../../../api/client'
import type {
  CreateWorkOrderPayload,
  WorkOrderDetail,
  WorkOrderListResponse,
  WorkOrderStatus,
} from '../../../api/types'
import type { WorkOrdersVehicleHit, WorkOrdersWarrantyVehicleOption } from '../types'

export type WorkOrdersListQuery = {
  status?: WorkOrderStatus
  vehicleId?: string
  customerId?: string
  search?: string
  page: number
  pageSize: number
}

export async function fetchWorkOrdersList(
  q: WorkOrdersListQuery,
  signal?: AbortSignal,
): Promise<WorkOrderListResponse> {
  const qs = new URLSearchParams()
  if (q.status) qs.set('status', q.status)
  if (q.vehicleId) qs.set('vehicleId', q.vehicleId)
  if (q.customerId) qs.set('customerId', q.customerId)
  if (q.search) qs.set('search', q.search)
  qs.set('page', String(q.page))
  qs.set('pageSize', String(q.pageSize))
  return api<WorkOrderListResponse>(`/work-orders?${qs.toString()}`, { signal })
}

export async function searchVehiclesForWorkOrder(q: string): Promise<WorkOrdersVehicleHit[]> {
  return api<WorkOrdersVehicleHit[]>(`/vehicles/search?q=${encodeURIComponent(q)}`)
}

/**
 * BEFORE: Usaba `_=${Date.now()}` → cache busting → nunca cachea.
 * NOW: Sin busting → TanStack Query puede reutilizar data.
 */
export async function fetchWorkOrderDetailForList(id: string, signal?: AbortSignal): Promise<WorkOrderDetail> {
  return api<WorkOrderDetail>(`/work-orders/${id}`, { signal })
}

/** GET detalle sin bust de URL — para TanStack Query (caché + prefetch). */
export async function fetchWorkOrderDetailForQuery(id: string, signal?: AbortSignal): Promise<WorkOrderDetail> {
  return api<WorkOrderDetail>(`/work-orders/${id}`, { signal })
}

/** Cobros de la OT — misma clave de caché que `queryKeys.workOrders.payments(id)`. */
export type WorkOrderPaymentRow = {
  id: string
  amount: string
  kind?: 'PARTIAL' | 'FULL_SETTLEMENT'
  createdAt: string
  note: string | null
  recordedBy: { fullName: string }
  cashMovement: {
    category: { slug: string; name: string }
    tenderAmount?: string | null
    changeAmount?: string | null
  }
}

export async function fetchWorkOrderPaymentsForQuery(
  id: string,
  signal?: AbortSignal,
): Promise<WorkOrderPaymentRow[]> {
  return api<WorkOrderPaymentRow[]>(`/work-orders/${id}/payments`, { signal })
}

export async function fetchCustomerVehiclesForWorkOrderList(customerId: string, signal?: AbortSignal): Promise<WorkOrdersWarrantyVehicleOption[]> {
  return api<WorkOrdersWarrantyVehicleOption[]>(`/customers/${customerId}/vehicles`, { signal })
}

export async function createWorkOrderFromList(
  body: CreateWorkOrderPayload,
): Promise<{ id: string; orderNumber?: number; publicCode?: string }> {
  return api<{ id: string; orderNumber?: number; publicCode?: string }>('/work-orders', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function cancelWorkOrderToTerminal(id: string): Promise<void> {
  await api(`/work-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'CANCELLED' }),
  })
}

export type WeeklyDeliveredSummary = {
  week: { from: string; to: string }
  count: number
  paymentsTotal: string | null
}

export async function fetchWeeklyDeliveredSummary(
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<WeeklyDeliveredSummary> {
  const qs = new URLSearchParams()
  qs.set('from', from.toISOString())
  qs.set('to', to.toISOString())
  return api<WeeklyDeliveredSummary>(`/work-orders/weekly-delivered-summary?${qs.toString()}`, {
    signal,
  })
}

export type MonthlyDeliveredSummary = {
  month: { from: string; to: string }
  count: number
  paymentsTotal: string | null
}

export async function fetchMonthlyDeliveredSummary(
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<MonthlyDeliveredSummary> {
  const qs = new URLSearchParams()
  qs.set('from', from.toISOString())
  qs.set('to', to.toISOString())
  return api<MonthlyDeliveredSummary>(`/work-orders/monthly-delivered-summary?${qs.toString()}`, {
    signal,
  })
}

/** Resumen (panel) de OTs en un estado: cantidad + valor total a cobrar. `totalValue` null si el perfil no ve importes. */
export type WorkOrdersValueSummary = {
  count: number
  totalValue: string | null
}

export type ReadyOrdersSummary = WorkOrdersValueSummary

export async function fetchReadyOrdersSummary(signal?: AbortSignal): Promise<ReadyOrdersSummary> {
  return api<ReadyOrdersSummary>('/work-orders/ready-orders-summary', { signal })
}

export type InWorkshopSummary = WorkOrdersValueSummary

export async function fetchInWorkshopSummary(signal?: AbortSignal): Promise<InWorkshopSummary> {
  return api<InWorkshopSummary>('/work-orders/in-workshop-summary', { signal })
}
