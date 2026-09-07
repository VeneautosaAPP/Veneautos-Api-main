/**
 * Ciclo de vida de sesiones de caja: apertura, consulta y cierre con arqueo.
 *
 * Al cerrar se recalcula el saldo esperado (apertura + ingresos − egresos) y se compara con
 * el conteo físico; si difiere, se exige nota explicativa para dejar constancia operativa.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CashMovementDirection, CashSessionStatus, Prisma } from '@prisma/client';
import { ceilWholeCop, decimalFromMoneyApiString } from '../../common/money/cop-money';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CASH_EXPENSE_REQUEST_REFERENCE_TYPE,
  CASH_INVOICE_REFERENCE_TYPE,
  CASH_WORK_ORDER_REFERENCE_TYPE,
} from './cash.constants';
import type { CloseCashSessionDto } from './dto/close-cash-session.dto';
import type { OpenCashSessionDto } from './dto/open-cash-session.dto';

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notes: NotesPolicyService,
  ) {}

  /** Solo indica si existe sesión OPEN (cualquier usuario autenticado; sin montos ni movimientos). */
  async getOpenStatus(): Promise<{ open: boolean }> {
    const row = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      select: { id: true },
    });
    return { open: !!row };
  }

  /** Sesión abierta con movimientos ordenados cronológicamente, o `null` si no hay ninguna. */
  async getCurrentOpen() {
    const row = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      include: {
        openedBy: { select: { id: true, email: true, fullName: true } },
        movements: {
          orderBy: { createdAt: 'asc' },
          include: {
            category: true,
            createdBy: { select: { id: true, email: true, fullName: true } },
          },
        },
      },
    });
    if (!row) {
      return null;
    }
    return this.withBalanceSummary(row);
  }

  /** Historial reciente de sesiones (abiertas y cerradas) para consulta administrativa. */
  async listRecent(take = 20) {
    return this.prisma.cashSession.findMany({
      take,
      orderBy: { openedAt: 'desc' },
      include: {
        openedBy: { select: { id: true, email: true, fullName: true } },
        closedBy: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  /** Detalle de una sesión por id, con movimientos; lanza 404 si no existe. */
  async findOne(id: string) {
    const s = await this.prisma.cashSession.findUnique({
      where: { id },
      include: {
        openedBy: { select: { id: true, email: true, fullName: true } },
        closedBy: { select: { id: true, email: true, fullName: true } },
        movements: {
          orderBy: { createdAt: 'asc' },
          include: {
            category: true,
            createdBy: { select: { id: true, email: true, fullName: true } },
          },
        },
      },
    });
    if (!s) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }
    return this.withBalanceSummary(s);
  }

  /**
   * Saldo teórico = apertura + ingresos − egresos (misma fórmula que al cerrar con arqueo).
   * Se expone en JSON para el panel sin recalcular en el cliente.
   */
  private computeExpectedBalance(
    openingAmount: Prisma.Decimal,
    movements: { direction: CashMovementDirection; amount: Prisma.Decimal }[],
  ): { totalIncome: Prisma.Decimal; totalExpense: Prisma.Decimal; expected: Prisma.Decimal } {
    let income = new Prisma.Decimal(0);
    let expense = new Prisma.Decimal(0);
    for (const m of movements) {
      if (m.direction === CashMovementDirection.INCOME) {
        income = income.add(m.amount);
      } else {
        expense = expense.add(m.amount);
      }
    }
    const expected = openingAmount.add(income).sub(expense);
    return { totalIncome: income, totalExpense: expense, expected };
  }

  private withBalanceSummary<
    T extends {
      openingAmount: Prisma.Decimal;
      movements: {
        direction: CashMovementDirection;
        amount: Prisma.Decimal;
        referenceType?: string | null;
      }[];
    },
  >(session: T) {
    const { totalIncome, totalExpense, expected } = this.computeExpectedBalance(
      session.openingAmount,
      session.movements,
    );
    return {
      ...session,
      balanceSummary: {
        totalIncome: ceilWholeCop(totalIncome).toString(),
        totalExpense: ceilWholeCop(totalExpense).toString(),
        expectedBalance: ceilWholeCop(expected).toString(),
        movementCount: session.movements.length,
        byReferenceType: this.summarizeByReferenceType(session.movements),
      },
    };
  }

  /**
   * Fase 6 · Desglose del arqueo por tipo de documento origen del movimiento.
   * Incluye explícitamente `Invoice` (cobros en caja de facturación, Fase 5)
   * para que el cierre reconozca esta fuente de ingreso sin mezclarla con
   * otros rubros.
   */
  private summarizeByReferenceType(
    movements: {
      direction: CashMovementDirection;
      amount: Prisma.Decimal;
      referenceType?: string | null;
    }[],
  ): Array<{
    referenceType: string;
    label: string;
    incomeTotal: string;
    expenseTotal: string;
    count: number;
  }> {
    const labels: Record<string, string> = {
      [CASH_EXPENSE_REQUEST_REFERENCE_TYPE]: 'Solicitud de egreso',
      [CASH_WORK_ORDER_REFERENCE_TYPE]: 'Orden de trabajo',
      [CASH_INVOICE_REFERENCE_TYPE]: 'Factura',
      // Etiquetas legacy: movimientos históricos que referencian documentos eliminados
      // (ventas y recepciones de compra) conservan su desglose en el arqueo archivado.
      Sale: 'Venta',
      PurchaseReceipt: 'Recepción de compra',
      MANUAL: 'Manual / otros',
    };
    const agg = new Map<
      string,
      { income: Prisma.Decimal; expense: Prisma.Decimal; count: number }
    >();
    for (const m of movements) {
      const key = m.referenceType ?? 'MANUAL';
      let bucket = agg.get(key);
      if (!bucket) {
        bucket = { income: new Prisma.Decimal(0), expense: new Prisma.Decimal(0), count: 0 };
        agg.set(key, bucket);
      }
      if (m.direction === CashMovementDirection.INCOME) {
        bucket.income = bucket.income.add(m.amount);
      } else {
        bucket.expense = bucket.expense.add(m.amount);
      }
      bucket.count += 1;
    }
    return [...agg.entries()].map(([key, b]) => ({
      referenceType: key,
      label: labels[key] ?? key,
      incomeTotal: ceilWholeCop(b.income).toString(),
      expenseTotal: ceilWholeCop(b.expense).toString(),
      count: b.count,
    }));
  }

  /**
   * Abre una nueva sesión si no hay otra OPEN. El monto de apertura debe ser estrictamente positivo.
   * Tras migración `hardening_cash_one_open_session`, la BD también impide dos OPEN (índice único parcial).
   */
  async open(actorUserId: string, dto: OpenCashSessionDto, meta: { ip?: string; userAgent?: string }) {
    const existing = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
    });
    if (existing) {
      throw new ConflictException('Ya existe una sesión de caja abierta');
    }

    const openingAmount = decimalFromMoneyApiString(dto.openingAmount);
    if (openingAmount.lte(0)) {
      throw new BadRequestException('El monto de apertura debe ser mayor a cero');
    }

    const openingNote = await this.notes.requireOperationalNote('Nota de apertura de caja', dto.note);

    let session;
    try {
      session = await this.prisma.cashSession.create({
        data: {
          status: CashSessionStatus.OPEN,
          openedById: actorUserId,
          openingAmount,
        },
      });
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ya existe una sesión de caja abierta');
      }
      throw err;
    }

    await this.audit.recordDomain({
      actorUserId,
      action: 'cash_sessions.open',
      entityType: 'CashSession',
      entityId: session.id,
      previousPayload: null,
      nextPayload: { openingAmount: dto.openingAmount, note: openingNote },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.findOne(session.id);
  }

  /**
   * Cierra la sesión: persiste esperado, contado y nota de diferencia si aplica.
   * Quién puede invocarlo lo define el permiso `cash_sessions:close` (en seed, roles elevados).
   */
  async close(
    sessionId: string,
    actorUserId: string,
    dto: CloseCashSessionDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const counted = decimalFromMoneyApiString(dto.closingCounted);
    if (counted.lt(0)) {
      throw new BadRequestException('closingCounted inválido');
    }

    // Bloqueamos la sesión y releemos sus movimientos dentro de la misma transacción: el arqueo
    // así no pierde movimientos que entren en paralelo (cualquier registro compite por el mismo
    // lock vía createMovement) y la comprobación OPEN sigue siendo atómica contra cierres dobles.
    const { updated, expected, movementCount } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "cash_sessions" WHERE id = ${sessionId} FOR UPDATE`;

      const session = await tx.cashSession.findUnique({
        where: { id: sessionId },
        include: {
          movements: { select: { direction: true, amount: true } },
        },
      });
      if (!session) {
        throw new NotFoundException('Sesión de caja no encontrada');
      }
      if (session.status !== CashSessionStatus.OPEN) {
        throw new ConflictException('La sesión ya está cerrada');
      }

      const { expected } = this.computeExpectedBalance(session.openingAmount, session.movements);

      const diff = expected.sub(counted).abs();
      let differenceNote: string | null = null;
      if (diff.gt(0)) {
        differenceNote = await this.notes.requireOperationalNote(
          'Nota de diferencia en arqueo',
          dto.differenceNote,
        );
      } else {
        const t = dto.differenceNote?.trim();
        differenceNote = t ? t : null;
      }

      const updated = await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          status: CashSessionStatus.CLOSED,
          closedAt: new Date(),
          closedById: actorUserId,
          closingExpected: expected,
          closingCounted: counted,
          differenceNote,
        },
      });
      return { updated, expected, movementCount: session.movements.length };
    });

    await this.audit.recordDomain({
      actorUserId,
      action: 'cash_sessions.close',
      entityType: 'CashSession',
      entityId: sessionId,
      previousPayload: {
        status: CashSessionStatus.OPEN,
        movementCount,
      },
      nextPayload: {
        status: updated.status,
        closingExpected: ceilWholeCop(expected).toString(),
        closingCounted: ceilWholeCop(counted).toString(),
        differenceNote: updated.differenceNote,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.findOne(sessionId);
  }
}
