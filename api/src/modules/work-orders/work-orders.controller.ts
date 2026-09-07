/**
 * API de órdenes de trabajo (`/work-orders`).
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  InternalServerErrorException,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import {
  ReceiptsService,
  type WorkOrderForReceipt,
} from '../receipts/receipts.service';
import { TicketBuilderService } from '../receipts/ticket-builder.service';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { ListWorkOrdersQueryDto } from './dto/list-work-orders.query.dto';
import { LookupPublicWorkOrderDto } from './dto/lookup-public-work-order.dto';
import { RecordWorkOrderPaymentDto } from './dto/record-work-order-payment.dto';
import { ReopenDeliveredWorkOrderDto } from './dto/reopen-delivered-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { CreateWorkOrderLineDto } from './dto/create-work-order-line.dto';
import { UpdateWorkOrderLineDto } from './dto/update-work-order-line.dto';
import { WorkOrderLinesService } from './work-order-lines.service';
import { WorkOrderPaymentsService } from './work-order-payments.service';
import { WorkOrdersService } from './work-orders.service';

@Controller('work-orders')
export class WorkOrdersController {
  private readonly logger = new Logger(WorkOrdersController.name);

  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly workOrderPayments: WorkOrderPaymentsService,
    private readonly workOrderLines: WorkOrderLinesService,
    private readonly receipts: ReceiptsService,
    private readonly ticketBuilder: TicketBuilderService,
  ) {}

  @Post()
  @RequirePermissions('work_orders:create')
  create(
    @Body() dto: CreateWorkOrderDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.workOrders.create(actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  /** Seguimiento de OT para el cliente (código de comprobante + placa). Sin autenticación. */
  @Public()
  @Post('public/lookup')
  lookupPublic(@Body() dto: LookupPublicWorkOrderDto) {
    return this.workOrders.lookupPublicByCodeAndPlate(dto);
  }

  @Get()
  @RequireAnyPermission('work_orders:read', 'work_orders:read_portal')
  list(@CurrentUser() actor: JwtUserPayload, @Query() query: ListWorkOrdersQueryDto) {
    return this.workOrders.list(actor, query);
  }

  @Get('assignable-users')
  @RequirePermissions('work_orders:reassign')
  listAssignableUsers() {
    return this.workOrders.listAssignableUsers();
  }

  /**
   * Diccionario de líneas de OT → autocompletado del front. Devuelve las etiquetas más
   * recientes (`lastUsedAt`) que coinciden con `q` (insensible a mayúsculas); sin `q`
   * trae las últimas usadas.
   */
  @Get('line-catalog/suggestions')
  @RequireAnyPermission('work_orders:read', 'work_order_lines:create', 'work_order_lines:update')
  lineCatalogSuggestions(@Query('q') q?: string, @Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 15;
    return this.workOrderLines.suggestCatalogDescriptions(
      q,
      Number.isFinite(parsedLimit) ? parsedLimit : 15,
    );
  }

  @Get(':id/payments')
  @RequirePermissions('work_orders:read')
  listPayments(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload) {
    return this.workOrderPayments.list(id, actor);
  }

  @Get(':id/summary')
  @RequirePermissions('work_orders:read')
  paymentsSummary(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload) {
    return this.workOrderPayments.summary(id, actor);
  }

  @Post(':id/payments')
  @RequirePermissions('work_orders:record_payment', 'cash_movements:create_income')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordWorkOrderPaymentDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.workOrderPayments.record(id, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/reopen-delivered')
  @RequirePermissions('work_orders:reopen_delivered')
  reopenDelivered(
    @Param('id') id: string,
    @Body() dto: ReopenDeliveredWorkOrderDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.workOrders.reopenDelivered(id, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Get(':id/lines/subtotal')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  @RequirePermissions('work_orders:read')
  linesSubtotal(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload) {
    return this.workOrderLines.subtotal(id, actor);
  }

  @Get(':id/lines')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  @RequireAnyPermission('work_orders:read', 'work_orders:read_portal')
  listLines(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload) {
    return this.workOrderLines.list(id, actor);
  }

  @Post(':id/lines')
  @RequirePermissions('work_orders:update', 'work_order_lines:create')
  addLine(
    @Param('id') id: string,
    @Body() dto: CreateWorkOrderLineDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.workOrderLines.create(id, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Patch(':id/lines/:lineId')
  @RequirePermissions('work_orders:update', 'work_order_lines:update')
  updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateWorkOrderLineDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.workOrderLines.update(id, lineId, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions('work_orders:update', 'work_order_lines:delete')
  async removeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    await this.workOrderLines.remove(id, lineId, actor, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    /** Misma respuesta que GET …/lines: el cliente actualiza la tabla sin un segundo GET que pueda verse “antes” del commit. */
    return this.workOrderLines.list(id, actor);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  @RequireAnyPermission('work_orders:read', 'work_orders:read_portal')
  findOne(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload) {
    return this.workOrders.findOne(id, actor);
  }

  /**
   * Comprobante imprimible (Fase 7.5): HTML listo para `window.print()` con los datos del
   * taller como encabezado. No es un documento fiscal; úsese mientras la facturación
   * electrónica DIAN esté apagada.
   */
  @Get(':id/receipt')
  @RequirePermissions('work_orders:read')
  async receipt(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUserPayload,
    @Res() res: Response,
  ) {
    /**
     * Cargamos OT y pagos por separado: si el actor no puede ver montos, igual imprimimos
     * la OT sin la sección de pagos (el recibo sigue siendo útil como constancia del servicio).
     */
    const detail = await this.workOrders.findOne(id, actor);
    let payments: unknown[] = [];
    try {
      payments = (await this.workOrderPayments.list(id, actor)) as unknown[];
    } catch (err) {
      // Sin permiso para ver montos: imprimimos el recibo sin la sección de pagos (deliberado).
      // Cualquier otro error (BD, no encontrado) debe propagarse, no silenciarse como "no hay pagos".
      if (!(err instanceof ForbiddenException)) {
        throw err;
      }
    }
    try {
      const payload: WorkOrderForReceipt = {
        ...(detail as unknown as WorkOrderForReceipt),
        payments: payments as unknown as WorkOrderForReceipt['payments'],
      };
      const html = await this.receipts.renderWorkOrderReceipt(payload);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.send(html);
    } catch (err) {
      this.logger.error(
        `Falló al renderizar comprobante de OT ${id}: ${(err as Error)?.message ?? err}`,
        (err as Error)?.stack,
      );
      throw new InternalServerErrorException(
        `No se pudo generar el comprobante de la orden (${(err as Error)?.message ?? 'error interno'}).`,
      );
    }
  }

  /**
   * Ticket térmico JSON para la OT completa (Fase 7.7). Lo consume el front para enviarlo al
   * puente local `vene-drawer-bridge` que lo traduce a ESC/POS (58 mm, CP850). La autoridad de
   * los datos queda en el API; el puente es solo "driver" de impresora.
   */
  @Get(':id/receipt-ticket.json')
  @RequirePermissions('work_orders:read')
  async receiptTicket(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload) {
    const detail = await this.workOrders.findOne(id, actor);
    let payments: unknown[] = [];
    try {
      payments = (await this.workOrderPayments.list(id, actor)) as unknown[];
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        throw err;
      }
    }
    const payload: WorkOrderForReceipt = {
      ...(detail as unknown as WorkOrderForReceipt),
      payments: payments as unknown as WorkOrderForReceipt['payments'],
    };
    return this.ticketBuilder.buildWorkOrderTicket(payload);
  }

  /**
   * Ticket térmico JSON para un cobro puntual de la OT (uno por pago). Idéntico al que se
   * imprime automáticamente tras registrar el cobro; disponible también para reimpresión.
   */
  @Get(':id/payments/:paymentId/receipt-ticket.json')
  @RequirePermissions('work_orders:read')
  async paymentReceiptTicket(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser() actor: JwtUserPayload,
  ) {
    const detail = await this.workOrders.findOne(id, actor);
    const payments = (await this.workOrderPayments.list(id, actor)) as Array<{
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
      throw new InternalServerErrorException('El cobro no existe o no pertenece a esta orden.');
    }
    const paidSoFar = payments
      .filter((p) => new Date(p.createdAt as string).getTime() <= new Date(payment.createdAt as string).getTime())
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

  @Patch(':id')
  @RequirePermissions('work_orders:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkOrderDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.workOrders.update(id, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}
