import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

/** Raíz del prefijo global `api/v1` (evita 404 confuso en navegador). */
@Controller()
export class RootController {
  @Public()
  @Get()
  root() {
    return {
      service: 'vene-autos-api',
      phase: 5,
      links: {
        health: '/api/v1/health',
        authLogin: 'POST /api/v1/auth/login',
        authLogout: 'POST /api/v1/auth/logout',
        workOrders: 'GET/POST /api/v1/work-orders',
        workOrderById: 'GET/PATCH /api/v1/work-orders/:id',
        workOrderPayments: 'GET /api/v1/work-orders/:id/payments',
        workOrderSummary: 'GET /api/v1/work-orders/:id/summary',
        workOrderRecordPayment: 'POST /api/v1/work-orders/:id/payments',
        workOrderLines: 'GET/POST /api/v1/work-orders/:id/lines',
        workOrderLineSubtotal: 'GET /api/v1/work-orders/:id/lines/subtotal',
        workOrderLineById: 'PATCH/DELETE /api/v1/work-orders/:id/lines/:lineId',
        spareParts: 'GET/POST /api/v1/spare-parts',
        sparePartExport: 'GET /api/v1/spare-parts/export',
        sparePartImport: 'POST /api/v1/spare-parts/import',
        sparePartFreeText: 'POST /api/v1/spare-parts/free-text',
        sparePartById: 'PATCH/DELETE /api/v1/spare-parts/:id',
        customers: 'GET/POST /api/v1/customers',
        customerById: 'GET/PATCH /api/v1/customers/:id',
        customerVehicles: 'GET /api/v1/customers/:id/vehicles',
        vehicles: 'POST /api/v1/vehicles',
        vehicleById: 'GET/PATCH /api/v1/vehicles/:id',
        vehicleWorkOrders: 'GET /api/v1/vehicles/:id/work-orders',
        cashCategories: 'GET /api/v1/cash/categories',
        cashSessionOpenStatus: 'GET /api/v1/cash/sessions/open-status',
        cashSessionCurrent: 'GET /api/v1/cash/sessions/current',
        cashSessionOpen: 'POST /api/v1/cash/sessions/open',
        cashMovementIncome: 'POST /api/v1/cash/movements/income',
        cashMovementExpense: 'POST /api/v1/cash/movements/expense',
        cashDelegates: 'GET/PUT /api/v1/cash/delegates',
        cashExpenseRequests: 'GET/POST /api/v1/cash/expense-requests',
        cashExpenseRequestApprove: 'POST /api/v1/cash/expense-requests/:id/approve',
        cashExpenseRequestPayOut: 'POST /api/v1/cash/expense-requests/:id/pay-out',
        cashExpenseRequestReject: 'POST /api/v1/cash/expense-requests/:id/reject',
        cashExpenseRequestCancel: 'POST /api/v1/cash/expense-requests/:id/cancel',
        settings: 'GET/PATCH /api/v1/settings',
        settingsUiContext: 'GET /api/v1/settings/ui-context',
      },
    };
  }
}
