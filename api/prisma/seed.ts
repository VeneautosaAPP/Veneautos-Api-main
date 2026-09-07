/**
 * Semilla idempotente: permisos, categorías de caja, roles del taller y usuario administrador.
 * Ejecutar tras migraciones (`npx prisma migrate deploy` / `migrate dev`) para que existan tablas.
 */
import { CashMovementDirection, Prisma, PrismaClient, TaxRateKind } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * El seed debe conectarse por **conexión directa** cuando exista `DIRECT_URL`.
 * Si solo usás `DATABASE_URL` del pooler en modo sesión (Supabase), el mismo límite
 * de clientes cuenta para API + migrate + seed y aparece:
 * MaxClientsInSessionMode / max clients reached — pool_size.
 */
const seedDatabaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!seedDatabaseUrl?.trim()) {
  throw new Error('Definí DATABASE_URL en .env (y DIRECT_URL en Supabase/pooler).');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: seedDatabaseUrl,
    },
  },
});

/** Catálogo de permisos (Fase 1 identidad/config + Fase 2 caja y delegados). */
const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'users', action: 'read', description: 'Listar y ver usuarios' },
  { resource: 'users', action: 'create', description: 'Crear usuarios' },
  { resource: 'users', action: 'update', description: 'Actualizar usuarios' },
  { resource: 'users', action: 'deactivate', description: 'Desactivar usuarios' },
  {
    resource: 'users',
    action: 'reset_password',
    description:
      'Restablecer contraseña de otro usuario (soporte). Cierra todas sus sesiones. Los usuarios operativos no pueden cambiar la propia desde el panel.',
  },
  { resource: 'roles', action: 'read', description: 'Ver roles y permisos asignados' },
  { resource: 'roles', action: 'create', description: 'Crear roles' },
  { resource: 'roles', action: 'update', description: 'Actualizar roles y permisos' },
  { resource: 'roles', action: 'delete', description: 'Eliminar roles no sistema' },
  { resource: 'permissions', action: 'read', description: 'Listar permisos del catálogo' },
  {
    resource: 'auth',
    action: 'assume_role_preview',
    description:
      'Probar el panel con los permisos de otro rol (solo cuentas administrador o dueño del taller)',
  },
  { resource: 'audit', action: 'read', description: 'Consultar auditoría' },
  {
    resource: 'reports',
    action: 'read',
    description: 'Ver informes económicos y operativos del taller (agregados)',
  },
  { resource: 'settings', action: 'read', description: 'Ver configuración del taller' },
  { resource: 'settings', action: 'update', description: 'Modificar configuración del taller' },
  { resource: 'cash_sessions', action: 'read', description: 'Ver sesiones y estado de caja' },
  { resource: 'cash_sessions', action: 'open', description: 'Abrir sesión de caja' },
  { resource: 'cash_sessions', action: 'close', description: 'Cerrar sesión de caja (dueño/admin)' },
  { resource: 'cash_movements', action: 'read', description: 'Ver movimientos de caja' },
  { resource: 'cash_movements', action: 'create_income', description: 'Registrar ingresos de caja' },
  {
    resource: 'cash_movements',
    action: 'create_expense',
    description: 'Registrar egresos (elevados o hasta 3 delegados)',
  },
  {
    resource: 'cash_delegates',
    action: 'manage',
    description: 'Gestionar delegados de egreso (máx. 3)',
  },
  {
    resource: 'cash_expense_requests',
    action: 'create',
    description: 'Crear solicitud de egreso pendiente de aprobación',
  },
  {
    resource: 'cash_expense_requests',
    action: 'read',
    description: 'Ver solicitudes de egreso (propias o todas si es elevado)',
  },
  {
    resource: 'cash_expense_requests',
    action: 'approve',
    description: 'Aprobar solicitud de egreso (dueño/admin; sin movimiento hasta que el cajero registre egreso)',
  },
  {
    resource: 'cash_expense_requests',
    action: 'reject',
    description: 'Rechazar solicitud de egreso (dueño/admin)',
  },
  {
    resource: 'cash_expense_requests',
    action: 'cancel',
    description: 'Cancelar solicitud pendiente creada por uno mismo',
  },
  { resource: 'work_orders', action: 'read', description: 'Ver órdenes de trabajo' },
  {
    resource: 'work_orders',
    action: 'read_all',
    description: 'Ver todas las órdenes de trabajo (sin esto solo las creadas por el usuario)',
  },
  {
    resource: 'work_orders',
    action: 'read_portal',
    description:
      'Portal cliente: ver órdenes de vehículos del cliente enlazado al usuario (`portalCustomerId`); sin cola de taller ni alta de OT',
  },
  { resource: 'work_orders', action: 'create', description: 'Crear órdenes de trabajo' },
  { resource: 'work_orders', action: 'update', description: 'Actualizar órdenes de trabajo y estados' },
  {
    resource: 'work_orders',
    action: 'reassign',
    description: 'Reasignar una OT de un técnico a otro o dejarla sin asignar',
  },
  {
    resource: 'work_orders',
    action: 'set_terminal_status',
    description: 'Marcar orden como entregada o cancelada (estados finales)',
  },
  {
    resource: 'work_orders',
    action: 'record_payment',
    description: 'Registrar cobro de orden en caja (ingreso vinculado a la OT)',
  },
  {
    resource: 'work_orders',
    action: 'view_financials',
    description:
      'Ver importes en la orden (líneas, subtotal, saldo, tope, cobros) y fijar precios en líneas; caja y administración; no técnico',
  },
  {
    resource: 'work_orders',
    action: 'reopen_delivered',
    description: 'Reabrir una orden entregada para corregir importes (nota y justificación obligatorias)',
  },
  {
    resource: 'work_order_lines',
    action: 'create',
    description: 'Agregar líneas de repuesto o mano de obra a una OT abierta',
  },
  {
    resource: 'work_order_lines',
    action: 'update',
    description: 'Editar cantidad/precio/descripción de líneas de OT abierta',
  },
  {
    resource: 'work_order_lines',
    action: 'delete',
    description: 'Eliminar líneas de una OT abierta (repuesto devuelve stock)',
  },
  {
    resource: 'work_order_lines',
    action: 'set_unit_price',
    description:
      'Legado: fijar precio unitario en líneas de OT. En instalaciones nuevas se usa también `work_orders:view_financials`; el API acepta cualquiera de los dos. No técnico.',
  },
  { resource: 'customers', action: 'read', description: 'Ver clientes del taller' },
  { resource: 'customers', action: 'create', description: 'Crear clientes' },
  { resource: 'customers', action: 'update', description: 'Actualizar clientes' },
  { resource: 'vehicles', action: 'read', description: 'Ver vehículos e historial por vehículo' },
  { resource: 'vehicles', action: 'create', description: 'Registrar vehículos' },
  { resource: 'vehicles', action: 'update', description: 'Actualizar vehículos' },
  {
    resource: 'tax_rates',
    action: 'read',
    description: 'Ver catálogo de impuestos (IVA/INC) usados en OT y ventas',
  },
  {
    resource: 'tax_rates',
    action: 'create',
    description: 'Crear tarifas de impuesto nuevas (administrador/dueño)',
  },
  {
    resource: 'tax_rates',
    action: 'update',
    description: 'Actualizar tarifas de impuesto y activar/desactivar',
  },
  // -------- Fase 4 · Facturación electrónica DIAN (preparación) --------
  {
    resource: 'fiscal_resolutions',
    action: 'read',
    description: 'Ver resoluciones DIAN vigentes (rangos de numeración fiscal)',
  },
  {
    resource: 'fiscal_resolutions',
    action: 'manage',
    description:
      'Registrar, modificar y desactivar resoluciones DIAN (administración / dueño)',
  },
  {
    resource: 'invoices',
    action: 'read',
    description: 'Ver facturas emitidas y su estado en DIAN',
  },
  {
    resource: 'invoices',
    action: 'create',
    description: 'Generar factura a partir de una venta confirmada',
  },
  {
    resource: 'invoices',
    action: 'issue',
    description:
      'Emitir factura al proveedor DIAN (reintenta cola si está configurado; no-op si DIAN está apagado)',
  },
  {
    resource: 'invoices',
    action: 'void',
    description:
      'Anular factura en DRAFT (ISSUED ya aceptada por DIAN solo se corrige con nota crédito)',
  },
  {
    resource: 'invoices',
    action: 'record_payment',
    description:
      'Registrar cobro en caja directamente contra una factura (abono o liquidación; genera un ingreso 1:1)',
  },
  {
    resource: 'credit_notes',
    action: 'read',
    description: 'Ver notas crédito emitidas',
  },
  {
    resource: 'credit_notes',
    action: 'create',
    description: 'Emitir nota crédito contra una factura aceptada por DIAN',
  },
  {
    resource: 'credit_notes',
    action: 'issue',
    description:
      'Enviar la nota crédito al proveedor DIAN (DRAFT → ISSUED). Al aceptarse, reduce el saldo cobrable de la factura',
  },
  {
    resource: 'credit_notes',
    action: 'void',
    description:
      'Anular una nota crédito local (DRAFT o aceptada pero no utilizada). Queda en auditoría',
  },
  {
    resource: 'debit_notes',
    action: 'read',
    description: 'Ver notas débito emitidas',
  },
  {
    resource: 'debit_notes',
    action: 'create',
    description:
      'Emitir nota débito contra una factura para cargos adicionales (corrección de precio, interés, recargos)',
  },
  {
    resource: 'debit_notes',
    action: 'issue',
    description:
      'Enviar la nota débito al proveedor DIAN (DRAFT → ISSUED). Al aceptarse, incrementa el saldo cobrable y reabre cobro si la factura estaba saldada',
  },
  {
    resource: 'debit_notes',
    action: 'void',
    description: 'Anular una nota débito local (DRAFT o aceptada pero no cobrada). Queda en auditoría',
  },
  {
    resource: 'dian',
    action: 'manage_dispatch',
    description: 'Administrar la cola de envío a DIAN (reintentos, revisión manual)',
  },
  {
    resource: 'repuestos',
    action: 'read',
    description: 'Ver el catálogo de repuestos (autocompleta las líneas PART de la OT)',
  },
  {
    resource: 'repuestos',
    action: 'create',
    description: 'Crear repuestos en el catálogo',
  },
  {
    resource: 'repuestos',
    action: 'update',
    description: 'Editar repuestos del catálogo (SKU, nombre o precio sugerido)',
  },
  {
    resource: 'repuestos',
    action: 'delete',
    description: 'Eliminar repuestos del catálogo',
  },
];

/**
 * Códigos que el backend exige hoy (`@RequirePermissions` o comprobaciones explícitas como
 * `users:deactivate` en UsersController). Si falta alguno en `PERMISSIONS`, el seed falla
 * para que administrador/dueño no queden incompletos respecto al API.
 *
 * Al agregar una ruta nueva con permiso, sumalo aquí y en `PERMISSIONS`.
 */
const BACKEND_REQUIRED_PERMISSION_CODES: readonly string[] = [
  'auth:assume_role_preview',
  'audit:read',
  'cash_delegates:manage',
  'cash_expense_requests:approve',
  'cash_expense_requests:cancel',
  'cash_expense_requests:create',
  'cash_expense_requests:read',
  'cash_expense_requests:reject',
  'cash_movements:create_expense',
  'cash_movements:create_income',
  'cash_sessions:close',
  'cash_sessions:open',
  'cash_sessions:read',
  'customers:create',
  'customers:read',
  'customers:update',
  'permissions:read',
  'reports:read',
  'roles:create',
  'roles:delete',
  'roles:read',
  'roles:update',
  'settings:read',
  'settings:update',
  'tax_rates:create',
  'tax_rates:read',
  'tax_rates:update',
  'users:create',
  'users:deactivate',
  'users:read',
  'users:reset_password',
  'users:update',
  'vehicles:create',
  'vehicles:read',
  'vehicles:update',
  'work_order_lines:create',
  'work_order_lines:delete',
  'work_order_lines:set_unit_price',
  'work_order_lines:update',
  'work_orders:create',
  'work_orders:read',
  'work_orders:reassign',
  'work_orders:record_payment',
  'work_orders:view_financials',
  'work_orders:reopen_delivered',
  'work_orders:set_terminal_status',
  'work_orders:update',
  'fiscal_resolutions:read',
  'fiscal_resolutions:manage',
  'invoices:read',
  'invoices:create',
  'invoices:issue',
  'invoices:void',
  'invoices:record_payment',
  'credit_notes:read',
  'credit_notes:create',
  'credit_notes:issue',
  'credit_notes:void',
  'debit_notes:read',
  'debit_notes:create',
  'debit_notes:issue',
  'debit_notes:void',
  'dian:manage_dispatch',
  'repuestos:read',
  'repuestos:create',
  'repuestos:update',
  'repuestos:delete',
];

const CASH_CATEGORIES: Array<{
  slug: string;
  name: string;
  direction: CashMovementDirection;
  sortOrder: number;
}> = [
  {
    slug: 'compra_repuestos',
    name: 'Compra de repuestos',
    direction: CashMovementDirection.EXPENSE,
    sortOrder: 10,
  },
  {
    slug: 'pago_proveedor',
    name: 'Pago a proveedores',
    direction: CashMovementDirection.EXPENSE,
    sortOrder: 20,
  },
  {
    slug: 'gasto_menor',
    name: 'Gastos menores',
    direction: CashMovementDirection.EXPENSE,
    sortOrder: 30,
  },
  {
    slug: 'nomina_mecanicos',
    name: 'Pago de nómina · Mecánicos',
    direction: CashMovementDirection.EXPENSE,
    sortOrder: 40,
  },
  /**
   * Medios de pago operativos (Fase 8). `ingreso_cobro` queda como la categoría histórica /
   * efectivo genérico para compatibilidad con movimientos anteriores; las categorías por
   * medio de pago específico (transferencia, tarjeta, Nequi, Daviplata) permiten reportar
   * «Ventas por medio de pago» sin cambiar el modelo de Payment.
   */
  {
    slug: 'ingreso_cobro',
    name: 'Cobro en efectivo',
    direction: CashMovementDirection.INCOME,
    sortOrder: 40,
  },
  {
    slug: 'ingreso_transferencia',
    name: 'Cobro por transferencia bancaria',
    direction: CashMovementDirection.INCOME,
    sortOrder: 41,
  },
  {
    slug: 'ingreso_tarjeta',
    name: 'Cobro con tarjeta débito/crédito',
    direction: CashMovementDirection.INCOME,
    sortOrder: 42,
  },
  {
    slug: 'ingreso_nequi',
    name: 'Cobro por Nequi',
    direction: CashMovementDirection.INCOME,
    sortOrder: 43,
  },
  {
    slug: 'ingreso_daviplata',
    name: 'Cobro por Daviplata',
    direction: CashMovementDirection.INCOME,
    sortOrder: 44,
  },
  {
    slug: 'ingreso_otro',
    name: 'Otro ingreso',
    direction: CashMovementDirection.INCOME,
    sortOrder: 50,
  },
];

async function main() {
  const catalogCodes = new Set(PERMISSIONS.map((p) => `${p.resource}:${p.action}`));
  if (catalogCodes.size !== PERMISSIONS.length) {
    throw new Error('prisma/seed: PERMISSIONS tiene resource+action duplicados');
  }

  const missingInCatalog = BACKEND_REQUIRED_PERMISSION_CODES.filter((c) => !catalogCodes.has(c));
  if (missingInCatalog.length) {
    throw new Error(
      `prisma/seed: agrega a PERMISSIONS los códigos que usa el API: ${missingInCatalog.join(', ')}`,
    );
  }

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: {
        resource_action: { resource: p.resource, action: p.action },
      },
      create: p,
      update: { description: p.description },
    });
  }

  /**
   * Limpieza de permisos huérfanos: módulos eliminados en la simplificación (cotizaciones,
   * ventas, inventario, recepción/compras, nómina, finanzas taller, crédito empleados y
   * servicios). `RolePermission.permission` borra en cascada, así que los roles pierden
   * las asignaciones viejas automáticamente.
   */
  const REMOVED_PERMISSION_RESOURCES = [
    'employee_credits',
    'inventory_items',
    'measurement_units',
    'payroll',
    'purchase_receipts',
    'quote_lines',
    'quotes',
    'sale_lines',
    'sales',
    'services',
    'workshop_finance',
  ];
  await prisma.permission.deleteMany({
    where: { resource: { in: REMOVED_PERMISSION_RESOURCES } },
  });

  for (const c of CASH_CATEGORIES) {
    await prisma.cashMovementCategory.upsert({
      where: { slug: c.slug },
      create: {
        slug: c.slug,
        name: c.name,
        direction: c.direction,
        isSystem: true,
        sortOrder: c.sortOrder,
      },
      update: {
        name: c.name,
        direction: c.direction,
        sortOrder: c.sortOrder,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();

  const missingInDb = BACKEND_REQUIRED_PERMISSION_CODES.filter(
    (code) => !allPermissions.some((row) => `${row.resource}:${row.action}` === code),
  );
  if (missingInDb.length) {
    throw new Error(`prisma/seed: permisos requeridos no encontrados en DB: ${missingInDb.join(', ')}`);
  }

  /** Asigna al rol todas las filas actuales de `permission` (dueño/admin = catálogo completo). */
  async function grantAllCatalogPermissions(roleId: string) {
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.rolePermission.createMany({
      data: allPermissions.map((perm) => ({
        roleId,
        permissionId: perm.id,
      })),
      skipDuplicates: true,
    });
  }

  // --- Roles con alcance amplio: reciben la unión completa de permisos del catálogo ---
  const adminRole = await prisma.role.upsert({
    where: { slug: 'administrador' },
    create: {
      name: 'Administrador',
      slug: 'administrador',
      description: 'Control total del sistema',
      isSystem: true,
    },
    update: { name: 'Administrador', description: 'Control total del sistema' },
  });

  await grantAllCatalogPermissions(adminRole.id);

  const duenoRole = await prisma.role.upsert({
    where: { slug: 'dueno' },
    create: {
      name: 'Dueño',
      slug: 'dueno',
      description: 'Control total (mismo alcance que administrador)',
      isSystem: true,
    },
    update: { name: 'Dueño', description: 'Control total (mismo alcance que administrador)' },
  });
  await grantAllCatalogPermissions(duenoRole.id);

  const pick = (...codes: string[]) =>
    allPermissions.filter((p) => codes.includes(`${p.resource}:${p.action}`));

  // --- Roles operativos de caja: subconjuntos explícitos (sin cierre ni egresos salvo perfil autorizado) ---
  const cajeroCodes = [
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
    'work_order_lines:create',
    'work_order_lines:update',
    'work_order_lines:delete',
    'work_order_lines:set_unit_price',
    'work_orders:view_financials',
    'tax_rates:read',
    'repuestos:read',
    // Fase 4: caja puede ver facturas y generarlas desde una venta (ahora solo desde OT),
    // pero no gestiona resoluciones fiscales ni administra la cola DIAN (eso es dueño/admin).
    'fiscal_resolutions:read',
    'invoices:read',
    'invoices:create',
    'invoices:record_payment',
    'credit_notes:read',
    'debit_notes:read',
  ];
  const cajeroPerms = pick(...cajeroCodes);
  const cajeroRole = await prisma.role.upsert({
    where: { slug: 'cajero' },
    create: {
      name: 'Cajero',
      slug: 'cajero',
      description:
        'Caja y órdenes de taller: ingresos, apertura, solicitudes de egreso y OT; sin inventario, configuración, egreso directo ni cierre',
      isSystem: true,
    },
    update: {
      name: 'Cajero',
      description:
        'Caja y órdenes de taller: ingresos, apertura, solicitudes de egreso y OT; sin inventario, configuración, egreso directo ni cierre',
    },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: cajeroRole.id } });
  if (cajeroPerms.length) {
    await prisma.rolePermission.createMany({
      data: cajeroPerms.map((perm) => ({
        roleId: cajeroRole.id,
        permissionId: perm.id,
      })),
    });
  }

  const autorizadoCodes = [
    ...cajeroCodes,
    'cash_movements:create_expense',
  ];
  const autorizadoPerms = pick(...autorizadoCodes);
  const autorizadoRole = await prisma.role.upsert({
    where: { slug: 'cajero_autorizado' },
    create: {
      name: 'Cajero autorizado (egresos)',
      slug: 'cajero_autorizado',
      description:
        'Como cajero, más egresos delegados (máx. 3). Sin inventario ni configuración del taller.',
      isSystem: true,
    },
    update: {
      name: 'Cajero autorizado (egresos)',
      description:
        'Como cajero, más egresos delegados (máx. 3). Sin inventario ni configuración del taller.',
    },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: autorizadoRole.id } });
  if (autorizadoPerms.length) {
    await prisma.rolePermission.createMany({
      data: autorizadoPerms.map((perm) => ({
        roleId: autorizadoRole.id,
        permissionId: perm.id,
      })),
    });
  }

  /** Sin `read_all`: ve cola + asignadas a él + las que creó (reglas en `WorkOrdersService.workOrderVisibilityWhere`). */
  const mecanicoCodes = [
    'permissions:read',
    'settings:read',
    'work_orders:read',
    'work_orders:update',
    'work_order_lines:create',
    'work_order_lines:update',
    'work_order_lines:delete',
    'customers:read',
    'vehicles:read',
    'tax_rates:read',
    'repuestos:read',
  ];
  const mecanicoPerms = pick(...mecanicoCodes);
  const mecanicoRole = await prisma.role.upsert({
    where: { slug: 'mecanico' },
    create: {
      name: 'Mecánico',
      slug: 'mecanico',
      description:
        'Operación en taller: ver cola y órdenes asignadas, tomar OT, agregar líneas de trabajo (texto libre) y editar descripciones; no ve importes en la OT (precios, saldo, cobros) ni fija precios. Sin caja ni ver todas las OT del taller',
      isSystem: true,
    },
    update: {
      name: 'Mecánico',
      description:
        'Operación en taller: ver cola y órdenes asignadas, tomar OT, agregar líneas de trabajo (texto libre) y editar descripciones; no ve importes en la OT (precios, saldo, cobros) ni fija precios. Sin caja ni ver todas las OT del taller',
    },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: mecanicoRole.id } });
  if (mecanicoPerms.length) {
    await prisma.rolePermission.createMany({
      data: mecanicoPerms.map((perm) => ({
        roleId: mecanicoRole.id,
        permissionId: perm.id,
      })),
    });
  }

  /** Rol duplicado si hubo seed antes de alinear slugs con la migración `rename_tecnico_to_mecanico`. */
  const orphanTecnico = await prisma.role.findUnique({
    where: { slug: 'tecnico' },
    include: { _count: { select: { users: true } } },
  });
  if (orphanTecnico && orphanTecnico._count.users === 0) {
    await prisma.role.delete({ where: { id: orphanTecnico.id } });
  }

  const clientePortalCodes = ['work_orders:read_portal'];
  const clientePortalPerms = pick(...clientePortalCodes);
  const clienteRole = await prisma.role.upsert({
    where: { slug: 'cliente' },
    create: {
      name: 'Cliente (portal)',
      slug: 'cliente',
      description:
        'Consulta en línea: solo ve el estado de las órdenes de trabajo de su cuenta (enlace `portalCustomerId` en el usuario). Sin caja, inventario ni datos del resto del taller.',
      isSystem: true,
    },
    update: {
      name: 'Cliente (portal)',
      description:
        'Consulta en línea: solo ve el estado de las órdenes de trabajo de su cuenta (enlace `portalCustomerId` en el usuario). Sin caja, inventario ni datos del resto del taller.',
    },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: clienteRole.id } });
  if (clientePortalPerms.length) {
    await prisma.rolePermission.createMany({
      data: clientePortalPerms.map((perm) => ({
        roleId: clienteRole.id,
        permissionId: perm.id,
      })),
    });
  }

  // --- Usuario inicial y ajustes del taller (JSON flexible) ---
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@veneautos.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';
  const hash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: hash,
      fullName: 'Administrador Vene Autos',
      isActive: true,
    },
    update: {
      passwordHash: hash,
      fullName: 'Administrador Vene Autos',
      isActive: true,
    },
  });

  await prisma.userRole.deleteMany({
    where: { userId: adminUser.id, roleId: adminRole.id },
  });
  await prisma.userRole.create({
    data: { userId: adminUser.id, roleId: adminRole.id },
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'workshop.name' },
    create: {
      key: 'workshop.name',
      value: 'Vene Autos',
    },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'workshop.currency' },
    create: {
      key: 'workshop.currency',
      value: 'COP',
    },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'workshop.timezone' },
    create: {
      key: 'workshop.timezone',
      value: 'America/Bogota',
    },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'auth.session_idle_timeout_minutes' },
    create: { key: 'auth.session_idle_timeout_minutes', value: 10 },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'users.create_requires_dueno_role' },
    create: { key: 'users.create_requires_dueno_role', value: false },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'notes.min_length_chars' },
    create: { key: 'notes.min_length_chars', value: 50 },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'notes.min_length.work_order_payment' },
    create: { key: 'notes.min_length.work_order_payment', value: 70 },
    update: {},
  });

  await prisma.workshopSetting.upsert({
    where: { key: 'ui.panel_theme' },
    create: { key: 'ui.panel_theme', value: 'saas_light' },
    update: {},
  });

  /**
   * Catálogo inicial de impuestos colombianos.
   * - IVA 19% es el default para servicios/repuestos.
   * - IVA 5% y 0% se dejan listos para productos excluidos/exentos.
   * - INC 8% queda registrado pero inactivo: un taller responsable de IVA no causa INC salvo casos específicos.
   * Si cambia la regulación, se crean NUEVAS filas en vez de editar la tasa histórica.
   */
  const TAX_RATES: Array<{
    slug: string;
    name: string;
    kind: TaxRateKind;
    ratePercent: number;
    isActive: boolean;
    isDefault: boolean;
    sortOrder: number;
  }> = [
    { slug: 'iva_19', name: 'IVA 19%', kind: TaxRateKind.VAT, ratePercent: 19, isActive: true, isDefault: true, sortOrder: 10 },
    { slug: 'iva_5', name: 'IVA 5%', kind: TaxRateKind.VAT, ratePercent: 5, isActive: true, isDefault: false, sortOrder: 20 },
    { slug: 'iva_0', name: 'IVA 0% (exento)', kind: TaxRateKind.VAT, ratePercent: 0, isActive: true, isDefault: false, sortOrder: 30 },
    { slug: 'inc_8', name: 'INC 8% (impuesto al consumo)', kind: TaxRateKind.INC, ratePercent: 8, isActive: false, isDefault: false, sortOrder: 100 },
  ];
  for (const t of TAX_RATES) {
    await prisma.taxRate.upsert({
      where: { slug: t.slug },
      create: {
        slug: t.slug,
        name: t.name,
        kind: t.kind,
        ratePercent: t.ratePercent,
        isActive: t.isActive,
        isDefault: t.isDefault,
        sortOrder: t.sortOrder,
      },
      update: {
        name: t.name,
        kind: t.kind,
        ratePercent: t.ratePercent,
        sortOrder: t.sortOrder,
      },
    });
  }

  /**
   * Facturación electrónica DIAN — Fase 6 solo deja las claves listas (no envía aún).
   * `dian.enabled=false` → la app sigue operando normal (sin emisión).
   * Cuando se integre el proveedor (Facture/Alegra/otro), se cambian estas claves desde UI.
   */
  const DIAN_SETTINGS: Array<{ key: string; value: unknown }> = [
    { key: 'dian.enabled', value: false },
    { key: 'dian.provider', value: 'facture' },
    { key: 'dian.environment', value: 'sandbox' },
    { key: 'dian.emission_mode', value: 'async' },
    { key: 'dian.api_base_url', value: '' },
    { key: 'dian.api_token', value: '' },
    { key: 'dian.company_nit', value: '' },
    { key: 'dian.company_verification_digit', value: '' },
    { key: 'dian.resolution_number', value: '' },
    { key: 'dian.resolution_prefix', value: 'FV' },
    { key: 'dian.resolution_from', value: 1 },
    { key: 'dian.resolution_to', value: 1000 },
    { key: 'dian.resolution_valid_until', value: '' },
    { key: 'dian.test_set_id', value: '' },
  ];
  for (const s of DIAN_SETTINGS) {
    await prisma.workshopSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value as Prisma.InputJsonValue },
      update: {},
    });
  }

  /**
   * Fase 7.5 — Datos del taller para el encabezado de comprobantes imprimibles (OT y venta)
   * y el interruptor maestro de facturación electrónica. Mientras `billing.electronic_invoice_enabled`
   * sea `false`, la app opera en modo "persona natural": se entregan recibos internos al cliente
   * con la leyenda fiscal que corresponda según `workshop.regime`.
   */
  const BILLING_AND_WORKSHOP_SETTINGS: Array<{ key: string; value: unknown }> = [
    { key: 'billing.electronic_invoice_enabled', value: false },
    { key: 'workshop.legal_name', value: '' },
    { key: 'workshop.document_kind', value: 'CC' },
    { key: 'workshop.document_id', value: '' },
    { key: 'workshop.address', value: '' },
    { key: 'workshop.city', value: '' },
    { key: 'workshop.phone', value: '' },
    { key: 'workshop.email', value: '' },
    { key: 'workshop.regime', value: 'natural_no_obligado' },
    { key: 'workshop.receipt_footer', value: '' },
    /**
     * Fase 7.6 — Al cerrar sesión de caja, si `cash.arqueo_autoprint_enabled=true` el panel
     * abre solito la ventana del ticket de arqueo con `?autoprint=1`. Por defecto queda
     * en `false` para que el cajero decida cuándo imprimir.
     */
    { key: 'cash.arqueo_autoprint_enabled', value: false },
    /**
     * Fase 8 — Informe «Stock crítico»: un ítem activo con `trackStock=true` aparece en
     * el reporte cuando `quantityOnHand ≤ inventory.stock_critical_threshold`. Se expresa
     * en unidades enteras (ej. 3); se almacena como número para simplificar comparaciones.
     */
    { key: 'inventory.stock_critical_threshold', value: 3 },
  ];
  for (const s of BILLING_AND_WORKSHOP_SETTINGS) {
    await prisma.workshopSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value as Prisma.InputJsonValue },
      update: {},
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed OK. Admin:', adminEmail, '| Password:', adminPassword);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
