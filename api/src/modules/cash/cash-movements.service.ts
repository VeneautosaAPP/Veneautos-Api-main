/**
 * Registro de movimientos de caja (ingresos y egresos).
 *
 * Debe existir una sesión OPEN; la categoría debe alinearse con la dirección del movimiento.
 * Los egresos aplican política híbrida: rol elevado o fila en delegados, además del permiso HTTP.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashMovementDirection, CashSessionStatus } from '@prisma/client';
import { decimalFromMoneyApiString } from '../../common/money/cop-money';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashAccessService } from './cash-access.service';
import { resolveTenderAndChange } from './cash-tender.util';
import { CASH_WORK_ORDER_REFERENCE_TYPE } from './cash.constants';
import type { CreateCashMovementDto } from './dto/create-cash-movement.dto';

@Injectable()
export class CashMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CashAccessService,
    private readonly notes: NotesPolicyService,
  ) {}

  /** Ingreso en la sesión abierta (ruta protegida con `cash_movements:create_income`). */
  async createIncome(
    actorUserId: string,
    dto: CreateCashMovementDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    return this.createMovement(actorUserId, CashMovementDirection.INCOME, dto, meta);
  }

  /**
   * Egreso: exige delegado o rol elevado, además de `cash_movements:create_expense` en el controlador.
   */
  async createExpense(
    actorUserId: string,
    dto: CreateCashMovementDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const slugs = await this.access.getRoleSlugsForUser(actorUserId);
    if (!this.access.isElevated(slugs)) {
      const ok = await this.access.isExpenseDelegate(actorUserId);
      if (!ok) {
        throw new ForbiddenException(
          'Solo dueño/administrador o delegados autorizados (máx. 3) pueden registrar egresos',
        );
      }
    }
    return this.createMovement(actorUserId, CashMovementDirection.EXPENSE, dto, meta);
  }

  /** Crea movimiento append-only y deja auditoría de dominio con montos y referencias opcionales. */
  private async createMovement(
    actorUserId: string,
    direction: CashMovementDirection,
    dto: CreateCashMovementDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const category = await this.prisma.cashMovementCategory.findUnique({
      where: { slug: dto.categorySlug },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    if (category.direction !== direction) {
      throw new BadRequestException('La categoría no corresponde al tipo de movimiento');
    }

    const amount = decimalFromMoneyApiString(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }

    const noteLabel =
      direction === CashMovementDirection.INCOME ? 'Nota del ingreso en caja' : 'Nota del egreso en caja';
    const noteText = await this.notes.requireOperationalNote(noteLabel, dto.note);

    const { referenceType, referenceId } = await this.resolveMovementReferences(dto);
    const { tenderAmount, changeAmount } = resolveTenderAndChange(amount, dto.tenderAmount);

    // Bloqueamos la sesión OPEN vigente y creamos el movimiento bajo ese lock: un cierre de caja
    // concurrente compite por la misma fila (close usa FOR UPDATE sobre cash_sessions) y queda
    // serializado; así el movimiento nunca entra a una sesión ya cerrada ni se pierde del arqueo.
    const { movement, sessionId } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "cash_sessions" WHERE status::text = ${CashSessionStatus.OPEN} ORDER BY "created_at" ASC LIMIT 1 FOR UPDATE`;

      const session = await tx.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
        select: { id: true },
      });
      if (!session) {
        throw new ConflictException('No hay sesión de caja abierta');
      }

      const movement = await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          categoryId: category.id,
          direction,
          amount,
          tenderAmount,
          changeAmount,
          referenceType,
          referenceId,
          note: noteText,
          createdById: actorUserId,
        },
        include: {
          category: true,
          createdBy: { select: { id: true, email: true, fullName: true } },
        },
      });
      return { movement, sessionId: session.id };
    });

    await this.audit.recordDomain({
      actorUserId,
      action: direction === CashMovementDirection.INCOME ? 'cash_movements.income' : 'cash_movements.expense',
      entityType: 'CashMovement',
      entityId: movement.id,
      previousPayload: null,
      nextPayload: {
        sessionId,
        categorySlug: category.slug,
        direction,
        amount: dto.amount,
        tenderAmount: tenderAmount?.toString() ?? null,
        changeAmount: changeAmount?.toString() ?? null,
        referenceType,
        referenceId,
        workOrderId: dto.workOrderId ?? null,
        note: noteText,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return movement;
  }

  /**
   * Resuelve referencia libre o enlace explícito a orden de trabajo (`WorkOrder`).
   */
  private async resolveMovementReferences(
    dto: CreateCashMovementDto,
  ): Promise<{ referenceType: string | null; referenceId: string | null }> {
    if (dto.workOrderId) {
      const rt = dto.referenceType?.trim();
      const rid = dto.referenceId?.trim();
      if (rt && rt !== CASH_WORK_ORDER_REFERENCE_TYPE) {
        throw new BadRequestException('referenceType no compatible con workOrderId');
      }
      if (rid && rid !== dto.workOrderId) {
        throw new BadRequestException('referenceId debe coincidir con workOrderId');
      }
      const wo = await this.prisma.workOrder.findUnique({ where: { id: dto.workOrderId } });
      if (!wo) {
        throw new NotFoundException('Orden de trabajo no encontrada');
      }
      return { referenceType: CASH_WORK_ORDER_REFERENCE_TYPE, referenceId: wo.id };
    }
    return {
      referenceType: dto.referenceType?.trim() ?? null,
      referenceId: dto.referenceId?.trim() ?? null,
    };
  }
}
