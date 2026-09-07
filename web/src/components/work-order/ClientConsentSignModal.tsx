import { useEffect } from 'react'
import { ClientConsentSignerCore } from './ClientConsentSignerCore'

type Props = {
  workOrderId: string
  orderNumber: number
  publicCode: string
  onRecorded: () => void
  onClose: () => void
}

/** Modal para registrar firma + consentimiento en una OT ya abierta (misma UX amplia que al crear). */
export function ClientConsentSignModal({ workOrderId, orderNumber, publicCode, onRecorded, onClose }: Props) {
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
        aria-labelledby="wo-consent-sign-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-6">
          <h2 id="wo-consent-sign-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Consentimiento del cliente · {publicCode}{' '}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-300">(#{orderNumber})</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            El cliente firma en el recuadro; solo se puede guardar una vez por orden.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <ClientConsentSignerCore
            workOrderId={workOrderId}
            onSuccess={() => {
              onRecorded()
              onClose()
            }}
            consentTextBoxClassName="max-h-[min(38vh,18rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-inner sm:max-h-[min(42vh,22rem)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            signatureHeightPx={260}
          />
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Cerrar sin guardar
          </button>
        </div>
      </div>
    </div>
  )
}
