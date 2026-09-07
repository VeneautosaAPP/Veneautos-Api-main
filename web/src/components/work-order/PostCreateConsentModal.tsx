import { ClientConsentSignerCore } from './ClientConsentSignerCore'

type Props = {
  workOrderId: string
  orderNumber: number | null
  /** Código para comprobante / cliente (ej. VEN-0001). */
  publicCode: string | null
  canRecordConsent: boolean
  canCancelFreshOrder: boolean
  onSigned: () => void
  onAbandon: () => void
}

/**
 * Tras crear una OT: pantalla completa / panel grande para firmar antes de abrir el detalle.
 */
export function PostCreateConsentModal({
  workOrderId,
  orderNumber,
  publicCode,
  canRecordConsent,
  canCancelFreshOrder,
  onSigned,
  onAbandon,
}: Props) {
  const title =
    publicCode != null
      ? `Consentimiento — ${publicCode}`
      : orderNumber != null
        ? `Consentimiento — orden #${orderNumber}`
        : 'Consentimiento del cliente'

  return (
    <div className="va-modal-overlay z-[70]" role="presentation">
      <div
        className="flex max-h-[min(92dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-create-consent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-6">
          <h2 id="post-create-consent-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            El cliente debe firmar antes de abrir la orden. Si no acepta o no se realiza el trabajo, podés volver atrás
            {canCancelFreshOrder ? ': la orden se cancelará automáticamente.' : ' y la orden quedará creada para firmar o gestionar después.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {canRecordConsent ? (
            <ClientConsentSignerCore
              workOrderId={workOrderId}
              onSuccess={onSigned}
              consentTextBoxClassName="max-h-[min(38vh,18rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-inner sm:max-h-[min(42vh,22rem)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              signatureHeightPx={260}
              submitLabel="Firmar y abrir la orden"
            />
          ) : (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              No tenés permiso para registrar la firma en el sistema. Pedí a quien administre permisos que te habilite{' '}
              <span className="font-mono text-xs">work_orders:update</span>, o abrí la orden desde el listado cuando lo
              tengan resuelto.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-300">
              {canCancelFreshOrder
                ? '«Volver sin abrir» cancela la orden recién creada.'
                : '«Volver sin abrir» cierra esta ventana; la orden sigue en el listado sin firma.'}
            </p>
            <button
              type="button"
              onClick={onAbandon}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Volver sin abrir
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
