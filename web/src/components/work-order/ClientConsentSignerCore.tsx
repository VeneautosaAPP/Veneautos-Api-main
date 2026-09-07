import { useCallback, useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import { api } from '../../api/client'
import { WORK_ORDER_CLIENT_CONSENT_TEXT } from '../../config/workOrderClientConsent'

export type ClientConsentSignerCoreProps = {
  workOrderId: string
  onSuccess: () => void
  /** Contenedor del texto legal (scroll); por defecto compacto para tarjeta en detalle OT */
  consentTextBoxClassName?: string
  /** Alto lógico del lienzo de firma en px (se escala con devicePixelRatio) */
  signatureHeightPx?: number
  /** Texto del botón principal */
  submitLabel?: string
}

/**
 * Texto + checkbox + lienzo + PATCH de consentimiento/firma.
 * Reutilizable en el detalle de OT y en el modal tras crear la orden.
 */
export function ClientConsentSignerCore({
  workOrderId,
  onSuccess,
  consentTextBoxClassName = 'max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700 shadow-inner dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
  signatureHeightPx = 200,
  submitLabel = 'Guardar firma y consentimiento',
}: ClientConsentSignerCoreProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const layoutCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const pad = padRef.current
    if (!canvas || !pad) return
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const w = wrapRef.current?.clientWidth ?? 400
    const h = signatureHeightPx
    canvas.width = Math.floor(w * ratio)
    canvas.height = Math.floor(h * ratio)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(ratio, ratio)
    pad.clear()
  }, [signatureHeightPx])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pad = new SignaturePad(canvas, {
      penColor: 'rgb(15 23 42)',
      backgroundColor: 'rgb(255 255 255)',
      minWidth: 0.6,
      maxWidth: 2.8,
    })
    pad.on()
    padRef.current = pad
    layoutCanvas()
    window.addEventListener('resize', layoutCanvas)
    return () => {
      window.removeEventListener('resize', layoutCanvas)
      pad.off()
      padRef.current = null
    }
  }, [workOrderId, layoutCanvas])

  async function submit() {
    setErr(null)
    const pad = padRef.current
    if (!pad || pad.isEmpty()) {
      setErr('Pedile al cliente que firme en el recuadro.')
      return
    }
    if (!ack) {
      setErr('Tenés que marcar que el cliente leyó y acepta el texto.')
      return
    }
    setBusy(true)
    try {
      const dataUrl = pad.toDataURL('image/png')
      await api(`/work-orders/${workOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          clientConsentTextSnapshot: WORK_ORDER_CLIENT_CONSENT_TEXT,
          clientSignaturePngBase64: dataUrl,
        }),
      })
      setAck(false)
      onSuccess()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar la firma')
    } finally {
      setBusy(false)
    }
  }

  function clearPad() {
    padRef.current?.clear()
    setErr(null)
  }

  return (
    <div className="space-y-3">
      <div className={consentTextBoxClassName}>
        <pre className="whitespace-pre-wrap font-sans">{WORK_ORDER_CLIENT_CONSENT_TEXT}</pre>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="mt-1 rounded border-slate-300 text-brand-600"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        <span>
          Confirmo que el cliente leyó el texto anterior y acepta las condiciones indicadas, y que la firma en el
          recuadro corresponde a esa persona.
        </span>
      </label>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
          Firma del cliente
        </p>
        <div
          ref={wrapRef}
          className="touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-900"
        >
          <canvas ref={canvasRef} className="block w-full touch-none" />
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
          Dedo o stylus en pantalla; en PC podés firmar con el mouse.
        </p>
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => clearPad()}
          className="va-btn-secondary disabled:opacity-50"
        >
          Borrar firma
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="va-btn-primary disabled:opacity-50"
        >
          {busy ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
