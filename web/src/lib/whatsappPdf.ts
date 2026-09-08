/**
 * Genera un PDF en carta (letter) a partir del HTML del comprobante, todo en el
 * navegador y bajo demanda (imports dinámicos para no inflar el bundle inicial).
 *
 * El PDF se arma capturando el HTML con html2canvas y volcándolo en páginas letter
 * con jsPDF. Devuelve un data-URL `data:application/pdf;base64,...`, listo para
 * mostrarse, descargarse o enviarse a la extensión de WhatsApp.
 */
export async function receiptHtmlToPdfDataUrl(html: string): Promise<string> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const holder = document.createElement('iframe')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.cssText =
    'position:fixed;left:-99999px;top:0;width:210mm;height:297mm;border:0;opacity:0.01;pointer-events:none;'
  document.body.appendChild(holder)
  try {
    const win = holder.contentWindow
    const doc = holder.contentDocument
    if (!win || !doc) throw new Error('No se pudo preparar el comprobante para PDF.')

    doc.open()
    doc.write(html)
    doc.close()

    await Promise.all(
      Array.from(doc.images).map((img) => {
        if (img.complete && img.naturalWidth > 0) return undefined
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        })
      }),
    )
    try {
      await doc.fonts?.ready
    } catch {
      /* fuente embebida o sin fonts API */
    }
    await new Promise((r) => setTimeout(r, 120))

    const canvas = await html2canvas(doc.body, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: doc.documentElement.scrollWidth,
      windowWidth: doc.documentElement.scrollWidth,
    })

    return canvasToMultiPagePdf(canvas, jsPDF)
  } finally {
    holder.remove()
  }
}

function canvasToMultiPagePdf(
  canvas: HTMLCanvasElement,
  jsPDF: typeof import('jspdf').jsPDF,
): string {
  const pageWmm = 215.9
  const pageHmm = 279.4
  const marginMm = 10
  const usableWmm = pageWmm - marginMm * 2

  const contentCssW = canvas.width / 2
  const contentCssH = canvas.height / 2

  const mmPerCssPx = usableWmm / contentCssW
  const contentHmm = contentCssH * mmPerCssPx
  const usableHmm = pageHmm - marginMm * 2
  const pages = Math.max(1, Math.ceil(contentHmm / usableHmm))

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true })
  for (let i = 0; i < pages; i += 1) {
    if (i > 0) pdf.addPage('letter', 'portrait')
    pdf.addImage(
      canvas,
      'PNG',
      marginMm,
      marginMm - i * usableHmm,
      usableWmm,
      contentHmm,
    )
  }
  return pdf.output('datauristring')
}