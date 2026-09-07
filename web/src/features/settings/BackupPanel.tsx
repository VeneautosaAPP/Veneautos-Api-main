import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useConfirm } from '../../components/confirm/ConfirmProvider'
import { STALE_SETTINGS_ADMIN_MS } from '../../constants/queryStaleTime'
import { queryKeys } from '../../lib/queryKeys'

type BackupEntry = {
  filename: string
  sizeBytes: number
  sizeFormatted: string
  createdAt: string
  type: 'local' | 'production'
}

type BackupListResponse = {
  success: boolean
  data: BackupEntry[]
}

type BackupCreateResponse = {
  success: boolean
  message: string
  data: BackupEntry
}

type RestoreResponse = {
  success: boolean
  message: string
  duration: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

interface BackupPanelProps {
  canWrite: boolean
}

export function BackupPanel({ canWrite }: BackupPanelProps) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const [creatingLocal, setCreatingLocal] = useState(false)
  const [creatingProd, setCreatingProd] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreType, setRestoreType] = useState<'local' | 'production'>('local')
  const [msg, setMsg] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const backupsQuery = useQuery<BackupListResponse>({
    queryKey: [...queryKeys.settings.root, 'backup-list'],
    queryFn: () => api<BackupListResponse>('/backup/list'),
    staleTime: STALE_SETTINGS_ADMIN_MS,
  })

  const backups = backupsQuery.data?.data ?? []

  const createBackup = useCallback(
    async (type: 'local' | 'production') => {
      const label = type === 'production' ? 'Supabase (producción)' : 'Docker local'
      const ok = await confirm({
        title: `Crear backup de ${label}`,
        message: `Se generará un archivo .sql.gz con el dump completo de la base de datos ${label}. Esto puede tardar unos minutos.`,
        confirmLabel: 'Crear backup',
      })
      if (!ok) return

      setMsg(null)
      if (type === 'local') setCreatingLocal(true)
      else setCreatingProd(true)

      try {
        const res = await api<BackupCreateResponse>('/backup/create', {
          method: 'POST',
          body: JSON.stringify({ type }),
        })
        setMsg(`Backup creado: ${res.data.filename} (${res.data.sizeFormatted})`)
        void queryClient.invalidateQueries({ queryKey: [...queryKeys.settings.root, 'backup-list'] })
      } catch (err) {
        setMsg(`Error: ${err instanceof Error ? err.message : 'No se pudo crear el backup'}`)
      } finally {
        setCreatingLocal(false)
        setCreatingProd(false)
      }
    },
    [confirm, queryClient],
  )

  const downloadBackup = useCallback(async (filename: string) => {
    try {
      setMsg(null)
      const res = await fetch(`${apiBaseUrl()}/backup/download/${filename}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('vene_access_token') ?? ''}`,
        },
      })

      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const text = await res.text()
          if (text) {
            try {
              const body = JSON.parse(text) as { message?: unknown; error?: unknown }
              const m = body.message ?? body.error
              detail = `${detail} — ${m ? JSON.stringify(m) : text}`
            } catch {
              detail = `${detail} — ${text}`
            }
          }
        } catch {
          /* sin cuerpo legible */
        }
        throw new Error(detail)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setMsg(`Error al descargar: ${err instanceof Error ? err.message : 'Error desconocido'}`)
    }
  }, [])

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    setMsg(null)
  }, [])

  const handleRestore = useCallback(async () => {
    if (!selectedFile) return

    const label = restoreType === 'production' ? 'Supabase (producción)' : 'Docker local'
    const ok = await confirm({
      title: `Restaurar backup en ${label}`,
      message: `⚠️ ADVERTENCIA: Esta acción BORRA TODOS los datos actuales de ${label} y los reemplaza con el contenido del archivo.\n\nArchivo: ${selectedFile.name}\n\n¿Estás completamente seguro?`,
      confirmLabel: 'Restaurar',
      variant: 'danger',
    })
    if (!ok) return

    setRestoring(true)
    setMsg(null)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('type', restoreType)

      const token = localStorage.getItem('vene_access_token') ?? ''
      const res = await fetch(`${apiBaseUrl()}/backup/restore`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })

      const data: RestoreResponse = await res.json()

      if (!res.ok) {
        throw new Error(data.message || 'Error al restaurar')
      }

      setMsg(`Restore completado en ${data.duration}. La base de datos ${label} ha sido restaurada.`)
      setSelectedFile(null)
    } catch (err) {
      setMsg(`Error al restaurar: ${err instanceof Error ? err.message : 'Error desconocido'}`)
    } finally {
      setRestoring(false)
    }
  }, [selectedFile, restoreType, confirm])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (ext === 'gz' || ext === 'sql' || ext === 'dump') {
          handleFileSelect(file)
        } else {
          setMsg('Formato no válido. Use archivos .sql.gz o .dump')
        }
      }
    },
    [handleFileSelect],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFileSelect(files[0])
      }
    },
    [handleFileSelect],
  )

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Backup & Restore
          </h2>
          <p className="mt-0.5 max-w-xl text-xs leading-snug text-slate-600 dark:text-slate-300 sm:text-sm">
            Crear respaldos y restaurar la base de datos. Los backups se almacenan temporalmente (24h).
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-lg border border-brand-200 bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-900 dark:border-brand-500 dark:bg-brand-900 dark:text-brand-50 dark:shadow-sm">
          Permiso: settings:update
        </span>
      </div>

      {/* Mensajes */}
      {msg && (
        <p
          className={`rounded-xl px-3 py-2 text-sm ${
            msg.includes('Error')
              ? 'va-alert-error'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100'
          }`}
        >
          {msg}
        </p>
      )}

      {/* Crear Backup */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Crear backup</h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Genera un archivo .sql.gz con el dump completo de la base de datos.
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => createBackup('local')}
            disabled={creatingLocal || !canWrite}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            {creatingLocal ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creando...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Backup Docker local
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => createBackup('production')}
            disabled={creatingProd || !canWrite}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 shadow-sm hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
          >
            {creatingProd ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creando...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                Backup Supabase (producción)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Restaurar Backup */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Restaurar backup</h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Seleccioná un archivo .sql.gz para restaurar la base de datos. ⚠️ Esto borra todos los datos actuales.
        </p>

        {/* Selector de destino */}
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Destino:
          </label>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setRestoreType('local')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                restoreType === 'local'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'
              }`}
            >
              Docker local
            </button>
            <button
              type="button"
              onClick={() => setRestoreType('production')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                restoreType === 'production'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'
              }`}
            >
              Supabase (producción)
            </button>
          </div>
        </div>

        {/* Drag & Drop */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors ${
            isDragOver
              ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
              : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50'
          }`}
        >
          <svg
            className={`h-10 w-10 ${isDragOver ? 'text-blue-500' : 'text-slate-400'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Arrastrá un archivo aquí o{' '}
            <label className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400">
              seleccioná
              <input
                type="file"
                accept=".sql.gz,.sql,.dump"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
            Formatos aceptados: .sql.gz, .sql, .dump
          </p>
        </div>

        {/* Archivo seleccionado */}
        {selectedFile && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/50">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{selectedFile.name}</p>
                <p className="text-xs text-slate-500">{formatBytes(selectedFile.size)}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Botón de restaurar */}
        {selectedFile && (
          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring || !canWrite}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {restoring ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Restaurando...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Restaurar base de datos
              </>
            )}
          </button>
        )}
      </div>

      {/* Lista de backups */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Backups disponibles</h3>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: [...queryKeys.settings.root, 'backup-list'] })}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Actualizar
          </button>
        </div>

        {backupsQuery.isPending && (
          <p className="mt-3 text-sm text-slate-500">Cargando...</p>
        )}

        {backupsQuery.isError && (
          <p className="mt-3 text-sm text-red-600">Error al cargar backups</p>
        )}

        {backups.length === 0 && !backupsQuery.isPending && (
          <p className="mt-3 text-sm text-slate-500">No hay backups disponibles</p>
        )}

        {backups.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Archivo</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Tipo</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Tamaño</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Fecha</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-800">
                {backups.map((b) => (
                  <tr key={b.filename} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-900 dark:text-slate-100">
                      {b.filename}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          b.type === 'production'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                        }`}
                      >
                        {b.type === 'production' ? 'Supabase' : 'Local'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600 dark:text-slate-400">
                      {b.sizeFormatted}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600 dark:text-slate-400">
                      {formatDate(b.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => downloadBackup(b.filename)}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Descargar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function apiBaseUrl(): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''
  return `${base}/api/v1`
}
