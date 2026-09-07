import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import {
  auditActionTitleEs,
  auditActionTone,
  auditEntityTitleEs,
  auditHttpSummary,
  auditToneBadgeClass,
  type AuditTone,
} from '../../i18n/auditLogPresentation'
import {
  auditDetailModalSubtitle,
  auditDetailModalTitle,
  buildAuditDetailSections,
  type AuditRowForDetail,
} from '../../i18n/auditLogDetail'
import { PageHeader } from '../../components/layout/PageHeader'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'

type AuditItem = AuditRowForDetail & { id: string }

type AuditResult = {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const btnDetail =
  'min-h-[44px] w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-brand-950 sm:min-h-0 sm:w-auto'

function AuditRowCard({ row, onOpenDetail }: { row: AuditItem; onOpenDetail: (row: AuditItem) => void }) {
  const isSaas = panelUsesModernShell(usePanelTheme())
  const actionLabel = auditActionTitleEs(row.action)
  const entityLabel = auditEntityTitleEs(row.entityType)
  const tone = auditActionTone(row.action)
  const httpExtra = row.entityType === 'HTTP' ? auditHttpSummary(row.nextPayload) : null
  const surfaceClass = isSaas ? 'va-saas-page-section !space-y-0' : 'va-card !p-4'

  return (
    <article className={surfaceClass} aria-label={`Evento ${actionLabel}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <time
          className="font-mono text-xs text-slate-600 dark:text-slate-300"
          dateTime={row.createdAt}
        >
          {new Date(row.createdAt).toLocaleString()}
        </time>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${auditToneBadgeClass(tone)}`}
        >
          {toneLabel(tone)}
        </span>
      </div>
      <h2 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50">{actionLabel}</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        <span className="font-medium text-slate-800 dark:text-slate-200">{entityLabel}</span>
        {row.entityId && <span className="text-slate-500 dark:text-slate-500"> · ver ID abajo</span>}
      </p>
      {httpExtra && (
        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {httpExtra}
        </p>
      )}
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
        <span className="text-slate-500 dark:text-slate-300">Quién: </span>
        {row.actor?.fullName ?? row.actor?.email ?? 'Sistema o sesión anónima'}
      </p>
      {row.entityId && (
        <details className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 dark:text-slate-300">
            Ver ID interno
          </summary>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-500">
            {row.entityId}
          </p>
        </details>
      )}
      <p className="mt-2 font-mono text-[10px] text-slate-400 dark:text-slate-500">Código: {row.action}</p>
      <button type="button" className={`${btnDetail} mt-3`} onClick={() => onOpenDetail(row)}>
        Ver detalles
      </button>
    </article>
  )
}

function toneLabel(t: AuditTone): string {
  const m: Record<AuditTone, string> = {
    http: 'API',
    auth: 'Acceso',
    cash: 'Caja',
    orders: 'Taller',
    inventory: 'Stock',
    people: 'Personas',
    security: 'Seguridad',
    neutral: 'General',
  }
  return m[t]
}

function AuditDetailModal({ row, onClose }: { row: AuditItem; onClose: () => void }) {
  const isSaas = panelUsesModernShell(usePanelTheme())
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const { sections, fullJson } = buildAuditDetailSections(row)
  const title = auditDetailModalTitle(row)
  const subtitle = auditDetailModalSubtitle(row)
  const when = new Date(row.createdAt).toLocaleString()
  const who = row.actor?.fullName ?? row.actor?.email ?? 'Sistema o sesión anónima'

  const metaDlClass = isSaas
    ? 'mt-4 grid gap-2 rounded-xl border border-[var(--va-surface-border)] bg-[var(--va-surface-muted)] px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-900'
    : 'mt-4 grid gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-800'
  const sectionHeadingClass = isSaas ? 'va-section-title text-sm' : 'text-sm font-semibold text-slate-900 dark:text-slate-50'
  const jsonDetailsClass = isSaas
    ? 'mt-6 rounded-xl border border-[var(--va-surface-border)] bg-[var(--va-surface-muted)] dark:border-slate-700 dark:bg-slate-900'
    : 'mt-6 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'

  return (
    <div className="va-modal-overlay z-[90]" role="presentation" onClick={onClose}>
      <div
        className="va-modal-panel max-h-[min(90dvh,920px)] shadow-2xl sm:max-h-[min(85dvh,920px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={isSaas ? 'va-page-eyebrow' : 'text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500'}>
              Detalle del evento
            </p>
            <h2
              id="audit-detail-title"
              className={isSaas ? 'mt-1 va-section-title text-base' : 'mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50'}
            >
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="va-btn-secondary !min-h-0 shrink-0 px-3 py-2 text-sm">
            Cerrar
          </button>
        </div>

        <dl className={metaDlClass}>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">Cuándo</dt>
            <dd className="font-mono text-xs text-slate-800 dark:text-slate-200">{when}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">Quién</dt>
            <dd className="text-slate-800 dark:text-slate-200">{who}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Código técnico
            </dt>
            <dd className="break-all font-mono text-xs text-slate-700 dark:text-slate-300">{row.action}</dd>
          </div>
          {row.entityId && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                ID de entidad
              </dt>
              <dd className="break-all font-mono text-xs text-slate-700 dark:text-slate-300">{row.entityId}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 space-y-5">
          {sections.map((s) => (
            <section key={s.heading}>
              <h3 className={sectionHeadingClass}>{s.heading}</h3>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {s.body}
              </p>
            </section>
          ))}
        </div>

        <details className={jsonDetailsClass}>
          <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            JSON técnico completo
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-slate-200 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-700 dark:text-slate-200">
            {fullJson}
          </pre>
        </details>
      </div>
    </div>
  )
}

export function AuditPage() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AuditResult | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<AuditItem | null>(null)
  const filtersClass = isSaas
    ? 'va-saas-page-section space-y-3 sm:grid sm:grid-cols-12 sm:gap-3 sm:space-y-0'
    : 'va-card space-y-3 sm:grid sm:grid-cols-12 sm:gap-3 sm:space-y-0'
  const tableWrapClass = isSaas
    ? 'va-saas-page-section va-saas-page-section--flush hidden md:block'
    : 'va-card-flush hidden overflow-x-auto md:block'
  const pagerBtnClass = isSaas
    ? 'min-h-[44px] rounded-lg border border-slate-200 bg-[var(--va-surface-elevated)] px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
    : 'min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'

  const search = useCallback(
    async (pageNum: number) => {
      setMsg(null)
      const q = new URLSearchParams()
      if (entityType.trim()) q.set('entityType', entityType.trim())
      if (entityId.trim()) q.set('entityId', entityId.trim())
      if (action.trim()) q.set('action', action.trim())
      q.set('page', String(pageNum))
      q.set('pageSize', '25')
      try {
        const res = await api<AuditResult>(`/audit-logs?${q.toString()}`)
        setData(res)
      } catch {
        setMsg('No se pudo cargar el registro. Probá de nuevo.')
      }
    },
    [entityType, entityId, action],
  )

  useEffect(() => {
    void search(page)
  }, [page, search])

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Registro de auditoría"
        description={
          <>
            Historial de acciones relevantes (caja, usuarios, órdenes, etc.). Usá{' '}
            <strong className="font-semibold">Ver detalles</strong> en cada fila para leer el contexto en español y el
            JSON completo si lo necesitás.
          </>
        }
      />
      <form
        className={filtersClass}
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          void search(1)
        }}
      >
        <p className="text-xs text-slate-500 dark:text-slate-300 sm:col-span-12">
          Filtros avanzados: podés pegar el tipo de entidad exacto (ej. <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">User</code>) si
          lo indica soporte.
        </p>
        <label className="block sm:col-span-3">
          <span className="va-label">Tipo de entidad (opcional)</span>
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="va-field"
            placeholder="Ej. User, CashSession"
          />
        </label>
        <label className="block sm:col-span-3">
          <span className="va-label">ID de entidad (opcional)</span>
          <input value={entityId} onChange={(e) => setEntityId(e.target.value)} className="va-field" />
        </label>
        <label className="block sm:col-span-4">
          <span className="va-label">Texto en la acción (opcional)</span>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="va-field"
            placeholder="Ej. login, cash_sessions"
          />
        </label>
        <div className="flex items-end sm:col-span-2">
          <button type="submit" className="va-btn-primary w-full">
            Buscar
          </button>
        </div>
      </form>
      {msg && (
        <p className="va-alert-error">
          {msg}
        </p>
      )}
      {data && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-300">
            Página {data.page} de {data.totalPages} · {data.total} eventos
          </p>

          <div className="grid gap-3 md:hidden">
            {data.items.map((row) => (
              <AuditRowCard key={row.id} row={row} onOpenDetail={setDetailRow} />
            ))}
          </div>

          <div className={tableWrapClass}>
            <div className={isSaas ? 'va-table-scroll' : 'overflow-x-auto'}>
            <table className={isSaas ? 'va-table min-w-[780px]' : 'w-full min-w-[780px] text-left text-sm'}>
              <thead>
                <tr className={isSaas ? 'va-table-head-row' : 'border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}>
                  <th className={isSaas ? 'va-table-th' : 'px-3 py-3'}>Fecha</th>
                  <th className={isSaas ? 'va-table-th' : 'px-3 py-3'}>Quién</th>
                  <th className={isSaas ? 'va-table-th' : 'px-3 py-3'}>Qué ocurrió</th>
                  <th className={isSaas ? 'va-table-th' : 'px-3 py-3'}>Sobre</th>
                  <th className={isSaas ? 'va-table-th' : 'px-3 py-3'}> </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const tone = auditActionTone(row.action)
                  const httpExtra = row.entityType === 'HTTP' ? auditHttpSummary(row.nextPayload) : null
                  return (
                    <tr
                      key={row.id}
                      className={isSaas ? 'va-table-body-row' : 'border-b border-slate-100 last:border-0 dark:border-slate-800'}
                    >
                      <td
                        className={
                          isSaas
                            ? 'va-table-td whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300'
                            : 'whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-300'
                        }
                      >
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className={isSaas ? 'va-table-td text-slate-800 dark:text-slate-200' : 'px-3 py-2.5 text-slate-800 dark:text-slate-200'}>
                        {row.actor?.fullName ?? row.actor?.email ?? '—'}
                      </td>
                      <td className={isSaas ? 'va-table-td' : 'px-3 py-2.5'}>
                        <span
                          className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${auditToneBadgeClass(tone)}`}
                        >
                          {toneLabel(tone)}
                        </span>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {auditActionTitleEs(row.action)}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{row.action}</p>
                        {httpExtra && (
                          <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {httpExtra}
                          </p>
                        )}
                      </td>
                      <td className={isSaas ? 'va-table-td text-slate-700 dark:text-slate-300' : 'px-3 py-2.5 text-slate-700 dark:text-slate-300'}>
                        <p className="font-medium">{auditEntityTitleEs(row.entityType)}</p>
                        {row.entityId && (
                          <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500 dark:text-slate-500">
                            ID: {row.entityId}
                          </p>
                        )}
                      </td>
                      <td className={isSaas ? 'va-table-td whitespace-nowrap align-top' : 'whitespace-nowrap px-3 py-2.5 align-top'}>
                        <button type="button" className={btnDetail} onClick={() => setDetailRow(row)}>
                          Ver detalles
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className={pagerBtnClass}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= (data?.totalPages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
              className={pagerBtnClass}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
      {detailRow && <AuditDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  )
}
