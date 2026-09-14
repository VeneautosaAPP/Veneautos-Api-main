import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Datos editables ─────────────────────────────────────────────────────────
// Modificá `label` y `alt` según el contenido real de cada foto.
// `span` y `aspect` controlan el layout del grid (Tailwind classes).
const PHOTOS = [
  { id: 'foto-01', src: '/fotos-taller/foto-01.jpg', alt: 'Vene Autos — Cambio de aceite y filtros', label: 'Cambio de aceite y filtros', span: 'lg:col-span-7', aspect: 'aspect-[3/4]' },
  { id: 'foto-02', src: '/fotos-taller/foto-02.jpg', alt: 'Vene Autos — Frenos: pastillas y discos', label: 'Frenos: pastillas y discos', span: 'lg:col-span-5', aspect: 'aspect-[3/4]' },
  { id: 'foto-03', src: '/fotos-taller/foto-03.jpg', alt: 'Vene Autos — Alineación y balanceo', label: 'Alineación y balanceo', span: 'lg:col-span-5', aspect: 'aspect-[3/4]' },
  { id: 'foto-04', src: '/fotos-taller/foto-04.jpg', alt: 'Vene Autos — Aire acondicionado', label: 'Aire acondicionado', span: 'lg:col-span-7', aspect: 'aspect-[3/4]' },
  { id: 'foto-05', src: '/fotos-taller/foto-05.jpg', alt: 'Vene Autos — Batería y eléctrico', label: 'Batería y eléctrico', span: 'lg:col-span-4', aspect: 'aspect-[3/4]' },
  { id: 'foto-06', src: '/fotos-taller/foto-06.jpg', alt: 'Vene Autos — Diagnóstico computarizado', label: 'Diagnóstico computarizado', span: 'lg:col-span-4', aspect: 'aspect-[4/3]' },
  { id: 'foto-07', src: '/fotos-taller/foto-07.jpg', alt: 'Vene Autos — Motor y transmisión', label: 'Motor y transmisión', span: 'lg:col-span-4', aspect: 'aspect-[3/4]' },
  { id: 'foto-08', src: '/fotos-taller/foto-08.jpg', alt: 'Vene Autos — Suspensión y dirección', label: 'Suspensión y dirección', span: 'lg:col-span-4', aspect: 'aspect-[3/4]' },
  { id: 'foto-09', src: '/fotos-taller/foto-09.jpg', alt: 'Vene Autos — Escaneo y borrado de fallas', label: 'Escaneo y borrado de fallas', span: 'lg:col-span-4', aspect: 'aspect-[3/4]' },
  { id: 'foto-10', src: '/fotos-taller/foto-10.jpg', alt: 'Vene Autos — Inspección pre-compra', label: 'Inspección pre-compra', span: 'lg:col-span-4', aspect: 'aspect-[3/4]' },
  { id: 'foto-11', src: '/fotos-taller/foto-11.jpg', alt: 'Vene Autos — Lubricación general', label: 'Lubricación general', span: 'lg:col-span-5', aspect: 'aspect-[3/4]' },
  { id: 'foto-12', src: '/fotos-taller/foto-12.jpg', alt: 'Vene Autos — Trabajo en el taller', label: 'Trabajo en el taller', span: 'lg:col-span-7', aspect: 'aspect-[3/4]' },
] as const

// ─── Tile ────────────────────────────────────────────────────────────────────
function GalleryTile({
  photo,
  index,
  isFeature,
  onOpen,
}: {
  photo: (typeof PHOTOS)[number]
  index: number
  isFeature: boolean
  onOpen: (i: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 70}ms` }}
      className={[
        'col-span-1 relative group overflow-hidden rounded-lg bg-zinc-900 cursor-pointer',
        'transition-all duration-700 ease-out will-change-transform',
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600',
        photo.span,
        photo.aspect,
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5',
        'motion-reduce:!transition-none motion-reduce:!opacity-100 motion-reduce:!translate-y-0',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`Ver foto: ${photo.label}`}
      onClick={() => onOpen(index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(index)
        }
      }}
    >
      {/* Marco rojo doble — solo en la foto principal */}
      {isFeature ? (
        <>
          <span className="pointer-events-none absolute inset-0 z-10 border-2 border-brand-600/90 rounded-lg transition-colors duration-700 group-hover:border-brand-500 motion-reduce:transition-none" />
          <span className="pointer-events-none absolute inset-[6px] z-10 border border-brand-600/50 rounded-md transition-colors duration-700 group-hover:border-brand-500/70 motion-reduce:transition-none" />
        </>
      ) : null}

      {/* Imagen */}
      <img
        src={photo.src}
        alt={photo.alt}
        loading={index < 3 ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={isFeature ? 'high' : 'low'}
        className="h-full w-full object-cover transition-transform duration-700 ease-out motion-reduce:transition-none group-hover:scale-[1.04]"
      />

      {/* Placa de inventario */}
      <span
        className={[
          'absolute z-10 border backdrop-blur-sm transition-colors duration-500 motion-reduce:transition-none',
          'bg-black/80 border-brand-600 text-brand-600 group-hover:bg-brand-600 group-hover:text-white',
          isFeature
            ? 'bottom-3 left-3 sm:bottom-4 sm:left-4 px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em]'
            : 'bottom-2 left-2 sm:bottom-3 sm:left-3 px-2.5 py-1.5 sm:px-3 sm:py-2 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.18em]',
          'font-mono',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {photo.label}
      </span>

      {/* Glow ambiental rojo sutil en hover (solo feature) */}
      {isFeature ? (
        <span className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-brand-600/10 via-transparent to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100 motion-reduce:transition-none" />
      ) : null}
    </div>
  )
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
function Lightbox({
  photos,
  current,
  onClose,
  onPrev,
  onNext,
}: {
  photos: typeof PHOTOS
  current: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const photo = photos[current]
  const num = String(current + 1).padStart(2, '0')

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${num} de ${photos.length}: ${photo.label}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Barra superior: contador + label + cerrar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4">
        <p className="font-mono text-xs sm:text-sm text-brand-600 font-bold tracking-widest">
          {num} / {String(photos.length).padStart(2, '0')}
        </p>
        <p className="hidden sm:block font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400 font-semibold max-w-[40%] truncate">
          {photo.label}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-black/60 text-zinc-300 transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="Cerrar galería"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Imagen */}
      <img
        key={photo.id}
        src={photo.src}
        alt={photo.alt}
        className="max-h-[78vh] sm:max-h-[82vh] max-w-full object-contain rounded-md shadow-2xl"
      />

      {/* Label en móvil */}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-semibold sm:hidden truncate max-w-[80%]">
        {photo.label}
      </p>

      {/* Navegación */}
      <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-1 sm:px-3 pointer-events-none">
        <button
          type="button"
          onClick={onPrev}
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-black/60 text-zinc-300 transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:opacity-70"
          aria-label="Foto anterior"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNext}
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-black/60 text-zinc-300 transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:opacity-70"
          aria-label="Foto siguiente"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Sección galería ─────────────────────────────────────────────────────────
export function WorksGallery() {
  const [current, setCurrent] = useState<number | null>(null)

  const open = useCallback((i: number) => setCurrent(i), [])
  const close = useCallback(() => setCurrent(null), [])
  const prev = useCallback(() => setCurrent((c) => (c !== null ? (c - 1 + PHOTOS.length) % PHOTOS.length : null)), [])
  const next = useCallback(() => setCurrent((c) => (c !== null ? (c + 1) % PHOTOS.length : null)), [])

  return (
    <section id="trabajos" className="bg-black py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Cabecera */}
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-6">
          <div className="lg:col-span-8">
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.28em] text-brand-600 font-mono mb-4 sm:mb-5">
              Fotos del taller
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tight text-white">
              Nuestro trabajo,{' '}
              <span className="font-semibold text-zinc-200">en el taller.</span>
            </h2>
            <p className="mt-5 max-w-xl text-sm sm:text-base leading-relaxed text-zinc-400">
              Evidencia real de lo que sale de nuestras manos. Cada imagen es un registro de un
              servicio ejecutado en la sede.
            </p>
          </div>
          <p className="lg:col-span-4 lg:text-right font-mono text-[10px] sm:text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
            {PHOTOS.length} registros
          </p>
        </div>

        {/* Grid */}
        <div className="mt-10 sm:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4">
          {PHOTOS.map((photo, i) => (
            <GalleryTile
              key={photo.id}
              photo={photo}
              index={i}
              isFeature={i === 0}
              onOpen={open}
            />
          ))}
        </div>

        {/* Nota al pie */}
        <p className="mt-8 sm:mt-10 text-center font-mono text-[10px] sm:text-xs uppercase tracking-[0.22em] text-zinc-600 font-semibold">
          Fotos reales del taller Vene Autos &middot; Imágenes de trabajos realizados en la sede
        </p>
      </div>

      {/* Lightbox */}
      {current !== null ? (
        <Lightbox photos={PHOTOS} current={current} onClose={close} onPrev={prev} onNext={next} />
      ) : null}
    </section>
  )
}