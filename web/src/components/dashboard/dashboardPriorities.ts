import { portalPath } from '../../constants/portalPath'
import type { DashboardModule, DashboardSection } from './dashboardTypes'

const MODULE_PRIORITY: Record<string, number> = {
  [portalPath('/caja')]: 120,
  [portalPath('/ordenes')]: 110,
  [portalPath('/cotizaciones')]: 108,
  [portalPath('/recepcion')]: 95,
  [portalPath('/inventario')]: 90,
  [portalPath('/aceite')]: 85,
  [portalPath('/clientes')]: 70,
  [portalPath('/informes')]: 60,
  [portalPath('/admin/credito-empleados')]: 58,
  [portalPath('/admin/usuarios')]: 45,
  [portalPath('/admin/roles')]: 40,
  [portalPath('/admin/auditoria')]: 35,
  [portalPath('/admin/configuracion')]: 30,
}

export function modulePriority(module: DashboardModule): number {
  return MODULE_PRIORITY[module.to] ?? 10
}

export function sectionPriority(section: DashboardSection): number {
  const enabledModules = section.modules.filter((module) => module.enabled)
  const source = enabledModules.length > 0 ? enabledModules : section.modules
  const topModulePriority = source.reduce((max, module) => Math.max(max, modulePriority(module)), 0)
  return topModulePriority + enabledModules.length * 3
}
