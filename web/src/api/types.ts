/** Tipos mínimos alineados con el API Nest (fase 5). */

export type WorkOrderStatus =
  | 'UNASSIGNED'
  | 'RECEIVED'
  | 'IN_WORKSHOP'
  | 'WAITING_PARTS'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED'

/** `POST /work-orders/public/lookup` — respuesta sin datos económicos ni IDs internos. */
export type PublicWorkOrderLookupResponse = {
  publicCode: string
  status: WorkOrderStatus
  orderNumber: number
  description: string
  createdAt: string
  deliveredAt: string | null
  cancelledAt: string | null
  customerName: string | null
  vehiclePlate: string | null
  vehicleBrand: string | null
  vehicleModel: string | null
}

export type WorkOrderLineType = 'PART' | 'LABOR'

/** Familia del impuesto (Fase 6). IVA estándar, INC reservado. */
export type TaxRateKind = 'VAT' | 'INC'

export type TaxRate = {
  id: string
  slug: string
  name: string
  kind: TaxRateKind
  /** Porcentaje serializado como string desde la API (Decimal 5,2). */
  ratePercent: string
  isActive: boolean
  isDefault: boolean
  sortOrder: number
}

/** Repuesto del catálogo maestro (`GET /spare-parts`). Stock ilimitado: no se valida ni descuenta. */
export type SparePart = {
  id: string
  /** SKU normalizado (MAYÚSCULAS alfanumérico), único en el catálogo. */
  sku: string
  /** Descripción/nombre del repuesto. */
  name: string
  /** Precio de venta COP entero. `0` = precio variable (se carga en la OT al momento). */
  price: string
  createdAt: string
  updatedAt: string
}

/** Totales calculados para una línea (Fase 2). `null` si el perfil no puede verlos. */
export type WorkOrderLineTotals = {
  lineId: string
  grossAmount: string
  discountAmount: string
  taxableBase: string
  taxPercent: string
  taxAmount: string
  taxKind: TaxRateKind | null
  lineTotal: string
  /** Solo visible con `reports:read` y si la línea tiene costo snapshotado. */
  lineCost: string | null
  lineProfit: string | null
}

export type WorkOrderLine = {
  id: string
  lineType: WorkOrderLineType
  sortOrder: number
  /** Tarifa de impuesto aplicada (puede ser null en líneas legadas). */
  taxRateId?: string | null
  taxRate?: { id: string; slug: string; name: string; kind: TaxRateKind; ratePercent: string } | null
  /** Porcentaje congelado al guardar la línea (decimal 5,2 como string). */
  taxRatePercentSnapshot?: string | null
  /** SKU del catálogo de repuestos asociado (snapshot; null = línea en texto libre). */
  sparePartSku?: string | null
  description: string | null
  quantity: string
  unitPrice: string | null
  /** Descuento COP entero (string). null = sin descuento. */
  discountAmount?: string | null
  /** Copia del costo medio al momento de crear la línea PART (margen histórico). */
  costSnapshot?: string | null
  /** Totales calculados por el backend. `null` si el perfil no puede ver importes. */
  totals?: WorkOrderLineTotals | null
}

/** Totales agregados de la OT (Fase 2). `null` si el perfil no puede ver importes. */
export type WorkOrderTotals = {
  lineCount: number
  /** Suma de brutos antes de descuentos e impuestos. */
  linesSubtotal: string
  totalDiscount: string
  taxableBase: string
  totalTax: string
  taxVatAmount: string
  taxIncAmount: string
  grandTotal: string
  /** Solo con `reports:read`; `null` si la OT tiene líneas PART sin costo snapshot. */
  totalCost: string | null
  totalProfit: string | null
}

export type WorkOrderParentBrief = {
  id: string
  orderNumber: number
  /** Código para comprobante / cliente (ej. VEN-0001). */
  publicCode: string
  status: WorkOrderStatus
}

export type WorkOrderSummary = {
  id: string
  orderNumber: number
  /** Código para comprobante / seguimiento con patente (ej. VEN-0001). */
  publicCode: string
  status: WorkOrderStatus
  description: string
  customerName: string | null
  customerPhone?: string | null
  /** Correo en la OT (p. ej. facturación). */
  customerEmail?: string | null
  vehiclePlate: string | null
  /** Marca al ingreso (texto en la OT; si hay vehículo enlazado puede coincidir con el maestro). */
  vehicleBrand?: string | null
  /** Modelo al ingreso (instantánea en la OT). */
  vehicleModel?: string | null
  /** Línea del vehículo (p. ej. licencia / OCR). */
  vehicleLine?: string | null
  vehicleCylinderCc?: string | null
  vehicleColor?: string | null
  /** Odómetro al ingreso (instantánea). */
  intakeOdometerKm?: number | null
  createdAt: string
  deliveredAt: string | null
  cancelledAt: string | null
  /** Legado: el API devuelve siempre `null` (ya no hay tope de cobro en OT). */
  authorizedAmount?: string | null
  assignedTo?: { id: string; fullName: string; email: string } | null
  /** Presente si esta OT es una garantía o seguimiento vinculado a otra ya entregada. */
  parentWorkOrder?: WorkOrderParentBrief | null
  /** Presente en listados y en GET detalle; `customer` viene en el detalle cuando hay vehículo enlazado. */
  vehicle?: {
    id: string
    plate: string
    brand: string | null
    model: string | null
    customer?: {
      id: string
      displayName: string
      primaryPhone: string | null
      email?: string | null
      documentId?: string | null
    }
  } | null
}

/** Respuesta de GET `/work-orders` con paginación. */
export type WorkOrderListResponse = {
  items: WorkOrderSummary[]
  total: number
}

export type WorkOrderDetail = WorkOrderSummary & {
  lines: WorkOrderLine[]
  /** `null` si el perfil no puede ver importes (p. ej. técnico). */
  linesSubtotal: string | null
  /** Saldo pendiente: total de líneas (IVA/descuentos) menos cobrado. */
  amountDue: string | null
  /** Desglose completo (subtotal/IVA/INC/descuento/total/costo/utilidad). `null` = perfil sin visibilidad. */
  totals: WorkOrderTotals | null
  authorizedAmount?: string | null
  /** ISO; firma de consentimiento ya guardada */
  clientConsentSignedAt?: string | null
  clientConsentTextSnapshot?: string | null
  /** PNG en base64 (sin prefijo `data:`) */
  clientSignaturePngBase64?: string | null
  paymentSummary: {
    paymentCount: number
    totalPaid: string | null
    remaining: string | null
  }
  parentWorkOrder?: WorkOrderParentBrief | null
  /** OT hijas de garantía / seguimiento (más recientes primero). */
  warrantyFollowUps?: WorkOrderParentBrief[]
  warrantyFollowUpCount?: number
}

/** Cotización / presupuesto (sin consumo de inventario). */

/** Respuesta de PATCH `/work-orders/:id` (fila actualizada; sin líneas ni paymentSummary del GET detalle). */
export type WorkOrderPatchResult = {
  status: WorkOrderStatus
  description: string
  assignedTo: { id: string; fullName: string; email: string } | null
}

export type AuthUser = {
  id: string
  email: string
  fullName: string
  permissions: string[]
  /** Slugs de roles asignados en BD (no cambian con la vista por rol). */
  roleSlugs?: string[]
  /** Sesión «ver como otro rol» (solo administrador/dueño). */
  previewRole?: { id: string; slug: string; name: string }
  /** Cliente del taller enlazado (rol portal). */
  portalCustomerId?: string | null
}

export type LoginResponse = {
  accessToken: string
  tokenType: 'Bearer'
  user: AuthUser
}

/** Fila de GET `/permissions` (catálogo para roles). */
export type PermissionRow = {
  id: string
  resource: string
  action: string
  description: string | null
}

/** ---------- Fase 4 · Factura electrónica DIAN (preparación) ---------- */

export type FiscalResolutionKind = 'ELECTRONIC_INVOICE' | 'POS' | 'CONTINGENCY'
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'VOIDED'
export type InvoiceSource = 'SALE' | 'WORK_ORDER'
export type InvoiceLineType = 'PART' | 'LABOR'
export type InvoiceDispatchStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'ERROR'
  | 'NOT_CONFIGURED'
export type CreditNoteStatus = 'DRAFT' | 'ISSUED' | 'VOIDED'
export type CreditNoteReason = 'VOID' | 'ADJUSTMENT' | 'RETURN' | 'DISCOUNT'
export type DebitNoteStatus = 'DRAFT' | 'ISSUED' | 'VOIDED'
export type DebitNoteReason = 'PRICE_CORRECTION' | 'ADDITIONAL_CHARGE' | 'INTEREST' | 'OTHER'

export type FiscalResolution = {
  id: string
  kind: FiscalResolutionKind
  resolutionNumber: string
  prefix: string
  rangeFrom: number
  rangeTo: number
  nextNumber: number
  consumedCount: number
  remainingCount: number
  exhausted: boolean
  validFrom: string | null
  validUntil: string | null
  technicalKey: string | null
  testSetId: string | null
  isActive: boolean
  isDefault: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; email: string; fullName: string } | null
}

export type CreateFiscalResolutionPayload = {
  kind: FiscalResolutionKind
  resolutionNumber: string
  prefix: string
  rangeFrom: number
  rangeTo: number
  nextNumber?: number
  validFrom?: string
  validUntil?: string
  technicalKey?: string
  testSetId?: string
  isDefault?: boolean
  notes?: string
}

export type UpdateFiscalResolutionPayload = Partial<CreateFiscalResolutionPayload> & {
  isActive?: boolean
}

export type InvoiceSummary = {
  id: string
  documentNumber: string
  invoiceNumber: number
  status: InvoiceStatus
  source: InvoiceSource
  saleId: string | null
  workOrderId: string | null
  customerName: string
  customerDocumentId: string | null
  grandTotal: string
  issuedAt: string | null
  voidedAt: string | null
  createdAt: string
  customer: { id: string; displayName: string } | null
  createdBy: { id: string; email: string; fullName: string }
  fiscalResolution: { id: string; kind: FiscalResolutionKind; prefix: string }
  _count: { dispatchEvents: number; creditNotes: number }
}

export type InvoiceListResponse = {
  page: number
  pageSize: number
  total: number
  items: InvoiceSummary[]
}

export type InvoiceLine = {
  id: string
  invoiceId: string
  lineType: InvoiceLineType
  sortOrder: number
  sourceSaleLineId: string | null
  sourceWorkOrderLineId: string | null
  taxRateId: string | null
  taxRate: { id: string; slug: string; name: string; kind: TaxRateKind; ratePercent: string } | null
  description: string | null
  quantity: string
  unitPrice: string
  discountAmount: string
  taxRatePercentSnapshot: string
  taxRateKindSnapshot: TaxRateKind | null
  lineTotal: string
  taxAmount: string
}

export type InvoiceDispatchEvent = {
  id: string
  attempt: number
  status: InvoiceDispatchStatus
  provider: string | null
  environment: string | null
  errorMessage: string | null
  externalId: string | null
  requestedAt: string
  completedAt: string | null
  requestedBy: { id: string; email: string; fullName: string } | null
}

export type InvoiceDetail = {
  id: string
  documentNumber: string
  invoiceNumber: number
  status: InvoiceStatus
  source: InvoiceSource
  saleId: string | null
  workOrderId: string | null
  customerId: string | null
  customerName: string
  customerDocumentId: string | null
  customerPhone: string | null
  customerEmail: string | null
  customer: { id: string; displayName: string; documentId: string | null } | null
  fiscalResolution: {
    id: string
    kind: FiscalResolutionKind
    prefix: string
    resolutionNumber: string
    rangeTo: number
    nextNumber: number
    validUntil: string | null
  } | null
  sale: { id: string; publicCode: string; saleNumber: number } | null
  workOrder: { id: string; publicCode: string; orderNumber: number } | null
  subtotal: string
  totalDiscount: string
  totalTax: string
  totalVat: string
  totalInc: string
  grandTotal: string
  cufe: string | null
  dianProvider: string | null
  dianEnvironment: string | null
  issuedAt: string | null
  voidedAt: string | null
  voidedReason: string | null
  internalNotes: string | null
  createdBy: { id: string; email: string; fullName: string }
  createdAt: string
  updatedAt: string
  lines: InvoiceLine[]
  dispatchEvents: InvoiceDispatchEvent[]
  creditNotes: Array<{
    id: string
    documentNumber: string
    status: CreditNoteStatus
    reason: CreditNoteReason
    grandTotal: string
    createdAt: string
    issuedAt: string | null
  }>
  debitNotes: Array<{
    id: string
    documentNumber: string
    status: DebitNoteStatus
    reason: DebitNoteReason
    grandTotal: string
    createdAt: string
    issuedAt: string | null
  }>
  payments: InvoicePayment[]
  amountPaid: string
  amountDue: string
  totalCreditNotes: string
  totalDebitNotes: string
  effectiveAmount: string
}

export type InvoicePaymentKind = 'PARTIAL' | 'FULL_SETTLEMENT'

export type InvoicePayment = {
  id: string
  amount: string
  kind: InvoicePaymentKind
  note: string | null
  createdAt: string
  recordedBy: { id: string; email: string; fullName: string } | null
  cashMovement: {
    id: string
    amount: string
    createdAt: string
    category: { id: string; slug: string; name: string } | null
  } | null
}

export type CreateInvoiceFromSalePayload = {
  fiscalResolutionId?: string
  internalNotes?: string
}

export type CreateInvoiceFromWorkOrderPayload = {
  fiscalResolutionId?: string
  internalNotes?: string
}

export type RecordInvoicePaymentPayload = {
  paymentKind: 'partial' | 'full'
  amount: string
  note: string
  categorySlug?: string
  tenderAmount?: string
}

export type VoidInvoicePayload = {
  reason: string
}

export type CreateCreditNotePayload = {
  reason: CreditNoteReason
  reasonDescription: string
  fiscalResolutionId?: string
}

export type CreditNoteLine = {
  id: string
  creditNoteId: string
  sourceInvoiceLineId: string | null
  lineType: InvoiceLineType
  sortOrder: number
  description: string
  quantity: string
  unitPrice: string
  discountAmount: string
  taxRatePercentSnapshot: string
  taxRateKindSnapshot: TaxRateKind | null
  lineTotal: string
  taxAmount: string
}

export type CreditNoteSummary = {
  id: string
  documentNumber: string
  creditNoteNumber: number
  status: CreditNoteStatus
  reason: CreditNoteReason
  grandTotal: string
  invoice: { id: string; documentNumber: string; customerName: string } | null
  fiscalResolution: { id: string; prefix: string; kind: FiscalResolutionKind } | null
  createdAt: string
  issuedAt: string | null
}

export type CreditNoteDetail = {
  id: string
  documentNumber: string
  creditNoteNumber: number
  status: CreditNoteStatus
  reason: CreditNoteReason
  reasonDescription: string
  subtotal: string
  totalDiscount: string
  totalTax: string
  grandTotal: string
  cufe: string | null
  dianProvider: string | null
  dianEnvironment: string | null
  issuedAt: string | null
  issuedBy: { id: string; email: string; fullName: string } | null
  voidedAt: string | null
  voidedReason: string | null
  voidedBy: { id: string; email: string; fullName: string } | null
  createdBy: { id: string; email: string; fullName: string }
  createdAt: string
  fiscalResolution: { id: string; kind: FiscalResolutionKind; prefix: string; resolutionNumber: string } | null
  invoice: { id: string; documentNumber: string; cufe: string | null; status: InvoiceStatus; customerName: string } | null
  lines: CreditNoteLine[]
}

export type VoidCreditNotePayload = {
  reason: string
}

export type CreateDebitNoteLinePayload = {
  lineType: InvoiceLineType
  sortOrder?: number
  description: string
  quantity: string
  unitPrice: string
  discountAmount?: string
  taxRatePercent?: string
  taxKind?: TaxRateKind
}

export type CreateDebitNotePayload = {
  reason: DebitNoteReason
  reasonDescription: string
  fiscalResolutionId?: string
  lines: CreateDebitNoteLinePayload[]
}

export type VoidDebitNotePayload = {
  reason: string
}

export type DebitNoteLine = {
  id: string
  debitNoteId: string
  lineType: InvoiceLineType
  sortOrder: number
  description: string
  quantity: string
  unitPrice: string
  discountAmount: string
  taxRatePercentSnapshot: string
  taxRateKindSnapshot: TaxRateKind | null
  lineTotal: string
  taxAmount: string
}

export type DebitNoteDetail = {
  id: string
  documentNumber: string
  debitNoteNumber: number
  status: DebitNoteStatus
  reason: DebitNoteReason
  reasonDescription: string
  subtotal: string
  totalDiscount: string
  totalTax: string
  grandTotal: string
  cufe: string | null
  dianProvider: string | null
  dianEnvironment: string | null
  issuedAt: string | null
  issuedBy: { id: string; email: string; fullName: string } | null
  voidedAt: string | null
  voidedReason: string | null
  voidedBy: { id: string; email: string; fullName: string } | null
  createdBy: { id: string; email: string; fullName: string }
  createdAt: string
  fiscalResolution: { id: string; kind: FiscalResolutionKind; prefix: string; resolutionNumber: string } | null
  invoice: { id: string; documentNumber: string; cufe: string | null; status: InvoiceStatus; customerName: string } | null
  lines: DebitNoteLine[]
}

/** Cuerpo de POST `/work-orders` (CreateWorkOrderDto). */
export type CreateWorkOrderPayload = {
  description: string
  customerName?: string
  customerPhone?: string
  vehiclePlate?: string
  vehicleBrand?: string
  vehicleLine?: string
  vehicleCylinderCc?: string
  vehicleColor?: string
  intakeOdometerKm?: number | null
  vehicleNotes?: string
  internalNotes?: string
  assignedToId?: string
  vehicleId?: string
  /** OT origen (debe estar entregada). Crea una orden de garantía vinculada. */
  parentWorkOrderId?: string
}

// ============================================================================
// Nómina técnica (Fase 9)
// ============================================================================

export type PayrollStatus = 'DRAFT' | 'PAID' | 'VOIDED'
export type PayrollAdjustmentKind = 'BONUS' | 'ADVANCE' | 'DEDUCTION' | 'OTHER'

export type PayrollRunEntry = {
  id: string
  workOrderId: string
  publicCode: string
  vehiclePlate: string | null
  vehicleBrand: string | null
  vehicleModel: string | null
  customerName: string | null
  deliveredAt: string
  /** Subtotal MO sin IVA (base de la comisión). `null` si el actor solo tiene lectura de nómina sin gestionarla. */
  laborSubtotal: string | null
  /** Comisión pagada por esa OT. */
  commission: string
  workOrderStatus: WorkOrderStatus | null
}

export type PayrollAdjustment = {
  id: string
  kind: PayrollAdjustmentKind
  /** Monto firmado (positivo suma, negativo resta). */
  amount: string
  note: string | null
  createdAt: string
  createdBy: { id: string; email: string; fullName: string } | null
}

export type PayrollRun = {
  id: string
  technicianId: string
  technician: { id: string; fullName: string; email: string }
  /** Lunes (YYYY-MM-DD). */
  weekStart: string
  /** Sábado (YYYY-MM-DD). */
  weekEnd: string
  status: PayrollStatus
  commissionPctApplied: number
  /** Σ subtotales MO de las OTs DELIVERED en la semana. `null` si el actor no puede ver montos de MO. */
  baseAmount: string | null
  /** baseAmount × commissionPctApplied / 100. */
  commissionAmount: string
  adjustmentsTotal: string
  /** commissionAmount + adjustmentsTotal. */
  totalToPay: string
  paidAt: string | null
  cashMovementId: string | null
  cashMovement: { id: string; createdAt: string } | null
  otsCount: number
  adjustments: PayrollAdjustment[]
  entries: PayrollRunEntry[]
}

export type PayrollWeekTechnicianRow = {
  technician: {
    userId: string
    fullName: string
    email: string
    isActiveUser: boolean
    commissionPct: number
    isActiveInPayroll: boolean
  }
  run: PayrollRun | null
}

export type PayrollUnassignedOt = {
  workOrderId: string
  publicCode: string
  vehiclePlate: string | null
  customerName: string | null
  deliveredAt: string
  laborSubtotal: string
}

/** `totalLaborSubtotal` es `null` cuando el actor no ve montos de MO (misma regla que `PayrollRun.baseAmount`). */
export type PayrollWeekUnassignedBlock = {
  ots: PayrollUnassignedOt[]
  totalLaborSubtotal: string | null
}

export type PayrollWeekSummary = {
  weekStart: string
  weekEnd: string
  weekStartIso: string
  weekEndIso: string
  rows: PayrollWeekTechnicianRow[]
  unassigned: PayrollWeekUnassignedBlock
  totals: {
    commissionDraft: string
    commissionPaid: string
  }
}

export type PayrollTechnicianConfig = {
  userId: string
  email: string
  fullName: string
  isActiveUser: boolean
  commissionPct: number
  isActiveInPayroll: boolean
  notes: string | null
}

