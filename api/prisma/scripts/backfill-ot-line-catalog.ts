/**
 * Backfill del diccionario de líneas de OT (`ot_line_catalog`) desde las líneas históricas.
 * Ejecutar una sola vez tras la migración `20260904000000_remove_obsolete_modules` para que
 * el autocompletado tenga sugerencias desde el primer uso:
 *
 *   npm run prisma:backfill-ot-line-catalog
 *
 * Idempotente: las etiquetas ya existentes solo actualizan `last_used_at`.
 */
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl?.trim()) {
  throw new Error('Definí DATABASE_URL en .env (y DIRECT_URL en Supabase/pooler).');
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

async function main() {
  const result = await prisma.$executeRaw`
    INSERT INTO ot_line_catalog (id, label, last_used_at, created_at, updated_at)
    SELECT md5(trim(description)), trim(description),
           max(created_at), now(), now()
    FROM work_order_lines
    WHERE description IS NOT NULL AND trim(description) <> ''
    GROUP BY trim(description)
    ON CONFLICT (label) DO UPDATE SET last_used_at = EXCLUDED.last_used_at
  `;
  const total = await prisma.otLineCatalog.count();
  // eslint-disable-next-line no-console
  console.log(
    `Backfill OK. Filas afectadas: ${result}. Etiquetas totales en el diccionario: ${total}`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });