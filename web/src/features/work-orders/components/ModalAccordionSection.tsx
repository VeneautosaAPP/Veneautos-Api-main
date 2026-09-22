import type { ReactNode } from 'react'

type ModalAccordionSectionProps = {
  title: string
  open: boolean
  onToggle: () => void
  contentId: string
  children: ReactNode
}

export function ModalAccordionSection({
  title,
  open,
  onToggle,
  contentId,
  children,
}: ModalAccordionSectionProps) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors ${
        open
          ? 'border-brand-400 dark:border-brand-600'
          : 'border-slate-200 dark:border-slate-600'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
      >
        <span
          className={`text-sm font-semibold ${
            open
              ? 'text-brand-700 dark:text-brand-300'
              : 'text-slate-900 dark:text-slate-50'
          }`}
        >
          {title}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300 dark:text-slate-300 ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <div
        id={contentId}
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4 pt-3">{children}</div>
        </div>
      </div>
    </div>
  )
}