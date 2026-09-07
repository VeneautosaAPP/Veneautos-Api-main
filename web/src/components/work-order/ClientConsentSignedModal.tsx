import { useEffect } from 'react'
import { ClientConsentSignedPanel } from './ClientConsentSignedPanel'

type Props = {
  orderNumber: number
  publicCode: string
  signedAt: string
  consentSnapshot: string | null
  signaturePngBase64: string
  onClose: () => void
}

/**
 * Misma envoltura visual amplia que el consentimiento post-creación; solo lectura del consentimiento ya guardado.
 */
export function ClientConsentSignedModal({
  orderNumber,
  publicCode,
  signedAt,
  consentSnapshot,
  signaturePngBase64,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="va-modal-overlay z-[70]" role="presentation" onClick={onClose}>
      <div
        className="flex max-h-[min(92dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wo-consent-signed-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-6">
          <h2 id="wo-consent-signed-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Consentimiento firmado · {publicCode}{' '}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-300">(#{orderNumber})</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Copia archivada y firma registrada en el sistema para esta orden.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <ClientConsentSignedPanel
            signedAt={signedAt}
            consentSnapshot={consentSnapshot}
            signaturePngBase64={signaturePngBase64}
          />
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
