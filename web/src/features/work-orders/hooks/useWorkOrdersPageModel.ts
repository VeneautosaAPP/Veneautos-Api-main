import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import type {
  CreateWorkOrderPayload,
  WorkOrderListResponse,
  WorkOrderSummary,
  WorkOrderStatus,
} from '../../../api/types'
import { STALE_WORK_ORDERS_LIST_MS } from '../../../constants/queryStaleTime'
import { useAuth } from '../../../auth/AuthContext'
import { portalPath } from '../../../constants/portalPath'
import { queryKeys } from '../../../lib/queryKeys'
import { emitWorkOrderChanged, WORK_ORDER_CHANGED_EVENT } from '../../../services/workOrderEvents'
import { panelUsesModernShell } from '../../../config/operationalNotes'
import { usePanelTheme } from '../../../theme/PanelThemeProvider'
import {
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../../../utils/copFormat'
import {
  readStoredListView,
  readStoredPageSize,
  workOrderListFetchFilterKey,
  workOrderListHasFetchFilters,
  WO_LIST_VIEW_KEY,
  WO_PAGE_SIZE_KEY,
  WO_PAGE_SIZE_OPTIONS,
  type WoListView,
} from '../services/workOrdersListPresentation'
import { prefetchWorkOrderDetail } from '../prefetch/workOrdersNavPrefetch'
import {
  selectWorkOrderListSlice,
  type WorkOrderListSlice,
} from '../selectors/workOrderListSelectors'
import {
  cancelWorkOrderToTerminal,
  createWorkOrderFromList,
  fetchCustomerVehiclesForWorkOrderList,
  fetchWorkOrderDetailForList,
  fetchWorkOrdersList,
  searchVehiclesForWorkOrder,
} from '../services/workOrdersListApi'
import type { WorkOrdersVehicleHit, WorkOrdersWarrantyVehicleOption } from '../types'
import { useWorkOrderListFilters } from './useWorkOrderListFilters'

function woSelectionSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

export function useWorkOrdersPageModel() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const { can } = useAuth()
  const canViewWoFinancials = useMemo(
    () =>
      can('work_orders:view_financials') ||
      can('work_order_lines:set_unit_price') ||
      can('work_orders:record_payment'),
    [can],
  )
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const listFilters = useWorkOrderListFilters(searchParams)
  const listFetchFilterKey = workOrderListFetchFilterKey(listFilters)
  const hasActiveFetchFilters = useMemo(() => workOrderListHasFetchFilters(listFilters), [listFilters])
  const {
    statusFilter,
    vehicleIdFilter,
    customerIdFilter,
    vehiclePlateLabel,
    textSearch,
  } = listFilters

  const rowsRef = useRef<WorkOrderSummary[] | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof WO_PAGE_SIZE_OPTIONS)[number]>(() => readStoredPageSize())

  const queryClient = useQueryClient()
  const listQueryKey = useMemo(
    () =>
      queryKeys.workOrders.list({
        filterKey: listFetchFilterKey,
        page,
        pageSize,
      }),
    [listFetchFilterKey, page, pageSize],
  )

  const listQuery = useQuery<WorkOrderListResponse, Error, WorkOrderListSlice>({
    queryKey: listQueryKey,
    queryFn: ({ signal }) =>
      fetchWorkOrdersList(
        {
          status: statusFilter || undefined,
          vehicleId: vehicleIdFilter || undefined,
          customerId: customerIdFilter || undefined,
          search: textSearch || undefined,
          page,
          pageSize,
        },
        signal,
      ),
    /** Lista operativa; invalidación explícita tras crear/cancelar OT. Frescura extendida al volver del detalle. */
    staleTime: STALE_WORK_ORDERS_LIST_MS,
    select: selectWorkOrderListSlice,
    /** Misma UX que antes: no vaciar la grilla al cambiar página o refetch en background. */
    placeholderData: keepPreviousData,
  })

  const rows = useMemo((): WorkOrderSummary[] | null => {
    if (listQuery.data !== undefined) return listQuery.data.items
    return null
  }, [listQuery.data])

  rowsRef.current = rows

  const total = listQuery.data?.total ?? 0

  const err = useMemo(() => {
    if (!listQuery.isError) return null
    const e = listQuery.error
    const detail =
      e instanceof ApiError && e.message
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Error desconocido'
    return `No se pudieron cargar las órdenes: ${detail}`
  }, [listQuery.isError, listQuery.error])

  const listBusy = listQuery.isFetching

  const createWorkOrderMutation = useMutation({
    mutationFn: createWorkOrderFromList,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.workOrders.root, 'list'] })
    },
  })

  const cancelWorkOrderMutation = useMutation({
    mutationFn: cancelWorkOrderToTerminal,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.workOrders.root, 'list'] })
    },
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [postCreateConsent, setPostCreateConsent] = useState<{
    id: string
    orderNumber: number | null
    publicCode: string | null
  } | null>(null)
  const [createMsg, setCreateMsg] = useState<string | null>(null)
  const [desc, setDesc] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleBrandCreate, setVehicleBrandCreate] = useState('')
  const [intakeKmCreate, setIntakeKmCreate] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [warrantyParentId, setWarrantyParentId] = useState<string | null>(null)
  const [warrantyParentOrderNumber, setWarrantyParentOrderNumber] = useState<number | null>(null)
  const [warrantyVehicleOptions, setWarrantyVehicleOptions] = useState<WorkOrdersWarrantyVehicleOption[]>([])
  const [warrantyVehicleLoading, setWarrantyVehicleLoading] = useState(false)
  const [warrantyVehicleError, setWarrantyVehicleError] = useState<string | null>(null)
  const [warrantyParentMissingVehicle, setWarrantyParentMissingVehicle] = useState(false)
  const [listView, setListView] = useState<WoListView>(() => readStoredListView())

  const [vehModalOpen, setVehModalOpen] = useState(false)
  const [vehQ, setVehQ] = useState('')
  const [vehLoading, setVehLoading] = useState(false)
  const [vehResults, setVehResults] = useState<WorkOrdersVehicleHit[] | null>(null)
  const [vehErr, setVehErr] = useState<string | null>(null)

  useEffect(() => {
    if (!createOpen) {
      setVehModalOpen(false)
    }
  }, [createOpen])

  useEffect(() => {
    try {
      localStorage.setItem(WO_LIST_VIEW_KEY, listView)
    } catch {
      /* ignore */
    }
  }, [listView])

  useEffect(() => {
    try {
      localStorage.setItem(WO_PAGE_SIZE_KEY, String(pageSize))
    } catch {
      /* ignore */
    }
  }, [pageSize])

  const listFilterRef = useRef<string | null>(null)

  /** Selección en listado (batch): callbacks estables para no invalidar memo de hijos. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** `rows` va en ref: callback estable y sin re-suscripciones; al invocar lee la página actual. */
  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const r = rowsRef.current
      if (!r?.length) return prev.size === 0 ? prev : new Set()
      const next = new Set(r.map((x) => x.id))
      return woSelectionSetsEqual(prev, next) ? prev : next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
  }, [])

  useEffect(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
  }, [listFetchFilterKey, page])

  useEffect(() => {
    if (rows?.length !== 0) return
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
  }, [rows])

  const runVehicleSearch = useCallback(async () => {
    const q = vehQ.trim()
    if (q.length < 2) {
      setVehErr('Escribí al menos 2 caracteres')
      setVehResults(null)
      return
    }
    setVehErr(null)
    setVehLoading(true)
    try {
      const list = await searchVehiclesForWorkOrder(q)
      setVehResults(list)
    } catch (e) {
      setVehResults(null)
      setVehErr(e instanceof Error ? e.message : 'Error al buscar')
    } finally {
      setVehLoading(false)
    }
  }, [vehQ])

  /** Invalida/refresca la lista (misma firma que antes para compatibilidad exportada). */
  const loadPage = useCallback(
    async (pageNum?: number) => {
      if (typeof pageNum === 'number' && pageNum !== page) {
        setPage(pageNum)
        return
      }
      await queryClient.invalidateQueries({ queryKey: [...queryKeys.workOrders.root, 'list'] })
    },
    [page, queryClient],
  )

  /** Al cambiar filtros desde URL: si estábamos en página > 1, volver a 1 (equivalente al efecto anterior). */
  useEffect(() => {
    const fk = listFetchFilterKey
    const prevFk = listFilterRef.current
    const bumped = prevFk !== null && prevFk !== fk

    if (bumped && page !== 1) {
      listFilterRef.current = fk
      setPage(1)
      return
    }
    if (bumped || prevFk === null) {
      listFilterRef.current = fk
    }
  }, [listFetchFilterKey, page])

  /** Si el total shrink, no dejar página fantasma fuera de rango. */
  useEffect(() => {
    const data = listQuery.data
    if (!data) return
    const maxPage = Math.max(1, Math.ceil(data.total / pageSize) || 1)
    setPage((p) => (p > maxPage ? maxPage : p))
  }, [listQuery.data, pageSize])

  useEffect(() => {
    const oc = searchParams.get('openCreate')?.trim()
    const vid = searchParams.get('vehicleId')?.trim()
    if (oc !== '1' || !vid || !can('work_orders:create')) return
    setCreateMsg(null)
    setWarrantyParentId(null)
    setWarrantyParentOrderNumber(null)
    setWarrantyVehicleOptions([])
    setWarrantyVehicleError(null)
    setWarrantyParentMissingVehicle(false)
    setWarrantyVehicleLoading(false)
    setVehicleId(vid)
    const pl = searchParams.get('plate')?.trim()
    setVehiclePlate(pl ?? '')
    setCustomerName('')
    setCustomerPhone('')
    setCreateOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('openCreate')
    next.delete('vehicleId')
    next.delete('plate')
    setSearchParams(next, { replace: true })
  }, [searchParams, can, setSearchParams])

  useEffect(() => {
    const wf = searchParams.get('warrantyFrom')?.trim()
    if (!wf || !can('work_orders:create')) return

    const clearWarrantyFromParam = () => {
      setSearchParams((prev) => {
        if (!prev.get('warrantyFrom')) return prev
        const n = new URLSearchParams(prev)
        n.delete('warrantyFrom')
        return n
      }, { replace: true })
    }

    setWarrantyParentId(wf)
    setWarrantyParentOrderNumber(null)
    setWarrantyVehicleOptions([])
    setWarrantyVehicleError(null)
    setWarrantyParentMissingVehicle(false)
    setCreateOpen(true)
    setDesc((prev) => (prev.trim() ? prev : 'Garantía / seguimiento vinculado. '))
    setVehicleId('')
    setVehiclePlate('')
    setCustomerName('')
    setCustomerPhone('')

    let cancelled = false

    if (!can('work_orders:read') && !can('work_orders:read_portal')) {
      clearWarrantyFromParam()
      return () => {
        cancelled = true
      }
    }

    setWarrantyVehicleLoading(true)
    ;(async () => {
      try {
        const parent = await fetchWorkOrderDetailForList(wf)
        if (cancelled) return
        setWarrantyParentOrderNumber(parent.orderNumber)
        const v = parent.vehicle
        if (!v?.id) {
          setWarrantyParentMissingVehicle(true)
          setWarrantyVehicleOptions([])
          return
        }
        setVehicleId(v.id)
        setVehiclePlate(v.plate)
        const cust = v.customer
        setCustomerName(cust?.displayName ?? parent.customerName ?? '')
        setCustomerPhone(cust?.primaryPhone ?? parent.customerPhone ?? '')

        if (!can('vehicles:read') || !cust?.id) {
          setWarrantyVehicleOptions([
            { id: v.id, plate: v.plate, brand: v.brand, model: v.model, isActive: true },
          ])
          return
        }
        const list = await fetchCustomerVehiclesForWorkOrderList(cust.id)
        if (cancelled) return
        let opts = list.filter((x) => x.isActive)
        if (!opts.some((o) => o.id === v.id)) {
          opts = [{ id: v.id, plate: v.plate, brand: v.brand, model: v.model, isActive: true }, ...opts]
        }
        opts.sort((a, b) => a.plate.localeCompare(b.plate, undefined, { sensitivity: 'base' }))
        setWarrantyVehicleOptions(opts)
      } catch {
        if (!cancelled) {
          setWarrantyVehicleError('No se pudo cargar la orden origen ni los vehículos del cliente.')
        }
      } finally {
        if (!cancelled) {
          setWarrantyVehicleLoading(false)
          clearWarrantyFromParam()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [searchParams, can, setSearchParams])

  useEffect(() => {
    const onWoChanged = (ev: Event) => {
      const ce = ev as CustomEvent<{ workOrderId: string }>
      const wid = ce.detail?.workOrderId
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.workOrders.root, 'list'] })
      if (wid) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workOrders.detail(wid) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.workOrders.payments(wid) })
      }
    }
    window.addEventListener(WORK_ORDER_CHANGED_EVENT, onWoChanged)
    return () => window.removeEventListener(WORK_ORDER_CHANGED_EVENT, onWoChanged)
  }, [queryClient])

  const setStatus = useCallback(
    (next: WorkOrderStatus | '') => {
      const nextParams = new URLSearchParams(searchParams)
      if (next) nextParams.set('status', next)
      else nextParams.delete('status')
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const clearListFilters = useCallback(() => {
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  const submitCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setCreateMsg(null)
      const vid = vehicleId.trim()
      if (!warrantyParentId && !vid) {
        setCreateMsg('Elegí un vehículo del maestro con la lupa (la orden debe quedar vinculada).')
        return
      }
      if (warrantyParentId && !vid) {
        setCreateMsg(
          'Falta el vehículo: si la orden origen no tiene uno en maestro, buscá con la lupa. Si podés leer la orden origen, debería cargarse solo.',
        )
        return
      }
      const body: CreateWorkOrderPayload = { description: desc.trim() }
      if (vid) body.vehicleId = vid
      if (warrantyParentId) body.parentWorkOrderId = warrantyParentId
      const vb = vehicleBrandCreate.trim()
      if (vb) body.vehicleBrand = vb
      const ikm = intakeKmCreate.trim()
      if (ikm !== '') {
        const n = Number(ikm)
        if (!Number.isInteger(n) || n < 0 || n > 9_999_999) {
          setCreateMsg('Kilometraje: entero entre 0 y 9.999.999 o vacío.')
          return
        }
        body.intakeOdometerKm = n
      }
      try {
        const created = await createWorkOrderMutation.mutateAsync(body)
        setCreateOpen(false)
        setDesc('')
        setCustomerName('')
        setCustomerPhone('')
        setVehiclePlate('')
        setVehicleBrandCreate('')
        setIntakeKmCreate('')
        setVehicleId('')
        setWarrantyParentId(null)
        setWarrantyParentOrderNumber(null)
        setWarrantyVehicleOptions([])
        setWarrantyVehicleError(null)
        setWarrantyParentMissingVehicle(false)
        setWarrantyVehicleLoading(false)
        setPostCreateConsent({
          id: created.id,
          orderNumber: typeof created.orderNumber === 'number' ? created.orderNumber : null,
          publicCode: typeof created.publicCode === 'string' ? created.publicCode : null,
        })
      } catch (e) {
        setCreateMsg(e instanceof Error ? e.message : 'Error al crear la orden')
      }
    },
    [
      createWorkOrderMutation,
      desc,
      intakeKmCreate,
      vehicleBrandCreate,
      vehicleId,
      warrantyParentId,
    ],
  )

  const handlePostCreateSigned = useCallback(() => {
    const ctx = postCreateConsent
    if (!ctx) return
    setPostCreateConsent(null)
    emitWorkOrderChanged(ctx.id)
    navigate(portalPath(`/ordenes/${ctx.id}`))
    void loadPage(page)
  }, [postCreateConsent, navigate, loadPage, page])

  const handlePostCreateAbandon = useCallback(async () => {
    const ctx = postCreateConsent
    if (!ctx) return
    setPostCreateConsent(null)
    if (can('work_orders:set_terminal_status')) {
      try {
        await cancelWorkOrderMutation.mutateAsync(ctx.id)
        setCreateMsg('Orden cancelada: no se registró el consentimiento.')
      } catch (e) {
        setCreateMsg(e instanceof Error ? e.message : 'No se pudo cancelar la orden.')
      }
    } else {
      setCreateMsg(
        ctx.publicCode != null
          ? `Orden ${ctx.publicCode} quedó creada sin firma: abrila desde el listado para firmar o pedí que la cancelen si no avanza.`
          : ctx.orderNumber != null
            ? `Orden #${ctx.orderNumber} quedó creada sin firma: abrila desde el listado para firmar o pedí que la cancelen si no avanza.`
            : 'La orden quedó creada sin firma: podés abrirla desde el listado cuando corresponda.',
      )
    }
    emitWorkOrderChanged(ctx.id)
  }, [postCreateConsent, can, cancelWorkOrderMutation])

  const resetCreateWarrantyState = useCallback(() => {
    setWarrantyParentId(null)
    setWarrantyParentOrderNumber(null)
    setWarrantyVehicleOptions([])
    setWarrantyVehicleError(null)
    setWarrantyParentMissingVehicle(false)
    setWarrantyVehicleLoading(false)
  }, [])

  const openNewOrderModal = useCallback(() => {
    setCreateMsg(null)
    resetCreateWarrantyState()
    setCreateOpen(true)
  }, [resetCreateWarrantyState])

  const prefetchWorkOrderDetailNav = useCallback(
    (workOrderId: string) => prefetchWorkOrderDetail(queryClient, workOrderId),
    [queryClient],
  )

  return {
    isSaas,
    can,
    canViewWoFinancials,
    statusFilter,
    vehicleIdFilter,
    customerIdFilter,
    vehiclePlateLabel,
    textSearch,
    hasActiveFetchFilters,
    rows,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    err,
    createOpen,
    setCreateOpen,
    postCreateConsent,
    createMsg,
    setCreateMsg,
    desc,
    setDesc,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    vehiclePlate,
    setVehiclePlate,
    vehicleBrandCreate,
    setVehicleBrandCreate,
    intakeKmCreate,
    setIntakeKmCreate,
    vehicleId,
    setVehicleId,
    warrantyParentId,
    warrantyParentOrderNumber,
    warrantyVehicleOptions,
    warrantyVehicleLoading,
    warrantyVehicleError,
    warrantyParentMissingVehicle,
    listView,
    setListView,
    vehModalOpen,
    setVehModalOpen,
    vehQ,
    setVehQ,
    vehLoading,
    vehResults,
    vehErr,
    listBusy,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    loadPage,
    runVehicleSearch,
    setStatus,
    clearListFilters,
    submitCreate,
    handlePostCreateSigned,
    handlePostCreateAbandon,
    resetCreateWarrantyState,
    openNewOrderModal,
    prefetchWorkOrderDetail: prefetchWorkOrderDetailNav,
    /** Presentación money input (misma lógica que antes) */
    formatMoneyInputDisplayFromNormalized,
    normalizeMoneyDecimalStringForApi,
  }
}
