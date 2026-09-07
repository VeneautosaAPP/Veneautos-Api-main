import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardSection } from './dashboardTypes'

export type DashboardModuleSectionsProps = {
  sections: DashboardSection[]
  sectionClass: string
  cardClass: string
  mutedCardClass: string
}

/**
 * Grillas de tarjetas por sección (Operación, Clientes, Administración, …).
 */
export const DashboardModuleSections = memo(function DashboardModuleSections({
  sections,
  sectionClass,
  cardClass,
  mutedCardClass,
}: DashboardModuleSectionsProps) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.title} className={sectionClass}>
          <div>
            <h2 className="va-section-title">{section.title}</h2>
            <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-slate-500 dark:text-slate-300">
              {section.description}
            </p>
          </div>
          <div
            className={`grid gap-3 sm:grid-cols-2 ${section.title === 'Administración' ? 'xl:grid-cols-2 2xl:grid-cols-3' : 'lg:grid-cols-3 2xl:grid-cols-4'}`}
          >
            {section.modules.map((module) => {
              const Icon = module.icon
              if (!module.enabled) {
                return (
                  <div key={module.title} className={`${mutedCardClass} min-h-[9.5rem]`}>
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <Icon className="size-7" strokeWidth={1.65} aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{module.title}</p>
                        <p className="mt-1 text-sm leading-snug [overflow-wrap:anywhere]">{module.description}</p>
                        {module.hint ? (
                          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{module.hint}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              }
              return (
                <Link
                  key={module.title}
                  to={module.to}
                  className={`${cardClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900`}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200">
                      <Icon className="size-7" strokeWidth={1.65} aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{module.title}</p>
                      <p className="mt-1 text-sm leading-snug text-slate-600 dark:text-slate-300 [overflow-wrap:anywhere]">
                        {module.description}
                      </p>
                      <p className="mt-2 text-xs font-medium text-brand-700 dark:text-brand-300">Abrir módulo</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
})
