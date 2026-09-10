import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Landing comercial (pantalla de acceso): parallax, capas y paleta negro / brand / blanco / gris.
 * No incluye lógica de autenticación.
 */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

function Reveal({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      setOn(true)
      return
    }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setOn(true)
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced, setOn])

  return (
    <div
      ref={ref}
      className={`transition-all duration-1000 ease-out motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
        on ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  )
}

type ClientPortalLandingAsideProps = {
  /** Acceso al panel (p. ej. formulario de login); se integra en la barra de navegación. */
  accessSlot?: ReactNode
}

export function ClientPortalLandingAside({ accessSlot }: ClientPortalLandingAsideProps) {
  const reducedMotion = usePrefersReducedMotion()
  const heroRef = useRef<HTMLElement>(null)
  const parallaxBackRef = useRef<HTMLDivElement>(null)
  const parallaxMidRef = useRef<HTMLDivElement>(null)
  const parallaxFrontRef = useRef<HTMLDivElement>(null)
  const decorRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const midBandRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [menuOpen])

  useEffect(() => {
    if (reducedMotion) return

    let raf = 0
    const tick = () => {
      const y = window.scrollY
      const h = window.innerHeight || 1
      const t = Math.min(y / (h * 1.2), 1)

      if (parallaxBackRef.current) {
        parallaxBackRef.current.style.transform = `translate3d(0, ${y * 0.22}px, 0) scale(1.08)`
      }
      if (parallaxMidRef.current) {
        parallaxMidRef.current.style.transform = `translate3d(0, ${y * 0.38}px, 0)`
      }
      if (parallaxFrontRef.current) {
        parallaxFrontRef.current.style.transform = `translate3d(0, ${y * 0.12}px, 0)`
      }
      if (decorRef.current) {
        decorRef.current.style.transform = `translate3d(0, ${y * 0.06}px, 0) rotate(${t * 2}deg)`
      }
      if (stripRef.current) {
        stripRef.current.style.transform = `translate3d(0, ${y * -0.04}px, 0)`
      }
      if (midBandRef.current) {
        midBandRef.current.style.transform = `translate3d(0, ${y * 0.18}px, 0)`
      }
    }

    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    tick()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [reducedMotion])

  useEffect(() => {
    if (reducedMotion) return
    const hero = heroRef.current
    if (!hero) return

    const onMove = (e: MouseEvent) => {
      const rect = hero.getBoundingClientRect()
      if (e.clientY < rect.top || e.clientY > rect.bottom || e.clientX < rect.left || e.clientX > rect.right) {
        return
      }
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      if (parallaxFrontRef.current) {
        parallaxFrontRef.current.style.setProperty('--mx', `${x * 14}`)
        parallaxFrontRef.current.style.setProperty('--my', `${y * 10}`)
      }
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [reducedMotion])

  return (
    <div className="bg-black text-white">
      {/* Navegación en dos carriles (desktop) + hamburguesa con drawer (móvil/tablet) */}
      <nav className="sticky top-0 z-40 border-b border-zinc-800 bg-black text-white shadow-[0_1px_0_rgba(0,0,0,0.35)]">
        {/* Fila 1: marca + (lg+) acceso o (lg-) hamburguesa */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-[56px] items-center justify-between gap-3 py-2">
            {/* Marca */}
            <a
              href="#inicio"
              className="inline-flex shrink-0 items-center transition hover:opacity-80"
              aria-label="Vene Autos — inicio"
              onClick={closeMenu}
            >
              <img
                src="/logo_landing.png"
                alt="Vene Autos"
                className="h-9 w-auto max-w-[200px] select-none lg:h-10 lg:max-w-[220px]"
                draggable={false}
              />
            </a>

            {/* Acceso integrado (solo desktop) */}
            {accessSlot ? (
              <aside
                id="acceso-panel"
                className="hidden shrink-0 lg:flex lg:min-h-[48px] lg:items-center lg:pl-6"
                aria-label="Acceso al panel del taller"
              >
                {accessSlot}
              </aside>
            ) : null}

            {/* Hamburguesa (móvil y tablet) */}
            <button
              type="button"
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuOpen}
              aria-controls="menu-drawer"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 border border-zinc-700 bg-black px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:border-brand-500 hover:text-brand-300 lg:hidden"
            >
              <span className="flex h-4 w-5 flex-col justify-between" aria-hidden="true">
                <span className="block h-0.5 w-full bg-current" />
                <span className="block h-0.5 w-full bg-brand-600" />
                <span className="block h-0.5 w-full bg-current" />
              </span>
              Menú
            </button>
          </div>
        </div>

        {/* Fila 2: menú horizontal centrado (solo desktop) */}
        <div className="hidden border-t border-zinc-800 bg-black lg:block">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div
              className="flex min-h-[40px] w-full items-center justify-center gap-x-8 py-1.5"
              role="navigation"
              aria-label="Secciones"
            >
              <a
                href="#inicio"
                className="border-b-2 border-brand-600 pb-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:text-brand-300"
              >
                Inicio
              </a>
              <a
                href="#servicios"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-brand-400"
              >
                Servicios
              </a>
              <a
                href="#nosotros"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-brand-400"
              >
                Nosotros
              </a>
              <a
                href="#contacto"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-brand-400"
              >
                Contacto
              </a>
              <Link
                to="/consulta-cliente"
                title="Consultar estado de cuenta"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-brand-400"
              >
                Consultar estado de cuenta
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Drawer móvil / tablet */}
      {menuOpen ? (
        <div
          id="menu-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menú principal"
          className="fixed inset-0 z-50 lg:hidden"
        >
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={closeMenu}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 right-0 flex w-[min(320px,88vw)] flex-col border-l-4 border-brand-600 bg-white text-black shadow-2xl dark:bg-black dark:text-white">
            <div className="flex min-h-[56px] items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
              <img src="/logo_landing.png" alt="Vene Autos" className="h-7 w-auto select-none" draggable={false} />
              <button
                type="button"
                onClick={closeMenu}
                aria-label="Cerrar menú"
                className="inline-flex h-9 w-9 items-center justify-center text-black transition hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-col gap-1 p-3" aria-label="Secciones">
              <a
                href="#inicio"
                onClick={closeMenu}
                className="border-l-2 border-brand-600 px-3 py-2.5 text-sm font-bold uppercase tracking-[0.14em] text-black dark:text-white"
              >
                Inicio
              </a>
              <a
                href="#servicios"
                onClick={closeMenu}
                className="border-l-2 border-transparent px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 transition hover:border-brand-600 hover:text-brand-700 dark:text-zinc-200 dark:hover:text-brand-300"
              >
                Servicios
              </a>
              <a
                href="#nosotros"
                onClick={closeMenu}
                className="border-l-2 border-transparent px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 transition hover:border-brand-600 hover:text-brand-700 dark:text-zinc-200 dark:hover:text-brand-300"
              >
                Nosotros
              </a>
              <a
                href="#contacto"
                onClick={closeMenu}
                className="border-l-2 border-transparent px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 transition hover:border-brand-600 hover:text-brand-700 dark:text-zinc-200 dark:hover:text-brand-300"
              >
                Contacto
              </a>
              <Link
                to="/consulta-cliente"
                onClick={closeMenu}
                className="border-l-2 border-transparent px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 transition hover:border-brand-600 hover:text-brand-700 dark:text-zinc-200 dark:hover:text-brand-300"
              >
                Consultar estado de cuenta
              </Link>
            </nav>

            {accessSlot ? (
              <div className="mt-auto border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-brand-600">Acceso</p>
                {accessSlot}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      {/* Hero parallax */}
      <header
        id="inicio"
        ref={heroRef}
        className="relative flex min-h-[min(92svh,920px)] items-center overflow-hidden bg-black"
      >
        {/* Capa fondo: gradiente + rejilla */}
        <div
          ref={parallaxBackRef}
          className="pointer-events-none absolute inset-0 will-change-transform"
          style={reducedMotion ? undefined : { transform: 'translate3d(0,0,0) scale(1.08)' }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-black to-brand-950/50" />
          <div
            className="absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
        </div>

        {/* Glow rojo */}
        <div
          ref={parallaxMidRef}
          className="pointer-events-none absolute -left-1/4 top-1/4 h-[min(80vw,520px)] w-[min(80vw,520px)] rounded-full bg-brand-600/25 blur-[100px] will-change-transform"
        />

        {/* Marca de agua tipográfica */}
        <div
          ref={decorRef}
          className="pointer-events-none absolute -right-4 bottom-0 select-none text-[clamp(4rem,18vw,14rem)] font-black leading-none tracking-tighter text-white/[0.04] will-change-transform sm:right-0"
          aria-hidden
        >
          VA
        </div>

        {/* Contenido hero (parallax leve con mouse vía CSS vars) */}
        <div
          ref={parallaxFrontRef}
          className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-24 pt-16 sm:px-6 sm:pb-28 sm:pt-20 will-change-transform motion-reduce:!translate-y-0"
          style={
            reducedMotion
              ? undefined
              : ({
                  transform: 'translate3d(calc(var(--mx, 0) * 1px), calc(var(--my, 0) * 1px), 0)',
                } as CSSProperties)
          }
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-brand-500">Taller certificado</p>
          <h1 className="mt-4 max-w-4xl font-serif text-4xl font-light leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Precisión mecánica.
            <span className="mt-2 block font-semibold text-zinc-200">Resultados que se notan al volante.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-zinc-400">
            Diagnóstico, mantenimiento y reparación con seguimiento claro de cada orden de trabajo.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="#contacto"
              className="va-btn-primary !min-h-0 items-center justify-center px-8 py-3.5 text-sm font-bold uppercase tracking-widest"
            >
              Consultar
            </a>
            <a
              href="#servicios"
              className="inline-flex items-center justify-center border-2 border-white bg-transparent px-8 py-3.5 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
            >
              Servicios
            </a>
          </div>
        </div>

        {/* Flecha scroll */}
        <div
          className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 motion-reduce:hidden"
          aria-hidden
        >
          <div className="flex h-10 w-6 justify-center rounded-full border-2 border-white/30 pt-2">
            <div className="h-2 w-1 animate-bounce rounded-full bg-brand-500" />
          </div>
        </div>
      </header>

      {/* Franja información */}
      <div
        ref={stripRef}
        className="relative z-10 border-y border-zinc-800 bg-zinc-900 will-change-transform"
      >
        <div className="mx-auto grid max-w-7xl divide-y divide-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { t: 'Horario', d: 'Lun — Vie · 8:00 — 18:00', sub: 'Sábados con cita' },
            { t: 'Ubicación', d: 'Sede principal', sub: 'Actualizar dirección y mapa' },
            { t: 'Promo', d: 'Inspección y rotación', sub: 'Consultá disponibilidad' },
          ].map((item) => (
            <div key={item.t} className="flex gap-4 px-6 py-6">
              <span className="mt-0.5 h-2 w-2 shrink-0 bg-brand-600" aria-hidden />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-500">{item.t}</p>
                <p className="mt-1 font-medium text-white">{item.d}</p>
                <p className="mt-1 text-sm text-zinc-500">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Banda parallax visual (fondo fijo simulado con capa) */}
      <section className="relative overflow-hidden bg-black py-0" aria-hidden>
        <div
          ref={midBandRef}
          className="relative flex min-h-[max(38vh,280px)] items-center justify-center will-change-transform"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-brand-950/40 via-black to-zinc-950" />
          <div className="absolute inset-0 opacity-20 mix-blend-overlay">
            <div className="h-full w-full bg-[repeating-linear-gradient(-45deg,transparent,transparent_8px,rgba(220,38,38,0.1)_8px,rgba(220,38,38,0.1)_10px)]" />
          </div>
          <p className="relative px-6 text-center text-2xl font-light tracking-wide text-white/90 sm:text-3xl">
            Calidad <span className="font-semibold text-brand-500">real</span>, sin vueltas.
          </p>
        </div>
      </section>

      {/* Servicios + nosotros */}
      <section id="servicios" className="bg-zinc-100 py-16 text-black sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Reveal className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Servicios</h2>
              <p className="mt-4 text-zinc-600">
                Desde cambio de aceite hasta diagnóstico complejo. Listado orientativo; ajustá precios y ítems con el
                taller.
              </p>
              <a
                href="#contacto"
                className="va-btn-primary !min-h-0 mt-8 inline-flex px-6 py-3 text-sm font-bold uppercase tracking-wider"
              >
                Más información
              </a>
            </div>
            <div className="grid gap-10 sm:grid-cols-2 lg:col-span-8">
              <div>
                <h3 className="border-b-2 border-black pb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  Mantenimiento
                </h3>
                <ul className="mt-4 space-y-3 text-sm">
                  {[
                    ['Cambio de aceite y filtros', 'desde —'],
                    ['Frenos (pastillas / discos)', 'desde —'],
                    ['Alineación y balanceo', 'desde —'],
                    ['Aire acondicionado', 'desde —'],
                    ['Batería y eléctrico', 'desde —'],
                  ].map(([a, b]) => (
                    <li key={a} className="flex justify-between gap-4 border-b border-zinc-200 py-2">
                      <span className="font-medium text-zinc-800">{a}</span>
                      <span className="shrink-0 tabular-nums text-zinc-500">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="border-b-2 border-black pb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  Taller
                </h3>
                <ul className="mt-4 space-y-3 text-sm">
                  {[
                    ['Diagnóstico computarizado', 'desde —'],
                    ['Motor y transmisión', 'desde —'],
                    ['Suspensión y dirección', 'desde —'],
                    ['Escaneo y borrado de fallas', 'desde —'],
                    ['Pre-compra / inspección', 'desde —'],
                  ].map(([a, b]) => (
                    <li key={a} className="flex justify-between gap-4 border-b border-zinc-200 py-2">
                      <span className="font-medium text-zinc-800">{a}</span>
                      <span className="shrink-0 tabular-nums text-zinc-500">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="nosotros" className="border-t border-zinc-800 bg-zinc-950 py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Reveal>
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <h2 className="text-3xl font-bold text-white sm:text-4xl">Quiénes somos</h2>
                <p className="mt-6 leading-relaxed text-zinc-400">
                  Equipo de mecánica automotriz con foco en diagnóstico y transparencia. Cada orden de trabajo queda
                  registrada para que clientes autorizados puedan consultar el avance cuando corresponda.
                </p>
              </div>
              <div className="border border-zinc-800 bg-black p-8">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-brand-500">Ubicación</h3>
                <p className="mt-4 text-zinc-300">
                  <span className="block font-semibold text-white">Sede principal</span>
                  Completar dirección y horario reales del local.
                </p>
                <a
                  href="https://www.openstreetmap.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-block text-sm font-semibold text-brand-500 underline-offset-4 hover:text-brand-400 hover:underline"
                >
                  Ver en mapa
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer id="contacto" className="border-t-4 border-brand-600 bg-white py-10 text-black">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-start">
            <div>
              <img
                src="/logo_landing_footer.png"
                alt="Vene Autos"
                className="h-10 w-auto select-none"
                draggable={false}
              />
              <p className="mt-2 max-w-md text-sm text-zinc-600">
                Consultas comerciales y turnos por los canales habituales del taller.
              </p>
              <div className="mt-6 flex flex-col gap-3 border-t border-zinc-200 pt-6 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-2">
                <a
                  href="mailto:info@veneautos.com"
                  className="font-medium text-zinc-800 underline-offset-4 transition hover:text-brand-600 hover:underline"
                >
                  info@veneautos.com
                </a>
                <a
                  href="tel:+573000000000"
                  className="va-btn-primary !min-h-0 w-fit px-4 py-2 text-xs font-bold uppercase tracking-wider"
                >
                  +57 300 000 0000
                </a>
                <a
                  href="mailto:info@veneautos.com?subject=Turno%20Vene%20Autos"
                  className="text-xs font-semibold uppercase tracking-widest text-zinc-500 underline-offset-4 transition hover:text-black hover:underline"
                >
                  Pedir turno
                </a>
              </div>
            </div>
            <p className="shrink-0 text-xs font-medium uppercase tracking-widest text-zinc-400 lg:pt-1">
              © {new Date().getFullYear()} Vene Autos
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
