/**
 * Portal público de clientes (`POST /client-portal/account`).
 *
 * Identifica al cliente del taller por **placa + celular** (pares que el taller sí tiene
 * de forma fiable) y devuelve una vista de solo lectura: vehículos del cliente, sus órdenes
 * de trabajo con líneas/importes y las facturas emitidas.
 *
 * Seguridad:
 * - Nunca se expone, ni por URL ni por JWT, nada del panel interno.
 * - La respuesta excluye `internalNotes`, `createdBy*`, `costSnapshot`, firma/consentimiento.
 * - Rate limit por huella SHA-256 de IP (tabla `ClientPortalAttempt`); la huella no es el IP crudo.
 * - Error genérico: no revela si falló la placa o el celular, ni si el vehículo existe.
 */
import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvoiceStatus, Prisma, WorkOrderStatus } from '@prisma/client';
import {
  computeBillingTotals,
  computeLineTotals,
  type LineForTotals,
} from '../../common/billing/billing-totals';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ReceiptsService,
  type WorkOrderForReceipt,
} from '../receipts/receipts.service';
import { comparableVehiclePlate, normalizeVehiclePlate } from '../vehicles/vehicle-plate.util';
import {
  CLIENT_PORTAL_NOT_FOUND,
  CLIENT_PORTAL_RATE,
  CLIENT_PORTAL_RATE_LIMITED,
} from './client-portal.constants';
import type { LookupClientPortalDto } from './dto/lookup-client-portal.dto';
import type { ReceiptClientPortalDto } from './dto/receipt-client-portal.dto';

const ZERO = new Prisma.Decimal(0);

/** Teléfono normalizado: solo dígitos; si alcanza los 10, se usa el sufijo (celulares CO). */
function normalizePortalPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 7) {
    return null;
  }
  return digits.slice(-10);
}

type PortalScope =
  | { kind: 'customer'; ownerId: string; vehicleIds: string[] }
  | { kind: 'vehicle-orphan'; vehicleId: string }
  | { kind: 'legacy-orders'; orderIds: string[] };

type WorkOrderWithRelations = Prisma.WorkOrderGetPayload<{
  include: WorkOrderOrderInclude;
}>;

const ORDER_INCLUDE = {
  vehicle: { select: { id: true, plate: true, brand: true, model: true, year: true, color: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: { taxRate: { select: { kind: true, name: true, ratePercent: true } } },
  },
  payments: { select: { amount: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  invoices: {
    orderBy: { createdAt: 'desc' },
    include: {
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: { taxRate: { select: { kind: true, name: true, ratePercent: true } } },
      },
      payments: { select: { amount: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      creditNotes: {
        select: {
          documentNumber: true,
          status: true,
          reason: true,
          grandTotal: true,
          issuedAt: true,
        },
      },
      debitNotes: {
        select: {
          documentNumber: true,
          status: true,
          reason: true,
          grandTotal: true,
          issuedAt: true,
        },
      },
    },
  },
} satisfies Prisma.WorkOrderInclude;

type WorkOrderOrderInclude = typeof ORDER_INCLUDE;

export type PortalLine = {
  lineType: 'PART' | 'LABOR';
  description: string | null;
  quantity: string;
  unitPrice: string | null;
  discountAmount: string;
  taxPercent: string;
  taxKind: 'VAT' | 'INC' | null;
  lineTotal: string;
};

export type PortalCreditNote = {
  documentNumber: string;
  status: string;
  reason: string | null;
  grandTotal: string;
  issuedAt: string | null;
};

export type PortalDebitNote = PortalCreditNote;

export type PortalInvoice = {
  documentNumber: string;
  status: InvoiceStatus;
  createdAt: string;
  issuedAt: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  cufe: string | null;
  subtotal: string;
  totalDiscount: string;
  totalTax: string;
  grandTotal: string;
  effectiveAmount: string;
  amountPaid: string;
  amountDue: string;
  lines: PortalLine[];
  creditNotes: PortalCreditNote[];
  debitNotes: PortalDebitNote[];
};

export type PortalOrder = {
  publicCode: string;
  status: WorkOrderStatus;
  description: string | null;
  createdAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  intakeOdometerKm: number | null;
  inspectionOnly: boolean;
  lines: PortalLine[];
  subtotal: string;
  totalDiscount: string;
  totalTax: string;
  grandTotal: string;
  amountPaid: string;
  amountDue: string;
  invoices: PortalInvoice[];
};

export type PortalVehicle = {
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  orders: PortalOrder[];
};

export type ClientPortalAccount = {
  cliente: {
    displayName: string | null;
    documentId: string | null;
    /** Muestra los últimos 4 dígitos del celular verificado (el resto oculto). */
    maskedPhone: string | null;
  };
  resumen: {
    vehiclesCount: number;
    openOrders: number;
    invoicesCount: number;
    openBalance: string;
  };
  vehicles: PortalVehicle[];
};

@Injectable()
export class ClientPortalService {
  private readonly logger = new Logger(ClientPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: ReceiptsService,
  ) {}

  async lookup(dto: LookupClientPortalDto, ip?: string): Promise<ClientPortalAccount> {
    const fingerprint = this.fingerprintFor(ip);
    await this.registerAttemptOrThrow(fingerprint);
    try {
      const account = await this.loadAccount(dto);
      await this.clearAttempts(fingerprint);
      return account;
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
      }
      throw err;
    }
  }

  /**
   * Comprobante imprimible de una OT del portal: revalida placa + celular, confirma que el
   * `orderCode` pertenece a esa cuenta y renderiza con el MISMO formato que entrega la OT al
   * taller (`ReceiptsService.renderWorkOrderReceipt`), para que el cliente baje el mismo
   * documento que se generaría desde el panel.
   */
  async renderReceipt(dto: ReceiptClientPortalDto, ip?: string): Promise<string> {
    const fingerprint = this.fingerprintFor(ip);
    await this.registerAttemptOrThrow(fingerprint);
    try {
      const scope = await this.resolveScope(dto);
      const wo = await this.prisma.workOrder.findFirst({
        where: {
          AND: [this.workOrderWhere(scope), { publicCode: dto.orderCode }],
        },
        include: ORDER_INCLUDE,
      });
      if (!wo) {
        throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
      }
      const payload = this.buildReceiptPayload(wo);
      const html = await this.receipts.renderWorkOrderReceipt(payload);
      await this.clearAttempts(fingerprint);
      return html;
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- rate limit

  private fingerprintFor(ip?: string): string {
    const secret = process.env.JWT_SECRET ?? 'dev';
    const raw = `${ip ?? 'unknown'}|client-portal|${secret}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  private async registerAttemptOrThrow(fingerprint: string): Promise<void> {
    const now = new Date();
    const row = await this.prisma.clientPortalAttempt.findUnique({ where: { fingerprint } });

    if (!row) {
      await this.prisma.clientPortalAttempt.create({
        data: { fingerprint, attempts: 1, windowStartAt: now },
      });
      return;
    }

    if (row.blockedUntil && row.blockedUntil.getTime() > now.getTime()) {
      throw new HttpException(CLIENT_PORTAL_RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }

    const windowMs = CLIENT_PORTAL_RATE.windowMinutes * 60_000;
    const windowExpired = now.getTime() - row.windowStartAt.getTime() > windowMs;
    const attempts = (windowExpired ? 0 : row.attempts) + 1;
    const windowStartAt = windowExpired ? now : row.windowStartAt;

    if (attempts > CLIENT_PORTAL_RATE.maxAttempts) {
      await this.prisma.clientPortalAttempt.update({
        where: { fingerprint },
        data: {
          attempts: 0,
          windowStartAt: now,
          blockedUntil: new Date(now.getTime() + CLIENT_PORTAL_RATE.blockMinutes * 60_000),
        },
      });
      throw new HttpException(CLIENT_PORTAL_RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.prisma.clientPortalAttempt.update({
      where: { fingerprint },
      data: { attempts, windowStartAt, blockedUntil: null },
    });
  }

  private async clearAttempts(fingerprint: string): Promise<void> {
    try {
      await this.prisma.clientPortalAttempt.deleteMany({ where: { fingerprint } });
    } catch (err) {
      this.logger.warn(
        `No se pudo limpiar el intento del portal cliente: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /** Purga huellas viejas (diaria) para no acumular filas inútiles. */
  @Cron('0 17 4 * * *')
  async purgeOldAttempts(): Promise<void> {
    const cutoff = new Date(Date.now() - CLIENT_PORTAL_RATE.purgeDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.clientPortalAttempt.deleteMany({
      where: { updatedAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Portal cliente: ${count} huellas antiguas purgadas.`);
    }
  }

  // ---------------------------------------------------------------- identidad

  /**
   * Busca el vehículo maestro tolerando ambas convenciones de `plateNorm`:
   * `MMC-357` (normalizado con guion) o `MMC357` (sin guion).
   */
  private async findVehicleByPlate(plate: string) {
    const candidates = new Set<string>();
    try {
      candidates.add(normalizeVehiclePlate(plate));
    } catch {
      /* placa inválida: se ignora esta variante */
    }
    try {
      candidates.add(comparableVehiclePlate(plate));
    } catch {
      /* placa inválida: se ignora esta variante */
    }
    for (const key of candidates) {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { plateNorm: key },
        include: { customer: { select: { id: true, primaryPhone: true } } },
      });
      if (vehicle) {
        return vehicle;
      }
    }
    return null;
  }

  private async resolveScope(dto: LookupClientPortalDto): Promise<PortalScope> {
    const plateComparable = comparableVehiclePlate(dto.plate);
    const phoneNorm = normalizePortalPhone(dto.phone);
    if (!phoneNorm) {
      throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
    }

    const phoneMatches = (phones: Array<string | null | undefined>): boolean =>
      phones.some((p) => normalizePortalPhone(p) === phoneNorm);

    const vehicle = await this.findVehicleByPlate(dto.plate);

    // --- Camino maestro: vehículo registrado a nombre de un cliente.
    if (vehicle) {
      if (vehicle.customer) {
        const ownerVehicles = await this.prisma.vehicle.findMany({
          where: { customerId: vehicle.customer.id },
          select: { id: true },
        });
        const vehicleIds = ownerVehicles.map((v) => v.id);
        const orderPhones = await this.prisma.workOrder.findMany({
          where: { vehicleId: { in: vehicleIds } },
          select: { customerPhone: true },
        });
        const candidates = [
          vehicle.customer.primaryPhone,
          ...orderPhones.map((wo) => wo.customerPhone),
        ];
        if (!phoneMatches(candidates)) {
          throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
        }
        return { kind: 'customer', ownerId: vehicle.customer.id, vehicleIds };
      }

      // --- Vehículo sin cliente maestro: solo se validan las OTs de esa placa.
      const orphanPhones = await this.prisma.workOrder.findMany({
        where: { vehicleId: vehicle.id },
        select: { customerPhone: true },
      });
      if (!phoneMatches(orphanPhones.map((wo) => wo.customerPhone))) {
        throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
      }
      return { kind: 'vehicle-orphan', vehicleId: vehicle.id };
    }

    // --- Legado: la placa pudo quedar solo como snapshot en OTs sin vehículo maestro.
    const legacyRows = await this.prisma.workOrder.findMany({
      where: { vehiclePlate: { contains: plateComparable, mode: 'insensitive' } },
      select: { id: true, vehiclePlate: true, customerPhone: true },
      take: 200,
    });
    const matching = legacyRows.filter((wo) => {
      try {
        return comparableVehiclePlate(wo.vehiclePlate ?? '') === plateComparable;
      } catch {
        return false;
      }
    });
    if (matching.length === 0 || !phoneMatches(matching.map((wo) => wo.customerPhone))) {
      throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
    }
    return { kind: 'legacy-orders', orderIds: matching.map((wo) => wo.id) };
  }

  // ---------------------------------------------------------------- carga

  private workOrderWhere(scope: PortalScope): Prisma.WorkOrderWhereInput {
    if (scope.kind === 'customer') {
      return { vehicleId: { in: scope.vehicleIds } };
    }
    if (scope.kind === 'vehicle-orphan') {
      return { vehicleId: scope.vehicleId };
    }
    return { id: { in: scope.orderIds } };
  }

  private async loadAccount(dto: LookupClientPortalDto): Promise<ClientPortalAccount> {
    const scope = await this.resolveScope(dto);

    const rows = await this.prisma.workOrder.findMany({
      where: this.workOrderWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: ORDER_INCLUDE,
    });

    if (rows.length === 0) {
      throw new NotFoundException(CLIENT_PORTAL_NOT_FOUND);
    }

    const vehicles = await this.groupOrdersByVehicle(rows, scope);
    const cliente = await this.describeCliente(scope, dto);

    let openOrders = 0;
    let invoicesCount = 0;
    let openBalance = ZERO;

    for (const vehicle of vehicles) {
      for (const order of vehicle.orders) {
        if (order.status !== 'DELIVERED' && order.status !== 'CANCELLED') {
          openOrders += 1;
        }
        // La factura representa el cobro: si la OT fue facturada, el saldo vive en la factura.
        if (order.invoices.length === 0) {
          openBalance = openBalance.plus(new Prisma.Decimal(order.amountDue));
        }
        for (const invoice of order.invoices) {
          if (invoice.status === 'VOIDED') {
            continue;
          }
          invoicesCount += 1;
          openBalance = openBalance.plus(new Prisma.Decimal(invoice.amountDue));
        }
      }
    }

    return {
      cliente,
      resumen: {
        vehiclesCount: vehicles.length,
        openOrders,
        invoicesCount,
        openBalance: openBalance.toString(),
      },
      vehicles,
    };
  }

  private async describeCliente(
    scope: PortalScope,
    dto: LookupClientPortalDto,
  ): Promise<ClientPortalAccount['cliente']> {
    let displayName: string | null = null;
    let documentId: string | null = null;
    let maskedPhone: string | null = null;

    const inputPhone = normalizePortalPhone(dto.phone);
    if (inputPhone) {
      maskedPhone = `••••${inputPhone.slice(-4)}`;
    }

    if (scope.kind === 'customer') {
      const owner = await this.prisma.customer.findUnique({
        where: { id: scope.ownerId },
        select: { displayName: true, documentId: true },
      });
      if (owner) {
        displayName = owner.displayName;
        documentId = owner.documentId;
      }
    } else {
      const row = await this.prisma.workOrder.findFirst({
        where: this.workOrderWhere(scope),
        orderBy: { createdAt: 'desc' },
        select: { customerName: true },
      });
      displayName = row?.customerName ?? null;
    }

    return { displayName, documentId, maskedPhone };
  }

  private async groupOrdersByVehicle(
    rows: WorkOrderWithRelations[],
    scope: PortalScope,
  ): Promise<PortalVehicle[]> {
    // Cliente con vehículos registrados: mostramos TODA la flota (aunque algún
    // vehículo no tenga órdenes), porque el portal es "el estado de mi cuenta".
    let masters: Array<{ id: string; plate: string; brand: string | null; model: string | null; year: number | null; color: string | null }> = [];
    if (scope.kind === 'customer') {
      masters = await this.prisma.vehicle.findMany({
        where: { customerId: scope.ownerId },
        orderBy: { plateNorm: 'asc' },
        select: { id: true, plate: true, brand: true, model: true, year: true, color: true },
      });
    }

    const ordersByVehicle = new Map<string, WorkOrderWithRelations[]>();
    for (const row of rows) {
      const key = row.vehicleId ?? 'snapshot';
      const list = ordersByVehicle.get(key);
      if (list) {
        list.push(row);
      } else {
        ordersByVehicle.set(key, [row]);
      }
    }

    const vehicles: PortalVehicle[] = [];

    if (scope.kind === 'customer') {
      for (const m of masters) {
        const ordersForVehicle = ordersByVehicle.get(m.id) ?? [];
        vehicles.push({
          plate: m.plate,
          brand: m.brand,
          model: m.model,
          year: m.year,
          color: m.color,
          orders: ordersForVehicle
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((wo) => this.shapeOrder(wo)),
        });
      }
      return vehicles;
    }

    // Vehículo huérfano / legado: solo las OTs que coinciden (metadatos del maestro si existe).
    const sortedKeys = [...ordersByVehicle.keys()].sort((a, b) =>
      a === 'snapshot' ? 1 : b === 'snapshot' ? -1 : a.localeCompare(b),
    );
    for (const key of sortedKeys) {
      const ordersForVehicle = ordersByVehicle.get(key) ?? [];
      const first = ordersForVehicle[0];
      const meta = first?.vehicle ?? null;
      vehicles.push({
        plate: meta?.plate ?? first?.vehiclePlate ?? 'Vehículo',
        brand: meta?.brand ?? first?.vehicleBrand ?? null,
        model: meta?.model ?? first?.vehicleModel ?? null,
        year: meta?.year ?? null,
        color: meta?.color ?? null,
        orders: ordersForVehicle.map((wo) => this.shapeOrder(wo)),
      });
    }
    return vehicles;
  }

  // ---------------------------------------------------------------- shapes

  private shapeOrder(wo: WorkOrderWithRelations): PortalOrder {
    const linesForTotals: LineForTotals[] = wo.lines.map((ln) => ({
      id: ln.id,
      lineType: ln.lineType,
      quantity: ln.quantity,
      unitPrice: ln.unitPrice,
      discountAmount: ln.discountAmount,
      costSnapshot: ln.costSnapshot,
      taxRateId: ln.taxRateId,
      taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
      taxRate: ln.taxRate,
    }));
    const totals = computeBillingTotals(linesForTotals);

    const paid = wo.payments.reduce((acc, p) => acc.plus(p.amount), ZERO);
    const amountDue = totals.grandTotal.minus(paid);
    const clampedDue = amountDue.gt(0) ? amountDue : ZERO;

    return {
      publicCode: wo.publicCode,
      status: wo.status,
      description: wo.description ?? null,
      createdAt: wo.createdAt.toISOString(),
      deliveredAt: wo.deliveredAt?.toISOString() ?? null,
      cancelledAt: wo.cancelledAt?.toISOString() ?? null,
      intakeOdometerKm: wo.intakeOdometerKm ?? null,
      inspectionOnly: wo.inspectionOnly,
      lines: wo.lines
        .map((ln) => {
          const line = computeLineTotals({
            id: ln.id,
            lineType: ln.lineType,
            quantity: ln.quantity,
            unitPrice: ln.unitPrice,
            discountAmount: ln.discountAmount,
            costSnapshot: ln.costSnapshot,
            taxRateId: ln.taxRateId,
            taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
            taxRate: ln.taxRate,
          });
          return {
            lineType: ln.lineType,
            description: ln.description,
            quantity: ln.quantity.toString(),
            unitPrice: ln.unitPrice?.toString() ?? null,
            discountAmount: line.discountAmount.toString(),
            taxPercent: line.taxPercent.toString(),
            taxKind: line.taxKind,
            lineTotal: line.lineTotal.toString(),
          } satisfies PortalLine;
        })
        .sort((a, b) => (a.lineType === b.lineType ? 0 : a.lineType === 'LABOR' ? -1 : 1)),
      subtotal: totals.linesSubtotal.toString(),
      totalDiscount: totals.totalDiscount.toString(),
      totalTax: totals.totalTax.toString(),
      grandTotal: totals.grandTotal.toString(),
      amountPaid: paid.toString(),
      amountDue: clampedDue.toString(),
      invoices: wo.invoices.map((inv) => this.shapeInvoice(inv)),
    };
  }

  private shapeInvoice(inv: WorkOrderWithRelations['invoices'][number]): PortalInvoice {
    const paid = inv.payments.reduce((acc, p) => acc.plus(p.amount), ZERO);

    const totalCreditNotes = inv.creditNotes
      .filter((cn) => cn.status === 'ISSUED')
      .reduce((acc, cn) => acc.plus(cn.grandTotal), ZERO);
    const totalDebitNotes = inv.debitNotes
      .filter((dn) => dn.status === 'ISSUED')
      .reduce((acc, dn) => acc.plus(dn.grandTotal), ZERO);

    const effectiveAmount = inv.grandTotal.minus(totalCreditNotes).plus(totalDebitNotes);
    const amountDue = effectiveAmount.minus(paid);

    return {
      documentNumber: inv.documentNumber,
      status: inv.status,
      createdAt: inv.createdAt.toISOString(),
      issuedAt: inv.issuedAt?.toISOString() ?? null,
      voidedAt: inv.voidedAt?.toISOString() ?? null,
      voidedReason: inv.voidedReason,
      cufe: inv.cufe,
      subtotal: inv.subtotal.toString(),
      totalDiscount: inv.totalDiscount.toString(),
      totalTax: inv.totalTax.toString(),
      grandTotal: inv.grandTotal.toString(),
      effectiveAmount: effectiveAmount.toString(),
      amountPaid: paid.toString(),
      amountDue: (amountDue.gt(0) ? amountDue : ZERO).toString(),
      lines: inv.lines
        .map((ln) => ({
          lineType: ln.lineType,
          description: ln.description,
          quantity: ln.quantity.toString(),
          unitPrice: ln.unitPrice.toString(),
          discountAmount: ln.discountAmount.toString(),
          taxPercent: ln.taxRatePercentSnapshot.toString(),
          taxKind: ln.taxRateKindSnapshot,
          lineTotal: ln.lineTotal.toString(),
        } satisfies PortalLine))
        .sort((a, b) => (a.lineType === b.lineType ? 0 : a.lineType === 'LABOR' ? -1 : 1)),
      creditNotes: inv.creditNotes.map((cn) => ({
        documentNumber: cn.documentNumber,
        status: cn.status as string,
        reason: cn.reason,
        grandTotal: cn.grandTotal.toString(),
        issuedAt: cn.issuedAt?.toISOString() ?? null,
      })),
      debitNotes: inv.debitNotes.map((dn) => ({
        documentNumber: dn.documentNumber,
        status: dn.status as string,
        reason: dn.reason,
        grandTotal: dn.grandTotal.toString(),
        issuedAt: dn.issuedAt?.toISOString() ?? null,
      })),
    };
  }

  private buildReceiptPayload(wo: WorkOrderWithRelations): WorkOrderForReceipt {
    const linesForTotals: LineForTotals[] = wo.lines.map((ln) => ({
      id: ln.id,
      lineType: ln.lineType,
      quantity: ln.quantity,
      unitPrice: ln.unitPrice,
      discountAmount: ln.discountAmount,
      costSnapshot: ln.costSnapshot,
      taxRateId: ln.taxRateId,
      taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
      taxRate: ln.taxRate,
    }));
    const totals = computeBillingTotals(linesForTotals);
    const paid = wo.payments.reduce((acc, p) => acc.plus(p.amount), ZERO);
    const amountDue = totals.grandTotal.minus(paid);
    const clampedDue = amountDue.gt(0) ? amountDue : ZERO;

    return {
      id: wo.id,
      publicCode: wo.publicCode,
      orderNumber: wo.orderNumber,
      status: wo.status,
      description: wo.description ?? null,
      createdAt: wo.createdAt,
      deliveredAt: wo.deliveredAt ?? null,
      customerName: wo.customerName ?? null,
      customerPhone: wo.customerPhone ?? null,
      customerEmail: wo.customerEmail ?? null,
      vehicle: wo.vehicle
        ? {
            plate: wo.vehicle.plate ?? null,
            brand: wo.vehicle.brand ?? null,
            model: wo.vehicle.model ?? null,
            year: wo.vehicle.year ?? null,
            color: wo.vehicle.color ?? null,
          }
        : null,
      intakeOdometerKm: wo.intakeOdometerKm ?? null,
      lines: wo.lines.map((ln) => {
        const line = computeLineTotals({
          id: ln.id,
          lineType: ln.lineType,
          quantity: ln.quantity,
          unitPrice: ln.unitPrice,
          discountAmount: ln.discountAmount,
          costSnapshot: ln.costSnapshot,
          taxRateId: ln.taxRateId,
          taxRatePercentSnapshot: ln.taxRatePercentSnapshot,
          taxRate: ln.taxRate,
        });
        return {
          lineType: ln.lineType,
          description: ln.description,
          quantity: ln.quantity,
          unitPrice: ln.unitPrice,
          discountAmount: ln.discountAmount,
          totals: { lineTotal: line.lineTotal.toString() },
        };
      }),
      totals: {
        linesSubtotal: totals.linesSubtotal.toString(),
        totalDiscount: totals.totalDiscount.toString(),
        totalTax: totals.totalTax.toString(),
        grandTotal: totals.grandTotal.toString(),
      },
      paymentSummary: { totalPaid: paid.toString() },
      amountDue: clampedDue.toString(),
      payments: wo.payments.map((p) => ({ amount: p.amount, createdAt: p.createdAt })),
    };
  }
}