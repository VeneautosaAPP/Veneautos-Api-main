import {
  BarChart3,
  ClipboardList,
  ScrollText,
  Settings,
  Shield,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { portalPath, stripPortalBase } from '../../../constants/portalPath'
import type { DashboardModule, DashboardSection } from '../../../components/dashboard/dashboardTypes'
import { modulePriority, sectionPriority } from '../../../components/dashboard/dashboardPriorities'
import { getStoredLastModulePath } from '../../../services/lastModuleStorage'

export type CanFn = (permission: string) => boolean

export function createDashboardSections(can: CanFn): DashboardSection[] {
  return [
    {
      title: 'Operación diaria',
      description: 'Acciones principales del taller para caja y órdenes.',
      modules: [
        {
          to: portalPath('/caja'),
          title: 'Caja',
          description: 'Abrir/cerrar sesión de caja y registrar movimientos.',
          icon: Wallet,
          show: can('cash_sessions:read'),
          enabled: true,
        },
        {
          to: portalPath('/ordenes'),
          title: 'Órdenes',
          description: 'Seguimiento de órdenes de trabajo y cobros por orden.',
          icon: ClipboardList,
          show: can('work_orders:read') || can('work_orders:read_portal'),
          enabled: true,
        },
      ],
    },
    {
      title: 'Clientes y análisis',
      description: 'Gestión comercial y visibilidad de resultados del taller.',
      modules: [
        {
          to: portalPath('/clientes'),
          title: 'Clientes',
          description: 'Gestionar clientes, vehículos y su historial.',
          icon: Users,
          show: can('customers:read'),
          enabled: true,
        },
        {
          to: portalPath('/informes'),
          title: 'Informes',
          description: 'Métricas de actividad, ingresos y desempeño operativo.',
          icon: BarChart3,
          show: can('reports:read'),
          enabled: true,
        },
      ],
    },
    {
      title: 'Administración',
      description: 'Gestión de permisos, auditoría y parámetros globales.',
      modules: [
        {
          to: portalPath('/admin/usuarios'),
          title: 'Usuarios',
          description: 'Alta de cuentas, estado y asignación de roles.',
          icon: UsersRound,
          show: can('users:read'),
          enabled: true,
        },
        {
          to: portalPath('/admin/roles'),
          title: 'Roles',
          description: 'Diseñar perfiles de acceso por permisos.',
          icon: Shield,
          show: can('roles:read'),
          enabled: true,
        },
        {
          to: portalPath('/admin/auditoria'),
          title: 'Auditoría',
          description: 'Revisar trazabilidad de acciones y cambios.',
          icon: ScrollText,
          show: can('audit:read'),
          enabled: true,
        },
        {
          to: portalPath('/admin/configuracion'),
          title: 'Configuración',
          description: 'Parámetros del taller, políticas y soporte.',
          icon: Settings,
          show: can('settings:read') || can('tax_rates:read'),
          enabled: true,
        },
      ],
    },
  ]
}

export type DerivedDashboardLayout = {
  visibleSections: DashboardSection[]
  orderedSections: DashboardSection[]
  operationSection: DashboardSection | undefined
  totalModules: number
  enabledModules: number
  blockedCount: number
  quickActions: DashboardModule[]
  resumeModule: DashboardModule | null
  quickActionsWithoutResume: DashboardModule[]
  todayFocus: DashboardModule[]
  lockedToday: DashboardModule[]
}

export function deriveDashboardLayout(sections: DashboardSection[]): DerivedDashboardLayout {
  const visibleSections = sections
    .map((section) => ({
      ...section,
      modules: section.modules.filter((module) => module.show),
    }))
    .map((section) => ({
      ...section,
      modules: [...section.modules].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return modulePriority(b) - modulePriority(a)
      }),
    }))
    .filter((section) => section.modules.length > 0)
    .sort((a, b) => sectionPriority(b) - sectionPriority(a))

  const operationSection = visibleSections.find((section) => section.title === 'Operación diaria')
  const adminSection = visibleSections.find((section) => section.title === 'Administración')
  const midSections = visibleSections.filter(
    (section) => section.title !== 'Operación diaria' && section.title !== 'Administración',
  )
  const orderedSections = [
    ...(operationSection ? [operationSection] : []),
    ...midSections,
    ...(adminSection ? [adminSection] : []),
  ]

  const totalModules = orderedSections.reduce((acc, section) => acc + section.modules.length, 0)
  const enabledModules = orderedSections.reduce(
    (acc, section) => acc + section.modules.filter((module) => module.enabled).length,
    0,
  )
  const quickActions = orderedSections
    .flatMap((section) => section.modules)
    .filter((module) => module.enabled)
    .sort((a, b) => modulePriority(b) - modulePriority(a))
    .slice(0, 4)

  const moduleByPath = new Map(
    orderedSections.flatMap((section) => section.modules).map((module) => [stripPortalBase(module.to), module]),
  )
  const resumeModulePath = getStoredLastModulePath()
  const resumeModule = resumeModulePath ? moduleByPath.get(resumeModulePath) ?? null : null
  const quickActionsWithoutResume = resumeModule
    ? quickActions.filter((module) => module.to !== resumeModule.to)
    : quickActions

  const todayFocus = operationSection ? operationSection.modules.filter((module) => module.enabled).slice(0, 3) : []
  const lockedToday = operationSection ? operationSection.modules.filter((module) => !module.enabled) : []

  const blockedCount = Math.max(totalModules - enabledModules, 0)

  return {
    visibleSections,
    orderedSections,
    operationSection,
    totalModules,
    enabledModules,
    blockedCount,
    quickActions,
    resumeModule,
    quickActionsWithoutResume,
    todayFocus,
    lockedToday,
  }
}
