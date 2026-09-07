/** Presentación en español de filas de auditoría (acciones del API + tipos de entidad). */

export type AuditTone = 'neutral' | 'auth' | 'cash' | 'orders' | 'inventory' | 'people' | 'security' | 'http'

const ACTION_TITLE: Record<string, string> = {
  'http.post': 'Petición HTTP (alta o cambio)',
  'http.put': 'Petición HTTP (reemplazo)',
  'http.patch': 'Petición HTTP (modificación parcial)',
  'http.delete': 'Petición HTTP (baja)',
  'auth.login': 'Inicio de sesión',
  'auth.logout': 'Cierre de sesión',
  'auth.register': 'Registro de cuenta',
  'users.create': 'Usuario creado',
  'users.reset_password': 'Contraseña restablecida',
  'users.update': 'Usuario actualizado',
  'roles.create': 'Rol creado',
  'roles.update': 'Rol modificado',
  'roles.delete': 'Rol eliminado',
  'settings.update': 'Configuración del taller modificada',
  'cash_sessions.open': 'Caja abierta (nueva sesión)',
  'cash_sessions.close': 'Caja cerrada',
  'cash_movements.income': 'Ingreso de caja registrado',
  'cash_movements.expense': 'Egreso de caja registrado',
  'cash_delegates.set': 'Lista de delegados de egreso actualizada',
  'cash_expense_requests.created': 'Solicitud de egreso creada',
  'cash_expense_requests.approved': 'Solicitud de egreso aprobada',
  'cash_expense_requests.paid_out': 'Egreso registrado en caja (solicitud aprobada)',
  'cash_expense_requests.rejected': 'Solicitud de egreso rechazada',
  'cash_expense_requests.cancelled': 'Solicitud de egreso cancelada',
  'work_orders.created': 'Orden de trabajo creada',
  'work_orders.updated': 'Orden de trabajo actualizada',
  'work_orders.payment_recorded': 'Cobro de orden registrado',
  'work_order_lines.created': 'Línea agregada a una orden',
  'work_order_lines.updated': 'Línea de orden modificada',
  'work_order_lines.deleted': 'Línea de orden eliminada',
  'customers.created': 'Cliente creado',
  'customers.updated': 'Cliente actualizado',
  'vehicles.created': 'Vehículo registrado',
  'vehicles.updated': 'Vehículo actualizado',
  'inventory_items.created': 'Ítem de inventario creado',
  'inventory_items.updated': 'Ítem de inventario actualizado',
  'inventory.purchase_receipt_created': 'Recepción de compra registrada',
  'workshop_finance.payable.deleted_settled': 'Deuda saldada eliminada del listado',
}

const ENTITY_TITLE: Record<string, string> = {
  HTTP: 'Petición al servidor',
  User: 'Usuario',
  Role: 'Rol',
  WorkshopSetting: 'Parámetro del taller',
  CashSession: 'Sesión de caja',
  CashMovement: 'Movimiento de caja',
  CashExpenseRequest: 'Solicitud de egreso',
  WorkOrder: 'Orden de trabajo',
  WorkOrderLine: 'Línea de orden',
  Customer: 'Cliente',
  Vehicle: 'Vehículo',
  InventoryItem: 'Ítem de inventario',
  PurchaseReceipt: 'Recepción de compra',
  WorkshopPayable: 'Deuda del taller (finanzas workshop)',
}

export function auditActionTitleEs(action: string): string {
  return ACTION_TITLE[action] ?? humanizeCode(action)
}

export function auditEntityTitleEs(entityType: string): string {
  return ENTITY_TITLE[entityType] ?? humanizeCode(entityType)
}

function humanizeCode(s: string): string {
  return s
    .replace(/\./g, ' · ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

export function auditActionTone(action: string): AuditTone {
  if (action.startsWith('http.')) return 'http'
  if (action.startsWith('auth.')) return 'auth'
  if (
    action.startsWith('cash_') ||
    action.startsWith('cash.') ||
    action.includes('cash_movements')
  )
    return 'cash'
  if (action.startsWith('work_order')) return 'orders'
  if (action.startsWith('workshop_finance')) return 'cash'
  if (action.includes('inventory') || action.includes('purchase')) return 'inventory'
  if (action.startsWith('users.') || action.startsWith('customers.') || action.startsWith('vehicles.'))
    return 'people'
  if (action.startsWith('roles.') || action.startsWith('settings.')) return 'security'
  return 'neutral'
}

const TONE_CLASS: Record<AuditTone, string> = {
  neutral: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
  auth: 'bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-50',
  cash: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-50',
  orders: 'bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-50',
  inventory: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-50',
  people: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-50',
  security: 'bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-50',
  http: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100',
}

export function auditToneBadgeClass(tone: AuditTone): string {
  return TONE_CLASS[tone]
}

export function auditHttpSummary(nextPayload: unknown): string | null {
  if (!nextPayload || typeof nextPayload !== 'object') return null
  const o = nextPayload as Record<string, unknown>
  const path = typeof o.path === 'string' ? o.path : null
  const status = typeof o.statusCode === 'number' ? o.statusCode : null
  if (!path) return null
  return status != null ? `Ruta: ${path} · Respuesta ${status}` : `Ruta: ${path}`
}
