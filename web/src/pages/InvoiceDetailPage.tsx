import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type {
  CreateCreditNotePayload,
  CreateDebitNoteLinePayload,
  CreateDebitNotePayload,
  CreditNoteReason,
  DebitNoteReason,
  InvoiceDetail,
  InvoiceDispatchStatus,
  InvoiceStatus,
  RecordInvoicePaymentPayload,
  VoidCreditNotePayload,
  VoidDebitNotePayload,
  VoidInvoicePayload,
} from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { portalPath } from '../constants/portalPath'
import { PageHeader } from '../components/layout/PageHeader'
import { formatCopFromString, normalizeMoneyDecimalStringForApi } from '../utils/copFormat'

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitida DIAN',
  VOIDED: 'Anulada',
}

const DISPATCH_LABEL: Record<InvoiceDispatchStatus, string> = {
  PENDING: 'En cola',
  SUBMITTED: 'Enviada',
  ACCEPTED: 'Aceptada por DIAN',
  REJECTED: 'Rechazada por DIAN',
  ERROR: 'Error técnico',
  NOT_CONFIGURED: 'DIAN apagado / sin credenciales',
}

const REASON_LABEL: Record<CreditNoteReason, string> = {
  VOID: 'Anulación',
  ADJUSTMENT: 'Ajuste',
  RETURN: 'Devolución',
  DISCOUNT: 'Descuento',
}

const DN_REASON_LABEL: Record<DebitNoteReason, string> = {
  PRICE_CORRECTION: 'Corrección de precio',
  ADDITIONAL_CHARGE: 'Recargo adicional',
  INTEREST: 'Interés / mora',
  OTHER: 'Otro',
}

const CN_DN_STATUS_LABEL: Record<'DRAFT' | 'ISSUED' | 'VOIDED', string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitida',
  VOIDED: 'Anulada',
}

function NoteStatusBadge({ status }: { status: 'DRAFT' | 'ISSUED' | 'VOIDED' }) {
  const tone =
    status === 'ISSUED'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : status === 'VOIDED'
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
        : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {CN_DN_STATUS_LABEL[status]}
    </span>
  )
}

type DebitLineForm = {
  description: string
  quantity: string
  unitPrice: string
  taxRatePercent: string
}

function emptyDebitLine(): DebitLineForm {
  return { description: '', quantity: '1', unitPrice: '', taxRatePercent: '0' }
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const tone =
    status === 'ISSUED'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : status === 'VOIDED'
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
        : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = useAuth()

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [voidReason, setVoidReason] = useState('')
  const [showVoidForm, setShowVoidForm] = useState(false)
  const [cnReason, setCnReason] = useState<CreditNoteReason>('VOID')
  const [cnDesc, setCnDesc] = useState('')
  const [showCnForm, setShowCnForm] = useState(false)

  const [showPayForm, setShowPayForm] = useState(false)
  const [payKind, setPayKind] = useState<'partial' | 'full'>('partial')
  const [payAmount, setPayAmount] = useState('')
  const [payTender, setPayTender] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payMsg, setPayMsg] = useState<string | null>(null)

  // Fase 7: emisión de notas débito + ciclo de vida CN/DN.
  const [showDnForm, setShowDnForm] = useState(false)
  const [dnReason, setDnReason] = useState<DebitNoteReason>('PRICE_CORRECTION')
  const [dnDesc, setDnDesc] = useState('')
  const [dnLines, setDnLines] = useState<DebitLineForm[]>([emptyDebitLine()])
  const [dnMsg, setDnMsg] = useState<string | null>(null)

  const [cnVoidingId, setCnVoidingId] = useState<string | null>(null)
  const [cnVoidReason, setCnVoidReason] = useState('')
  const [dnVoidingId, setDnVoidingId] = useState<string | null>(null)
  const [dnVoidReason, setDnVoidReason] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      setMsg(null)
      const res = await api<InvoiceDetail>(`/invoices/${id}`)
      setInvoice(res)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se pudo cargar la factura.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const canIssue = can('invoices:issue')
  const canVoid = can('invoices:void')
  const canCreateCreditNote = can('credit_notes:create')
  const canIssueCreditNote = can('credit_notes:issue')
  const canVoidCreditNote = can('credit_notes:void')
  const canCreateDebitNote = can('debit_notes:create')
  const canIssueDebitNote = can('debit_notes:issue')
  const canVoidDebitNote = can('debit_notes:void')
  const canRecordPayment = can('invoices:record_payment') && can('cash_movements:create_income')
  const amountDueNum = invoice ? Number(invoice.amountDue) : 0
  const hasBalance = amountDueNum > 0
  const canPay = Boolean(
    invoice && canRecordPayment && invoice.status !== 'VOIDED' && hasBalance,
  )

  const hasLiveCreditNote = useMemo(
    () => invoice?.creditNotes.some((cn) => cn.status !== 'VOIDED') ?? false,
    [invoice],
  )

  async function doIssue() {
    if (!invoice) return
    try {
      setBusy(true)
      setMsg(null)
      const res = await api<InvoiceDetail>(`/invoices/${invoice.id}/issue`, { method: 'POST' })
      setInvoice(res)
      if (res.status === 'DRAFT') {
        const last = res.dispatchEvents[0]
        setMsg(
          last?.errorMessage ??
            'Intento de emisión registrado. La factura sigue en borrador (DIAN no respondió aún).',
        )
      }
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se pudo emitir la factura.')
    } finally {
      setBusy(false)
    }
  }

  async function doVoid(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!invoice) return
    try {
      setBusy(true)
      setMsg(null)
      const payload: VoidInvoicePayload = { reason: voidReason.trim() }
      const res = await api<InvoiceDetail>(`/invoices/${invoice.id}/void`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setInvoice(res)
      setShowVoidForm(false)
      setVoidReason('')
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : 'No se pudo anular la factura.')
    } finally {
      setBusy(false)
    }
  }

  async function doRecordPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!invoice) return
    setBusy(true)
    setPayMsg(null)
    try {
      const payload: RecordInvoicePaymentPayload = {
        paymentKind: payKind,
        amount: normalizeMoneyDecimalStringForApi(payAmount),
        note: payNote.trim(),
      }
      if (payTender.trim()) {
        payload.tenderAmount = normalizeMoneyDecimalStringForApi(payTender)
      }
      await api(`/invoices/${invoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setShowPayForm(false)
      setPayAmount('')
      setPayTender('')
      setPayNote('')
      setPayKind('partial')
      await load()
    } catch (e2) {
      setPayMsg(e2 instanceof ApiError ? e2.message : 'No se pudo registrar el cobro.')
    } finally {
      setBusy(false)
    }
  }

  async function doCreditNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!invoice) return
    try {
      setBusy(true)
      setMsg(null)
      const payload: CreateCreditNotePayload = {
        reason: cnReason,
        reasonDescription: cnDesc.trim(),
      }
      await api(`/invoices/${invoice.id}/credit-notes`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setShowCnForm(false)
      setCnDesc('')
      await load()
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : 'No se pudo emitir la nota crédito.')
    } finally {
      setBusy(false)
    }
  }

  async function doIssueCreditNote(cnId: string) {
    try {
      setBusy(true)
      setMsg(null)
      await api(`/credit-notes/${cnId}/issue`, { method: 'POST' })
      await load()
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : 'No se pudo emitir la nota crédito.')
    } finally {
      setBusy(false)
    }
  }

  async function doVoidCreditNote(cnId: string) {
    const reason = cnVoidReason.trim()
    if (reason.length < 5) {
      setMsg('Describí el motivo de la anulación (mínimo 5 caracteres).')
      return
    }
    try {
      setBusy(true)
      setMsg(null)
      const body: VoidCreditNotePayload = { reason }
      await api(`/credit-notes/${cnId}/void`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setCnVoidingId(null)
      setCnVoidReason('')
      await load()
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : 'No se pudo anular la nota crédito.')
    } finally {
      setBusy(false)
    }
  }

  async function doDebitNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!invoice) return
    const cleaned: CreateDebitNoteLinePayload[] = dnLines
      .filter((l) => l.description.trim() && Number(l.unitPrice) > 0)
      .map((l, i) => ({
        lineType: 'LABOR',
        sortOrder: i,
        description: l.description.trim(),
        quantity: l.quantity || '1',
        unitPrice: normalizeMoneyDecimalStringForApi(l.unitPrice),
        taxRatePercent: l.taxRatePercent || '0',
      }))
    if (cleaned.length === 0) {
      setDnMsg('Agregá al menos una línea con descripción y valor.')
      return
    }
    try {
      setBusy(true)
      setDnMsg(null)
      const payload: CreateDebitNotePayload = {
        reason: dnReason,
        reasonDescription: dnDesc.trim(),
        lines: cleaned,
      }
      await api(`/invoices/${invoice.id}/debit-notes`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setShowDnForm(false)
      setDnDesc('')
      setDnLines([emptyDebitLine()])
      setDnReason('PRICE_CORRECTION')
      await load()
    } catch (e2) {
      setDnMsg(e2 instanceof ApiError ? e2.message : 'No se pudo crear la nota débito.')
    } finally {
      setBusy(false)
    }
  }

  async function doIssueDebitNote(dnId: string) {
    try {
      setBusy(true)
      setMsg(null)
      await api(`/debit-notes/${dnId}/issue`, { method: 'POST' })
      await load()
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : 'No se pudo emitir la nota débito.')
    } finally {
      setBusy(false)
    }
  }

  async function doVoidDebitNote(dnId: string) {
    const reason = dnVoidReason.trim()
    if (reason.length < 5) {
      setMsg('Describí el motivo de la anulación (mínimo 5 caracteres).')
      return
    }
    try {
      setBusy(true)
      setMsg(null)
      const body: VoidDebitNotePayload = { reason }
      await api(`/debit-notes/${dnId}/void`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setDnVoidingId(null)
      setDnVoidReason('')
      await load()
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : 'No se pudo anular la nota débito.')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !invoice) {
    return <div className="p-6 text-slate-500">Cargando…</div>
  }
  if (!invoice) {
    return (
      <div className="space-y-4">
        <PageHeader title="Factura" />
        {msg && (
          <div className="rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {msg}
          </div>
        )}
        <button onClick={() => navigate(-1)} className="text-sm text-sky-600 hover:underline">
          ← Volver
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Factura ${invoice.documentNumber}`}
        description={
          invoice.fiscalResolution
            ? `Resolución ${invoice.fiscalResolution.prefix}/${invoice.fiscalResolution.resolutionNumber}`
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={invoice.status} />
            <button
              onClick={() => navigate(portalPath('/facturacion'))}
              className="text-sm text-sky-600 hover:underline dark:text-sky-300"
            >
              ← Lista
            </button>
          </div>
        }
      />

      {msg && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {msg}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Cliente
          </h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Nombre</dt>
              <dd>{invoice.customerName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Documento</dt>
              <dd>{invoice.customerDocumentId ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Teléfono</dt>
              <dd>{invoice.customerPhone ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Correo</dt>
              <dd>{invoice.customerEmail ?? '—'}</dd>
            </div>
            {invoice.sale && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Venta origen</dt>
                <dd>
                  <Link
                    to={portalPath(`/ventas/${invoice.sale.id}`)}
                    className="text-sky-600 hover:underline dark:text-sky-300"
                  >
                    {invoice.sale.publicCode}
                  </Link>
                </dd>
              </div>
            )}
            {invoice.workOrder && (
              <div className="flex justify-between">
                <dt className="text-slate-500">OT origen</dt>
                <dd>
                  <Link
                    to={portalPath(`/ordenes/${invoice.workOrder.id}`)}
                    className="text-sky-600 hover:underline dark:text-sky-300"
                  >
                    {invoice.workOrder.publicCode}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Totales
          </h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular-nums">{formatCopFromString(invoice.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Descuento</dt>
              <dd className="tabular-nums">
                - {formatCopFromString(invoice.totalDiscount)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">IVA</dt>
              <dd className="tabular-nums">{formatCopFromString(invoice.totalVat)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">INC</dt>
              <dd className="tabular-nums">{formatCopFromString(invoice.totalInc)}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold dark:border-slate-700">
              <dt>Total factura</dt>
              <dd className="tabular-nums">{formatCopFromString(invoice.grandTotal)}</dd>
            </div>
            {Number(invoice.totalCreditNotes) > 0 && (
              <div className="flex justify-between text-xs text-rose-700 dark:text-rose-300">
                <dt>(−) Notas crédito emitidas</dt>
                <dd className="tabular-nums">
                  - {formatCopFromString(invoice.totalCreditNotes)}
                </dd>
              </div>
            )}
            {Number(invoice.totalDebitNotes) > 0 && (
              <div className="flex justify-between text-xs text-amber-700 dark:text-amber-300">
                <dt>(+) Notas débito emitidas</dt>
                <dd className="tabular-nums">
                  + {formatCopFromString(invoice.totalDebitNotes)}
                </dd>
              </div>
            )}
            {(Number(invoice.totalCreditNotes) > 0 ||
              Number(invoice.totalDebitNotes) > 0) && (
              <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-semibold dark:border-slate-700">
                <dt>Saldo efectivo</dt>
                <dd className="tabular-nums">
                  {formatCopFromString(invoice.effectiveAmount)}
                </dd>
              </div>
            )}
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-300">
              <dt>Abonado</dt>
              <dd className="tabular-nums">{formatCopFromString(invoice.amountPaid)}</dd>
            </div>
            <div
              className={`flex justify-between text-sm font-semibold ${hasBalance ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}
            >
              <dt>Saldo pendiente</dt>
              <dd className="tabular-nums">{formatCopFromString(invoice.amountDue)}</dd>
            </div>
            {invoice.cufe && (
              <div className="pt-2 text-xs text-slate-500">
                CUFE: <code className="break-all">{invoice.cufe}</code>
              </div>
            )}
          </dl>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Líneas
          </h2>
        </header>
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2 text-right">Cantidad</th>
              <th className="px-4 py-2 text-right">Precio</th>
              <th className="px-4 py-2 text-right">Desc.</th>
              <th className="px-4 py-2 text-right">Imp.</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {invoice.lines.map((ln) => (
              <tr key={ln.id}>
                <td className="px-4 py-2">
                  <div className="font-medium">{ln.description ?? '—'}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{ln.quantity}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCopFromString(ln.unitPrice)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCopFromString(ln.discountAmount)}
                </td>
                <td className="px-4 py-2 text-right text-xs tabular-nums">
                  {ln.taxRatePercentSnapshot !== '0' ? `${ln.taxRatePercentSnapshot}%` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">
                  {formatCopFromString(ln.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Cola de despacho DIAN
          </h2>
          {invoice.status === 'DRAFT' && canIssue && (
            <button
              disabled={busy}
              onClick={doIssue}
              className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Reintentar emisión
            </button>
          )}
        </header>
        {invoice.dispatchEvents.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay intentos de envío.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {invoice.dispatchEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between rounded border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <div>
                  <div className="font-medium">
                    #{e.attempt} · {DISPATCH_LABEL[e.status]}
                  </div>
                  <div className="text-xs text-slate-500">
                    {e.provider ?? 'noop'} · {e.environment ?? 'sandbox'} ·{' '}
                    {new Date(e.requestedAt).toLocaleString()}
                  </div>
                  {e.errorMessage && (
                    <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                      {e.errorMessage}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Pagos en caja
          </h2>
          {canPay && (
            <button
              onClick={() => setShowPayForm((v) => !v)}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Registrar cobro
            </button>
          )}
        </header>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay cobros registrados contra esta factura.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {invoice.payments.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between rounded border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <div>
                  <div className="font-medium tabular-nums">
                    {formatCopFromString(p.amount)} ·{' '}
                    {p.kind === 'FULL_SETTLEMENT' ? 'Liquidación' : 'Abono'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(p.createdAt).toLocaleString()}
                    {p.recordedBy ? ` · ${p.recordedBy.fullName}` : ''}
                    {p.cashMovement?.category ? ` · ${p.cashMovement.category.name}` : ''}
                  </div>
                  {p.note && <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{p.note}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showPayForm && canPay && (
        <form
          onSubmit={doRecordPayment}
          className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-emerald-900 dark:text-emerald-100">Tipo de pago</span>
              <select
                value={payKind}
                onChange={(e) => setPayKind(e.target.value as 'partial' | 'full')}
                className="mt-1 w-full rounded-md border border-emerald-300 bg-white px-2 py-1 text-sm dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="partial">Abono (deja saldo)</option>
                <option value="full">Pago total (liquida)</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-emerald-900 dark:text-emerald-100">Monto (COP)</span>
              <input
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
                inputMode="numeric"
                placeholder={invoice.amountDue}
                className="mt-1 w-full rounded-md border border-emerald-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Saldo pendiente: {formatCopFromString(invoice.amountDue)}
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-emerald-900 dark:text-emerald-100">
                Efectivo entregado (opcional)
              </span>
              <input
                value={payTender}
                onChange={(e) => setPayTender(e.target.value)}
                inputMode="numeric"
                placeholder="Ej. 20000"
                className="mt-1 w-full rounded-md border border-emerald-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Si se informa, el sistema calcula el vuelto (tender − amount).
              </span>
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-emerald-900 dark:text-emerald-100">
              Nota del cobro (obligatoria)
            </span>
            <textarea
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              rows={3}
              minLength={70}
              required
              className="mt-1 w-full rounded-md border border-emerald-300 bg-white p-2 text-sm dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Describe el cobro: cómo y cuándo se recibió, referencias cruzadas, etc. (mínimo 70 caracteres por política del taller)"
            />
          </label>
          {payMsg && (
            <div className="rounded-md bg-rose-100 p-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {payMsg}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPayForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Registrar cobro
            </button>
          </div>
        </form>
      )}

      {invoice.creditNotes.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Notas crédito
          </h2>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
            {invoice.creditNotes.map((cn) => (
              <li key={cn.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{cn.documentNumber}</span>
                    <NoteStatusBadge status={cn.status} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {REASON_LABEL[cn.reason]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-slate-600 dark:text-slate-300">
                      {formatCopFromString(cn.grandTotal)}
                    </span>
                    {cn.status === 'DRAFT' && canIssueCreditNote && (
                      <button
                        onClick={() => void doIssueCreditNote(cn.id)}
                        disabled={busy}
                        className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300"
                      >
                        Emitir DIAN
                      </button>
                    )}
                    {cn.status !== 'VOIDED' && canVoidCreditNote && (
                      <button
                        onClick={() => {
                          setCnVoidingId(cn.id === cnVoidingId ? null : cn.id)
                          setCnVoidReason('')
                        }}
                        disabled={busy}
                        className="rounded-md border border-rose-300 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-700 dark:text-rose-300"
                      >
                        Anular
                      </button>
                    )}
                  </div>
                </div>
                {cnVoidingId === cn.id && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md bg-rose-50 p-2 dark:bg-rose-950">
                    <textarea
                      value={cnVoidReason}
                      onChange={(e) => setCnVoidReason(e.target.value)}
                      rows={2}
                      minLength={5}
                      maxLength={1000}
                      placeholder="Motivo de la anulación (obligatorio, ≥ 5 caracteres)"
                      className="w-full rounded-md border border-rose-300 bg-white p-2 text-sm dark:border-rose-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setCnVoidingId(null)
                          setCnVoidReason('')
                        }}
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-600"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => void doVoidCreditNote(cn.id)}
                        disabled={busy}
                        className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        Confirmar anulación
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {invoice.debitNotes.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Notas débito
          </h2>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
            {invoice.debitNotes.map((dn) => (
              <li key={dn.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{dn.documentNumber}</span>
                    <NoteStatusBadge status={dn.status} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {DN_REASON_LABEL[dn.reason]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-slate-600 dark:text-slate-300">
                      +{formatCopFromString(dn.grandTotal)}
                    </span>
                    {dn.status === 'DRAFT' && canIssueDebitNote && (
                      <button
                        onClick={() => void doIssueDebitNote(dn.id)}
                        disabled={busy}
                        className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300"
                      >
                        Emitir DIAN
                      </button>
                    )}
                    {dn.status !== 'VOIDED' && canVoidDebitNote && (
                      <button
                        onClick={() => {
                          setDnVoidingId(dn.id === dnVoidingId ? null : dn.id)
                          setDnVoidReason('')
                        }}
                        disabled={busy}
                        className="rounded-md border border-rose-300 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-700 dark:text-rose-300"
                      >
                        Anular
                      </button>
                    )}
                  </div>
                </div>
                {dnVoidingId === dn.id && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md bg-rose-50 p-2 dark:bg-rose-950">
                    <textarea
                      value={dnVoidReason}
                      onChange={(e) => setDnVoidReason(e.target.value)}
                      rows={2}
                      minLength={5}
                      maxLength={1000}
                      placeholder="Motivo de la anulación (obligatorio, ≥ 5 caracteres)"
                      className="w-full rounded-md border border-rose-300 bg-white p-2 text-sm dark:border-rose-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setDnVoidingId(null)
                          setDnVoidReason('')
                        }}
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-600"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => void doVoidDebitNote(dn.id)}
                        disabled={busy}
                        className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        Confirmar anulación
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {invoice.status === 'DRAFT' && canVoid && (
          <button
            onClick={() => setShowVoidForm((v) => !v)}
            className="rounded-md border border-rose-300 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300"
          >
            Anular factura
          </button>
        )}
        {invoice.status === 'ISSUED' && canCreateCreditNote && !hasLiveCreditNote && (
          <button
            onClick={() => setShowCnForm((v) => !v)}
            className="rounded-md border border-amber-300 px-3 py-1 text-sm text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300"
          >
            Emitir nota crédito
          </button>
        )}
        {invoice.status === 'ISSUED' && canCreateDebitNote && (
          <button
            onClick={() => setShowDnForm((v) => !v)}
            className="rounded-md border border-sky-300 px-3 py-1 text-sm text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300"
          >
            Emitir nota débito
          </button>
        )}
      </div>

      {showVoidForm && (
        <form
          onSubmit={doVoid}
          className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950"
        >
          <label className="block text-sm font-medium text-rose-900 dark:text-rose-100">
            Motivo de anulación
          </label>
          <textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={3}
            minLength={5}
            maxLength={1000}
            required
            className="w-full rounded-md border border-rose-300 bg-white p-2 text-sm dark:border-rose-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowVoidForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-rose-600 px-3 py-1 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            >
              Anular
            </button>
          </div>
        </form>
      )}

      {showCnForm && (
        <form
          onSubmit={doCreditNote}
          className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
        >
          <div>
            <label className="block text-sm font-medium text-amber-900 dark:text-amber-100">
              Motivo
            </label>
            <select
              value={cnReason}
              onChange={(e) => setCnReason(e.target.value as CreditNoteReason)}
              className="mt-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="VOID">Anulación total</option>
              <option value="ADJUSTMENT">Ajuste</option>
              <option value="RETURN">Devolución</option>
              <option value="DISCOUNT">Descuento</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-amber-900 dark:text-amber-100">
              Descripción
            </label>
            <textarea
              value={cnDesc}
              onChange={(e) => setCnDesc(e.target.value)}
              rows={3}
              minLength={5}
              maxLength={2000}
              required
              className="mt-1 w-full rounded-md border border-amber-300 bg-white p-2 text-sm dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCnForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              Emitir NC
            </button>
          </div>
        </form>
      )}

      {showDnForm && (
        <form
          onSubmit={doDebitNote}
          className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950"
        >
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-sky-900 dark:text-sky-100">
                Motivo
              </label>
              <select
                value={dnReason}
                onChange={(e) => setDnReason(e.target.value as DebitNoteReason)}
                className="mt-1 w-full rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="PRICE_CORRECTION">Corrección de precio</option>
                <option value="ADDITIONAL_CHARGE">Recargo adicional</option>
                <option value="INTEREST">Interés / mora</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sky-900 dark:text-sky-100">
                Descripción del motivo
              </label>
              <input
                value={dnDesc}
                onChange={(e) => setDnDesc(e.target.value)}
                minLength={5}
                maxLength={2000}
                required
                placeholder="Detalle breve que justifique el cargo"
                className="mt-1 w-full rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium text-sky-900 dark:text-sky-100">
                Conceptos a cargar
              </label>
              <button
                type="button"
                onClick={() => setDnLines((ls) => [...ls, emptyDebitLine()])}
                className="rounded-md border border-sky-300 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300"
              >
                + Agregar línea
              </button>
            </div>
            <div className="space-y-2">
              {dnLines.map((ln, idx) => (
                <div key={idx} className="grid gap-2 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
                  <input
                    value={ln.description}
                    onChange={(e) =>
                      setDnLines((ls) =>
                        ls.map((v, i) => (i === idx ? { ...v, description: e.target.value } : v)),
                      )
                    }
                    placeholder="Descripción"
                    className="rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    value={ln.quantity}
                    onChange={(e) =>
                      setDnLines((ls) =>
                        ls.map((v, i) => (i === idx ? { ...v, quantity: e.target.value } : v)),
                      )
                    }
                    placeholder="Cantidad"
                    className="rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    value={ln.unitPrice}
                    onChange={(e) =>
                      setDnLines((ls) =>
                        ls.map((v, i) => (i === idx ? { ...v, unitPrice: e.target.value } : v)),
                      )
                    }
                    placeholder="Valor (COP)"
                    className="rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    value={ln.taxRatePercent}
                    onChange={(e) =>
                      setDnLines((ls) =>
                        ls.map((v, i) =>
                          i === idx ? { ...v, taxRatePercent: e.target.value } : v,
                        ),
                      )
                    }
                    placeholder="IVA %"
                    className="rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDnLines((ls) =>
                        ls.length === 1 ? [emptyDebitLine()] : ls.filter((_, i) => i !== idx),
                      )
                    }
                    className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          </div>

          {dnMsg && (
            <div className="rounded-md bg-rose-100 p-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {dnMsg}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowDnForm(false)
                setDnMsg(null)
              }}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Crear ND (borrador)
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
