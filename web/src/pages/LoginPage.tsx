import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ApiError, getToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { portalPath } from '../constants/portalPath'

function loginFailureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Correo o contraseña incorrectos.'
    if (err.status === 0)
      return err.message || 'No pudimos contactar al servidor. Comprobá tu conexión e intentá de nuevo.'
    if (err.status === 502 || err.status === 503 || err.status === 504)
      return 'El servidor no respondió a tiempo. Intentá de nuevo en unos momentos.'
    if (/npm run|PostgreSQL en Docker|localhost/i.test(err.message))
      return 'No pudimos validar el acceso. Si el problema continúa, avisá al administrador.'
    return err.message
  }
  return 'No se pudo iniciar sesión'
}

export function LoginPage() {
  const { user, ready, login, sessionError, retrySession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (ready && user) {
    return <Navigate to={portalPath('/ordenes')} replace />
  }

  if (ready && sessionError === 'network' && getToken()) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-100 px-4 py-10 text-center text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <p className="max-w-md text-sm">
          No pudimos validar la sesión con el servidor. Tu sesión sigue guardada en este navegador.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            onClick={() => retrySession()}
          >
            Reintentar
          </button>
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
            onClick={() => window.location.reload()}
          >
            Recargar página
          </button>
        </div>
      </div>
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const em = email.trim()
    if (!em) {
      setErr('Ingresá el correo.')
      return
    }
    if (password.length < 8) {
      setErr('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    setLoading(true)
    try {
      await login(em, password)
    } catch (e) {
      setErr(loginFailureMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const fieldClass =
    'h-10 min-w-0 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-zinc-500 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20'

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <img
            src="/logo_landing.png"
            alt="Vene Autos"
            className="h-9 w-auto max-w-[200px] select-none"
            draggable={false}
          />
          <Link
            to="/"
            className="text-xs font-semibold uppercase tracking-wide text-zinc-600 underline-offset-4 transition hover:text-zinc-950 hover:underline dark:text-zinc-400 dark:hover:text-white"
          >
            Volver al sitio
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[min(100%,22rem)] rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h1 className="text-lg font-semibold text-zinc-950 dark:text-white">Acceso al panel</h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Ingresá con tu correo y contraseña del taller.</p>

          <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit} noValidate>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Correo</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${fieldClass} mt-1`}
                placeholder="correo@empresa.com"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Contraseña</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fieldClass} mt-1`}
                placeholder="Mínimo 8 caracteres"
              />
            </label>
            {err ? (
              <p className="va-alert-error text-xs leading-snug" role="alert">
                {err}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border border-zinc-900 bg-zinc-950 text-sm font-semibold text-white shadow-sm ring-1 ring-black/10 transition hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-950 dark:ring-white/10 dark:hover:bg-white dark:focus-visible:ring-zinc-300/40 dark:focus-visible:ring-offset-zinc-900"
            >
              {loading ? '…' : 'Entrar'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
