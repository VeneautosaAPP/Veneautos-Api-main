import { api } from '../../../api/client'

/**
 * Nómina semanal (lunes–sábado) por mecánico: el servidor entrega la mano de obra
 * (solo líneas LABOR, sin IVA) y el 50% a pagar de las OTs entregadas en la semana.
 *
 * - Con `payroll:read` (mecánico) el servidor devuelve solo la fila del usuario.
 * - Con `payroll:read_all` (admin/dueño) devuelve todas las filas.
 */
export type PayrollOrderLabor = {
  id: string
  publicCode: string
  description: string | null
  plate: string | null
  deliveredAt: string
  laborTotal: string
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