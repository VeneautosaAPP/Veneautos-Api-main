import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, fetchAuthenticatedHtml } from '../../../api/client'
import type { WorkOrderDetail } from '../../../api/types'
import {
  buildWhatsAppMessage,
  formatCop,
  waMeLink,
} from '../../../lib/whatsappMessage'
import { receiptHtmlToPdfDataUrl } from '../../../lib/whatsappPdf'
import { isValidWhatsAppPhone, normalizeWhatsAppPhone } from '../../../lib/whatsappPhone'
import {
  detectWhatsAppExtension,
  sendWhatsAppViaExtension,
} from '../../../services/whatsappBridge'

type Props = {
  open: boolean
  onClose: () => void
  wo: WorkOrderDetail
}

type ExtState = 'checking' | 'yes' | 'no'

export function WhatsAppSendModal({ open, onClose, wo }: Props) {
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)
  const [ext, setExt] = useState<ExtState>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const normalPhone = useMemo(() => normalizeWhatsAppPhone(phone), [phone])

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setError(null)
    setResult(null)
    setPhone(normalizeWhatsAppPhone(wo.customerPhone ?? wo.vehicle?.customer?.primaryPhone))
    setMessage(buildWhatsAppMessage(wo, wo.vehicle?.customer?.displayName ?? 'Vene Autos'))
    setAttachPdf(true)
    setExt('checking')
    let alive = true
    void detectWhatsAppExtension().then((yes) => {
      if (alive) setExt(yes ? 'yes' : 'no')
    })
    void api<{ workshopLegalName: string | null }>('/settings/ui-context')
      .then((u) => {
        if (alive && u.workshopLegalName) {
          setMessage(buildWhatsAppMessage(wo, u.workshopLegalName))
        }
      })
      .catch(() => {
        /* el pie genérico ya está puesto */
      })
    return () => {
      alive = false
    }
  }, [open, wo])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const openManualFallback = useCallback(() => {
    if (!normalPhone) {
      setError('Ingresá un teléfono para abrir el chat manualmente.')
      return
    }
    window.open(waMeLink(normalPhone, message), '_blank', 'noopener,noreferrer')
  }, [message, normalPhone])

  const handleSend = useCallback(async () => {
    setError(null)
    setResult(null)
    if (!isValidWhatsAppPhone(normalPhone)) {
      setError(
        `El teléfono «${phone}» no quedó en un formato válido (esperado dígitos con código de país).`,
      )
      return
    }
    if (!message.trim()) {
      setError('El mensaje está vacío.')
      return
    }
    if (ext === 'checking') {
      setError('Comprobando la extensión… volvé a intentar en un segundo.')
      return
    }
    if (ext === 'no') {
      openManualFallback()
      return
    }
    setBusy(true)
    try {
      let pdfDataUrl: string | undefined
      if (attachPdf) {
        const html = await fetchAuthenticatedHtml(`/work-orders/${wo.id}/receipt`)
        pdfDataUrl = await receiptHtmlToPdfDataUrl(html)
      }
      const res = await sendWhatsAppViaExtension({
        phone: normalPhone,
        message: message.trim(),
        pdfDataUrl,
        workOrderId: wo.id,
      })
      if (res.ok) {
        setResult(res.status)
      } else {
        setError(res.message)
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No se pudo preparar el comprobante.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }, [attachPdf, ext, message, normalPhone, openManualFallback, phone, wo.id])

  if (!open) return null

  return (
    <div className="va-modal-overlay" role="presentation">
      <div
        className="va-modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Enviar comprobante por WhatsApp"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Enviar comprobante por WhatsApp
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              OT {wo.publicCode} · Cliente {wo.customerName ?? '—'} · Patente{' '}
              {wo.vehiclePlate ?? '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div
          className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
            ext === 'yes'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
              : ext === 'no'
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              ext === 'yes'
                ? 'bg-emerald-500'
                : ext === 'no'
                  ? 'bg-amber-500'
                  : 'animate-pulse bg-slate-400'
            }`}
          />
          {ext === 'checking' && 'Comprobando la extensión…'}
          {ext === 'yes' &&
            'Extensión detectada: enviará el comprobante (texto + PDF) automáticamente.'}
          {ext === 'no' &&
            'Extensión no detectada. Se usará WhatsApp manual (wa.me) con todo precargado.'}
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSend()
          }}
        >
          <label className="block text-sm">
            <span className="va-label">Teléfono del cliente (WhatsApp)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="va-field mt-1 font-mono"
              placeholder="300 555 1111"
              inputMode="tel"
            />
            {normalPhone ? (
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                Se enviará a: +{normalPhone}
              </span>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="va-label">Mensaje (resumen de la factura)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              className="va-field mt-1 resize-y font-mono text-xs leading-relaxed"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={attachPdf}
              onChange={(e) => setAttachPdf(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Adjuntar el comprobante en PDF
              {wo.totals?.grandTotal ? ` (total ${formatCop(wo.totals.grandTotal)})` : ''}
            </span>
          </label>

          {error ? (
            <p className="va-alert-error text-xs leading-snug" role="alert">
              {error}
            </p>
          ) : null}
          {result ? (
            <p className="va-alert-success text-xs leading-snug" role="status">
              {result}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {ext === 'no' ? (
              <button
                type="button"
                onClick={openManualFallback}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Abrir WhatsApp manual
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || ext === 'checking'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Enviando…' : ext === 'yes' ? 'Enviar por WhatsApp' : 'Comprobando…'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}