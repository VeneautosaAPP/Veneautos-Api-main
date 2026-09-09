import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  collectRecognizeBoxLines,
  parseTransitLicenseFromRecognizeData,
} from '../../utils/parseTransitLicenseLayout'
import {
  mergeTransitLicenseLayoutAndText,
  parseTransitLicenseOcrText,
  parsedTransitLicenseHasAny,
  type ParsedTransitLicenseFields,
} from '../../utils/parseTransitLicenseOcr'
import { downscaleImageForOcr, isMobileLike } from '../../utils/imageDownscale'
import {
  clearOcrImage,
  loadOcrImage,
  saveOcrImage,
} from '../../services/ocrImageCache'

type Props = {
  disabled?: boolean
  onApply: (parsed: ParsedTransitLicenseFields) => void
}

type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>
type TransitRecognizePageData = Parameters<typeof parseTransitLicenseFromRecognizeData>[0]

/**
 * Panel de OCR para tarjeta de tránsito.
 *
 * Robustez en móviles (iPhone/Android), donde el sistema mata la pestaña por
 * presión de memoria si Tesseract.js arranca con una foto de 12 MP cruda:
 *
 *  1. Apenas el usuario selecciona/toma la foto, la redimensionamos a
 *     ≤ 1600 px (lado largo) y la recomprimimos a JPEG q=0.85. La precisión
 *     del OCR no baja —incluso mejora— y el blob queda 5-10× más liviano.
 *  2. Pre-calentamos el worker de Tesseract al montar el panel: descarga el
 *     `traineddata` de español en IndexedDB del navegador antes de que el
 *     usuario toque "Escanear". Cuando se le da, el worker ya está listo y
 *     no compite por memoria con la decodificación de la imagen.
 *  3. Persistimos la foto reducida en IndexedDB. Si la pestaña se reinicia
 *     (Safari/Chrome móvil suelen hacerlo al volver de la cámara con poca
 *     RAM), al volver al panel ofrecemos "recuperar foto" y continuar el
 *     escaneo sin que el operario tenga que volver a fotografiar.
 *  4. En móvil hacemos UNA sola pasada de Tesseract (SINGLE_BLOCK). En
 *     desktop seguimos con dos pasadas (SINGLE_BLOCK + SPARSE_TEXT) porque
 *     la RAM no es restricción y el doble análisis levanta recall.
 */
export function TransitLicenseOcrPanel({ disabled, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<TesseractWorker | null>(null)
  const workerPromiseRef = useRef<Promise<TesseractWorker> | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [lastParsed, setLastParsed] = useState<ParsedTransitLicenseFields | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [recovered, setRecovered] = useState(false)

  /**
   * Devuelve un worker listo, instanciándolo on-demand y reusándolo entre
   * escaneos. La promesa intermedia (`workerPromiseRef`) evita carreras si
   * `ensureWorker` se llama dos veces antes de terminar la primera.
   */
  const ensureWorker = useCallback(async (): Promise<TesseractWorker> => {
    if (workerRef.current) return workerRef.current
    if (workerPromiseRef.current) return workerPromiseRef.current
    const promise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const w = await createWorker('spa', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProgress(`Leyendo imagen… ${Math.round((m.progress ?? 0) * 100)}%`)
          } else if (typeof m.progress === 'number' && m.status) {
            setProgress(`${m.status}… ${Math.round(m.progress * 100)}%`)
          }
        },
      })
      workerRef.current = w
      return w
    })()
    workerPromiseRef.current = promise
    try {
      return await promise
    } finally {
      workerPromiseRef.current = null
    }
  }, [])

  // Pre-calentamiento del worker al montar el panel. Si falla (ej. red lenta
  // o sin tesseract.js disponible) no es fatal: `runOcr` lo reintentará.
  useEffect(() => {
    void ensureWorker().catch((e) => {
      console.warn('[OCR] pre-warm fallido', e)
    })
    return () => {
      const w = workerRef.current
      workerRef.current = null
      if (w) {
        void w.terminate().catch(() => {
          /* ignore */
        })
      }
    }
  }, [ensureWorker])

  // Recuperación post-reinicio: si el panel anterior dejó una foto en IDB,
  // la cargamos automáticamente y avisamos al usuario para que decida.
  useEffect(() => {
    let cancelled = false
    void loadOcrImage().then((f) => {
      if (cancelled || !f) return
      setPendingFile(f)
      setRecovered(true)
      setProgress('Foto recuperada de tu sesión anterior — tocá Escanear para continuar.')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onPickFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setErr(null)
    setLastParsed(null)
    setRecovered(false)
    setProgress('Optimizando imagen…')
    try {
      const small = await downscaleImageForOcr(f, 1600)
      setPendingFile(small)
      // Persistimos en IDB para sobrevivir un reinicio del tab. Es best-effort:
      // si IDB está bloqueado (modo privado en Safari), seguimos en RAM.
      void saveOcrImage(small).catch(() => {
        /* ignore */
      })
      setProgress(`Foto lista (${(small.size / 1024).toFixed(0)} KB) — tocá Escanear.`)
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'No se pudo procesar la imagen')
      setProgress(null)
    }
  }, [])

  const runOcr = useCallback(async () => {
    if (!pendingFile || disabled) return
    setErr(null)
    setLastParsed(null)
    setBusy(true)
    setProgress('Iniciando OCR…')
    try {
      const worker = await ensureWorker()
      const { PSM } = await import('tesseract.js')
      type TessPsm = NonNullable<Parameters<typeof worker.setParameters>[0]['tessedit_pageseg_mode']>
      const pageModes: TessPsm[] = isMobileLike()
        ? [(PSM?.SINGLE_BLOCK ?? '6') as TessPsm]
        : [
            (PSM?.SINGLE_BLOCK ?? '6') as TessPsm,
            (PSM?.SPARSE_TEXT ?? '11') as TessPsm,
          ]

      let combinedText = ''
      let bestLayoutSource: TransitRecognizePageData | null = null
      let bestLineCount = -1

      for (let pass = 0; pass < pageModes.length; pass++) {
        const psm = pageModes[pass]
        await worker.setParameters({ tessedit_pageseg_mode: psm })
        setProgress(pass === 0 ? 'Extrayendo texto…' : 'Segunda lectura (refuerzo)…')
        const { data } = await worker.recognize(pendingFile, { rotateAuto: true })
        const chunk = typeof data.text === 'string' ? data.text : ''
        combinedText = combinedText ? `${combinedText}\n${chunk}` : chunk
        const n = collectRecognizeBoxLines(data).length
        if (n > bestLineCount) {
          bestLineCount = n
          bestLayoutSource = data
        }
      }

      const layoutData = bestLayoutSource ?? {}
      const fromLayout = parseTransitLicenseFromRecognizeData(layoutData)
      const fromText = parseTransitLicenseOcrText(combinedText)
      const parsed = mergeTransitLicenseLayoutAndText(fromLayout, fromText, combinedText)
      if (!parsedTransitLicenseHasAny(parsed)) {
        setErr('No se detectaron campos reconocibles. Probá otra foto (más luz, menos reflejo).')
        setProgress(null)
        return
      }
      setLastParsed(parsed)
      setProgress(null)
      // Foto procesada con éxito: la sacamos del cache para no ofrecer
      // "recuperar" la próxima vez que entre al panel.
      void clearOcrImage().catch(() => {
        /* ignore */
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al procesar la imagen')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [pendingFile, disabled, ensureWorker])

  const apply = useCallback(() => {
    if (lastParsed) onApply(lastParsed)
  }, [lastParsed, onApply])

  const discardPending = useCallback(() => {
    setPendingFile(null)
    setRecovered(false)
    setProgress(null)
    setErr(null)
    if (inputRef.current) inputRef.current.value = ''
    void clearOcrImage().catch(() => {
      /* ignore */
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Licencia de tránsito (OCR)</h3>

      {recovered && pendingFile ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">Hay una foto sin procesar de tu sesión anterior.</p>
          <p className="mt-0.5">
            Tocá <b>Escanear</b> para continuar o{' '}
            <button type="button" onClick={discardPending} className="underline">
              descartá
            </button>{' '}
            para tomar una nueva.
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block min-w-0 flex-1 text-sm">
          <span className="va-label">Imagen</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled || busy}
            onChange={(e) => void onPickFile(e)}
            className="va-field mt-1 block w-full cursor-pointer text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-800 hover:file:bg-slate-200 dark:file:bg-slate-800 dark:file:text-slate-100 dark:hover:file:bg-slate-700"
          />
        </label>
        <button
          type="button"
          disabled={disabled || busy || !pendingFile}
          onClick={() => void runOcr()}
          className="va-btn-primary disabled:opacity-50"
        >
          {busy ? 'Procesando…' : 'Escanear'}
        </button>
      </div>
      {progress ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{progress}</p> : null}
      {err ? <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p> : null}
      {lastParsed && parsedTransitLicenseHasAny(lastParsed) ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-600 dark:bg-slate-950">
          <p className="font-medium text-slate-700 dark:text-slate-200">Detectado (revisá antes de aplicar):</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
            {lastParsed.plate ? <li>PLACA: {lastParsed.plate}</li> : null}
            {lastParsed.brand ? <li>MARCA: {lastParsed.brand}</li> : null}
            {lastParsed.line ? <li>LÍNEA: {lastParsed.line}</li> : null}
            {lastParsed.model ? <li>MODELO: {lastParsed.model}</li> : null}
            {lastParsed.cylinderCc ? <li>CILINDRAJE: {lastParsed.cylinderCc}</li> : null}
            {lastParsed.color ? <li>COLOR: {lastParsed.color}</li> : null}
          </ul>
          <button
            type="button"
            disabled={disabled}
            onClick={apply}
            className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-600 dark:hover:bg-slate-500"
          >
            Aplicar a esta orden
          </button>
        </div>
      ) : null}
    </div>
  )
}
