import { useLayoutEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { PORTAL_BASE } from '../constants/portalPath'
import { applyHeadTags, removeJsonLdScript, setJsonLdScript, type HeadTags } from './documentMeta'
import { SITE_BRAND, businessLocality, siteOrigin } from './siteConfig'

function fullUrl(pathname: string): string {
  const origin = siteOrigin()
  if (!pathname || pathname === '/') return `${origin}/`
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${origin}${path}`
}

function landingJsonLd(origin: string, locality?: string) {
  const address = locality
    ? {
        '@type': 'PostalAddress',
        streetAddress: 'Cll 47D # 83-07, La América',
        addressLocality: locality,
        addressRegion: 'Antioquia',
        addressCountry: 'CO',
      }
    : {
        '@type': 'PostalAddress',
        addressCountry: 'CO',
      }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['LocalBusiness', 'AutomotiveRepair'],
        '@id': `${origin}/#business`,
        name: SITE_BRAND,
        description:
          'Taller de mecánica especializada multimarca en Colombia: diagnóstico computarizado, mantenimiento preventivo y reparación de vehículos, con más de 7 años de experiencia. Seguimiento por orden de trabajo (OT).',
        url: `${origin}/`,
        image: `${origin}/logo_landing.png`,
        priceRange: '$$',
        telephone: '+57 322 516 7224',
        email: 'Veneautos82@gmail.com',
        address,
        geo: locality
          ? { '@type': 'GeoCoordinates', latitude: 6.25837, longitude: -75.6015 }
          : undefined,
        areaServed: { '@type': 'Country', name: 'Colombia' },
        knowsAbout: [
          'taller mecánico',
          'mecánica automotriz',
          'mecánica especializada multimarca',
          'reparación de vehículos',
          'diagnóstico automotriz',
          'mantenimiento de vehículos',
          'frenos',
          'aceite y filtros',
          'alineación y balanceo',
        ],
        openingHoursSpecification: {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          opens: '08:00',
          closes: '17:00',
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: `${origin}/`,
        name: SITE_BRAND,
        inLanguage: 'es-CO',
        publisher: { '@id': `${origin}/#business` },
      },
    ],
  }
}

function consultOtJsonLd(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${origin}/consulta-cliente`,
    url: `${origin}/consulta-cliente`,
    name: `Consultar estado de cuenta | ${SITE_BRAND}`,
    description:
      'Consultá el estado de cuenta de tu vehículo en el taller Vene Autos (Colombia): órdenes de trabajo, facturas y saldos en una consulta segura por placa y celular.',
    inLanguage: 'es-CO',
    isPartOf: { '@type': 'WebSite', name: SITE_BRAND, url: `${origin}/` },
  }
}

export function SiteSeo() {
  const { pathname } = useLocation()

  const head = useMemo(() => {
    const origin = siteOrigin()
    const locality = businessLocality()
    const ogImage = `${origin}/logo_landing.png`

    const locSuffix = locality ? ` — ${locality}` : ''

    if (pathname === '/') {
      const title = `${SITE_BRAND} | Taller mecánico multimarca y reparación de vehículos${locSuffix || ' en Colombia'}`
      const description =
        `Taller mecánico${locality ? ` en ${locality}` : ' en Colombia'}: mecánica especializada multimarca, ` +
        `diagnóstico, mantenimiento y reparación de vehículos con más de 7 años de experiencia. ` +
        `Seguimiento por orden de trabajo (OT). Sitio oficial ${SITE_BRAND}.`
      const tags: HeadTags = {
        title,
        description,
        canonicalUrl: fullUrl('/'),
        robots: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
        ogType: 'website',
        ogImageUrl: ogImage,
        ogSiteName: SITE_BRAND,
        locale: 'es_CO',
      }
      return { tags, jsonLd: landingJsonLd(origin, locality) }
    }

    if (pathname === '/consultar-ot' || pathname === '/consulta-cliente') {
      const titleOk = `Consultar estado de cuenta | ${SITE_BRAND} Colombia`
      const description =
        'Consultá online el estado de cuenta de tu vehículo: órdenes de trabajo, facturas y saldos en el taller Vene Autos en Colombia.'
      const tags: HeadTags = {
        title: titleOk,
        description,
        canonicalUrl: fullUrl('/consulta-cliente'),
        robots: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
        ogType: 'website',
        ogImageUrl: ogImage,
        ogSiteName: SITE_BRAND,
        locale: 'es_CO',
      }
      return { tags, jsonLd: consultOtJsonLd(origin) }
    }

    if (pathname.startsWith(PORTAL_BASE)) {
      const tags: HeadTags = {
        title: `Panel ${SITE_BRAND}`,
        description: `Acceso al sistema interno del taller ${SITE_BRAND}.`,
        canonicalUrl: fullUrl(pathname),
        robots: 'noindex, nofollow',
        ogType: 'website',
        ogImageUrl: ogImage,
        ogSiteName: SITE_BRAND,
        locale: 'es_CO',
      }
      return { tags, jsonLd: null as Record<string, unknown> | null }
    }

    const tags: HeadTags = {
      title: SITE_BRAND,
      description: `${SITE_BRAND}: taller mecánico y reparación de vehículos en Colombia.`,
      canonicalUrl: fullUrl(pathname),
      robots: 'index, follow',
      ogType: 'website',
      ogImageUrl: ogImage,
      ogSiteName: SITE_BRAND,
      locale: 'es_CO',
    }
    return { tags, jsonLd: null as Record<string, unknown> | null }
  }, [pathname])

  useLayoutEffect(() => {
    applyHeadTags(head.tags)
    if (head.jsonLd) setJsonLdScript(head.jsonLd)
    else removeJsonLdScript()
  }, [head])

  return null
}
