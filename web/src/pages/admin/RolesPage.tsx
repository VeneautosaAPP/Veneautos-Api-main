import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import type { PermissionRow } from '../../api/types'
import { CopyRolePermissionsBar } from '../../components/CopyRolePermissionsBar'
import { PermissionPicker } from '../../components/PermissionPicker'
import { RoleProfileTemplatesPanel } from '../../components/RoleProfileTemplatesPanel'
import { portalPath } from '../../constants/portalPath'
import { PageHeader } from '../../components/layout/PageHeader'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'

type RoleRow = {
  id: string
  name: string
  slug: string
  isSystem: boolean
  description: string | null
  permissions?: { permission: { id: string } }[]
}

export function RolesPage() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const { can } = useAuth()
  const [rows, setRows] = useState<RoleRow[] | null>(null)
  const [perms, setPerms] = useState<PermissionRow[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [desc, setDesc] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  /** Perfiles marcados en el modal (multi-perfil: se unen al aplicar). */
  const [checkedTemplateIds, setCheckedTemplateIds] = useState<Set<string>>(new Set())
  const createBtnClass = 'va-btn-primary'
  const roleCardClass = isSaas
    ? 'va-saas-link-card'
    : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-600'

  useEffect(() => {
    if (!open) setCheckedTemplateIds(new Set())
  }, [open])

  async function load() {
    const [r, p] = await Promise.all([
      api<RoleRow[]>('/roles'),
      can('permissions:read') ? api<PermissionRow[]>('/permissions') : Promise.resolve([]),
    ])
    setRows(r)
    setPerms(p)
  }

  useEffect(() => {
    void load().catch(() => setMsg('Error al cargar roles'))
  }, [])

  async function createRole(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const permissionIds = [...sel]
    if (permissionIds.length === 0) {
      setMsg('Elegí al menos un permiso')
      return
    }
    try {
      await api('/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase().replace(/\s+/g, '-'),
          description: desc.trim() || undefined,
          permissionIds,
        }),
      })
      setOpen(false)
      setName('')
      setSlug('')
      setDesc('')
      setSel(new Set())
      setMsg('Rol creado')
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="Cada rol junta permisos que definen qué puede hacer una persona. Los textos están en español; el código técnico solo se muestra para soporte."
        actions={
          can('roles:create') && can('permissions:read') ? (
            <button type="button" onClick={() => setOpen(true)} className={createBtnClass}>
              Nuevo rol
            </button>
          ) : null
        }
      />
      {msg && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
          {msg}
        </p>
      )}
      {!rows && <p className="text-slate-500 dark:text-slate-300">Cargando…</p>}
      {rows && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={roleCardClass}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{r.name}</p>
                  <p className="font-mono text-xs text-slate-400 dark:text-slate-500">{r.slug}</p>
                </div>
                {r.isSystem && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Sistema
                  </span>
                )}
              </div>
              {r.description && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{r.description}</p>
              )}
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                {r.permissions?.length ?? 0} permisos
              </p>
              {can('roles:read') && (
                <Link
                  to={portalPath(`/admin/roles/${r.id}`)}
                  className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Editar permisos →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="va-modal-overlay" role="presentation">
          <div
            className="va-modal-panel-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-role-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-role-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Nuevo rol
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-300">
              El nombre se muestra al personal. El identificador interno (slug) no debe cambiarse
              después si ya hay integraciones; use minúsculas y guiones, sin espacios.
            </p>
            <form className="mt-4 space-y-4" onSubmit={createRole}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-300">Nombre visible</span>
                  <input required value={name} onChange={(e) => setName(e.target.value)} className="va-field mt-1" />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-300">Identificador único (slug)</span>
                  <input
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="va-field mt-1 font-mono"
                    placeholder="ej. mecanico-senior"
                  />
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">
                    Solo letras minúsculas, números y guiones. No uses datos personales.
                  </span>
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-300">Descripción (opcional)</span>
                  <input
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    className="va-field mt-1"
                    placeholder="Para qué equipo o turno aplica este perfil"
                  />
                </label>
              </div>
              <CopyRolePermissionsBar roles={rows ?? []} setSel={setSel} />
              <RoleProfileTemplatesPanel
                permissions={perms}
                checkedTemplateIds={checkedTemplateIds}
                setCheckedTemplateIds={setCheckedTemplateIds}
                setSel={setSel}
              />
              <PermissionPicker permissions={perms} selectedIds={sel} onChange={setSel} />
              <div className="flex gap-2">
                <button type="submit" className="va-btn-primary">
                  Crear rol
                </button>
                <button
                  type="button"
                  className="va-btn-secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
