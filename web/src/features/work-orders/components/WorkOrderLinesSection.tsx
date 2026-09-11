import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useConfirm } from '../../../components/confirm/ConfirmProvider'
import {
  API_MONEY_DECIMAL_REGEX,
  formatCopFromString,
  normalizeMoneyDecimalStringForApi,
} from '../../../utils/copFormat'
import type { WorkOrderDetail, WorkOrderLine } from '../../../api/types'
import { lineMoney, linesSubtotalFromLines, projectLineEdit } from '../services/workOrderLinesPresentation'
import { useWorkOrderDetailMutations } from '../hooks/useWorkOrderDetailMutations'
import { useApplyLinesSnapshot } from '../hooks/useApplyLinesSnapshot'

type TaxRateCatalogRow = { id: string; name: string; kind: string }

export type WorkOrderLinesSectionProps = {
  workOrder: WorkOrderDetail
  workOrderId: string | undefined
  setWorkOrder: Dispatch<SetStateAction<WorkOrderDetail | null>>
  can: (code: string) => boolean
  canUpdateLine: boolean
  canDeleteLine: boolean
  canViewWoFinancials: boolean
  canViewWoCosts: boolean
  closed: boolean
  taxRatesCatalog: TaxRateCatalogRow[]
  sectionClassName: string
  setMsg: (m: string | null) => void
  onBlockingError: (e: unknown) => Promise<boolean>
  /** Pedido del panel de alta para abrir la fila recién agregada en edición. */
  ref?: Ref<WorkOrderLinesHandle>
}

export type WorkOrderLinesHandle = {
  openLineEditor: (ln: WorkOrderLine) => void
}

/**
 * Sección de líneas de la OT: tabla con descuento y precio proveedor, y edición en la fila.
 * El alta de líneas (repuestos y mano de obra) vive en `WorkOrderLineAddPanel`, junto al banner.
 */
export function WorkOrderLinesSection({
  workOrder: wo,
  workOrderId: id,
  setWorkOrder: setWo,
  can,
  canUpdateLine,
  canDeleteLine,
  canViewWoFinancials,
  canViewWoCosts,
  closed,
  taxRatesCatalog,
  sectionClassName,
  setMsg,
  onBlockingError,
  ref,
}: WorkOrderLinesSectionProps) {
  const confirm = useConfirm()
  const { patchLine, deleteLine } = useWorkOrderDetailMutations(id)
  const applySnapshot = useApplyLinesSnapshot(id, setWo)
  const showBlockingConflictModal = onBlockingError

  const [editLine, setEditLine] = useState<WorkOrderLine | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDiscount, setEditDiscount] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editTaxRateId, setEditTaxRateId] = useState<string>('')
  /** Fila recién agregada/duplicada a la que se le enfoca un campo (`seq` fuerza el foco aun si se repite). */
  const [autoEditFocus, setAutoEditFocus] = useState<{ id: string; seq: number } | null>(null)
  const lineFocusRef = useRef<HTMLInputElement | null>(null)

  const startEdit = useCallback((ln: WorkOrderLine) => {
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
  }, [])

  /** Repuesto recién agregado desde el panel de alta: la fila queda abierta para cargar cantidad/valor/descuento. */
  const openLineEditor = useCallback(
    (ln: WorkOrderLine) => {
      startEdit(ln)
      setAutoEditFocus((prev) => ({ id: ln.id, seq: (prev?.seq ?? 0) + 1 }))
    },
    [startEdit],
  )

  /**
   * Enfoca el campo de la fila recién abierta sin desplazar la página: sin `preventScroll` el
   * navegador scrollea hasta el input y la tabla «salta» al agregar o repetir un repuesto.
   */
  useEffect(() => {
    if (!autoEditFocus) return
    lineFocusRef.current?.focus({ preventScroll: true })
  }, [autoEditFocus])

  /** El panel de alta abre la fila recién agregada en edición llamando este método (React 19: ref como prop). */
  useImperativeHandle(ref, () => ({ openLineEditor }), [openLineEditor])

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
    try {
      // El DELETE devuelve el estado completo (tabla + totales): una sola llamada, sin GET.
      const res = await deleteLine.mutateAsync({ lineId })
      applySnapshot(res)
    } catch (e) {
      if (!(await showBlockingConflictModal(e))) {
        setMsg(e instanceof Error ? e.message : 'Error al eliminar')
      }
      return
    }
    setEditLine((el) => (el?.id === lineId ? null : el))
    // Sin aviso: la fila ya desaparece de la tabla.
  }

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

      const prevLines = wo.lines
      const maySeeSubtotal =
        can('work_orders:view_financials') ||
        can('work_order_lines:set_unit_price') ||
        can('work_orders:record_payment')
      const projected = projectLineEdit(editLine, {
        quantity: qty,
        description: editDesc.trim(),
        unitPrice: canViewWoFinancials ? up || null : editLine.unitPrice,
        discountAmount: canViewWoFinancials ? disc || null : editLine.discountAmount,
        costSnapshot: canViewWoCosts ? cost || null : editLine.costSnapshot,
        taxRateId: taxRatePatch,
      })
      // Optimista: pinta la línea con lo que se está guardando mientras responde el server.
      setWo((prev) => {
        if (!prev) return prev
        const lines = prev.lines.map((l) => (l.id === editLine.id ? projected : l))
        return { ...prev, lines, linesSubtotal: maySeeSubtotal ? linesSubtotalFromLines(lines) : null }
      })
      try {
        const res = await patchLine.mutateAsync({
          lineId: editLine.id,
          body,
        })
        // Reconciliación en una sola llamada: el PATCH devuelve tabla + totales + saldo (sin GET).
        applySnapshot(res)
        setEditLine((cur) => (cur?.id === editingId ? null : cur))
        setAutoEditFocus((cur) => (cur?.id === editingId ? null : cur))
      } catch (e) {
        // Revertir la proyección optimista dejando los totales previos del servidor.
        setWo((prev) =>
          prev
            ? {
                ...prev,
                lines: prevLines,
                linesSubtotal: maySeeSubtotal ? linesSubtotalFromLines(prevLines) : null,
              }
            : prev,
        )
        if (!(await showBlockingConflictModal(e))) {
          setMsg(e instanceof Error ? e.message : 'Error al guardar')
        }
      }
      /**
       * Sin avisos al guardar: el cambio ya se ve en la tabla y los mensajes sólo ensucian la
       * pantalla cuando se editan varias líneas seguidas.
       */
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
        <div className="va-table-scroll">
          <table
            className={`va-table ${lineTableColSpan >= 7 ? 'min-w-[760px]' : 'min-w-[480px]'}`}
          >
            <thead>
              <tr className="va-table-head-row">
                <th className="va-table-th w-40">Tipo</th>
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
                  className={`va-table-body-row ${!editing && canUpdateLine && !closed ? 'cursor-pointer' : ''}`}
                  onClick={(e) => {
                    if (editing || !canUpdateLine || closed) return
                    // Los botones (editar/eliminar) y los campos ya vivos no abren la edición por clic.
                    const target = e.target as HTMLElement
                    if (target.closest('button, a, input, select')) return
                    startEdit(ln)
                    setAutoEditFocus((prev) => ({ id: ln.id, seq: (prev?.seq ?? 0) + 1 }))
                  }}
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
                          ? 'whitespace-nowrap rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-50'
                          : 'whitespace-nowrap rounded-md bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900 dark:text-teal-50'
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
