/** Respuesta de `GET /settings/ui-context` (cualquier usuario autenticado). Ver `api/docs/NOTAS_POLITICA.md`. */
export const SETTINGS_UI_CONTEXT_PATH = '/settings/ui-context'

const FALLBACK_GENERAL = 50
const FALLBACK_WORK_ORDER_PAYMENT = 70

export type PanelThemeMode = 'saas_light' | 'vene_autos'

/** Shell “moderno” (sidebar SaaS, tarjetas, etc.): SaaS claro y Vene-Autos comparten layout hasta definir paleta propia. */
export function panelUsesModernShell(theme: PanelThemeMode): boolean {
  return theme === 'saas_light' || theme === 'vene_autos'
}

export type SettingsNotesUiContext = {
  notesMinLengthChars: number
  notesMinLengthWorkOrderPayment: number
}

/** Respuesta JSON de `GET /settings/ui-context` (antes de validar tipos). */
export type SettingsUiContextResponse = Record<string, unknown>

function clampNotesMin(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN
  if (!Number.isFinite(n) || n < 5) return fallback
  return Math.min(500, Math.floor(n))
}

/** Mínimos efectivos para formularios (general vs cobros en OT). */
export function parseNotesUiContext(raw: SettingsUiContextResponse): SettingsNotesUiContext {
  return {
    notesMinLengthChars: clampNotesMin(raw.notesMinLengthChars, FALLBACK_GENERAL),
    notesMinLengthWorkOrderPayment: clampNotesMin(
      raw.notesMinLengthWorkOrderPayment,
      FALLBACK_WORK_ORDER_PAYMENT,
    ),
  }
}

/** Tema visual del panel (solo desde configuración del taller). Valores antiguos → `saas_light`. */
export function parsePanelTheme(raw: SettingsUiContextResponse): PanelThemeMode {
  const v = raw.panelTheme
  if (v === 'vene_autos') return 'vene_autos'
  if (v === 'saas_light') return 'saas_light'
  return 'saas_light'
}

/**
 * Fase 7.5: interruptor maestro del módulo de facturación electrónica DIAN. Cuando está
 * apagado (por defecto), el sistema opera sólo con comprobantes imprimibles de OT/Venta y
 * se oculta el módulo «Facturación» en el menú. Activarlo exige resolución DIAN + proveedor.
 */
export function parseElectronicInvoiceEnabled(raw: SettingsUiContextResponse): boolean {
  return raw.electronicInvoiceEnabled === true || raw.electronicInvoiceEnabled === 'true'
}

/**
 * Fase 7.6: cuando está en `true`, al cerrar la sesión de caja el panel abre solito el ticket
 * de arqueo (`?autoprint=1`) en una nueva pestaña. Por defecto `false` para respetar el flujo
 * actual del cajero (un botón explícito "Imprimir arqueo" siempre está disponible).
 */
export function parseArqueoAutoprintEnabled(raw: SettingsUiContextResponse): boolean {
  return raw.arqueoAutoprintEnabled === true || raw.arqueoAutoprintEnabled === 'true'
}

export function notesMinHint(min: number): string {
  return `Obligatoria: al menos ${min} caracteres (configuración del taller).`
}
