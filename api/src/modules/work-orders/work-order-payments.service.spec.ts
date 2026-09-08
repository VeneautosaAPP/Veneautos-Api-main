import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CashMovementDirection,
  CashSessionStatus,
  Prisma,
  WorkOrderLineType,
  WorkOrderStatus,
} from '@prisma/client';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { formatWorkOrderPublicCode } from './work-order-public-code';
import { WorkOrderPaymentsService } from './work-order-payments.service';
import { WorkOrdersService } from './work-orders.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';

const WO_ID = 'clwo0000000000000000000001';
const USER_ID = 'clusr000000000000000000001';

const LONG_NOTE = 'Nota operativa de cobro con suficiente texto. '.repeat(2);

function laborLine(unitPrice: string) {
  return {
    id: `ln-${unitPrice}`,
    lineType: WorkOrderLineType.LABOR,
    quantity: new Prisma.Decimal(1),
    unitPrice: new Prisma.Decimal(unitPrice),
    discountAmount: null,
    costSnapshot: null,
    taxRateId: null,
    taxRatePercentSnapshot: null,
    taxRate: null,
  };
}

const payActor = (sub: string): JwtUserPayload => ({
  sub,
  sid: 's',
  email: 'p@p.c',
  fullName: 'Pay',
  permissions: [],
});

describe('WorkOrderPaymentsService', () => {
  let service: WorkOrderPaymentsService;
  let prisma: { $transaction: jest.Mock };
  let audit: { recordDomain: jest.Mock };
  let notes: { requireOperationalNote: jest.Mock };
  let workOrders: { assertWorkOrderVisible: jest.Mock };

  function makeTx(setup: {
    wo?: {
      id: string;
      orderNumber: number;
      publicCode?: string;
      status: WorkOrderStatus;
    } | null;
    lines?: ReturnType<typeof laborLine>[];
    paidSum?: Prisma.Decimal | null;
    session?: { id: string } | null;
    category?: { id: string; slug: string; direction: CashMovementDirection } | null;
    categoryDirection?: CashMovementDirection;
  }) {
    const movement = {
      id: 'mov-1',
      category: { slug: 'ingreso_cobro' },
      createdBy: { id: USER_ID, email: 'a@b.c', fullName: 'Test' },
    };
    const payment = {
      id: 'pay-1',
      recordedBy: { id: USER_ID, email: 'a@b.c', fullName: 'Test' },
      cashMovement: { category: { slug: 'ingreso_cobro' } },
    };

    return {
      $executeRaw: jest.fn().mockResolvedValue(1),
      workOrder: {
        findUnique: jest.fn().mockResolvedValue(
          setup.wo
            ? {
                ...setup.wo,
                publicCode: setup.wo.publicCode ?? formatWorkOrderPublicCode(setup.wo.orderNumber),
              }
            : null,
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      workOrderLine: {
        findMany: jest.fn().mockResolvedValue(setup.lines ?? [laborLine('500')]),
      },
      workOrderPayment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: setup.paidSum ?? null } }),
        create: jest.fn().mockResolvedValue(payment),
      },
      cashSession: {
        findFirst: jest.fn().mockImplementation(async (args: { where: { status: string } }) => {
          if (args.where.status === CashSessionStatus.OPEN) {
            return setup.session === undefined ? { id: 'sess-1' } : setup.session;
          }
          return null;
        }),
      },
      cashMovementCategory: {
        findUnique: jest.fn().mockImplementation(async () => {
          if (setup.category === null) {
            return null;
          }
          if (setup.category) {
            return setup.category;
          }
          return {
            id: 'cat-1',
            slug: 'ingreso_cobro',
            direction: setup.categoryDirection ?? CashMovementDirection.INCOME,
          };
        }),
      },
      cashMovement: {
        create: jest.fn().mockResolvedValue(movement),
      },
    };
  }

  function makeRemoveTx(setup: {
    wo?: {
      id: string;
      orderNumber: number;
      publicCode?: string;
      status: WorkOrderStatus;
    } | null;
    payment?: {
      id: string;
      kind: 'PARTIAL' | 'FULL_SETTLEMENT';
      amount: string;
      note?: string | null;
      cashMovement?: { id: string } | null;
    } | null;
  }) {
    return {
      $executeRaw: jest.fn().mockResolvedValue(1),
      workOrder: {
        findUnique: jest.fn().mockResolvedValue(
          setup.wo
            ? {
                ...setup.wo,
                publicCode: setup.wo.publicCode ?? formatWorkOrderPublicCode(setup.wo.orderNumber),
              }
            : null,
        ),
      },
      workOrderPayment: {
        findFirst: jest.fn().mockResolvedValue(setup.payment ?? null),
        delete: jest.fn().mockResolvedValue({}),
      },
      cashMovement: {
        delete: jest.fn().mockResolvedValue({}),
      },
    };
  }

  beforeEach(async () => {
    audit = { recordDomain: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      $transaction: jest.fn(),
    };
    notes = {
      requireOperationalNote: jest.fn(
        async (_label: string, raw: string | null | undefined, scope?: string) => {
          const min = scope === 'work_order_payment' ? 70 : 50;
          const s = (raw ?? '').trim();
          if (s.length < min) {
            throw new BadRequestException('nota corta');
          }
          return s;
        },
      ),
    };
    workOrders = { assertWorkOrderVisible: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkOrderPaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotesPolicyService, useValue: notes },
        { provide: WorkOrdersService, useValue: workOrders },
      ],
    }).compile();

    service = moduleRef.get(WorkOrderPaymentsService);
  });

  it('rechaza monto cero sin abrir transacción', async () => {
    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '0', note: LONG_NOTE },
        { ip: undefined, userAgent: undefined },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza OT cancelada', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.CANCELLED,
          },
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '10', note: LONG_NOTE },
        { ip: undefined, userAgent: undefined },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza OT sin asignar (cola)', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.UNASSIGNED,
          },
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '10', note: LONG_NOTE },
        { ip: undefined, userAgent: undefined },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza OT entregada', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.DELIVERED,
          },
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '10', note: LONG_NOTE },
        { ip: undefined, userAgent: undefined },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza abono si el acumulado superaría el total de la orden', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.RECEIVED,
          },
          lines: [laborLine('100')],
          paidSum: new Prisma.Decimal('80'),
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '30', note: LONG_NOTE },
        { ip: undefined, userAgent: undefined },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza sin sesión de caja abierta', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.RECEIVED,
          },
          session: null,
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '10', note: LONG_NOTE },
        { ip: undefined, userAgent: undefined },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza categoría inexistente', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.RECEIVED,
          },
          category: null,
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '10', categorySlug: 'no_existe', note: LONG_NOTE },
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza categoría que no es ingreso', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.RECEIVED,
          },
          categoryDirection: CashMovementDirection.EXPENSE,
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '10', note: LONG_NOTE },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza abono que liquida el total (debe usar pago total)', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.RECEIVED,
          },
          lines: [laborLine('100')],
          paidSum: new Prisma.Decimal('80'),
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'partial', amount: '20', note: LONG_NOTE },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza pago total si el monto no iguala el saldo', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 1,
            status: WorkOrderStatus.RECEIVED,
          },
          lines: [laborLine('100')],
          paidSum: new Prisma.Decimal('0'),
        }),
      ),
    );

    await expect(
      service.record(
        WO_ID,
        payActor(USER_ID),
        { paymentKind: 'full', amount: '50', note: LONG_NOTE },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('registra cobro y audita dos eventos', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      fn(
        makeTx({
          wo: {
            id: WO_ID,
            orderNumber: 7,
            status: WorkOrderStatus.RECEIVED,
          },
          paidSum: new Prisma.Decimal('100'),
        }),
      ),
    );

    const out = await service.record(
      WO_ID,
      payActor(USER_ID),
      { paymentKind: 'partial', amount: '50', note: LONG_NOTE },
      {
        ip: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(out.id).toBe('pay-1');
    expect(audit.recordDomain).toHaveBeenCalledTimes(2);
    expect(audit.recordDomain.mock.calls[0][0].action).toBe('work_orders.payment_recorded');
    expect(audit.recordDomain.mock.calls[1][0].action).toBe('cash_movements.income');
  });

  it('pago total marca entregada y audita tres eventos', async () => {
    const txHolder: { tx?: ReturnType<typeof makeTx> } = {};
    prisma.$transaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      txHolder.tx = makeTx({
        wo: {
          id: WO_ID,
          orderNumber: 7,
          status: WorkOrderStatus.READY,
        },
        lines: [laborLine('150')],
        paidSum: new Prisma.Decimal('50'),
      });
      return fn(txHolder.tx);
    });

    await service.record(
      WO_ID,
      payActor(USER_ID),
      { paymentKind: 'full', amount: '100', note: LONG_NOTE },
      {},
    );

    expect(txHolder.tx!.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WO_ID },
        data: expect.objectContaining({ status: WorkOrderStatus.DELIVERED }),
      }),
    );
    expect(audit.recordDomain).toHaveBeenCalledTimes(3);
    expect(audit.recordDomain.mock.calls[2][0].action).toBe('work_orders.delivered_by_full_payment');
  });

  describe('remove', () => {
    const baseWo = { id: WO_ID, orderNumber: 7, status: WorkOrderStatus.RECEIVED };
    const partialPayment = {
      id: 'pay-1',
      kind: 'PARTIAL' as const,
      amount: '50000',
      note: 'Abono registrado',
      cashMovement: { id: 'mov-1' },
    };
    const REASON = 'Motivo: el cliente canceló el abono y pidió devolver el dinero en efectivo. '.repeat(2);

    function runRemove(setup: Parameters<typeof makeRemoveTx>[0], reason = REASON) {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: ReturnType<typeof makeRemoveTx>) => Promise<unknown>) =>
          fn(makeRemoveTx(setup)),
      );
      return service.remove(WO_ID, 'pay-1', payActor(USER_ID), { reason }, { ip: '127.0.0.1', userAgent: 'jest' });
    }

    it('rechaza motivo corto sin abrir transacción', async () => {
      await expect(
        service.remove(WO_ID, 'pay-1', payActor(USER_ID), { reason: 'corto' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza OT entregada', async () => {
      await expect(
        runRemove({ wo: { ...baseWo, status: WorkOrderStatus.DELIVERED }, payment: partialPayment }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza OT cancelada', async () => {
      await expect(
        runRemove({ wo: { ...baseWo, status: WorkOrderStatus.CANCELLED }, payment: partialPayment }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza pago que no pertenece a la orden', async () => {
      await expect(runRemove({ wo: baseWo, payment: null })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza la liquidación total (FULL_SETTLEMENT)', async () => {
      await expect(
        runRemove({ wo: baseWo, payment: { ...partialPayment, kind: 'FULL_SETTLEMENT' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('elimina el abono y su ingreso de caja 1:1, y audita', async () => {
      const txHolder: { tx?: ReturnType<typeof makeRemoveTx> } = {};
      prisma.$transaction.mockImplementation(
        async (fn: (tx: ReturnType<typeof makeRemoveTx>) => Promise<unknown>) => {
          txHolder.tx = makeRemoveTx({ wo: baseWo, payment: partialPayment });
          return fn(txHolder.tx);
        },
      );

      await service.remove(WO_ID, 'pay-1', payActor(USER_ID), { reason: REASON }, {});

      expect(txHolder.tx!.workOrderPayment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
      expect(txHolder.tx!.cashMovement.delete).toHaveBeenCalledWith({ where: { id: 'mov-1' } });
      expect(audit.recordDomain).toHaveBeenCalledTimes(1);
      expect(audit.recordDomain.mock.calls[0][0].action).toBe('work_orders.payment_deleted');
    });
  });
});
