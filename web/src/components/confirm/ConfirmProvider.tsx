import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

export type PromptOptions = {
  title: string
  message?: ReactNode
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  multiline?: boolean
  minLength?: number
  maxLength?: number
  variant?: 'default' | 'danger'
}

export type ConfirmOptions = {
  title: string
  /** Texto multilínea o fragmento con el detalle del aviso */
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** default: acción normal; danger: rechazo / borrado */
  variant?: 'default' | 'danger'
}

/** Diálogo informativo de un solo botón (misma cáscara visual que `confirm`). */
export type AlertOptions = {
  title: string
  message: ReactNode
  okLabel?: string
  variant?: 'default' | 'danger'
}

type QueuedItem =
  | { type: 'confirm'; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | { type: 'alert'; opts: AlertOptions; resolve: () => void }
  | { type: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void }

type DialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: AlertOptions) => Promise<void>
  prompt: (options: PromptOptions) => Promise<string | null>
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function useConfirm(): DialogContextValue['confirm'] {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    throw new Error('useConfirm debe usarse dentro de ConfirmProvider')
  }
  return ctx.confirm
}

export function useAlert(): DialogContextValue['alert'] {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    throw new Error('useAlert debe usarse dentro de ConfirmProvider')
  }
  return ctx.alert
}

export function usePrompt(): DialogContextValue['prompt'] {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    throw new Error('usePrompt debe usarse dentro de ConfirmProvider')
  }
  return ctx.prompt
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const titleId = useId()
  const promptFieldId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<QueuedItem | null>(null)
  const activeRef = useRef<QueuedItem | null>(null)
  const lockRef = useRef(false)
  const queueRef = useRef<QueuedItem[]>([])
  const [promptDraft, setPromptDraft] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const promptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  const showItem = useCallback((item: QueuedItem) => {
    activeRef.current = item
    setActive(item)
    setOpen(true)
  }, [])

  const settleAndAdvance = useCallback(() => {
    const next = queueRef.current.shift()
    if (next) {
      activeRef.current = next
      setActive(next)
    } else {
      lockRef.current = false
      activeRef.current = null
      setActive(null)
      setOpen(false)
    }
  }, [])

  const finish = useCallback(
    (outcome: boolean | 'alert-ok') => {
      const cur = activeRef.current
      if (!cur) return
      if (cur.type === 'confirm') {
        cur.resolve(outcome === true)
      } else if (cur.type === 'alert') {
        cur.resolve()
      }
      settleAndAdvance()
    },
    [settleAndAdvance],
  )

  const resolvePrompt = useCallback(
    (value: string | null) => {
      const cur = activeRef.current
      if (!cur || cur.type !== 'prompt') return
      cur.resolve(value)
      settleAndAdvance()
    },
    [settleAndAdvance],
  )

  const submitPrompt = useCallback(() => {
    const cur = activeRef.current
    if (!cur || cur.type !== 'prompt') return
    const trimmed = promptDraft.trim()
    const min = cur.opts.minLength
    if (min != null && min > 0 && trimmed.length < min) {
      setPromptError(`Ingresá al menos ${min} caracteres.`)
      return
    }
    setPromptError(null)
    resolvePrompt(trimmed)
  }, [promptDraft, resolvePrompt])

  const confirm = useCallback(
    (opts: ConfirmOptions) => {
      return new Promise<boolean>((resolve) => {
        const item: QueuedItem = { type: 'confirm', opts, resolve }
        if (lockRef.current) {
          queueRef.current.push(item)
          return
        }
        lockRef.current = true
        showItem(item)
      })
    },
    [showItem],
  )

  const alert = useCallback(
    (opts: AlertOptions) => {
      return new Promise<void>((resolve) => {
        const item: QueuedItem = { type: 'alert', opts, resolve }
        if (lockRef.current) {
          queueRef.current.push(item)
          return
        }
        lockRef.current = true
        showItem(item)
      })
    },
    [showItem],
  )

  const prompt = useCallback(
    (opts: PromptOptions) => {
      return new Promise<string | null>((resolve) => {
        const item: QueuedItem = { type: 'prompt', opts, resolve }
        if (lockRef.current) {
          queueRef.current.push(item)
          return
        }
        lockRef.current = true
        showItem(item)
      })
    },
    [showItem],
  )

  // Inicializar promptDraft solo cuando active cambia a type 'prompt'
  useEffect(() => {
    if (active?.type !== 'prompt') {
      setPromptError(null)
      return
    }
    // Usar microtask para evitar cascading render
    queueMicrotask(() => {
      setPromptDraft(active.opts.defaultValue ?? '')
      setPromptError(null)
    })
  }, [active])

  useEffect(() => {
    if (!open || !active) return
    if (active.type === 'prompt') {
      window.setTimeout(() => promptInputRef.current?.focus(), 0)
    }
  }, [open, active])

  useEffect(() => {
    if (!open || !active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (active.type === 'confirm') finish(false)
        else if (active.type === 'alert') finish('alert-ok')
        else resolvePrompt(null)
      } else if (e.key === 'Enter' && active.type === 'alert') {
        // La alerta informativa se cierra con Enter igual que con click en el botón.
        finish('alert-ok')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, active, finish, resolvePrompt])

  const primaryBtnClass =
    active?.type === 'confirm'
      ? active.opts.variant === 'danger'
        ? 'va-btn-danger'
        : 'va-btn-primary'
      : active?.opts.variant === 'danger'
        ? 'va-btn-danger'
        : 'va-btn-primary'

  const overlayDismiss = () => {
    if (!activeRef.current) return
    if (activeRef.current.type === 'confirm') finish(false)
    else if (activeRef.current.type === 'alert') finish('alert-ok')
    else resolvePrompt(null)
  }

  const opts = active?.type === 'prompt' ? active.opts : active?.opts

  const promptPrimaryClass =
    active?.type === 'prompt' && active.opts.variant === 'danger' ? 'va-btn-danger' : 'va-btn-primary'

  return (
    <DialogContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      {open && active && opts && (
        <div
          className="va-modal-overlay z-[100] !items-center overflow-y-auto py-8 sm:p-6"
          role="presentation"
          onClick={overlayDismiss}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="va-modal-panel max-h-[min(85dvh,calc(100dvh-2rem))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-300">
              {active.type === 'confirm'
                ? 'Confirmación'
                : active.type === 'alert'
                  ? 'Aviso'
                  : 'Entrada'}
            </p>
            <h2 id={titleId} className="mt-1 va-section-title text-lg">
              {opts.title}
            </h2>
            <div className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300 [&_strong]:font-semibold [&_strong]:text-slate-800 dark:[&_strong]:text-slate-100 [&_.tabular-nums]:tracking-tight">
              {active.type === 'prompt' ? (
                <>
                  {active.opts.message != null ? (
                    typeof active.opts.message === 'string' ? (
                      <div className="whitespace-pre-wrap break-words">{active.opts.message}</div>
                    ) : (
                      active.opts.message
                    )
                  ) : null}
                  <div className="mt-3">
                    <label htmlFor={promptFieldId} className="sr-only">
                      {opts.title}
                    </label>
                    {active.opts.multiline ? (
                      <textarea
                        id={promptFieldId}
                        ref={promptInputRef as RefObject<HTMLTextAreaElement>}
                        rows={4}
                        className="va-field w-full resize-y"
                        value={promptDraft}
                        maxLength={active.opts.maxLength ?? undefined}
                        placeholder={active.opts.placeholder}
                        onChange={(e) => setPromptDraft(e.target.value)}
                      />
                    ) : (
                      <input
                        id={promptFieldId}
                        ref={promptInputRef as RefObject<HTMLInputElement>}
                        type="text"
                        className="va-field w-full"
                        value={promptDraft}
                        maxLength={active.opts.maxLength ?? undefined}
                        placeholder={active.opts.placeholder}
                        onChange={(e) => setPromptDraft(e.target.value)}
                      />
                    )}
                    {promptError ? (
                      <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{promptError}</p>
                    ) : null}
                  </div>
                </>
              ) : typeof opts.message === 'string' ? (
                <div className="whitespace-pre-wrap break-words">{opts.message}</div>
              ) : (
                opts.message
              )}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              {active.type === 'confirm' ? (
                <>
                  <button
                    type="button"
                    className="va-btn-secondary"
                    onClick={() => finish(false)}
                  >
                    {active.opts.cancelLabel ?? 'Cancelar'}
                  </button>
                  <button type="button" className={primaryBtnClass} onClick={() => finish(true)}>
                    {active.opts.confirmLabel ?? 'Aceptar'}
                  </button>
                </>
              ) : active.type === 'alert' ? (
                <button type="button" className={primaryBtnClass} onClick={() => finish('alert-ok')}>
                  {active.opts.okLabel ?? 'Entendido'}
                </button>
              ) : (
                <>
                  <button type="button" className="va-btn-secondary" onClick={() => resolvePrompt(null)}>
                    {active.opts.cancelLabel ?? 'Cancelar'}
                  </button>
                  <button type="button" className={promptPrimaryClass} onClick={submitPrompt}>
                    {active.opts.confirmLabel ?? 'Aceptar'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}
