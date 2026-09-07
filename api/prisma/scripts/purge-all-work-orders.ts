/**
 * Borra todas las órdenes de trabajo y datos colgantes (líneas, pagos, movimientos de caja).
 *
 * No modifica código ni esquema; solo datos.
 *
 * Uso (PowerShell):
 *   $env:PURGE_WORK_ORDERS_CONFIRM="YES"; npx ts-node --project tsconfig.scripts.json prisma/scripts/purge-all-work-orders.ts
 */
import { PrismaClient } from '@prisma/client';

const CASH_WORK_ORDER_REFERENCE_TYPE = 'WorkOrder';

async function main() {
  if (process.env.PURGE_WORK_ORDERS_CONFIRM !== 'YES') {
    console.error(
      'Refused: set PURGE_WORK_ORDERS_CONFIRM=YES to run (borra todas las OT, pagos asociados y movimientos de caja de OT).',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const beforeWo = await prisma.workOrder.count();
    const beforeLines = await prisma.workOrderLine.count();
    const beforePay = await prisma.workOrderPayment.count();

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.updateMany({ data: { parentWorkOrderId: null } });

      await tx.workOrderPayment.deleteMany({});

      await tx.cashMovement.deleteMany({
        where: { referenceType: CASH_WORK_ORDER_REFERENCE_TYPE },
      });

      await tx.workOrderLine.deleteMany({});
      await tx.workOrder.deleteMany({});

      await tx.$executeRawUnsafe(`
        SELECT setval(
          pg_get_serial_sequence('work_orders', 'order_number'),
          1,
          false
        )
      `);
    });

    console.log('Done.', {
      deletedWorkOrders: beforeWo,
      deletedLines: beforeLines,
      deletedPayments: beforePay,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});