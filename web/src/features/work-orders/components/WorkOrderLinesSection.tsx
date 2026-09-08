import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../api/client'
import { queryKeys } from '../../../lib/queryKeys'
import { useAlert, useConfirm } from '../../../components/confirm/ConfirmProvider'
import {
  API_MONEY_DECIMAL_REGEX,
  formatCopFromString,
  normalizeMoneyDecimalStringForApi,
} from '../../../utils/copFormat'
import type { SparePart, WorkOrderDetail, WorkOrderLine, WorkOrderLineType } from '../../../api/types'
import { lineMoney, linesSubtotalFromLines } from '../services/workOrderLinesPresentation'
import { useWorkOrderDetailMutations } from '../hooks/useWorkOrderDetailMutations'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

type TaxRateCatalogRow = { id: string; name: string; kind: string }

/**
 * Minúsculas sin tildes: que «aceite» encuentre «ACEITE» y «aceité» por igual.
 * El rango es el de marcas diacríticas combinantes (U+0300–U+036F).
 */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export type WorkOrderLinesSectionProps = {
  workOrder: WorkOrderDetail
  workOrderId: string | undefined
  setWorkOrder: Dispatch<SetStateAction<WorkOrderDetail | null>>
  can: (code: string) => boolean
  canMutateLines: boolean
  canUpdateLine: boolean
  canDeleteLine: boolean
  canViewWoFinancials: boolean
  canViewWoCosts: boolean
  closed: boolean
  taxRatesCatalog: TaxRateCatalogRow[]
  sectionClassName: string
  setMsg: (m: string | null) => void
  onLinesChanged: () => Promise<void>
  onReload: () => Promise<void>
  onBlockingError: (e: unknown) => Promise<boolean>
}

/**
 * Sección de líneas de la OT (repuestos y mano de obra): alta con autocompletado del catálogo,
 * tabla con descuento y precio proveedor, y edición en la fila. Micro-proceso propio para no
 * concentrar todo en la página de detalle.
 */
export function WorkOrderLinesSection({
  workOrder: wo,
  workOrderId: id,
  setWorkOrder: setWo,
  can,
  canMutateLines,
  canUpdateLine,
  canDeleteLine,
  canViewWoFinancials,
  canViewWoCosts,
  closed,
  taxRatesCatalog,
  sectionClassName,
  setMsg,
  onLinesChanged,
  onReload,
  onBlockingError,
}: WorkOrderLinesSectionProps) {
  const confirm = useConfirm()
  const blockingAlert = useAlert()
  const queryClient = useQueryClient()
  const { postLine, patchLine, deleteLine } = useWorkOrderDetailMutations(id)
  const refreshLinesOnWorkOrder = onLinesChanged
  const load = onReload
  const showBlockingConflictModal = onBlockingError
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
  /** true cuando la última acción abrió el editor de una fila (ver `resetPartAdd`). */
  const justOpenedEditorRef = useRef(false)

  const [partCatalogTerm, setPartCatalogTerm] = useState('')
  const [partComboOpen, setPartComboOpen] = useState(false)
  const [partComboIndex, setPartComboIndex] = useState(-1)
  const debouncedPartTerm = useDebouncedValue(partCatalogTerm.trim().slice(0, 60), 120)

  /**
   * Catálogo de repuestos en memoria del cliente.
   *
   * Antes cada tecla disparaba `GET /spare-parts?q=…` (ciento y pico de ms por viaje desde el
   * navegador hasta Railway). Ahora el catálogo se descarga una sola vez y el filtrado se hace en
   * local, así que escribir y ver sugerencias es inmediato y sin consumo de red.
   *
   * La caché vive 3 horas: el catálogo cambia poco y así abrir una OT no vuelve a descargarlo.
   * Al crear un repuesto se actualiza en el momento (ver `rememberCreatedPart`), así que nunca
   * se busca sobre datos viejo.
   *
   * Si el catálogo supera el tope del endpoint, o todavía está vacío, `useLocalSearch` es false y
   * el buscador vuelve a la búsqueda en servidor (comportamiento anterior).
   */
  const catalogQuery = useQuery({
    queryKey: queryKeys.spareParts.catalog(),
    queryFn: ({ signal }) => api<{ items: SparePart[]; total: number }>('/spare-parts/catalog', { signal }),
    staleTime: 3 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
  })
  const catalogIsComplete = catalogQuery.data
    ? catalogQuery.data.items.length >= catalogQuery.data.total
    : false
  /**
   * `0 >= 0` también cumple `catalogIsComplete`: con el catálogo vacío el filtro local no
   * encontraría nada y la búsqueda en servidor estaba desactivada, así que un repuesto recién
   * creado era "invisible" hasta que expirara la caché. Por eso exigimos que haya ítems.
   */
  const useLocalSearch = catalogIsComplete && (catalogQuery.data?.items.length ?? 0) > 0

  /** Búsqueda en servidor: sólo cuando el catálogo en memoria no alcanza (vacío o incompleto). */
  const partSearchQuery = useQuery({
    queryKey: queryKeys.spareParts.search(debouncedPartTerm),
    queryFn: ({ signal }) =>
      api<{ items: SparePart[]; total: number }>(
        `/spare-parts?q=${encodeURIComponent(debouncedPartTerm)}&limit=12`,
        { signal },
      ),
    enabled: !useLocalSearch && debouncedPartTerm.length >= 2,
    staleTime: 60_000,
  })

  const partSuggestions = useMemo(() => {
    const term = debouncedPartTerm.trim().toLowerCase()
    if (term.length < 2) return []
    if (useLocalSearch && catalogQuery.data) {
      const needle = foldAccents(term)
      return catalogQuery.data.items
        .filter(
          (sp) =>
            foldAccents(sp.sku.toLowerCase()).includes(needle) ||
            foldAccents(sp.name.toLowerCase()).includes(needle),
        )
        .slice(0, 12)
    }
    return partSearchQuery.data?.items ?? []
  }, [useLocalSearch, catalogQuery.data, debouncedPartTerm, partSearchQuery.data])

  const partTermLower = debouncedPartTerm.trim().toLowerCase()
  const partTermSkuNorm = debouncedPartTerm.trim().toUpperCase()
  const partExactCandidate = useMemo(
    () =>
      partSuggestions.find(
        (s) => s.sku.toUpperCase() === partTermSkuNorm || s.name.toLowerCase() === partTermLower,
      ) ?? null,
    [partSuggestions, partTermLower, partTermSkuNorm],
  )
  const canCreateSparePart = can('repuestos:create')

  /**
   * Tras dar de alta un repuesto, el catálogo en memoria quedaría desactualizado (y con la caché
   * de 3 horas el buscador no lo encontraría). Acá:
   *  1) se inserta en la caché para que aparezca al instante, y
   *  2) se invalida para que el próximo refresque traiga el catálogo completo del servidor.
   */
  const rememberCreatedPart = useCallback(
    (part: SparePart) => {
      queryClient.setQueryData<{ items: SparePart[]; total: number }>(
        queryKeys.spareParts.catalog(),
        (prev) => {
          if (!prev) return prev
          if (prev.items.some((p) => p.id === part.id || p.sku === part.sku)) return prev
          const items = [...prev.items, part].sort((a, b) => a.name.localeCompare(b.name, 'es'))
          return { items, total: Math.max(prev.total, items.length) }
        },
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.spareParts.root })
    },
    [queryClient],
  )

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

      /**
       * Alta optimista: la línea se pinta de inmediato con lo que devolvió el POST y el renglón
       * queda editable al instante. La reconciliación (subtotales y totales que calcula el
       * servidor) se dispara en segundo plano, sin bloquear la escritura del usuario.
       */
      if (created?.id) {
        setWo((prev) => (prev ? { ...prev, lines: [...prev.lines, created] } : prev))
      }
      void refreshLinesOnWorkOrder().catch(() => {
        void load()
      })
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
    // Si se acaba de abrir el editor de una fila, no robamos el foco: moverlo al buscador
    // dispararía el blur de la fila y la guardaría/cerraría al instante.
    if (!justOpenedEditorRef.current) partDescInputRef.current?.focus()
    justOpenedEditorRef.current = false
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
      rememberCreatedPart(created)
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
      const created = (await postLine.mutateAsync({
        lineType: 'LABOR',
        description,
        quantity: '1',
      })) as WorkOrderLine
      // Igual que con repuestos: pintar la línea ya y reconciliar en segundo plano.
      if (created?.id) {
        setWo((prev) => (prev ? { ...prev, lines: [...prev.lines, created] } : prev))
      }
      void refreshLinesOnWorkOrder().catch(() => {
        void load()
      })
      setLaborDesc('')
      laborDescInputRef.current?.focus()
      setMsg('Trabajo agregado (cantidad 1; editá precio/IVA en la línea)')
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al agregar trabajo')
      }
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
        can('work_orders:view_financials') ||
        can('work_order_lines:set_unit_price') ||
        can('work_orders:record_payment')
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
    justOpenedEditorRef.current = true
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
      /**
       * Sin aviso de "línea actualizada": al editar varias líneas seguidas ese mensaje sólo
       * ensucia la pantalla (el cambio ya se ve en la tabla). Sí mantenemos el aviso cuando la
       * línea queda sin valor unitario, porque eso impide cobrar la orden.
       */
      setMsg(
        canViewWoFinancials && !up
          ? 'Línea guardada sin valor unitario: la orden no se podrá cobrar hasta que lo cargues.'
          : null,
      )
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al guardar')
      }
    }
  }


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
  return (
      <section className={sectionClassName}>
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
                        {partSearchQuery.isFetching || (catalogQuery.isPending && !catalogIsComplete) ? (
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
  )
}
