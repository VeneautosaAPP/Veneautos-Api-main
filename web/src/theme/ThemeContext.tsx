/* eslint-disable react-refresh/only-export-components -- useTheme vive junto al provider por cohesión del módulo */
import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'

/**
 * El panel es **solo oscuro**: se descartó el tema claro. La preferencia queda fija en `dark`
 * (se mantiene la forma del contexto para no tocar los consumidores) y el `dark` del `<html>`
 * se aplica siempre.
 */
export type ThemePreference = 'dark'

type ThemeContextValue = {
  preference: ThemePreference
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'vene-theme-preference'

function applyDark() {
  document.documentElement.classList.add('dark')
  document.documentElement.style.colorScheme = 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    applyDark()
    // Limpia la preferencia vieja (light/system) para que no quede basura en el dispositivo.
    try {
      localStorage.setItem(STORAGE_KEY, 'dark')
    } catch {
      /* modo privado */
    }
  }, [])

  const value = useMemo(() => ({ preference: 'dark' as ThemePreference }), [])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Hook del tema: el panel trabaja siempre en oscuro. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme debe usarse dentro de ThemeProvider')
  }
  return ctx
}
