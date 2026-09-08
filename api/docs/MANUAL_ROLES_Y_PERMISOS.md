# Manual de roles y permisos (alineado con la base de datos)

Este documento describe cómo funcionan **roles** y **permisos** en Vene Autos y cómo crear roles útiles sin desalinearte del modelo que usa el API.

## 1. Modelo en base de datos

| Tabla | Uso |
|--------|-----|
| `permissions` | Catálogo global: cada fila es un permiso con `resource`, `action`, `description`. El código efectivo es **`resource` + `:` + `action`** (ej. `work_orders:read`). |
| `roles` | Rol del taller: `name`, `slug` único, `description`, `isSystem` (roles de sistema no se deben borrar desde reglas de negocio). |
| `role_permissions` | N:N entre `roles` y `permissions`. Solo importan **IDs de permisos que existan** en `permissions`. |

El JWT y los guards usan el código compuesto `recurso:acción`. Si asignás un permiso que **no existe** en `permissions`, el conteo en `RolesService` fallará al crear/actualizar rol; si el código no está cableado en el backend, la pantalla puede mostrar el rol pero **la ruta seguirá devolviendo 403**.

---

## 2. Fuente de verdad del catálogo

- **Catálogo visible en BD**: filas insertadas/actualizadas por la semilla **`api/prisma/seed.ts`**, array `PERMISSIONS`.
- **Comprobación dura**: el mismo archivo define `BACKEND_REQUIRED_PERMISSION_CODES`: son códigos que el API **usa hoy** en controladores o guards. Si falta alguno en `PERMISSIONS`, **el seed lanza error** para no dejar administrador/dueño incompletos.

Al agregar una ruta nueva con `@RequirePermissions` / `RequirePermissions`:

1. Sumar el permiso al array `PERMISSIONS` en `seed.ts`.
2. Sumar el código a `BACKEND_REQUIRED_PERMISSION_CODES` si el backend lo exige siempre.
3. Ejecutar migraciones/seed para que exista la fila en `permissions`.

Los roles **personalizados** del panel solo pueden combinar **IDs ya presentes** en `permissions` (los listados en Administración → Roles o vía `GET /permissions` si está expuesto).

---

## 3. Catálogo de permisos (`recurso:acción`)

Lista derivada de `PERMISSIONS` en `seed.ts` (orden lógico por dominio). La descripción breve es la que guarda la BD.

### Usuarios, roles y auth

| Código | Descripción (resumen) |
|--------|------------------------|
| `users:read` | Listar y ver usuarios |
| `users:create` | Crear usuarios |
| `users:update` | Actualizar usuarios |
| `users:deactivate` | Desactivar usuarios |
| `users:reset_password` | Restablecer contraseña de otro usuario (soporte) |
| `roles:read` | Ver roles y permisos asignados |
| `roles:create` | Crear roles |
| `roles:update` | Actualizar roles y permisos |
| `roles:delete` | Eliminar roles no sistema |
| `permissions:read` | Listar permisos del catálogo |
| `auth:assume_role_preview` | Probar el panel con permisos de otro rol (cuentas admin/dueño) |

### Auditoría, informes y configuración

| Código | Descripción (resumen) |
|--------|------------------------|
| `audit:read` | Consultar auditoría |
| `reports:read` | Ver informes económicos y operativos (agregados) |
| `settings:read` | Ver configuración del taller |
| `settings:update` | Modificar configuración del taller |

### Caja y delegados

| Código | Descripción (resumen) |
|--------|------------------------|
| `cash_sessions:read` | Ver sesiones y estado de caja |
| `cash_sessions:open` | Abrir sesión de caja |
| `cash_sessions:close` | Cerrar sesión de caja |
| `cash_movements:read` | Ver movimientos de caja |
| `cash_movements:create_income` | Registrar ingresos |
| `cash_movements:create_expense` | Registrar egresos (elevados / delegados) |
| `cash_delegates:manage` | Gestionar delegados de egreso (máx. 3) |
| `cash_expense_requests:create` | Crear solicitud de egreso |
| `cash_expense_requests:read` | Ver solicitudes de egreso |
| `cash_expense_requests:approve` | Aprobar solicitud |
| `cash_expense_requests:reject` | Rechazar solicitud |
| `cash_expense_requests:cancel` | Cancelar solicitud propia pendiente |

### Órdenes de trabajo y líneas

| Código | Descripción (resumen) |
|--------|------------------------|
| `work_orders:read` | Ver órdenes de trabajo |
| `work_orders:read_all` | Ver **todas** las OT (sin esto, reglas de visibilidad por usuario) |
| `work_orders:read_portal` | Portal cliente: solo OT del cliente vinculado |
| `work_orders:create` | Crear OT |
| `work_orders:update` | Actualizar OT y estados operativos |
| `work_orders:reassign` | Reasignar técnico / sin asignar |
| `work_orders:set_terminal_status` | Entregada / cancelada |
| `work_orders:record_payment` | Cobro de OT en caja |
| `work_orders:delete_payment` | Eliminar abonos de una OT abierta (no Entregada/Cancelada); borra el ingreso de caja vinculado, con nota y auditoría |
| `work_orders:view_financials` | Ver importes, líneas, tope, cobros; fijar precios |
| `work_orders:reopen_delivered` | Reabrir OT entregada |
| `work_order_lines:create` | Agregar líneas (repuesto / MO) |
| `work_order_lines:update` | Editar líneas |
| `work_order_lines:delete` | Eliminar líneas |
| `work_order_lines:set_unit_price` | Fijar precio unitario (legado; a menudo junto con `view_financials`) |

### Clientes, vehículos, inventario, unidades, compras

| Código | Descripción (resumen) |
|--------|------------------------|
| `customers:read` / `create` / `update` | ABM clientes |
| `vehicles:read` / `create` / `update` | ABM vehículos |
| `inventory_items:read` / `create` / `update` | Inventario repuestos |
| `measurement_units:read` | Unidades de medida |
| `purchase_receipts:read` / `create` | Recepción de compra |

### Impuestos y servicios

| Código | Descripción (resumen) |
|--------|------------------------|
| `tax_rates:read` / `create` / `update` | Tarifas IVA/INC |
| `services:read` / `create` / `update` | Catálogo de servicios (MO) |

### Ventas y líneas de venta

| Código | Descripción (resumen) |
|--------|------------------------|
| `sales:read` / `read_all` / `create` / `update` / `confirm` / `cancel` / `record_payment` / `view_financials` | Ciclo de vida ventas y cobros |
| `sale_lines:create` / `update` / `delete` | Líneas de venta borrador |

### Facturación electrónica y DIAN

| Código | Descripción (resumen) |
|--------|------------------------|
| `fiscal_resolutions:read` / `manage` | Resoluciones DIAN |
| `invoices:read` / `create` / `issue` / `void` / `record_payment` | Facturas |
| `credit_notes:read` / `create` / `issue` / `void` | Notas crédito |
| `debit_notes:read` / `create` / `issue` / `void` | Notas débito |
| `dian:manage_dispatch` | Cola de envío DIAN |

### Nómina

| Código | Descripción (resumen) |
|--------|------------------------|
| `payroll:read` | Ver panel y corridas |
| `payroll:calculate` | Calcular / recalcular / ajustes |
| `payroll:pay` | Ejecutar pago semanal |
| `payroll:configure` | % comisión por técnico |

---

## 4. Roles de sistema definidos en seed (referencia)

Estos **slugs** se recrean con `prisma db seed`. Conviven con roles custom; no reutilices slugs reservados si creás roles a mano en BD.

| Slug | Nombre | Alcance |
|------|--------|---------|
| `administrador` | Administrador | **Todos** los permisos del catálogo (`grantAllCatalogPermissions`). |
| `dueno` | Dueño | Igual que administrador. |
| `cajero` | Cajero | Subconjunto explícito: caja (sin cierre ni egreso directo), OT con `read_all`, ventas, facturas básicas desde caja, nómina read/calculate/pay, etc. Ver `cajeroCodes` en `seed.ts`. |
| `cajero_autorizado` | Cajero autorizado | `cajeroCodes` + `cash_movements:create_expense`. |
| `mecanico` | Mecánico | OT sin `read_all`, líneas, clientes/vehículos lectura, inventario/servicios lectura, `settings:read`, `payroll:read`. Ver `mecanicoCodes`. |
| `cliente` | Cliente (portal) | Solo `work_orders:read_portal`. |

**Nota:** El seed elimina el rol huérfano `tecnico` si existía sin usuarios (migración renombre a `mecanico`).

---

## 5. Guía breve: crear un rol que “sirva”

1. **No inventes códigos**: solo marcá permisos que ya existan en la tabla `permissions` (salida del seed o pantalla de permisos). IDs inexistentes → error al guardar.
2. **Pensá en tareas, no en nombres bonitos**: ej. “solo recepción de compra” ≈ `purchase_receipts:*` + lo mínimo de `inventory_items:read` + `cash_sessions:read` si hace falta contexto de caja (ajustá según política real).
3. **Visibilidad de datos**: muchas listas filtran por creador/asignado. Ejemplos:
   - Sin `work_orders:read_all`, un usuario con `work_orders:read` ve cola/asignadas/creadas por él (reglas en `WorkOrdersService`).
   - Igual idea en ventas con `sales:read_all`.
4. **Montos y fiscal**:
   - Ver cobros / precios en OT o ventas suele requerir `work_orders:view_financials` / `sales:view_financials` (y a veces `work_order_lines:set_unit_price` por compatibilidad).
   - Facturación DIAN y resoluciones: revisá el bloque fiscal arriba; no mezcles permisos “de más” si el taller no usa factura electrónica.
5. **Nómina**: `payroll:read` sin `calculate`/`pay`/`configure` deja vista acotada (según implementación actual de redacción en panel).
6. **Portal cliente**: el rol `cliente` es mínimo; usuarios portal necesitan `portalCustomerId` en usuario, no solo el permiso.
7. **Probar sin riesgo**: `auth:assume_role_preview` solo para cuentas que el negocio habilite; sirve para validar un rol nuevo antes de asignarlo.

---

## 6. Roles que no sirven (evitar)

- Permisos **huérfanos de flujo**: ej. `invoices:issue` sin `invoices:read` y sin configuración DIAN activa — el usuario ve errores o pantallas vacías.
- **Duplicar admin** con otro slug pero mismos 80 permisos sin documentar — mejor usar `dueno` / `administrador` y un rol operativo acotado.
- Dar **solo** `work_orders:update` sin `read` → no puede abrir listados coherentemente.
- Omitir `permissions:read` si el panel lo usa para hidratar checks (varios flujos del front asumen catálogo legible).

---

## 7. Mantenimiento

- Tras cambiar `PERMISSIONS` o roles en seed: **`npx prisma db seed`** (o el comando que usen en deploy).
- Para **nuevo permiso de API**: actualizar `seed.ts` + `BACKEND_REQUIRED_PERMISSION_CODES` + tests/guards; luego documentar aquí o en changelog interno.

---

*Última revisión alineada con `api/prisma/seed.ts` (arrays `PERMISSIONS`, `BACKEND_REQUIRED_PERMISSION_CODES` y bloques `*Codes` de roles).*
