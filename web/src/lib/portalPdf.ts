/**
 * Genera y descarga el PDF del portal de clientes (consulta de cuenta).
 *
 * El PDF se arma como HTML en el navegador a partir de los datos ya validados por
 * `POST /client-portal/account` (nunca hay un segundo fetch autenticado), y se convierte
 * a PDF reutilizando la maquinaria de `receiptHtmlToPdfDataUrl` (html2canvas + jsPDF,
 * formatos letter), igual que el comprobante de WhatsApp.
 */
import { formatCopFromString } from '../utils/copFormat'
import type {
  ClientPortalAccount,
  PortalInvoice,
  PortalOrder,
  PortalVehicle,
} from '../api/types'
import { receiptHtmlToPdfDataUrl } from './whatsappPdf'

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(s: string | null | undefined): string {
  if (!s) return '$0'
  return `$${formatCopFromString(s)}`
}

const INVOICE_STATUS_LABEL: Record<PortalInvoice['status'], string> = {
  DRAFT: 'Borrador (sin enviar a DIAN)',
  ISSUED: 'Aceptada',
  VOIDED: 'Anulada',
}

function linesTable(
  lines: PortalOrder['lines'],
  rows: Array<{ label: string; value: string }>,
): string {
  const body = lines
    .map((ln) => {
      const tax = Number(ln.taxPercent) > 0 ? ` · ${Number(ln.taxPercent)}%` : ''
      const kind = ln.lineType === 'LABOR' ? 'Mano de obra' : 'Repuesto'
      return `<tr>
        <td>${esc(ln.description || kind)}</td>
        <td class="num">${esc(ln.quantity)}</td>
        <td class="num">${money(ln.unitPrice)}</td>
        <td class="num">${Number(ln.discountAmount) > 0 ? `−${money(ln.discountAmount)}` : '—'}</td>
        <td class="num">${oneDecimal(ln.taxPercent)}${tax}</td>
        <td class="num">${money(ln.lineTotal)}</td>
      </tr>`
    })
    .join('')

  const totalRows = rows
    .map((row) => `<tr class="totals"><td colspan="5" class="right">${esc(row.label)}</td><td class="num">${row.value}</td></tr>`)
    .join('')

  return `
    <table class="lines">
      <thead>
        <tr><th>Detalle</th><th class="num">Cant.</th><th class="num">Unitario</th><th class="num">Desc.</th><th class="num">IVA</th><th class="num">Total</th></tr>
      </thead>
      <tbody>
        ${body}
      </tbody>
      ${totalRows}
    </table>`
}

function oneDecimal(s: string): string {
  const n = Number(s)
  if (Number.isNaN(n)) return s
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 })
}

function docHtml(opts: {
  title: string
  docNumber: string
  subtitle: string
  cliente: ClientPortalAccount['cliente']
  vehicle: PortalVehicle
  order: PortalOrder
  footerNote: string
  rows: Array<{ label: string; value: string }>
}): string {
  return `<!doctype html>
<html lang="es-CO">
<head>
  <meta charset="utf-8" />
  <title>${esc(opts.docNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 28px; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .brand small { display: block; font-size: 11px; font-weight: 600; color: #475569; letter-spacing: 2px; text-transform: uppercase; }
    .doc { text-align: right; }
    .doc .title { font-size: 20px; font-weight: 800; }
    .doc .num { font-weight: 700; }
    .muted { color: #475569; }
    .sheet { margin-top: 18px; display: flex; gap: 28px; }
    .sheet div { flex: 1; }
    .sheet b { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; display: block; margin-bottom: 4px; }
    .sheet p { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    thead th { border-bottom: 2px solid #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #475569; }
    .num, th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    tr.totals td { border-bottom: none; padding-top: 3px; padding-bottom: 3px; font-weight: 600; }
    tr.totals td.right { text-align: right; color: #475569; }
    tr.total-final td { border-top: 2px solid #0f172a; font-weight: 800; font-size: 14px; }
    .notes { margin-top: 18px; padding: 10px 12px; background: #f1f5f9; border-radius: 6px; color: #334155; }
    .foot { margin-top: 26px; text-align: center; color: #94a3b8; font-size: 10px; }
  </style>
</head>
<body>
  <div class="head">
    <div class="brand">Vene Autos <small>Taller mecánico</small></div>
    <div class="doc">
      <div class="title">${esc(opts.title)}</div>
      <div class="num">${esc(opts.docNumber)}</div>
      <div class="muted">${esc(opts.subtitle)}</div>
    </div>
  </div>

  <div class="sheet">
    <div>
      <b>Cliente</b>
      <p>${esc(opts.cliente.displayName ?? '')}</p>
      ${opts.cliente.documentId ? `<p class="muted">Doc. ${esc(opts.cliente.documentId)}</p>` : ''}
      ${opts.cliente.maskedPhone ? `<p class="muted">Celular ${esc(opts.cliente.maskedPhone)}</p>` : ''}
    </div>
    <div>
      <b>Vehículo</b>
      <p>${esc([opts.vehicle.plate, opts.vehicle.brand, opts.vehicle.model].filter(Boolean).join(' · '))}</p>
      ${opts.order.intakeOdometerKm != null ? `<p class="muted">Odómetro ingreso: ${opts.order.intakeOdometerKm.toLocaleString('es-CO')} km</p>` : ''}
      ${opts.order.deliveredAt ? `<p class="muted">Entregada: ${new Date(opts.order.deliveredAt).toLocaleDateString('es-CO')}</p>` : ''}
    </div>
  </div>

  ${linesTable(opts.order.lines, opts.rows)}

  <div class="notes">${esc(opts.footerNote)}</div>

  <div class="foot">Generado en la consulta de cuenta del portal del taller · ${new Date().toLocaleDateString('es-CO')} · Documento informativo</div>
</body>
</html>`
}

function sumIssuedNotes(
  notes: PortalInvoice['creditNotes'],
): number {
  return notes
    .filter((n) => n.status === 'ISSUED')
    .reduce((acc, n) => acc + (Number(n.grandTotal) || 0), 0)
}

function invoiceRows(invoice: PortalInvoice): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Subtotal', value: money(invoice.subtotal) },
  ]
  if (Number(invoice.totalDiscount) > 0) {
    rows.push({ label: 'Descuentos', value: `−${money(invoice.totalDiscount)}` })
  }
  if (Number(invoice.totalTax) > 0) {
    rows.push({ label: 'Impuestos', value: money(invoice.totalTax) })
  }
  rows.push({ label: 'Total', value: money(invoice.grandTotal) })
  const creditTotal = sumIssuedNotes(invoice.creditNotes)
  if (creditTotal > 0) {
    rows.push({ label: 'Notas crédito', value: `−${money(String(creditTotal))}` })
  }
  const debitTotal = sumIssuedNotes(invoice.debitNotes)
  if (debitTotal > 0) {
    rows.push({ label: 'Notas débito', value: money(String(debitTotal)) })
  }
  rows.push({ label: 'Pagado', value: `−${money(invoice.amountPaid)}` })
  return rows
}

/** HTML del documento PDF del portal. Devuelve también el nombre de archivo sugerido. */
export function portalPdfSource(
  account: ClientPortalAccount,
  vehicle: PortalVehicle,
  order: PortalOrder,
): { html: string; filename: string } {
  const invoice = order.invoices.find((inv) => inv.status !== 'VOIDED')

  if (invoice) {
    const rows = invoiceRows(invoice)
    rows.push({ label: 'Saldo', value: money(invoice.amountDue) })
    const html = docHtml({
      title: 'Factura',
      docNumber: invoice.documentNumber,
      subtitle: `${INVOICE_STATUS_LABEL[invoice.status]} · ${new Date(invoice.issuedAt ?? invoice.createdAt).toLocaleDateString('es-CO')}`,
      cliente: account.cliente,
      vehicle,
      order,
      rows,
      footerNote:
        invoice.status === 'ISSUED' && invoice.cufe
          ? `Factura electrónica ${invoice.documentNumber} aceptada. CUFE: ${invoice.cufe}`
          : invoice.status === 'VOIDED'
            ? 'Esta factura fue anulada. Contactá al taller para el documento vigente.'
            : 'Factura emitida por el taller en estado borrador (pendiente de envío a la DIAN).',
    })
    return { html, filename: `factura-${invoice.documentNumber}.pdf` }
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Subtotal', value: money(order.subtotal) },
  ]
  if (Number(order.totalDiscount) > 0) {
    rows.push({ label: 'Descuentos', value: `−${money(order.totalDiscount)}` })
  }
  if (Number(order.totalTax) > 0) {
    rows.push({ label: 'Impuestos', value: money(order.totalTax) })
  }
  rows.push({ label: 'Total', value: money(order.grandTotal) })
  rows.push({ label: 'Pagado', value: `−${money(order.amountPaid)}` })
  rows.push({ label: 'Saldo', value: money(order.amountDue) })

  const html = docHtml({
    title: 'Comprobante de trabajo',
    docNumber: order.publicCode,
    subtitle: `Orden #${order.publicCode} · ${new Date(order.createdAt).toLocaleDateString('es-CO')}`,
    cliente: account.cliente,
    vehicle,
    order,
    rows,
    footerNote:
      order.status === 'DELIVERED'
        ? 'Trabajo entregado. Este comprobante no es documento fiscal; la factura se emite a pedido del cliente.'
        : 'Este comprobante no es documento fiscal; la factura se emite a pedido del cliente.',
  })
  return { html, filename: `comprobante-${order.publicCode}.pdf` }
}

/** Genera y descarga el PDF (letter) del documento del portal. */
export async function downloadPortalPdf(
  account: ClientPortalAccount,
  vehicle: PortalVehicle,
  order: PortalOrder,
): Promise<void> {
  const { html, filename } = portalPdfSource(account, vehicle, order)
  const dataUrl = await receiptHtmlToPdfDataUrl(html)
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}