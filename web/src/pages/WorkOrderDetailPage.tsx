import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, openAuthenticatedHtml } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { portalPath } from '../constants/portalPath'
import { useAlert, useConfirm } from '../components/confirm/ConfirmProvider'
import { ClientConsentSignModal } from '../components/work-order/ClientConsentSignModal'
import { ClientConsentSignedModal } from '../components/work-order/ClientConsentSignedModal'
import { TransitLicenseOcrPanel } from '../components/work-order/TransitLicenseOcrPanel'
import { NotesMinCharCounter } from '../components/NotesMinCharCounter'
import {
  notesMinHint,
  parseNotesUiContext,
  SETTINGS_UI_CONTEXT_PATH,
  type SettingsUiContextResponse,
} from '../config/operationalNotes'
import { PageHeader } from '../components/layout/PageHeader'
import { useCashSessionOpen } from '../context/CashSessionOpenContext'
import { useWorkOrderDetailMutations } from '../features/work-orders/hooks/useWorkOrderDetailMutations'
import { useWorkOrderDetailCache } from '../features/work-orders/hooks/useWorkOrderDetailCache'
import type { WorkOrderPaymentRow } from '../features/work-orders/services/workOrdersListApi'
import { panelUsesModernShell } from '../config/operationalNotes'
import { usePanelTheme } from '../theme/PanelThemeProvider'
import { queryKeys } from '../lib/queryKeys'
import type { ParsedTransitLicenseFields } from '../utils/parseTransitLicenseOcr'
import {
  API_MONEY_DECIMAL_REGEX,
  formatCopFromString,
  formatCopInteger,
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../utils/copFormat'
import {
  printTicketFromApi,
  successMessageWithTicketAndPulse,
} from '../services/cashDrawerBridge'
import { cashIncomeCategoryOpensPhysicalDrawer } from '../services/cashIncomePhysicalDrawer'
import { normalizeListResponse } from '../utils/normalizeListResponse'
import type {
  AuthUser,
  SparePart,
  WorkOrderDetail,
  WorkOrderLine,
  WorkOrderLineType,
  WorkOrderPatchResult,
  WorkOrderStatus,
} from '../api/types'

type CashCat = { slug: string; name: string; direction: string }

type TaxRateCatalogRow = {
  id: string
  slug: string
  name: string
  kind: 'VAT' | 'INC'
  ratePercent: string
  isActive: boolean
}

/**
 * Panel de totales de la OT (Fase 2).
 *
 * Se muestra solo lo que aporta valor: si la persona natural opera sin IVA ni descuentos,
 * oculta las filas vacías; cuando se activa DIAN / impuestos por línea, aparecen automáticamente.
 * `canSeeCosts` habilita costo y utilidad (administración / dueño con `reports:read`).
 */
/** Conflictos / permisos: mejor modal que aviso discreto bajo el título. */
function isBlockingWorkOrderApiError(err: unknown): boolean {
  if (err instanceof ApiError && (err.status === 409 || err.status === 403)) return true
  const m = err instanceof Error ? err.message : ''
  return /cerrada|no admite cambios/i.test(m)
}

const STATUS: Record<WorkOrderStatus, { label: string; tone: string }> = {
  UNASSIGNED: {
    label: 'Sin asignar',
    tone: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  },
  RECEIVED: { label: 'Recibida', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  IN_WORKSHOP: { label: 'En taller', tone: 'bg-blue-50 text-blue-800 dark:bg-blue-900 dark:text-blue-50' },
  WAITING_PARTS: {
    label: 'Esperando repuestos',
    tone: 'bg-amber-50 text-amber-900 dark:bg-amber-900 dark:text-amber-50',
  },
  READY: { label: 'Lista', tone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-50' },
  DELIVERED: { label: 'Entregada', tone: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  CANCELLED: { label: 'Cancelada', tone: 'bg-red-50 text-red-800 dark:bg-red-900 dark:text-red-50' },
}

/** Misma regla que el API: cobros solo en Recibida → Lista (no Sin asignar, Entregada ni Cancelada). */
const WORK_ORDER_PAYABLE_STATUSES: readonly WorkOrderStatus[] = [
  'RECEIVED',
  'IN_WORKSHOP',
  'WAITING_PARTS',
  'READY',
]

/** Cajero: solo cobros + líneas en lectura; administrador/dueño ven todo salvo que previsualicen como cajero. */
function isCashierWorkOrderSimplifiedView(u: AuthUser | null): boolean {
  if (!u) return false
  const prev = u.previewRole?.slug
  if (prev === 'cajero' || prev === 'cajero_autorizado') return true
  const slugs = u.roleSlugs ?? []
  if (slugs.includes('administrador') || slugs.includes('dueno')) return false
  return slugs.includes('cajero') || slugs.includes('cajero_autorizado')
}

/**
 * Ocultar caja/cobros/resumen de cobro en detalle de OT.
 * Basado en permisos efectivos (vista por rol incluida), no solo en `roleSlugs`, para que funcione aunque falte ese campo en sesión.
 * La vista cajero (`cashierOnly`) sigue mostrando cobros aunque el rol real sea mixto.
 */
function hideWorkOrderCashSection(u: AuthUser | null, can: (code: string) => boolean): boolean {
  if (!u || isCashierWorkOrderSimplifiedView(u)) return false
  return !can('work_orders:record_payment') || !can('cash_movements:create_income')
}

/** Consentimiento en facturación: fondo como Guardar orden; texto ámbar como «Sin técnico asignado». */
const FACTURACION_CONSENT_BTN =
  'rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm hover:bg-slate-900 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-slate-500 dark:bg-slate-700 dark:text-amber-200 dark:hover:bg-slate-600 dark:hover:text-amber-100'

function lineMoney(ln: WorkOrderLine): string {
  if (ln.totals?.grossAmount != null) {
    const g = Number(ln.totals.grossAmount)
    if (!Number.isNaN(g)) return formatCopInteger(g)
  }
  const q = Number(ln.quantity)
  const p = ln.unitPrice != null ? Number(ln.unitPrice) : 0
  if (Number.isNaN(q) || Number.isNaN(p)) return '—'
  return formatCopInteger(q * p)
}

/** Suma de brutos por línea (alineado con `computeWorkOrderTotals` cuando hay `totals` por línea). */
function linesSubtotalFromLines(lines: WorkOrderLine[]): string {
  let sum = 0
  for (const ln of lines) {
    if (ln.totals?.grossAmount != null) {
      const g = Number(ln.totals.grossAmount)
      if (!Number.isNaN(g)) sum += g
      continue
    }
    const q = Number(ln.quantity)
    const p = ln.unitPrice != null ? Number(ln.unitPrice) : 0
    if (!Number.isNaN(q) && !Number.isNaN(p)) sum += q * p
  }
  return formatCopInteger(sum)
}

/** Aplica la respuesta del PATCH al estado local antes de un GET detalle (actualización inmediata en pantalla). */
function mergeWorkOrderPatchIntoState(
  patch: WorkOrderPatchResult,
  setWo: Dispatch<SetStateAction<WorkOrderDetail | null>>,
  setWoStatus: (s: WorkOrderStatus) => void,
  setWoDesc: (s: string) => void,
) {
  setWo((prev) => {
    if (!prev) return prev
    const at = patch.assignedTo
    const nextStatus = patch.status ?? prev.status
    return {
      ...prev,
      status: nextStatus,
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      assignedTo: at ? { id: at.id, fullName: at.fullName, email: at.email } : null,
    }
  })
  if (patch.status !== undefined) setWoStatus(patch.status)
  if (patch.description !== undefined) setWoDesc(patch.description)
}

type AssignableUserRow = { id: string; fullName: string; email: string }

/** Devuelve `value` actualizado solo si no cambió durante `delayMs` (autocompletado del catálogo de líneas). */
function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const {
    patchWorkOrder,
    patchWorkOrderPlain,
    postLine,
    deleteLine,
    patchLine,
    reopenDelivered,
    recordPayment: recordPaymentMutation,
  } = useWorkOrderDetailMutations(id)
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceMsg, setInvoiceMsg] = useState<string | null>(null)
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  /** Evita que `load` cambie de identidad cada render si el contexto recrea `can`; sin esto el `useEffect` puede spamear `load()` y pisar el estado. */
  const canRef = useRef(can)
  canRef.current = can
  const confirm = useConfirm()
  const blockingAlert = useAlert()
  const [wo, setWo] = useState<WorkOrderDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [addKind, setAddKind] = useState<WorkOrderLineType>('PART')
  const [partDesc, setPartDesc] = useState('')
  const [laborDesc, setLaborDesc] = useState('')
  const partDescInputRef = useRef<HTMLInputElement | null>(null)
  const laborDescInputRef = useRef<HTMLInputElement | null>(null)

  const [editLine, setEditLine] = useState<WorkOrderLine | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDiscount, setEditDiscount] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editTaxRateId, setEditTaxRateId] = useState<string>('')
  /** Línea recién agregada: su fila queda editable hasta que se sale de los campos o se agrega otra. */
  /** Fila recién agregada/duplicada a la que se le enfoca un campo (`seq` fuerza el foco aun si se repite). */
  const [autoEditFocus, setAutoEditFocus] = useState<{ id: string; seq: number } | null>(null)
  const lineFocusRef = useRef<HTMLInputElement | null>(null)

  // Catálogo de Impuestos: se usa al editar una línea (la OT se agrega directo, foco autopiezas).
  const [taxRatesCatalog, setTaxRatesCatalog] = useState<TaxRateCatalogRow[]>([])

  const [payments, setPayments] = useState<WorkOrderPaymentRow[]>([])
  const [payAmt, setPayAmt] = useState('')
  const [payTender, setPayTender] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payKind, setPayKind] = useState<'partial' | 'full'>('partial')
  const [payCat, setPayCat] = useState('ingreso_cobro')
  const [payAck, setPayAck] = useState(false)
  const [payTwoCopies, setPayTwoCopies] = useState(false)
  const [incomeCats, setIncomeCats] = useState<CashCat[]>([])
  const [notesMinPayment, setNotesMinPayment] = useState(70)
  const [notesMinGeneral, setNotesMinGeneral] = useState(50)
  const [reopenNote, setReopenNote] = useState('')
  const [reopenJustification, setReopenJustification] = useState('')
  const [reopenBusy, setReopenBusy] = useState(false)
  /** Errores del flujo de cobro: se muestran en esta sección (el `msg` global queda arriba y casi no se ve). */
  const [payFormError, setPayFormError] = useState<string | null>(null)
  const [paymentBusy, setPaymentBusy] = useState(false)
  const cashModalBodyRef = useRef<HTMLDivElement | null>(null)
  /** Ventana flotante de cobros: reemplaza la sección «Cobros en caja» que vivía dentro de la página. */
  const [cashModalOpen, setCashModalOpen] = useState(false)
  const { open: cashOpen, loadStatus: cashOpenLoadStatus, refresh: refreshCashOpen } = useCashSessionOpen()

  useEffect(() => {
    if (!cashModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCashModalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cashModalOpen])

  const [woDesc, setWoDesc] = useState('')
  const [woCustomerName, setWoCustomerName] = useState('')
  const [woCustomerEmail, setWoCustomerEmail] = useState('')
  const [woCustomerPhone, setWoCustomerPhone] = useState('')
  const [woVehiclePlate, setWoVehiclePlate] = useState('')
  const [woVehicleBrand, setWoVehicleBrand] = useState('')
  const [woVehicleModel, setWoVehicleModel] = useState('')
  const [woVehicleLine, setWoVehicleLine] = useState('')
  const [woVehicleCylinderCc, setWoVehicleCylinderCc] = useState('')
  const [woVehicleColor, setWoVehicleColor] = useState('')
  const [woIntakeKm, setWoIntakeKm] = useState('')
  const [woStatus, setWoStatus] = useState<WorkOrderStatus>('UNASSIGNED')
  const [assignableUsers, setAssignableUsers] = useState<AssignableUserRow[] | null>(null)
  const [reassignUserId, setReassignUserId] = useState('')
  const [assignBusy, setAssignBusy] = useState(false)
  /** Consentimiento: modal ver firmado o modal registrar (ya no hay tarjeta fija en la página). */
  const [consentModal, setConsentModal] = useState<null | 'view' | 'sign'>(null)
  const [orderDataModalOpen, setOrderDataModalOpen] = useState(false)

  const cashierOnly = useMemo(() => isCashierWorkOrderSimplifiedView(user), [user])

  // Repuestos: combobox sobre el catálogo maestro (foco autopiezas). Elegir un repuesto lo agrega en el momento
  // (cantidad 1) y, si el SKU ya está en la OT, suma cantidad en vez de duplicar. Texto libre que no coincide se
  // agrega al catálogo con el siguiente SKU consecutivo y pasa a la orden.
  const [partCatalogTerm, setPartCatalogTerm] = useState('')
  const [partComboOpen, setPartComboOpen] = useState(false)
  const [partComboIndex, setPartComboIndex] = useState(-1)
  const debouncedPartTerm = useDebouncedValue(partCatalogTerm.trim().slice(0, 60), 220)
  const partSearchQuery = useQuery({
    queryKey: queryKeys.spareParts.search(debouncedPartTerm),
    queryFn: ({ signal }) =>
      api<{ items: SparePart[]; total: number }>(
        `/spare-parts?q=${encodeURIComponent(debouncedPartTerm)}&limit=12`,
        { signal },
      ),
    enabled: debouncedPartTerm.length >= 2,
    staleTime: 60_000,
  })
  const partSuggestions = useMemo(() => partSearchQuery.data?.items ?? [], [partSearchQuery.data])
  const partTermLower = debouncedPartTerm.trim().toLowerCase()
  const partTermSkuNorm = debouncedPartTerm.trim().toUpperCase()
  const partExactCandidate = useMemo(
    () =>
      partSearchQuery.data?.items.find(
        (s) => s.sku.toUpperCase() === partTermSkuNorm || s.name.toLowerCase() === partTermLower,
      ) ?? null,
    [partSearchQuery.data, partTermLower, partTermSkuNorm],
  )
  const canCreateSparePart = can('repuestos:create')

  const hideWorkOrderCashUi = useMemo(() => hideWorkOrderCashSection(user, can), [user, can])

  const applyTransitLicenseFromOcr = useCallback((p: ParsedTransitLicenseFields) => {
    if (p.plate) setWoVehiclePlate(p.plate)
    if (p.brand) setWoVehicleBrand(p.brand)
    if (p.model) setWoVehicleModel(p.model)
    if (p.line) setWoVehicleLine(p.line)
    if (p.cylinderCc) setWoVehicleCylinderCc(p.cylinderCc)
    if (p.color) setWoVehicleColor(p.color)
  }, [])

  const showBlockingConflictModal = useCallback(
    async (err: unknown) => {
      if (!wo || !isBlockingWorkOrderApiError(err)) return false
      const raw = err instanceof Error ? err.message : 'Operación no permitida'
      await blockingAlert({
        title: `Orden ${wo.publicCode} · ${STATUS[wo.status].label}`,
        message: (
          <Fragment>
            <p className="font-medium text-slate-800 dark:text-slate-100">{raw}</p>
            <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Si necesitás modificar una orden con restricciones (por ejemplo ya cerrada o sin permiso), consultá a un
              administrador o dueño del taller.
            </p>
          </Fragment>
        ),
        okLabel: 'Entendido',
      })
      return true
    },
    [wo, blockingAlert],
  )

  const canReadWoPayments = useMemo(() => can('work_orders:read'), [can])
  const queryClient = useQueryClient()
  const { detailQuery, paymentsQuery, refetchBundle } = useWorkOrderDetailCache(id, {
    hideCashUi: hideWorkOrderCashUi,
    canReadPayments: canReadWoPayments,
  })
  const load = refetchBundle

  useLayoutEffect(() => {
    const data = detailQuery.data
    if (!data) return
    setWo(data)
    setWoDesc(data.description)
    setWoCustomerName((data.customerName ?? '').trim())
    setWoCustomerEmail((data.customerEmail ?? '').trim())
    setWoCustomerPhone((data.customerPhone ?? '').trim())
    setWoVehiclePlate((data.vehiclePlate ?? '').trim())
    setWoVehicleBrand((data.vehicleBrand ?? '').trim())
    setWoVehicleModel((data.vehicleModel ?? '').trim())
    setWoVehicleLine((data.vehicleLine ?? '').trim())
    setWoVehicleCylinderCc((data.vehicleCylinderCc ?? '').trim())
    setWoVehicleColor((data.vehicleColor ?? '').trim())
    setWoIntakeKm(data.intakeOdometerKm != null ? String(data.intakeOdometerKm) : '')
    setWoStatus(data.status)
  }, [detailQuery.data])

  useLayoutEffect(() => {
    if (hideWorkOrderCashUi) {
      setPayments([])
      return
    }
    if (paymentsQuery.data) setPayments(paymentsQuery.data)
  }, [hideWorkOrderCashUi, paymentsQuery.data])

  useEffect(() => {
    if (detailQuery.isError) {
      const e = detailQuery.error
      setErr(e instanceof Error ? e.message : 'No se pudo cargar la orden')
    } else {
      setErr(null)
    }
  }, [detailQuery.isError, detailQuery.error])

  /**
   * Tras mutar líneas: lista (tabla) + resumen del servidor (subtotal, totales y saldo del
   * encabezado). Se actualiza el detalle a mano y no con `load()` para no pisar el formulario
   * de datos de la orden si el usuario tiene cambios sin guardar.
   */
  const refreshLinesOnWorkOrder = useCallback(async () => {
    if (!id) return
    const lines = await api<WorkOrderLine[]>(`/work-orders/${id}/lines`)
    const linesSubtotal = canRef.current('work_orders:view_financials') ||
      canRef.current('work_order_lines:set_unit_price') ||
      canRef.current('work_orders:record_payment')
      ? linesSubtotalFromLines(lines)
      : null
    setWo((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        lines,
        linesSubtotal,
      }
    })
    queryClient.setQueryData<WorkOrderDetail>(queryKeys.workOrders.detail(id), (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        lines,
        linesSubtotal: linesSubtotal ?? prev.linesSubtotal,
      }
    })
    // Totales y saldo los calcula el servidor: sin esto el encabezado queda desfasado hasta recargar.
    try {
      const detail = await api<WorkOrderDetail>(`/work-orders/${id}`)
      const summaryPatch = (prev: WorkOrderDetail) => ({
        lines,
        linesSubtotal: detail.linesSubtotal ?? linesSubtotal ?? prev.linesSubtotal,
        totals: detail.totals ?? prev.totals,
        amountDue: detail.amountDue ?? prev.amountDue,
        paymentSummary: detail.paymentSummary ?? prev.paymentSummary,
      })
      setWo((prev) => (prev ? { ...prev, ...summaryPatch(prev) } : prev))
      queryClient.setQueryData<WorkOrderDetail>(queryKeys.workOrders.detail(id), (prev) =>
        prev ? { ...prev, ...summaryPatch(prev) } : prev,
      )
    } catch {
      /* si falla el resumen, igual quedaron actualizadas las líneas */
    }
  }, [id, queryClient])

  useEffect(() => {
    setConsentModal(null)
  }, [id])

  useEffect(() => {
    void api<SettingsUiContextResponse>(SETTINGS_UI_CONTEXT_PATH)
      .then((r) => {
        const ctx = parseNotesUiContext(r)
        setNotesMinPayment(ctx.notesMinLengthWorkOrderPayment)
        setNotesMinGeneral(ctx.notesMinLengthChars)
      })
      .catch(() => undefined)
  }, [])

  // Fase 2: el catálogo de impuestos solo se lee cuando el usuario tiene permiso (si no, simplemente se queda vacío).
  // No condicionamos el montado del editor de líneas a este catálogo: si está vacío, el select no aparece.
  useEffect(() => {
    if (!canRef.current('tax_rates:read')) return
    void api<TaxRateCatalogRow[] | { items: TaxRateCatalogRow[] }>(`/tax-rates?activeOnly=true`)
      .then((r) => setTaxRatesCatalog(normalizeListResponse<TaxRateCatalogRow>(r)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (wo && payKind === 'full' && wo.amountDue != null) {
      setPayAmt(normalizeMoneyDecimalStringForApi(wo.amountDue))
    }
  }, [wo?.id, wo?.amountDue, payKind])

  useEffect(() => {
    setPayFormError(null)
  }, [payKind, payAmt, payNote, payAck, payTender])

  useEffect(() => {
    if (hideWorkOrderCashUi || !can('cash_movements:create_income')) return
    void api<CashCat[]>('/cash/categories')
      .then((c) => {
        const inc = c.filter((x) => x.direction === 'INCOME')
        setIncomeCats(inc)
        setPayCat((prev) => (inc.some((x) => x.slug === prev) ? prev : inc[0]?.slug ?? 'ingreso_cobro'))
      })
      .catch(() => undefined)
  }, [can, hideWorkOrderCashUi])

  const closed = wo?.status === 'DELIVERED' || wo?.status === 'CANCELLED'

  const canMutateLines =
    wo &&
    !closed &&
    !cashierOnly &&
    can('work_orders:update') &&
    can('work_order_lines:create')
  const canDeleteLine =
    wo && !closed && !cashierOnly && can('work_orders:update') && can('work_order_lines:delete')
  const canUpdateLine =
    wo && !closed && !cashierOnly && can('work_orders:update') && can('work_order_lines:update')
  const canViewWoFinancials = useMemo(
    () =>
      can('work_orders:view_financials') ||
      can('work_order_lines:set_unit_price') ||
      can('work_orders:record_payment'),
    [can],
  )
  /** Precio proveedor / costo: alineado con `actorMayViewWorkOrderCosts` (solo `reports:read`). */
  const canViewWoCosts = useMemo(() => can('reports:read'), [can])
  /**
   * Mostrar formulario abono / pago total: permisos + caja abierta (no exigir estado aquí: si la OT está en
   * «Sin asignar» u otra etapa no cobrable, el usuario igual ve el bloque con aviso y el botón deshabilitado).
   */
  const paymentFormOpen =
    Boolean(wo) &&
    !hideWorkOrderCashUi &&
    cashOpen === true &&
    can('work_orders:record_payment') &&
    can('cash_movements:create_income')

  const workOrderStatusAllowsPayment =
    wo != null && WORK_ORDER_PAYABLE_STATUSES.includes(wo.status)

  const canSubmitWorkOrderPayment =
    paymentFormOpen && workOrderStatusAllowsPayment && wo != null && wo.amountDue != null

  /** Saldo pendiente (numérico) para el resumen financiero del banner superior. */
  const woAmountDueNum = wo?.amountDue != null ? Number(wo.amountDue) : 0

  /** Cobros en OT: solo con sesión de caja abierta (todos los roles; capa global). */
  const showCobrosCajaFull = !hideWorkOrderCashUi && cashOpen === true
  const showCobrosCajaBlocked = !hideWorkOrderCashUi && cashOpen !== true

  const canPatchWo = wo && can('work_orders:update') && !cashierOnly

  /** Alineado con `saveWorkOrder`: si hay diferencias respecto al último `wo` cargado, el botón pide guardar con color de acción. */
  const workOrderFormDirty = useMemo(() => {
    if (!wo || !canPatchWo) return false
    const descChanged = woDesc.trim() !== wo.description
    const statusChanged = woStatus !== wo.status
    const prevCustomerName = (wo.customerName ?? '').trim()
    const newCustomerName = woCustomerName.trim()
    const nameChanged = newCustomerName !== prevCustomerName
    const prevEmail = (wo.customerEmail ?? '').trim()
    const newEmail = woCustomerEmail.trim()
    const emailChanged = newEmail !== prevEmail
    const prevPhone = (wo.customerPhone ?? '').trim()
    const newPhone = woCustomerPhone.trim()
    const phoneChanged = newPhone !== prevPhone
    const prevPlate = (wo.vehiclePlate ?? '').trim()
    const newPlate = woVehiclePlate.trim()
    const plateChanged = newPlate !== prevPlate
    const prevBrand = (wo.vehicleBrand ?? '').trim()
    const newBrand = woVehicleBrand.trim()
    const brandChanged = newBrand !== prevBrand
    const prevModel = (wo.vehicleModel ?? '').trim()
    const newModel = woVehicleModel.trim()
    const modelChanged = newModel !== prevModel
    const prevLine = (wo.vehicleLine ?? '').trim()
    const newLine = woVehicleLine.trim()
    const lineChanged = newLine !== prevLine
    const prevCylinder = (wo.vehicleCylinderCc ?? '').trim()
    const newCylinder = woVehicleCylinderCc.trim()
    const cylinderChanged = newCylinder !== prevCylinder
    const prevVehicleColor = (wo.vehicleColor ?? '').trim()
    const newVehicleColor = woVehicleColor.trim()
    const vehicleColorChanged = newVehicleColor !== prevVehicleColor
    const prevKm = wo.intakeOdometerKm ?? null
    const kmTrim = woIntakeKm.trim()
    let newKmParsed: number | null = null
    if (kmTrim !== '') {
      const n = Number(kmTrim)
      if (!Number.isInteger(n) || n < 0 || n > 9_999_999) {
        return true
      }
      newKmParsed = n
    }
    const kmChanged = newKmParsed !== prevKm
    return (
      descChanged ||
      statusChanged ||
      nameChanged ||
      emailChanged ||
      phoneChanged ||
      plateChanged ||
      brandChanged ||
      modelChanged ||
      lineChanged ||
      cylinderChanged ||
      vehicleColorChanged ||
      kmChanged
    )
  }, [
    wo,
    canPatchWo,
    canViewWoFinancials,
    woDesc,
    woStatus,
    woCustomerName,
    woCustomerEmail,
    woCustomerPhone,
    woVehiclePlate,
    woVehicleBrand,
    woVehicleModel,
    woVehicleLine,
    woVehicleCylinderCc,
    woVehicleColor,
    woIntakeKm,
  ])

  const detailRootClass = isSaas ? 'space-y-7' : 'space-y-8'
  /**
   * Cabecera fija al hacer scroll: se pega debajo de la barra superior del panel
   * (`--va-app-header-h`) y por debajo de ella en `z-index` para no taparla.
   */
  const stickyHeaderClass = isSaas
    ? 'sticky top-[var(--va-app-header-h,0px)] z-20 shadow-sm'
    : 'sticky top-[var(--va-app-header-h,0px)] z-20 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900'
  const backLinkClass = isSaas
    ? 'text-sm font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300 dark:hover:text-brand-200'
    : 'text-sm font-medium text-brand-700 hover:underline dark:text-brand-300 dark:hover:text-brand-200'
  const sectionCardClass = isSaas ? 'va-saas-page-section' : 'va-card'
  const sectionFlushClass = isSaas ? 'va-saas-page-section va-saas-page-section--flush' : 'va-card-flush overflow-hidden'

  const canReopenDelivered =
    wo?.status === 'DELIVERED' && can('work_orders:reopen_delivered') && !cashierOnly

  const selectableStatuses = useMemo((): WorkOrderStatus[] => {
    /** «Sin asignar» con técnico asignado solo tiene sentido con permiso de reasignación (quita técnico al guardar). */
    const flow: WorkOrderStatus[] = []
    if (!wo?.assignedTo || can('work_orders:reassign')) {
      flow.push('UNASSIGNED')
    }
    flow.push('RECEIVED', 'IN_WORKSHOP', 'WAITING_PARTS', 'READY')
    const withTerminal = can('work_orders:set_terminal_status')
      ? ([...flow, 'DELIVERED', 'CANCELLED'] as WorkOrderStatus[])
      : flow
    if (!wo) return withTerminal
    if (!withTerminal.includes(wo.status)) return [...withTerminal, wo.status]
    return withTerminal
  }, [can, wo])

  useEffect(() => {
    if (!id || !canRef.current('work_orders:reassign') || cashierOnly) {
      setAssignableUsers(null)
      return
    }
    let cancelled = false
    void api<AssignableUserRow[]>(`/work-orders/assignable-users?_=${Date.now()}`)
      .then((list) => {
        if (!cancelled) setAssignableUsers(list)
      })
      .catch(() => {
        if (!cancelled) setAssignableUsers([])
      })
    return () => {
      cancelled = true
    }
  }, [id, cashierOnly])

  function sameMoney(a: string, b: string): boolean {
    const x = Number(normalizeMoneyDecimalStringForApi(a) || 0)
    const y = Number(normalizeMoneyDecimalStringForApi(b) || 0)
    if (Number.isNaN(x) || Number.isNaN(y)) return false
    return Math.abs(x - y) < 0.005
  }

  const payVueltoHint = useMemo(() => {
    const aNorm = normalizeMoneyDecimalStringForApi(payAmt)
    const tNorm = normalizeMoneyDecimalStringForApi(payTender)
    const a = Number(aNorm)
    const t = Number(tNorm)
    if (!tNorm) return null
    if (Number.isNaN(a) || Number.isNaN(t) || a <= 0) return 'Completá el monto del cobro.'
    if (t < a) return 'El efectivo recibido debe ser mayor o igual al monto del cobro.'
    const ch = t - a
    if (ch === 0) return 'Vuelto: $0 (pago exacto).'
    return `Vuelto a entregar: $${formatCopFromString(String(ch))}.`
  }, [payAmt, payTender])

  async function addPartLine(opts: {
    description: string
    sku?: string | null
    unitPrice?: string
    quantity?: string
    discountAmount?: string
    costSnapshot?: string
  }): Promise<false | 'added' | 'duplicate'> {
    if (!id || !canMutateLines) return false
    setMsg(null)
    const targetSku = opts.sku ? opts.sku.trim().toUpperCase() : null
    const targetDesc = opts.description.trim().toLowerCase()
    try {
      // Un mismo repuesto va una sola vez en la orden: coincide por SKU o por descripción.
      const existingLine = (wo?.lines ?? []).find((l) => {
        if (l.lineType !== 'PART') return false
        if (targetSku && (l.sparePartSku ?? '').toUpperCase() === targetSku) return true
        return targetDesc !== '' && (l.description ?? '').trim().toLowerCase() === targetDesc
      })
      if (existingLine) {
        const label = opts.description.trim() || (existingLine.description ?? '').trim() || 'Este repuesto'
        await blockingAlert({
          title: 'Repuesto ya cargado',
          message: (
            <Fragment>
              <p className="font-medium text-slate-800 dark:text-slate-100">
                «{label}» ya está en esta orden.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                No se agregó otra línea: abrí la fila existente y ajustá la cantidad a mano. Un mismo repuesto se
                carga una sola vez por orden.
              </p>
            </Fragment>
          ),
          okLabel: 'Entendido',
        })
        openLineEditor(existingLine)
        return 'duplicate'
      }
      const payload: Record<string, unknown> = {
        lineType: 'PART',
        description: opts.description.trim(),
        quantity: '1',
      }
      if (targetSku) payload.sparePartSku = targetSku
      if (opts.unitPrice) payload.unitPrice = opts.unitPrice
      const created = (await postLine.mutateAsync(payload)) as WorkOrderLine
      try {
        await refreshLinesOnWorkOrder()
      } catch {
        await load()
      }
      if (created?.id) openLineEditor(created)
      return 'added'
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al agregar repuesto')
      }
      return false
    }
  }

  function resetPartAdd() {
    setPartDesc('')
    setPartCatalogTerm('')
    setPartComboOpen(false)
    setPartComboIndex(-1)
    partDescInputRef.current?.focus()
  }

  async function selectPart(sp: SparePart) {
    const result = await addPartLine({
      description: sp.name,
      sku: sp.sku,
      unitPrice: Number(sp.price) > 0 ? normalizeMoneyDecimalStringForApi(String(sp.price)) : undefined,
    })
    if (result === false) return
    if (result === 'added') setMsg(`Repuesto ${sp.sku} agregado`)
    resetPartAdd()
  }

  async function addPartFromFreeText() {
    const term = partDesc.trim()
    if (!term) return
    setPartComboOpen(false)
    setPartComboIndex(-1)
    if (!canCreateSparePart) {
      setMsg(
        'El texto no coincide con el catálogo y tu perfil no puede crear repuestos. Cargalo desde Repuestos o pedí ayuda a un administrador.',
      )
      return
    }
    try {
      const created = await api<SparePart>('/spare-parts/free-text', {
        method: 'POST',
        body: JSON.stringify({ name: term }),
      })
      const result = await addPartLine({
        description: created.name,
        sku: created.sku,
        unitPrice:
          Number(created.price) > 0 ? normalizeMoneyDecimalStringForApi(String(created.price)) : undefined,
      })
      if (result === false) return
      if (result === 'added') {
        setMsg(`«${term}» agregado al catálogo con SKU ${created.sku} y a la orden`)
      }
      resetPartAdd()
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al crear el repuesto')
      }
    }
  }

  async function addLaborLine() {
    if (!id || !canMutateLines) return
    const description = laborDesc.trim()
    if (!description) return
    setMsg(null)
    try {
      await postLine.mutateAsync({ lineType: 'LABOR', description, quantity: '1' })
      try {
        await refreshLinesOnWorkOrder()
      } catch {
        await load()
      }
      setLaborDesc('')
      laborDescInputRef.current?.focus()
      setMsg('Trabajo agregado (cantidad 1; editá precio/IVA en la línea)')
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al agregar trabajo')
      }
    }
  }

  async function takeWorkOrder() {
    if (!id || !user || !wo || closed) return
    if (!user.id?.trim()) {
      setMsg('Sesión incompleta (falta id de usuario). Cerrá sesión y volvé a entrar.')
      return
    }
    setMsg(null)
    setAssignBusy(true)
    try {
      const updated = await patchWorkOrder.mutateAsync({ assignedToId: user.id })
      try {
        mergeWorkOrderPatchIntoState(updated, setWo, setWoStatus, setWoDesc)
      } catch {
        /* respuesta distinta a la esperada; load() alinea con el servidor */
      }
      setMsg(
        updated.status === 'RECEIVED'
          ? 'Orden en estado Recibida y asignada a vos'
          : 'Asignación actualizada',
      )
      await load()
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error')
      }
    } finally {
      setAssignBusy(false)
    }
  }

  async function submitReassign() {
    if (!id || !reassignUserId || !wo || closed) return
    setMsg(null)
    setAssignBusy(true)
    try {
      const updated = await patchWorkOrder.mutateAsync({ assignedToId: reassignUserId })
      try {
        mergeWorkOrderPatchIntoState(updated, setWo, setWoStatus, setWoDesc)
      } catch {
        /* idem takeWorkOrder */
      }
      setMsg(
        updated.status === 'RECEIVED' && updated.assignedTo
          ? `Orden en estado Recibida y asignada a ${updated.assignedTo.fullName}`
          : 'Asignación actualizada',
      )
      setReassignUserId('')
      await load()
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error')
      }
    } finally {
      setAssignBusy(false)
    }
  }

  async function saveWorkOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!id || !canPatchWo || !wo) return
    setMsg(null)

    const cancelNow = woStatus === 'CANCELLED' && wo.status !== 'CANCELLED'
    const descChanged = woDesc.trim() !== wo.description
    const statusChanged = woStatus !== wo.status
    const prevCustomerName = (wo.customerName ?? '').trim()
    const newCustomerName = woCustomerName.trim()
    const nameChanged = newCustomerName !== prevCustomerName

    const prevEmail = (wo.customerEmail ?? '').trim()
    const newEmail = woCustomerEmail.trim()
    const emailChanged = newEmail !== prevEmail

    const prevPhone = (wo.customerPhone ?? '').trim()
    const newPhone = woCustomerPhone.trim()
    const phoneChanged = newPhone !== prevPhone

    const prevPlate = (wo.vehiclePlate ?? '').trim()
    const newPlate = woVehiclePlate.trim()
    const plateChanged = newPlate !== prevPlate

    const prevBrand = (wo.vehicleBrand ?? '').trim()
    const newBrand = woVehicleBrand.trim()
    const brandChanged = newBrand !== prevBrand

    const prevModel = (wo.vehicleModel ?? '').trim()
    const newModel = woVehicleModel.trim()
    const modelChanged = newModel !== prevModel

    const prevLine = (wo.vehicleLine ?? '').trim()
    const newLine = woVehicleLine.trim()
    const lineChanged = newLine !== prevLine

    const prevCylinder = (wo.vehicleCylinderCc ?? '').trim()
    const newCylinder = woVehicleCylinderCc.trim()
    const cylinderChanged = newCylinder !== prevCylinder

    const prevVehicleColor = (wo.vehicleColor ?? '').trim()
    const newVehicleColor = woVehicleColor.trim()
    const vehicleColorChanged = newVehicleColor !== prevVehicleColor

    const prevKm = wo.intakeOdometerKm ?? null
    const kmTrim = woIntakeKm.trim()
    let newKmParsed: number | null = null
    if (kmTrim !== '') {
      const n = Number(kmTrim)
      if (!Number.isInteger(n) || n < 0 || n > 9_999_999) {
        setMsg('Kilometraje: usá un entero entre 0 y 9.999.999, o dejá vacío si no aplica.')
        return
      }
      newKmParsed = n
    }
    const kmChanged = newKmParsed !== prevKm

    if (newEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setMsg('Correo: ingresá un correo válido o dejá el campo vacío.')
      return
    }

    if (
      !descChanged &&
      !statusChanged &&
      !nameChanged &&
      !emailChanged &&
      !phoneChanged &&
      !plateChanged &&
      !brandChanged &&
      !modelChanged &&
      !lineChanged &&
      !cylinderChanged &&
      !vehicleColorChanged &&
      !kmChanged
    ) {
      setMsg('Sin cambios en datos de la orden')
      return
    }

    const lines: string[] = [`¿Guardar cambios en la orden ${wo.publicCode} (#${wo.orderNumber})?`, '']
    if (descChanged) lines.push('· Descripción modificada')
    if (statusChanged) lines.push(`· Estado: ${STATUS[wo.status].label} → ${STATUS[woStatus].label}`)
    if (
      statusChanged &&
      woStatus === 'UNASSIGNED' &&
      wo.assignedTo &&
      can('work_orders:reassign')
    ) {
      lines.push('· Se quita el técnico asignado y la orden vuelve a la cola «Sin asignar».')
    }
    if (nameChanged) lines.push(`· Cliente: ${prevCustomerName || '—'} → ${newCustomerName || '—'}`)
    if (emailChanged) lines.push(`· Correo: ${prevEmail || '—'} → ${newEmail || '—'}`)
    if (phoneChanged) lines.push(`· Teléfono: ${prevPhone || '—'} → ${newPhone || '—'}`)
    if (plateChanged) lines.push(`· Patente: ${prevPlate || '—'} → ${newPlate || '—'}`)
    if (brandChanged) lines.push(`· Marca vehículo: ${prevBrand || '—'} → ${newBrand || '—'}`)
    if (modelChanged) lines.push(`· Modelo: ${prevModel || '—'} → ${newModel || '—'}`)
    if (lineChanged) lines.push(`· Línea: ${prevLine || '—'} → ${newLine || '—'}`)
    if (cylinderChanged) {
      lines.push(`· Cilindraje: ${prevCylinder || '—'} → ${newCylinder || '—'}`)
    }
    if (vehicleColorChanged) {
      lines.push(`· Color vehículo: ${prevVehicleColor || '—'} → ${newVehicleColor || '—'}`)
    }
    if (kmChanged) {
      lines.push(
        `· Km al ingreso: ${prevKm != null ? String(prevKm) : '—'} → ${newKmParsed != null ? String(newKmParsed) : '—'}`,
      )
    }
    if (cancelNow) {
      lines.push('', '⚠ La orden pasará a CANCELADA. Revisá cobros y líneas antes de continuar.')
    }
    const okSave = await confirm({
      title: `Orden ${wo.publicCode}`,
      message: lines.join('\n'),
      confirmLabel: 'Guardar orden',
      variant: cancelNow ? 'danger' : 'default',
    })
    if (!okSave) return

    try {
      await patchWorkOrderPlain.mutateAsync({
        description: woDesc.trim(),
        status: woStatus,
        customerName: newCustomerName === '' ? null : newCustomerName,
        customerEmail: newEmail === '' ? null : newEmail,
        customerPhone: newPhone === '' ? null : newPhone,
        vehiclePlate: newPlate === '' ? null : newPlate,
        vehicleBrand: newBrand === '' ? null : newBrand,
        vehicleModel: newModel === '' ? null : newModel,
        vehicleLine: newLine === '' ? null : newLine,
        vehicleCylinderCc: newCylinder === '' ? null : newCylinder,
        vehicleColor: newVehicleColor === '' ? null : newVehicleColor,
        intakeOdometerKm: newKmParsed,
      })
      setMsg('Orden actualizada')
      await load()
      setOrderDataModalOpen(false)
    } catch (err) {
      if (!(await showBlockingConflictModal(err))) {
        setMsg(err instanceof Error ? err.message : 'Error')
      }
    }
  }

  async function submitReopenDelivered() {
    if (!id || !wo || wo.status !== 'DELIVERED' || !can('work_orders:reopen_delivered')) return
    const j = reopenJustification.trim()
    const n = reopenNote.trim()
    if (j.length < notesMinGeneral) {
      setMsg(`Justificación: al menos ${notesMinGeneral} caracteres.`)
      return
    }
    if (n.length < notesMinGeneral) {
      setMsg(`Nota de reapertura: al menos ${notesMinGeneral} caracteres.`)
      return
    }
    const ok = await confirm({
      title: `Reabrir orden ${wo.publicCode}`,
      message:
        'La orden volverá a estado Lista para permitir editar líneas y montos. La justificación y la nota quedarán registradas.',
      confirmLabel: 'Reabrir',
      variant: 'danger',
    })
    if (!ok) return
    setMsg(null)
    setReopenBusy(true)
    try {
      await reopenDelivered.mutateAsync({ justification: j, note: n })
      setReopenNote('')
      setReopenJustification('')
      setMsg('Orden reabierta a Lista')
      await load()
    } catch (err) {
      if (!(await showBlockingConflictModal(err))) {
        setMsg(err instanceof Error ? err.message : 'Error al reabrir')
      }
    } finally {
      setReopenBusy(false)
    }
  }

  function scrollCashModalToError() {
    cashModalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!id || !wo || !paymentFormOpen) return
    if (paymentBusy) return
    setPayFormError(null)
    if (!WORK_ORDER_PAYABLE_STATUSES.includes(wo.status)) {
      setPayFormError(
        'Solo se puede cobrar con la orden en Recibida, En taller, Esperando repuestos o Lista. Cambiá el estado de la orden y reintentá.',
      )
      scrollCashModalToError()
      return
    }
    if (!payAck) {
      setPayFormError(
        'Marcá la casilla de confirmación: revisaste tipo de cobro (abono o pago total), categoría, monto, efectivo recibido (si aplica), nota y saldo antes de registrar el cobro.',
      )
      scrollCashModalToError()
      return
    }
    const pn = payNote.trim()
    if (pn.length < notesMinPayment) {
      setPayFormError(`Nota del cobro: al menos ${notesMinPayment} caracteres (política del taller).`)
      scrollCashModalToError()
      return
    }
    const payAmtNorm = normalizeMoneyDecimalStringForApi(payAmt)
    if (!payAmtNorm || !API_MONEY_DECIMAL_REGEX.test(payAmtNorm)) {
      setPayFormError(
        'Monto del cobro: solo pesos enteros; podés separar miles con punto (ej. 2.550.356).',
      )
      scrollCashModalToError()
      return
    }
    const payN = Number(payAmtNorm)
    if (!Number.isFinite(payN) || payN <= 0) {
      setPayFormError('Ingresá un monto de cobro válido mayor a cero.')
      scrollCashModalToError()
      return
    }
    const tenNorm = normalizeMoneyDecimalStringForApi(payTender)
    if (tenNorm && !API_MONEY_DECIMAL_REGEX.test(tenNorm)) {
      setPayFormError(
        'Efectivo recibido: solo pesos enteros; miles con punto (mismo criterio que el monto del cobro).',
      )
      scrollCashModalToError()
      return
    }
    if (wo.amountDue == null) {
      setPayFormError('Tu perfil no puede ver importes de esta orden; el cobro lo registra caja.')
      scrollCashModalToError()
      return
    }
    const dueNum = Number(normalizeMoneyDecimalStringForApi(wo.amountDue) || wo.amountDue)
    if (!Number.isFinite(dueNum) || dueNum <= 0) {
      setPayFormError('No hay saldo pendiente según el sistema; no se puede registrar un cobro desde acá.')
      scrollCashModalToError()
      return
    }
    if (payKind === 'full') {
      if (!sameMoney(payAmtNorm, wo.amountDue)) {
        setPayFormError(
          `Pago total: el monto debe ser exactamente el saldo pendiente ($${formatCopFromString(normalizeMoneyDecimalStringForApi(wo.amountDue) || wo.amountDue)}). Ajustá el importe o elegí «Abono».`,
        )
        scrollCashModalToError()
        return
      }
    } else if (payN >= dueNum) {
      setPayFormError(
        'Con «Abono» el monto tiene que ser menor al saldo pendiente. Si querés liquidar todo, elegí «Pago total» (el monto se ajusta solo al saldo).',
      )
      scrollCashModalToError()
      return
    }
    const catName = incomeCats.find((c) => c.slug === payCat)?.name ?? payCat
    const ten = tenNorm
    const aNum = Number(payAmtNorm)
    const tNum = Number(ten)
    const vueltoStr =
      ten && !Number.isNaN(aNum) && !Number.isNaN(tNum) && tNum >= aNum ? formatCopFromString(String(tNum - aNum)) : null

    setPaymentBusy(true)
    let okPay = false
    try {
      okPay = await confirm({
      title: 'Registrar cobro',
      message: (
        <div className="space-y-3 text-left">
          <p className="font-medium text-slate-800 dark:text-slate-100">¿Registrar cobro en caja vinculado a esta orden?</p>
          <dl className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-600 dark:bg-slate-800">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                Monto del cobro
              </dt>
              <dd className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                ${formatCopFromString(payAmtNorm)}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-slate-200 pt-2.5 text-sm dark:border-slate-600">
              <dt className="text-xs text-slate-500 dark:text-slate-300">Tipo</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {payKind === 'full' ? 'Pago total (cierra y entrega)' : 'Abono'}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-slate-200 pt-2.5 text-sm dark:border-slate-600">
              <dt className="text-xs text-slate-500 dark:text-slate-300">Categoría</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">{catName}</dd>
            </div>
            <div className="space-y-1 border-t border-slate-200 pt-2.5 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
              <p>
                <span className="text-slate-500 dark:text-slate-300">
                  Orden {wo.publicCode}{' '}
                  <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">#{wo.orderNumber}</span>
                </span>
              </p>
              <p>
                Subtotal líneas: <span className="font-mono font-medium">${formatCopFromString(wo.linesSubtotal ?? '0')}</span>
              </p>
              <p>
                Ya cobrado en OT: <span className="font-mono font-medium">${formatCopFromString(wo.paymentSummary.totalPaid ?? '0')}</span>
              </p>
              <p>
                Saldo pendiente (cobro): <span className="font-mono font-medium">${formatCopFromString(wo.amountDue ?? '0')}</span>
              </p>
            </div>
            {ten ? (
              <Fragment>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-slate-200 pt-2.5 dark:border-slate-600">
                  <dt className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    Efectivo del cliente
                  </dt>
                  <dd className="text-lg font-bold tabular-nums text-sky-600 dark:text-sky-400">${formatCopFromString(ten)}</dd>
                </div>
                {vueltoStr != null && (
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-amber-200 pt-2.5 dark:border-amber-900">
                    <dt className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-200">
                      Vuelto a entregar
                    </dt>
                    <dd className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">${vueltoStr}</dd>
                  </div>
                )}
              </Fragment>
            ) : null}
          </dl>
        </div>
      ),
      confirmLabel: 'Registrar cobro',
    })
    } finally {
      setPaymentBusy(false)
    }
    if (!okPay) return

    setPaymentBusy(true)
    try {
      /**
       * Guardamos el pago en el API y capturamos su `id` para imprimir el ticket asociado.
       * El puente puede abrir el cajón físico solo si la categoría es efectivo (`ingreso_cobro`).
       */
      const created = await recordPaymentMutation.mutateAsync({
        paymentKind: payKind,
        amount: payAmtNorm,
        note: pn,
        categorySlug: payCat,
        ...(tenNorm ? { tenderAmount: tenNorm } : {}),
      })
      setPayAmt('')
      setPayTender('')
      setPayNote('')
      setPayAck(false)
      setPayFormError(null)
      const ticketPath = `/work-orders/${id}/payments/${created.id}/receipt-ticket.json`
      setMsg(
        await successMessageWithTicketAndPulse(ticketPath, 'Cobro registrado', {
          copies: payTwoCopies ? 2 : 1,
          openDrawer: cashIncomeCategoryOpensPhysicalDrawer(payCat),
        }),
      )
      setPayTwoCopies(false)
      await load()
      await refreshCashOpen()
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Error al registrar el cobro'
      if (!(await showBlockingConflictModal(err))) {
        setPayFormError(m)
        scrollCashModalToError()
      } else {
        setPayFormError(null)
      }
    } finally {
      setPaymentBusy(false)
    }
  }

  async function removeLine(lineId: string) {
    if (!id || !canDeleteLine || !wo) return
    const ln = wo.lines.find((l) => l.id === lineId)
    if (!ln) return
    const ok = await confirm({
      title: 'Quitar línea',
      message: '¿Eliminar esta línea de la orden? El importe de la OT se recalculará.',
      confirmLabel: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    setMsg(null)
    let lines: WorkOrderLine[]
    try {
      lines = await deleteLine.mutateAsync({ lineId })
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al eliminar')
      }
      return
    }
    if (!Array.isArray(lines)) {
      try {
        await refreshLinesOnWorkOrder()
      } catch {
        await load()
      }
    } else {
      const linesSubtotal =
        canRef.current('work_orders:view_financials') ||
        canRef.current('work_order_lines:set_unit_price') ||
        canRef.current('work_orders:record_payment')
          ? linesSubtotalFromLines(lines)
          : null
      setWo((prev) => {
        if (!prev) return prev
        return { ...prev, lines, linesSubtotal }
      })
    }
    setEditLine((el) => (el?.id === lineId ? null : el))
    setMsg('Línea eliminada')
  }

  function startEdit(ln: WorkOrderLine) {
    setEditLine(ln)
    setEditQty(String(Number(ln.quantity)))
    setEditPrice(
      ln.unitPrice != null && Number(ln.unitPrice) > 0
        ? normalizeMoneyDecimalStringForApi(String(ln.unitPrice))
        : '',
    )
    setEditDesc(ln.description ?? '')
    setEditDiscount(
      ln.discountAmount && Number(ln.discountAmount) > 0
        ? normalizeMoneyDecimalStringForApi(String(ln.discountAmount))
        : '',
    )
    setEditCost(
      ln.costSnapshot && Number(ln.costSnapshot) > 0
        ? normalizeMoneyDecimalStringForApi(String(ln.costSnapshot))
        : '',
    )
    setEditTaxRateId(ln.taxRateId ?? '')
    setAutoEditFocus(null)
  }

  /** Repuesto recién agregado: la fila queda abierta para cargar cantidad/valor/descuento. */
  function openLineEditor(ln: WorkOrderLine) {
    startEdit(ln)
    setAutoEditFocus((prev) => ({ id: ln.id, seq: (prev?.seq ?? 0) + 1 }))
  }

  /**
   * Enfoca el campo de la fila recién abierta sin desplazar la página: sin `preventScroll` el
   * navegador scrollea hasta el input y la tabla «salta» al agregar o repetir un repuesto.
   */
  useEffect(() => {
    if (!autoEditFocus) return
    lineFocusRef.current?.focus({ preventScroll: true })
  }, [autoEditFocus])

  function cancelEdit() {
    setEditLine(null)
    setAutoEditFocus(null)
  }

  async function saveEdit() {
    if (!id || !editLine || !canUpdateLine) return
    // Si mientras guarda el usuario abrió otra fila, no se la cerramos al terminar.
    const editingId = editLine.id
    setMsg(null)
    if (!editDesc.trim()) {
      setMsg('La descripción de la línea no puede quedar vacía.')
      return
    }
    const qty = editQty.trim()
    if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0) {
      setMsg('La cantidad debe ser mayor a cero.')
      return
    }
    const up = canViewWoFinancials && editPrice.trim() ? normalizeMoneyDecimalStringForApi(editPrice) : ''
    if (up && !API_MONEY_DECIMAL_REGEX.test(up)) {
      setMsg('Valor: solo pesos enteros; los miles con punto.')
      return
    }
    const disc = canViewWoFinancials && editDiscount.trim() ? normalizeMoneyDecimalStringForApi(editDiscount) : ''
    if (disc && !API_MONEY_DECIMAL_REGEX.test(disc)) {
      setMsg('Descuento: solo pesos enteros; los miles con punto.')
      return
    }
    const cost = canViewWoCosts && editCost.trim() ? normalizeMoneyDecimalStringForApi(editCost) : ''
    if (cost && !API_MONEY_DECIMAL_REGEX.test(cost)) {
      setMsg('Precio proveedor: solo pesos enteros; los miles con punto.')
      return
    }
    if (disc && up && Number(disc) > Number(up) * Number(qty)) {
      setMsg('El descuento no puede superar el total de la línea.')
      return
    }
    // null explícito = borrar la tasa anterior; undefined = no tocar; string = setear.
    const taxRatePatch = editTaxRateId === '' ? null : editTaxRateId

    try {
      const body: Record<string, unknown> = {
        quantity: qty,
        description: editDesc.trim(),
      }
      if (canViewWoFinancials) {
        body.unitPrice = up || null
        body.discountAmount = disc || null
      }
      if (canViewWoCosts) body.costSnapshot = cost || null
      // Solo emitimos taxRateId cuando cambió respecto al valor actual (evita escribir por nada).
      if ((editLine.taxRateId ?? null) !== taxRatePatch) body.taxRateId = taxRatePatch
      await patchLine.mutateAsync({
        lineId: editLine.id,
        body,
      })
      setEditLine((cur) => (cur?.id === editingId ? null : cur))
      setAutoEditFocus((cur) => (cur?.id === editingId ? null : cur))
      try {
        await refreshLinesOnWorkOrder()
      } catch {
        await load()
      }
      setMsg(
        canViewWoFinancials && !up
          ? 'Línea guardada sin valor unitario: la orden no se podrá cobrar hasta que lo cargues.'
          : 'Línea actualizada',
      )
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al guardar')
      }
    }
  }

  if (err || !id) {
    return (
      <div className="va-alert-error-block">
        {err ?? 'Orden no válida'}
        <div className="mt-4">
          <Link to={portalPath('/ordenes')} className="text-sm font-medium text-brand-700 underline">
            Volver al listado
          </Link>
        </div>
      </div>
    )
  }

  if (!wo) {
    return <p className="text-slate-500">Cargando…</p>
  }

  const st = STATUS[wo.status]
  /**
   * Orden de la tabla: `sortOrder` **descendente**, es decir **lo último agregado arriba**
   * (el servidor los devuelve ascendente y el `sortOrder` mayor es el más nuevo).
   */
  const linesOrdered = [...wo.lines].sort((a, b) => b.sortOrder - a.sortOrder)
  const showLineActionsColumn =
    !closed &&
    wo.lines.some(() => Boolean(canUpdateLine || canDeleteLine))
  /** Cant. + Detalle + Tipo (3) · P. unit. + Descuento + Importe (3) · P. proveedor (1) · acciones (1). */
  const lineTableColSpan =
    3 +
    (canViewWoFinancials ? 3 : 0) +
    (canViewWoCosts ? 1 : 0) +
    (showLineActionsColumn ? 1 : 0)

  const workshopAssignmentBlock = () => (
    <Fragment>
      <div className="mt-3 text-sm text-slate-700 dark:text-slate-200">
        {wo.assignedTo ? (
          <p>
            <span className="text-slate-500 dark:text-slate-300">Técnico asignado:</span>{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-50">{wo.assignedTo.fullName}</span>
          </p>
        ) : (
          <p className="font-medium text-amber-800 dark:text-amber-200">Sin técnico asignado (en cola del taller)</p>
        )}
      </div>
      {canPatchWo && !closed && !wo.assignedTo && user && (
        <button
          type="button"
          disabled={assignBusy}
          onClick={() => void takeWorkOrder()}
          className="va-btn-primary mt-3 w-full disabled:opacity-50 sm:w-auto"
        >
          {assignBusy ? 'Asignando…' : 'Tomar esta orden (asignarme)'}
        </button>
      )}
      {canPatchWo && !closed && can('work_orders:reassign') && assignableUsers && assignableUsers.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-600 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-[12rem] flex-1 text-sm">
            <span className="va-label">Reasignar a otro usuario</span>
            <select
              value={reassignUserId}
              onChange={(e) => setReassignUserId(e.target.value)}
              className="va-field mt-1"
            >
              <option value="">Elegí un usuario…</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!reassignUserId || assignBusy}
            onClick={() => void submitReassign()}
            className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            {assignBusy ? 'Guardando…' : 'Aplicar reasignación'}
          </button>
        </div>
      )}
    </Fragment>
  )

  return (
    <div className={detailRootClass}>
      <PageHeader
        rootClassName={stickyHeaderClass}
        beforeTitle={
          <Link to={portalPath('/ordenes')} className={backLinkClass}>
            ← Órdenes
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>
              Orden {wo.publicCode}{' '}
              <span className="font-mono text-xs font-normal text-slate-400 dark:text-slate-500">
                #{wo.orderNumber}
              </span>
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.tone}`}>{st.label}</span>
          </span>
        }
        description={
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              {(() => {
                const b = (wo.vehicleBrand ?? wo.vehicle?.brand ?? '').trim()
                if (!b) return null
                return (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    Marca: {b}
                  </span>
                )
              })()}
              {(() => {
                const m = (wo.vehicleModel ?? wo.vehicle?.model ?? '').trim()
                if (!m) return null
                return (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    Modelo: {m}
                  </span>
                )
              })()}
              {wo.intakeOdometerKm != null ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium tabular-nums text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  Km ingreso: {wo.intakeOdometerKm.toLocaleString('es-CO')}
                </span>
              ) : null}
            </div>
            {cashierOnly ? (
              (wo.customerName || wo.vehiclePlate) ? (
                <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">
                  {[wo.customerName, wo.vehiclePlate].filter(Boolean).join(' · ')}
                </p>
              ) : null
            ) : (
              <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">{wo.description}</p>
            )}
          </>
        }
        actions={
          <div className="flex flex-col items-end gap-3">
            {!hideWorkOrderCashUi && canViewWoFinancials ? (
              <div className="flex flex-wrap items-start justify-end gap-x-6 gap-y-2">
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Subtotal líneas
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50 sm:text-3xl">
                    ${formatCopFromString(wo.linesSubtotal ?? '0')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Cobrado
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50 sm:text-3xl">
                    ${formatCopFromString(wo.paymentSummary.totalPaid ?? '0')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Saldo pendiente
                  </p>
                  <p
                    className={`mt-1 font-mono text-2xl font-semibold tabular-nums sm:text-3xl ${
                      woAmountDueNum > 0
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
${formatCopFromString(wo.amountDue ?? '0')}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void openAuthenticatedHtml(
                    `/work-orders/${wo.id}/receipt?autoprint=1`,
                    `Comprobante OT ${wo.publicCode}`,
                  ).catch((err) => {
                    setMsg(
                      err instanceof Error
                        ? err.message
                        : 'No se pudo abrir el comprobante',
                    )
                  })
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                title="Abrir comprobante interno imprimible (no es factura electrónica)"
              >
                Imprimir comprobante
              </button>
              {canPatchWo ? (
                <button
                  type="button"
                  onClick={() => setOrderDataModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm hover:bg-brand-100 dark:border-brand-600 dark:bg-brand-950 dark:text-brand-200 dark:hover:bg-brand-900"
                  title="Editar datos de la orden (descripción, cliente, vehículo y kilometraje)"
                >
                  Editar datos de la orden
                </button>
              ) : null}
              {!hideWorkOrderCashUi ? (
                <button
                  type="button"
                  onClick={() => setCashModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 shadow-sm hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900"
                  title="Ver cobros de esta orden y registrar abonos o pago total"
                >
                  Cobros en caja
                </button>
              ) : null}
            </div>
          </div>
        }
      />
      {msg && (
        <p className="va-card-muted" role="status" aria-live="polite">
          {msg}
        </p>
      )}

      {wo.parentWorkOrder ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-50">
            <span className="font-semibold">Garantía o seguimiento</span>
            {' · '}
            <Link
              className="font-medium text-violet-800 underline hover:text-violet-900 dark:text-violet-200 dark:hover:text-white"
              to={portalPath(`/ordenes/${wo.parentWorkOrder.id}`)}
            >
              Ver orden origen {wo.parentWorkOrder.publicCode}
            </Link>
          </div>
        ) : null}

        {wo.status === 'DELIVERED' && can('work_orders:create') && !cashierOnly ? (
          <div className="mt-4">
            <Link
              to={portalPath(`/ordenes?warrantyFrom=${wo.id}`)}
              className="inline-flex items-center rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-900 shadow-sm hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-100 dark:hover:bg-violet-950"
            >
              Nueva orden de garantía o seguimiento…
            </Link>
          </div>
        ) : null}

        {wo.status === 'DELIVERED' && can('invoices:create') ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={async () => {
                if (invoiceBusy) return
                setInvoiceBusy(true)
                setInvoiceMsg(null)
                try {
                  const res = await api<{ id: string }>(`/invoices/from-work-order/${wo.id}`, {
                    method: 'POST',
                    body: JSON.stringify({}),
                  })
                  navigate(portalPath(`/facturacion/${res.id}`))
                } catch (err) {
                  setInvoiceMsg(
                    err instanceof ApiError ? err.message : 'No se pudo generar la factura',
                  )
                } finally {
                  setInvoiceBusy(false)
                }
              }}
              disabled={invoiceBusy}
              className="inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-60"
              title="Genera factura electrónica DIAN a partir de esta OT (queda en borrador si DIAN está apagado)."
            >
              {invoiceBusy ? 'Generando factura…' : 'Generar factura desde esta OT'}
            </button>
            {invoiceMsg ? (
              <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-300">{invoiceMsg}</p>
            ) : null}
          </div>
        ) : null}

        {wo.warrantyFollowUps && wo.warrantyFollowUps.length > 0 ? (
          <div
            className={
              isSaas
                ? 'va-saas-page-section !mt-4 !space-y-0 py-3 sm:py-4'
                : 'mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-slate-800'
            }
          >
            <p className="va-section-title text-sm">Órdenes de garantía o seguimiento</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-200">
              {wo.warrantyFollowUps.map((w) => (
                <li key={w.id}>
                  <Link className="font-medium text-brand-700 underline hover:text-brand-800 dark:text-brand-300" to={portalPath(`/ordenes/${w.id}`)}>
                    OT {w.publicCode}
                  </Link>
                  <span className="text-slate-500 dark:text-slate-300"> — {STATUS[w.status].label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

      {canPatchWo && orderDataModalOpen && (
        <div className="va-modal-overlay" role="presentation" onClick={() => setOrderDataModalOpen(false)}>
          <div
            className="va-modal-panel max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Datos de la orden</h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-300">
                  {wo.publicCode} · Orden #{wo.orderNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrderDataModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-lg leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <form onSubmit={saveWorkOrder} className="mt-4">
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="va-label">Descripción</span>
              <textarea
                required
                minLength={3}
                value={woDesc}
                onChange={(e) => setWoDesc(e.target.value)}
                rows={3}
                className="va-field mt-1"
              />
            </label>
            <label className="block text-sm">
              <span className="va-label">Estado</span>
              <select
                value={woStatus}
                onChange={(e) => setWoStatus(e.target.value as WorkOrderStatus)}
                className="va-field mt-1"
              >
                {selectableStatuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="va-section-title text-sm">Cliente y vehículo (facturación)</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-sm">
                  <span className="va-label">Nombre del cliente</span>
                  <input
                    value={woCustomerName}
                    onChange={(e) => setWoCustomerName(e.target.value)}
                    maxLength={200}
                    placeholder="Titular / razón social"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Correo electrónico</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={woCustomerEmail}
                    onChange={(e) => setWoCustomerEmail(e.target.value)}
                    maxLength={120}
                    placeholder="Opcional"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Teléfono</span>
                  <input
                    value={woCustomerPhone}
                    onChange={(e) => setWoCustomerPhone(e.target.value)}
                    maxLength={80}
                    placeholder="Opcional"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Patente</span>
                  <input
                    value={woVehiclePlate}
                    onChange={(e) => setWoVehiclePlate(e.target.value)}
                    maxLength={40}
                    placeholder="Como figura en la OT"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Marca (vehículo)</span>
                  <input
                    value={woVehicleBrand}
                    onChange={(e) => setWoVehicleBrand(e.target.value)}
                    maxLength={80}
                    placeholder="Texto libre"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Modelo</span>
                  <input
                    value={woVehicleModel}
                    onChange={(e) => setWoVehicleModel(e.target.value)}
                    maxLength={80}
                    placeholder="Opcional"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Línea</span>
                  <input
                    value={woVehicleLine}
                    onChange={(e) => setWoVehicleLine(e.target.value)}
                    maxLength={120}
                    placeholder="Opcional (ej. licencia)"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Cilindraje (cc)</span>
                  <input
                    value={woVehicleCylinderCc}
                    onChange={(e) => setWoVehicleCylinderCc(e.target.value)}
                    maxLength={32}
                    placeholder="Opcional"
                    className="va-field mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Color</span>
                  <input
                    value={woVehicleColor}
                    onChange={(e) => setWoVehicleColor(e.target.value)}
                    maxLength={80}
                    placeholder="Opcional"
                    className="va-field mt-1"
                  />
                </label>
              </div>
              {/* Tres tarjetas alineadas: revisión/consentimiento | OCR | asignación (lg 4+5+3) */}
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 dark:border-slate-600 lg:grid-cols-12 lg:items-stretch lg:gap-4">
                <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900 lg:col-span-4">
                  <h3 className="va-section-title text-sm">Revisión y consentimiento</h3>
                  <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4">
                    <label className="block min-w-0 text-sm">
                      <span className="va-label">Kilometraje al ingreso</span>
                      <input
                        inputMode="numeric"
                        value={woIntakeKm}
                        onChange={(e) => setWoIntakeKm(e.target.value.replace(/\D/g, ''))}
                        placeholder="Opcional"
                        className="va-field mt-1 w-full max-w-full"
                      />
                    </label>
                    <label className="flex min-w-0 cursor-pointer items-start gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-slate-800 dark:text-slate-100">Revisión / diagnóstico</span>
                      </span>
                    </label>
                    {!cashierOnly && Boolean(wo.clientConsentSignedAt && wo.clientSignaturePngBase64) ? (
                      <div className="mt-auto border-t border-slate-200 pt-3 dark:border-slate-600">
                        <button
                          type="button"
                          onClick={() => setConsentModal('view')}
                          className={`${FACTURACION_CONSENT_BTN} w-full sm:w-auto`}
                        >
                          Ver consentimiento firmado
                        </button>
                      </div>
                    ) : !cashierOnly && canPatchWo && !closed && !(wo.clientConsentSignedAt && wo.clientSignaturePngBase64) ? (
                      <div className="mt-auto border-t border-slate-200 pt-3 dark:border-slate-600">
                        <button
                          type="button"
                          onClick={() => setConsentModal('sign')}
                          className={`${FACTURACION_CONSENT_BTN} w-full sm:w-auto`}
                        >
                          Registrar consentimiento…
                        </button>
                      </div>
                    ) : (
                      <div className="mt-auto min-h-0 flex-1" aria-hidden />
                    )}
                  </div>
                </div>
                <div className="flex min-h-0 min-w-0 lg:col-span-5">
                  <TransitLicenseOcrPanel
                    disabled={!canPatchWo || closed}
                    onApply={applyTransitLicenseFromOcr}
                  />
                </div>
                <aside className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900 lg:col-span-3">
                  <h3 className="va-section-title text-sm">Asignación al taller</h3>
                  <div className="mt-3 flex min-h-0 flex-1 flex-col">
                    {workshopAssignmentBlock()}
                  </div>
                </aside>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-6 dark:border-slate-800">
            <button type="button" onClick={() => setOrderDataModalOpen(false)} className="va-btn-secondary">
              Cancelar
            </button>
            <button
              type="submit"
              title={
                workOrderFormDirty
                  ? 'Hay cambios sin guardar en datos de la orden'
                  : 'Los datos coinciden con lo guardado en el servidor'
              }
              className={`rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                workOrderFormDirty
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                  : 'cursor-default bg-slate-300 text-slate-600 opacity-90 hover:bg-slate-300 focus-visible:ring-slate-400 dark:bg-slate-600 dark:text-slate-300 dark:opacity-95 dark:hover:bg-slate-600'
              }`}
            >
              Guardar orden
            </button>
          </div>
          </form>
          </div>
        </div>
      )}

      {!canPatchWo && !cashierOnly && (
        <section className={sectionCardClass}>
          <h2 className="va-section-title">Asignación al taller</h2>
          {workshopAssignmentBlock()}
        </section>
      )}

      {!canPatchWo && !cashierOnly && wo.clientConsentSignedAt && wo.clientSignaturePngBase64 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="va-section-title text-sm">Cliente y vehículo (facturación)</h3>
          <div className="mt-4 flex justify-start">
            <button type="button" onClick={() => setConsentModal('view')} className={FACTURACION_CONSENT_BTN}>
              Ver consentimiento firmado
            </button>
          </div>
        </div>
      ) : null}

      {closed && (
        <>
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {wo.status === 'CANCELLED'
              ? hideWorkOrderCashUi
                ? 'Orden cancelada: no se pueden editar líneas.'
                : 'Orden cancelada: no se pueden editar líneas ni registrar cobros adicionales.'
              : hideWorkOrderCashUi
                ? 'Orden entregada: no se pueden editar líneas ni montos.'
                : 'Orden entregada: no se pueden editar líneas ni montos; los cobros ya registrados siguieron en caja el día que se cargaron.'}
          </p>
          {canReopenDelivered && (
            <form
              className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5"
              onSubmit={(e) => {
                e.preventDefault()
                void submitReopenDelivered()
              }}
            >
              <h3 className="va-section-title">Reabrir orden entregada</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col text-sm">
                  <span className="va-label">Justificación</span>
                  <textarea
                    required
                    rows={4}
                    value={reopenJustification}
                    onChange={(e) => setReopenJustification(e.target.value)}
                    className="va-field mt-1 min-h-[5.5rem] w-full resize-y"
                    placeholder="Motivo operativo o contable de la reapertura…"
                  />
                  <span className="mt-1 text-xs text-slate-500 dark:text-slate-300">{notesMinHint(notesMinGeneral)}</span>
                  <NotesMinCharCounter value={reopenJustification} minLength={notesMinGeneral} />
                </label>
                <label className="flex flex-col text-sm">
                  <span className="va-label">Nota</span>
                  <textarea
                    required
                    rows={4}
                    value={reopenNote}
                    onChange={(e) => setReopenNote(e.target.value)}
                    className="va-field mt-1 min-h-[5.5rem] w-full resize-y"
                    placeholder="Detalle visible en el historial interno de la orden…"
                  />
                  <span className="mt-1 text-xs text-slate-500 dark:text-slate-300">{notesMinHint(notesMinGeneral)}</span>
                  <NotesMinCharCounter value={reopenNote} minLength={notesMinGeneral} />
                </label>
              </div>
              <div className="mt-4">
                <button
                  type="submit"
                  disabled={reopenBusy}
                  className="rounded-xl bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-800 dark:hover:bg-amber-700"
                >
                  {reopenBusy ? 'Procesando…' : 'Reabrir a Lista'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {cashModalOpen && !hideWorkOrderCashUi && (
        <div
          className="va-modal-overlay z-[70]"
          role="presentation"
          onClick={() => setCashModalOpen(false)}
        >
          <div
            className="flex max-h-[min(92dvh,56rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wo-cash-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-6">
              <div>
                <h2 id="wo-cash-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  Cobros en caja · {wo.publicCode}{' '}
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-300">(#{wo.orderNumber})</span>
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Cobros de esta orden y alta de abonos o pago total.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCashModalOpen(false)}
                aria-label="Cerrar ventana de cobros"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-lg leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                ×
              </button>
            </div>
            <div ref={cashModalBodyRef} className="min-h-0 flex-1 overflow-y-auto">
              {showCobrosCajaBlocked && (
                <div className="space-y-3 px-4 py-5 sm:px-6">
            {cashOpen === null ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">Consultando estado de caja…</p>
            ) : cashOpenLoadStatus === 'error' ? (
              <>
                <p className="text-sm text-slate-800 dark:text-slate-200">
                  No se pudo verificar si hay sesión abierta. Reintentá o abrí Caja desde el menú.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void refreshCashOpen()}
                    className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 dark:bg-slate-600 dark:hover:bg-slate-500"
                  >
                    Reintentar
                  </button>
                  <Link
                    to={portalPath('/caja')}
                    className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
                  >
                    Ir a Caja
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                  Caja cerrada. No se muestran cobros ni se puede registrar ingreso hasta que haya sesión abierta (política
                  del taller, sin excepciones).
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void refreshCashOpen()}
                    className="rounded-xl bg-amber-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-900 dark:bg-amber-700 dark:hover:bg-amber-600"
                  >
                    Actualizar estado
                  </button>
                  <Link
                    to={portalPath('/caja')}
                    className="inline-flex min-h-[44px] items-center text-sm font-medium text-amber-950 underline underline-offset-2 dark:text-amber-50"
                  >
                    Ir a Caja
                  </Link>
                </div>
              </>
            )}
              </div>
              )}
              {showCobrosCajaFull && (
                <div>
                  {payFormError && (
          <p
            className="va-alert-error-strip"
            role="alert"
          >
            {payFormError}
          </p>
        )}
        <div className="va-table-scroll">
          <table className="va-table min-w-[560px]">
            <thead>
              <tr className="va-table-head-row">
                <th className="va-table-th">Fecha</th>
                <th className="va-table-th">Tipo</th>
                <th className="va-table-th">Monto</th>
                <th className="va-table-th">Efectivo / vuelto</th>
                <th className="va-table-th">Categoría</th>
                <th className="va-table-th">Registró</th>
                <th className="va-table-th" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="border-b border-slate-50 px-4 py-8 text-center text-sm text-slate-500 last:border-0 sm:px-6 dark:border-slate-800 dark:text-slate-300"
                  >
                    Sin cobros registrados.
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id} className="va-table-body-row">
                  <td className="va-table-td font-mono text-xs text-slate-500 dark:text-slate-300">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="va-table-td text-sm text-slate-700 dark:text-slate-200">
                    {p.kind === 'FULL_SETTLEMENT' ? 'Pago total' : 'Abono'}
                  </td>
                  <td className="va-table-td font-medium tabular-nums text-slate-900 dark:text-slate-50">
                    ${formatCopFromString(p.amount)}
                  </td>
                  <td className="va-table-td text-xs text-slate-600 dark:text-slate-300">
                    {p.cashMovement.tenderAmount != null && p.cashMovement.changeAmount != null
                      ? `Efectivo ${formatCopFromString(p.cashMovement.tenderAmount)} → vuelto ${formatCopFromString(p.cashMovement.changeAmount)}`
                      : '—'}
                  </td>
                  <td className="va-table-td text-slate-600 dark:text-slate-300">{p.cashMovement.category.name}</td>
                  <td className="va-table-td text-slate-600 dark:text-slate-300">{p.recordedBy.fullName}</td>
                  <td className="va-table-td text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await printTicketFromApi(
                          `/work-orders/${id}/payments/${p.id}/receipt-ticket.json`,
                          { copies: 1, openDrawer: false },
                        )
                        setMsg(res.ok ? 'Ticket reimpreso' : `No se pudo imprimir: ${res.hint}`)
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      title="Reimprimir ticket térmico"
                    >
                      Reimprimir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {paymentFormOpen && (
          <form onSubmit={recordPayment} className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-6">
            {!canSubmitWorkOrderPayment && wo ? (
              <p
                className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                role="status"
              >
                {wo.amountDue == null
                  ? 'Tu perfil no recibe el saldo pendiente de esta orden en el sistema; no se puede registrar el cobro desde acá. Pedí a caja o administración.'
                  : !workOrderStatusAllowsPayment
                    ? 'Con la orden en «Sin asignar», Entregada o Cancelada no se registran cobros desde esta pantalla. Pasá la orden a Recibida, En taller, Esperando repuestos o Lista y reintentá.'
                    : 'No se puede registrar el cobro en este momento.'}
              </p>
            ) : null}
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-600 dark:bg-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">Tipo de cobro</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <input
                    type="radio"
                    name="payKind"
                    checked={payKind === 'partial'}
                    onChange={() => {
                      setPayKind('partial')
                      if (wo) {
                        const due = Number(
                          normalizeMoneyDecimalStringForApi(String(wo.amountDue ?? '')) || wo.amountDue || 0,
                        )
                        const p = Number(normalizeMoneyDecimalStringForApi(payAmt) || 0)
                        if (Number.isFinite(due) && Number.isFinite(p) && p >= due) {
                          setPayAmt('')
                        }
                      }
                    }}
                    className="h-4 w-4 border-slate-300 text-brand-600 dark:border-slate-500"
                  />
                  Abono (deja saldo; no cambia el estado de la orden)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <input
                    type="radio"
                    name="payKind"
                    checked={payKind === 'full'}
                    onChange={() => {
                      setPayKind('full')
                      if (wo?.amountDue != null) setPayAmt(normalizeMoneyDecimalStringForApi(wo.amountDue))
                    }}
                    className="h-4 w-4 border-slate-300 text-brand-600 dark:border-slate-500"
                  />
                  Pago total (liquida el saldo; orden pasa a Entregada)
                </label>
              </div>
              {payKind === 'full' && (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                  El monto se fija al saldo pendiente (${formatCopFromString(wo.amountDue ?? '0')}). Al confirmar no se podrán editar líneas ni montos
                  hasta una reapertura por administración o dueño.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-start sm:gap-x-4 sm:gap-y-0">
              <div className="flex flex-col gap-3 sm:col-span-4">
                <label className="block text-sm">
                  <span className="va-label">Monto del cobro (en caja)</span>
                  <input
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(payAmt))}
                    onChange={(e) => setPayAmt(normalizeMoneyDecimalStringForApi(e.target.value))}
                    readOnly={payKind === 'full'}
                    className={`va-field mt-1 w-full ${payKind === 'full' ? 'cursor-not-allowed bg-slate-100 dark:bg-slate-800' : ''}`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="va-label">Efectivo que entrega el cliente (opcional)</span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(payTender))}
                    onChange={(e) => setPayTender(normalizeMoneyDecimalStringForApi(e.target.value))}
                    className="va-field mt-1 w-full"
                    placeholder="Ej. 100.000 si paga con billete mayor"
                  />
                  {payVueltoHint && (
                    <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-2 text-xs font-medium text-brand-900 dark:border-brand-600 dark:bg-brand-900 dark:text-brand-50">
                      {payVueltoHint}
                    </p>
                  )}
                </label>
                <label className="block text-sm">
                  <span className="va-label">Categoría</span>
                  <select value={payCat} onChange={(e) => setPayCat(e.target.value)} className="va-field mt-1 w-full">
                    {incomeCats.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex flex-col text-sm sm:col-span-8">
                <span className="va-label">Nota del cobro</span>
                <textarea
                  required
                  rows={4}
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="va-field mt-1 min-h-[6.75rem] w-full resize-y sm:min-h-[7.25rem]"
                  placeholder="Ej. anticipo cliente, cobro final según presupuesto aprobado…"
                />
                <span className="mt-1.5 text-xs leading-snug text-slate-500 dark:text-slate-300">
                  {notesMinHint(notesMinPayment)}
                </span>
                <NotesMinCharCounter value={payNote} minLength={notesMinPayment} />
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:mt-5 sm:flex-row sm:items-center sm:justify-between sm:pt-5">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300 sm:max-w-xl sm:pr-4">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 dark:border-slate-500"
                  checked={payAck}
                  onChange={(e) => setPayAck(e.target.checked)}
                />
                <span className="leading-snug">
                  Confirmo que revisé tipo de cobro (abono o pago total), monto, efectivo recibido (si aplica), categoría,
                  nota y saldo pendiente antes de registrar el cobro.
                </span>
              </label>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 dark:border-slate-500"
                    checked={payTwoCopies}
                    onChange={(e) => setPayTwoCopies(e.target.checked)}
                  />
                  Imprimir 2 copias del ticket
                </label>
                <button
                  type="submit"
                  disabled={paymentBusy || !canSubmitWorkOrderPayment}
                  className="va-btn-primary w-full shrink-0 px-5 disabled:opacity-60 sm:w-auto sm:self-center"
                >
                  {paymentBusy ? 'Procesando…' : 'Registrar cobro'}
                </button>
              </div>
            </div>
          </form>
              )}
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      <section className={sectionFlushClass}>
        {canMutateLines && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-5">
            <div className="va-tabstrip max-w-md">
              <button
                type="button"
                role="tab"
                aria-selected={addKind === 'PART'}
                onClick={() => setAddKind('PART')}
                className={`va-tab ${addKind === 'PART' ? 'va-tab-active' : 'va-tab-inactive'}`}
              >
                Repuesto
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={addKind === 'LABOR'}
                onClick={() => setAddKind('LABOR')}
                className={`va-tab ${addKind === 'LABOR' ? 'va-tab-active' : 'va-tab-inactive'}`}
              >
                Mano de obra
              </button>
            </div>

            {addKind === 'PART' ? (
              <div className="mt-3">
                <label className="block text-sm">
                  <span className="va-label">Descripción del repuesto (catálogo o texto libre)</span>
                  <div className="relative mt-1">
                    <input
                      ref={partDescInputRef}
                      value={partDesc}
                      role="combobox"
                      aria-expanded={partComboOpen && partSuggestions.length > 0}
                      aria-controls="wo-parts-listbox"
                      aria-activedescendant={
                        partComboOpen && partComboIndex >= 0 ? `wo-part-opt-${partComboIndex}` : undefined
                      }
                      autoComplete="off"
                      onChange={(e) => {
                        const v = e.target.value
                        setPartDesc(v)
                        setPartCatalogTerm(v)
                        setPartComboIndex(-1)
                        setPartComboOpen(true)
                      }}
                      onBlur={() => setPartComboOpen(false)}
                      onFocus={() => {
                        if (debouncedPartTerm.trim().length >= 2) setPartComboOpen(true)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          if (!partComboOpen) setPartComboOpen(true)
                          setPartComboIndex((i) => Math.min(i + 1, partSuggestions.length - 1))
                        } else if (e.key === 'ArrowUp') {
                          setPartComboIndex((i) => Math.max(i - 1, 0))
                        } else if (e.key === 'Enter') {
                          e.preventDefault()
                          if (partComboOpen && partComboIndex >= 0 && partSuggestions[partComboIndex]) {
                            void selectPart(partSuggestions[partComboIndex]!)
                          } else if (partExactCandidate) {
                            void selectPart(partExactCandidate)
                          } else if (partDesc.trim().length >= 2) {
                            void addPartFromFreeText()
                          }
                        } else if (e.key === 'Escape') {
                          setPartComboOpen(false)
                          setPartComboIndex(-1)
                        }
                      }}
                      className="va-field"
                      placeholder="ej. ACEITE-15W40 o filtro de aceite · Enter agrega"
                    />
                    {partComboOpen && debouncedPartTerm.trim().length >= 2 ? (
                      <div
                        id="wo-parts-listbox"
                        role="listbox"
                        aria-label="Sugerencias del catálogo de repuestos"
                        className="absolute left-0 right-0 z-30 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                      >
                        {partSearchQuery.isFetching ? (
                          <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Buscando en el catálogo…</p>
                        ) : partSuggestions.length === 0 ? (
                          <>
                            <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                              Sin coincidencias en el catálogo.
                            </p>
                            {canCreateSparePart ? (
                              <button
                                type="button"
                                role="option"
                                id="wo-part-create"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => void addPartFromFreeText()}
                                className="block w-full px-3 py-1.5 text-left text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
                              >
                                + Agregar «{debouncedPartTerm.trim()}» al catálogo y a la orden
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {partSuggestions.map((s, i) => (
                              <button
                                key={s.id}
                                type="button"
                                role="option"
                                id={`wo-part-opt-${i}`}
                                aria-selected={partComboIndex === i}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => void selectPart(s)}
                                onMouseMove={() => setPartComboIndex(i)}
                                className={`block w-full px-3 py-1.5 text-left text-sm ${
                                  partComboIndex === i
                                    ? 'bg-brand-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">
                                  {s.sku}
                                </span>{' '}
                                · {s.name}{' '}
                                <span className="tabular-nums text-slate-500 dark:text-slate-400">
                                  {Number(s.price) > 0 ? `· $${formatCopFromString(String(s.price))}` : '· precio variable'}
                                </span>
                              </button>
                            ))}
                            {!partExactCandidate && canCreateSparePart ? (
                              <button
                                type="button"
                                role="option"
                                id="wo-part-create-bottom"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => void addPartFromFreeText()}
                                className="mt-1 block w-full border-t border-slate-200 px-3 py-1.5 text-left text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-800"
                              >
                                + Agregar «{debouncedPartTerm.trim()}» al catálogo y a la orden
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </label>
              </div>
            ) : (
              <div className="mt-3">
                <label className="block text-sm">
                  <span className="va-label">Descripción del trabajo</span>
                  <input
                    ref={laborDescInputRef}
                    value={laborDesc}
                    onChange={(e) => setLaborDesc(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && laborDesc.trim() && !e.shiftKey) {
                        e.preventDefault()
                        void addLaborLine()
                      }
                    }}
                    className="va-field mt-1"
                    placeholder="ej. Cambio de aceite y filtro · Enter agrega"
                  />
                </label>
              </div>
            )}
          </div>
        )}
        <div className="va-table-scroll">
          <table
            className={`va-table ${lineTableColSpan >= 7 ? 'min-w-[760px]' : 'min-w-[480px]'}`}
          >
            <thead>
              <tr className="va-table-head-row">
                <th className="va-table-th w-28">Tipo</th>
                <th className="va-table-th">Detalle</th>
                <th className="va-table-th w-20">Cant.</th>
                {canViewWoFinancials ? (
                  <>
                    <th className="va-table-th w-32">P. unit.</th>
                    <th className="va-table-th w-28">Descuento</th>
                  </>
                ) : null}
                {canViewWoCosts ? <th className="va-table-th w-32">P. proveedor</th> : null}
                {canViewWoFinancials ? <th className="va-table-th w-32">Importe</th> : null}
                {showLineActionsColumn ? <th className="va-table-th w-24" /> : null}
              </tr>
            </thead>
            <tbody>
              {linesOrdered.length === 0 && (
                <tr>
                  <td
                    colSpan={lineTableColSpan}
                    className="border-b border-slate-50 px-4 py-8 text-center text-slate-500 last:border-0 sm:px-6 dark:border-slate-800 dark:text-slate-300"
                  >
                    Sin líneas aún.
                  </td>
                </tr>
              )}
              {linesOrdered.map((ln) => {
                const editing = editLine?.id === ln.id
                /**
                 * Ancho fijo y alto compacto: sin `w-full`/`mt-1` de `va-field`, las columnas no
                 * cambian de tamaño al entrar en edición (evita el salto de la tabla).
                 */
                const lineInputClass =
                  'w-20 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-right text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-brand-400 dark:focus:ring-brand-400'
                const lineQtyInputClass = lineInputClass.replace('w-20', 'w-14')
                const lineDescInputClass = lineInputClass
                  .replace('w-20', 'w-full')
                  .replace('text-right', 'text-left')
                // Fila recién agregada: enfoca el valor si falta, si no la cantidad.
                const focusTarget =
                  editing && autoEditFocus?.id === ln.id
                    ? Number(ln.unitPrice ?? 0) > 0
                      ? 'qty'
                      : 'price'
                    : null
                return (
                <tr
                  key={ln.id}
                  className="va-table-body-row"
                  onBlur={(e) => {
                    if (!editing) return
                    const next = e.relatedTarget as Node | null
                    if (next && e.currentTarget.contains(next)) return
                    void saveEdit()
                  }}
                >
                  <td className="va-table-td">
                    <span
                      className={
                        ln.lineType === 'PART'
                          ? 'rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-50'
                          : 'rounded-md bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900 dark:text-teal-50'
                      }
                    >
                      {ln.lineType === 'PART' ? 'Repuesto' : 'Mano de obra'}
                    </span>
                  </td>
                  <td className="va-table-td min-w-0 max-w-xs text-slate-700 dark:text-slate-300">
                    {editing ? (
                      <>
                        <input
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void saveEdit()
                            }
                          }}
                          className={lineDescInputClass}
                          aria-label="Descripción de la línea"
                        />
                        {ln.lineType === 'LABOR' && canViewWoFinancials && taxRatesCatalog.length > 0 ? (
                          <select
                            value={editTaxRateId}
                            onChange={(e) => setEditTaxRateId(e.target.value)}
                            className={`${lineDescInputClass} mt-1`}
                            aria-label="Impuesto de la línea"
                          >
                            <option value="">— Sin impuesto —</option>
                            {taxRatesCatalog.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.kind})
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="line-clamp-2">{ln.description ?? '—'}</span>
                        {ln.sparePartSku ? (
                          <span className="mt-0.5 inline-flex rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-100">
                            {ln.sparePartSku}
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="va-table-td font-mono text-slate-800 dark:text-slate-200">
                    {editing ? (
                      <input
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void saveEdit()
                          }
                        }}
                        ref={focusTarget === 'qty' ? lineFocusRef : undefined}
                        inputMode="decimal"
                        autoComplete="off"
                        className={lineQtyInputClass}
                        aria-label="Cantidad de la línea"
                      />
                    ) : (
                      ln.quantity
                    )}
                  </td>
                  {canViewWoFinancials ? (
                    <>
                      <td className="va-table-td font-mono text-slate-600 dark:text-slate-300">
                        {editing ? (
                          <input
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void saveEdit()
                              }
                            }}
                            ref={focusTarget === 'price' ? lineFocusRef : undefined}
                            inputMode="decimal"
                            autoComplete="off"
                            className={lineInputClass}
                            placeholder="0"
                            aria-label="Precio unitario de la línea"
                          />
                        ) : ln.unitPrice != null ? (
                          <>
                            ${formatCopFromString(normalizeMoneyDecimalStringForApi(String(ln.unitPrice)))}
                            {ln.taxRatePercentSnapshot && Number(ln.taxRatePercentSnapshot) > 0 ? (
                              <span className="ml-1 text-[10px] text-slate-500 dark:text-slate-400">
                                +{Number(ln.taxRatePercentSnapshot).toString()}%
                              </span>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="va-table-td font-mono text-slate-600 dark:text-slate-300">
                        {editing ? (
                          <input
                            value={editDiscount}
                            onChange={(e) => setEditDiscount(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void saveEdit()
                              }
                            }}
                            inputMode="decimal"
                            autoComplete="off"
                            className={lineInputClass}
                            placeholder="0"
                            aria-label="Descuento de la línea"
                          />
                        ) : ln.discountAmount && Number(ln.discountAmount) > 0 ? (
                          `−$${formatCopFromString(String(ln.discountAmount))}`
                        ) : (
                          '—'
                        )}
                      </td>
                    </>
                  ) : null}
                  {canViewWoCosts ? (
                    <td className="va-table-td font-mono text-slate-500 dark:text-slate-400">
                      {editing && ln.lineType === 'PART' ? (
                        <input
                          value={editCost}
                          onChange={(e) => setEditCost(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void saveEdit()
                            }
                          }}
                          inputMode="decimal"
                          autoComplete="off"
                          className={lineInputClass}
                          placeholder="0"
                          aria-label="Precio proveedor de la línea"
                        />
                      ) : ln.lineType === 'PART' && ln.costSnapshot && Number(ln.costSnapshot) > 0 ? (
                        `$${formatCopFromString(String(ln.costSnapshot))}`
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                  {canViewWoFinancials ? (
                    <td className="va-table-td font-medium tabular-nums text-slate-900 dark:text-slate-50">
                      {ln.totals
                        ? `$${formatCopFromString(ln.totals.lineTotal)}`
                        : lineMoney(ln) === '—'
                          ? '—'
                          : `$${formatCopFromString(lineMoney(ln))}`}
                    </td>
                  ) : null}
                  {showLineActionsColumn ? (
                    <td className="va-table-td">
                      <div className="flex flex-wrap items-center gap-1">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => void saveEdit()}
                              title="Guardar línea"
                              aria-label="Guardar línea"
                              className="rounded-lg border border-brand-200 bg-white p-1.5 text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:border-brand-800 dark:bg-slate-800 dark:text-brand-300 dark:hover:bg-slate-700"
                            >
                              <Check className="size-4" strokeWidth={1.75} />
                            </button>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={cancelEdit}
                              title="Cancelar edición"
                              aria-label="Cancelar edición"
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                              <X className="size-4" strokeWidth={1.75} />
                            </button>
                          </>
                        ) : (
                          canUpdateLine && (
                            <button
                              type="button"
                              onClick={() => startEdit(ln)}
                              title="Editar línea"
                              aria-label="Editar línea"
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-brand-700 hover:bg-brand-50 dark:border-slate-600 dark:bg-slate-800 dark:text-brand-300 dark:hover:bg-slate-700"
                            >
                              <Pencil className="size-4" strokeWidth={1.75} />
                            </button>
                          )
                        )}
                        {canDeleteLine ? (
                          <button
                            type="button"
                            onClick={() => void removeLine(ln.id)}
                            title="Quitar línea"
                            aria-label="Quitar línea"
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-red-600 hover:bg-red-50 dark:border-slate-600 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-slate-700"
                          >
                            <Trash2 className="size-4" strokeWidth={1.75} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      {consentModal === 'view' && wo.clientConsentSignedAt && wo.clientSignaturePngBase64 ? (
        <ClientConsentSignedModal
          orderNumber={wo.orderNumber}
          publicCode={wo.publicCode}
          signedAt={wo.clientConsentSignedAt}
          consentSnapshot={wo.clientConsentTextSnapshot ?? null}
          signaturePngBase64={wo.clientSignaturePngBase64}
          onClose={() => setConsentModal(null)}
        />
      ) : null}
      {consentModal === 'sign' && canPatchWo && !closed ? (
        <ClientConsentSignModal
          workOrderId={wo.id}
          orderNumber={wo.orderNumber}
          publicCode={wo.publicCode}
          onRecorded={() => void load()}
          onClose={() => setConsentModal(null)}
        />
      ) : null}
    </div>
  )
}
