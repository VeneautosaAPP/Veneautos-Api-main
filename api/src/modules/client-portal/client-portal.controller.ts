import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ClientPortalService } from './client-portal.service';
import { LookupClientPortalDto } from './dto/lookup-client-portal.dto';

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
}