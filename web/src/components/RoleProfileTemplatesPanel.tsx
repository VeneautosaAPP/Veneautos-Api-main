import type { Dispatch, SetStateAction } from 'react'
import type { PermissionRow } from '../api/types'
import {
  ROLE_TEMPLATES,
  codesToSelectedIds,
  resolveTemplatePermissionRows,
  unionPermissionCodes,
} from '../config/roleTemplates'

type Props = {
  permissions: PermissionRow[]
  checkedTemplateIds: Set<string>
  setCheckedTemplateIds: Dispatch<SetStateAction<Set<string>>>
  setSel: Dispatch<SetStateAction<Set<string>>>
}

export function RoleProfileTemplatesPanel({
  permissions,
  checkedTemplateIds,
  setCheckedTemplateIds,
  setSel,
}: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Perfiles predefinidos (opcional)</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-300">
        Podés marcar varios perfiles a la vez: se unen todos los permisos (por ejemplo,{' '}
        <span className="font-medium text-slate-600 dark:text-slate-300">Mecánico + Inventario</span> para que la
        misma persona atienda taller y stock). Luego reemplazá o sumá al listado manual de abajo.
      </p>
      {permissions.length === 0 && (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
          Sin acceso al listado de permisos no se pueden mostrar las descripciones del catálogo; igual podés aplicar
          perfiles si tenés permiso para usarlos.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {ROLE_TEMPLATES.map((t) => {
          const rows = resolveTemplatePermissionRows(permissions, t.permissionCodes)
          return (
            <li
              key={t.id}
              className="rounded-lg border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900"
            >
              <label className="flex cursor-pointer gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-500"
                  checked={checkedTemplateIds.has(t.id)}
                  onChange={() => {
                    setCheckedTemplateIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(t.id)) next.delete(t.id)
                      else next.add(t.id)
                      return next
                    })
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-300">{t.description}</span>
                </span>
              </label>
              <details className="border-t border-slate-200 dark:border-slate-600">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-brand-700 hover:bg-slate-50 dark:text-brand-300 dark:hover:bg-slate-800">
                  <span className="inline-flex items-center gap-1">
                    Ver permisos del catálogo
                    <span className="font-normal text-slate-500 dark:text-slate-300">
                      ({t.permissionCodes.length})
                    </span>
                  </span>
                </summary>
                <ul className="space-y-2 border-t border-slate-100 px-3 py-2 dark:border-slate-700">
                  {rows.map((r) => (
                    <li key={r.code} className="text-xs leading-snug">
                      <p className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{r.code}</p>
                      {r.missingFromCatalog ? (
                        <p className="mt-0.5 text-amber-800 dark:text-amber-200">
                          No aparece en el catálogo cargado; revisá el API o el seed.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                          {r.description ?? 'Sin descripción en el catálogo.'}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={checkedTemplateIds.size === 0}
          className="va-btn-primary !min-h-0 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            const codes = unionPermissionCodes(checkedTemplateIds)
            setSel(codesToSelectedIds(permissions, codes))
          }}
        >
          Usar solo estos perfiles
        </button>
        <button
          type="button"
          disabled={checkedTemplateIds.size === 0}
          className="va-btn-secondary !min-h-0 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            const codes = unionPermissionCodes(checkedTemplateIds)
            const add = codesToSelectedIds(permissions, codes)
            setSel((prev) => new Set([...prev, ...add]))
          }}
        >
          Sumar perfiles a lo ya elegido
        </button>
      </div>
    </div>
  )
}
