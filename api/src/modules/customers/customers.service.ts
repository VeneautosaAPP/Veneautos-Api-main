import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';

const PRISMA_FK_VIOLATION = 'P2003';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actorUserId: string,
    dto: CreateCustomerDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const row = await this.prisma.customer.create({
      data: {
        displayName: dto.displayName.trim(),
        primaryPhone: dto.primaryPhone?.trim() ?? null,
        email: dto.email?.trim().toLowerCase() ?? null,
        documentId: dto.documentId?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
      },
    });
    await this.audit.recordDomain({
      actorUserId,
      action: 'customers.created',
      entityType: 'Customer',
      entityId: row.id,
      previousPayload: null,
      nextPayload: { displayName: row.displayName },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return row;
  }

  async list() {
    return this.prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      take: 200,
      include: { _count: { select: { vehicles: true } } },
    });
  }

  /** Búsqueda rápida para enlazar OT a cliente existente (nombre, teléfono o documento). */
  async search(q: string) {
    const t = q.trim();
    if (t.length < 2) {
      throw new BadRequestException('Escribí al menos 2 caracteres para buscar');
    }
    return this.prisma.customer.findMany({
      where: {
        isActive: true,
        OR: [
          { displayName: { contains: t, mode: 'insensitive' } },
          { primaryPhone: { contains: t, mode: 'insensitive' } },
          { documentId: { contains: t, mode: 'insensitive' } },
        ],
      },
      orderBy: { displayName: 'asc' },
      take: 30,
      select: {
        id: true,
        displayName: true,
        primaryPhone: true,
        documentId: true,
        email: true,
        _count: { select: { vehicles: true } },
      },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: { vehicles: { where: { isActive: true }, orderBy: { plateNorm: 'asc' } } },
    });
    if (!row) {
      throw new NotFoundException('Cliente no encontrado');
    }
    return row;
  }

  async update(
    id: string,
    actorUserId: string,
    dto: UpdateCustomerDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const keys = Object.keys(dto).filter((k) => dto[k as keyof UpdateCustomerDto] !== undefined);
    if (keys.length === 0) {
      throw new BadRequestException('No hay campos para actualizar');
    }

    const before = await this.prisma.customer.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException('Cliente no encontrado');
    }
    const row = await this.prisma.customer.update({
      where: { id },
      data: {
        displayName: dto.displayName?.trim(),
        primaryPhone: dto.primaryPhone !== undefined ? dto.primaryPhone?.trim() ?? null : undefined,
        email: dto.email !== undefined ? dto.email?.trim().toLowerCase() ?? null : undefined,
        documentId: dto.documentId !== undefined ? dto.documentId?.trim() ?? null : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() ?? null : undefined,
        isActive: dto.isActive,
      },
    });
    await this.audit.recordDomain({
      actorUserId,
      action: 'customers.updated',
      entityType: 'Customer',
      entityId: id,
      previousPayload: { displayName: before.displayName, isActive: before.isActive },
      nextPayload: { displayName: row.displayName, isActive: row.isActive },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return row;
  }

  /** Vehículos activos del cliente (sub-recurso para listados). */
  async listVehicles(customerId: string) {
    const exists = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Cliente no encontrado');
    }
    return this.prisma.vehicle.findMany({
      where: { customerId, isActive: true },
      orderBy: { plateNorm: 'asc' },
      select: {
        id: true,
        plate: true,
        plateNorm: true,
        brand: true,
        model: true,
        year: true,
        isActive: true,
      },
    });
  }

  /**
   * Elimina un cliente solo si no tiene vehículos registrados (ni activos ni inactivos).
   * Un cliente con vehículos arrastra histórico de OT (por vehículo) y no debe borrarse.
   */
  async remove(
    id: string,
    actorUserId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const before = await this.prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { vehicles: true } } },
    });
    if (!before) {
      throw new NotFoundException('Cliente no encontrado');
    }
    if (before._count.vehicles > 0) {
      throw new BadRequestException(
        `No se puede eliminar: este cliente tiene ${before._count.vehicles} vehículo(s) registrados.`,
      );
    }
    try {
      await this.prisma.customer.delete({ where: { id } });
    } catch (err) {
      const code = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
      if (code === PRISMA_FK_VIOLATION) {
        throw new BadRequestException(
          'No se puede eliminar: el cliente tiene registros vinculados (facturas o usuarios de portal).',
        );
      }
      throw err;
    }
    await this.audit.recordDomain({
      actorUserId,
      action: 'customers.deleted',
      entityType: 'Customer',
      entityId: id,
      previousPayload: { displayName: before.displayName, isActive: before.isActive },
      nextPayload: null,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { id, deleted: true };
  }
}
