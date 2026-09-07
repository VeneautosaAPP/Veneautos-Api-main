/**
 * Módulo de caja (Fase 2): sesiones, movimientos, categorías, delegados y solicitudes de egreso.
 * Exporta servicios por si otros módulos necesitan reutilizarlos más adelante.
 */
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { CashAccessService } from './cash-access.service';
import { CashCategoriesController } from './cash-categories.controller';
import { CashDelegatesController } from './cash-delegates.controller';
import { CashDelegatesService } from './cash-delegates.service';
import { CashExpenseRequestExpiryScheduler } from './cash-expense-request-expiry.scheduler';
import { CashExpenseRequestsController } from './cash-expense-requests.controller';
import { CashExpenseRequestsService } from './cash-expense-requests.service';
import { CashMovementsController } from './cash-movements.controller';
import { CashMovementsService } from './cash-movements.service';
import { CashSessionsController } from './cash-sessions.controller';
import { CashSessionsService } from './cash-sessions.service';

@Module({
  imports: [AuditModule, ReceiptsModule, WorkOrdersModule],
  controllers: [
    CashCategoriesController,
    CashSessionsController,
    CashMovementsController,
    CashDelegatesController,
    CashExpenseRequestsController,
  ],
  providers: [
    CashAccessService,
    CashSessionsService,
    CashMovementsService,
    CashDelegatesService,
    CashExpenseRequestsService,
    CashExpenseRequestExpiryScheduler,
  ],
  exports: [
    CashAccessService,
    CashSessionsService,
    CashMovementsService,
    CashDelegatesService,
    CashExpenseRequestsService,
  ],
})
export class CashModule {}
