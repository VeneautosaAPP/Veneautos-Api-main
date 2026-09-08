'use strict'

/**
 * Service worker de «Vene WhatsApp».
 *
 * Recibe `{ type: "vene:send", payload }` desde el content script del panel y,
 * usando la sesión de WhatsApp Web del propio Chrome (chrome.debugger + CDP):
 *   1. abre/reutiliza la pestaña de web.whatsapp.com;
 *   2. navega al chat del cliente (`/send?phone=...`);
 *   3. si viene PDF, lo descarga a Descargas y lo adjunta con DOM.setFileInputFiles;
 *   4. escribe el mensaje y pica "Enviar".
 *
 * El avance se reporta por `chrome.runtime.sendMessage({ type: "vene:status", payload })`
 * que el content script reenvía al panel.
 */

const WA_BASE = 'https://web.whatsapp.com'

function cb(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (...out) => {
        const err = chrome.runtime.lastError
        if (err) {
          if (/already attached/i.test(err.message)) return resolve('__already__')
          return reject(new Error(err.message))
        }
        resolve(out.length > 1 ? out : out[0])
      })
    })
}

const sendCommand = cb(chrome.debugger.sendCommand.bind(chrome.debugger))
const attach = cb(chrome.debugger.attach.bind(chrome.debugger))
const detach = (tabId) =>
  new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve())
  })

async function findOrCreateWaTab() {
  const tabs = await cb(chrome.tabs.query.bind(chrome.tabs))({ url: `${WA_BASE}/*` })
  if (Array.isArray(tabs) && tabs.length > 0) return tabs[0].id
  const created = await cb(chrome.tabs.create.bind(chrome.tabs))({ url: WA_BASE })
  return created.id
}

async function evalJs(tabId, expression) {
  const res = await sendCommand('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (res && res.exceptionDetails) {
    const exc = res.exceptionDetails
    throw new Error('WhatsApp Web: ' + ((exc.exception && exc.exception.description) || 'error de página'))
  }
  return res && res.result ? res.result.value : undefined
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(tabId, expression, timeoutMs = 30000) {
  const start = Date.now()
  let lastError = null
  for (;;) {
    try {
      const value = await evalJs(tabId, expression)
      if (value) return value
    } catch (err) {
      lastError = err
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(lastError ? lastError.message : 'Tiempo de espera agotado en WhatsApp Web')
    }
    await sleep(800)
  }
}

function downloadPdf(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    let pendingId = null
    let settled = false
    const timer = setTimeout(() => {
      cleanup()
      if (!settled) {
        settled = true
        reject(new Error('La descarga del PDF no terminó a tiempo.'))
      }
    }, 20000)

    const onChanged = (delta) => {
      if (delta.id !== pendingId) return
      if (delta.state && delta.state.current === 'complete') {
        clearTimeout(timer)
        cleanup()
        if (!settled) {
          settled = true
          chrome.downloads.search({ id: delta.id }, (items) =>
            resolve((items && items[0] && items[0].filename) || ''),
          )
        }
      } else if (delta.error) {
        clearTimeout(timer)
        cleanup()
        if (!settled) {
          settled = true
          reject(new Error('Error bajando el PDF: ' + String(delta.error.current || delta.error)))
        }
      }
    }
    const cleanup = () => chrome.downloads.onChanged.removeListener(onChanged)

    chrome.downloads.onChanged.addListener(onChanged)
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (id) => {
      const err = chrome.runtime.lastError
      if (err) {
        clearTimeout(timer)
        cleanup()
        if (!settled) {
          settled = true
          reject(new Error(err.message))
        }
        return
      }
      pendingId = id
    })
  })
}

async function attachPdfFile(tabId, filePath) {
  await sendCommand('DOM.enable').catch(() => {})
  await sendCommand('DOM.getDocument', { depth: -1 }).catch(() => {})

  const attachSelectors = [
    'div[data-testid="attach-controller"]',
    '[title="Adjuntar"]',
    '[aria-label="Adjuntar"]',
  ]
  const opened = await evalJs(
    tabId,
    `(() => { const sels = ${JSON.stringify(attachSelectors)}; for (const s of sels) { const el = document.querySelector(s); if (el) { el.click(); return true; } } return false; })()`,
  )
  if (!opened) throw new Error('No se encontró el botón "Adjuntar" de WhatsApp Web.')
  await sleep(800)

  const inputs = await evalJs(
    tabId,
    `Array.from(document.querySelectorAll('input[type="file"]')).map((el, i) => ({
      i,
      accept: el.accept || '',
      parent: (el.closest('li, div') ? el.closest('li, div').innerText : '').slice(0, 32).replace(/\\n/g, ' ')
    }))`,
  )
  const list = Array.isArray(inputs) ? inputs : []
  let chosen = list.find((x) => /pdf|application\//.test(x.accept))
  if (!chosen) chosen = list.find((x) => /doc|documento/i.test(x.parent))
  if (!chosen && list.length > 0) chosen = list[list.length - 1]
  if (!chosen) throw new Error('No se encontró el campo para adjuntar el documento en WhatsApp Web.')

  const obj = await sendCommand('Runtime.evaluate', {
    expression: `document.querySelectorAll('input[type="file"]')[${chosen.i}]`,
    returnByValue: false,
  })
  if (!obj || !obj.result || !obj.result.objectId) {
    throw new Error('No se pudo localizar el campo de archivos en WhatsApp Web.')
  }
  const described = await sendCommand('DOM.describeNode', { objectId: obj.result.objectId })
  await sendCommand('DOM.setFileInputFiles', {
    files: [filePath],
    nodeId: described.node.nodeId,
  })
  await sleep(1600)
}

async function typeMessage(tabId, message) {
  const focused = await evalJs(
    tabId,
    `(() => { const boxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]'); const box = boxes[boxes.length - 1]; if (!box) return false; (box).focus(); return true; })()`,
  )
  if (!focused) throw new Error('No se encontró el campo de mensaje en WhatsApp Web.')
  await sendCommand('Input.insertText', { text: message })
  await sleep(700)
}

async function clickSend(tabId) {
  await waitFor(tabId, `!!document.querySelector('span[data-icon="send"]')`, 15000)
  await evalJs(
    tabId,
    `(() => { const b = document.querySelector('span[data-icon="send"]'); if (b) b.click(); return !!b; })()`,
  )
  await sleep(2500)
}

function notify(tabId, payload) {
  try {
    chrome.runtime.sendMessage({ type: 'vene:status', payload })
  } catch {
    /* sin listeners: no pasa nada */
  }
}

async function runSend({ phone, message, pdfDataUrl, workOrderId }) {
  if (!phone || !message) throw new Error('Faltan teléfono o mensaje.')
  if (typeof phone === 'string' && !/^\d{7,15}$/.test(phone)) {
    throw new Error('El teléfono no parece válido.')
  }

  const tabId = await findOrCreateWaTab()
  const attached = await attach(tabId)
  if (attached === '__already__') {
    await detach(tabId)
    await attach(tabId)
  }

  try {
    const { requestId } = payload
    notify(tabId, { requestId, step: 'abrir', ok: true, message: 'Abriendo WhatsApp Web…' })
    const loggedIn = await waitFor(
      tabId,
      `!!document.querySelector('#pane-side')`,
      12000,
    ).catch(() => false)
    if (!loggedIn) {
      throw new Error(
        'WhatsApp Web no está iniciado en esta pestaña. Iniciá sesión con el QR y reintentá.',
      )
    }

    const chatUrl = `${WA_BASE}/send?phone=${encodeURIComponent(phone)}`
    await evalJs(tabId, `location.href = ${JSON.stringify(chatUrl)}; true`).catch(() => {})
    await waitFor(tabId, `!!document.querySelector('div[role="textbox"][contenteditable="true"]')`, 30000)

    if (pdfDataUrl) {
      notify(tabId, { requestId, step: 'pdf', ok: true, message: 'Preparando el comprobante…' })
      const filePath = await downloadPdf(
        pdfDataUrl,
        `comprobante-${String(workOrderId || 'ot').slice(0, 12)}.pdf`,
      )
      if (!filePath) throw new Error('No se pudo guardar el PDF en Descargas.')
      notify(tabId, { requestId, step: 'adjuntar', ok: true, message: 'Adjuntando el comprobante…' })
      await attachPdfFile(tabId, filePath)
      await typeMessage(tabId, message)
      await clickSend(tabId)
    } else {
      await typeMessage(tabId, message)
      await clickSend(tabId)
    }

    notify(tabId, { requestId, step: 'listo', ok: true, message: 'Comprobante enviado por WhatsApp.' })
  } finally {
    await detach(tabId).catch(() => {})
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'vene:send') return undefined
  const payload = msg.payload || {}
  const requestId = payload.requestId

  ;(async () => {
    try {
      await runSend(payload)
      notify(sender.tab && sender.tab.id, { requestId, step: 'listo', ok: true, message: 'Comprobante enviado por WhatsApp.' })
      sendResponse({ ok: true, status: 'Comprobante enviado por WhatsApp.' })
    } catch (err) {
      const message = String((err && err.message) || err)
      notify(sender.tab && sender.tab.id, { requestId, step: 'error', ok: false, message })
      sendResponse({ ok: false, message })
    }
  })()

  return true
})