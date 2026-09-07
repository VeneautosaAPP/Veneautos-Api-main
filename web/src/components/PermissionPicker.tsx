import { useMemo, useState } from 'react'
import type { PermissionRow } from '../api/types'
import {
  permissionPresentation,
  permissionSearchBlob,
  resourceTitleEs,
} from '../i18n/permissionPresentation'

export type { PermissionRow } from '../api/types'

function groupPermissions(rows: PermissionRow[]): Map<string, PermissionRow[]> {
  const m = new Map<string, PermissionRow[]>()
  for (const p of rows) {
    const list = m.get(p.resource) ?? []
    list.push(p)
    m.set(p.resource, list)
  }
  for (const list of m.values()) {
    list.sort((a, b) => a.action.localeCompare(b.action))
  }
  return new Map([...m.entries()].sort((a, b) => resourceTitleEs(a[0]).localeCompare(resourceTitleEs(b[0]))))
}

export function PermissionPicker({
  permissions,
  selectedIds,
  onChange,
  disabled,
}: {
  permissions: PermissionRow[]
  selectedIds: Set<string>
  onChange: (ids: Set<string>) => void
  disabled?: boolean
}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => groupPermissions(permissions), [permissions])

  const fl = filter.trim().toLowerCase()

  function toggle(id: string, checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    onChange(next)
  }

  function toggleResource(_resource: string, list: PermissionRow[], checked: boolean) {
    const next = new Set(selectedIds)
    for (const p of list) {
      if (checked) next.add(p.id)
      else next.delete(p.id)
    }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        Marcá solo lo necesario para el puesto. Cada permiso indica qué puede hacer la persona en el
        sistema; el código interno sirve para soporte y no define poderes por sí solo.
      </p>
      <input
        type="search"
        placeholder="Buscar por nombre, descripción o código…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
        disabled={disabled}
      />
      <div className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
        {[...groups.entries()].map(([resource, list]) => {
          const filtered = fl
            ? list.filter((p) => permissionSearchBlob(p).includes(fl))
            : list
          if (!filtered.length) return null
          const allSel = filtered.every((p) => selectedIds.has(p.id))
          const someSel = filtered.some((p) => selectedIds.has(p.id))
          const isOpen = open[resource] ?? true
          const groupTitle = resourceTitleEs(resource)
          return (
            <div
              key={resource}
              className="rounded-lg border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-2 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => {
                    if (el) el.indeterminate = someSel && !allSel
                  }}
                  disabled={disabled}
                  onChange={(e) => toggleResource(resource, filtered, e.target.checked)}
                  aria-label={`Seleccionar todo en ${groupTitle}`}
                />
                <button
                  type="button"
                  className="flex-1 text-left text-sm font-semibold text-slate-900 dark:text-slate-100"
                  onClick={() => setOpen((o) => ({ ...o, [resource]: !isOpen }))}
                >
                  {groupTitle}
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-300">
                    ({filtered.filter((p) => selectedIds.has(p.id)).length}/{filtered.length})
                  </span>
                </button>
              </div>
              {isOpen && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {filtered.map((p) => {
                    const { title, detail, technicalCode } = permissionPresentation(p)
                    return (
                      <li key={p.id} className="flex items-start gap-2 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="mt-1.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-500 dark:bg-slate-900"
                          checked={selectedIds.has(p.id)}
                          disabled={disabled}
                          onChange={(e) => toggle(p.id, e.target.checked)}
                          aria-describedby={`${p.id}-desc`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
                          <p id={`${p.id}-desc`} className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            {detail}
                          </p>
                          <details className="mt-1.5">
                            <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-500 underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300">
                              Código técnico (soporte)
                            </summary>
                            <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-500">
                              {technicalCode}
                            </p>
                          </details>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
