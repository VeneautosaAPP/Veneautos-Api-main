import { useEffect, useState } from 'react'

/** Devuelve `value` actualizado solo si no cambió durante `delayMs` (autocompletado de catálogos). */
export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}
