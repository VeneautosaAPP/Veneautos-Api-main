import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { PayrollPercentDto } from './dto/payroll-percent.dto';
import { PayrollWeeklySummaryQueryDto } from './dto/payroll-weekly-summary.query.dto';
import { PAYROLL_READ, PAYROLL_READ_ALL, PayrollService } from './payroll.service';

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /**
   * Resumen de la nómina semanal (lunes–sábado) por mecánico, con desglose por OT.
   * Un perfil sin `payroll:read_all` solo recibe su propia nómina.
   */
  @Get('weekly-summary')
  @RequirePermissions(PAYROLL_READ)
  weeklySummary(
    @CurrentUser() actor: JwtUserPayload,
    @Query() query: PayrollWeeklySummaryQueryDto,
  ) {
    return this.payroll.weeklySummary(actor, query);
  }

  /**
   * Persiste el % de comisión de una OT (por defecto 50). Solo el dueño/administrador
   * (`payroll:read_all`) puede hacerlo; el mecánico ve su nómina en solo-lectura.
   */
  @Put('weekly-summary/ratios/:workOrderId')
  @RequirePermissions(PAYROLL_READ_ALL)
  setCommissionPercent(
    @Param('workOrderId') workOrderId: string,
    @Body() dto: PayrollPercentDto,
  ) {
    return this.payroll.setCommissionPercent(workOrderId, dto.commissionPct);
  }
}