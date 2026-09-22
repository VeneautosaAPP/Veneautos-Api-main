import type { PermissionRow } from '../api/types'

/** Nombre en español del ámbito funcional (agrupación en pantalla). */
export const RESOURCE_TITLE_ES: Record<string, string> = {
  audit: 'Auditoría',
  cash_delegates: 'Caja — delegados de egreso',
  cash_expense_requests: 'Caja — solicitudes de egreso',
  cash_movements: 'Caja — movimientos',
  cash_sessions: 'Caja — sesión',
  customers: 'Clientes',
  inventory_items: 'Inventario — repuestos e ítems',
  measurement_units: 'Inventario — unidades de medida',
  permissions: 'Seguridad — catálogo de permisos',
  purchase_receipts: 'Inventario — recepción de compras',
  reports: 'Informes y métricas',
  roles: 'Seguridad — roles',
  settings: 'Configuración del taller',
  users: 'Usuarios del sistema',
  vehicles: 'Vehículos',
  work_order_lines: 'Órdenes de trabajo — líneas',
  work_orders: 'Órdenes de trabajo',
}

/**
 * Texto visible para cada permiso: título claro + detalle para evitar asignaciones por error.
 * Clave: `recurso:acción` (igual que en el API).
 */
export const PERMISSION_GUIDE_ES: Record<string, { title: string; detail: string }> = {
  'audit:read': {
    title: 'Consultar auditoría',
    detail:
      'Permite ver el historial de acciones registradas (quién hizo qué y cuándo). Útil para investigar cambios sensibles; no otorga permiso para modificarlos.',
  },
  'cash_delegates:manage': {
    title: 'Gestionar delegados que pueden registrar egresos',
    detail:
      'Define hasta tres usuarios autorizados a registrar egresos de caja en nombre del dueño. Un abuso aquí permite que terceros retiren dinero; solo personal de máxima confianza.',
  },
  'cash_expense_requests:approve': {
    title: 'Aprobar solicitudes de egreso',
    detail:
      'Convierte una solicitud pendiente en un egreso real en la sesión de caja abierta. Equivale a autorizar salida de dinero; reservado a quien supervisa la caja.',
  },
  'cash_expense_requests:cancel': {
    title: 'Cancelar solicitudes de egreso propias',
    detail:
      'Permite anular solicitudes pendientes que el mismo usuario creó, si ya no aplican. No permite cancelar solicitudes ajenas ni aprobar/rechazar.',
  },
  'cash_expense_requests:create': {
    title: 'Crear solicitudes de egreso',
    detail:
      'Registra un pedido de salida de dinero que queda pendiente hasta que un supervisor lo apruebe (si aplica en el flujo del taller). No egresa dinero por sí solo hasta la aprobación.',
  },
  'cash_expense_requests:read': {
    title: 'Ver solicitudes de egreso',
    detail:
      'Lista solicitudes según las reglas del sistema (las propias y, si el perfil es elevado, las de otros). Solo lectura; no aprueba ni rechaza.',
  },
  'cash_expense_requests:reject': {
    title: 'Rechazar solicitudes de egreso',
    detail:
      'Deniega una solicitud pendiente indicando motivo; no mueve dinero. Quien lo tenga puede bloquear gastos legítimos si se usa mal.',
  },
  'cash_movements:create_expense': {
    title: 'Registrar egresos de caja',
    detail:
      'Registra salidas de efectivo (compras, pagos, gastos). Suele estar limitado a sesión abierta y, según política, solo a delegados autorizados. Alto impacto patrimonial.',
  },
  'cash_movements:create_income': {
    title: 'Registrar ingresos de caja',
    detail:
      'Anota entradas de dinero en la sesión abierta (cobros generales o vinculados a órdenes según pantalla). Afecta arqueo y reportes.',
  },
  'cash_movements:read': {
    title: 'Ver movimientos de caja',
    detail:
      'Consulta el listado de ingresos y egresos registrados. Lectura útil para revisión; no permite registrar movimientos.',
  },
  'cash_sessions:close': {
    title: 'Cerrar sesión de caja',
    detail:
      'Cierra el turno de caja con arqueo y diferencias. Mal usado puede dejar caja sin control o forzar cierres incorrectos; típicamente dueño o administrador.',
  },
  'cash_sessions:open': {
    title: 'Abrir sesión de caja',
    detail:
      'Inicia un turno de caja con monto inicial. Sin este permiso no se pueden registrar movimientos que dependan de sesión activa.',
  },
  'cash_sessions:read': {
    title: 'Ver estado y sesiones de caja',
    detail:
      'Ve si hay sesión abierta, historial reciente y datos necesarios para operar caja de forma segura. No abre ni cierra por sí solo.',
  },
  'customers:create': {
    title: 'Crear clientes',
    detail:
      'Alta de fichas de cliente en el taller. Datos personales/comerciales: asignar solo a quien carga datos en recepción o administración.',
  },
  'customers:read': {
    title: 'Ver clientes',
    detail:
      'Lista y detalle de clientes. Lectura de datos sensibles; no permite editar ni borrar (según otras reglas del API).',
  },
  'customers:update': {
    title: 'Editar clientes',
    detail:
      'Modifica datos de clientes existentes. Puede alterar contacto, documentos o notas; revisar quién debe mantener la ficha al día.',
  },
  'customers:delete': {
    title: 'Eliminar clientes',
    detail:
      'Borra definitivamente una ficha de cliente. El API solo permite eliminar clientes sin vehículos registrados, para no perder histórico de órdenes.',
  },
  'inventory_items:create': {
    title: 'Crear ítems de inventario',
    detail:
      'Da de alta repuestos o materiales en el catálogo con SKU y unidad. Incorpora ítems nuevos al stock inicial según lo cargado.',
  },
  'inventory_items:read': {
    title: 'Ver inventario',
    detail:
      'Consulta catálogo y existencias aproximadas. Necesario para cotizar o cargar líneas en órdenes sin poder modificar precios o datos maestros.',
  },
  'inventory_items:update': {
    title: 'Editar ítems de inventario',
    detail:
      'Cambia nombre, costo promedio, si controla stock y si está activo. Errores afectan valoraciones y movimientos de stock.',
  },
  'measurement_units:read': {
    title: 'Ver unidades de medida',
    detail:
      'Lista unidades (unidad, kg, litro, etc.) para asociar ítems. Solo lectura del catálogo maestro.',
  },
  'auth:assume_role_preview': {
    title: 'Vista por rol (probar permisos)',
    detail:
      'Permite a administrador o dueño emitir un token que ve la app con los permisos de otro rol, y volver a los propios. Útil para revisar UX y restricciones sin cambiar de usuario.',
  },
  'permissions:read': {
    title: 'Listar permisos del catálogo',
    detail:
      'Necesario para armar roles en el panel (ver checklist de permisos). No permite crear usuarios ni roles por sí solo.',
  },
  'purchase_receipts:create': {
    title: 'Registrar recepción de compra',
    detail:
      'Ingresa mercadería recibida y actualiza stock/costos según política. Impacto directo en inventario y costos.',
  },
  'purchase_receipts:read': {
    title: 'Ver recepciones de compra',
    detail:
      'Consulta comprobantes de recepción históricos. Auditoría de compras sin poder registrar nuevas recepciones.',
  },
  'reports:read': {
    title: 'Ver informes económicos',
    detail:
      'Resúmenes agregados (caja, cobros en OT, órdenes abiertas/entregadas). No otorga acceso a movimientos detallados de caja si no corresponde; sirve para seguimiento gerencial.',
  },
  'roles:create': {
    title: 'Crear roles',
    detail:
      'Define nuevos perfiles y les asigna permisos. Un rol mal configurado puede acumular demasiados poderes; solo administración de confianza.',
  },
  'roles:delete': {
    title: 'Eliminar roles',
    detail:
      'Elimina roles que no sean de sistema y sin usuarios asignados. Evitar borrar perfiles en uso sin migrar usuarios antes.',
  },
  'roles:read': {
    title: 'Ver roles',
    detail:
      'Lista roles y sus permisos. Base para auditar quién puede qué; no modifica asignaciones.',
  },
  'roles:update': {
    title: 'Editar roles y permisos',
    detail:
      'Cambia nombre, descripción y conjunto de permisos de un rol. Amplía o reduce capacidades de todos los usuarios con ese rol.',
  },
  'settings:read': {
    title: 'Ver configuración del taller',
    detail:
      'Lee parámetros globales (nombre del taller, moneda, políticas, etc.). No altera valores.',
  },
  'settings:update': {
    title: 'Modificar configuración del taller',
    detail:
      'Cambia ajustes que pueden afectar a todo el sistema (por ejemplo reglas de alta de usuarios). Reservar a dueño o TI de confianza.',
  },
  'users:create': {
    title: 'Crear usuarios',
    detail:
      'Da de alta cuentas y puede asignar roles iniciales. Riesgo de crear cuentas con demasiados permisos si los roles no están controlados.',
  },
  'users:deactivate': {
    title: 'Desactivar usuarios',
    detail:
      'Permite marcar cuentas como inactivas (bloqueo de acceso). Suele exigirse explícitamente además de «actualizar usuario»; crítico para offboarding.',
  },
  'users:read': {
    title: 'Ver usuarios',
    detail:
      'Lista el personal y sus datos básicos. Útil para administración; combinar con criterios de privacidad interna.',
  },
  'users:reset_password': {
    title: 'Restablecer contraseña de usuarios',
    detail:
      'Asigna una contraseña nueva a otra cuenta (p. ej. si olvidó el acceso) y cierra todas sus sesiones. No habilita que cada usuario cambie la propia desde el panel; solo soporte/administración.',
  },
  'users:update': {
    title: 'Editar usuarios',
    detail:
      'Actualiza nombre, roles y datos de cuenta. Puede reasignar roles y alterar el acceso; revisar políticas internas antes de otorgarlo ampliamente.',
  },
  'vehicles:create': {
    title: 'Registrar vehículos',
    detail:
      'Alta de vehículos asociados a clientes (patente, notas). Quien lo tenga puede vincular flota al taller.',
  },
  'vehicles:read': {
    title: 'Ver vehículos',
    detail:
      'Consulta fichas de vehículos e historial ligado. Datos de clientes y unidades; lectura sensible.',
  },
  'vehicles:update': {
    title: 'Editar vehículos',
    detail:
      'Modifica datos del vehículo o notas. Puede afectar cómo se muestran órdenes y datos en recepción.',
  },
  'work_order_lines:create': {
    title: 'Agregar líneas a una orden',
    detail:
      'Añade repuestos o mano de obra a una OT en curso. Cambia totales y stock según tipo de línea.',
  },
  'work_order_lines:delete': {
    title: 'Eliminar líneas de una orden',
    detail:
      'Quita líneas de una OT abierta; en repuestos puede devolver stock. Puede borrar trabajo facturado en borrador; usar con control interno.',
  },
  'work_order_lines:update': {
    title: 'Editar líneas de una orden',
    detail:
      'Cambia cantidades, precios o descripciones de líneas. Impacta subtotales y cobros posteriores.',
  },
  'work_order_lines:set_unit_price': {
    title: 'Fijar precio unitario en líneas (legado)',
    detail:
      'Permiso histórico equivalente a cargar precio en líneas de OT. En catálogo nuevo convive con «ver importes en la orden»; el sistema acepta cualquiera de los dos para ver montos y cobrar, salvo el perfil técnico.',
  },
  'work_orders:view_financials': {
    title: 'Ver importes en la orden y fijar precios en líneas',
    detail:
      'Muestra subtotales, saldo, tope autorizado y cobros; permite cargar precio unitario en líneas. Los técnicos operan sin ver montos ni costos de ítems en la OT.',
  },
  'work_orders:create': {
    title: 'Crear órdenes de trabajo',
    detail:
      'Abre nuevas OT en estado recibida. Punto de entrada del trabajo en taller; asignar a recepción o quien abre casos.',
  },
  'work_orders:read': {
    title: 'Ver órdenes de trabajo',
    detail:
      'Lista y detalle de OT, líneas y totales según reglas. Sin “ver todas” solo se muestran las OT que abriste vos.',
  },
  'work_orders:read_all': {
    title: 'Ver todas las órdenes de trabajo',
    detail:
      'Lista y abre cualquier OT del taller (recepción, caja, supervisión). Sin este permiso cada usuario solo ve las que creó.',
  },
  'work_orders:record_payment': {
    title: 'Registrar cobro de orden en caja',
    detail:
      'Registra un ingreso vinculado a una OT concreta (además suele exigirse permiso de ingreso en caja). Afecta saldo de la orden y arqueo.',
  },
  'work_orders:reopen_delivered': {
    title: 'Reabrir orden entregada',
    detail:
      'Permite volver una OT de Entregada a Lista para corregir montos o líneas; exige nota y justificación y queda registrado en auditoría e historial interno.',
  },
  'work_orders:update': {
    title: 'Actualizar órdenes de trabajo',
    detail:
      'Cambia descripción, estado, tope de cobro autorizado, etc. Estados incorrectos pueden bloquear flujo operativo o cobros.',
  },
}

const code = (p: PermissionRow) => `${p.resource}:${p.action}`

export function resourceTitleEs(resource: string): string {
  return RESOURCE_TITLE_ES[resource] ?? resource.replace(/_/g, ' ')
}

export function permissionPresentation(p: PermissionRow): {
  resourceTitle: string
  title: string
  detail: string
  technicalCode: string
} {
  const key = code(p)
  const guide = PERMISSION_GUIDE_ES[key]
  const resourceTitle = resourceTitleEs(p.resource)
  return {
    resourceTitle,
    title: guide?.title ?? p.description?.split('.')[0]?.trim() ?? key,
    detail:
      guide?.detail ??
      p.description ??
      'Permiso del sistema. Si no hay descripción, consultá con quien administra el taller antes de asignarlo.',
    technicalCode: key,
  }
}

/** Texto para filtrar (búsqueda en español + código técnico). */
export function permissionSearchBlob(p: PermissionRow): string {
  const { resourceTitle, title, detail, technicalCode } = permissionPresentation(p)
  return [resourceTitle, title, detail, technicalCode, p.resource, p.action].join(' ').toLowerCase()
}
