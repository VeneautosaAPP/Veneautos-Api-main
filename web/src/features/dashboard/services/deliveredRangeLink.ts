import { portalPath } from '../../../constants/portalPath'

/**
 * Link al listado de entregadas acotado al mismo rango que resume la tarjeta
 * (`deliveredAt` entre `from` y `to`, inclusive). El listado filtra por el mismo campo,
 * así que el conteo de la tarjeta y el del listado coinciden.
 */
export function deliveredRangeOrdersLink(from: Date, to: Date): string {
  const qs = new URLSearchParams({
    status: 'DELIVERED',
    from: from.toISOString(),
    to: to.toISOString(),
  })
  return `${portalPath('/ordenes')}?${qs.toString()}`
}
