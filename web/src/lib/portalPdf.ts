/**
 * Comprobante descargable del portal de clientes (consulta de cuenta).
 *
 * Genera el MISMO formato que entrega la OT: una ruta pública del API
 * (`POST /client-portal/account/receipt`) revalida placa + celular + código de OT y
 * devuelve el comprobante imprimible renderizado por `ReceiptsService.renderWorkOrderReceipt`
 * (el mismo de `GET /work-orders/:id/receipt` del panel). Acá lo convertimos a PDF con
 * `receiptHtmlToPdfDataUrl` (html2canvas + jsPDF, letter), idéntico al de WhatsApp.
 */
import { API_PREFIX, ApiError } from "../api/client";
import type { PortalOrder } from "../api/types";
import { receiptHtmlToPdfDataUrl } from "./whatsappPdf";

async function fetchReceiptHtml(
  plate: string,
  phone: string,
  orderCode: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/client-portal/account/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate, phone, orderCode }),
      cache: "no-store",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? "error desconocido");
    throw new ApiError(`No pudimos contactar al servidor: ${detail}`, 0, null);
  }

  if (!res.ok) {
    const body = await res.text();
    let msg = res.statusText;
    try {
      const json = JSON.parse(body) as { message?: unknown };
      if (json && typeof json === "object" && json.message != null) {
        const raw = json.message;
        msg = Array.isArray(raw) ? raw.map(String).join(" ") : String(raw);
      }
    } catch {
      // Cuerpo vacío o no JSON: queda `statusText`.
    }
    throw new ApiError(msg || "No se pudo generar el comprobante", res.status, body);
  }

  return res.text();
}

/** Genera y descarga el PDF (letter) del comprobante, en el mismo formato que la OT. */
export async function downloadPortalPdf(
  plate: string,
  phone: string,
  order: PortalOrder,
): Promise<void> {
  const html = await fetchReceiptHtml(plate, phone, order.publicCode);
  const dataUrl = await receiptHtmlToPdfDataUrl(html);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `comprobante-${order.publicCode}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}