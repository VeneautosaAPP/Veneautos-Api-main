import { api } from '../../../api/client'

/**
 * Nómina semanal (lunes–sábado) por mecánico: el servidor entrega la mano de obra
 * (solo líneas LABOR, sin IVA) y el % de nómina configurado por OT, con el monto a pagar.
 *
 * - Con `payroll:read` (mecánico) el servidor devuelve solo la fila del usuario, en solo-lectura.
 * - Con `payroll:read_all` (admin/dueño) devuelve todas las filas y puede configurar el %.
 */
export type PayrollOrderLabor = {
  id: string
  publicCode: string
  description: string | null
  plate: string | null
  deliveredAt: string
  laborTotal: string
  /** % de nómina configurado para esta OT (50 si no se configuró). */
  commissionPct: string
  payable: string
}

export type PayrollMechanicRow = {
  mechanicId: string
  fullName: string
  ordersCount: number
  laborTotal: string
  payable: string
  orders: PayrollOrderLabor[]
}

export type PayrollWeeklySummary = {
  week: { from: string; to: string }
  rate: string
  isOwnOnly: boolean
  mechanics: PayrollMechanicRow[]
}

export async function fetchPayrollWeeklySummary(
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<PayrollWeeklySummary> {
  const qs = new URLSearchParams()
  qs.set('from', from.toISOString())
  qs.set('to', to.toISOString())
  return api<PayrollWeeklySummary>(`/payroll/weekly-summary?${qs.toString()}`, { signal })
}

export type PayrollRatioResponse = { ok: true; workOrderId: string; commissionPct: string }

/**
 * Persiste el % de nómina de una OT. Solo perfiles con `payroll:read_all` (dueño/admin);
 * el servidor valida 0 ≤ % ≤ 100.
 */
export async function updatePayrollCommissionPct(
  workOrderId: string,
  commissionPct: number,
): Promise<PayrollRatioResponse> {
  return api<PayrollRatioResponse>(`/payroll/weekly-summary/ratios/${workOrderId}`, {
    method: 'PUT',
    body: JSON.stringify({ commissionPct }),
  })
}