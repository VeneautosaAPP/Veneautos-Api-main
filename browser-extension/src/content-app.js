'use strict'

/**
 * Contenido inyectado en el panel de VeneAutos. Hace de puente entre la página
 * (CustomEvents `vene:wa:*`) y el service worker (chrome.runtime). No toca WhatsApp.
 *
 *  página → acá   "vene:wa:hello"   { requestId }
 *  página → acá   "vene:wa:send"    { requestId, phone, message, pdfDataUrl? }
 *  acá → página   "vene:wa:ack"     { requestId, version }
 *  worker → acá   { type: "vene:status", payload } → página "vene:wa:status"
 */

;(() => {
  'use strict'
  if (window.__veneWaContentApp) return
  window.__veneWaContentApp = true

  const VERSION = '0.1.0'

  function notifyPage(tag, detail) {
    window.dispatchEvent(new CustomEvent(tag, { detail, bubbles: true, composed: true }))
  }

  function forwardToWorker(detail) {
    try {
      chrome.runtime.sendMessage({ type: 'vene:send', payload: detail })
    } catch (err) {
      notifyPage('vene:wa:status', {
        requestId: detail && detail.requestId,
        step: 'error',
        ok: false,
        message: 'Error interno de la extensión: ' + String((err && err.message) || err),
      })
    }
  }

  window.addEventListener('vene:wa:hello', (ev) => {
    const detail = ev.detail || {}
    notifyPage('vene:wa:ack', { requestId: detail.requestId, version: VERSION })
  })

  window.addEventListener('vene:wa:send', (ev) => {
    forwardToWorker(ev.detail || {})
  })

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'vene:status') return
    const payload = msg.payload || {}
    notifyPage('vene:wa:status', {
      requestId: payload.requestId,
      step: payload.step || 'enviado',
      ok: !!payload.ok,
      message: payload.message || (payload.ok ? 'Enviado' : 'Error'),
    })
  })
})()