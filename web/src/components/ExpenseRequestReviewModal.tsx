import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useConfirm } from './confirm/ConfirmProvider'
import { NotesMinCharCounter } from './NotesMinCharCounter'
import { formatCopFromString } from '../utils/copFormat'
import { successMessageWithDrawerPulse } from '../services/cashDrawerBridge'

export type ExpenseRequestDetail = {
  id: string
  status: string
  amount: string
  note: string | null
  createdAt: string
  expiresAt: string | null
  isExpired?: boolean
  approvalNote?: string | null
  rejectionReason?: string | null
  category: { slug: string; name: string }
  requestedBy: { id: string; email: string; fullName: string }
  reviewedBy: { id: string; email: string; fullName: string } | null
  resultMovement?: {
    id: string
    sessionId: string
    amount: string
    createdAt: string
  } | null
}

type Props = {
  requestId: string | null
  open: boolean
  /** Mínimo de caracteres para notas de aprobación / rechazo (según configuración del taller). */
  notesMinLength: number
  currentUserId: string | undefined
  canApprove: boolean
  canReject: boolean
  canCancel: boolean
  /** Cajero / delegado: registrar egreso físico cuando la solicitud ya está APPROVED y sin movimiento. */
  canPayOut: boolean
  onClose: () => void
  onDone: () => void
  setBanner: (msg: string | null) => void
}

export function ExpenseRequestReviewModal({
  requestId,
  open,
  notesMinLength,
  currentUserId,
  canApprove,
  canReject,
  canCancel,
  canPayOut,
  onClose,
  onDone,
  setBanner,
}: Props) {
  const confirm = useConfirm()
  const [detail, setDetail] = useState<ExpenseRequestDetail | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmRead, setConfirmRead] = useState(false)
  const [approvalNote, setApprovalNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [acting, setActing] = useState(false)

  useEffect(() => {
    if (!open || !requestId) {
      setDetail(null)
      setLoadErr(null)
      setConfirmRead(false)
      setApprovalNote('')
      setRejectReason('')
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadErr(null)
    void api<ExpenseRequestDetail>(`/cash/expense-requests/${requestId}`)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setLoadErr('No se pudo cargar el detalle de la solicitud.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, requestId])

  if (!open || !requestId) return null

  const isOwnRequest = detail?.requestedBy?.id === currentUserId
  const pending = detail?.status === 'PENDING'
  const blocked = pending && detail?.isExpired

  async function approve() {
    if (!detail || !confirmRead || blocked) return
    const ap = approvalNote.trim()
    if (ap.length < notesMinLength) {
      setBanner(`Nota de aprobación: al menos ${notesMinLength} caracteres (política del taller).`)
      return
    }
    const msg = `¿Aprobar egreso por $${formatCopFromString(detail.amount)} (${detail.category.name}) solicitado por ${detail.requestedBy.fullName}?`
    const ok = await confirm({
      title: 'Aprobar solicitud',
      message: msg,
      confirmLabel: 'Aprobar',
    })
    if (!ok) return
    setActing(true)
    setBanner(null)
    try {
      await api(`/cash/expense-requests/${detail.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approvalNote: ap }),
      })
      setBanner(
        'Solicitud aprobada. El egreso se registra en caja cuando el cajero abre el detalle y confirma el egreso (con sesión abierta).',
      )
      onDone()
      onClose()
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'No se pudo aprobar')
    } finally {
      setActing(false)
    }
  }

  async function reject() {
    if (!detail || !confirmRead || blocked) return
    const reason = rejectReason.trim()
    if (reason.length < notesMinLength) {
      setBanner(`Motivo del rechazo: al menos ${notesMinLength} caracteres (política del taller).`)
      return
    }
    const okRej = await confirm({
      title: 'Rechazar solicitud',
      message: `¿Rechazar la solicitud de ${detail.requestedBy.fullName} por $${formatCopFromString(detail.amount)}?`,
      confirmLabel: 'Rechazar',
      variant: 'danger',
    })
    if (!okRej) return
    setActing(true)
    setBanner(null)
    try {
      await api(`/cash/expense-requests/${detail.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejectionReason: reason }),
      })
      setBanner('Solicitud rechazada.')
      onDone()
      onClose()
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'No se pudo rechazar')
    } finally {
      setActing(false)
    }
  }

  async function reloadDetail() {
    if (!requestId) return
    try {
      const d = await api<ExpenseRequestDetail>(`/cash/expense-requests/${requestId}`)
      setDetail(d)
    } catch {
      setLoadErr('No se pudo actualizar el detalle.')
    }
  }

  async function registerPayOut() {
    if (!detail || detail.status !== 'APPROVED' || detail.resultMovement) return
    const okPay = await confirm({
      title: 'Registrar egreso en caja',
      message: `¿Registrar egreso por $${formatCopFromString(detail.amount)} en la sesión de caja abierta? Si el cajón está enlazado, se enviará el pulso al confirmar.`,
      confirmLabel: 'Registrar egreso',
    })
    if (!okPay) return
    setActing(true)
    setBanner(null)
    try {
      await api(`/cash/expense-requests/${detail.id}/pay-out`, { method: 'POST' })
      setBanner(await successMessageWithDrawerPulse('Egreso registrado en caja.'))
      await reloadDetail()
      onDone()
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'No se pudo registrar el egreso')
    } finally {
      setActing(false)
    }
  }

  async function cancelReq() {
    if (!detail || !isOwnRequest) return
    const okCan = await confirm({
      title: 'Cancelar solicitud',
      message: '¿Cancelar tu solicitud pendiente? No se registrará ningún egreso.',
      confirmLabel: 'Cancelar solicitud',
      variant: 'danger',
    })
    if (!okCan) return
    setActing(true)
    setBanner(null)
    try {
      await api(`/cash/expense-requests/${detail.id}/cancel`, { method: 'POST' })
      setBanner('Solicitud cancelada.')
      onDone()
      onClose()
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'No se pudo cancelar')
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="va-modal-overlay" role="presentation">
      <div
        className="va-modal-panel-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exp-req-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-4 py-3 sm:px-6 dark:border-slate-800">
          <h2 id="exp-req-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Revisar solicitud de egreso
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
            Los botones de decisión están aquí adentro: en la lista solo aparece «Revisar» para evitar toques
            accidentales.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {loading && <p className="text-sm text-slate-600 dark:text-slate-300">Cargando detalle…</p>}
          {loadErr && <p className="text-sm text-red-700 dark:text-red-300">{loadErr}</p>}
          {detail && (
            <div className="space-y-4 text-sm">
              {blocked && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  Esta solicitud está vencida y ya no se puede aprobar ni rechazar desde el panel.
                </p>
              )}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  Monto solicitado
                </p>
                <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  ${formatCopFromString(detail.amount)}
                </p>
                <p className="mt-2 text-slate-700 dark:text-slate-300">
                  <span className="font-medium">Categoría:</span> {detail.category.name}
                </p>
                <p className="mt-1 text-slate-700 dark:text-slate-300">
                  <span className="font-medium">Fecha:</span>{' '}
                  {new Date(detail.createdAt).toLocaleString()}
                </p>
                {detail.expiresAt && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                    Vencimiento: {new Date(detail.expiresAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  Solicita
                </p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{detail.requestedBy.fullName}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">{detail.requestedBy.email}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  Nota del solicitante
                </p>
                <p className="text-slate-800 dark:text-slate-200">{detail.note?.trim() || '— (sin nota)'}</p>
              </div>
              {!pending && detail.reviewedBy && (
                <p className="text-xs text-slate-500 dark:text-slate-300">
                  Revisado por {detail.reviewedBy.fullName}
                  {detail.rejectionReason && (
                    <span className="mt-1 block text-slate-700 dark:text-slate-300">
                      Motivo: {detail.rejectionReason}
                    </span>
                  )}
                  {detail.approvalNote && (
                    <span className="mt-1 block text-slate-700 dark:text-slate-300">
                      Nota de aprobación: {detail.approvalNote}
                    </span>
                  )}
                </p>
              )}

              {detail.status === 'APPROVED' && detail.resultMovement && (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                  Egreso registrado en caja: {new Date(detail.resultMovement.createdAt).toLocaleString()}.
                </p>
              )}

              {detail.status === 'APPROVED' && !detail.resultMovement && (
                <div
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    canPayOut
                      ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
                      : 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                  }`}
                >
                  {canPayOut ? (
                    <>
                      <p className="font-medium">Aprobada — falta registrar el egreso en caja</p>
                      <p className="mt-1 text-xs leading-relaxed opacity-95">
                        Con la sesión de caja abierta, usá «Registrar egreso en caja» abajo para entregar el
                        efectivo y dejar constancia; ahí se envía el pulso al cajón si corresponde.
                      </p>
                    </>
                  ) : (
                    <p>
                      Aprobada; el cajero registrará el egreso cuando abra este detalle con sesión de caja
                      abierta.
                    </p>
                  )}
                </div>
              )}

              {pending && !blocked && (canApprove || canReject) && (
                <>
                  <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                      checked={confirmRead}
                      onChange={(e) => setConfirmRead(e.target.checked)}
                    />
                    <span className="text-slate-800 dark:text-slate-200">
                      Confirmo que revisé solicitante, categoría, monto y nota antes de decidir.
                    </span>
                  </label>
                  {canApprove && (
                    <label className="block">
                      <span className="va-label">Nota del aprobador (obligatoria)</span>
                      <textarea
                        value={approvalNote}
                        onChange={(e) => setApprovalNote(e.target.value)}
                        rows={3}
                        className="va-field resize-y"
                        placeholder="Ej. autorizado según factura n.º… entregada en recepción; monto verificado con el solicitante."
                      />
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">
                        Mínimo {notesMinLength} caracteres (configuración del taller).
                      </span>
                      <NotesMinCharCounter value={approvalNote} minLength={notesMinLength} />
                    </label>
                  )}
                  {canReject && (
                    <label className="block">
                      <span className="va-label">Motivo del rechazo (obligatorio)</span>
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={3}
                        className="va-field resize-y"
                        placeholder="Explicá con claridad por qué no se autoriza el egreso; lo verá el solicitante."
                      />
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">
                        Mínimo {notesMinLength} caracteres.
                      </span>
                      <NotesMinCharCounter value={rejectReason} minLength={notesMinLength} />
                    </label>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 dark:border-slate-600 dark:text-slate-200"
          >
            Cancelar
          </button>
          {detail && pending && !blocked && canCancel && isOwnRequest && (
            <button
              type="button"
              disabled={acting}
              onClick={() => void cancelReq()}
              className="min-h-[44px] rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
            >
              Cancelar mi solicitud
            </button>
          )}
          {detail && pending && !blocked && canReject && (
            <button
              type="button"
              disabled={acting || !confirmRead}
              onClick={() => void reject()}
              className="min-h-[44px] rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-40 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
            >
              Rechazar
            </button>
          )}
          {detail && pending && !blocked && canApprove && (
            <button
              type="button"
              disabled={acting || !confirmRead}
              onClick={() => void approve()}
              className="min-h-[44px] rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-emerald-900 hover:bg-emerald-800 disabled:opacity-40"
            >
              Aprobar
            </button>
          )}
          {detail && detail.status === 'APPROVED' && !detail.resultMovement && canPayOut && (
            <button
              type="button"
              disabled={acting}
              onClick={() => void registerPayOut()}
              className="va-btn-primary disabled:opacity-40"
            >
              Registrar egreso en caja
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
