import * as path from 'path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(__dirname, '../.env'), quiet: true });

import { ConflictException } from '@nestjs/common';
import {
  CashExpenseRequestStatus,
  CashMovementDirection,
  CashSessionStatus,
} from '@prisma/client';
import { NotesPolicyService } from '../src/common/notes-policy/notes-policy.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CashAccessService } from '../src/modules/cash/cash-access.service';
import { CashExpenseRequestsService } from '../src/modules/cash/cash-expense-requests.service';
import { CashMovementsService } from '../src/modules/cash/cash-movements.service';
import { CashSessionsService } from '../src/modules/cash/cash-sessions.service';
import { SettingsService } from '../src/modules/settings/settings.service';

const audit = { recordDomain: async () => undefined };
const receiptsStub = { invalidateWorkshopInfoCache: () => undefined };

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const notes = new NotesPolicyService(prisma);
  const access = new CashAccessService(prisma);
  const sessions = new CashSessionsService(prisma, audit as never, notes);
  const movements = new CashMovementsService(prisma, audit as never, access, notes);
  const requests = new CashExpenseRequestsService(prisma, audit as never, access, notes);
  const settings = new SettingsService(prisma, audit as never, receiptsStub as never);

  const adminMembership = await prisma.userRole.findFirst({
    where: { role: { slug: 'administrador' }, user: { isActive: true } },
    select: { userId: true },
  });
  if (!adminMembership) throw new Error('Falta rol administrador en BD local');
  const actorId = adminMembership.userId;
  const actorMeta = { ip: '127.0.0.1', userAgent: 'fase1-verify' };

  const report: string[] = [];

  // ---- F1.2: open -> createIncome -> createExpense -> close (arqueo incluye movs) ----
  let session = await prisma.cashSession.findFirst({
    where: { status: CashSessionStatus.OPEN },
  });
  if (!session) {
    session = await sessions.open(
      actorId,
      { openingAmount: '100000', note: 'Apertura de verificacion funcional de fase 1 (caja integral)' },
      actorMeta,
    );
    report.push(`OPEN: creó sesión ${session.id}`);
  } else {
    report.push(`OPEN: reutilizó sesión existente ${session.id}`);
  }
  const sessionId = session.id;

  const incomeCategory = await prisma.cashMovementCategory.findFirst({
    where: { direction: CashMovementDirection.INCOME },
  });
  const expenseCategory = await prisma.cashMovementCategory.findFirst({
    where: { direction: CashMovementDirection.EXPENSE },
  });
  if (!incomeCategory || !expenseCategory) throw new Error('Faltan categorías de caja');

  const inc = await movements.createIncome(actorId, {
    categorySlug: incomeCategory.slug,
    amount: '250000',
    note: 'Ingreso de verificacion de fase 1 para ejercicio funcional completo de caja',
  }, actorMeta);
  const exp = await movements.createExpense(actorId, {
    categorySlug: expenseCategory.slug,
    amount: '40000',
    note: 'Egreso de verificacion de fase 1 para ejercicio funcional completo de caja',
  }, actorMeta);
  report.push(`MOVEMENTS: ingreso ${inc.amount} y egreso ${exp.amount} en ${sessionId}`);

  const sessionWithMovs = await prisma.cashSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { movements: { select: { direction: true, amount: true } } },
  });
  const sum = sessionWithMovs.movements.reduce((acc, m) => acc.add(m.direction === CashMovementDirection.INCOME ? m.amount : m.amount.negated()), sessionWithMovs.openingAmount);
  const closed = await sessions.close(sessionId, actorId, { closingCounted: sum.toFixed(0) }, actorMeta);
  report.push(`CLOSE: esperado ${sum.toFixed(0)} = contado; estado ${closed.status}`);

  // ---- F1.3: payOut concurrente doble => 1 éxito + 1 Conflict, un solo movimiento ----
  const secondSession = await sessions.open(
    actorId,
    { openingAmount: '100000', note: 'Apertura de verificacion funcional de fase 1 (payOut race)' },
    actorMeta,
  );
  report.push(`OPEN 2: sesión ${secondSession.id} para prueba payOut`);

  const req = await prisma.cashExpenseRequest.create({
    data: {
      status: CashExpenseRequestStatus.APPROVED,
      categoryId: expenseCategory.id,
      amount: '50000',
      note: 'Solicitud de egreso de prueba de serializacion en fase 1',
      requestedById: actorId,
      reviewedById: actorId,
      approvalNote: 'Aprobada para verificacion de fase 1',
    },
  });

  const outcomes = await Promise.allSettled([
    requests.payOut(actorId, req.id, actorMeta),
    requests.payOut(actorId, req.id, actorMeta),
  ]);
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled').length;
  const conflicted = outcomes.filter(
    (o) => o.status === 'rejected' && (o.reason as Error) instanceof ConflictException,
  ).length;
  const reqMovements = await prisma.cashMovement.count({
    where: { referenceId: req.id },
  });
  report.push(
    `PAYOUT RACE: éxito=${fulfilled}, conflict=${conflicted}, movimientos del request=${reqMovements} (debe ser 1/1/1)`,
  );

  // ---- F1.5: settings.patch atómico ----
  const phoneKey = 'workshop.phone';
  const before = await prisma.workshopSetting.findUnique({ where: { key: phoneKey } });
  const originalPhone = before?.value ?? null;
  await settings.patch({ [phoneKey]: '555-0101' }, actorId, actorMeta);
  const after = await prisma.workshopSetting.findUnique({ where: { key: phoneKey } });
  report.push(`SETTINGS PATCH: valor ahora "${after?.value}" (era "${originalPhone}")`);
  if (originalPhone !== null) {
    await settings.patch({ [phoneKey]: originalPhone }, actorId, actorMeta);
  }

  await prisma.$disconnect();
  console.log(report.join('\n'));
}

main().catch((err) => {
  console.error('VERIFY-FASE1 FALLO:', err);
  process.exit(1);
});