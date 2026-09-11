import { Maximize, Minimize } from 'lucide-react'
import { useEffect, useState } from 'react'

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return (
    /iPad|iPhone|iPod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  )
}

/** Botón de pantalla completa (replicado de autopiezas-tegui); se oculta en iOS. */
export function FullscreenToggle({ className }: { className?: string }) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (isIOS()) return
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function toggle() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      /* el usuario deberá tocar el elemento en pantalla */
    }
  }

  if (isIOS()) return null

  return (
    <button
      type="button"
      aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
      className={className}
      onClick={() => void toggle()}
      title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
    >
      {isFullscreen ? <Minimize size={19} strokeWidth={1.75} aria-hidden /> : <Maximize size={19} strokeWidth={1.75} aria-hidden />}
    </button>
  )
}