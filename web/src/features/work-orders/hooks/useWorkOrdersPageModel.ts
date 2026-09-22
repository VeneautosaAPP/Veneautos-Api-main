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
  readStoredPageSize,
  workOrderListFetchFilterKey,
  workOrderListHasFetchFilters,
  WO_PAGE_SIZE_KEY,
  WO_PAGE_SIZE_OPTIONS,
} from '../services/workOrdersListPresentation'
import { prefetchWorkOrderDetail } from '../prefetch/workOrdersNavPrefetch'
import {
  selectWorkOrderListSlice,
  type WorkOrderListSlice,
} from '../selectors/workOrderListSelectors'
import {
  cancelWorkOrderToTerminal,
  createCustomerQuick,
  createVehicleQuick,
  createWorkOrderFromList,
  fetchCustomerVehiclesForWorkOrderList,
  fetchWorkOrderDetailForList,
  fetchWorkOrdersList,
  searchVehiclesForWorkOrder,
} from '../services/workOrdersListApi'
import type { WorkOrdersVehicleHit, WorkOrdersWarrantyVehicleOption } from '../types'
import { useWorkOrderListFilters } from './useWorkOrderListFilters'

/** Normaliza a solo letras y números en mayúsculas (compara sin guiones/espacios). */
function plateAlphaNorm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Coincidencia exacta por placa normalizada (insensible a guiones/espacios). */
function findExactPlateHit(hits: WorkOrdersVehicleHit[], norm: string): WorkOrdersVehicleHit | undefined {
  const want = plateAlphaNorm(norm)
  return hits.find((v) => plateAlphaNorm(v.plate) === want)
}

/** Variantes de consulta para localizar una placa existente (la búsqueda del API es substring). */
function plateSearchVariants(norm: string): string[] {
  const variants = new Set<string>()
  const clean = plateAlphaNorm(norm)
  variants.add(norm)
  variants.add(clean)
  if (clean.length >= 4) {
    for (let i = 1; i < clean.length; i++) {
      variants.add(`${clean.slice(0, i)}-${clean.slice(i)}`)
    }
  }
  return [...variants]
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
    deliveredFromIso,
    deliveredToIso,
  } = listFilters

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
          from: deliveredFromIso || undefined,
          to: deliveredToIso || undefined,
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

  const [quickName, setQuickName] = useState('')
  const [quickPhone, setQuickPhone] = useState('')
  const [quickPlate, setQuickPlate] = useState('')
  const [quickBrand, setQuickBrand] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickMsg, setQuickMsg] = useState<string | null>(null)

  /** Limpia el formulario de alta rápida (previo a cerrar/reabrir o tras crear). */
  const resetQuickCreate = useCallback(() => {
    setQuickName('')
    setQuickPhone('')
    setQuickPlate('')
    setQuickBrand('')
    setQuickMsg(null)
  }, [])

  /** Alta rápida: crea cliente + vehículo y los vincula a la orden en formulación. */
  const quickCreate = useCallback(async () => {
    setQuickMsg(null)
    const name = quickName.trim()
    const phone = quickPhone.trim()
    const plateText = quickPlate.trim()
    const brand = quickBrand.trim()
    if (name.length < 2) {
      setQuickMsg('Escribí el nombre del cliente (mín. 2 caracteres).')
      return
    }
    if (!phone) {
      setQuickMsg('Escribí el teléfono del cliente.')
      return
    }
    if (plateText.length < 2) {
      setQuickMsg('Escribí la placa del vehículo.')
      return
    }
    if (!brand) {
      setQuickMsg('Escribí la marca del vehículo.')
      return
    }
    setQuickBusy(true)
    try {
      const norm = plateText.toUpperCase().replace(/\s+/g, '')
      if (can('vehicles:read')) {
        const hits = await searchVehiclesForWorkOrder(norm)
        const exact = findExactPlateHit(hits, norm)
        if (exact) {
          setVehicleId(exact.id)
          setVehiclePlate(exact.plate)
          setCustomerName(exact.customer.displayName)
          setCustomerPhone(exact.customer.primaryPhone ?? '')
          setQuickMsg(
            `La placa ${exact.plate} ya está registrada: se vinculó el vehículo de ${exact.customer.displayName}.`,
          )
          return
        }
      }
      const cust = await createCustomerQuick({ displayName: name, primaryPhone: phone })
      const veh = await createVehicleQuick({ customerId: cust.id, plate: plateText, brand })
      setVehicleId(veh.id)
      setVehiclePlate(veh.plate)
      setCustomerName(name)
      setCustomerPhone(phone)
      resetQuickCreate()
      setQuickMsg(`Cliente y vehículo creados: ${name} · ${veh.plate}. Podés crear la orden.`)
    } catch (e) {
      const conflict = e instanceof ApiError && (e.status === 409 || /placa/.test(e.message))
      if (!conflict) {
        setQuickMsg(e instanceof Error ? e.message : 'No se pudo crear el cliente.')
        return
      }
      // Placa existente que la búsqueda directa no alcanzó (p. ej. formato de guión):
      // intentar localizarla para vincularla en vez de fallar.
      const norm = plateText.toUpperCase().replace(/\s+/g, '')
      let bound: WorkOrdersVehicleHit | undefined
      if (can('vehicles:read')) {
        for (const variant of plateSearchVariants(norm)) {
          try {
            const hit = findExactPlateHit(await searchVehiclesForWorkOrder(variant), norm)
            if (hit) {
              bound = hit
              break
            }
          } catch {
            /* seguir con la siguiente variante */
          }
        }
      }
      if (bound) {
        setVehicleId(bound.id)
        setVehiclePlate(bound.plate)
        setCustomerName(bound.customer.displayName)
        setCustomerPhone(bound.customer.primaryPhone ?? '')
        setQuickMsg(
          `La placa ${bound.plate} ya está registrada: se vinculó el vehículo de ${bound.customer.displayName} (el cliente quedó creado).`,
        )
      } else {
        setQuickMsg(
          'Ya existe un vehículo con esa placa. Buscala en el campo Vehículo para vincularlo; el cliente nuevo quedó creado.',
        )
      }
    } finally {
      setQuickBusy(false)
    }
  }, [
    can,
    quickName,
    quickPhone,
    quickPlate,
    quickBrand,
    resetQuickCreate,
    setVehicleId,
    setVehiclePlate,
    setCustomerName,
    setCustomerPhone,
  ])

  useEffect(() => {
    try {
      localStorage.setItem(WO_PAGE_SIZE_KEY, String(pageSize))
    } catch {
      /* ignore */
    }
  }, [pageSize])

  const listFilterRef = useRef<string | null>(null)

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
    resetQuickCreate()
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
  }, [searchParams, can, setSearchParams, resetQuickCreate])

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
    resetQuickCreate()
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
  }, [searchParams, can, setSearchParams, resetQuickCreate])

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

  const setTextSearch = useCallback(
    (next: string) => {
      const nextParams = new URLSearchParams(searchParams)
      const trimmed = next.trim()
      if (trimmed) nextParams.set('search', trimmed)
      else nextParams.delete('search')
      nextParams.delete('page')
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  /** Rango por fecha de entrega (`from`/`to` en la URL, ISO). '' limpia el extremo. */
  const setDeliveredFrom = useCallback(
    (iso: string) => {
      const nextParams = new URLSearchParams(searchParams)
      if (iso) nextParams.set('from', iso)
      else nextParams.delete('from')
      nextParams.delete('page')
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setDeliveredTo = useCallback(
    (iso: string) => {
      const nextParams = new URLSearchParams(searchParams)
      if (iso) nextParams.set('to', iso)
      else nextParams.delete('to')
      nextParams.delete('page')
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
        setCreateMsg('Elegí un vehículo del maestro escribiendo su placa (la orden debe quedar vinculada).')
        return
      }
      if (warrantyParentId && !vid) {
        setCreateMsg(
          'Falta el vehículo: si la orden origen no tiene uno en el maestro, buscá la placa arriba. Si podés leer la orden origen, debería cargarse solo.',
        )
        return
      }
      const body: CreateWorkOrderPayload = { description: desc.trim() }
      if (vid) body.vehicleId = vid
      if (warrantyParentId) body.parentWorkOrderId = warrantyParentId
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
        resetQuickCreate()
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
      resetQuickCreate,
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
    resetQuickCreate()
    resetCreateWarrantyState()
    setCreateOpen(true)
  }, [resetCreateWarrantyState, resetQuickCreate])

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
    deliveredFromIso,
    deliveredToIso,
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
    quickName,
    setQuickName,
    quickPhone,
    setQuickPhone,
    quickPlate,
    setQuickPlate,
    quickBrand,
    setQuickBrand,
    quickBusy,
    quickMsg,
    quickCreate,
    resetQuickCreate,
    listBusy,
    loadPage,
    setStatus,
    setTextSearch,
    setDeliveredFrom,
    setDeliveredTo,
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
