/**
 * Endpoints REST de sesiones de caja (`/cash/sessions/...`).
 *
 * Orden de rutas: rutas fijas (`current`, `open`) antes de `:id` para que Nest no interprete
 * "current" como un id.
 */
import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequirePermissions,
} from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import {
  type CashSessionForReceipt,
  ReceiptsService,
  type WorkOrderForReceipt,
} from '../receipts/receipts.service';
import { TicketBuilderService } from '../receipts/ticket-builder.service';
import { WorkOrderPaymentsService } from '../work-orders/work-order-payments.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { CashSessionsService } from './cash-sessions.service';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';

@Controller('cash/sessions')
export class CashSessionsController {
  private readonly logger = new Logger(CashSessionsController.name);

  constructor(
    private readonly sessions: CashSessionsService,
    private readonly receipts: ReceiptsService,
    private readonly ticketBuilder: TicketBuilderService,
    private readonly prisma: PrismaService,
    // Fase 7.7 · Al reimprimir un movimiento desde caja, si el movimiento proviene
    // de un cobro de OT o de venta, queremos regenerar el MISMO ticket completo
    // (con detalle, cliente, vehículo, saldo...) en lugar del mini-ticket de
    // movimiento. Esto requiere consultar la OT/venta y la lista de cobros.
    private readonly workOrders: WorkOrdersService,
    private readonly workOrderPayments: WorkOrderPaymentsService,
  ) {}

  /** Solo `{ open: boolean }` — sin permiso extra; sirve para ocultar UI que exige caja abierta. */
  @Get('open-status')
  openStatus() {
    return this.sessions.getOpenStatus();
  }

  @Get('current')
  @RequirePermissions('cash_sessions:read')
  current() {
    return this.sessions.getCurrentOpen();
  }

  @Get()
  @RequirePermissions('cash_sessions:read')
  list() {
    return this.sessions.listRecent(30);
  }

  @Get(':id')
  @RequirePermissions('cash_sessions:read')
  findOne(@Param('id') id: string) {
    return this.sessions.findOne(id);
  }

  /**
   * Ticket de arqueo imprimible (Fase 7.6). HTML listo para `window.print()` con los datos del
   * taller, resumen del cierre y detalle de movimientos. Se recupera la nota de apertura del
   * `AuditLog` porque `CashSession` no la persiste como columna.
   */
  @Get(':id/receipt')
  @RequirePermissions('cash_sessions:read')
  async receipt(@Param('id') id: string, @Res() res: Response) {
    const detail = await this.sessions.findOne(id);

    let openingNote: string | null = null;
    try {
      const openEntry = await this.prisma.auditLog.findFirst({
        where: {
          entityType: 'CashSession',
          entityId: id,
          action: 'cash_sessions.open',
        },
        orderBy: { createdAt: 'asc' },
        select: { nextPayload: true },
      });
      const payload = openEntry?.nextPayload as { note?: unknown } | null | undefined;
      if (payload && typeof payload.note === 'string' && payload.note.trim().length > 0) {
        openingNote = payload.note.trim();
      }
    } catch {
      /** Ausencia del registro no debe tumbar la impresión; sólo queda sin la nota. */
      openingNote = null;
    }

    try {
      const payload: CashSessionForReceipt = {
        ...(detail as unknown as CashSessionForReceipt),
        openingNote,
      };
      const html = await this.receipts.renderCashSessionReceipt(payload);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.send(html);
    } catch (err) {
      this.logger.error(
        `Falló al renderizar arqueo de caja ${id}: ${(err as Error)?.message ?? err}`,
        (err as Error)?.stack,
      );
      throw new InternalServerErrorException(
        `No se pudo generar el arqueo (${(err as Error)?.message ?? 'error interno'}).`,
      );
    }
  }

  /**
   * Ticket térmico JSON del arqueo de caja (Fase 7.7). Versión resumida (aperturas, totales y
   * desglose por origen). El detalle completo de movimientos va al HTML/PDF: el papel de
   * 58 mm no alcanza para listar 50+ movimientos de forma legible.
   */
  @Get(':id/receipt-ticket.json')
  @RequirePermissions('cash_sessions:read')
  async receiptTicket(@Param('id') id: string) {
    const detail = await this.sessions.findOne(id);
    let openingNote: string | null = null;
    try {
      const openEntry = await this.prisma.auditLog.findFirst({
        where: {
          entityType: 'CashSession',
          entityId: id,
          action: 'cash_sessions.open',
        },
        orderBy: { createdAt: 'asc' },
        select: { nextPayload: true },
      });
      const payload = openEntry?.nextPayload as { note?: unknown } | null | undefined;
      if (payload && typeof payload.note === 'string' && payload.note.trim().length > 0) {
        openingNote = payload.note.trim();
      }
    } catch {
      openingNote = null;
    }
    const payload: CashSessionForReceipt = {
      ...(detail as unknown as CashSessionForReceipt),
      openingNote,
    };
    return this.ticketBuilder.buildCashSessionSummaryTicket(payload);
  }

  /**
   * Ticket térmico JSON para un movimiento individual (ingreso o egreso manual de caja).
   * Permite reimprimir desde el historial del día en CashPage sin recalcular nada en el front.
   */
  @Get(':id/movements/:movementId/receipt-ticket.json')
  @RequirePermissions('cash_sessions:read')
  async movementTicket(
    @Param('id') id: string,
    @Param('movementId') movementId: string,
    @CurrentUser() actor: JwtUserPayload,
  ) {
    const movement = await this.prisma.cashMovement.findFirst({
      where: { id: movementId, sessionId: id },
      include: {
        category: true,
        createdBy: { select: { id: true, email: true, fullName: true } },
        // Si el movimiento corresponde a un cobro de OT, hay un registro
        // 1:1 en `workOrderPayment`. Lo usamos para redirigir al builder
        // completo de pago (con detalle, cliente, saldo, etc.).
        workOrderPayment: { select: { id: true, workOrderId: true } },
      },
    });
    if (!movement) {
      throw new InternalServerErrorException(
        'El movimiento no existe o no pertenece a esta sesión.',
      );
    }

    // Caso 1 · Cobro de una OT → mismo ticket que imprimió el cajero al registrar el pago.
    // Replica exacta de `WorkOrdersController.paymentReceiptTicket`.
    if (movement.workOrderPayment) {
      return this.buildWorkOrderPaymentReprint(
        movement.workOrderPayment.workOrderId,
        movement.workOrderPayment.id,
        actor,
      );
    }

    // Caso 2 · Ingreso/egreso manual (sin vínculo) → mini-ticket tradicional.
    return this.ticketBuilder.buildCashMovementTicket(
      {
        direction: movement.direction,
        amount: movement.amount,
        tenderAmount: movement.tenderAmount,
        changeAmount: movement.changeAmount,
        note: movement.note,
        createdAt: movement.createdAt,
        category: movement.category,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        createdBy: movement.createdBy,
      },
      id,
    );
  }

  /**
   * Recompone el ticket de un cobro de OT leyendo el estado actual de la OT y
   * la lista de pagos. El saldo se calcula al corte del `paymentId` (paidSoFar
   * hasta ese pago inclusive) para que la reimpresión refleje el contexto real
   * del momento en que se registró el cobro.
   */
  private async buildWorkOrderPaymentReprint(
    workOrderId: string,
    paymentId: string,
    actor: JwtUserPayload,
  ) {
    const detail = await this.workOrders.findOne(workOrderId, actor);
    const payments = (await this.workOrderPayments.list(workOrderId, actor)) as Array<{
      id: string;
      amount: { toString(): string };
      createdAt: Date | string;
      note?: string | null;
      cashMovement?: {
        category?: { name?: string | null; slug?: string | null } | null;
        tenderAmount?: { toString(): string } | null;
        changeAmount?: { toString(): string } | null;
      } | null;
      recordedBy?: { fullName?: string | null; email?: string | null } | null;
    }>;
    const payment = payments.find((p) => p.id === paymentId);
    if (!payment) {
      throw new InternalServerErrorException(
        'El cobro vinculado ya no existe en la OT.',
      );
    }
    const paidSoFar = payments
      .filter(
        (p) =>
          new Date(p.createdAt as string).getTime() <=
          new Date(payment.createdAt as string).getTime(),
      )
      .reduce((acc, p) => acc + Number(p.amount.toString()), 0);
    const grand = Number(detail.totals?.grandTotal ?? 0);
    const dueAfter = Math.max(0, grand - paidSoFar);
    const d = detail as unknown as WorkOrderForReceipt;
    return this.ticketBuilder.buildWorkOrderPaymentTicket(
      {
        publicCode: d.publicCode,
        customerName: d.customerName,
        customerPhone: d.customerPhone,
        customerDocumentId: d.customerDocumentId ?? null,
        vehicle: d.vehicle,
        vehiclePlate: d.vehiclePlate ?? null,
        vehicleBrand: d.vehicleBrand ?? null,
        vehicleModel: d.vehicleModel ?? null,
        authorizedAmount: null,
        lines: d.lines,
        totals: d.totals,
        totalPaidAfter: paidSoFar.toString(),
        amountDueAfter: dueAfter.toString(),
      },
      payment,
    );
  }

  @Post('open')
  @RequirePermissions('cash_sessions:open')
  open(@Body() dto: OpenCashSessionDto, @CurrentUser() actor: JwtUserPayload, @Req() req: Request) {
    return this.sessions.open(actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/close')
  @RequirePermissions('cash_sessions:close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.sessions.close(id, actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}
