import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ScrollText,
  Settings,
  Shield,
  Users,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import type { LoginResponse } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { CashSessionOpenProvider } from '../context/CashSessionOpenContext'
import { usePanelTheme } from '../theme/PanelThemeProvider'
import { panelUsesModernShell } from '../config/operationalNotes'
import { portalPath } from '../constants/portalPath'
import { setStoredLastModulePath } from '../services/lastModuleStorage'
import { prefetchCashShellQueries } from '../features/cash/cashPrefetch'
import { prefetchSettingsAdminPanel } from '../features/settings/prefetchSettingsNav'
import { prefetchDefaultWorkOrdersList } from '../features/work-orders/prefetch/workOrdersNavPrefetch'
import { WorkOrderStatusAlertsBell } from '../features/work-orders'
import { FullscreenToggle } from './FullscreenToggle'

type PreviewRoleRow = { id: string; name: string; slug: string; isSystem: boolean }

/**
 * Campanita de alertas de OT: oculta por decisión de producto, pero el componente y su
 * cableado se conservan para reutilizarlos más adelante. Volver a `true` para reactivarla.
 */
const SHOW_WORK_ORDER_ALERTS_BELL = false

function activeNavTo(pathname: string, linkTos: readonly string[]): string | null {
  const matches = linkTos.filter((to) => pathname === to || pathname.startsWith(`${to}/`))
  if (matches.length === 0) return null
  return matches.reduce((a, b) => (a.length >= b.length ? a : b))
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Logo corporativo del panel (solo oscuro: se descartó el tema claro). */
const PANEL_BRAND_LOGO = '/logo_panel.png'

function PanelBrandLogo({ className }: { className?: string }) {
  return <img src={PANEL_BRAND_LOGO} alt="Vene Autos" draggable={false} className={className} decoding="async" />
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative z-10 inline-flex min-h-[44px] shrink-0 snap-start items-center rounded-xl px-3 py-2.5 text-sm font-medium uppercase tracking-wide transition-[color,transform] duration-300 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white md:min-h-0 md:py-2 dark:focus-visible:ring-offset-slate-900',
    isActive
      ? 'text-brand-900 dark:text-white'
      : 'text-slate-700 hover:bg-slate-200 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  ].join(' ')

/** Carril horizontal móvil (tema SaaS): tipografía estilo referencia, con icono. */
const navLinkHorizontalSaasClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative z-10 inline-flex min-h-[44px] shrink-0 snap-start items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium tracking-normal transition-[color,transform] duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white md:min-h-0 md:py-2 dark:focus-visible:ring-offset-slate-900',
    isActive
      ? 'text-brand-800 dark:text-white [&_svg]:opacity-100'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white [&_svg]:opacity-[0.88]',
  ].join(' ')

/** Sidebar escritorio (tema SaaS): icono + texto, estilo Rhombus. */
const navLinkSidebarSaasClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative z-10 flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium tracking-normal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:min-h-0',
    isActive
      ? 'text-brand-800 dark:text-white [&_svg]:opacity-100'
      : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white [&_svg]:opacity-[0.88]',
  ].join(' ')

type NavLinkItem = {
  to: string
  label: string
  show: boolean
  Icon: LucideIcon
}

function saasIconButtonClass() {
  return 'rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100 dark:focus-visible:ring-offset-slate-900'
}

const SAAS_SIDEBAR_COLLAPSED_KEY = 'vene.panel.sidebarCollapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SAAS_SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SAAS_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function AppShellInner() {
  const panelTheme = usePanelTheme()
  const isSaas = panelUsesModernShell(panelTheme)
  const shellMaxClass = isSaas
    ? 'max-w-[min(88rem,calc(100vw-1rem))] 2xl:max-w-[min(96rem,calc(100vw-1.5rem))]'
    : 'max-w-6xl'

  const { user, logout, can, applyAuthResponse } = useAuth()
  const handleLogout = useCallback(() => {
    void logout()
  }, [logout])
  const location = useLocation()
  const queryClient = useQueryClient()
  const prefetchNavHints = useCallback(
    (to: string) => {
      if (to === portalPath('/caja')) prefetchCashShellQueries(queryClient)
      else if (to === portalPath('/ordenes')) prefetchDefaultWorkOrdersList(queryClient)
      else if (to === portalPath('/admin/configuracion') && can('settings:read')) {
        prefetchSettingsAdminPanel(queryClient, {
          prefetchUsersList: can('users:reset_password'),
        })
      }
    },
    [can, queryClient],
  )
  const [saasSidebarCollapsed, setSaasSidebarCollapsed] = useState(readSidebarCollapsed)

  const toggleSaasSidebar = useCallback(() => {
    setSaasSidebarCollapsed((c) => {
      const next = !c
      writeSidebarCollapsed(next)
      return next
    })
  }, [])

  /** Menú lateral móvil: oculto por defecto, se desliza desde la izquierda al abrirse. */
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuClose = useCallback(() => setMobileMenuOpen(false), [])
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  /** Gestos táctiles (patrón autopiezas-tegui): abrir deslizando desde el borde izq., cerrar deslizando a la izq. */
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const isTouchViewport = useCallback(() => {
    if (typeof window === 'undefined') return false
    return !window.matchMedia('(min-width: 1024px)').matches
  }, [])
  const onShellTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!isTouchViewport()) return
      const touch = e.touches[0]
      if (!touch) return
      swipeStart.current = { x: touch.clientX, y: touch.clientY }
    },
    [isTouchViewport],
  )
  const onShellTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!isTouchViewport()) return
      const start = swipeStart.current
      swipeStart.current = null
      const touch = e.changedTouches[0]
      if (!start || !touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.2) return
      if (mobileMenuOpen) {
        if (dx < 0) setMobileMenuOpen(false)
      } else if (start.x <= 24 && dx > 0) {
        setMobileMenuOpen(true)
      }
    },
    [isTouchViewport, mobileMenuOpen],
  )

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mobileMenuOpen])

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  const [previewRoles, setPreviewRoles] = useState<PreviewRoleRow[]>([])
  const [rolePreviewBusy, setRolePreviewBusy] = useState(false)
  const appShellHeaderRef = useRef<HTMLElement | null>(null)
  const navOuterRef = useRef<HTMLDivElement>(null)
  const navRowRef = useRef<HTMLDivElement>(null)
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map())
  const [pill, setPill] = useState({ left: 0, top: 0, width: 0, height: 0, visible: false })

  const loadPreviewRoleCandidates = useCallback(async () => {
    if (!can('auth:assume_role_preview')) {
      setPreviewRoles([])
      return
    }
    try {
      const list = await api<PreviewRoleRow[]>('/auth/preview-role/candidates')
      setPreviewRoles(Array.isArray(list) ? list : [])
    } catch {
      setPreviewRoles([])
    }
  }, [can])

  useEffect(() => {
    void loadPreviewRoleCandidates()
  }, [loadPreviewRoleCandidates])

  useEffect(() => {
    setStoredLastModulePath(location.pathname)
  }, [location.pathname])

  /**
   * Publica la altura real de la barra superior en `--va-app-header-h` para que las páginas
   * puedan fijar su cabecera justo debajo (`position: sticky`) sin hardcodear medidas.
   */
  useEffect(() => {
    const el = appShellHeaderRef.current
    if (!el) return
    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--va-app-header-h', `${h}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const previewSelectValue = user?.previewRole?.id ?? ''

  const roleOptions = useMemo((): PreviewRoleRow[] => {
    const list = [...previewRoles]
    const pr = user?.previewRole
    if (pr && !list.some((r) => r.id === pr.id)) {
      list.unshift({ id: pr.id, name: pr.name, slug: pr.slug, isSystem: true })
    }
    return list
  }, [previewRoles, user?.previewRole])

  const onPreviewRoleChange = useCallback(
    async (roleId: string) => {
      if (!can('auth:assume_role_preview') || rolePreviewBusy) return
      const current = user?.previewRole?.id ?? ''
      if (roleId === current) return
      setRolePreviewBusy(true)
      try {
        if (roleId === '') {
          const res = await api<LoginResponse>('/auth/preview-role/clear', { method: 'POST' })
          applyAuthResponse(res)
        } else {
          const res = await api<LoginResponse>('/auth/preview-role', {
            method: 'POST',
            body: JSON.stringify({ roleId }),
          })
          applyAuthResponse(res)
        }
      } catch {
        /* sin toast global; el usuario puede reintentar */
      } finally {
        setRolePreviewBusy(false)
      }
    },
    [applyAuthResponse, can, rolePreviewBusy, user?.previewRole?.id],
  )

  const links = useMemo((): NavLinkItem[] => {
    const all: NavLinkItem[] = [
      { to: portalPath('/'), label: 'Inicio', Icon: LayoutDashboard, show: true },
      {
        to: portalPath('/ordenes'),
        label: 'Órdenes',
        Icon: ClipboardList,
        show: can('work_orders:read') || can('work_orders:read_portal'),
      },
      {
        to: portalPath('/caja'),
        label: 'Caja',
        Icon: Wallet,
        show: can('cash_sessions:read'),
      },
      { to: portalPath('/nomina'), label: 'Nómina', Icon: Coins, show: can('payroll:read') },
      { to: portalPath('/clientes'), label: 'Clientes', Icon: Users, show: can('customers:read') },
      { to: portalPath('/repuestos'), label: 'Repuestos', Icon: Package, show: can('repuestos:read') },
      { to: portalPath('/admin/usuarios'), label: 'Usuarios', Icon: UsersRound, show: can('users:read') },
      { to: portalPath('/informes'), label: 'Informes', Icon: BarChart3, show: can('reports:read') },
      { to: portalPath('/admin/roles'), label: 'Roles', Icon: Shield, show: can('roles:read') },
      { to: portalPath('/admin/auditoria'), label: 'Auditoría', Icon: ScrollText, show: can('audit:read') },
      { to: portalPath('/admin/configuracion'), label: 'Configuración', Icon: Settings, show: can('settings:read') || can('tax_rates:read') },
    ]
    return all.filter((l) => l.show)
  }, [can])

  const linkTos = useMemo(() => links.map((l) => l.to), [links])

  const mobileBottomLinks = useMemo(
    () =>
      [portalPath('/'), portalPath('/ordenes'), portalPath('/caja'), portalPath('/clientes')]
        .map((to) => links.find((l) => l.to === to))
        .filter((l): l is NavLinkItem => Boolean(l)),
    [links],
  )

  const horizontalLinkClass = isSaas ? navLinkHorizontalSaasClass : navLinkClass

  const syncPill = useCallback(() => {
    if (isSaas && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setPill((p) => ({ ...p, visible: false }))
      return
    }
    const outer = navOuterRef.current
    const row = navRowRef.current
    if (!outer || !row) return
    const activeTo = activeNavTo(location.pathname, linkTos)
    if (!activeTo) {
      setPill((p) => ({ ...p, visible: false }))
      return
    }
    const el = linkRefs.current.get(activeTo)
    if (!el) {
      setPill((p) => ({ ...p, visible: false }))
      return
    }
    const oRect = outer.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const lineTopPx = el.offsetTop
    let lineHeightPx = el.offsetHeight
    let allSameLine = true
    for (const link of linkRefs.current.values()) {
      if (link.offsetTop !== lineTopPx) allSameLine = false
      if (link.offsetTop === lineTopPx) {
        lineHeightPx = Math.max(lineHeightPx, link.offsetTop + link.offsetHeight - lineTopPx)
      }
    }
    const fullStrip = allSameLine && linkRefs.current.size > 0
    setPill({
      left: eRect.left - oRect.left,
      top: fullStrip ? 0 : row.offsetTop + lineTopPx,
      width: eRect.width,
      height: fullStrip ? outer.offsetHeight : lineHeightPx,
      visible: true,
    })
  }, [location.pathname, linkTos, isSaas])

  useLayoutEffect(() => {
    syncPill()
  }, [syncPill])

  useEffect(() => {
    const outer = navOuterRef.current
    const row = navRowRef.current
    if (!outer || !row) return
    const ro = new ResizeObserver(() => syncPill())
    ro.observe(outer)
    ro.observe(row)
    row.addEventListener('scroll', syncPill, { passive: true })
    window.addEventListener('resize', syncPill)
    return () => {
      ro.disconnect()
      row.removeEventListener('scroll', syncPill)
      window.removeEventListener('resize', syncPill)
    }
  }, [syncPill])

  const userSubtitle =
    user?.previewRole?.name ?? (user?.roleSlugs?.[0] ? user.roleSlugs[0].replace(/_/g, ' ') : 'Usuario')

  /**
   * Selector «Vista por rol» («Mis permisos»). Se reutiliza en la cabecera (móvil) y al pie del
   * menú lateral (escritorio), con `id` propio en cada sitio para no duplicar identificadores.
   */
  const renderRolePreviewSelect = (opts: {
    id: string
    placeholder: string
    wrapperClass?: string
    selectClass: string
    withBadge?: boolean
  }) => {
    if (!can('auth:assume_role_preview')) return null
    return (
      <div className={`flex min-w-0 items-center gap-1 ${opts.wrapperClass ?? ''}`}>
        <label className="sr-only" htmlFor={opts.id}>
          Vista por rol (simulación)
        </label>
        <select
          id={opts.id}
          disabled={rolePreviewBusy}
          value={previewSelectValue}
          onChange={(e) => void onPreviewRoleChange(e.target.value)}
          className={`${opts.selectClass} ${
            user?.previewRole ? 'ring-1 ring-amber-400 dark:ring-amber-500' : ''
          }`}
          title="Probá la app con otro rol; seguís siendo el mismo usuario."
        >
          <option value="">{opts.placeholder}</option>
          {roleOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {opts.withBadge && user?.previewRole ? (
          <span
            className="hidden shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-amber-800 dark:bg-amber-950 dark:text-amber-100 sm:inline"
            title="No es tu sesión operativa habitual: solo permisos simulados."
          >
            Simulando
          </span>
        ) : null}
      </div>
    )
  }

  const classicToolbar = user && (
    <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
      {renderRolePreviewSelect({
        id: 'header-role-preview',
        placeholder: 'Mis permisos reales',
        wrapperClass: 'max-w-[10.5rem] sm:max-w-[13rem]',
        selectClass: 'va-field max-w-full cursor-pointer py-1.5 pr-7 text-xs font-medium sm:text-sm',
        withBadge: true,
      })}
      <span className="hidden max-w-[7rem] truncate text-sm text-slate-600 sm:inline sm:max-w-[9rem] md:max-w-[14rem] dark:text-slate-300">
        {user.fullName}
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className={`${isSaas ? 'rounded-lg' : 'rounded-xl'} border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 sm:px-3 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`}
      >
        Salir
      </button>
    </div>
  )

  const saasToolbar = user && (
    <div className="flex shrink-0 items-center gap-1.5">
      {SHOW_WORK_ORDER_ALERTS_BELL ? (
        <WorkOrderStatusAlertsBell iconButtonClassName={saasIconButtonClass()} />
      ) : null}
      <FullscreenToggle className={saasIconButtonClass()} />
      <button
        type="button"
        onClick={handleLogout}
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className={saasIconButtonClass()}
      >
        <LogOut className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )

  const horizontalNav =
    links.length > 0 ? (
      <nav
        className={`va-app-shell-subnav border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 ${isSaas ? 'hidden' : 'bg-slate-100 dark:shadow-[inset_0_1px_0_0_rgba(148,163,184,0.08)]'}`}
      >
        <div ref={navOuterRef} className={`relative mx-auto w-full px-3 py-2 sm:px-4 xl:px-5 ${shellMaxClass}`}>
          <div
            ref={navRowRef}
            className="va-app-shell-navlinks relative z-10 -mx-1 flex snap-x snap-proximity items-center gap-1 overflow-x-auto [-ms-overflow-style:none] md:flex-wrap md:overflow-visible md:snap-none [&::-webkit-scrollbar]:hidden"
            aria-label="Navegación principal"
          >
            {links.map((l) => {
              const Icon = l.Icon
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  ref={(node) => {
                    if (node) linkRefs.current.set(l.to, node)
                    else linkRefs.current.delete(l.to)
                  }}
                  className={horizontalLinkClass}
                >
                  {isSaas ? <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden /> : null}
                  <span>{l.label}</span>
                </NavLink>
              )
            })}
          </div>
          <div
            aria-hidden
            className={`va-app-shell-nav-pill pointer-events-none absolute z-0 transition-[left,top,width,height,opacity] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] motion-reduce:transition-none ${
              pill.visible ? 'opacity-100' : 'opacity-0'
            } ${
              isSaas
                ? ''
                : 'rounded-xl bg-brand-100 shadow-sm ring-1 ring-brand-200 dark:bg-brand-900 dark:shadow-md dark:ring-1 dark:ring-brand-600'
            }`}
            style={{
              left: pill.left,
              top: pill.top,
              width: Math.max(0, pill.width),
              height: Math.max(0, pill.height),
            }}
          />
        </div>
      </nav>
    ) : null

  return (
    <div
      className={`va-app-shell flex min-h-dvh flex-col bg-slate-100 dark:bg-slate-950 ${isSaas ? 'lg:flex-row lg:items-stretch' : ''}`}
      onTouchStart={onShellTouchStart}
      onTouchEnd={onShellTouchEnd}
    >
      <a
        href="#app-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[120] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-900 focus:shadow-md dark:focus:bg-slate-800 dark:focus:text-slate-100"
      >
        Saltar al contenido principal
      </a>
      {isSaas && (
        <aside
          className={`va-app-shell-sidebar hidden shrink-0 flex-col transition-[width] duration-200 ease-out motion-reduce:transition-none lg:sticky lg:top-0 lg:z-20 lg:flex lg:h-dvh lg:max-h-dvh lg:min-h-0 ${
            saasSidebarCollapsed ? 'w-14 lg:w-14 2xl:w-14' : 'w-64 2xl:w-72'
          }`}
        >
          <div
            className={`flex shrink-0 items-center ${
              saasSidebarCollapsed
                ? 'min-h-[3.5rem] flex-col justify-center gap-1.5 py-2'
                : 'h-[3.5rem] gap-2 px-2.5 sm:px-3.5'
            }`}
          >
            {!saasSidebarCollapsed ? (
              <>
                <NavLink
                  to={portalPath('/')}
                  className="va-app-shell-brand flex min-w-0 flex-1 items-center overflow-hidden rounded-md outline-offset-2"
                  end
                >
                  <PanelBrandLogo className="h-8 w-auto max-h-9 max-w-[min(100%,11rem)] shrink object-contain object-left" />
                </NavLink>
                <button
                  type="button"
                  onClick={toggleSaasSidebar}
                  className={`${saasIconButtonClass()} !p-2`}
                  title="Ocultar menú lateral"
                  aria-expanded={!saasSidebarCollapsed}
                  aria-controls="va-saas-sidebar-nav"
                  aria-label="Ocultar menú lateral"
                >
                  <ChevronLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleSaasSidebar}
                  className={`${saasIconButtonClass()} !p-2`}
                  title="Mostrar menú lateral"
                  aria-expanded={false}
                  aria-controls="va-saas-sidebar-nav"
                  aria-label="Mostrar menú lateral"
                >
                  <ChevronRight className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                </button>
                <NavLink
                  to={portalPath('/')}
                  className="flex shrink-0 rounded-md p-0.5 transition hover:bg-white dark:hover:bg-slate-800"
                  title="Inicio"
                  aria-label="Inicio"
                  end
                >
                  <PanelBrandLogo className="size-8 max-h-8 w-auto max-w-[7rem] object-contain object-left" />
                </NavLink>
              </>
            )}
          </div>
          <nav
            id="va-saas-sidebar-nav"
            className={`flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden ${saasSidebarCollapsed ? 'px-1 py-2' : 'p-3'}`}
            aria-label="Navegación principal"
          >
            {links.map((l) => {
              const Icon = l.Icon
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  title={l.label}
                  aria-label={saasSidebarCollapsed ? l.label : undefined}
                  onPointerEnter={() => prefetchNavHints(l.to)}
                  className={(args) =>
                    [navLinkSidebarSaasClass(args), saasSidebarCollapsed ? 'justify-center gap-0 px-1.5' : ''].join(' ')
                  }
                >
                  <Icon className="size-[1.125rem] shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className={saasSidebarCollapsed ? 'sr-only' : 'truncate'}>{l.label}</span>
                </NavLink>
              )
            })}
          </nav>
          {user && (
            <div
              className={`flex shrink-0 flex-col gap-2 border-t border-slate-200 dark:border-slate-800 ${
                saasSidebarCollapsed ? 'px-1 py-3' : 'px-3 py-3'
              }`}
            >
              {!saasSidebarCollapsed
                ? renderRolePreviewSelect({
                    id: 'sidebar-role-preview',
                    placeholder: 'Mis permisos',
                    wrapperClass: 'w-full',
                    selectClass:
                      'va-field w-full cursor-pointer rounded-lg border-slate-200 py-1.5 pr-6 text-xs font-medium dark:border-slate-600',
                    withBadge: true,
                  })
                : null}
              <button
                type="button"
                onClick={handleLogout}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className={`flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 hover:text-red-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-red-400 ${
                  saasSidebarCollapsed ? 'justify-center' : ''
                }`}
              >
                <LogOut className="size-[1.125rem] shrink-0" strokeWidth={1.75} aria-hidden />
                {!saasSidebarCollapsed ? <span className="truncate">Salir</span> : null}
              </button>
              <div
                className={`flex items-center gap-2.5 ${saasSidebarCollapsed ? 'justify-center' : ''}`}
              >
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-slate-700 dark:text-white"
                  aria-hidden
                >
                  {initialsFromName(user.fullName)}
                </div>
                {!saasSidebarCollapsed && (
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="va-app-shell-meta-strong truncate">{user.fullName}</p>
                    <p className="va-app-shell-meta capitalize truncate">{userSubtitle}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          ref={appShellHeaderRef}
          className={`va-app-shell-header sticky top-0 z-30 border-b border-slate-300 backdrop-blur-md dark:border-slate-800 ${isSaas ? 'border-slate-200 bg-white dark:bg-slate-900 lg:hidden' : 'bg-white dark:bg-slate-900'} ${isFullscreen ? 'hidden' : ''}`}
        >
          {isSaas && user ? (
            <div
              className={`mx-auto flex w-full items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5 xl:px-5 ${shellMaxClass} ${
                isFullscreen ? 'hidden' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className={`${saasIconButtonClass()} !p-2`}
                  title="Abrir menú"
                  aria-label="Abrir menú"
                  aria-expanded={mobileMenuOpen}
                  aria-controls="va-mobile-sidebar"
                >
                  <Menu className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                </button>
                <NavLink
                  to={portalPath('/')}
                  className="va-app-shell-brand flex min-w-0 items-center overflow-hidden rounded-md outline-offset-2"
                  end
                >
                  <PanelBrandLogo className="h-7 w-auto max-w-[min(52vw,13rem)] object-contain object-left sm:h-8 sm:max-w-[14rem]" />
                </NavLink>
              </div>
              {saasToolbar}
            </div>
          ) : (
            <div
              className={`mx-auto flex w-full items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 xl:px-5 ${shellMaxClass} ${isSaas ? 'lg:justify-end' : ''}`}
            >
              <NavLink
                to={portalPath('/')}
                className={`va-app-shell-brand flex min-w-0 shrink items-center overflow-hidden rounded-md outline-offset-2 ${isSaas && user ? 'lg:hidden' : ''}`}
                end
              >
                <PanelBrandLogo className="h-8 w-auto max-w-[min(72vw,13rem)] object-contain object-left sm:max-w-[15rem]" />
              </NavLink>
              {classicToolbar}
            </div>
          )}
          {horizontalNav}
        </header>

        <main
          id="app-main-content"
          className={`va-app-shell-main mx-auto w-full flex-1 px-3 pt-4 sm:px-4 sm:pt-6 ${isFullscreen ? 'pb-4 sm:pb-6' : 'pb-16 sm:pb-16'} lg:pb-7 xl:px-5 xl:py-7 ${shellMaxClass}`}
        >
          <Outlet />
        </main>

        <footer className="va-app-shell-footer mt-auto border-t border-slate-300 px-3 py-4 text-center text-xs text-slate-600 sm:px-4 xl:px-5 dark:border-slate-800 dark:text-slate-300">
          <div className={`mx-auto text-left ${shellMaxClass}`}>Vene Autos — panel del taller</div>
        </footer>
      </div>

      {isSaas && (
        <nav
          aria-label="Barra inferior móvil"
          className={`fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 gap-0.5 border-t border-slate-200 bg-white px-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1 lg:hidden dark:border-slate-800 dark:bg-slate-900 ${
            isFullscreen ? 'hidden' : ''
          }`}
        >
          {mobileBottomLinks.map(({ to, label, Icon }) => {
            const active = location.pathname === to || location.pathname.startsWith(`${to}/`)
            return (
              <NavLink
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                onClick={mobileMenuClose}
                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold ${
                  active
                    ? 'text-brand-700 dark:text-brand-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.5 : 2} aria-hidden />
                <span className="truncate">{label}</span>
              </NavLink>
            )
          })}
          <button
            type="button"
            aria-label="Abrir más opciones"
            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold ${
              mobileMenuOpen
                ? 'text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={19} strokeWidth={2} aria-hidden />
            <span>Más</span>
          </button>
        </nav>
      )}

      {isSaas && (
        <>
          {mobileMenuOpen ? (
            <div
              className="fixed inset-0 z-[90] bg-slate-950/40 backdrop-blur-[1px] lg:hidden"
              onClick={mobileMenuClose}
              aria-hidden
            />
          ) : null}
          <div
            id="va-mobile-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Menú principal"
            inert={!mobileMenuOpen}
            className={`fixed inset-y-0 left-0 z-[100] flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out dark:bg-slate-900 lg:hidden ${
              mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-800">
              <NavLink
                to={portalPath('/')}
                className="va-app-shell-brand flex min-w-0 flex-1 items-center overflow-hidden rounded-md outline-offset-2"
                onClick={mobileMenuClose}
                end
              >
                <PanelBrandLogo className="h-7 w-auto max-w-[min(55vw,10rem)] object-contain object-left" />
              </NavLink>
              <button
                type="button"
                onClick={mobileMenuClose}
                className={`${saasIconButtonClass()} !p-2`}
                title="Cerrar menú"
                aria-label="Cerrar menú"
              >
                <X className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              </button>
            </div>
            <nav
              className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3"
              aria-label="Navegación principal"
            >
              {links.map((l) => {
                const Icon = l.Icon
                return (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    onClick={mobileMenuClose}
                    className={(args) => [navLinkSidebarSaasClass(args), 'w-full'].join(' ')}
                  >
                    <Icon className="size-[1.125rem] shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="truncate">{l.label}</span>
                  </NavLink>
                )
              })}
            </nav>
            {user ? (
              <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
                {renderRolePreviewSelect({
                  id: 'mobile-role-preview',
                  placeholder: 'Mis permisos',
                  wrapperClass: 'mb-2 w-full',
                  selectClass:
                    'va-field w-full cursor-pointer rounded-lg border-slate-200 py-1.5 pr-6 text-xs font-medium dark:border-slate-600',
                })}
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-slate-700 dark:text-white"
                    aria-hidden
                  >
                    {initialsFromName(user.fullName)}
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="va-app-shell-meta-strong truncate">{user.fullName}</p>
                    <p className="va-app-shell-meta capitalize truncate">{userSubtitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-2 flex w-full items-center gap-2 rounded-lg bg-slate-100 px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 hover:text-red-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-red-400"
                >
                  <LogOut className="size-[1.125rem] shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="truncate">Salir</span>
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export function AppShell() {
  return (
    <CashSessionOpenProvider>
      <AppShellInner />
    </CashSessionOpenProvider>
  )
}
