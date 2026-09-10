/**
 * Raíz de la aplicación Nest: carga módulos de dominio y registra guards/interceptores globales.
 */
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditHttpMiddleware } from './common/middleware/audit-http.middleware';
import { SessionActivityInterceptor } from './common/interceptors/session-activity.interceptor';
import { NotesPolicyModule } from './common/notes-policy/notes-policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CashModule } from './modules/cash/cash.module';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module';
import { CustomersModule } from './modules/customers/customers.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TaxRatesModule } from './modules/tax-rates/tax-rates.module';
import { SparePartsModule } from './modules/spare-parts/spare-parts.module';
import { BillingModule } from './modules/billing/billing.module';
import { ClientPortalModule } from './modules/client-portal/client-portal.module';
import { BackupModule } from './modules/backup/backup.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { HealthController } from './health/health.controller';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    NotesPolicyModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SettingsModule,
    CashModule,
    WorkOrdersModule,
    CustomersModule,
    VehiclesModule,
    TaxRatesModule,
    SparePartsModule,
    BillingModule,
    ClientPortalModule,
    ReportsModule,
    PayrollModule,
    BackupModule,
  ],
  controllers: [RootController, HealthController],
  providers: [
    AuditHttpMiddleware,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: SessionActivityInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditHttpMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
