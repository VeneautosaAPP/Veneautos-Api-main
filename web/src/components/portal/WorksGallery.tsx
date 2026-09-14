import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

function Arrow({ dir, onClick, label }: { dir: 'prev' | 'next'; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-1/2 -translate-y-1/2 z-20 hidden sm:inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-zinc-300 ring-1 ring-white/15 backdrop-blur-md transition duration-300 hover:bg-brand-600 hover:text-white hover:ring-brand-500 hover:shadow-[0_0_24px_-4px_rgba(220,38,38,.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
      style={dir === 'prev' ? { left: '-14px' } : { right: '-14px' }}
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {dir === 'prev' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  )
}

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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-3 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${num} de ${PHOTOS.length}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <p className="font-mono text-xs font-bold tracking-widest text-brand-600 sm:text-sm">
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
        className="max-h-[78vh] max-w-full rounded-md object-contain shadow-2xl sm:max-h-[82vh]"
      />

      <p className="mt-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300">
        <span className="h-3 w-[3px] bg-brand-600" aria-hidden />
        {photo.label}
      </p>

      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-1 sm:px-3">
        <Arrow dir="prev" onClick={onPrev} label="Foto anterior" />
        <Arrow dir="next" onClick={onNext} label="Foto siguiente" />
      </div>
    </div>
  )
}

// ─── Carrusel compacto (para el hero) ────────────────────────────────────────
export function WorksGallery({ className }: { className?: string }) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paused || lightbox !== null) return
    const id = setInterval(() => setCurrent((c) => (c + 1) % PHOTOS.length), INTERVAL_MS)
    return () => clearInterval(id)
  }, [paused, lightbox])

  useEffect(() => {
    const bar = barRef.current
    if (!bar || paused || lightbox !== null) {
      if (bar) bar.style.animationPlayState = 'paused'
      return
    }
    bar.style.animation = 'none'
    void bar.offsetHeight
    bar.style.animation = `galleryProgress ${INTERVAL_MS}ms linear forwards`
    bar.style.animationPlayState = 'running'
  }, [current, paused, lightbox])

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

  const photo = PHOTOS[current]
  const num = String(current + 1).padStart(2, '0')

  return (
    <>
      <style>{`@keyframes galleryProgress { from { width: 0% } to { width: 100% } } @keyframes gallerySweep { from { transform: translateX(-130%) skewX(-18deg) } to { transform: translateX(230%) skewX(-18deg) } }`}</style>

      <div
        id="trabajos"
        className={`relative mx-auto w-full max-w-[min(400px,84vw)] select-none ${className ?? ''}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Eyebrow compacto */}
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-brand-600 sm:text-[10px]">
            Fotos del taller
          </p>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 sm:text-[10px]">
            {num} / {String(PHOTOS.length).padStart(2, '0')}
          </p>
        </div>

        {/* Stage */}
        <div
          className="relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10"
          role="button"
          tabIndex={0}
          aria-label={`Ver foto ${num} en pantalla completa`}
          onClick={() => setLightbox(current)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(current) } }}
        >
          {/* Glow rojo de fondo */}
          <span className="pointer-events-none absolute -inset-3 -z-10 rounded-[28px] bg-brand-600/20 blur-2xl motion-reduce:hidden" aria-hidden />

          {PHOTOS.map((photo, i) => (
            <img
              key={photo.id}
              src={photo.src}
              alt={photo.alt}
              loading={i < 2 ? 'eager' : 'lazy'}
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out motion-reduce:transition-none ${
                i === current ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            />
          ))}

          {/* Barrido de luz en cada cambio */}
          <span
            key={current}
            className="pointer-events-none absolute inset-y-0 left-0 z-[4] w-2/5 bg-gradient-to-r from-transparent via-white/[0.13] to-transparent motion-reduce:animate-none"
            style={{ animation: 'gallerySweep 1s ease-out' }}
            aria-hidden
          />

          {/* Escuadras de esquina (industrial) */}
          <span className="pointer-events-none absolute left-0 top-0 z-[5] h-5 w-5 border-l-2 border-t-2 border-brand-600/90" aria-hidden />
          <span className="pointer-events-none absolute right-0 top-0 z-[5] h-5 w-5 border-r-2 border-t-2 border-brand-600/90" aria-hidden />
          <span className="pointer-events-none absolute bottom-0 left-0 z-[5] h-5 w-5 border-b-2 border-l-2 border-brand-600/90" aria-hidden />
          <span className="pointer-events-none absolute bottom-0 right-0 z-[5] h-5 w-5 border-b-2 border-r-2 border-brand-600/90" aria-hidden />

          {/* Contador circular */}
          <span className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/70 font-mono text-[10px] font-bold tracking-widest text-brand-500 ring-1 ring-brand-600/60 backdrop-blur-sm" aria-hidden>
            {num}
          </span>

          {/* Degradado inferior para contraste de la placa */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] h-1/3 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />

          {/* Placa de inventario (glass) */}
          <span className="absolute bottom-3 left-3 z-10 flex max-w-[72%] items-center gap-2 rounded-sm bg-black/70 px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white ring-1 ring-white/10 backdrop-blur-md sm:text-[10px]">
            <span className="h-3 w-[3px] shrink-0 bg-brand-600" aria-hidden />
            <span className="truncate">{photo.label}</span>
          </span>
        </div>

        {/* Flechas laterales */}
        <Arrow dir="prev" onClick={prev} label="Foto anterior" />
        <Arrow dir="next" onClick={next} label="Foto siguiente" />

        {/* Barra de progreso con glow */}
        <div className="mx-auto mt-3 h-[3px] w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            ref={barRef}
            className="h-full rounded-full bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 shadow-[0_0_10px_2px_rgba(220,38,38,0.55)]"
            style={{ width: '100%' }}
          />
        </div>

        {/* Thumbnails */}
        <div
          ref={thumbRef}
          className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5"
          style={{ scrollbarWidth: 'none' }}
        >
          {PHOTOS.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => goTo(i)}
              className={[
                'shrink-0 h-11 w-9 overflow-hidden rounded-md ring-1 transition-all duration-300 motion-reduce:transition-none',
                i === current
                  ? 'ring-2 ring-brand-600 opacity-100 scale-[1.04] shadow-[0_0_12px_-2px_rgba(220,38,38,.8)]'
                  : 'ring-white/10 opacity-45 hover:opacity-85 hover:ring-brand-500/60',
              ].join(' ')}
              aria-label={`Ir a foto ${i + 1}`}
            >
              <img src={photo.src} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox — portal al <body> para que fixed funcione dentro del parallax */}
      {lightbox !== null
        ? createPortal(
            <Lightbox current={lightbox} onClose={closeLb} onPrev={prevLb} onNext={nextLb} />,
            document.body,
          )
        : null}
    </>
  )
}