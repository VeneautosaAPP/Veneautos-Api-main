/**
 * Constructor de "tickets térmicos" (Fase 7.7).
 *
 * Produce la misma carga útil JSON que el puente `vene-drawer-bridge` traduce a ESC/POS
 * para la impresora de 58 mm (FC-588). Está intencionalmente desacoplado del renderer HTML
 * (`ReceiptsService`): el ticket impreso es un resumen operativo (caben ~32 columnas),
 * mientras que el HTML/PDF de Carta sigue siendo el soporte formal.
 *
 * Contrato de bloques (debe quedar sincronizado con `print_ticket.go` en el puente):
 *   - header / text: texto con alineación y estilos.
 *   - line-kv: clave + valor separados por puntos hasta completar el ancho.
 *   - item: descripción izquierda / monto a la derecha (1 línea).
 *   - total: igual a item pero en negrita + tamaño grande.
 *   - separator: línea divisoria ('-' por defecto).
 *   - feed / cut: saltos o corte parcial.
 *
 * El servicio no consulta Prisma: recibe los mismos tipos que `ReceiptsService` (tipos
 * estructurales "duck-typed") para ser llamado con los resultados de los endpoints existentes
 * sin crear un segundo grafo de lecturas.
 */
import { Injectable } from '@nestjs/common';
import {
  ReceiptsService,
  receiptVehicleSnapshot,
  type CashSessionForReceipt,
  type WorkOrderForReceipt,
  type WorkshopInfo,
} from './receipts.service';

/** Alineación soportada por el puente (must match Go side). */
export type TicketAlign = 'left' | 'center' | 'right';
export type TicketSize = 'normal' | 'large' | 'double' | 'wide';

export type TicketBlock =
  | { type: 'logo' }
  | {
      type: 'header';
      text: string;
      align?: TicketAlign;
      size?: TicketSize;
      upper?: boolean;
      bold?: boolean;
    }
  | {
      type: 'text';
      text: string;
      align?: TicketAlign;
      size?: TicketSize;
      bold?: boolean;
      underline?: boolean;
      upper?: boolean;
    }
  | { type: 'line-kv'; key: string; value: string; bold?: boolean }
  | { type: 'item'; left: string; right: string; bold?: boolean }
  | {
      /**
       * Item con descripción larga a la izquierda y precio a la derecha unidos por
       * una línea de puntos ("..............$35.000"). Si la descripción no cabe
       * en una sola línea, se envuelve en varias y la línea de puntos queda aparte.
       */
      type: 'item-dotted';
      left: string;
      right: string;
      bold?: boolean;
    }
  | { type: 'total'; left: string; right: string }
  | { type: 'separator'; char?: string }
  | { type: 'feed'; lines?: number }
  | { type: 'cut'; partial?: boolean };

export type TicketPayload = {
  /** Columnas efectivas; 32 para 58 mm (font A) / 42 (font B). Dejar vacío para el default del puente. */
  width?: number;
  /** Si hay `logo_ticket.png` junto al puente, lo imprime antes de los bloques. */
  includeLogo?: boolean;
  /**
   * Activa fuente B global en el puente: caracteres ~10% más pequeños y ~42 columnas
   * de ancho efectivo (vs 32 en fuente A). Útil cuando queremos caber detalle largo
   * sin sacrificar legibilidad de los totales (que siguen usando size:'large').
   */
  compact?: boolean;
  blocks: TicketBlock[];
};

type TicketOptions = {
  /** Encabezado siempre con el logo (si el operador ya lo guardó en el puente). */
  includeLogo?: boolean;
  /** Texto a mostrar en `DOC KIND` (segunda línea tras el nombre del taller). */
  docKind?: string;
  /** Texto de pie del ticket (ej. "Gracias por su preferencia"). */
  footerText?: string;
};

type PaymentForTicket = {
  amount: { toString(): string };
  createdAt?: Date | string;
  note?: string | null;
  tenderAmount?: { toString(): string } | null;
  changeAmount?: { toString(): string } | null;
  cashMovement?: {
    category?: { name?: string | null; slug?: string | null } | null;
    tenderAmount?: { toString(): string } | null;
    changeAmount?: { toString(): string } | null;
  } | null;
  recordedBy?: { fullName?: string | null; email?: string | null } | null;
};

type CashMovementForTicket = {
  direction: 'INCOME' | 'EXPENSE' | string;
  amount: { toString(): string };
  tenderAmount?: { toString(): string } | null;
  changeAmount?: { toString(): string } | null;
  note?: string | null;
  createdAt: Date | string;
  category?: { name?: string | null; slug?: string | null } | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdBy?: { fullName?: string | null; email?: string | null } | null;
};

type LineForTicket = {
  description?: string | null;
  lineType?: string | null;
  quantity: { toString(): string } | number;
  unitPrice: { toString(): string } | number | string;
  discountAmount?: { toString(): string } | number | string | null;
  lineTotal?: { toString(): string } | number | string | null;
  totals?: { lineTotal?: { toString(): string } | number | string | null } | null;
};

/**
 * Resuelve el nombre visible de una línea en el ticket. Las líneas de OT son
 * texto libre: se usa `description` si existe; último recurso "Mano de obra"/"Item".
 */
function resolveLineLabel(ln: LineForTicket): string {
  const desc = (ln.description ?? '').trim();
  if (desc) return desc;
  if (ln.lineType === 'LABOR') return 'Mano de obra';
  return 'Item';
}

/**
 * Línea auxiliar de desglose "{qty} x {precio unitario}" que se imprime alineada
 * a la derecha encima del total del ítem cuando aporta información (qty ≠ 1 o
 * descuento aplicado).
 */
function buildSubtotalText(
  ln: LineForTicket,
  qty: number,
  unitPrice: number,
  total: number,
): string | null {
  const expected = qty * unitPrice;
  const hasDiscount = Math.abs(expected - total) > 0.5;
  if (qty === 1 && !hasDiscount) return null;
  return `${formatQty(qty)} x ${formatCop(unitPrice)}`;
}

@Injectable()
export class TicketBuilderService {
  constructor(private readonly receipts: ReceiptsService) {}

  /** Encabezado visual de la sección "DETALLE" en los tickets. */
  private pushDetailHeader(blocks: TicketBlock[]): void {
    blocks.push({ type: 'separator' });
    blocks.push({ type: 'feed', lines: 1 });
    blocks.push({ type: 'text', text: 'DETALLE', bold: true, align: 'center' });
    blocks.push({ type: 'feed', lines: 1 });
  }

  /**
   * Línea destacada de total estilo "KEY ............ $valor", alineada con
   * puntos al ancho completo. Reemplaza al bloque `total` (que usaba doble
   * altura/ancho y truncaba textos largos como "VALOR TOTAL" a "VALOR T").
   * Se renderiza en tamaño normal con negrita → legible sin truncar.
   */
  private pushTotalLine(blocks: TicketBlock[], key: string, value: string): void {
    blocks.push({ type: 'line-kv', key, value, bold: true });
  }

  /**
   * Empuja el detalle de líneas con el layout final (v3):
   *
   *   ---------------------------------
   *   3 Amortiguadores
   *                        12 x $68.500   ← subtotal (alineado derecha)
   *                            $822.000   ← total     (alineado derecha, bold)
   *   ---------------------------------
   *   Mano de obra
   *                            $150.000
   *   ---------------------------------
   *
   * - Subtotal "qty × unit" solo si aporta valor (qty≠1 o hay desc.).
   * - Total siempre en línea aparte, alineado a la derecha, en negrita.
   * - Separador de guiones completos al inicio y entre cada ítem.
   */
  private pushLineDetail(blocks: TicketBlock[], lines: LineForTicket[] | null | undefined): void {
    const arr = lines ?? [];
    if (arr.length === 0) return;
    blocks.push({ type: 'separator' });
    for (const ln of arr) {
      const qty = Number((ln.quantity as unknown as { toString(): string }).toString());
      const up = toNumberSafe(ln.unitPrice);
      const explicitTotal = ln.lineTotal ?? ln.totals?.lineTotal ?? null;
      const total =
        explicitTotal != null
          ? toNumberSafe(explicitTotal)
          : Math.max(0, qty * up - toNumberSafe(ln.discountAmount ?? 0));
      const label = resolveLineLabel(ln);

      blocks.push({ type: 'text', text: label });
      const sub = buildSubtotalText(ln, qty, up, total);
      if (sub) {
        blocks.push({ type: 'text', text: sub, align: 'right' });
      }
      blocks.push({ type: 'text', text: formatCop(total), align: 'right', bold: true });
      blocks.push({ type: 'separator' });
    }
  }

  private workshopHeaderBlocks(info: WorkshopInfo, opts: TicketOptions): TicketBlock[] {
    const blocks: TicketBlock[] = [];
    if (opts.includeLogo) {
      blocks.push({ type: 'logo' });
    } else {
      // Sin logo: imprimir el nombre comercial como header grande.
      blocks.push({ type: 'header', text: info.displayName, size: 'large', upper: true });
    }
    if (info.legalName && info.legalName !== info.displayName) {
      blocks.push({ type: 'text', text: info.legalName, align: 'center' });
    }
    if (info.documentId) {
      blocks.push({
        type: 'text',
        text: `${info.documentKind} ${info.documentId}`,
        align: 'center',
      });
    }
    const locationLine = [info.address, info.city].filter(Boolean).join(', ');
    if (locationLine) blocks.push({ type: 'text', text: locationLine, align: 'center' });
    if (info.phone) blocks.push({ type: 'text', text: `Tel. ${info.phone}`, align: 'center' });
    if (info.email) blocks.push({ type: 'text', text: info.email, align: 'center' });
    blocks.push({ type: 'separator' });
    if (opts.docKind) {
      blocks.push({ type: 'text', text: opts.docKind, align: 'center', bold: true, upper: true });
      blocks.push({ type: 'separator' });
    }
    return blocks;
  }

  private fiscalFooterBlocks(info: WorkshopInfo, opts: TicketOptions): TicketBlock[] {
    const blocks: TicketBlock[] = [];
    blocks.push({ type: 'separator' });
    if (opts.footerText) {
      blocks.push({ type: 'text', text: opts.footerText, align: 'center' });
    }
    blocks.push({
      type: 'text',
      text: 'DOCUMENTO NO FISCAL',
      align: 'center',
      bold: true,
      size: 'normal',
    });
    const legend =
      info.regime === 'juridica_responsable_iva' || info.regime === 'natural_obligado'
        ? 'Comprobante interno. Factura electronica DIAN se entrega por separado.'
        : 'Comprobante de servicio/pago. No sustituye factura de venta.';
    blocks.push({ type: 'text', text: legend, align: 'center' });
    if (info.receiptFooter) {
      blocks.push({ type: 'text', text: info.receiptFooter, align: 'center' });
    }
    blocks.push({ type: 'feed', lines: 1 });
    blocks.push({ type: 'cut' });
    return blocks;
  }

  /** Ticket completo para una OT (resumen de líneas + totales + pagos registrados). */
  async buildWorkOrderTicket(wo: WorkOrderForReceipt): Promise<TicketPayload> {
    const info = await this.receipts.getWorkshopInfo();
    const { plate, brand, model } = receiptVehicleSnapshot(wo);
    const vehicleLine = [plate, [brand, model].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ');

    const blocks: TicketBlock[] = [];
    blocks.push(
      ...this.workshopHeaderBlocks(info, {
        includeLogo: true,
        docKind: 'Comprobante de servicio (OT)',
      }),
    );
    blocks.push({ type: 'line-kv', key: 'OT', value: wo.publicCode });
    blocks.push({ type: 'line-kv', key: 'Fecha', value: formatDateShort(wo.createdAt) });
    if (wo.deliveredAt) {
      blocks.push({ type: 'line-kv', key: 'Entrega', value: formatDateShort(wo.deliveredAt) });
    }
    blocks.push({ type: 'line-kv', key: 'Estado', value: wo.status });
    blocks.push({ type: 'separator' });
    blocks.push({ type: 'text', text: 'CLIENTE', bold: true, upper: true });
    blocks.push({ type: 'text', text: wo.customerName ?? '—' });
    if (wo.customerDocumentId) {
      blocks.push({ type: 'text', text: `Doc: ${wo.customerDocumentId}` });
    }
    if (wo.customerPhone) blocks.push({ type: 'text', text: `Tel: ${wo.customerPhone}` });
    if (vehicleLine) {
      blocks.push({ type: 'separator' });
      blocks.push({ type: 'text', text: 'VEHICULO', bold: true, upper: true });
      blocks.push({ type: 'text', text: vehicleLine });
    }
    this.pushDetailHeader(blocks);
    this.pushLineDetail(blocks, wo.lines as LineForTicket[] | null | undefined);

    const totals = wo.totals ?? {};
    const subtotal = toNumberSafe(totals.linesSubtotal ?? wo.linesSubtotal ?? '0');
    const discount = toNumberSafe(totals.totalDiscount ?? '0');
    const tax = toNumberSafe(totals.totalTax ?? '0');
    const grand = toNumberSafe(totals.grandTotal ?? subtotal);
    const paid = toNumberSafe(wo.paymentSummary?.totalPaid ?? '0');
    const due = toNumberSafe(wo.amountDue ?? Math.max(0, grand - paid));

    blocks.push({ type: 'item', left: 'Subtotal', right: formatCop(subtotal) });
    if (discount > 0) {
      blocks.push({ type: 'item', left: 'Descuento', right: `-${formatCop(discount)}` });
    }
    if (tax > 0) {
      blocks.push({ type: 'item', left: 'Impuestos', right: formatCop(tax) });
    }
    this.pushTotalLine(blocks, 'TOTAL', formatCop(grand));
    blocks.push({ type: 'item', left: 'Abonado', right: formatCop(paid) });
    if (due > 0) {
      blocks.push({ type: 'item', left: 'Saldo', right: formatCop(due), bold: true });
    } else {
      blocks.push({ type: 'text', text: 'SALDO EN CERO · LIQUIDADA', align: 'center', bold: true });
    }

    if (wo.payments && wo.payments.length > 0) {
      blocks.push({ type: 'separator' });
      blocks.push({ type: 'text', text: 'PAGOS REGISTRADOS', bold: true });
      for (const p of wo.payments) {
        const when = p.createdAt ? formatDateShort(p.createdAt) : '';
        const concept = p.cashMovement?.category?.name ?? 'Cobro';
        blocks.push({
          type: 'item',
          left: `${when} ${concept}`.trim(),
          right: formatCop(p.amount),
        });
      }
    }

    blocks.push(
      ...this.fiscalFooterBlocks(info, {
        footerText: 'Gracias por su preferencia',
      }),
    );
    return { includeLogo: false, blocks };
  }

  /** Ticket compacto para un cobro puntual de OT. */
  async buildWorkOrderPaymentTicket(
    wo: Pick<
      WorkOrderForReceipt,
      | 'publicCode'
      | 'customerName'
      | 'customerPhone'
      | 'customerDocumentId'
      | 'vehicle'
      | 'vehiclePlate'
      | 'vehicleBrand'
      | 'vehicleModel'
      | 'authorizedAmount'
      | 'lines'
      | 'totals'
    > & {
      totalPaidAfter?: { toString(): string } | null;
      amountDueAfter?: { toString(): string } | null;
    },
    payment: PaymentForTicket,
  ): Promise<TicketPayload> {
    const info = await this.receipts.getWorkshopInfo();
    const { plate } = receiptVehicleSnapshot(wo as WorkOrderForReceipt);

    const blocks: TicketBlock[] = [];
    blocks.push(
      ...this.workshopHeaderBlocks(info, {
        includeLogo: true,
        docKind: 'Recibo de pago — OT',
      }),
    );
    blocks.push({ type: 'line-kv', key: 'OT', value: wo.publicCode });
    blocks.push({
      type: 'line-kv',
      key: 'Fecha',
      value: formatDateShort(payment.createdAt ?? new Date()),
    });
    if (payment.cashMovement?.category?.name) {
      blocks.push({ type: 'line-kv', key: 'Medio', value: payment.cashMovement.category.name });
    }
    if (payment.recordedBy?.fullName || payment.recordedBy?.email) {
      blocks.push({
        type: 'line-kv',
        key: 'Cajero',
        value: payment.recordedBy.fullName?.trim() || payment.recordedBy.email!.trim(),
      });
    }
    blocks.push({ type: 'separator' });
    blocks.push({ type: 'text', text: wo.customerName ?? 'Cliente' });
    if (plate) blocks.push({ type: 'text', text: `Placa: ${plate}` });

    // Desglose de lo que está cobrando (servicios, insumos, repuestos). Útil para
    // el cliente: ve el detalle aunque esté pagando un saldo parcial.
    const lines = (wo.lines ?? []) as LineForTicket[];
    if (lines.length > 0) {
      this.pushDetailHeader(blocks);
      this.pushLineDetail(blocks, lines);
      const grand = toNumberSafe(wo.totals?.grandTotal ?? 0);
      if (grand > 0) {
        blocks.push({ type: 'item', left: 'Total OT', right: formatCop(grand) });
      }
    }
    blocks.push({ type: 'separator' });

    const amount = toNumberSafe(payment.amount);
    this.pushTotalLine(blocks, 'VALOR TOTAL', formatCop(amount));
    const tender = toNumberSafe(payment.tenderAmount ?? payment.cashMovement?.tenderAmount);
    const change = toNumberSafe(payment.changeAmount ?? payment.cashMovement?.changeAmount);
    if (tender > 0) {
      blocks.push({ type: 'item', left: 'Entregado', right: formatCop(tender) });
      if (change > 0) {
        blocks.push({ type: 'item', left: 'Vuelto', right: formatCop(change) });
      }
    }
    // No repetimos "Abonado total" (ya lo representa VALOR TOTAL cuando el cobro
    // cubre el saldo). Solo informamos si queda saldo pendiente o si quedó en cero.
    const paidAfter = toNumberSafe(wo.totalPaidAfter ?? 0);
    const dueAfter = toNumberSafe(wo.amountDueAfter ?? 0);
    if (dueAfter > 0) {
      blocks.push({ type: 'item', left: 'Saldo pendiente', right: formatCop(dueAfter), bold: true });
    } else if (paidAfter > 0) {
      blocks.push({ type: 'text', text: 'SALDO EN CERO', align: 'center', bold: true });
    }
    if (payment.note && payment.note.trim().length > 0) {
      blocks.push({ type: 'separator' });
      blocks.push({ type: 'text', text: `Nota: ${payment.note.trim()}` });
    }
    blocks.push(
      ...this.fiscalFooterBlocks(info, {
        footerText: 'Gracias por su pago',
      }),
    );
    return { includeLogo: false, blocks };
  }

  /** Ticket resumido de arqueo: totales por referencia, diferencia y cajeros. */
  async buildCashSessionSummaryTicket(
    session: CashSessionForReceipt,
  ): Promise<TicketPayload> {
    const info = await this.receipts.getWorkshopInfo();
    const blocks: TicketBlock[] = [];
    blocks.push(
      ...this.workshopHeaderBlocks(info, {
        includeLogo: true,
        docKind: 'Arqueo de caja — Resumen',
      }),
    );
    blocks.push({ type: 'line-kv', key: 'Apertura', value: formatDateShort(session.openedAt) });
    if (session.closedAt) {
      blocks.push({ type: 'line-kv', key: 'Cierre', value: formatDateShort(session.closedAt) });
    }
    blocks.push({
      type: 'line-kv',
      key: 'Estado',
      value: session.status === 'CLOSED' ? 'Cerrada' : 'Abierta',
    });
    if (session.openedBy?.fullName || session.openedBy?.email) {
      blocks.push({
        type: 'line-kv',
        key: 'Abrio',
        value: session.openedBy.fullName?.trim() || session.openedBy.email!.trim(),
      });
    }
    if (session.closedBy?.fullName || session.closedBy?.email) {
      blocks.push({
        type: 'line-kv',
        key: 'Cerro',
        value: session.closedBy.fullName?.trim() || session.closedBy.email!.trim(),
      });
    }
    blocks.push({ type: 'separator' });

    const opening = toNumberSafe(session.openingAmount);
    const totalIncome = toNumberSafe(session.balanceSummary?.totalIncome ?? 0);
    const totalExpense = toNumberSafe(session.balanceSummary?.totalExpense ?? 0);
    const expected = toNumberSafe(
      session.balanceSummary?.expectedBalance ?? opening + totalIncome - totalExpense,
    );
    const counted = session.closingCounted == null ? null : toNumberSafe(session.closingCounted);
    const diff = counted == null ? null : counted - expected;

    blocks.push({ type: 'item', left: 'Apertura', right: formatCop(opening) });
    blocks.push({ type: 'item', left: 'Ingresos', right: `+${formatCop(totalIncome)}` });
    blocks.push({ type: 'item', left: 'Egresos', right: `-${formatCop(totalExpense)}` });
    this.pushTotalLine(blocks, 'ESPERADO', formatCop(expected));
    if (counted != null) {
      blocks.push({ type: 'item', left: 'Contado', right: formatCop(counted) });
      if (diff != null) {
        const label = diff === 0 ? 'OK' : diff > 0 ? 'Sobrante' : 'Faltante';
        blocks.push({
          type: 'item',
          left: `Diferencia (${label})`,
          right: `${diff > 0 ? '+' : diff < 0 ? '-' : ''}${formatCop(Math.abs(diff))}`,
          bold: diff !== 0,
        });
      }
    } else {
      blocks.push({ type: 'text', text: 'Sesion abierta: sin conteo', align: 'center' });
    }

    const byRef = session.balanceSummary?.byReferenceType ?? [];
    if (byRef.length > 0) {
      blocks.push({ type: 'separator' });
      blocks.push({ type: 'text', text: 'Movimientos por origen', bold: true });
      for (const r of byRef) {
        const label = r.label ?? r.referenceType;
        const inc = toNumberSafe(r.incomeTotal);
        const exp = toNumberSafe(r.expenseTotal);
        const right =
          inc > 0 && exp === 0
            ? `+${formatCop(inc)}`
            : exp > 0 && inc === 0
              ? `-${formatCop(exp)}`
              : `+${formatCop(inc)} -${formatCop(exp)}`;
        blocks.push({ type: 'item', left: `${label} (${r.count})`, right });
      }
    }

    blocks.push(
      ...this.fiscalFooterBlocks(info, {
        footerText: 'Resumen de jornada — uso interno',
      }),
    );
    return { includeLogo: false, blocks };
  }

  /** Ticket para un movimiento de caja (ingreso o egreso manual). */
  async buildCashMovementTicket(
    movement: CashMovementForTicket,
    sessionId: string,
  ): Promise<TicketPayload> {
    const info = await this.receipts.getWorkshopInfo();
    const isIncome = movement.direction === 'INCOME';
    const blocks: TicketBlock[] = [];
    blocks.push(
      ...this.workshopHeaderBlocks(info, {
        includeLogo: true,
        docKind: isIncome ? 'Recibo de ingreso' : 'Comprobante de egreso',
      }),
    );
    blocks.push({
      type: 'line-kv',
      key: 'Fecha',
      value: formatDateShort(movement.createdAt),
    });
    blocks.push({
      type: 'line-kv',
      key: 'Sesion',
      value: sessionId.slice(-8).toUpperCase(),
    });
    if (movement.category?.name) {
      blocks.push({ type: 'line-kv', key: 'Concepto', value: movement.category.name });
    }
    if (movement.createdBy?.fullName || movement.createdBy?.email) {
      blocks.push({
        type: 'line-kv',
        key: 'Cajero',
        value:
          movement.createdBy.fullName?.trim() || movement.createdBy.email!.trim(),
      });
    }
    blocks.push({ type: 'separator' });
    const amount = toNumberSafe(movement.amount);
    this.pushTotalLine(blocks, isIncome ? 'RECIBIDO' : 'ENTREGADO', formatCop(amount));
    const tender = toNumberSafe(movement.tenderAmount);
    const change = toNumberSafe(movement.changeAmount);
    if (tender > 0) {
      blocks.push({ type: 'item', left: 'Entregado', right: formatCop(tender) });
      if (change > 0) {
        blocks.push({ type: 'item', left: 'Vuelto', right: formatCop(change) });
      }
    }
    if (movement.note && movement.note.trim().length > 0) {
      blocks.push({ type: 'separator' });
      blocks.push({ type: 'text', text: `Nota: ${movement.note.trim()}` });
    }
    blocks.push(
      ...this.fiscalFooterBlocks(info, {
        footerText: isIncome ? 'Gracias' : 'Egreso autorizado',
      }),
    );
    return { includeLogo: false, blocks };
  }
}

function toNumberSafe(value: { toString(): string } | string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(typeof value === 'string' ? value : value.toString());
  return Number.isFinite(n) ? n : 0;
}

function formatCop(value: { toString(): string } | string | number | null | undefined): string {
  if (value == null) return '$0';
  const n = typeof value === 'number' ? value : Number((value as { toString(): string }).toString());
  if (!Number.isFinite(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CO');
}

function formatQty(value: number | { toString(): string }): string {
  const n = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? n.toString() : n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

function formatDateShort(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
