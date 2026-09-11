import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ClientPortalService } from './client-portal.service';
import { LookupClientPortalDto } from './dto/lookup-client-portal.dto';
import { ReceiptClientPortalDto } from './dto/receipt-client-portal.dto';

/**
 * Portal público de clientes. Sin JWT: la consulta se autentica por placa + celular
 * (datos que el taller tiene de forma fiable) y devuelve una vista de solo lectura.
 */
@Controller('client-portal')
export class ClientPortalController {
  constructor(private readonly clientPortal: ClientPortalService) {}

  @Public()
  @Post('account')
  lookup(@Body() dto: LookupClientPortalDto, @Req() req: Request) {
    return this.clientPortal.lookup(dto, req.ip);
  }

  /**
   * Comprobante imprimible en el mismo formato que entrega la OT (`work-orders/:id/receipt`).
   * El API revalida placa + celular y confirma que el `orderCode` pertenece a esa cuenta.
   */
  @Public()
  @Post('account/receipt')
  async receipt(
    @Body() dto: ReceiptClientPortalDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const html = await this.clientPortal.renderReceipt(dto, req.ip);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(html);
  }
}