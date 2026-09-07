import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto';
import { UpdateTaxRateDto } from './dto/update-tax-rate.dto';
import { TaxRatesService } from './tax-rates.service';

@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly taxRates: TaxRatesService) {}

  @Get()
  @RequireAnyPermission('tax_rates:read', 'work_order_lines:create', 'work_order_lines:update')
  list(@Query('activeOnly') activeOnly?: string) {
    const onlyActive = activeOnly === 'true' || activeOnly === '1';
    return this.taxRates.list({ onlyActive });
  }

  @Get(':id')
  @RequirePermissions('tax_rates:read')
  findOne(@Param('id') id: string) {
    return this.taxRates.findOne(id);
  }

  @Post()
  @RequirePermissions('tax_rates:create')
  create(
    @Body() dto: CreateTaxRateDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.taxRates.create(actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Patch(':id')
  @RequirePermissions('tax_rates:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaxRateDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.taxRates.update(id, actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}
