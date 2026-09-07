import { useCallback, useEffect, useState } from 'react'
import { portalPath } from '../../constants/portalPath'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { LoginResponse } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader } from '../../components/layout/PageHeader'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'

type RoleRow = { id: string; name: string; slug: string; isSystem: boolean }

export function RolePreviewPage() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const { can, applyAuthResponse } = useAuth()
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const panelClass = isSaas ? 'va-saas-page-section space-y-4' : 'va-card space-y-4 p-5 sm:p-6'
  const primaryBtnClass = 'va-btn-primary disabled:opacity-50'

  const load = useCallback(async () => {
    if (!can('auth:assume_role_preview')) return
    setMsg(null)
    try {
      const list = await api<RoleRow[]>('/auth/preview-role/candidates')
      setRoles(Array.isArray(list) ? list : [])
      setSelectedId((prev) => {
        if (prev && list.some((r) => r.id === prev)) return prev
        return list[0]?.id ?? ''
      })
    } catch (e) {
      setRoles([])
      setMsg(e instanceof Error ? e.message : 'No se pudo cargar el listado de roles')
    }
  }, [can])

  useEffect(() => {
    void load()
  }, [load])

  async function applyPreview() {
    if (!selectedId || !can('auth:assume_role_preview')) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await api<LoginResponse>('/auth/preview-role', {
        method: 'POST',
        body: JSON.stringify({ roleId: selectedId }),
      })
      applyAuthResponse(res)
      setMsg(`Sesión actualizada: estás viendo la app con el rol «${res.user.previewRole?.name ?? '…'}».`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function clearPreview() {
    if (!can('auth:assume_role_preview')) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await api<LoginResponse>('/auth/preview-role/clear', { method: 'POST' })
      applyAuthResponse(res)
      setMsg('Volviste a tus permisos reales (administrador / dueño).')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  if (!can('auth:assume_role_preview')) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        Tu cuenta no tiene permiso para la vista por rol (solo administrador o dueño del taller).
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        beforeTitle={
          <Link to={portalPath('/')} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
            ← Inicio
          </Link>
        }
        title="Probar vista por rol"
        description="Elegí un rol del taller y aplicá: el menú y las acciones pasan a ser las de ese perfil. Seguís siendo el mismo usuario; para volver a administración/dueño usá «Restaurar mis permisos reales». Lo mismo podés hacer desde el desplegable «Vista por rol» en la cabecera, sin salir de la pantalla en la que estés."
      />

      {msg && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {msg}
        </p>
      )}

      <div className={panelClass}>
        <label className="block text-sm">
          <span className="va-label">Rol a simular</span>
          <select
            className="va-field mt-1 w-full max-w-xl"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={busy || roles.length === 0}
          >
            {roles.length === 0 && <option value="">— Sin roles —</option>}
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.slug})
                {r.isSystem ? ' · sistema' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || !selectedId}
            onClick={() => void applyPreview()}
            className={primaryBtnClass}
          >
            {busy ? 'Aplicando…' : 'Aplicar vista de este rol'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void clearPreview()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Restaurar mis permisos reales
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-300"
          >
            Recargar listado
          </button>
        </div>
      </div>
    </div>
  )
}
