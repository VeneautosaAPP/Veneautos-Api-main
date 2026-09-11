import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, WorkOrderLineType, WorkOrderStatus } from '@prisma/client';
import { NotesPolicyService } from '../../common/notes-policy/notes-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import type { CreateWorkOrderDto } from './dto/create-work-order.dto';
import type { ListWorkOrdersQueryDto } from './dto/list-work-orders.query.dto';
import type { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { WorkOrdersService } from './work-orders.service';

describe('WorkOrdersService', () => {
  let service: WorkOrdersService;
  let prisma: {
    user: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    workOrder: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    workOrderLine: {
      create: jest.Mock;
    };
    workOrderPayment: { aggregate: jest.Mock };
  };
  let audit: { recordDomain: jest.Mock };
  let notes: { requireOperationalNote: jest.Mock };

  const actorId = 'actor-1';

  const actorOwn: JwtUserPayload = {
    sub: actorId,
    sid: 'sid-1',
    email: 'a@b.c',
    fullName: 'Actor',
    permissions: ['work_orders:read'],
  };

  const actorAll: JwtUserPayload = {
    ...actorOwn,
    permissions: ['work_orders:read', 'work_orders:read_all', 'work_orders:view_financials'],
  };

  beforeEach(async () => {
    audit = { recordDomain: jest.fn().mockResolvedValue(undefined) };
    notes = {
      requireOperationalNote: jest.fn(async (_label: string, raw: string | null | undefined) => {
        const s = (raw ?? '').trim();
        if (s.length < 50) throw new BadRequestException('nota corta');
        return s;
      }),
    };
    prisma = {
      user: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma as never)),
      workOrder: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      workOrderLine: {
        create: jest.fn().mockResolvedValue({ id: 'seeded-labor' }),
      },
      workOrderPayment: { aggregate: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotesPolicyService, useValue: notes },
      ],
    }).compile();

    service = moduleRef.get(WorkOrdersService);
  });

  describe('create', () => {
    it('rechaza alta sin vehículo ni orden origen de garantía', async () => {
      await expect(
        service.create(actorOwn, { description: 'Cambio de aceite y filtros', vehicleId: '' } satisfies CreateWorkOrderDto, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.workOrder.create).not.toHaveBeenCalled();
    });

    it('rechaza vehículo inexistente', async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          actorOwn,
          { description: 'Cambio de aceite', vehicleId: 'no-existe' } satisfies CreateWorkOrderDto,
          {},
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workOrder.create).not.toHaveBeenCalled();
    });

    it('rechaza vehículo inactivo', async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: 'v1',
        isActive: false,
        plate: 'X',
        brand: null,
        notes: null,
        customer: { displayName: 'A', primaryPhone: null },
      });
      await expect(
        service.create(actorOwn, { description: 'Trabajo', vehicleId: 'v1' } satisfies CreateWorkOrderDto, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('con vehículo activo conecta y rellena datos desde cliente', async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: 'v1',
        isActive: true,
        plate: 'ABC123',
        brand: 'MarcaX',
        notes: 'Nota veh',
        customer: { displayName: 'Cliente SA', primaryPhone: '311' },
      });
      prisma.workOrder.create.mockResolvedValue({
        id: 'wo1',
        orderNumber: 5,
        publicCode: 'Tdeadbeef00',
        status: 'UNASSIGNED' as WorkOrderStatus,
        description: 'Desc',
        vehicleId: 'v1',
        customerName: 'Cliente SA',
        customerPhone: '311',
        vehiclePlate: 'ABC123',
        vehicleNotes: 'Nota veh',
        authorizedAmount: null,
        createdById: actorId,
        assignedToId: null,
        vehicle: { customer: {} },
      });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        orderNumber: 5,
        publicCode: 'VEN-0005',
        status: 'UNASSIGNED' as WorkOrderStatus,
        description: 'Desc',
        vehicleId: 'v1',
        customerName: 'Cliente SA',
        customerPhone: '311',
        vehiclePlate: 'ABC123',
        vehicleNotes: 'Nota veh',
        authorizedAmount: null,
        createdById: actorId,
        assignedToId: null,
        vehicle: { customer: {} },
      });

      await service.create(
        actorOwn,
        { description: 'Desc', vehicleId: 'v1' } satisfies CreateWorkOrderDto,
        {},
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.workOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'UNASSIGNED' as WorkOrderStatus,
            publicCode: expect.stringMatching(/^T[0-9a-f]+$/),
            vehicle: { connect: { id: 'v1' } },
            customerName: 'Cliente SA',
            customerPhone: '311',
            vehiclePlate: 'ABC123',
            vehicleBrand: 'MarcaX',
            vehicleNotes: 'Nota veh',
          }),
        }),
      );
      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wo1' },
          data: { publicCode: 'VEN-0005' },
        }),
      );
      // Línea inicial de mano de obra automática al crear la OT.
      expect(prisma.workOrderLine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workOrderId: 'wo1',
            lineType: 'LABOR',
            description: 'MANO DE OBRA',
            quantity: expect.any(Object),
            sortOrder: 0,
          }),
        }),
      );
      expect(audit.recordDomain).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'work_order_lines.created', entityId: 'seeded-labor' }),
      );
    });
  });

  describe('findOne', () => {
    it('404 si no existe', async () => {
      prisma.workOrder.findFirst.mockResolvedValue(null);
      await expect(service.findOne('x', actorOwn)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('incluye paymentSummary', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        orderNumber: 1,
        publicCode: 'VEN-0001',
        status: WorkOrderStatus.RECEIVED,
        description: 'D',
        vehicleId: null,
        customerName: null,
        customerPhone: null,
        vehiclePlate: null,
        vehicleNotes: null,
        internalNotes: null,
        authorizedAmount: new Prisma.Decimal('100'),
        deliveredAt: null,
        createdById: actorId,
        assignedToId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: {},
        assignedTo: null,
        vehicle: null,
        lines: [
          {
            id: 'ln1',
            lineType: WorkOrderLineType.LABOR,
            sortOrder: 0,
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(100),
            discountAmount: null,
            costSnapshot: null,
            taxRateId: null,
            taxRatePercentSnapshot: null,
            taxRate: null,
            workOrderId: 'wo1',
            description: 'MO',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        warrantyFollowUps: [],
        _count: { payments: 2, warrantyFollowUps: 0 },
      });
      prisma.workOrderPayment.aggregate.mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('40') },
      });

      const out = await service.findOne('wo1', actorAll);

      expect(out.paymentSummary).toEqual({
        paymentCount: 2,
        totalPaid: '40',
        remaining: '60',
      });
      expect(out.linesSubtotal).toBe('100');
      expect(out.amountDue).toBe('60');
      expect(out.authorizedAmount).toBeNull();
      expect(out.lines).toHaveLength(1);
    });

    it('404 si la OT es de otro usuario y no hay read_all', async () => {
      prisma.workOrder.findFirst.mockResolvedValue(null);
      await expect(service.findOne('wo-ajena', actorOwn)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rechaza OT entregada', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.DELIVERED,
        deliveredAt: new Date(),
        assignedToId: null,
        authorizedAmount: null,
      });
      await expect(
        service.update('wo1', actorOwn, { description: 'Nuevo texto' } satisfies UpdateWorkOrderDto, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza transición inválida de estado', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.RECEIVED,
        deliveredAt: null,
        assignedToId: null,
        authorizedAmount: null,
      });
      await expect(
        service.update(
          'wo1',
          actorOwn,
          { status: WorkOrderStatus.DELIVERED } satisfies UpdateWorkOrderDto,
          {},
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza pasar a Sin asignar con técnico asignado sin permiso de reasignación', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.RECEIVED,
        deliveredAt: null,
        assignedToId: 'tech-1',
        authorizedAmount: null,
      });
      await expect(
        service.update('wo1', actorOwn, { status: WorkOrderStatus.UNASSIGNED } satisfies UpdateWorkOrderDto, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('con reasignación: estado Sin asignar quita técnico y desconecta asignación', async () => {
      const boss: JwtUserPayload = {
        sub: actorId,
        sid: 'sid-1',
        email: 'a@b.c',
        fullName: 'Boss',
        permissions: ['work_orders:read', 'work_orders:update', 'work_orders:reassign'],
      };
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.RECEIVED,
        deliveredAt: null,
        assignedToId: 'tech-1',
        authorizedAmount: null,
      });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.UNASSIGNED,
        deliveredAt: null,
        vehicleId: null,
        orderNumber: 2,
        publicCode: 'VEN-0002',
        assignedToId: null,
        authorizedAmount: null,
        createdBy: {},
        assignedTo: null,
        vehicle: null,
      });

      await service.update('wo1', boss, { status: WorkOrderStatus.UNASSIGNED } satisfies UpdateWorkOrderDto, {});

      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedTo: { disconnect: true },
            status: WorkOrderStatus.UNASSIGNED,
          }),
        }),
      );
    });

    it('permite marcar entregada con permiso de estado terminal', async () => {
      const closer: JwtUserPayload = {
        ...actorOwn,
        permissions: ['work_orders:read', 'work_orders:update', 'work_orders:set_terminal_status'],
      };
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.READY,
        deliveredAt: null,
        assignedToId: actorId,
        authorizedAmount: null,
      });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.DELIVERED,
        deliveredAt: new Date(),
        vehicleId: null,
        orderNumber: 1,
        publicCode: 'VEN-0001',
        assignedToId: actorId,
        authorizedAmount: null,
        createdBy: {},
        assignedTo: null,
        vehicle: null,
      });
      await service.update('wo1', closer, { status: WorkOrderStatus.DELIVERED } satisfies UpdateWorkOrderDto, {});
      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkOrderStatus.DELIVERED,
            deliveredAt: expect.any(Date),
            cancelledAt: null,
          }),
        }),
      );
    });

    it('marca cancelada: fija cancelledAt y limpia deliveredAt', async () => {
      const closer: JwtUserPayload = {
        ...actorOwn,
        permissions: ['work_orders:read', 'work_orders:update', 'work_orders:set_terminal_status'],
      };
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.READY,
        deliveredAt: null,
        assignedToId: actorId,
        authorizedAmount: null,
      });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.CANCELLED,
        deliveredAt: null,
        cancelledAt: new Date(),
        vehicleId: null,
        orderNumber: 1,
        publicCode: 'VEN-0001',
        assignedToId: actorId,
        authorizedAmount: null,
        createdBy: {},
        assignedTo: null,
        vehicle: null,
      });
      await service.update('wo1', closer, { status: WorkOrderStatus.CANCELLED } satisfies UpdateWorkOrderDto, {});
      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkOrderStatus.CANCELLED,
            cancelledAt: expect.any(Date),
            deliveredAt: null,
          }),
        }),
      );
    });

    it('desvincula vehículo con vehicleId null', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.IN_WORKSHOP,
        deliveredAt: null,
        assignedToId: null,
        authorizedAmount: null,
      });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.IN_WORKSHOP,
        vehicleId: null,
        orderNumber: 3,
        publicCode: 'VEN-0003',
        assignedToId: null,
        authorizedAmount: null,
        createdBy: {},
        assignedTo: null,
        vehicle: null,
      });

      await service.update('wo1', actorOwn, { vehicleId: null } satisfies UpdateWorkOrderDto, {});

      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vehicle: { disconnect: true },
          }),
        }),
      );
    });

    it('vincula vehículo y sincroniza nombres si no vienen en el DTO', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.RECEIVED,
        deliveredAt: null,
        assignedToId: null,
        authorizedAmount: null,
      });
      prisma.vehicle.findUnique.mockResolvedValue({
        id: 'v1',
        isActive: true,
        plate: 'XYZ99',
        brand: 'SyncBrand',
        customer: { displayName: 'Sync Co', primaryPhone: '999' },
      });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.RECEIVED,
        vehicleId: 'v1',
        orderNumber: 1,
        publicCode: 'VEN-0001',
        assignedToId: null,
        authorizedAmount: null,
        createdBy: {},
        assignedTo: null,
        vehicle: { customer: {} },
      });

      await service.update('wo1', actorOwn, { vehicleId: 'v1' } satisfies UpdateWorkOrderDto, {});

      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vehicle: { connect: { id: 'v1' } },
            customerName: 'Sync Co',
            customerPhone: '999',
            vehiclePlate: 'XYZ99',
            vehicleBrand: 'SyncBrand',
          }),
        }),
      );
    });
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);
    });

    it('filtra por vehicleId; con read sin read_all aplica visibilidad de taller (cola + asignadas + propias)', async () => {
      await service.list(actorOwn, { vehicleId: 'v-uuid' } satisfies ListWorkOrdersQueryDto);
      const visibilityOr = [
        { createdById: actorId },
        { assignedToId: actorId },
        { assignedToId: null, status: WorkOrderStatus.UNASSIGNED },
      ];
      const listWhere = {
        AND: [{ OR: visibilityOr }, { vehicleId: 'v-uuid' }],
      };
      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: listWhere,
          skip: 0,
          take: 50,
        }),
      );
      expect(prisma.workOrder.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: listWhere,
        }),
      );
    });

    it('con read_all no filtra por creador', async () => {
      await service.list(actorAll, { vehicleId: 'v-uuid' } satisfies ListWorkOrdersQueryDto);
      const arg = prisma.workOrder.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where.vehicleId).toBe('v-uuid');
      expect(arg.where.createdById).toBeUndefined();
    });

    it('filtra por customerId (vehículos del cliente)', async () => {
      await service.list(actorAll, { customerId: 'cust-1' } satisfies ListWorkOrdersQueryDto);
      const arg = prisma.workOrder.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where.vehicle).toEqual({ is: { customerId: 'cust-1' } });
    });

    it('con read sin read_all incluye cola sin asignar y OT asignadas al actor (perfil técnico)', async () => {
      await service.list(actorOwn, {} satisfies ListWorkOrdersQueryDto);
      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { createdById: actorId },
              { assignedToId: actorId },
              { assignedToId: null, status: WorkOrderStatus.UNASSIGNED },
            ],
          }),
        }),
      );
    });

    it('pagina con page y pageSize', async () => {
      prisma.workOrder.findMany.mockResolvedValue([{ id: 'a' }]);
      prisma.workOrder.count.mockResolvedValue(120);
      const res = await service.list(actorAll, {
        page: 2,
        pageSize: 25,
      } satisfies ListWorkOrdersQueryDto);
      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 25,
          take: 25,
        }),
      );
      expect(res).toEqual({ items: [{ id: 'a', authorizedAmount: null }], total: 120 });
    });
  });

  describe('reopenDelivered', () => {
    const LONG = 'x'.repeat(50);
    const actorReopen: JwtUserPayload = {
      sub: actorId,
      sid: 'sid-1',
      email: 'a@b.c',
      fullName: 'Admin',
      permissions: ['work_orders:read', 'work_orders:read_all', 'work_orders:reopen_delivered'],
    };

    it('sin permiso: Forbidden', async () => {
      await expect(
        service.reopenDelivered('wo1', actorOwn, { note: LONG, justification: LONG }, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reabre ENTREGADA a LISTA y audita', async () => {
      prisma.workOrder.findFirst
        .mockResolvedValueOnce({ id: 'wo1' })
        .mockResolvedValueOnce({
          id: 'wo1',
          status: WorkOrderStatus.DELIVERED,
          orderNumber: 9,
          internalNotes: null,
        });
      prisma.workOrder.update.mockResolvedValue({
        id: 'wo1',
        status: WorkOrderStatus.READY,
        orderNumber: 9,
        publicCode: 'VEN-0009',
        createdBy: {},
        assignedTo: null,
        vehicle: { customer: {} },
      });

      await service.reopenDelivered(
        'wo1',
        actorReopen,
        { note: `${LONG} nota`, justification: `${LONG} just` },
        {},
      );

      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wo1' },
          data: expect.objectContaining({
            status: WorkOrderStatus.READY,
            deliveredAt: null,
          }),
        }),
      );
      expect(audit.recordDomain).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'work_orders.reopened_from_delivered' }),
      );
    });
  });

  describe('lookupPublicByCodeAndPlate', () => {
    const baseRow = {
      status: WorkOrderStatus.IN_WORKSHOP,
      publicCode: 'VEN-0041',
      orderNumber: 41,
      description: 'Test',
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      deliveredAt: null,
      customerName: 'Juan',
      vehicleBrand: 'Toy',
      vehicleModel: 'Y',
      vehicleId: 'veh1',
    };

    it('acepta placa que coincide con la snapshot aunque plateNorm del vehículo difiera', async () => {
      prisma.workOrder.findUnique.mockResolvedValue({
        ...baseRow,
        vehiclePlate: 'EKP 112',
        vehicle: { plateNorm: 'ABC999', plate: 'ABC999', isActive: true },
      });
      const r = await service.lookupPublicByCodeAndPlate({
        publicCode: 'VEN-0041',
        plate: 'EKP-112',
      });
      expect(r.publicCode).toBe('VEN-0041');
    });

    it('404 si ningún candidato coincide', async () => {
      prisma.workOrder.findUnique.mockResolvedValue({
        ...baseRow,
        vehiclePlate: 'ABC999',
        vehicle: { plateNorm: 'ABC999', plate: 'ABC999', isActive: true },
      });
      await expect(
        service.lookupPublicByCodeAndPlate({ publicCode: 'VEN-0041', plate: 'EKP112' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('vehículo inactivo: puede matchear solo con plate del maestro', async () => {
      prisma.workOrder.findUnique.mockResolvedValue({
        ...baseRow,
        vehiclePlate: null,
        vehicle: { plateNorm: 'EKP112', plate: 'EKP112', isActive: false },
      });
      const r = await service.lookupPublicByCodeAndPlate({
        publicCode: 'VEN-0041',
        plate: 'EKP112',
      });
      expect(r.publicCode).toBe('VEN-0041');
      expect(r.vehiclePlate).toBe('EKP112');
    });
  });
});
