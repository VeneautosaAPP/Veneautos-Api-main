import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreateDebitNoteDto } from './dto/create-debit-note.dto';
import { CreateInvoiceFromWorkOrderDto } from './dto/create-invoice-from-work-order.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import { RecordInvoicePaymentDto } from './dto/record-invoice-payment.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { CreditNotesService } from './credit-notes.service';
import { DebitNotesService } from './debit-notes.service';
import { InvoicePaymentsService } from './invoice-payments.service';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly creditNotes: CreditNotesService,
    private readonly debitNotes: DebitNotesService,
    private readonly payments: InvoicePaymentsService,
  ) {}

  @Get()
  @RequirePermissions('invoices:read')
  list(@Query() query: ListInvoicesQueryDto, @CurrentUser() actor: JwtUserPayload) {
    return this.invoices.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('invoices:read')
  findOne(@Param('id') id: string) {
    return this.invoices.findOne(id);
  }

  @Post('from-work-order/:workOrderId')
  @RequirePermissions('invoices:create')
  createFromWorkOrder(
    @Param('workOrderId') workOrderId: string,
    @Body() dto: CreateInvoiceFromWorkOrderDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.createFromWorkOrder(workOrderId, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/issue')
  @RequirePermissions('invoices:issue')
  issue(@Param('id') id: string, @CurrentUser() actor: JwtUserPayload, @Req() req: Request) {
    return this.invoices.issue(id, actor, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/void')
  @RequirePermissions('invoices:void')
  void(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.void(id, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Get(':id/payments')
  @RequirePermissions('invoices:read')
  listPayments(@Param('id') id: string) {
    return this.payments.list(id);
  }

  @Post(':id/payments')
  @RequirePermissions('invoices:record_payment', 'cash_movements:create_income')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordInvoicePaymentDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.payments.record(id, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/credit-notes')
  @RequirePermissions('credit_notes:create')
  createCreditNote(
    @Param('id') invoiceId: string,
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.creditNotes.createFromInvoice(invoiceId, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/debit-notes')
  @RequirePermissions('debit_notes:create')
  createDebitNote(
    @Param('id') invoiceId: string,
    @Body() dto: CreateDebitNoteDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.debitNotes.createFromInvoice(invoiceId, actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}

