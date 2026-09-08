import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { WorkOrderDetail } from '../api/types'
import {
  buildWhatsAppMessage,
  formatCop,
  shortDate,
  waMeLink,
  workOrderStatusLabel,
} from './whatsappMessage'

const LABOR_LINE = {
  id: 'l1',
  lineType: 'LABOR' as const,
  sortOrder: 1,
  description: 'Cambio de aceite',
  quantity: '1',
  unitPrice: '80000',
  totals: {
    lineId: 'l1',
    grossAmount: '80000',
    discountAmount: '0',
    taxableBase: '67521',
    taxPercent: '19',
    taxAmount: '12479',
    taxKind: 'VAT' as const,
    lineTotal: '80000',
    lineCost: null,
    lineProfit: null,
  },
}

const BASE: WorkOrderDetail = {
  id: 'wo-1',
  orderNumber: 1,
  publicCode: 'VEN-0001',
  status: 'DELIVERED',
  description: 'Cambio de aceite',
  customerName: 'Juan Pérez',
  customerPhone: '3005551111',
  vehiclePlate: 'ABC123',
  createdAt: '2026-09-08T14:30:00.000Z',
  deliveredAt: '2026-09-08T16:00:00.000Z',
  cancelledAt: null,
  lines: [LABOR_LINE],
  linesSubtotal: '80000',
  amountDue: '0',
  totals: {
    lineCount: 1,
    linesSubtotal: '80000',
    totalDiscount: '0',
    taxableBase: '67521',
    totalTax: '12479',
    taxVatAmount: '12479',
    taxIncAmount: '0',
    grandTotal: '80000',
    totalCost: null,
    totalProfit: null,
  },
  paymentSummary: { paymentCount: 1, totalPaid: '80000', remaining: '0' },
}

test('formatCop formatea COP', () => {
  assert.equal(formatCop('123456.00'), '$ 123.456')
  assert.equal(formatCop(null), '—')
  assert.equal(formatCop(''), '—')
  assert.equal(formatCop('abc'), '—')
})

test('workOrderStatusLabel traduce estados', () => {
  assert.equal(workOrderStatusLabel('DELIVERED'), 'Entregada')
  assert.equal(workOrderStatusLabel('IN_WORKSHOP'), 'En taller')
})

test('shortDate formatea ISO', () => {
  assert.equal(shortDate(new Date(2026, 8, 8, 14, 5).toISOString()), '08/09/2026 14:05')
  assert.equal(shortDate('no-es-fecha'), 'no-es-fecha')
})

test('buildWhatsAppMessage incluye datos clave', () => {
  const msg = buildWhatsAppMessage(BASE, 'Taller Test')
  assert.match(msg, /Ven-0001/i)
  assert.match(msg, /Juan Pérez/)
  assert.match(msg, /ABC123/)
  assert.match(msg, /Cambio de aceite/)
  assert.match(msg, /\$ 80\.000/)
  assert.match(msg, /Entregada/)
  assert.match(msg, /Taller Test/)
})

test('buildWhatsAppMessage oculta lineas de más y suma contador', () => {
  const wo: WorkOrderDetail = {
    ...BASE,
    lines: Array.from({ length: 12 }, (_, i) => ({
      id: `l${i}`,
      lineType: 'PART' as const,
      sortOrder: i,
      description: `Línea ${i}`,
      quantity: '1',
      unitPrice: '10000',
      totals: {
        lineId: `l${i}`,
        grossAmount: '10000',
        discountAmount: '0',
        taxableBase: '10000',
        taxPercent: '0',
        taxAmount: '0',
        taxKind: null,
        lineTotal: '10000',
        lineCost: null,
        lineProfit: null,
      },
    })),
  }
  const msg = buildWhatsAppMessage(wo, 'Taller')
  assert.match(msg, /\+ 4 línea\(s\) más/)
  assert.equal((msg.match(/×/g) ?? []).length, 8)
})

test('waMeLink codifica texto', () => {
  const link = waMeLink('573005551111', 'Hola Mundo!')
  assert.equal(link, 'https://wa.me/573005551111?text=Hola%20Mundo!')
})