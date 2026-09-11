import type { ReactNode } from 'react'
import { panelUsesModernShell } from '../../config/operationalNotes'
import { usePanelTheme } from '../../theme/PanelThemeProvider'

type Props = {
  /** Enlace “volver” u otro bloque encima del título (detalle, vista previa). */
  beforeTitle?: ReactNode
  /** Rótulo pequeño sobre el título (p. ej. “Administración”). */
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Alinea las acciones arriba (nivel del enlace “volver”) en vez de abajo, junto a la descripción. */
  actionsTop?: boolean
  /** Clases extra en el contenedor raíz (clásico: borde inferior de cabecera, etc.). */
  rootClassName?: string
}

/**
 * Cabecera de página: `va-page-title` / `va-page-desc` / `va-page-eyebrow` centralizan tipografía;
 * en `saas_light` el contenedor usa `va-saas-page-hero`.
 */
export function PageHeader({
  beforeTitle,
  eyebrow,
  title,
  description,
  actions,
  actionsTop,
  rootClassName,
}: Props) {
  const isSaas = panelUsesModernShell(usePanelTheme())

  const titleClassName = beforeTitle ? 'mt-2 va-page-title' : 'va-page-title'

  const leftColumn = (
    <div className={isSaas ? 'min-w-0 w-full flex-1' : 'min-w-0'}>
      {beforeTitle ? <div>{beforeTitle}</div> : null}
      {eyebrow ? <p className="va-page-eyebrow">{eyebrow}</p> : null}
      <h1 className={titleClassName}>{title}</h1>
      {description ? <div className="va-page-desc">{description}</div> : null}
    </div>
  )

  const inner = (
    <>
      {leftColumn}
      {actions ? (
        <div className={`flex shrink-0 flex-wrap gap-2${actionsTop ? ' sm:self-start' : ''}`}>{actions}</div>
      ) : null}
    </>
  )

  const rootExtra = rootClassName?.trim() ?? ''
  const classicRoot = ['flex flex-col justify-between gap-3 sm:flex-row sm:items-end', rootExtra].filter(Boolean).join(' ')
  const saasRoot = ['va-saas-page-hero', rootExtra].filter(Boolean).join(' ')

  if (isSaas) {
    return (
      <div className={saasRoot}>
        <div className="va-saas-page-header-row">{inner}</div>
      </div>
    )
  }

  return <div className={classicRoot}>{inner}</div>
}
