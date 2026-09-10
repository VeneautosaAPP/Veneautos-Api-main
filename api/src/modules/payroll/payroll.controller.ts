import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { PayrollWeeklySummaryQueryDto } from './dto/payroll-weekly-summary.query.dto';
import { PAYROLL_READ, PayrollService } from './payroll.service';

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
}