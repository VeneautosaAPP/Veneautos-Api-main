import type { ExpenseReq } from './types'

export function sessionStatusEs(status: string): string {
  if (status === 'OPEN') return 'Abierta'
  if (status === 'CLOSED') return 'Cerrada'
  return status
}

function expenseStatusEs(status: string): string {
  const m: Record<string, string> = {
    PENDING: 'Pendiente',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    CANCELLED: 'Cancelada',
    EXPIRED: 'Expirada',
  }
  return m[status] ?? status
}

export function expenseRequestStatusLabel(r: ExpenseReq): string {
  const base = expenseStatusEs(r.status)
  if (r.status === 'APPROVED' && !r.resultMovement) {
    return `${base} · pendiente en caja`
  }
  return base
}
