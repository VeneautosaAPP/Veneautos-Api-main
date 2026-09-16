/**
 * Una sola ejecución: pasa a MAYÚSCULA el texto operativo ya guardado, para que la base quede
 * igual a lo que el usuario ve y escribe en el panel (`text-transform: uppercase`).
 *
 *   cd api
 *   npx prisma generate
 *   npm run prisma:uppercase-text -- --dry-run   # informe, no escribe
 *   npm run prisma:uppercase-text -- --apply     # escribe
 *
 * Recomendación: `npm run db:backup:local` antes de `--apply` (el cambio no se deshace solo).
 *
 * Excluye a propósito: emails, contraseñas/hashes, códigos y llaves (sku, slug, publicCode,
 * documentNumber, cufe, technicalKey), firmas en base64 y snapshots legales. Esos campos o son
 * credenciales, o se comparan por código, o se rompen al cambiarles la caja.
 */
import { PrismaClient } from '@prisma/client';

type Target = { model: string; fields: string[] };

const TARGETS: Target[] = [
  { model: 'customer', fields: ['displayName', 'notes'] },
  { model: 'vehicle', fields: ['plate', 'plateNorm', 'vin', 'brand', 'model', 'color', 'notes'] },
  {
    model: 'workOrder',
    fields: [
      'description',
      'customerName',
      'vehiclePlate',
      'vehicleBrand',
      'vehicleModel',
      'vehicleLine',
      'vehicleColor',
      'vehicleNotes',
      'internalNotes',
    ],
  },
  { model: 'workOrderLine', fields: ['description'] },
  { model: 'otLineCatalog', fields: ['label'] },
  { model: 'sparePart', fields: ['name'] },
  { model: 'taxRate', fields: ['name'] },
  { model: 'cashMovement', fields: ['note'] },
  { model: 'cashExpenseRequest', fields: ['note', 'rejectionReason', 'approvalNote'] },
  { model: 'cashSession', fields: ['differenceNote'] },
  { model: 'workOrderPayment', fields: ['note'] },
  { model: 'invoice', fields: ['customerName', 'internalNotes', 'voidedReason'] },
  { model: 'invoiceLine', fields: ['description'] },
  { model: 'creditNote', fields: ['reasonDescription', 'voidedReason'] },
  { model: 'creditNoteLine', fields: ['description'] },
  { model: 'debitNote', fields: ['reasonDescription', 'voidedReason'] },
  { model: 'debitNoteLine', fields: ['description'] },
  { model: 'role', fields: ['name', 'description'] },
  { model: 'fiscalResolution', fields: ['notes'] },
  { model: 'user', fields: ['fullName'] },
];

type Delegate = {
  findMany: (args: { select: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};

async function uppercaseFields(
  prisma: PrismaClient,
  target: Target,
  apply: boolean,
): Promise<{ changed: number; conflicts: number }> {
  const delegate = (prisma as unknown as Record<string, Delegate>)[target.model];
  if (!delegate) throw new Error(`Modelo inexistente en el cliente Prisma: ${target.model}`);

  const select: Record<string, boolean> = { id: true };
  for (const field of target.fields) select[field] = true;

  const rows = await delegate.findMany({ select });
  let changed = 0;
  let conflicts = 0;

  for (const row of rows) {
    const patch: Record<string, unknown> = {};
    for (const field of target.fields) {
      const raw = row[field];
      if (typeof raw !== 'string' || raw.length === 0) continue;
      const next = raw.toUpperCase();
      if (next !== raw) patch[field] = next;
    }
    if (Object.keys(patch).length === 0) continue;
    changed += 1;
    if (!apply) continue;
    try {
      await delegate.update({ where: { id: row.id as string }, data: patch });
    } catch (err) {
      // Típico: índice único (dos registros que solo difieren por caja). Se reporta y sigue.
      conflicts += 1;
      // eslint-disable-next-line no-console
      console.warn(`  ! ${target.model} ${String(row.id)}: ${(err as Error).message}`);
    }
  }

  return { changed, conflicts };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run') || !apply;

  // eslint-disable-next-line no-console
  console.log(
    dryRun
      ? 'MODO INFORME (--dry-run): no se escribe nada. Con --apply se aplican los cambios.'
      : 'APLICANDO cambios en la base de datos…',
  );

  const prisma = new PrismaClient();
  let totalChanged = 0;
  let totalConflicts = 0;

  try {
    for (const target of TARGETS) {
      const { changed, conflicts } = await uppercaseFields(prisma, target, !dryRun);
      totalChanged += changed;
      totalConflicts += conflicts;
      // eslint-disable-next-line no-console
      console.log(
        `  ${target.model.padEnd(20)} ${changed} registro(s) a actualizar${
          conflicts ? ` · ${conflicts} conflicto(s)` : ''
        }`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(
    dryRun
      ? `Total: ${totalChanged} registro(s) cambiarían. ${totalConflicts} conflicto(s) previsto(s).`
      : `Total: ${totalChanged} registro(s) actualizados. ${totalConflicts} conflicto(s).`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
