import { useState, type Dispatch, type SetStateAction } from 'react'

export type RoleForPermissionCopy = {
  id: string
  name: string
  permissions?: { permission: { id: string } }[]
}

type Props = {
  roles: RoleForPermissionCopy[]
  /** Al editar un rol, se omite de la lista para evitar copiar sobre sí mismo sin querer. */
  excludeRoleId?: string
  setSel: Dispatch<SetStateAction<Set<string>>>
}

function permissionIdsFromRole(role: RoleForPermissionCopy | undefined): Set<string> {
  if (!role?.permissions?.length) return new Set()
  return new Set(role.permissions.map((p) => p.permission.id))
}

export function CopyRolePermissionsBar({ roles, excludeRoleId, setSel }: Props) {
  const [sourceId, setSourceId] = useState('')
  const options = roles.filter((r) => r.id !== excludeRoleId)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Copiar desde un rol existente</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
        Elegí un rol del taller y aplicá sus permisos como punto de partida o sumalos a lo que ya marcaste.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block min-w-[12rem] flex-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Rol origen</span>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="va-field mt-1 w-full"
          >
            <option value="">— Elegir —</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!sourceId}
            className="va-btn-primary !min-h-0 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              const role = roles.find((x) => x.id === sourceId)
              setSel(permissionIdsFromRole(role))
            }}
          >
            Usar solo estos permisos
          </button>
          <button
            type="button"
            disabled={!sourceId}
            className="va-btn-secondary !min-h-0 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              const role = roles.find((x) => x.id === sourceId)
              const add = permissionIdsFromRole(role)
              setSel((prev) => new Set([...prev, ...add]))
            }}
          >
            Sumar permisos del rol
          </button>
        </div>
      </div>
    </div>
  )
}
