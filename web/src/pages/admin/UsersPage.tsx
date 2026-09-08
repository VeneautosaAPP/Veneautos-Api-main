import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useConfirm } from '../../components/confirm/ConfirmProvider'
import { PageHeader } from '../../components/layout/PageHeader'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'

type RoleBrief = { id: string; name: string; slug: string }
type UserRow = {
  id: string
  email: string
  fullName: string
  isActive: boolean
  roles: { role: RoleBrief }[]
}

export function UsersPage() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const { user, can } = useAuth()
  const confirm = useConfirm()
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [roles, setRoles] = useState<RoleBrief[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set())
  /** Un solo rol por defecto; los permisos vienen del rol en BD, no se editan acá. */
  const [primaryRoleId, setPrimaryRoleId] = useState('')
  /** Combinar varios roles (casos excepcionales). */
  const [multiRoleMode, setMultiRoleMode] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [editInitial, setEditInitial] = useState<{ roleIds: string[]; isActive: boolean } | null>(null)
  const createBtnClass = 'va-btn-primary'
  const tableCardClass = isSaas
    ? 'va-saas-page-section va-saas-page-section--flush overflow-hidden'
    : 'va-card-flush overflow-hidden'

  const rolesSorted = useMemo(() => [...roles].sort((a, b) => a.name.localeCompare(b.name, 'es')), [roles])

  async function load() {
    const [u, r] = await Promise.all([
      api<UserRow[]>('/users'),
      api<{ id: string; name: string; slug: string }[]>('/roles'),
    ])
    setRows(u)
    setRoles(r)
  }

  useEffect(() => {
    void load().catch(() => setMsg('Error al cargar usuarios'))
  }, [])

  function openCreate() {
    setModal('create')
    setEditId(null)
    setEditInitial(null)
    setEmail('')
    setPassword('')
    setFullName('')
    setRoleIds(new Set())
    setPrimaryRoleId('')
    setMultiRoleMode(false)
    setIsActive(true)
  }

  function openEdit(u: UserRow) {
    setModal('edit')
    setEditId(u.id)
    setEmail(u.email)
    setPassword('')
    setFullName(u.fullName)
    const rids = u.roles.map((x) => x.role.id)
    setRoleIds(new Set(rids))
    if (rids.length > 1) {
      setMultiRoleMode(true)
      setPrimaryRoleId(rids[0] ?? '')
    } else {
      setMultiRoleMode(false)
      setPrimaryRoleId(rids[0] ?? '')
    }
    setIsActive(u.isActive)
    setEditInitial({ roleIds: [...rids], isActive: u.isActive })
  }

  function toggleRole(id: string) {
    setRoleIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function setPrimaryRoleSimple(id: string) {
    setPrimaryRoleId(id)
    setRoleIds(id ? new Set([id]) : new Set())
  }

  function enableMultiRoleMode() {
    const seed = primaryRoleId ? new Set<string>([primaryRoleId]) : new Set(roleIds)
    setRoleIds(seed.size > 0 ? seed : new Set())
    setMultiRoleMode(true)
  }

  function disableMultiRoleMode() {
    const pick = [...roleIds][0] ?? primaryRoleId
    setPrimaryRoleId(pick)
    setRoleIds(pick ? new Set([pick]) : new Set())
    setMultiRoleMode(false)
  }

  async function toggleActive(u: UserRow) {
    if (u.id === user?.id) {
      setMsg('No podés desactivar tu propia cuenta.')
      return
    }
    const deactivating = u.isActive
    const ok = await confirm({
      title: deactivating ? 'Desactivar usuario' : 'Reactivar usuario',
      message: deactivating
        ? `¿Desactivar a ${u.fullName}?\n\nNo podrá ingresar al sistema, sus sesiones activas se cierran de inmediato, no será elegible para asignarle OTs y dejará de aparecer en las listas de trabajo.\n\nSu historial (OTs creadas, facturas, caja) se conserva intacto.`
        : `¿Reactivar a ${u.fullName}?\n\nVolverá a poder ingresar y aparecerá como elegible para asignarle OTs.`,
      confirmLabel: deactivating ? 'Desactivar' : 'Reactivar',
      variant: deactivating ? 'danger' : 'default',
    })
    if (!ok) return
    try {
      await api(`/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      })
      setMsg(deactivating ? 'Usuario desactivado' : 'Usuario reactivado')
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  function sameRoleSet(a: string[], b: string[]) {
    if (a.length !== b.length) return false
    const sa = [...a].sort()
    const sb = [...b].sort()
    return sa.every((x, i) => x === sb[i])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const rids = multiRoleMode ? [...roleIds] : primaryRoleId ? [primaryRoleId] : []
    if (rids.length === 0) {
      setMsg(multiRoleMode ? 'Elegí al menos un rol' : 'Elegí el rol del usuario')
      return
    }
    const roleNames = rids
      .map((id) => roles.find((r) => r.id === id)?.name)
      .filter(Boolean)
      .join(', ')
    if (modal === 'create') {
      const okCreate = await confirm({
        title: 'Crear usuario',
        message: `¿Crear usuario?\n\nCorreo: ${email.trim()}\nNombre: ${fullName.trim()}\nRol(es): ${roleNames}\n\nRevisá el correo antes de confirmar.`,
        confirmLabel: 'Crear usuario',
      })
      if (!okCreate) return
    } else if (modal === 'edit' && editInitial) {
      const rolesChanged = !sameRoleSet(editInitial.roleIds, rids)
      const deactivate = editInitial.isActive && !isActive
      if (rolesChanged || deactivate) {
        const parts = ['¿Guardar cambios en el usuario?', '', `Nombre: ${fullName.trim()}`, `Correo: ${email}`]
        if (deactivate) parts.push('', '⚠ El usuario quedará INACTIVO y no podrá ingresar.')
        if (rolesChanged) parts.push('', `Roles nuevos: ${roleNames}`)
        parts.push('', 'Los roles definen acceso a caja, órdenes y administración.')
        const okEdit = await confirm({
          title: 'Cambios en el usuario',
          message: parts.join('\n'),
          confirmLabel: 'Guardar',
          variant: deactivate ? 'danger' : 'default',
        })
        if (!okEdit) return
      }
    }
    try {
      if (modal === 'create') {
        await api('/users', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            password,
            fullName: fullName.trim(),
            roleIds: rids,
          }),
        })
        setMsg('Usuario creado')
      } else if (editId) {
        const body: Record<string, unknown> = {
          fullName: fullName.trim(),
          roleIds: rids,
        }
        if (can('users:deactivate')) {
          body.isActive = isActive
        }
        await api(`/users/${editId}`, { method: 'PATCH', body: JSON.stringify(body) })
        setMsg('Usuario actualizado')
      }
      setModal(null)
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Alta con un rol predefinido (recomendado). Los permisos los define cada rol en Administración → Roles."
        actions={
          can('users:create') ? (
            <button type="button" onClick={openCreate} className={createBtnClass}>
              Nuevo usuario
            </button>
          ) : null
        }
      />
      {msg && <p className="va-card-muted">{msg}</p>}
      {!rows && <p className="text-slate-500 dark:text-slate-300">Cargando…</p>}
      {rows && (
        <div className={tableCardClass}>
          <div className="va-table-scroll">
            <table className="va-table min-w-[560px]">
              <thead>
                <tr className="va-table-head-row">
                  <th className="va-table-th">Nombre</th>
                  <th className="va-table-th">Correo</th>
                  <th className="va-table-th">Roles</th>
                  <th className="va-table-th">Activo</th>
                  <th className="va-table-th" />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="va-table-body-row">
                    <td className="va-table-td font-medium text-slate-900 dark:text-slate-50">{u.fullName}</td>
                    <td className="va-table-td text-slate-600 dark:text-slate-300">{u.email}</td>
                    <td className="va-table-td text-xs text-slate-500 dark:text-slate-300">
                      {u.roles.map((r) => r.role.name).join(', ') || '—'}
                    </td>
                    <td className="va-table-td">{u.isActive ? 'Sí' : 'No'}</td>
                    <td className="va-table-td">
                      <div className="flex items-center gap-3">
                        {can('users:update') && (
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Editar
                          </button>
                        )}
                        {can('users:deactivate') && (
                          <button
                            type="button"
                            onClick={() => void toggleActive(u)}
                            className={
                              u.isActive
                                ? 'text-xs font-medium text-red-600 hover:underline dark:text-red-400'
                                : 'text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400'
                            }
                          >
                            {u.isActive ? 'Desactivar' : 'Reactivar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <div className="va-modal-overlay" role="presentation">
          <div className="va-modal-panel max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {modal === 'create' ? 'Nuevo usuario' : 'Editar usuario'}
            </h2>
            {modal === 'create' && (
              <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Elegí <strong className="text-slate-800 dark:text-slate-100">un rol</strong> (ej. Cajero). Los permisos ya
                están definidos en ese rol; acá no se editan permisos sueltos.
              </p>
            )}
            <form className="mt-4 space-y-3" onSubmit={submit}>
              {modal === 'create' && (
                <>
                  <label className="block text-sm">
                    <span className="va-label">Nombre completo</span>
                    <input
                      required
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="va-field mt-1"
                      placeholder="Ej. José Pérez"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="va-label">Correo (usuario para entrar)</span>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="va-field mt-1"
                      placeholder="pepito@empresa.com"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="va-label">Contraseña inicial (mín. 8 caracteres)</span>
                    <input
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="va-field mt-1"
                      placeholder="La cambia después al entrar si querés"
                    />
                  </label>
                </>
              )}
              {modal === 'edit' && (
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Correo:{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">{email}</span>
                </p>
              )}
              {modal === 'edit' && (
                <label className="block text-sm">
                  <span className="va-label">Nombre completo</span>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="va-field mt-1"
                  />
                </label>
              )}

              {!multiRoleMode ? (
                <label className="block text-sm">
                  <span className="va-label">Rol del usuario</span>
                  <select
                    required={!multiRoleMode}
                    value={primaryRoleId}
                    onChange={(e) => setPrimaryRoleSimple(e.target.value)}
                    className="va-field mt-1"
                  >
                    <option value="">— Elegí un rol —</option>
                    {rolesSorted.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    Equivale a “Pepito es cajero”: hereda todo lo definido para ese rol en Administración → Roles.
                  </span>
                </label>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
                {!multiRoleMode ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                    onClick={enableMultiRoleMode}
                  >
                    Necesito combinar varios roles (avanzado)…
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Varios roles a la vez</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Solo si una persona debe sumar perfiles (ej. caja + recepción). Si podés, usá un solo rol.
                    </p>
                    <fieldset className="text-sm">
                      <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-600 dark:bg-slate-900">
                        {rolesSorted.map((r) => (
                          <label key={r.id} className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                            <input
                              type="checkbox"
                              checked={roleIds.has(r.id)}
                              onChange={() => toggleRole(r.id)}
                              className="rounded border-slate-300 dark:border-slate-500"
                            />
                            <span>{r.name}</span>
                            <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{r.slug}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <button
                      type="button"
                      className="text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-400"
                      onClick={disableMultiRoleMode}
                    >
                      Volver a un solo rol
                    </button>
                  </div>
                )}
              </div>

              {modal === 'edit' && can('users:deactivate') && (
                <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 dark:border-slate-500"
                  />
                  <span>
                    <span className="font-medium">Usuario activo</span>
                    <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                      Desactivado: no podrá ingresar, sus sesiones se cierran y no será elegible para asignarle OTs; su
                      historial se conserva.
                    </span>
                  </span>
                </label>
              )}
              <div className="flex gap-2 pt-2">
                <button type="submit" className="va-btn-primary">
                  {modal === 'create' ? 'Crear usuario' : 'Guardar'}
                </button>
                <button
                  type="button"
                  className="va-btn-secondary"
                  onClick={() => setModal(null)}
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
