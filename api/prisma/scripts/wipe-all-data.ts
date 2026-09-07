/**
 * Vacía todas las tablas de datos de la app (PostgreSQL), conservando el esquema y `_prisma_migrations`.
 * Destructivo: usuarios, clientes, OT, inventario, facturación, caja, etc.
 *
 * Uso (PowerShell):
 *   $env:WIPE_ALL_DATA_CONFIRM="YES"; npx ts-node --project tsconfig.scripts.json prisma/scripts/wipe-all-data.ts
 *
 * Después: `npm run prisma:seed` para volver a crear permisos, roles, admin y catálogos base.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/** Tablas `@@map` del schema; no incluir `_prisma_migrations`. */
const TABLES = [
  'audit_logs',
  'cash_expense_delegates',
  'cash_expense_requests',
  'cash_movement_categories',
  'cash_movements',
  'cash_sessions',
  'credit_note_lines',
  'credit_notes',
  'customers',
  'debit_note_lines',
  'debit_notes',
  'fiscal_resolutions',
  'invoice_dispatch_events',
  'invoice_lines',
  'invoice_payments',
  'invoices',
  'ot_line_catalog',
  'permissions',
  'role_permissions',
  'roles',
  'tax_rates',
  'user_auth_sessions',
  'user_roles',
  'users',
  'vehicles',
  'work_order_lines',
  'work_order_payments',
  'work_orders',
  'workshop_settings',
  'workshop_counters',
].sort();

async function main() {
  if (process.env.WIPE_ALL_DATA_CONFIRM?.trim() !== 'YES') {
    console.error('Refused: set WIPE_ALL_DATA_CONFIRM=YES');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const quoted = TABLES.map((t) => `"${t.replace(/"/g, '""')}"`).join(',\n  ');
    const sql = `TRUNCATE TABLE\n  ${quoted}\nRESTART IDENTITY CASCADE`;
    await prisma.$executeRawUnsafe(sql);
    console.log(`Truncated ${TABLES.length} tables. Schema and _prisma_migrations unchanged.`);
    console.log('Run: npm run prisma:seed');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
