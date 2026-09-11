import { Fragment, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../api/client'
import { queryKeys } from '../../../lib/queryKeys'
import { useAlert } from '../../../components/confirm/ConfirmProvider'
import { formatCopFromString, normalizeMoneyDecimalStringForApi } from '../../../utils/copFormat'
import type { SparePart, WorkOrderDetail, WorkOrderLine } from '../../../api/types'
import { useWorkOrderDetailMutations } from '../hooks/useWorkOrderDetailMutations'
import { useApplyLinesSnapshot } from '../hooks/useApplyLinesSnapshot'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

/**
 * Minúsculas sin tildes: que «aceite» encuentre «ACEITE» y «aceité» por igual.
 * El rango es el de marcas diacríticas combinantes (U+0300–U+036F).
 */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export type WorkOrderLineAddPanelProps = {
  workOrder: WorkOrderDetail
  workOrderId: string | undefined
  setWorkOrder: Dispatch<SetStateAction<WorkOrderDetail | null>>
  canCreateSparePart: boolean
  setMsg: (m: string | null) => void
  onBlockingError: (e: unknown) => Promise<boolean>
  /** Línea recién agregada/duplicada: la fila de la tabla queda editable (la tabla la enfoca al recibir el pedido). */
  onRequestOpenLine: (line: WorkOrderLine) => void
  /** Abre las sugerencias hacia arriba (barra fija inferior móvil). */
  dropdownUp?: boolean
}

/**
 * Panel de alta de líneas de la OT: busca repuestos en el catálogo (o texto libre) y los agrega con
 * Enter; el botón “+ Mano de obra” re-agrega la línea LABOR por defecto, útil si se borró la que nació
 * al crear la orden. La mano de obra y los repuestos se ajustan después directo en la tabla. Al agregar
 * un repuesto, la fila nueva se abre en edición abajo.
 */
export function WorkOrderLineAddPanel({
  workOrder: wo,
  workOrderId: id,
  setWorkOrder: setWo,
  canCreateSparePart,
  setMsg,
  onBlockingError,
  onRequestOpenLine,
  dropdownUp = false,
}: WorkOrderLineAddPanelProps) {
  const blockingAlert = useAlert()
  const queryClient = useQueryClient()
  const { postLine } = useWorkOrderDetailMutations(id)
  const applySnapshot = useApplyLinesSnapshot(id, setWo)
  const [partDesc, setPartDesc] = useState('')
  const partDescInputRef = useRef<HTMLInputElement | null>(null)
  /**
   * Bloqueo de alta en vuelo: un solo Enter agrega la línea. Sin esto, mantener el Enter
   * presionado (repetición de tecla) o apretarlo dos veces en ráfaga dispara dos POST y
   * quedan repuestos duplicados de la misma descripción.
   */
  const partAddPendingRef = useRef(false)
  /** Misma guarda para el botón de mano de obra: un clic = una línea LABOR. */
  const laborAddPendingRef = useRef(false)
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

  /**
   * Tras dar de alta un repuesto, el catálogo en memoria quedaría desactualizado (y con la caché
   * de 3 horas el buscador no lo encontraría). Acá:
   *  1) se inserta en la caché para que aparezca al instante, y
   *  2) se invalida para que el próximo refresque traiga el catálogo completo del servidor.
   */
  const rememberCreatedPart = (
    part: SparePart,
  ) => {
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
  }

  async function addPartLine(opts: {
    description: string
    sku?: string | null
    unitPrice?: string
    quantity?: string
    discountAmount?: string
    costSnapshot?: string
  }): Promise<false | 'added' | 'duplicate'> {
    if (!id) return false
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
        onRequestOpenLine(existingLine)
        return 'duplicate'
      }
      const payload: Record<string, unknown> = {
        lineType: 'PART',
        description: opts.description.trim(),
        quantity: '1',
      }
      if (targetSku) payload.sparePartSku = targetSku
      if (opts.unitPrice) payload.unitPrice = opts.unitPrice
      // El POST devuelve el estado completo (tabla + totales) en una sola llamada; sin GET de refresco.
      const res = await postLine.mutateAsync(payload)
      applySnapshot(res)
      const created = res.lines.find((ln) => ln.id === res.addedLineId) ?? null
      // La línea nueva se pinta al instante y la tabla la deja en edición (para ajustar cantidad/valor).
      if (created?.id) onRequestOpenLine(created)
      return 'added'
    } catch (e) {
      if (!(await onBlockingError(e))) {
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
  }

  async function selectPart(sp: SparePart) {
    if (partAddPendingRef.current) return
    partAddPendingRef.current = true
    try {
      const result = await addPartLine({
        description: sp.name,
        sku: sp.sku,
        unitPrice: Number(sp.price) > 0 ? normalizeMoneyDecimalStringForApi(String(sp.price)) : undefined,
      })
      if (result === false) return
      // Sin aviso: la línea nueva ya aparece en la tabla.
      resetPartAdd()
    } finally {
      partAddPendingRef.current = false
    }
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
    if (partAddPendingRef.current) return
    partAddPendingRef.current = true
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
      // Sin aviso: el repuesto ya queda en el catálogo y la línea aparece en la tabla.
      resetPartAdd()
    } catch (e) {
      if (!(await onBlockingError(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al crear el repuesto')
      }
    } finally {
      partAddPendingRef.current = false
    }
  }

  /** Alta de mano de obra: un clic agrega la línea "MANO DE OBRA" (sin abrir edición ni avisos). */
  async function addLaborLine() {
    if (!id) return
    if (laborAddPendingRef.current) return
    laborAddPendingRef.current = true
    setMsg(null)
    try {
      // El POST devuelve el snapshot completo (tabla + totales) en una sola llamada; sin GET.
      const res = await postLine.mutateAsync({
        lineType: 'LABOR',
        description: 'MANO DE OBRA',
        quantity: '1',
      })
      applySnapshot(res)
    } catch (e) {
      if (!(await onBlockingError(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al agregar mano de obra')
      }
    } finally {
      laborAddPendingRef.current = false
    }
  }

  return (
    <div className="flex items-end gap-3">
      <label className="block min-w-0 flex-1 text-sm">
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
            className="va-field va-field--dark-input"
            placeholder="ej. ACEITE-15W40 o filtro de aceite · Enter agrega"
          />
          {partComboOpen && debouncedPartTerm.trim().length >= 2 ? (
            <div
              id="wo-parts-listbox"
              role="listbox"
              aria-label="Sugerencias del catálogo de repuestos"
              className={`absolute left-0 right-0 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
                dropdownUp ? 'bottom-full z-50 mb-2' : 'z-30'
              }`}
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
      <button
        type="button"
        onClick={() => void addLaborLine()}
        className="mb-px inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-800 dark:bg-slate-800 dark:text-teal-300 dark:hover:bg-slate-700"
      >
        <span className="text-base leading-none">+</span> Mano de obra
      </button>
    </div>
  )
}