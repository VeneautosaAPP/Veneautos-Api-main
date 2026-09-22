import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: {
    customer: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let audit: { recordDomain: jest.Mock };

  beforeEach(async () => {
    audit = { recordDomain: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      customer: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(CustomersService);
  });

  it('create persiste y audita', async () => {
    prisma.customer.create.mockResolvedValue({
      id: 'c1',
      displayName: 'Juan Pérez',
      primaryPhone: '300',
      email: null,
      documentId: null,
      notes: null,
      isActive: true,
    });

    const out = await service.create('u1', { displayName: '  Juan Pérez  ', primaryPhone: '300' }, {});

    expect(out.id).toBe('c1');
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: {
        displayName: 'Juan Pérez',
        primaryPhone: '300',
        email: null,
        documentId: null,
        notes: null,
      },
    });
    expect(audit.recordDomain).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'customers.created', entityId: 'c1' }),
    );
  });

  it('findOne lanza si no existe', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(service.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update rechaza cuerpo vacío', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'c1', displayName: 'A', isActive: true });
    await expect(service.update('c1', 'u1', {}, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listVehicles lanza si cliente no existe', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(service.listVehicles('bad')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove lanza si el cliente no existe', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(service.remove('x', 'u1', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.delete).not.toHaveBeenCalled();
  });

  it('remove rechaza clientes con vehículos registrados', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c1',
      displayName: 'Juan Pérez',
      isActive: true,
      _count: { vehicles: 2 },
    });
    await expect(service.remove('c1', 'u1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.delete).not.toHaveBeenCalled();
    expect(audit.recordDomain).not.toHaveBeenCalled();
  });

  it('remove borra clientes sin vehículos y audita', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c1',
      displayName: 'Juan Pérez',
      isActive: true,
      _count: { vehicles: 0 },
    });
    prisma.customer.delete.mockResolvedValue({ id: 'c1' });

    const out = await service.remove('c1', 'u1', { ip: '127.0.0.1' });

    expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(out).toEqual({ id: 'c1', deleted: true });
    expect(audit.recordDomain).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customers.deleted',
        entityType: 'Customer',
        entityId: 'c1',
        previousPayload: { displayName: 'Juan Pérez', isActive: true },
        nextPayload: null,
        ipAddress: '127.0.0.1',
      }),
    );
  });
});
