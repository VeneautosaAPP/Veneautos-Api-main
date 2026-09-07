/** Contenido de solo lectura: texto archivado + imagen de firma (detalle OT o modal). */
export function ClientConsentSignedPanel({
  signedAt,
  consentSnapshot,
  signaturePngBase64,
  density = 'relaxed',
}: {
  signedAt: string
  consentSnapshot: string | null
  signaturePngBase64: string
  /** `compact`: tarjeta en página; `relaxed`: modal grande */
  density?: 'compact' | 'relaxed'
}) {
  const preScroll =
    density === 'compact'
      ? 'max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
      : 'max-h-[min(42vh,22rem)] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 sm:max-h-[min(50vh,28rem)]'
  const imgClass =
    density === 'compact'
      ? 'max-h-48 w-full max-w-md rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-600'
      : 'max-h-[min(40vh,16rem)] w-full max-w-2xl rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-600 sm:max-h-72'
  const imgSrc =
    signaturePngBase64.length > 0
      ? signaturePngBase64.startsWith('data:')
        ? signaturePngBase64
        : `data:image/png;base64,${signaturePngBase64}`
      : null

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
        Firma registrada el{' '}
        {new Date(signedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
          Texto aceptado (copia archivada)
        </p>
        <pre className={`mt-1 ${preScroll}`}>{consentSnapshot?.trim() ? consentSnapshot : '—'}</pre>
      </div>
      {imgSrc ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">Firma</p>
          <img src={imgSrc} alt="Firma del cliente" className={imgClass} />
        </div>
      ) : null}
    </div>
  )
}
