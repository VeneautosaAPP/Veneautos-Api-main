-- Catálogo maestro de repuestos (mecánica «Autopiezas Tegui»).
-- SKU único normalizado en mayúsculas; `precio_venta` 0 = precio variable (se define en la OT).
-- Stock ilimitado por diseño: el stock es informativo, nunca valida ni descuenta existencias.

-- CreateTable
CREATE TABLE "repuestos" (
    "id" TEXT NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "nombre" VARCHAR(500) NOT NULL,
    "precio_venta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repuestos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repuestos_sku_key" ON "repuestos"("sku");

-- CreateIndex
CREATE INDEX "repuestos_nombre_idx" ON "repuestos"("nombre");

-- Snapshot del SKU en las líneas PART (null = repuesto en texto libre).
-- Copia estática: editar/borrar el catálogo no altera líneas ya emitidas.
ALTER TABLE "work_order_lines" ADD COLUMN "spare_part_sku" VARCHAR(80);

-- Regla de negocio (acordada con el dueño): los repuestos son PRECIO FINAL sin IVA,
-- igual a Autopiezas Tegui. Se quita el impuesto a las líneas PART ya existentes
-- (el IVA cobrado en OT ya facturadas queda intacto en las líneas de factura, que
-- guardan su propio snapshot).
UPDATE "work_order_lines"
SET "tax_rate_id" = NULL,
    "tax_rate_percent_snapshot" = NULL
WHERE "line_type" = 'PART'
  AND ("tax_rate_id" IS NOT NULL OR "tax_rate_percent_snapshot" IS NOT NULL);

-- Permisos del catálogo de repuestos.
INSERT INTO "permissions" ("id", "resource", "action", "description")
VALUES
  ('perm_repuestos_read',   'repuestos', 'read',   'Ver el catálogo de repuestos'),
  ('perm_repuestos_create', 'repuestos', 'create', 'Crear repuestos en el catálogo'),
  ('perm_repuestos_update', 'repuestos', 'update', 'Editar repuestos del catálogo'),
  ('perm_repuestos_delete', 'repuestos', 'delete', 'Eliminar repuestos del catálogo')
ON CONFLICT ("resource", "action") DO NOTHING;

-- Otorgamientos por rol:
--   administrador/dueno → catálogo completo (igual que el resto del sistema).
--   cajero/cajero_autorizado/mecanico → solo lectura (los necesitan al cargar líneas PART en la OT).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p."resource" = 'repuestos'
  AND (
    (r."slug" IN ('administrador', 'dueno') AND p."action" IN ('read', 'create', 'update', 'delete'))
    OR (r."slug" IN ('cajero', 'cajero_autorizado', 'mecanico') AND p."action" = 'read')
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;