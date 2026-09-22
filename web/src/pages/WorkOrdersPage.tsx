import { useCallback, useMemo, type MouseEvent } from 'react'
import { PostCreateConsentModal } from '../components/work-order/PostCreateConsentModal'
import { QuickCreateCustomerSection } from '../features/work-orders/components/QuickCreateCustomerSection'
import { VehiclePlateAutocomplete } from '../features/work-orders/components/VehiclePlateAutocomplete'
import { WorkOrdersList } from '../features/work-orders/components/WorkOrdersList'
import { searchVehiclesForWorkOrder } from '../features/work-orders/services/workOrdersListApi'
import type { WorkOrdersVehicleHit } from '../features/work-orders/types'
import {
  WorkOrdersToolbar,
  type WoPageSize,
} from '../features/work-orders/components/WorkOrdersToolbar'
import { useWorkOrdersPageModel } from '../features/work-orders/hooks/useWorkOrdersPageModel'

export function WorkOrdersPage() {
  const m = useWorkOrdersPageModel()
  const {
    setPage,
    setPageSize,
    setCreateMsg,
    clearListFilters: clearListFiltersAction,
    can,
    setCreateOpen,
    resetCreateWarrantyState,
    resetQuickCreate,
    vehiclePlate,
    setVehicleId,
    setVehiclePlate,
    setCustomerName,
    setCustomerPhone,
    setQuickName,
    setQuickPhone,
    setQuickPlate,
    setQuickBrand,
  } = m

  const createMsgClass = useMemo(
    () =>
      m.isSaas
        ? 'flex flex-col gap-2 rounded-xl border border-slate-200 bg-[var(--va-surface-elevated)] px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:flex-row sm:items-center sm:justify-between'
        : 'flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:flex-row sm:items-center sm:justify-between',
    [m.isSaas],
  )
  const activeFiltersClass = useMemo(
    () =>
      m.isSaas
        ? 'flex flex-col gap-2 rounded-xl border border-brand-200 bg-[var(--va-accent-soft)] px-4 py-3 text-sm text-slate-800 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-brand-700 dark:bg-brand-950 dark:text-brand-50'
        : 'flex flex-col gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-800 sm:flex-row sm:items-center sm:justify-between dark:border-brand-700 dark:bg-brand-950 dark:text-brand-50',
    [m.isSaas],
  )
  const clearFiltersBtnClass = useMemo(
    () =>
      m.isSaas
        ? 'inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:min-h-0 sm:py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        : 'inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:min-h-0 sm:py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
    [m.isSaas],
  )

  const handlePageSizeChange = useCallback(
    (n: WoPageSize) => {
      setPageSize(n)
      setPage(1)
    },
    [setPage, setPageSize],
  )

  const dismissCreateMsg = useCallback(() => {
    setCreateMsg(null)
  }, [setCreateMsg])

  const clearListFilters = useCallback(() => {
    clearListFiltersAction()
  }, [clearListFiltersAction])

  const canCreateWorkOrder = useMemo(() => can('work_orders:create'), [can])

  const handleModalPanelClick = useCallback((ev: MouseEvent) => {
    ev.stopPropagation()
  }, [])

  const handleCancelCreate = useCallback(() => {
    setCreateOpen(false)
    resetCreateWarrantyState()
    resetQuickCreate()
  }, [resetCreateWarrantyState, resetQuickCreate, setCreateOpen])

  const vehicleSearch = useCallback((q: string) => searchVehiclesForWorkOrder(q), [])

  const handlePickVehicle = useCallback(
    (v: WorkOrdersVehicleHit) => {
      setVehicleId(v.id)
      setVehiclePlate(v.plate)
      setCustomerName(v.customer.displayName)
      setCustomerPhone(v.customer.primaryPhone ?? '')
    },
    [setCustomerName, setCustomerPhone, setVehicleId, setVehiclePlate],
  )

  /** El usuario editó el campo de vehículo sin elegir: la selección previa queda inválida. */
  const handleVehicleTyping = useCallback(() => {
    setVehicleId('')
    setCustomerName('')
    setCustomerPhone('')
  }, [setCustomerName, setCustomerPhone, setVehicleId])

  return (
    <div className="space-y-6">
      <WorkOrdersToolbar
        createMsgClass={createMsgClass}
        activeFiltersClass={activeFiltersClass}
        clearFiltersBtnClass={clearFiltersBtnClass}
        err={m.err}
        createMsg={m.createMsg}
        createOpen={m.createOpen}
        onDismissCreateMsg={dismissCreateMsg}
        statusFilter={m.statusFilter}
        vehicleIdFilter={m.vehicleIdFilter}
        customerIdFilter={m.customerIdFilter}
        textSearch={m.textSearch}
        vehiclePlateLabel={m.vehiclePlateLabel}
        deliveredFromIso={m.deliveredFromIso}
        deliveredToIso={m.deliveredToIso}
        onClearListFilters={clearListFilters}
        onSetStatus={m.setStatus}
        onSetTextSearch={m.setTextSearch}
        onSetDeliveredFrom={m.setDeliveredFrom}
        onSetDeliveredTo={m.setDeliveredTo}
        canCreateWorkOrder={canCreateWorkOrder}
        onOpenNewOrder={m.openNewOrderModal}
        showPagination={m.rows !== null}
        page={m.page}
        pageSize={m.pageSize}
        total={m.total}
        listBusy={m.listBusy}
        isSaas={m.isSaas}
        onPageChange={m.setPage}
        onPageSizeChange={handlePageSizeChange}
      />

      {!m.rows && !m.err && (
        <p
          className={`py-8 text-center text-slate-500 dark:text-slate-300 ${m.isSaas ? 'va-saas-page-section' : 'va-card'}`}
        >
          Cargando…
        </p>
      )}

      {m.rows && m.rows.length === 0 && (
        <p
          className={`py-8 text-center text-slate-500 dark:text-slate-300 ${m.isSaas ? 'va-saas-page-section' : 'va-card'}`}
        >
          {m.hasActiveFetchFilters
            ? 'Ninguna orden coincide con los filtros.'
            : 'No hay órdenes recientes.'}
        </p>
      )}

      {m.createOpen && (
        <div className="va-modal-overlay" role="presentation">
          <div
            className="va-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wo-create-title"
            onClick={handleModalPanelClick}
          >
            <h2
              id="wo-create-title"
              className={
                m.isSaas ? 'va-section-title text-base' : 'text-lg font-semibold text-slate-900 dark:text-slate-50'
              }
            >
              {m.warrantyParentId ? 'Nueva orden de garantía' : 'Nueva orden de trabajo'}
            </h2>
            {m.warrantyParentId ? (
              <div className="mt-2 space-y-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
                <p>
                  Se vinculará como <strong>garantía o seguimiento</strong> a la orden origen{' '}
                  {m.warrantyParentOrderNumber != null ? (
                    <>
                      <strong>#{m.warrantyParentOrderNumber}</strong>{' '}
                    </>
                  ) : null}
                  (debe estar <strong>entregada</strong>). El vehículo por defecto es el de esa orden; si el titular
                  tiene más unidades en el maestro, podés cambiarla abajo.
                </p>
                {m.warrantyVehicleLoading ? (
                  <p className="text-violet-800 dark:text-violet-200">Cargando vehículo de la orden origen…</p>
                ) : null}
                {m.warrantyVehicleError ? (
                  <p className="font-medium text-red-700 dark:text-red-300">{m.warrantyVehicleError}</p>
                ) : null}
              </div>
            ) : null}
            {m.createMsg && <p className="va-alert-error mt-2">{m.createMsg}</p>}
            <form className="mt-4 space-y-3" onSubmit={m.submitCreate}>
              <label className="block text-sm">
                <span className="va-label">Descripción del trabajo</span>
                <textarea
                  required
                  minLength={3}
                  value={m.desc}
                  onChange={(e) => m.setDesc(e.target.value)}
                  rows={3}
                  className="va-field mt-1"
                />
              </label>
              <label className="block text-sm">
                <span className="va-label">
                  Vehículo{' '}
                  {!m.warrantyParentId ? <span className="text-red-600 dark:text-red-400">(obligatorio)</span> : null}
                </span>
                {m.warrantyParentId && m.warrantyVehicleOptions.length > 1 ? (
                  <>
                    <select
                      value={m.vehicleId}
                      onChange={(e) => {
                        const opt = m.warrantyVehicleOptions.find((o) => o.id === e.target.value)
                        if (!opt) return
                        m.setVehicleId(opt.id)
                        m.setVehiclePlate(opt.plate)
                      }}
                      className="va-field mt-1 w-full"
                    >
                      {m.warrantyVehicleOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.plate}
                          {(o.brand || o.model) ? ` · ${[o.brand, o.model].filter(Boolean).join(' ')}` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                      Por defecto: el mismo vehículo de la orden en garantía. Cambiá solo si el seguimiento corresponde
                      a otra unidad del mismo titular.
                    </p>
                  </>
                ) : m.warrantyParentId &&
                  m.vehicleId &&
                  !m.warrantyVehicleLoading &&
                  m.warrantyVehicleOptions.length <= 1 ? (
                  <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <span className="font-mono font-medium">{m.vehiclePlate}</span>
                    {m.warrantyVehicleOptions[0] &&
                    (m.warrantyVehicleOptions[0].brand || m.warrantyVehicleOptions[0].model) ? (
                      <span className="ml-2 text-slate-600 dark:text-slate-300">
                        {[m.warrantyVehicleOptions[0].brand, m.warrantyVehicleOptions[0].model].filter(Boolean).join(' ')}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-1 flex gap-2">
                    {m.can('vehicles:read') ? (
                      <VehiclePlateAutocomplete
                        selectedPlate={vehiclePlate}
                        onPick={handlePickVehicle}
                        onTyping={handleVehicleTyping}
                        search={vehicleSearch}
                      />
                    ) : (
                      <input
                        readOnly
                        value={vehiclePlate}
                        placeholder="No tenés permiso para buscar vehículos"
                        className="va-field min-w-0 flex-1 font-mono text-sm"
                      />
                    )}
                  </div>
                )}
                {m.customerName.trim() || m.customerPhone.trim() ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                    Titular: {m.customerName.trim()}
                    {m.customerPhone.trim() ? ` · ${m.customerPhone.trim()}` : ''}
                  </p>
                ) : null}
                {m.warrantyParentId && !m.warrantyVehicleLoading && !m.vehicleId && m.warrantyParentMissingVehicle ? (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                    La orden origen no tiene vehículo en el maestro. Escribí su placa arriba para vincular uno antes de
                    crear la garantía.
                  </p>
                ) : null}
                {m.warrantyParentId && !m.warrantyVehicleLoading && !m.vehicleId && !m.warrantyParentMissingVehicle && !m.can('work_orders:read') && !m.can('work_orders:read_portal') ? (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    No tenés permiso para leer la orden origen: elegí el vehículo del maestro escribiendo su placa.
                  </p>
                ) : null}
              </label>
              {m.can('customers:create') && m.can('vehicles:create') ? (
                <QuickCreateCustomerSection
                  isSaas={m.isSaas}
                  busy={m.quickBusy}
                  msg={m.quickMsg}
                  name={m.quickName}
                  phone={m.quickPhone}
                  plate={m.quickPlate}
                  brand={m.quickBrand}
                  onNameChange={setQuickName}
                  onPhoneChange={setQuickPhone}
                  onPlateChange={setQuickPlate}
                  onBrandChange={setQuickBrand}
                  onSubmit={m.quickCreate}
                />
              ) : null}
              <div className="flex gap-2 pt-2">
                <button type="submit" className="va-btn-primary">
                  Crear y abrir
                </button>
                <button type="button" onClick={handleCancelCreate} className="va-btn-secondary">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {m.postCreateConsent && (
        <PostCreateConsentModal
          workOrderId={m.postCreateConsent.id}
          orderNumber={m.postCreateConsent.orderNumber}
          publicCode={m.postCreateConsent.publicCode}
          canRecordConsent={m.can('work_orders:update')}
          canCancelFreshOrder={m.can('work_orders:set_terminal_status')}
          onSigned={m.handlePostCreateSigned}
          onAbandon={m.handlePostCreateAbandon}
        />
      )}

      <WorkOrdersList
        rows={m.rows}
        onPrefetchWorkOrder={m.prefetchWorkOrderDetail}
      />
    </div>
  )
}
