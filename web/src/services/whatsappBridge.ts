/**
 * Cliente del protocolo con la extensión «Vene WhatsApp» (MV3, `browser-extension/`).
 *
 * La app le habla a la extensión mediante CustomEvents sobre `document` (bubbles a `window`):
 *   página → extensión   "vene:wa:hello"  { requestId }                         (handshake)
 *   página → extensión   "vene:wa:send"   { requestId, phone, message, pdfDataUrl? }
 *   extensión → página   "vene:wa:ack"    { requestId, version? }               (handshake ok)
 *   extensión → página   "vene:wa:status" { requestId, step, ok, message }
 *
 * Si la extensión no responde, el modal ofrece el respaldo manual `wa.me` (Click-to-Chat).
 */

export type WaSendRequest = {
  requestId: string
  /** Dígitos con código de país (normalizados, sin `+`). */
  phone: string
  message: string
  /** data-URL `data:application/pdf;base64,...` (opcional: adjunta el comprobante). */
  pdfDataUrl?: string
  workOrderId?: string
}

export type WaStatus = {
  requestId?: string
  step: string
  ok: boolean
  message: string
}

export type WaSendResult =
  | { ok: true; status: string }
  | { ok: false; message: string }

const SEND_EVENT = 'vene:wa:send'
const HELLO_EVENT = 'vene:wa:hello'
const ACK_EVENT = 'vene:wa:ack'
const STATUS_EVENT = 'vene:wa:status'

function nextRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `wa-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function dispatchToExtension(eventName: string, detail: Record<string, unknown>) {
  document.dispatchEvent(
    new CustomEvent(eventName, { detail, bubbles: true, composed: true }),
  )
}

/** ¿Está instalada la extensión? (handshake con timeout corto). */
export function detectWhatsAppExtension(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = nextRequestId()
    let done = false
    const finish = (value: boolean) => {
      if (done) return
      done = true
      window.removeEventListener(ACK_EVENT, onAck)
      clearTimeout(timer)
      resolve(value)
    }
    const onAck = (ev: Event) => {
      const detail = (ev as CustomEvent<{ requestId?: string }>).detail
      if (detail && detail.requestId === requestId) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    window.addEventListener(ACK_EVENT, onAck)
    dispatchToExtension(HELLO_EVENT, { requestId })
  })
}

type SendOptions = Omit<WaSendRequest, 'requestId'> & { requestId?: string }

/**
 * Ordena el envío a la extensión y resuelve cuando esta reporta el estado final
 * (o cuando expira el timeout del protocolo).
 */
export function sendWhatsAppViaExtension(options: SendOptions): Promise<WaSendResult> {
  return new Promise((resolve) => {
    const requestId = options.requestId ?? nextRequestId()
    const payload: WaSendRequest = { requestId, phone: options.phone, message: options.message }
    if (options.pdfDataUrl) payload.pdfDataUrl = options.pdfDataUrl
    if (options.workOrderId) payload.workOrderId = options.workOrderId

    let done = false
    const finish = (result: WaSendResult) => {
      if (done) return
      done = true
      window.removeEventListener(STATUS_EVENT, onStatus)
      clearTimeout(timer)
      resolve(result)
    }
    const onStatus = (ev: Event) => {
      const status = (ev as CustomEvent<WaStatus>).detail
      if (!status || (status.requestId && status.requestId !== requestId)) return
      finish(
        status.ok
          ? { ok: true, status: status.message }
          : { ok: false, message: status.message },
      )
    }
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          message:
            'La extensión no respondió. ¿Está cargada en chrome://extensions y con acceso a esta página?',
        }),
      90_000,
    )
    window.addEventListener(STATUS_EVENT, onStatus)
    dispatchToExtension(SEND_EVENT, payload)
  })
}