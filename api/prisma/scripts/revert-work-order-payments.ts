/**
 * Reverso PUNTUAL de los cobros de una orden (para Ã³rdenes que quedaron con cobro antes de
 * que la reapertura/cancelaciÃ³n lo hiciera automÃ¡tico).
 *
 * Genera un egreso espejo por cada cobro en la sesiÃ³n de caja ABIERTA y borra el cobro, asÃ­
 * la orden vuelve a deber y la caja queda compensada. El ingreso original NO se borra (caja
 * es append-only): queda el histÃ³rico + el contra-asiento en la sesiÃ³n vigente.
 *
 * Uso:
 *   npx ts-node --project tsconfig.scripts.json prisma/scripts/revert-work-order-payments.ts <nroOrden> [SI]
 *
 * - Sin "SI": sÃ³lo imprime el plan (no toca nada).
 * - Con  "SI": ejecuta y deja auditorÃ­a (`work_orders.payments_reversed_manual`).
 *
 * Requiere una sesiÃ³n de caja abierta si la orden tiene cobros.
 */
import { CashMovementDirection, CashSessionStatus, Prisma, PrismaClient } from '@prisma/client'

const CATEGORY_SLUG = 'reverso_cobro_ot'
const CATEGORY_NAME = 'Reverso de cobro Â· OT reabierta'
const ADMIN_EMAIL = 'admin@veneautos.local'

const prisma = new PrismaClient()

async function main() {
  const rawOrder = process.argv[2]
  const apply = (process.argv[3] ?? '').toUpperCase() === 'SI'
  const orderNumber = Number(rawOrder)
  if (!Number.isFinite(orderNumber)) {
    throw new Error('IndicÃ¡ el nÃºmero de orden, ej: ... revert-work-order-payments.ts 309 SI')
  }

  const wo = await prisma.workOrder.findFirst({
    where: { orderNumber },
    select: { id: true, orderNumber: true, publicCode: true, status: true },
  })
  if (!wo) throw new Error(`No existe la orden ${orderNumber}`)

  const payments = await prisma.workOrderPayment.findMany({
    where: { workOrderId: wo.id },
    select: { id: true, kind: true, amount: true, createdAt: true },
  })

  console.log(`\nOT ${wo.orderNumber}${wo.publicCode ? ` (${wo.publicCode})` : ''} â€” estado: ${wo.status}`)
  if (payments.length === 0) {
    console.log('No tiene cobros: nada que revertir.')
    return
  }

  let total = new Prisma.Decimal(0)
  for (const p of payments) {
    console.log(`  Â· ${p.kind} $${p.amount.toString()} (${p.createdAt.toISOString().slice(0, 10)})`)
    total = total.plus(p.amount)
  }
  console.log(`Total a revertir: $${total.toString()}`)

  if (!apply) {
    console.log('\n[MODO PLAN] Para ejecutar agregÃ¡ "SI" al final.\n')
    return
  }

  const admin = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  })
  if (!admin) {
    throw new Error(`No existe el usuario ${ADMIN_EMAIL}; corré el seed (npm run prisma:seed).`)
  }

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "work_orders" WHERE id = ${wo.id} FOR UPDATE`

      const current = await tx.workOrderPayment.findMany({
        where: { workOrderId: wo.id },
        select: { id: true, kind: true, amount: true },
      })
      if (current.length === 0) return { reversed: [], total: '0' }

      await tx.$queryRaw`SELECT 1 FROM "cash_sessions" WHERE status::text = ${CashSessionStatus.OPEN} ORDER BY "created_at" ASC LIMIT 1 FOR UPDATE`
      const session = await tx.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
        select: { id: true, openedAt: true },
      })
      if (!session) {
        throw new Error(
          `No hay sesiÃ³n de caja abierta: hay $${current.reduce((a, p) => a.plus(p.amount), new Prisma.Decimal(0)).toString()} cobrados para revertir. AbrÃ­ la caja y volvÃ© a intentar.`,
        )
      }

      const category = await tx.cashMovementCategory.upsert({
        where: { slug: CATEGORY_SLUG },
        update: {},
        create: {
          slug: CATEGORY_SLUG,
          name: CATEGORY_NAME,
          direction: CashMovementDirection.EXPENSE,
          sortOrder: 50,
        },
      })

      const reversed: Array<{ paymentId: string; amount: string; reversalMovementId: string }> = []
      let sum = new Prisma.Decimal(0)
      for (const p of current) {
        const mv = await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            categoryId: category.id,
            direction: CashMovementDirection.EXPENSE,
            amount: p.amount,
            referenceType: 'WorkOrder',
            referenceId: wo.id,
            note: `Reverso manual de cobros de la OT #${wo.orderNumber}${wo.publicCode ? ` (${wo.publicCode})` : ''}: se devuelve el cobro registrado.`,
            createdById: admin.id,
          },
          select: { id: true },
        })
        await tx.workOrderPayment.delete({ where: { id: p.id } })
        reversed.push({ paymentId: p.id, amount: p.amount.toString(), reversalMovementId: mv.id })
        sum = sum.plus(p.amount)
      }
      return { reversed, total: sum.toString(), sessionOpenedAt: session.openedAt }
    },
    { maxWait: 5000, timeout: 15_000 },
  )

  if (result.reversed.length === 0) {
    console.log('\nLa orden ya no tenÃ­a cobros (alguien los revirtiÃ³ antes).')
    return
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: admin?.id ?? null,
      action: 'work_orders.payments_reversed_manual',
      entityType: 'WorkOrder',
      entityId: wo.id,
      previousPayload: { status: wo.status, payments: result.reversed.length },
      nextPayload: { reversedPayments: result.reversed, reversedTotal: result.total },
    },
  })

  console.log(`\nâœ” Reverso aplicado (sesiÃ³n abierta del ${String(result.sessionOpenedAt).slice(0, 10)}):`)
  for (const r of result.reversed) {
    console.log(`  Â· egreso ${r.reversalMovementId} por $${r.amount}`)
  }
  console.log(`La orden ${wo.publicCode ?? `#${wo.orderNumber}`} vuelve a deber; estado intacto: ${wo.status}.\n`)
}

main()
  .catch((e) => {
    console.error('\nâœ– ERROR:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
