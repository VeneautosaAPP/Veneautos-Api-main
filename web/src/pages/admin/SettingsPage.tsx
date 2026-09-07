import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useConfirm } from '../../components/confirm/ConfirmProvider'
import { PageHeader } from '../../components/layout/PageHeader'
import { getSettingPresentation } from '../../config/settingsPresentation'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'
import { STALE_SETTINGS_ADMIN_MS } from '../../constants/queryStaleTime'
import { fetchSettingsTenantMap, fetchUsersListForQuery } from '../../features/settings/settingsTenantApi'
import { BackupPanel } from '../../features/settings/BackupPanel'
import { TaxRatesPage } from './TaxRatesPage'
import { queryKeys } from '../../lib/queryKeys'
import { isResumeLastModuleEnabled, setResumeLastModuleEnabled } from '../../services/lastModuleStorage'

const SETTINGS_PAGE_QUERY_GC_MS = 45 * 60_000

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function isUserCreatePolicyKey(key: string) {
  return key === 'users.create_requires_dueno_role' || key === 'users.create_requires_owner_role'
}

const DIAN_ENUM_OPTIONS = {
  'dian.provider': [
    { value: 'facture', label: 'Facture' },
    { value: 'alegra', label: 'Alegra' },
    { value: 'siigo', label: 'Siigo' },
    { value: 'carvajal', label: 'Carvajal' },
    { value: 'custom', label: 'Integración propia' },
  ],
  'dian.environment': [
    { value: 'sandbox', label: 'Sandbox (pruebas)' },
    { value: 'production', label: 'Producción' },
  ],
  'dian.emission_mode': [
    { value: 'async', label: 'Asíncrono (recomendado)' },
    { value: 'sync', label: 'Síncrono (solo si el proveedor responde rápido)' },
  ],
  'workshop.regime': [
    { value: 'natural_no_obligado', label: 'Persona natural — No obligada a facturar' },
    { value: 'natural_obligado', label: 'Persona natural — Obligada a facturar' },
    { value: 'juridica_responsable_iva', label: 'Persona jurídica — Responsable de IVA' },
    { value: 'juridica_no_responsable', label: 'Persona jurídica — No responsable de IVA' },
  ],
  'workshop.document_kind': [
    { value: 'CC', label: 'Cédula de ciudadanía (CC)' },
    { value: 'CE', label: 'Cédula de extranjería (CE)' },
    { value: 'NIT', label: 'NIT' },
    { value: 'PASAPORTE', label: 'Pasaporte' },
  ],
} as const satisfies Record<string, ReadonlyArray<{ value: string; label: string }>>

type DianEnumKey = keyof typeof DIAN_ENUM_OPTIONS

function isDianBooleanKey(key: string): boolean {
  return key === 'dian.enabled' || key === 'billing.electronic_invoice_enabled'
}

/** Fase 7.6 · Booleano de caja (auto-impresión del arqueo). */
function isCashBooleanKey(key: string): boolean {
  return key === 'cash.arqueo_autoprint_enabled'
}

/** Fase 8 · Entero no negativo (umbral de stock crítico). */
function isInventoryIntKey(key: string): boolean {
  return key === 'inventory.stock_critical_threshold'
}

function isDianEnumKey(key: string): key is DianEnumKey {
  return Object.prototype.hasOwnProperty.call(DIAN_ENUM_OPTIONS, key)
}

function isDianSecretKey(key: string): boolean {
  return key === 'dian.api_token'
}

/** Ancho del control según tipo de dato (evita inputs de 2 dígitos a todo el ancho). */
function settingFieldWidthClass(key: string): string {
  if (key === PANEL_THEME_KEY) return 'w-full max-w-md'
  if (isUserCreatePolicyKey(key)) return 'w-full max-w-[12rem]'
  if (isDianBooleanKey(key)) return 'w-full max-w-[12rem]'
  if (isCashBooleanKey(key)) return 'w-full max-w-[12rem]'
  if (isInventoryIntKey(key)) return 'w-full max-w-[9rem] font-mono tabular-nums'
  if (isDianEnumKey(key)) return 'w-full max-w-md'
  if (key === 'dian.api_base_url' || key === 'dian.api_token') return 'w-full max-w-2xl font-mono'
  if (
    key === 'dian.company_nit' ||
    key === 'dian.company_verification_digit' ||
    key === 'dian.resolution_prefix' ||
    key === 'dian.resolution_number' ||
    key === 'dian.test_set_id' ||
    key === 'dian.resolution_valid_until'
  ) {
    return 'w-full max-w-xs font-mono tabular-nums'
  }
  if (key === 'dian.resolution_from' || key === 'dian.resolution_to') {
    return 'w-full max-w-[9rem] font-mono tabular-nums'
  }
  if (key === 'workshop.name' || key === 'workshop.timezone' || key === 'workshop.currency') {
    return 'w-full max-w-xl'
  }
  if (
    key === 'workshop.legal_name' ||
    key === 'workshop.address' ||
    key === 'workshop.city' ||
    key === 'workshop.phone' ||
    key === 'workshop.email' ||
    key === 'workshop.document_id'
  ) {
    return 'w-full max-w-xl'
  }
  if (key === 'workshop.receipt_footer') {
    return 'w-full max-w-2xl'
  }
  if (key.startsWith('notes.')) {
    return 'w-full max-w-[9rem] font-mono tabular-nums sm:max-w-[10rem]'
  }
  return 'w-full max-w-[9rem] font-mono tabular-nums sm:max-w-[10rem]'
}

const WORK_ORDER_PAYMENT_NOTE_KEY = 'notes.min_length.work_order_payment'

const DEFAULT_WORK_ORDER_PAYMENT_MIN = 70

const PANEL_THEME_KEY = 'ui.panel_theme'

function mergeSettingsFromServer(m: Record<string, unknown>): Record<string, unknown> {
  const out = { ...m }
  if (!(WORK_ORDER_PAYMENT_NOTE_KEY in out)) out[WORK_ORDER_PAYMENT_NOTE_KEY] = DEFAULT_WORK_ORDER_PAYMENT_MIN
  if (!(PANEL_THEME_KEY in out)) out[PANEL_THEME_KEY] = 'saas_light'
  {
    const th = out[PANEL_THEME_KEY]
    if (th !== 'saas_light' && th !== 'vene_autos') {
      out[PANEL_THEME_KEY] = 'saas_light'
    }
  }
  // Fase 7.5: valores por defecto para facturación e identidad del taller.
  if (!('billing.electronic_invoice_enabled' in out)) out['billing.electronic_invoice_enabled'] = false
  if (!('workshop.legal_name' in out)) out['workshop.legal_name'] = ''
  if (!('workshop.document_kind' in out)) out['workshop.document_kind'] = 'CC'
  if (!('workshop.document_id' in out)) out['workshop.document_id'] = ''
  if (!('workshop.address' in out)) out['workshop.address'] = ''
  if (!('workshop.city' in out)) out['workshop.city'] = ''
  if (!('workshop.phone' in out)) out['workshop.phone'] = ''
  if (!('workshop.email' in out)) out['workshop.email'] = ''
  if (!('workshop.regime' in out)) out['workshop.regime'] = 'natural_no_obligado'
  if (!('workshop.receipt_footer' in out)) out['workshop.receipt_footer'] = ''
  if (!('cash.arqueo_autoprint_enabled' in out)) out['cash.arqueo_autoprint_enabled'] = false
  if (!('inventory.stock_critical_threshold' in out)) out['inventory.stock_critical_threshold'] = 3
  return out
}

function parseValue(key: string, raw: string): unknown {
  const t = raw.trim()
  if (key === PANEL_THEME_KEY) {
    if (t === 'vene_autos') return 'vene_autos'
    if (t === 'saas_light') return 'saas_light'
    return 'saas_light'
  }
  if (key === 'auth.session_idle_timeout_minutes') return parseInt(t, 10)
  if (key === 'notes.min_length_chars' || key === WORK_ORDER_PAYMENT_NOTE_KEY) return parseInt(t, 10)
  if (isUserCreatePolicyKey(key)) {
    return t === 'true' || t === '1' || t === 'sí'
  }
  if (isDianBooleanKey(key)) {
    return t === 'true' || t === '1' || t === 'sí'
  }
  if (isCashBooleanKey(key)) {
    return t === 'true' || t === '1' || t === 'sí'
  }
  if (isInventoryIntKey(key)) {
    const n = parseInt(t, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  if (isDianEnumKey(key)) {
    return t
  }
  if (key === 'dian.resolution_from' || key === 'dian.resolution_to') {
    const n = parseInt(t, 10)
    return Number.isFinite(n) ? n : t
  }
  if (key.startsWith('dian.')) {
    return t
  }
  // Campos de texto libre del taller (razón social, NIT/CC, dirección, teléfono, etc.).
  // Sin esta rama, un NIT como "900123456" entraría al fallback y `JSON.parse` lo convertiría
  // en número, y el backend rechazaría con "… debe ser texto (puede quedar vacío)".
  if (key.startsWith('workshop.')) {
    return t
  }
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

type UserOption = { id: string; email: string; fullName: string; isActive: boolean }

const SETTING_SECTIONS: Array<{
  id: string
  title: string
  description: string
  match: (key: string) => boolean
}> = [
  {
    id: 'auth',
    title: 'Sesión y seguridad',
    description: 'Inactividad y acceso.',
    match: (key) => key.startsWith('auth.'),
  },
  {
    id: 'workshop',
    title: 'Identidad del taller',
    description: 'Nombre, moneda, zona horaria.',
    match: (key) => key.startsWith('workshop.'),
  },
  {
    id: 'ui',
    title: 'Interfaz del panel',
    description: 'Tema visual del panel.',
    match: (key) => key.startsWith('ui.'),
  },
  {
    id: 'notes',
    title: 'Notas operativas',
    description: 'Mínimos de caracteres en notas.',
    match: (key) => key.startsWith('notes.'),
  },
  {
    id: 'billing',
    title: 'Facturación',
    description:
      'Interruptor maestro del módulo fiscal. Apagado (por defecto): se entrega comprobante interno (OT o venta) como constancia al cliente. Encendido: se habilita el módulo «Facturación» y la emisión DIAN.',
    match: (key) => key.startsWith('billing.'),
  },
  {
    id: 'cash',
    title: 'Caja',
    description:
      'Preferencias operativas de la caja (auto-impresión de arqueo al cerrar la sesión, etc.). No afecta permisos ni montos.',
    match: (key) => key.startsWith('cash.'),
  },
  {
    id: 'inventory',
    title: 'Inventario',
    description:
      'Parámetros operativos del inventario. El umbral de stock crítico decide qué ítems aparecen en el informe «Stock crítico» (los que tienen cantidad en mano ≤ umbral).',
    match: (key) => key.startsWith('inventory.'),
  },
  {
    id: 'dian',
    title: 'Facturación electrónica DIAN',
    description:
      'Credenciales y numeración para el proveedor. Si está desactivada, la app opera sin emisión (valores quedan listos para una futura integración).',
    match: (key) => key.startsWith('dian.'),
  },
  {
    id: 'users',
    title: 'Política de usuarios',
    description: 'Alta de cuentas nuevas.',
    match: (key) => isUserCreatePolicyKey(key),
  },
  {
    id: 'other',
    title: 'Otros parámetros',
    description: 'Claves extra en base.',
    match: () => true,
  },
]

function groupSettingKeys(keys: string[]): Array<{ section: (typeof SETTING_SECTIONS)[number]; keys: string[] }> {
  const used = new Set<string>()
  const out: Array<{ section: (typeof SETTING_SECTIONS)[number]; keys: string[] }> = []
  for (const section of SETTING_SECTIONS) {
    if (section.id === 'other') continue
    const group = keys.filter((k) => !used.has(k) && section.match(k))
    for (const k of group) used.add(k)
    if (group.length) out.push({ section, keys: group.sort() })
  }
  const rest = keys.filter((k) => !used.has(k)).sort()
  if (rest.length) {
    const other = SETTING_SECTIONS.find((s) => s.id === 'other')!
    out.push({ section: other, keys: rest })
  }
  return out
}

export function SettingsPage() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const confirm = useConfirm()
  const canSaveSettings = can('settings:update')
  const canResetPasswords = can('users:reset_password')

  const [panel, setPanel] = useState<'workshop' | 'taxes' | 'support' | 'backup'>(() =>
    can('tax_rates:read') && !can('settings:read') ? 'taxes' : 'workshop',
  )
  const showTaxesTab = can('tax_rates:read')

  const [serverSnapshot, setServerSnapshot] = useState<Record<string, unknown> | null>(null)
  const [map, setMap] = useState<Record<string, unknown> | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const [resetUserId, setResetUserId] = useState('')
  const [resetPw1, setResetPw1] = useState('')
  const [resetPw2, setResetPw2] = useState('')
  const [resetMsg, setResetMsg] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resumeLastModuleEnabled, setResumeLastModuleEnabledState] = useState(true)
  const [resumePrefMsg, setResumePrefMsg] = useState<string | null>(null)

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.tenantMap(),
    queryFn: ({ signal }) => fetchSettingsTenantMap(signal),
    staleTime: STALE_SETTINGS_ADMIN_MS,
    gcTime: SETTINGS_PAGE_QUERY_GC_MS,
  })

  const usersQuery = useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: ({ signal }) => fetchUsersListForQuery(signal),
    enabled: canResetPasswords,
    staleTime: STALE_SETTINGS_ADMIN_MS,
    gcTime: SETTINGS_PAGE_QUERY_GC_MS,
  })

  useLayoutEffect(() => {
    const raw = settingsQuery.data
    if (!raw) return
    setServerSnapshot(raw)
    const merged = mergeSettingsFromServer(raw)
    setMap(merged)
    const d: Record<string, string> = {}
    for (const k of Object.keys(merged)) {
      d[k] = displayValue(merged[k])
    }
    setDraft(d)
  }, [settingsQuery.data])

  const userOptions = useMemo((): UserOption[] | null => {
    if (!canResetPasswords) return null
    if (usersQuery.isPending) return null
    if (usersQuery.isError) return []
    const rows = usersQuery.data
    if (!rows) return null
    return rows.map((r) => ({ id: r.id, email: r.email, fullName: r.fullName, isActive: r.isActive }))
  }, [canResetPasswords, usersQuery.data, usersQuery.isError, usersQuery.isPending])

  useEffect(() => {
    setResumeLastModuleEnabledState(isResumeLastModuleEnabled())
  }, [])

  useEffect(() => {
    if (!resumePrefMsg) return
    const timer = window.setTimeout(() => setResumePrefMsg(null), 2200)
    return () => window.clearTimeout(timer)
  }, [resumePrefMsg])

  const keys = map ? Object.keys(map).sort() : []
  const groupedKeys = useMemo(() => groupSettingKeys(keys), [keys])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!map || !canSaveSettings) return
    setMsg(null)
    const values: Record<string, unknown> = {}
    for (const key of Object.keys(map)) {
      const next = parseValue(key, draft[key] ?? '')
      const prev = map[key]
      if (displayValue(next) !== displayValue(prev)) {
        values[key] = next
      }
    }
    if (
      serverSnapshot &&
      !(WORK_ORDER_PAYMENT_NOTE_KEY in serverSnapshot) &&
      WORK_ORDER_PAYMENT_NOTE_KEY in map
    ) {
      values[WORK_ORDER_PAYMENT_NOTE_KEY] = parseValue(
        WORK_ORDER_PAYMENT_NOTE_KEY,
        draft[WORK_ORDER_PAYMENT_NOTE_KEY] ?? '',
      )
    }
    if (Object.keys(values).length === 0) {
      setMsg('Sin cambios')
      return
    }
    const diffLines = Object.keys(values).map((k) => {
      const hadOnServer = serverSnapshot && k in serverSnapshot
      const prev = hadOnServer ? displayValue(serverSnapshot[k]) : '(nuevo en base o valor sugerido)'
      const next = displayValue(values[k])
      const label = getSettingPresentation(k).label
      return `· ${label}\n  (${k})\n  ${prev} → ${next}`
    })
    const ok = await confirm({
      title: 'Guardar configuración del taller',
      message: `¿Guardar estos cambios?\n\n${diffLines.join('\n\n')}\n\nAfecta políticas globales (sesiones, permisos, etc.). Revisá cada valor antes de confirmar.`,
      confirmLabel: 'Guardar',
    })
    if (!ok) return
    try {
      const updated = await api<Record<string, unknown>>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ values }),
      })
      queryClient.setQueryData(queryKeys.settings.tenantMap(), updated)
      setMsg('Configuración guardada')
      window.dispatchEvent(new CustomEvent('vene:panel-theme-changed'))
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const submitResetPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setResetMsg(null)
      if (!resetUserId) {
        setResetMsg('Elegí un usuario')
        return
      }
      if (resetPw1.length < 8) {
        setResetMsg('La contraseña debe tener al menos 8 caracteres')
        return
      }
      if (resetPw1 !== resetPw2) {
        setResetMsg('Las contraseñas no coinciden')
        return
      }
      const u = userOptions?.find((x) => x.id === resetUserId)
      const ok = await confirm({
        title: 'Restablecer contraseña',
        message: `¿Asignar una contraseña nueva a esta cuenta?\n\n${u?.fullName ?? ''} (${u?.email ?? ''})\n\nSe cerrarán todas las sesiones abiertas de ese usuario. Comunicá la contraseña por un canal seguro.`,
        confirmLabel: 'Restablecer',
        variant: 'danger',
      })
      if (!ok) return
      setResetBusy(true)
      try {
        await api(`/users/${resetUserId}/password`, {
          method: 'PATCH',
          body: JSON.stringify({ password: resetPw1 }),
        })
        void queryClient.invalidateQueries({ queryKey: queryKeys.users.list() })
        setResetPw1('')
        setResetPw2('')
        setResetMsg('Contraseña actualizada. El usuario debe iniciar sesión de nuevo.')
      } catch (err) {
        setResetMsg(err instanceof Error ? err.message : 'Error al restablecer')
      } finally {
        setResetBusy(false)
      }
    },
    [resetUserId, resetPw1, resetPw2, userOptions, confirm, queryClient],
  )

  const showSupportTab = canResetPasswords
  const canReadSettings = can('settings:read')
  const showBackupTab = canReadSettings || canSaveSettings
  const showWorkshopTab = canReadSettings || canSaveSettings
  const pageClass = isSaas ? 'space-y-4 lg:space-y-5' : 'space-y-3 sm:space-y-4'
  const sectionCardClass = isSaas
    ? 'scroll-mt-4 va-settings-section overflow-hidden'
    : 'scroll-mt-4 va-card border-slate-200/90 p-3 shadow-sm sm:p-4 dark:border-slate-700/90'
  const supportCardClass = isSaas
    ? 'va-settings-section overflow-hidden'
    : 'va-card border-brand-200/60 p-3 dark:border-brand-900/50'
  const sectionHeadClass = isSaas
    ? 'va-settings-section-head'
    : 'border-b border-slate-100 pb-2 dark:border-slate-800'
  const sectionTitleClass = isSaas ? 'va-section-title text-sm' : 'text-sm font-semibold text-slate-900 dark:text-slate-50'
  const settingRowClass = isSaas
    ? 'grid gap-1.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4 sm:py-1.5'
    : 'grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4 sm:py-2'

  return (
    <div className={`${pageClass} max-w-6xl mx-auto w-full ${isSaas ? 'va-settings-page' : ''}`}>
      <PageHeader
        eyebrow="Administración"
        title="Configuración del taller"
        description="Parámetros globales del taller. Los cambios relevantes quedan en auditoría."
        rootClassName={
          isSaas ? undefined : 'border-b border-slate-200/80 pb-4 dark:border-slate-800'
        }
      />

      {(showTaxesTab || showSupportTab || showBackupTab) && (
        <div
          className={`va-tabstrip max-w-xl ${isSaas ? 'va-tabstrip--inline va-tabstrip--compact' : ''}`}
          role="tablist"
          aria-label="Secciones de configuración"
        >
          {showWorkshopTab && (
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'workshop'}
              className={`va-tab ${panel === 'workshop' ? 'va-tab-active' : 'va-tab-inactive'}`}
              onClick={() => setPanel('workshop')}
            >
              Parámetros del taller
            </button>
          )}
          {showTaxesTab && (
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'taxes'}
              className={`va-tab ${panel === 'taxes' ? 'va-tab-active' : 'va-tab-inactive'}`}
              onClick={() => setPanel('taxes')}
            >
              Impuestos
            </button>
          )}
          {showSupportTab && (
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'support'}
              className={`va-tab ${panel === 'support' ? 'va-tab-active' : 'va-tab-inactive'}`}
              onClick={() => setPanel('support')}
            >
              Soporte — contraseñas
            </button>
          )}
          {showBackupTab && (
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'backup'}
              className={`va-tab ${panel === 'backup' ? 'va-tab-active' : 'va-tab-inactive'}`}
              onClick={() => setPanel('backup')}
            >
              Backup & Restore
            </button>
          )}
        </div>
      )}

      {settingsQuery.isError && !settingsQuery.data ? (
        <p className="va-alert-error-lg">
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : 'No se pudo cargar la configuración'}
        </p>
      ) : null}
      {msg && <p className="va-card-muted">{msg}</p>}

      {showWorkshopTab && panel === 'workshop' && (
        <>
          <section className={`${sectionCardClass} ${isSaas ? 'p-3 sm:p-3.5' : ''}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className={sectionTitleClass}>Experiencia de navegación</h2>
                <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-300">
                  Retomar el último módulo al iniciar sesión. Solo en este navegador (no cambia la API).
                </p>
              </div>
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={resumeLastModuleEnabled}
                  onChange={(e) => {
                    const next = e.target.checked
                    setResumeLastModuleEnabledState(next)
                    setResumeLastModuleEnabled(next)
                    setResumePrefMsg(
                      next
                        ? 'Listo: se retomará el último módulo al iniciar sesión.'
                        : 'Listo: desactivado. Se abrirá el inicio del panel.',
                    )
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                />
                <span>{resumeLastModuleEnabled ? 'Activado' : 'Desactivado'}</span>
              </label>
            </div>
            {resumePrefMsg && (
              <p
                role="status"
                aria-live="polite"
                className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
              >
                {resumePrefMsg}
              </p>
            )}
          </section>

          {!map && settingsQuery.isPending ? (
            <p className="text-slate-500 dark:text-slate-300">Cargando…</p>
          ) : null}
          {map && (
            <form onSubmit={save} className="min-w-0 space-y-5">
              {!canSaveSettings && (
                <p className="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                  Solo tenés permiso de lectura. Los valores se muestran para consulta; un usuario con permiso de
                  actualización puede modificarlos.
                </p>
              )}

              <div className="columns-1 gap-x-5 [column-fill:balance] lg:columns-2">
                {groupedKeys.map(({ section, keys: sectionKeys }) => (
                  <section
                    key={section.id}
                    id={`cfg-${section.id}`}
                    className={`${sectionCardClass} mb-3 break-inside-avoid sm:mb-4 ${
                      section.id === 'other' ? 'lg:[column-span:all]' : ''
                    }`}
                  >
                    <div className={sectionHeadClass}>
                      <h2 className={sectionTitleClass}>{section.title}</h2>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400 sm:text-xs">
                        {section.description}
                      </p>
                    </div>
                    <ul className="mt-0 divide-y divide-slate-100 px-3 pb-1 dark:divide-slate-800 sm:px-3.5">
                      {sectionKeys.map((key) => {
                        const { label, description } = getSettingPresentation(key)
                        const fieldId = `setting-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
                        const width = settingFieldWidthClass(key)
                        return (
                          <li key={key} className={settingRowClass}>
                            <div className="min-w-0">
                              <label htmlFor={fieldId} className="block cursor-pointer" title={key}>
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{label}</span>
                                <span className="ml-1.5 hidden align-middle font-mono text-[10px] font-normal tracking-tight text-slate-400 sm:inline dark:text-slate-500">
                                  ({key})
                                </span>
                              </label>
                              <p className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300 sm:text-xs">
                                {description}
                              </p>
                            </div>
                            <div className="shrink-0 sm:pt-0.5 sm:text-right">
                              {key === PANEL_THEME_KEY ? (
                                <select
                                  id={fieldId}
                                  value={draft[key] === 'vene_autos' ? 'vene_autos' : 'saas_light'}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                >
                                  <option value="saas_light">SaaS claro (dashboard moderno)</option>
                                  <option value="vene_autos">Vene-Autos</option>
                                </select>
                              ) : isUserCreatePolicyKey(key) ? (
                                <select
                                  id={fieldId}
                                  value={draft[key] === 'true' ? 'true' : 'false'}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                >
                                  <option value="false">No</option>
                                  <option value="true">Sí</option>
                                </select>
                              ) : isDianBooleanKey(key) ? (
                                <select
                                  id={fieldId}
                                  value={draft[key] === 'true' ? 'true' : 'false'}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                >
                                  <option value="false">
                                    {key === 'billing.electronic_invoice_enabled'
                                      ? 'No (solo comprobantes internos)'
                                      : 'No (sin emisión)'}
                                  </option>
                                  <option value="true">
                                    {key === 'billing.electronic_invoice_enabled'
                                      ? 'Sí (habilitar módulo fiscal)'
                                      : 'Sí (emitir a DIAN)'}
                                  </option>
                                </select>
                              ) : isCashBooleanKey(key) ? (
                                <select
                                  id={fieldId}
                                  value={draft[key] === 'true' ? 'true' : 'false'}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                >
                                  <option value="false">No (imprimo manualmente)</option>
                                  <option value="true">Sí (abre solito el ticket al cerrar)</option>
                                </select>
                              ) : isInventoryIntKey(key) ? (
                                <input
                                  id={fieldId}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={draft[key] ?? ''}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                  placeholder="3"
                                />
                              ) : isDianEnumKey(key) ? (
                                <select
                                  id={fieldId}
                                  value={draft[key] ?? ''}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                >
                                  {DIAN_ENUM_OPTIONS[key].map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : isDianSecretKey(key) ? (
                                <input
                                  id={fieldId}
                                  type="password"
                                  autoComplete="off"
                                  value={draft[key] ?? ''}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                  placeholder="•••••••• (queda en base, no se muestra)"
                                />
                              ) : (
                                <input
                                  id={fieldId}
                                  value={draft[key] ?? ''}
                                  disabled={!canSaveSettings}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  className={`va-field disabled:cursor-not-allowed disabled:opacity-60 ${width}`}
                                />
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}

                {canSaveSettings && (
                  <div className="mt-1 flex flex-col gap-2 break-inside-avoid sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 lg:mt-2 lg:[column-span:all]">
                    <button type="submit" className="va-btn-primary px-5">
                      Guardar cambios
                    </button>
                    <p className="text-xs text-slate-500 dark:text-slate-300">Antes de guardar se muestra un resumen para confirmar.</p>
                  </div>
                )}
              </div>
            </form>
          )}
        </>
      )}

      {showTaxesTab && panel === 'taxes' && (
        <div className="va-settings-page">
          <TaxRatesPage embed />
        </div>
      )}

      {showSupportTab && panel === 'support' && (
        <section className={supportCardClass}>
          <div
            className={`flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between ${
              isSaas
                ? 'va-settings-section-head mb-2'
                : 'border-b border-slate-100 pb-3 dark:border-slate-800'
            }`}
          >
            <div>
              <h2 className={isSaas ? 'va-section-title text-sm' : 'text-lg font-semibold text-slate-900 dark:text-slate-50'}>
                Restablecer contraseña
              </h2>
              <p className="mt-0.5 max-w-xl text-xs leading-snug text-slate-600 dark:text-slate-300 sm:text-sm">
                Solo con permiso explícito. El usuario afectado deberá iniciar sesión de nuevo.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-lg border border-brand-200 bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-900 dark:border-brand-500 dark:bg-brand-900 dark:text-brand-50 dark:shadow-sm">
              Permiso: users:reset_password
            </span>
          </div>

          {resetMsg && (
            <p
              className={`mx-3 mt-3 text-sm sm:mx-3.5 ${
                resetMsg.includes('Error') || resetMsg.includes('coinciden') || resetMsg.includes('Elegí')
                  ? 'va-alert-error'
                  : 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100'
              }`}
            >
              {resetMsg}
            </p>
          )}

          {!userOptions && <p className="mx-3 mt-3 text-sm text-slate-500 sm:mx-3.5">Cargando usuarios…</p>}
          {userOptions && (
            <form className="mx-3 mt-4 space-y-3 pb-3 sm:mx-3.5 sm:pb-3.5" onSubmit={submitResetPassword}>
              <label className="block text-sm">
                <span className="va-label">Usuario</span>
                <select
                  value={resetUserId}
                  onChange={(e) => setResetUserId(e.target.value)}
                  className="va-field mt-1 max-w-lg"
                  required
                >
                  <option value="">— Elegir cuenta —</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.email}){u.isActive ? '' : ' — inactivo'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="va-label">Nueva contraseña (mín. 8)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={resetPw1}
                  onChange={(e) => setResetPw1(e.target.value)}
                  className="va-field mt-1 max-w-lg"
                />
              </label>
              <label className="block text-sm">
                <span className="va-label">Repetir contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={resetPw2}
                  onChange={(e) => setResetPw2(e.target.value)}
                  className="va-field mt-1 max-w-lg"
                />
              </label>
              <button type="submit" disabled={resetBusy} className="va-btn-primary px-5 disabled:opacity-60">
                {resetBusy ? 'Aplicando…' : 'Restablecer contraseña'}
              </button>
            </form>
          )}
        </section>
      )}

      {showBackupTab && panel === 'backup' && (
        <section className={supportCardClass}>
          <BackupPanel canWrite={canSaveSettings} />
        </section>
      )}
    </div>
  )
}
