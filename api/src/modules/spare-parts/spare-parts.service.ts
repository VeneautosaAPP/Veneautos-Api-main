import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SparePart } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ceilWholeCop } from '../../common/money/cop-money';
import type { CreateSparePartDto } from './dto/create-spare-part.dto';
import type { FreeTextSparePartDto } from './dto/free-text-spare-part.dto';
import type { UpdateSparePartDto } from './dto/update-spare-part.dto';

/** SKU normalizado: mayúsculas y solo alfanumérico (compatible con lector de código de barras). */
export function normalizeSparePartSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/**
 * Siguiente SKU automático consecutivo con formato R#### (R0001, R0002, …).
 * Solo cuenta SKUs autogenerados (patrón R y dígitos); el resto se ignora.
 */
export function computeNextSku(existingSkus: string[]): string {
  let max = 0;
  for (const sku of existingSkus) {
    const match = /^R(\d{1,})$/.exec(sku);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `R${String(max + 1).padStart(4, '0')}`;
}

const SKU_MAX = 80;
const NAME_MAX = 500;
const PRICE_MAX = new Prisma.Decimal('999999999999');

/**
 * Vigencia de la caché en memoria del catálogo/búsquedas.
 *
 * El catálogo cambia poco y se consulta en cada tecla del buscador de la OT. Con API y base en
 * Railway, el costo dominante era el viaje a la base por cada búsqueda; con esta caché las
 * búsquedas repetidas se responden desde memoria. Se invalida por completo ante cualquier alta,
 * edición, borrado o importación (ver `invalidateCache`).
 */
const LIST_CACHE_TTL_MS = 30_000;
const LIST_CACHE_MAX_ENTRIES = 200;

type ListResult = { items: SparePart[]; total: number };

@Injectable()
export class SparePartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private readonly listCache = new Map<string, { at: number; value: ListResult }>();

  /** Vacía la caché de listados: se llama tras cualquier escritura en el catálogo. */
  private invalidateCache(): void {
    this.listCache.clear();
  }

  async list(q: string | undefined, limit: number, offset: number): Promise<ListResult> {
    const term = q?.trim();
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safeOffset = Math.max(offset, 0);
    const cacheKey = `${term ?? ''}|${safeLimit}|${safeOffset}`;

    const cached = this.listCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < LIST_CACHE_TTL_MS) {
      return cached.value;
    }

    const where: Prisma.SparePartWhereInput | undefined = term
      ? {
          OR: [
            { sku: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const value = await this.prisma
      .$transaction([
        this.prisma.sparePart.findMany({
          where,
          orderBy: [{ name: 'asc' }, { sku: 'asc' }],
          take: safeLimit,
          skip: safeOffset,
        }),
        this.prisma.sparePart.count({ where }),
      ])
      .then(([items, total]) => ({ items, total }));

    if (this.listCache.size >= LIST_CACHE_MAX_ENTRIES) {
      const oldest = this.listCache.keys().next().value;
      if (oldest !== undefined) this.listCache.delete(oldest);
    }
    this.listCache.set(cacheKey, { at: now, value });
    return value;
  }

  private parsePrice(raw?: string | null): Prisma.Decimal {
    if (!raw?.trim()) return new Prisma.Decimal(0);
    const value = ceilWholeCop(new Prisma.Decimal(raw.trim()));
    if (value.lt(0)) {
      throw new BadRequestException('El precio no puede ser negativo');
    }
    if (value.gt(PRICE_MAX)) {
      throw new BadRequestException('El precio supera el máximo permitido');
    }
    return value;
  }

  async create(
    actorUserId: string,
    dto: CreateSparePartDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const sku = normalizeSparePartSku(dto.sku);
    if (!sku) throw new BadRequestException('El SKU no puede quedar vacío');
    if (sku.length > SKU_MAX) {
      throw new BadRequestException(`El SKU supera los ${SKU_MAX} caracteres`);
    }
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('La descripción no puede quedar vacía');
    if (name.length > NAME_MAX) {
      throw new BadRequestException(`La descripción supera los ${NAME_MAX} caracteres`);
    }

    const existing = await this.prisma.sparePart.findUnique({ where: { sku } });
    if (existing) {
      throw new ConflictException('Ya existe un repuesto con ese SKU.');
    }

    const row = await this.prisma.sparePart.create({
      data: { sku, name, price: this.parsePrice(dto.price) },
    });

    await this.audit.recordDomain({
      actorUserId,
      action: 'repuestos.created',
      entityType: 'SparePart',
      entityId: row.id,
      previousPayload: null,
      nextPayload: { sku: row.sku, name: row.name, price: row.price.toString() },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    this.invalidateCache();
    return row;
  }

  /**
   * Alta por texto libre (foco autopiezas): si el texto ya coincide con un SKU
   * o con un nombre existente, devuelve ese repuesto sin crear duplicados;
   * si no, lo crea con el siguiente SKU automático consecutivo (R####) y precio variable.
   */
  async createFromFreeText(
    actorUserId: string,
    dto: FreeTextSparePartDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('La descripción no puede quedar vacía');
    if (name.length > NAME_MAX) {
      throw new BadRequestException(`La descripción supera los ${NAME_MAX} caracteres`);
    }

    const normalizedSku = normalizeSparePartSku(name);
    const bySku = normalizedSku
      ? await this.prisma.sparePart.findUnique({ where: { sku: normalizedSku } })
      : null;
    if (bySku) return bySku;

    const byName = await this.prisma.sparePart.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (byName) return byName;

    let row: SparePart | null = null;
    for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
      const existingSkus = (
        await this.prisma.sparePart.findMany({ select: { sku: true } })
      ).map((r) => r.sku);
      const candidate = computeNextSku(existingSkus);
      try {
        row = await this.prisma.sparePart.create({
          data: { sku: candidate, name, price: new Prisma.Decimal(0) },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          continue;
        }
        throw e;
      }
    }
    if (!row) {
      throw new ConflictException('No se pudo asignar un SKU automático único. Intentá de nuevo.');
    }

    await this.audit.recordDomain({
      actorUserId,
      action: 'repuestos.created',
      entityType: 'SparePart',
      entityId: row.id,
      previousPayload: null,
      nextPayload: {
        sku: row.sku,
        name: row.name,
        price: '0',
        source: 'free-text',
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    this.invalidateCache();
    return row;
  }

  async update(
    id: string,
    actorUserId: string,
    dto: UpdateSparePartDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const before = await this.prisma.sparePart.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Repuesto no encontrado en el catálogo');

    const keys = Object.keys(dto).filter((k) => dto[k as keyof UpdateSparePartDto] !== undefined);
    if (keys.length === 0) {
      throw new BadRequestException('No hay campos para actualizar');
    }

    let sku: string | undefined;
    if (dto.sku !== undefined) {
      sku = normalizeSparePartSku(dto.sku);
      if (!sku) throw new BadRequestException('El SKU no puede quedar vacío');
      if (sku.length > SKU_MAX) {
        throw new BadRequestException(`El SKU supera los ${SKU_MAX} caracteres`);
      }
      if (sku !== before.sku) {
        const clash = await this.prisma.sparePart.findUnique({ where: { sku } });
        if (clash) throw new ConflictException('Ya existe un repuesto con ese SKU.');
      }
    }

    let name: string | undefined;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      if (!name) throw new BadRequestException('La descripción no puede quedar vacía');
      if (name.length > NAME_MAX) {
        throw new BadRequestException(`La descripción supera los ${NAME_MAX} caracteres`);
      }
    }

    const price = dto.price !== undefined ? this.parsePrice(dto.price) : undefined;

    const row = await this.prisma.sparePart.update({
      where: { id },
      data: { sku, name, price },
    });

    await this.audit.recordDomain({
      actorUserId,
      action: 'repuestos.updated',
      entityType: 'SparePart',
      entityId: id,
      previousPayload: {
        sku: before.sku,
        name: before.name,
        price: before.price.toString(),
      },
      nextPayload: {
        sku: row.sku,
        name: row.name,
        price: row.price.toString(),
        fields: keys,
      },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    this.invalidateCache();
    return row;
  }

  async remove(
    id: string,
    actorUserId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const before = await this.prisma.sparePart.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Repuesto no encontrado en el catálogo');

    await this.prisma.sparePart.delete({ where: { id } });

    await this.audit.recordDomain({
      actorUserId,
      action: 'repuestos.deleted',
      entityType: 'SparePart',
      entityId: id,
      previousPayload: { sku: before.sku, name: before.name, price: before.price.toString() },
      nextPayload: null,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    this.invalidateCache();
    return { id, sku: before.sku };
  }

  async exportXlsx(): Promise<{ buffer: Buffer; filename: string }> {
    const rows = await this.prisma.sparePart.findMany({
      orderBy: [{ name: 'asc' }, { sku: 'asc' }],
    });

    const header = ['SKU', 'NOMBRE', 'PRECIO'];
    const body = rows.map((r) => [r.sku, r.name, Number.parseFloat(r.price.toString())]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = [{ wch: 20 }, { wch: 70 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Repuestos');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const ymd = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `repuestos_${ymd}.xlsx` };
  }

  async importXlsx(
    file?: Express.Multer.File,
    actorUserId?: string,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Adjuntá un archivo XLSX con el catálogo.');
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('El archivo no es un XLSX válido.');
    }

    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new BadRequestException('El archivo no tiene hojas.');
    const ws = workbook.Sheets[firstSheet];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
    if (!rawRows.length) throw new BadRequestException('El archivo está vacío.');

    let startRow = 0;
    if (rawRows[0]) {
      const first = rawRows[0].map((c) => String(c ?? '').trim().toUpperCase());
      const looksLikeHeader = first.some((c) => c === 'SKU' || c === 'SK' || c === 'NOMBRE' || c === 'PARTE');
      if (looksLikeHeader) startRow = 1;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let invalid = 0;

    await this.prisma.$transaction(async (tx) => {
      for (let i = startRow; i < rawRows.length; i += 1) {
        const cells = rawRows[i] ?? [];
        const sku = normalizeSparePartSku(String(cells[0] ?? ''));

        if (!sku) {
          invalid += 1;
          continue;
        }

        const name = String(cells[1] ?? '').trim();
        const priceRaw = String(cells[2] ?? '').replace(/[^\d.,-]/g, '');
        let price = new Prisma.Decimal(0);
        if (priceRaw) {
          const normalized = priceRaw.replace(/\./g, '').replace(',', '.');
          try {
            price = ceilWholeCop(new Prisma.Decimal(normalized));
          } catch {
            invalid += 1;
            continue;
          }
          if (price.lt(0)) {
            invalid += 1;
            continue;
          }
        }

        const existing = await tx.sparePart.findUnique({ where: { sku } });
        if (existing) {
          const same =
            existing.name === name && existing.price.equals(price);
          if (!same) {
            await tx.sparePart.update({
              where: { id: existing.id },
              data: { name: name || existing.name, price },
            });
            updated += 1;
          } else {
            skipped += 1;
          }
        } else {
          await tx.sparePart.create({
            data: { sku, name: name || sku, price },
          });
          created += 1;
        }
      }
    });

    if (actorUserId) {
      await this.audit.recordDomain({
        actorUserId,
        action: 'repuestos.imported',
        entityType: 'SparePart',
        entityId: null,
        previousPayload: null,
        nextPayload: { created, updated, skipped, invalid },
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }

    this.invalidateCache();
    return { created, updated, skipped, invalid };
  }
}