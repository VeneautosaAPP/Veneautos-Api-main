import type { PermissionRow } from '../api/types'

/** Perfil predefinido: códigos `recurso:acción` alineados con `api/prisma/seed.ts`. */
export type RoleTemplate = {
  id: string
  label: string
  description: string
  /** Códigos del catálogo; la unión de varios perfiles define el rol compuesto. */
  permissionCodes: readonly string[]
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    id: 'mecanico',
    label: 'Mecánico / taller',
    description:
      'Órdenes de trabajo, líneas (agregar repuesto con ítem y cantidad sin precio; precios y quitar repuestos ya cargados: cajero/admin/dueño), clientes y vehículos; inventario solo consulta. Sin caja ni cobros en OT.',
    permissionCodes: [
      'permissions:read',
      'work_orders:read',
      'work_orders:create',
      'work_orders:update',
      'work_order_lines:create',
      'work_order_lines:update',
      'work_order_lines:delete',
      'customers:read',
      'customers:create',
      'customers:update',
      'vehicles:read',
      'vehicles:create',
      'vehicles:update',
      'measurement_units:read',
      'inventory_items:read',
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario y compras',
    description: 'Alta y edición de ítems, recepciones de compra y unidades de medida.',
    permissionCodes: [
      'permissions:read',
      'measurement_units:read',
      'inventory_items:read',
      'inventory_items:create',
      'inventory_items:update',
      'purchase_receipts:read',
      'purchase_receipts:create',
    ],
  },
  {
    id: 'recepcion_caja',
    label: 'Recepción y caja (tipo cajero)',
    description:
      'Caja (apertura, ingresos, solicitudes de egreso), OT con cobro en caja, clientes y vehículos. Sin inventario ni configuración.',
    permissionCodes: [
      'permissions:read',
      'cash_sessions:read',
      'cash_sessions:open',
      'cash_movements:read',
      'cash_movements:create_income',
      'cash_expense_requests:create',
      'cash_expense_requests:read',
      'cash_expense_requests:cancel',
      'work_orders:read',
      'work_orders:read_all',
      'work_orders:create',
      'work_orders:update',
      'work_orders:record_payment',
      'customers:read',
      'customers:create',
      'customers:update',
      'vehicles:read',
      'vehicles:create',
      'vehicles:update',
      'measurement_units:read',
      'work_order_lines:create',
      'work_order_lines:update',
      'work_order_lines:delete',
      'work_order_lines:set_unit_price',
      'work_orders:view_financials',
    ],
  },
  {
    id: 'solo_lectura',
    label: 'Solo lectura',
    description: 'Consulta general sin crear ni modificar datos operativos sensibles.',
    permissionCodes: [
      'permissions:read',
      'users:read',
      'roles:read',
      'audit:read',
      'settings:read',
      'cash_sessions:read',
      'cash_movements:read',
      'cash_expense_requests:read',
      'work_orders:read',
      'work_orders:read_all',
      'measurement_units:read',
      'inventory_items:read',
      'purchase_receipts:read',
      'customers:read',
      'vehicles:read',
    ],
  },
] as const

function templateById(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.id === id)
}

/** Une los códigos de varios perfiles (sin duplicados). */
export function unionPermissionCodes(templateIds: Iterable<string>): string[] {
  const codes = new Set<string>()
  for (const id of templateIds) {
    const t = templateById(id)
    if (!t) continue
    for (const c of t.permissionCodes) codes.add(c)
  }
  return [...codes]
}

/** Mapea códigos del catálogo a IDs presentes en `GET /permissions`. */
export function codesToSelectedIds(permissions: PermissionRow[], codes: readonly string[]): Set<string> {
  const want = new Set(codes)
  const out = new Set<string>()
  for (const p of permissions) {
    if (want.has(`${p.resource}:${p.action}`)) out.add(p.id)
  }
  return out
}

/** Una fila de permiso alineada con el catálogo (textos del API / seed). */
export type ResolvedTemplatePermission = {
  code: string
  description: string | null
  /** El catálogo cargado no trae este código (API desactualizado o error). */
  missingFromCatalog: boolean
}

/** Orden de `codes`; descripción tomada de `permissions` cuando existe la fila. */
export function resolveTemplatePermissionRows(
  permissions: PermissionRow[],
  codes: readonly string[],
): ResolvedTemplatePermission[] {
  const byCode = new Map<string, PermissionRow>(
    permissions.map((p) => [`${p.resource}:${p.action}`, p]),
  )
  return codes.map((code) => {
    const row = byCode.get(code)
    return {
      code,
      description: row?.description ?? null,
      missingFromCatalog: row === undefined,
    }
  })
}
