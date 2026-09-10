import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CLIENT_PORTAL_NOT_FOUND,
  CLIENT_PORTAL_RATE,
  CLIENT_PORTAL_RATE_LIMITED,
} from './client-portal.constants';
import { ClientPortalService } from './client-portal.service';

const DEC = (v: number | string) => new Prisma.Decimal(v);

/** Forma mínima de los args de `workOrder.findMany` usados por el servicio. */
type WorkOrderFindManyArgs = {
  where?: {
    vehiclePlate?: string;
    vehicleId?: string | { in?: string[] };
  };
  select?: unknown;
};

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    lineType: 'LABOR',
    description: 'Mano de obra ajuste',
    quantity: DEC(1),
    unitPrice: DEC(100000),
    discountAmount: DEC(0),
    costSnapshot: null,
    taxRateId: 'tr1',
    taxRatePercentSnapshot: DEC(19),
    taxRate: { kind: 'VAT', name: 'IVA', ratePercent: DEC(19) },
    sortOrder: 0,
    ...overrides,
  };
}

function makeInvoiceLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'il1',
    lineType: 'LABOR',
    description: 'Mano de obra ajuste',
    quantity: DEC(1),
    unitPrice: DEC(100000),
    discountAmount: DEC(0),
    taxRatePercentSnapshot: DEC(19),
    taxRateKindSnapshot: 'VAT',
    lineTotal: DEC(119000),
    taxRate: { kind: 'VAT', name: 'IVA', ratePercent: DEC(19) },
    sortOrder: 0,
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    documentNumber: 'FEV001',
    status: 'DRAFT',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    issuedAt: null,
    voidedAt: null,
    voidedReason: null,
    cufe: null,
    subtotal: DEC(100000),
    totalDiscount: DEC(0),
    totalTax: DEC(19000),
    grandTotal: DEC(119000),
    payments: [],
    lines: [makeInvoiceLine()],
    creditNotes: [],
    debitNotes: [],
    ...overrides,
  };
}

function makeWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wo1',
    publicCode: 'VEN-0001',
    status: WorkOrderStatus.RECEIVED,
    description: 'Cambio de aceite y filtro',
    createdAt: new Date('2026-08-20T09:00:00Z'),
    deliveredAt: null,
    cancelledAt: null,
    intakeOdometerKm: 45800,
    inspectionOnly: false,
    vehicleId: 'v1',
    vehicle: {
      id: 'v1',
      plate: 'EKP112',
      brand: 'Chevrolet',
      model: 'Spark',
      year: 2018,
      color: 'Blanco',
    },
    lines: [makeLine()],
    payments: [{ amount: DEC(50000), createdAt: new Date('2026-08-21T10:00:00Z') }],
    invoices: [],
    ...overrides,
  };
}

/** Envuelve los mocks de prisma y devuelve la instancia del servicio. */
async function createService(overrides?: {
  vehicleFindUnique?: () => unknown;
  vehicleFindMany?: () => unknown;
  workOrderFindMany?: (args: WorkOrderFindManyArgs) => unknown;
  workOrderFindFirst?: () => unknown;
  customerFindUnique?: () => unknown;
  attemptFindUnique?: () => unknown;
}) {
  const defaultVehicle = () => ({
    id: 'v1',
    plate: 'EKP112',
    brand: 'Chevrolet',
    model: 'Spark',
    year: 2018,
    color: 'Blanco',
    customer: { id: 'c1', primaryPhone: '3005550199' },
  });
  const prisma = {
    clientPortalAttempt: {
      findUnique: jest.fn().mockImplementation(overrides?.attemptFindUnique ?? (() => null)),
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      update: jest.fn().mockResolvedValue({ id: 'a1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vehicle: {
      findUnique: jest.fn().mockImplementation(overrides?.vehicleFindUnique ?? defaultVehicle),
      findMany: jest.fn().mockImplementation(overrides?.vehicleFindMany ?? (() => [])),
    },
    workOrder: {
      findMany: jest.fn().mockImplementation(overrides?.workOrderFindMany ?? (() => [])),
      findFirst: jest.fn().mockImplementation(overrides?.workOrderFindFirst ?? (() => null)),
    },
    customer: {
      findUnique: jest
        .fn()
        .mockImplementation(
          overrides?.customerFindUnique ?? (() => ({ id: 'c1', displayName: 'Carlos Pérez', documentId: 'CC1234567' })),
        ),
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [ClientPortalService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  const service = moduleRef.get(ClientPortalService);
  return { service, prisma };
}

const DTO = { plate: 'EKP112', phone: '300 555 0199' };

describe('ClientPortalService', () => {
  describe('identidad: placa + celular', () => {
    it('devuelve la cuenta del cliente por placa maestra + primaryPhone', async () => {
      const { service, prisma } = await createService({
        vehicleFindMany: () => [
          { id: 'v1', plate: 'EKP112', brand: 'Chevrolet', model: 'Spark', year: 2018, color: 'Blanco' },
          { id: 'v2', plate: 'ABC123', brand: 'Renault', model: 'Sandero', year: 2020, color: 'Gris' },
        ],
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [makeWorkOrder()];
        },
      });

      const account = await service.lookup(DTO);

      expect(account.cliente.displayName).toBe('Carlos Pérez');
      expect(account.cliente.documentId).toBe('CC1234567');
      expect(account.cliente.maskedPhone).toBe('••••0199');

      // Flota completa: 2 vehículos, aunque solo uno tenga órdenes.
      expect(account.resumen.vehiclesCount).toBe(2);
      const plates = account.vehicles.map((v) => v.plate).sort();
      expect(plates).toEqual(['ABC123', 'EKP112']);

      const withOrders = account.vehicles.find((v) => v.orders.length > 0)!;
      const order = withOrders.orders[0]!;
      expect(order.publicCode).toBe('VEN-0001');
      expect(order.grandTotal).toBe('119000');
      expect(order.amountPaid).toBe('50000');
      expect(order.amountDue).toBe('69000');
      expect(order.lines[0]!.lineTotal).toBe('119000');

      expect(account.resumen.openOrders).toBe(1);
      expect(account.resumen.invoicesCount).toBe(0);
      expect(account.resumen.openBalance).toBe('69000');

      // Sin borrar: limpió los intentos tras éxito.
      expect(prisma.clientPortalAttempt.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('también acepta el celular cargado en las OTs (secundario del cliente)', async () => {
      const { service } = await createService({
        vehicleFindUnique: () => ({
          id: 'v1',
          plate: 'EKP112',
          customer: { id: 'c1', primaryPhone: null },
        }),
        vehicleFindMany: () => [
          { id: 'v1', plate: 'EKP112', brand: null, model: null, year: null, color: null },
        ],
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [makeWorkOrder()];
        },
      });

      const account = await service.lookup(DTO);
      expect(account.cliente.displayName).toBe('Carlos Pérez');
      expect(account.vehicles.length).toBe(1);
    });

    it('incluye la factura de la OT con su propio saldo (no duplica en el resumen)', async () => {
      const invoice = makeInvoice({ payments: [{ amount: DEC(40000) }] });
      const { service, prisma } = await createService({
        vehicleFindMany: () => [
          { id: 'v1', plate: 'EKP112', brand: null, model: null, year: null, color: null },
        ],
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [makeWorkOrder({ invoices: [invoice] })];
        },
      });

      const account = await service.lookup(DTO);
      const order = account.vehicles[0]!.orders[0]!;
      expect(order.invoices).toHaveLength(1);
      expect(order.invoices[0]!.documentNumber).toBe('FEV001');
      expect(order.invoices[0]!.amountPaid).toBe('40000');
      expect(order.invoices[0]!.amountDue).toBe('79000');

      // La OT tiene factura → el saldo agregado viene de la factura (79.000) y no de la OT.
      expect(account.resumen.invoicesCount).toBe(1);
      expect(account.resumen.openBalance).toBe('79000');
      void prisma;
    });

    it('vehículo huérfano (sin cliente maestro): valida contra sus OTs', async () => {
      const { service } = await createService({
        vehicleFindUnique: () => ({
          id: 'v1',
          plate: 'EKP112',
          customer: null,
        }),
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [makeWorkOrder()];
        },
        workOrderFindFirst: () => ({ customerName: 'Carlos Pérez' }),
      });

      const account = await service.lookup(DTO);
      expect(account.vehicles[0]!.plate).toBe('EKP112');
      expect(account.cliente.displayName).toBe('Carlos Pérez');
    });

    it('legado: placa solo como snapshot de OT sin vehículo maestro', async () => {
      const { service } = await createService({
        vehicleFindUnique: () => null,
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.where?.vehiclePlate) {
            return [{ id: 'owl1', vehiclePlate: 'EKP-112', customerPhone: '3005550199' }];
          }
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [
            makeWorkOrder({
              vehicleId: null,
              vehicle: null,
              vehiclePlate: 'EKP-112',
              vehicleBrand: 'Chevrolet',
              vehicleModel: 'Spark',
            }),
          ];
        },
        workOrderFindFirst: () => ({ customerName: 'Carlos Pérez' }),
      });

      const account = await service.lookup({ plate: 'EKP112', phone: '3005550199' });
      expect(account.vehicles[0]!.plate).toBe('EKP-112');
      expect(account.cliente.displayName).toBe('Carlos Pérez');
    });

    it('falla con error genérico si el celular no coincide', async () => {
      const { service, prisma } = await createService({
        vehicleFindUnique: () => ({ id: 'v1', plate: 'EKP112', customer: { id: 'c1', primaryPhone: '3211111111' } }),
        workOrderFindMany: () => [],
      });

      await expect(service.lookup(DTO)).rejects.toThrow(NotFoundException);
      await expect(service.lookup(DTO)).rejects.toThrow(CLIENT_PORTAL_NOT_FOUND);
      // No limpió intentos (la búsqueda falló).
      expect(prisma.clientPortalAttempt.deleteMany).not.toHaveBeenCalled();
    });

    it('falla con error genérico si la placa no existe', async () => {
      const { service } = await createService({
        vehicleFindUnique: () => null,
        workOrderFindMany: () => [],
      });

      await expect(service.lookup(DTO)).rejects.toThrow(CLIENT_PORTAL_NOT_FOUND);
    });

    it('no filtra campos sensibles en la respuesta', async () => {
      const { service } = await createService({
        vehicleFindMany: () => [
          { id: 'v1', plate: 'EKP112', brand: null, model: null, year: null, color: null },
        ],
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [
            makeWorkOrder({
              internalNotes: 'secreto interno',
              createdById: 'user-1',
            }),
          ];
        },
      });

      const account = await service.lookup(DTO);
      const json = JSON.stringify(account);
      expect(json).not.toContain('secreto interno');
      expect(json).not.toContain('createdById');
      expect(json).not.toContain('costSnapshot');
      expect(json).not.toContain('clientConsentTextSnapshot');
    });
  });

  describe('rate limit (huella IP)', () => {
    it('bloquea la huella ya suspendida (429)', async () => {
      const { service, prisma } = await createService({
        attemptFindUnique: () => ({
          id: 'a1',
          fingerprint: 'x',
          attempts: 0,
          windowStartAt: new Date(),
          blockedUntil: new Date(Date.now() + 60_000),
        }),
      });

      await expect(service.lookup(DTO)).rejects.toThrow(
        new HttpException(CLIENT_PORTAL_RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS),
      );
      // No se llegó a consultar el vehículo.
      expect(prisma.vehicle.findUnique).not.toHaveBeenCalled();
    });

    it('bloquea al superar el máximo de intentos en la ventana', async () => {
      const { service, prisma } = await createService({
        attemptFindUnique: () => ({
          id: 'a1',
          fingerprint: 'x',
          attempts: CLIENT_PORTAL_RATE.maxAttempts,
          windowStartAt: new Date(),
          blockedUntil: null,
        }),
      });

      await expect(service.lookup(DTO)).rejects.toThrow(CLIENT_PORTAL_RATE_LIMITED);
      expect(prisma.clientPortalAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ blockedUntil: expect.any(Date) }),
        }),
      );
      expect(prisma.vehicle.findUnique).not.toHaveBeenCalled();
    });

    it('reinicia la ventana cuando pasó el lapso (sin bloquear)', async () => {
      const { service, prisma } = await createService({
        attemptFindUnique: () => ({
          id: 'a1',
          fingerprint: 'x',
          attempts: CLIENT_PORTAL_RATE.maxAttempts,
          windowStartAt: new Date(Date.now() - (CLIENT_PORTAL_RATE.windowMinutes + 1) * 60_000),
          blockedUntil: null,
        }),
        vehicleFindMany: () => [
          { id: 'v1', plate: 'EKP112', brand: 'Chevrolet', model: 'Spark', year: 2018, color: 'Blanco' },
        ],
        workOrderFindMany: (args: WorkOrderFindManyArgs) => {
          if (args.select) return [{ customerPhone: '3005550199' }];
          return [makeWorkOrder()];
        },
      });

      const account = await service.lookup(DTO);
      expect(account.vehicles.length).toBeGreaterThan(0);
      const updateData = prisma.clientPortalAttempt.update.mock.calls[0]![0]!.data;
      expect(updateData.attempts).toBe(1);
      expect(updateData.blockedUntil).toBeNull();
    });
  });

  describe('purga', () => {
    it('borra huellas anteriores a `purgeDays`', async () => {
      const { service, prisma } = await createService();
      await service.purgeOldAttempts();
      const where = prisma.clientPortalAttempt.deleteMany.mock.calls[0]![0]!.where;
      expect(where.updatedAt.lt).toBeInstanceOf(Date);
      expect(where.updatedAt.lt.getTime()).toBeLessThan(Date.now());
    });
  });
});