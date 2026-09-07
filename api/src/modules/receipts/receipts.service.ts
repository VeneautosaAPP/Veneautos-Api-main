/**
 * Recibos imprimibles (Fase 7.5).
 *
 * Genera HTML listo para imprimir con el navegador (`window.print()`):
 *  - Orden de trabajo (`renderWorkOrderReceipt`): comprobante interno de servicio.
 *  - Arqueo de caja (`renderCashSessionReceipt`): constancia del cierre de jornada.
 *
 * Mientras la facturación electrónica esté apagada (`billing.electronic_invoice_enabled=false`),
 * estos son los documentos que se entregan al cliente como soporte. El pie del recibo deja
 * clara la naturaleza legal según el régimen fiscal declarado del taller (`workshop.regime`).
 *
 * No es HTML fiscal: sin CUFE, sin resolución DIAN, sin XML/UBL. Cuando el taller pase a
 * persona jurídica y encendamos DIAN, se sigue usando para documentos internos (p. ej. copias
 * de cortesía, trabajos no facturados), y el documento legal pasa a ser la `Invoice`.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkshopLogoService } from './workshop-logo.service';

export type WorkshopInfo = {
  legalName: string | null;
  documentKind: 'NIT' | 'CC' | 'CE' | 'PASAPORTE';
  documentId: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  regime:
    | 'natural_no_obligado'
    | 'natural_obligado'
    | 'juridica_responsable_iva'
    | 'juridica_no_responsable';
  receiptFooter: string | null;
  displayName: string;
};

type WorkOrderLineForReceipt = {
  lineType: 'LABOR' | 'PART';
  description: string | null;
  quantity: { toString(): string };
  unitPrice: { toString(): string } | null;
  /** `WorkOrderLine.discountAmount` es opcional en la schema; puede llegar como `null`. */
  discountAmount: { toString(): string } | null;
  totals?: {
    lineTotal?: string | null;
    taxAmount?: string | null;
    grossAmount?: string | null;
  } | null;
};

type WorkOrderPaymentForReceipt = {
  amount: { toString(): string };
  createdAt: Date | string;
  note?: string | null;
  cashMovement?: { category?: { name?: string | null } | null } | null;
};

export type WorkOrderForReceipt = {
  id: string;
  publicCode: string;
  orderNumber: number;
  status: string;
  description: string | null;
  createdAt: Date | string;
  deliveredAt: Date | string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerDocumentId?: string | null;
  vehicle?: {
    plate?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    color?: string | null;
  } | null;
  vehiclePlate?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  intakeOdometerKm?: number | null;
  authorizedAmount?: { toString(): string } | null;
  lines: WorkOrderLineForReceipt[];
  linesSubtotal?: string | null;
  amountDue?: string | null;
  totals?: {
    grandTotal?: string | null;
    totalDiscount?: string | null;
    totalTax?: string | null;
    linesSubtotal?: string | null;
  } | null;
  paymentSummary?: {
    totalPaid?: string | null;
  };
  payments?: WorkOrderPaymentForReceipt[];
};

/**
 * Ticket de arqueo de caja (Fase 7.6). No reemplaza registro fiscal alguno: es el
 * comprobante interno que firman cajero y supervisor al cierre de jornada.
 *
 * El llamador arma este payload a partir de `CashSessionsService.findOne(id)` (que ya
 * trae `balanceSummary` y `movements` con categoría) más la nota de apertura, que se
 * recupera del `AuditLog` porque `CashSession` no la persiste como columna.
 */
export type CashSessionMovementForReceipt = {
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

export type CashSessionForReceipt = {
  id: string;
  status: 'OPEN' | 'CLOSED' | string;
  openedAt: Date | string;
  closedAt?: Date | string | null;
  openingAmount: { toString(): string };
  closingExpected?: { toString(): string } | null;
  closingCounted?: { toString(): string } | null;
  differenceNote?: string | null;
  openedBy?: { fullName?: string | null; email?: string | null } | null;
  closedBy?: { fullName?: string | null; email?: string | null } | null;
  movements: CashSessionMovementForReceipt[];
  balanceSummary?: {
    totalIncome?: string | null;
    totalExpense?: string | null;
    expectedBalance?: string | null;
    movementCount?: number | null;
    byReferenceType?: Array<{
      referenceType: string;
      label?: string | null;
      incomeTotal: string;
      expenseTotal: string;
      count: number;
    }> | null;
  } | null;
  /** Nota operacional escrita al abrir la sesión (se recupera del audit log). */
  openingNote?: string | null;
};

const WORKSHOP_SETTING_KEYS = [
  'workshop.legal_name',
  'workshop.name',
  'workshop.document_kind',
  'workshop.document_id',
  'workshop.address',
  'workshop.city',
  'workshop.phone',
  'workshop.email',
  'workshop.regime',
  'workshop.receipt_footer',
] as const;

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logos: WorkshopLogoService,
  ) {}

  /**
   * Cache en memoria del workshop info por instancia del servicio. Las impresiones
   * seriadas (ej. varias copias o una ronda de cobros) no vuelven a pegar a la DB
   * en este tiempo; los cambios hechos en Configuración se reflejan automáticamente
   * en <= WORKSHOP_CACHE_MS o inmediatamente si `SettingsService` invalida.
   */
  private workshopInfoCache: {
    value: WorkshopInfo;
    expiresAt: number;
  } | null = null;
  private readonly WORKSHOP_CACHE_MS = 30_000;

  invalidateWorkshopInfoCache(): void {
    this.workshopInfoCache = null;
  }

  async getWorkshopInfo(): Promise<WorkshopInfo> {
    const now = Date.now();
    const cached = this.workshopInfoCache;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const rows = await this.prisma.workshopSetting.findMany({
      where: { key: { in: [...WORKSHOP_SETTING_KEYS] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value] as const));
    const str = (key: string): string | null => {
      const v = map.get(key);
      return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
    };
    const legalName = str('workshop.legal_name');
    const commonName = str('workshop.name');
    const rawKind = str('workshop.document_kind');
    const documentKind: WorkshopInfo['documentKind'] =
      rawKind === 'NIT' || rawKind === 'CC' || rawKind === 'CE' || rawKind === 'PASAPORTE'
        ? rawKind
        : 'CC';
    const rawRegime = str('workshop.regime');
    const regime: WorkshopInfo['regime'] =
      rawRegime === 'natural_obligado' ||
      rawRegime === 'juridica_responsable_iva' ||
      rawRegime === 'juridica_no_responsable'
        ? (rawRegime as WorkshopInfo['regime'])
        : 'natural_no_obligado';

    const value: WorkshopInfo = {
      legalName,
      documentKind,
      documentId: str('workshop.document_id'),
      address: str('workshop.address'),
      city: str('workshop.city'),
      phone: str('workshop.phone'),
      email: str('workshop.email'),
      regime,
      receiptFooter: str('workshop.receipt_footer'),
      displayName: legalName ?? commonName ?? 'Taller',
    };
    this.workshopInfoCache = {
      value,
      expiresAt: now + this.WORKSHOP_CACHE_MS,
    };
    return value;
  }

  async renderWorkOrderReceipt(wo: WorkOrderForReceipt): Promise<string> {
    const workshop = await this.getWorkshopInfo();
    const [logoDataUrl, watermarkDataUrl] = await Promise.all([
      this.logos.getDataUrl('invoice'),
      this.logos.getDataUrl('watermark'),
    ]);
    const title = `Comprobante OT ${wo.publicCode}`;
    const { plate, brand, model } = receiptVehicleSnapshot(wo);
    const vehicleLine = [plate, [brand, model].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ');

    const lineRows = wo.lines
      .map((ln) => {
        const total = ln.totals?.lineTotal ?? computeLineTotalFallback(ln);
        const discountNum = toNumberSafe(ln.discountAmount);
        return `
          <tr>
            <td>${escapeHtml(resolveReceiptLineLabel(ln))}
              <span class="muted">${ln.lineType === 'LABOR' ? 'servicio' : 'repuesto/insumo'}</span>
            </td>
            <td class="num">${quantityLabel(ln.quantity)}</td>
            <td class="num">${unitPriceLabel(ln.unitPrice)}</td>
            <td class="num">${discountNum > 0 ? '-' + formatCop(ln.discountAmount) : '—'}</td>
            <td class="num">${formatCop(total)}</td>
          </tr>`;
      })
      .join('');

    const totals = wo.totals ?? {};
    const subtotal = totals.linesSubtotal ?? wo.linesSubtotal ?? '0';
    const discount = totals.totalDiscount ?? '0';
    const tax = totals.totalTax ?? '0';
    const grand = totals.grandTotal ?? '0';
    const paid = wo.paymentSummary?.totalPaid ?? '0';
    const due = wo.amountDue ?? '0';

    const paymentsHtml = (wo.payments ?? [])
      .map((p) => {
        return `
          <tr>
            <td>${formatDate(p.createdAt)}</td>
            <td>${escapeHtml(p.cashMovement?.category?.name ?? 'Cobro en caja')}</td>
            <td class="num">${formatCop(p.amount)}</td>
          </tr>`;
      })
      .join('');

    const body = `
      <section class="doc-meta">
        <div>
          <div class="doc-kind">ORDEN DE TRABAJO · COMPROBANTE DE SERVICIO</div>
          <div class="doc-code">${escapeHtml(wo.publicCode)} <span class="muted">· #${wo.orderNumber}</span></div>
        </div>
        <div class="doc-dates">
          <div><strong>Fecha de creación:</strong> ${formatDate(wo.createdAt)}</div>
          ${wo.deliveredAt ? `<div><strong>Fecha de entrega:</strong> ${formatDate(wo.deliveredAt)}</div>` : ''}
          <div><strong>Estado:</strong> ${escapeHtml(wo.status)}</div>
        </div>
      </section>

      <section class="parties">
        <div class="party">
          <h4>Cliente</h4>
          <div>${escapeHtml(wo.customerName ?? '—')}</div>
          ${wo.customerDocumentId ? `<div class="muted">Doc: ${escapeHtml(wo.customerDocumentId)}</div>` : ''}
          ${wo.customerPhone ? `<div class="muted">Tel: ${escapeHtml(wo.customerPhone)}</div>` : ''}
          ${wo.customerEmail ? `<div class="muted">${escapeHtml(wo.customerEmail)}</div>` : ''}
        </div>
        <div class="party">
          <h4>Vehículo</h4>
          <div>${escapeHtml(vehicleLine || '—')}</div>
          ${wo.intakeOdometerKm != null ? `<div class="muted">Km ingreso: ${wo.intakeOdometerKm.toLocaleString('es-CO')}</div>` : ''}
        </div>
      </section>

      ${
        wo.description
          ? `<section class="desc"><h4>Trabajo realizado</h4><p>${escapeHtml(wo.description)}</p></section>`
          : ''
      }

      <section>
        <table class="lines">
          <thead>
            <tr>
              <th>Descripción</th>
              <th class="num">Cant.</th>
              <th class="num">Valor</th>
              <th class="num">Dcto.</th>
              <th class="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>${lineRows || '<tr><td colspan="5" class="muted center">Sin líneas registradas</td></tr>'}</tbody>
        </table>
      </section>

      <section class="totals">
        <table>
          <tr><th>Subtotal</th><td class="num">${formatCop(subtotal)}</td></tr>
          ${Number(discount) > 0 ? `<tr><th>Descuento</th><td class="num">-${formatCop(discount)}</td></tr>` : ''}
          ${Number(tax) > 0 ? `<tr><th>Impuestos</th><td class="num">${formatCop(tax)}</td></tr>` : ''}
          <tr class="grand"><th>Total</th><td class="num">${formatCop(grand)}</td></tr>
          <tr><th>Abonado</th><td class="num">${formatCop(paid)}</td></tr>
          <tr class="${Number(due) > 0 ? 'due' : ''}"><th>Saldo pendiente</th><td class="num">${formatCop(due)}</td></tr>
        </table>
      </section>

      ${
        paymentsHtml
          ? `<section><h4>Pagos registrados</h4>
              <table class="payments">
                <thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Monto</th></tr></thead>
                <tbody>${paymentsHtml}</tbody>
              </table>
            </section>`
          : ''
      }
    `;

    return renderPage({
      title,
      workshop,
      body,
      logoDataUrl,
      watermarkDataUrl,
    });
  }

  /**
   * Ticket de arqueo de caja (Fase 7.6). Se imprime al cerrar la jornada y queda como constancia
   * interna del corte: apertura, movimientos, esperado vs. contado y diferencia. No es fiscal.
   */
  async renderCashSessionReceipt(session: CashSessionForReceipt): Promise<string> {
    const workshop = await this.getWorkshopInfo();
    const logoDataUrl = await this.logos.getDataUrl('invoice');
    const isClosed = session.status === 'CLOSED';
    const title = `Arqueo de caja ${shortId(session.id)}`;

    const summary = session.balanceSummary ?? {};
    const opening = toNumberSafe(session.openingAmount);
    const totalIncome = toNumberSafe(summary.totalIncome ?? 0);
    const totalExpense = toNumberSafe(summary.totalExpense ?? 0);
    const expected = toNumberSafe(
      summary.expectedBalance ?? (opening + totalIncome - totalExpense),
    );
    const countedRaw = session.closingCounted;
    const counted = countedRaw == null ? null : toNumberSafe(countedRaw);
    const diff = counted == null ? null : counted - expected;

    const refRows = (summary.byReferenceType ?? [])
      .map((r) => {
        const label = escapeHtml(r.label ?? r.referenceType);
        const inc = formatCop(r.incomeTotal);
        const exp = formatCop(r.expenseTotal);
        return `
          <tr>
            <td>${label}</td>
            <td class="num">${r.count}</td>
            <td class="num">${inc}</td>
            <td class="num">${exp}</td>
          </tr>`;
      })
      .join('');

    const movementRows = session.movements
      .map((m) => {
        const isIncome = m.direction === 'INCOME';
        const amount = formatCop(m.amount);
        const concept =
          m.category?.name?.trim() ||
          (m.referenceType && m.referenceType.trim()
            ? `${m.referenceType} · ${shortId(m.referenceId ?? '')}`
            : 'Movimiento');
        const who =
          m.createdBy?.fullName?.trim() || m.createdBy?.email?.trim() || '—';
        const note = m.note ? `<div class="muted" style="margin-left:0">${escapeHtml(m.note)}</div>` : '';
        return `
          <tr>
            <td class="mono-small">${formatDate(m.createdAt)}</td>
            <td><span class="${isIncome ? 'badge-in' : 'badge-out'}">${isIncome ? 'Ingreso' : 'Egreso'}</span></td>
            <td>${escapeHtml(concept)}${note}</td>
            <td class="num ${isIncome ? 'txt-in' : 'txt-out'}">${isIncome ? '+' : '-'}${amount}</td>
            <td class="mono-small">${escapeHtml(who)}</td>
          </tr>`;
      })
      .join('');

    const body = `
      <section class="doc-meta">
        <div>
          <div class="doc-kind">ARQUEO DE CAJA · CIERRE DE JORNADA</div>
          <div class="doc-code">${escapeHtml(shortId(session.id))} <span class="muted">· ${isClosed ? 'Cerrada' : 'Abierta'}</span></div>
        </div>
        <div class="doc-dates">
          <div><strong>Apertura:</strong> ${formatDate(session.openedAt)}</div>
          ${session.closedAt ? `<div><strong>Cierre:</strong> ${formatDate(session.closedAt)}</div>` : ''}
          <div><strong>Estado:</strong> ${escapeHtml(isClosed ? 'Cerrada' : 'Abierta')}</div>
        </div>
      </section>

      <section class="parties">
        <div class="party">
          <h4>Abrió</h4>
          <div>${escapeHtml(session.openedBy?.fullName || session.openedBy?.email || '—')}</div>
          ${session.openingNote ? `<div class="muted" style="margin-left:0">Nota: ${escapeHtml(session.openingNote)}</div>` : ''}
        </div>
        <div class="party">
          <h4>Cerró</h4>
          <div>${escapeHtml(session.closedBy?.fullName || session.closedBy?.email || (isClosed ? '—' : 'Sesión aún abierta'))}</div>
          ${session.differenceNote ? `<div class="muted" style="margin-left:0">Nota: ${escapeHtml(session.differenceNote)}</div>` : ''}
        </div>
      </section>

      <section class="totals">
        <table>
          <tr><th>Monto de apertura</th><td class="num">${formatCop(opening)}</td></tr>
          <tr><th>Total ingresos</th><td class="num txt-in">+${formatCop(totalIncome)}</td></tr>
          <tr><th>Total egresos</th><td class="num txt-out">-${formatCop(totalExpense)}</td></tr>
          <tr class="grand"><th>Saldo esperado</th><td class="num">${formatCop(expected)}</td></tr>
          ${
            counted != null
              ? `<tr><th>Conteo físico</th><td class="num">${formatCop(counted)}</td></tr>`
              : `<tr><th>Conteo físico</th><td class="num muted" style="margin-left:0">— (sesión abierta)</td></tr>`
          }
          ${
            diff != null
              ? `<tr class="${Math.abs(diff) > 0 ? 'due' : ''}"><th>Diferencia</th><td class="num">${diff > 0 ? '+' : diff < 0 ? '-' : ''}${formatCop(Math.abs(diff))}</td></tr>`
              : ''
          }
        </table>
      </section>

      ${
        refRows
          ? `<section><h4>Desglose por tipo de movimiento</h4>
              <table class="payments">
                <thead><tr>
                  <th>Origen</th>
                  <th class="num">Cant.</th>
                  <th class="num">Ingresos</th>
                  <th class="num">Egresos</th>
                </tr></thead>
                <tbody>${refRows}</tbody>
              </table>
            </section>`
          : ''
      }

      <section><h4>Detalle de movimientos (${session.movements.length})</h4>
        <table class="payments">
          <thead><tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Concepto</th>
            <th class="num">Monto</th>
            <th>Registró</th>
          </tr></thead>
          <tbody>${movementRows || '<tr><td colspan="5" class="muted center">Sin movimientos registrados en esta sesión.</td></tr>'}</tbody>
        </table>
      </section>
    `;

    return renderPage({
      title,
      workshop,
      body,
      logoDataUrl,
      overrideFiscalLegend:
        'Ticket interno de arqueo de caja. No tiene validez fiscal ni sustituye factura de venta. Se conserva como soporte operativo firmado por cajero y supervisor.',
    });
  }
}

/**
 * Muestra IDs en CUID de forma compacta sin perder unicidad razonable para impresión.
 * Para CUIDs típicos (25 chars) usa los últimos 8, que son el componente más variable.
 */
function shortId(id: string): string {
  if (!id) return '—';
  return id.length > 10 ? id.slice(-8).toUpperCase() : id.toUpperCase();
}

/**
 * Texto de vehículo en comprobantes: datos **congelados en la OT** tienen prioridad sobre
 * el maestro `Vehicle`. Evita que varias órdenes enlazadas al mismo vehículo — o ediciones
 * posteriores en maestro — muestren logo/marca de otra historia.
 */
export function receiptVehicleSnapshot(wo: WorkOrderForReceipt): {
  plate: string | null;
  brand: string | null;
  model: string | null;
} {
  const plate = wo.vehiclePlate?.trim() || wo.vehicle?.plate?.trim() || null;
  const brand = wo.vehicleBrand?.trim() || wo.vehicle?.brand?.trim() || null;
  const model = wo.vehicleModel?.trim() || wo.vehicle?.model?.trim() || null;
  return { plate, brand, model };
}

/**
 * Nombre visible para el HTML del recibo (PDF). Las líneas de OT son texto libre:
 * se usa `description` si existe; último recurso el tipo de línea.
 */
function resolveReceiptLineLabel(ln: {
  lineType?: string | null;
  description?: string | null;
}): string {
  const desc = (ln.description ?? '').trim();
  if (desc) return desc;
  if (ln.lineType === 'LABOR') return 'Mano de obra';
  return ln.lineType ?? 'Ítem';
}

function quantityLabel(quantity: { toString(): string }): string {
  return formatQty(quantity);
}

function unitPriceLabel(unitPrice: { toString(): string } | null): string {
  if (unitPrice == null) return formatCop('0');
  return formatCop(unitPrice);
}

function computeLineTotalFallback(ln: {
  quantity: { toString(): string };
  unitPrice: { toString(): string } | null;
  /** Puede ser `null` para líneas de OT sin descuento. */
  discountAmount: { toString(): string } | null | undefined;
}): string {
  const qty = toNumberSafe(ln.quantity);
  const price = toNumberSafe(ln.unitPrice);
  const disc = toNumberSafe(ln.discountAmount);
  const t = qty * price - disc;
  return (t > 0 ? t : 0).toString();
}

function toNumberSafe(value: { toString(): string } | string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(typeof value === 'string' ? value : value.toString());
  return Number.isFinite(n) ? n : 0;
}

function renderPage(input: {
  title: string;
  workshop: WorkshopInfo;
  body: string;
  /** Si se provee, reemplaza la leyenda fiscal por régimen (útil para tickets internos). */
  overrideFiscalLegend?: string;
  /** Texto del sello bajo la tabla (por defecto «Documento no fiscal»). */
  stampLabel?: string;
  /** Data URL del logo a mostrar arriba-izquierda (logo_factura). */
  logoDataUrl?: string | null;
  /**
   * Marca de agua opcional al centro del documento (`marca_de_agua.png`). El archivo
   * ya trae transparencia → se imprime tal cual sin aplicar `opacity` extra.
   */
  watermarkDataUrl?: string | null;
}): string {
  const { title, workshop, body, logoDataUrl, watermarkDataUrl } = input;
  const regimeLegend = input.overrideFiscalLegend ?? regimeLegendFor(workshop.regime);
  const stampLabel = input.stampLabel ?? 'Documento no fiscal';
  const contactBits = [
    workshop.address,
    workshop.city,
    workshop.phone ? `Tel. ${workshop.phone}` : null,
    workshop.email,
  ]
    .filter(Boolean)
    .join(' · ');
  const docLine =
    workshop.documentId != null
      ? `${workshop.documentKind} ${escapeHtml(workshop.documentId)}`
      : '';
  const logoBlock = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Logo" class="ws-logo" />`
    : '';
  const watermarkBlock = watermarkDataUrl
    ? `<img src="${watermarkDataUrl}" alt="" class="watermark" aria-hidden="true" />`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif;
      color: #0f172a;
      background: #f1f5f9;
      margin: 0;
      padding: 16px;
      font-size: 13px;
    }
    .sheet {
      position: relative;
      isolation: isolate;
      max-width: 820px;
      margin: 0 auto;
      background: white;
      padding: 28px 32px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(15,23,42,.06);
      overflow: hidden;
    }
    /* Marca de agua centrada sobre el contenido. El archivo fuente ya
       contiene su transparencia configurada → no aplicamos opacity aquí.
       pointer-events:none evita que interfiera con botones/enlaces. */
    .sheet .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 60%;
      max-width: 520px;
      height: auto;
      z-index: 0;
      pointer-events: none;
      user-select: none;
    }
    .sheet-content {
      position: relative;
      z-index: 1;
    }
    header.ws {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    header.ws .ws-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    header.ws .ws-title {
      text-align: center;
    }
    header.ws .ws-logo {
      width: 90px; height: 90px; object-fit: contain;
      border-radius: 6px; background: white;
      flex-shrink: 0;
    }
    header.ws .ws-top-meta {
      flex-shrink: 0;
      text-align: right;
    }
    header.ws .ws-top-meta .issued {
      font-size: 11px;
      color: #475569;
    }
    header.ws .name { font-size: 20px; font-weight: 700; letter-spacing: .3px; }
    header.ws .tagline { font-size: 12px; color: #475569; margin-top: 2px; }
    header.ws .contact { font-size: 11px; color: #475569; margin-top: 6px; line-height: 1.4; }
    header.ws .doc-id { font-size: 11px; color: #334155; margin-top: 3px; }
    .doc-meta {
      display: flex; justify-content: space-between; gap: 16px;
      padding: 10px 0; border-bottom: 1px dashed #cbd5e1; margin-bottom: 14px;
    }
    .doc-kind { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: #64748b; }
    .doc-code { font-size: 20px; font-weight: 700; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .doc-dates { font-size: 12px; text-align: right; color: #334155; line-height: 1.55; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
    .party h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .8px; color: #64748b; text-transform: uppercase; }
    .desc { margin-bottom: 14px; }
    .desc h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .8px; color: #64748b; text-transform: uppercase; }
    .desc p { margin: 0; white-space: pre-wrap; font-size: 12.5px; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; }
    table.lines { margin-bottom: 14px; }
    table.lines th { text-align: left; font-size: 10.5px; letter-spacing: .6px; color: #64748b; text-transform: uppercase; border-bottom: 1.5px solid #0f172a; padding: 6px 4px; }
    table.lines td { padding: 7px 4px; border-bottom: 1px dotted #e2e8f0; vertical-align: top; }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .muted { color: #64748b; font-size: 11px; display: inline-block; margin-left: 6px; }
    .center { text-align: center; }
    .totals { display: flex; justify-content: flex-end; margin-bottom: 14px; }
    .totals table { width: 320px; }
    .totals th { text-align: left; color: #475569; font-weight: 500; padding: 4px 8px; font-size: 12px; }
    .totals td { padding: 4px 8px; }
    .totals tr.grand th, .totals tr.grand td { font-weight: 700; font-size: 14px; border-top: 1.5px solid #0f172a; padding-top: 8px; }
    .totals tr.due td { color: #b45309; font-weight: 600; }
    table.payments th { text-align: left; font-size: 10.5px; text-transform: uppercase; color: #64748b; letter-spacing: .6px; padding: 5px 4px; border-bottom: 1px solid #cbd5e1; }
    table.payments td { padding: 5px 4px; border-bottom: 1px dotted #e2e8f0; font-size: 12px; vertical-align: top; }
    .mono-small { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #334155; white-space: nowrap; }
    .txt-in { color: #047857; }
    .txt-out { color: #b91c1c; }
    .badge-in {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      background: #ecfdf5; color: #065f46; font-size: 10.5px; font-weight: 600; letter-spacing: .3px;
    }
    .badge-out {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      background: #fef2f2; color: #991b1b; font-size: 10.5px; font-weight: 600; letter-spacing: .3px;
    }
    .legend { margin-top: 22px; padding-top: 10px; border-top: 1.5px solid #0f172a; font-size: 10.5px; color: #475569; line-height: 1.5; }
    .legend .stamp { display: inline-block; padding: 4px 10px; border: 1.5px dashed #b45309; color: #9a3412; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; font-size: 10px; margin-bottom: 8px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; font-size: 11px; color: #475569; }
    .signatures .sig { border-top: 1px solid #0f172a; padding-top: 6px; text-align: center; }
    @page { size: letter; margin: 10mm 12mm; }
    @media print {
      body { background: white; padding: 0; }
      .sheet { border: none; box-shadow: none; padding: 0; max-width: none; }
      .no-print { display: none !important; }
    }
    .no-print {
      position: fixed; top: 10px; right: 12px;
      display: flex; gap: 6px;
    }
    .no-print button {
      font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: white; color: #0f172a; cursor: pointer;
    }
    .no-print button.primary { background: #0f172a; color: white; border-color: #0f172a; }
  </style>
</head>
<body>
  <div class="no-print">
    <button type="button" onclick="window.print()" class="primary">Imprimir</button>
    <button type="button" onclick="window.close()">Cerrar</button>
  </div>
  <div class="sheet">
    ${watermarkBlock}
    <div class="sheet-content">
      <header class="ws">
        <div class="ws-top">
          ${logoBlock}
          <div class="ws-top-meta">
            <div class="issued">Emitido ${formatDate(new Date())}</div>
          </div>
        </div>
        <div class="ws-title">
          <div class="name">${escapeHtml(workshop.displayName)} - TALLER AUTOMOTRIZ</div>
          ${workshop.legalName && workshop.legalName !== workshop.displayName ? `<div class="tagline">${escapeHtml(workshop.legalName)}</div>` : ''}
          ${docLine ? `<div class="doc-id">${docLine}</div>` : ''}
          ${contactBits ? `<div class="contact">${escapeHtml(contactBits)}</div>` : ''}
        </div>
      </header>
      ${body}
      <div class="legend">
        <div class="stamp">${escapeHtml(stampLabel)}</div>
        <div>${regimeLegend}</div>
        ${workshop.receiptFooter ? `<div style="margin-top:6px;">${escapeHtml(workshop.receiptFooter)}</div>` : ''}
      </div>
      <div class="signatures">
        <div class="sig">Firma del cliente</div>
        <div class="sig">Firma del taller</div>
      </div>
    </div>
  </div>
  <script>
    if (typeof window !== 'undefined' && window.location.search.indexOf('autoprint=1') >= 0) {
      window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });
    }
  </script>
</body>
</html>`;
}

function regimeLegendFor(regime: WorkshopInfo['regime']): string {
  switch (regime) {
    case 'juridica_responsable_iva':
      return 'Comprobante interno del taller. El documento fiscal (factura electrónica DIAN) se entrega por separado con CUFE y código QR.';
    case 'juridica_no_responsable':
      return 'Persona jurídica no responsable de IVA. Comprobante interno sin efectos fiscales; no sustituye factura de venta ni documento equivalente.';
    case 'natural_obligado':
      return 'Persona natural obligada a facturar. Este comprobante es de uso interno; el documento fiscal electrónico se entrega por separado.';
    case 'natural_no_obligado':
    default:
      return 'Persona natural no obligada a facturar electrónicamente (Art. 437 E.T. · parágrafo 3 y numeral 7 Art. 437-2). Este comprobante se entrega como constancia del servicio prestado y del pago recibido; no tiene validez fiscal como factura de venta.';
  }
}

function escapeHtml(input: unknown): string {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCop(value: { toString(): string } | string | number | null | undefined): string {
  if (value == null) return '$0';
  const n = typeof value === 'number' ? value : Number((value as { toString(): string }).toString());
  if (!Number.isFinite(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CO');
}

function formatQty(value: { toString(): string }): string {
  const n = Number(value.toString());
  if (!Number.isFinite(n)) return value.toString();
  return Number.isInteger(n) ? n.toString() : n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
