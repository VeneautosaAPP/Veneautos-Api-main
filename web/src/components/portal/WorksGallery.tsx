import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Datos editables ─────────────────────────────────────────────────────────
// Modificá `label` y `alt` según el contenido real de cada foto.
const PHOTOS = [
  { id: 'foto-01', src: '/fotos-taller/foto-01.jpg', alt: 'Vene Autos — Cambio de aceite y filtros', label: 'Cambio de aceite y filtros' },
  { id: 'foto-02', src: '/fotos-taller/foto-02.jpg', alt: 'Vene Autos — Frenos: pastillas y discos', label: 'Frenos: pastillas y discos' },
  { id: 'foto-03', src: '/fotos-taller/foto-03.jpg', alt: 'Vene Autos — Alineación y balanceo', label: 'Alineación y balanceo' },
  { id: 'foto-04', src: '/fotos-taller/foto-04.jpg', alt: 'Vene Autos — Aire acondicionado', label: 'Aire acondicionado' },
  { id: 'foto-05', src: '/fotos-taller/foto-05.jpg', alt: 'Vene Autos — Batería y eléctrico', label: 'Batería y eléctrico' },
  { id: 'foto-06', src: '/fotos-taller/foto-06.jpg', alt: 'Vene Autos — Diagnóstico computarizado', label: 'Diagnóstico computarizado' },
  { id: 'foto-07', src: '/fotos-taller/foto-07.jpg', alt: 'Vene Autos — Motor y transmisión', label: 'Motor y transmisión' },
  { id: 'foto-08', src: '/fotos-taller/foto-08.jpg', alt: 'Vene Autos — Suspensión y dirección', label: 'Suspensión y dirección' },
  { id: 'foto-09', src: '/fotos-taller/foto-09.jpg', alt: 'Vene Autos — Escaneo y borrado de fallas', label: 'Escaneo y borrado de fallas' },
  { id: 'foto-10', src: '/fotos-taller/foto-10.jpg', alt: 'Vene Autos — Inspección pre-compra', label: 'Inspección pre-compra' },
  { id: 'foto-11', src: '/fotos-taller/foto-11.jpg', alt: 'Vene Autos — Lubricación general', label: 'Lubricación general' },
  { id: 'foto-12', src: '/fotos-taller/foto-12.jpg', alt: 'Vene Autos — Trabajo en el taller', label: 'Trabajo en el taller' },
] as const

const INTERVAL_MS = 4500

// ─── Lightbox ────────────────────────────────────────────────────────────────
function Lightbox({
  current,
  onClose,
  onPrev,
  onNext,
}: {
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
    return () => { document.body.style.overflow = prev }
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

  const photo = PHOTOS[current]
  const num = String(current + 1).padStart(2, '0')

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${num} de ${PHOTOS.length}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4">
        <p className="font-mono text-xs sm:text-sm text-brand-600 font-bold tracking-widest">
          {num} / {String(PHOTOS.length).padStart(2, '0')}
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

      <img
        key={photo.id}
        src={photo.src}
        alt={photo.alt}
        className="max-h-[78vh] sm:max-h-[82vh] max-w-full object-contain rounded-md shadow-2xl"
      />

      <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-1 sm:px-3 pointer-events-none">
        <button
          type="button"
          onClick={onPrev}
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-black/60 text-zinc-300 transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="Foto anterior"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNext}
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-black/60 text-zinc-300 transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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

// ─── Carrusel ────────────────────────────────────────────────────────────────
export function WorksGallery() {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  // Auto-advance
  useEffect(() => {
    if (paused || lightbox !== null) return
    const id = setInterval(() => setCurrent((c) => (c + 1) % PHOTOS.length), INTERVAL_MS)
    return () => clearInterval(id)
  }, [paused, lightbox])

  // Progress bar (requestAnimationFrame, no re-renders)
  useEffect(() => {
    if (lightbox !== null) return
    const bar = barRef.current
    if (!bar || paused) {
      if (bar) bar.style.animationPlayState = 'paused'
      return
    }
    bar.style.animation = 'none'
    void bar.offsetHeight
    bar.style.animation = `galleryProgress ${INTERVAL_MS}ms linear forwards`
    bar.style.animationPlayState = 'running'
  }, [current, paused, lightbox])

  // Scroll thumbnail into view
  useEffect(() => {
    const container = thumbRef.current
    if (!container) return
    const active = container.children[current] as HTMLElement | undefined
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [current])

  const goTo = useCallback((i: number) => setCurrent(i), [])
  const prev = useCallback(() => setCurrent((c) => (c - 1 + PHOTOS.length) % PHOTOS.length), [])
  const next = useCallback(() => setCurrent((c) => (c + 1) % PHOTOS.length), [])
  const closeLb = useCallback(() => setLightbox(null), [])
  const prevLb = useCallback(() => setLightbox((c) => (c !== null ? (c - 1 + PHOTOS.length) % PHOTOS.length : null)), [])
  const nextLb = useCallback(() => setLightbox((c) => (c !== null ? (c + 1) % PHOTOS.length : null)), [])

  return (
    <>
      {/* Keyframes inyectados */}
      <style>{`@keyframes galleryProgress { from { width: 0% } to { width: 100% } }`}</style>

      <section
        id="trabajos"
        className="relative bg-zinc-950 pt-4 pb-12 sm:pt-6 sm:pb-16"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* Cabecera */}
          <div className="mb-6 sm:mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.28em] text-brand-600 font-mono mb-3">
                Fotos del taller
              </p>
              <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-light leading-[1.08] tracking-tight text-white">
                Nuestro trabajo,{' '}
                <span className="font-semibold text-zinc-200">en el taller.</span>
              </h2>
            </div>
            <p className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
              {current + 1} / {PHOTOS.length}
            </p>
          </div>

          {/* Carrusel */}
          <div className="relative mx-auto max-w-[min(80vw,560px)]">
            {/* Stage */}
            <div
              className="relative aspect-[3/4] overflow-hidden rounded-lg bg-zinc-900 cursor-pointer"
              onClick={() => setLightbox(current)}
              role="button"
              tabIndex={0}
              aria-label="Ver foto en pantalla completa"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(current) } }}
            >
              {PHOTOS.map((photo, i) => (
                <img
                  key={photo.id}
                  src={photo.src}
                  alt={photo.alt}
                  loading={i < 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out ${
                    i === current ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                />
              ))}

              {/* Placa de inventario */}
              <span className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-10 bg-black/80 border border-brand-600 text-brand-600 px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em] font-mono backdrop-blur-sm transition-colors duration-500 hover:bg-brand-600 hover:text-white motion-reduce:transition-none">
                {PHOTOS[current].label}
              </span>

              {/* Marco rojo sutil */}
              <span className="pointer-events-none absolute inset-0 z-[5] border border-brand-600/40 rounded-lg" />
            </div>

            {/* Flechas */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prev() }}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-black/70 text-zinc-300 backdrop-blur-sm transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Foto anterior"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); next() }}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-black/70 text-zinc-300 backdrop-blur-sm transition hover:border-brand-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Foto siguiente"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {/* Barra de progreso */}
          <div className="mt-4 h-[2px] max-w-[min(80vw,560px)] mx-auto overflow-hidden rounded-full bg-zinc-800">
            <div
              ref={barRef}
              className="h-full bg-brand-600 rounded-full"
              style={{ width: '100%' }}
            />
          </div>

          {/* Thumbnails */}
          <div
            ref={thumbRef}
            className="mt-4 flex gap-2 overflow-x-auto pb-1 max-w-[min(80vw,560px)] mx-auto scrollbar-none"
            style={{ scrollbarWidth: 'none' }}
          >
            {PHOTOS.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => goTo(i)}
                className={[
                  'shrink-0 w-12 h-16 sm:w-14 sm:h-[72px] overflow-hidden rounded border-2 transition-all duration-300',
                  i === current
                    ? 'border-brand-600 opacity-100 scale-105'
                    : 'border-zinc-700 opacity-50 hover:opacity-80 hover:border-zinc-500',
                ].join(' ')}
                aria-label={`Ir a foto ${i + 1}`}
              >
                <img src={photo.src} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Lightbox */}
      {lightbox !== null ? (
        <Lightbox current={lightbox} onClose={closeLb} onPrev={prevLb} onNext={nextLb} />
      ) : null}
    </>
  )
}