/**
 * Corrida del corpus de OCR (fuera de git, carpeta `tmp/ocr-corpus`).
 *
 * Pasa cada foto por el MISMO pipeline que usa el panel (`TransitLicenseOcrPanel`):
 * dos lecturas de Tesseract (SINGLE_BLOCK + SPARSE_TEXT, rotateAuto) y despuÃ©s
 * `parseTransitLicenseFromRecognizeData` + `parseTransitLicenseOcrText` + merge.
 *
 * Uso:
 *   npx tsx scripts/ocr-corpus.ts                      # usa tmp/ocr-corpus
 *   npx tsx scripts/ocr-corpus.ts "C:\ruta\fotos"
 *
 * Si junto a las fotos hay un `esperado.csv` (archivo,placa,marca,linea,modelo,cilindraje,color)
 * marca cada campo como OK/FAIL. Si no, imprime lo detectado para validarlo a mano.
 *
 * Salida: `tmp/ocr-corpus/resultados.json` con el texto crudo por foto (para armar fixtures
 * de tests sin necesidad de las imÃ¡genes).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createWorker, PSM } from 'tesseract.js'
import {
  fillMissingTransitLicenseFields,
  mergeTransitLicenseLayoutAndText,
  parseTransitLicenseOcrText,
  type ParsedTransitLicenseFields,
} from '../src/utils/parseTransitLicenseOcr'
import { parseTransitLicenseFromRecognizeData } from '../src/utils/parseTransitLicenseLayout'

const IMAGE_RE = /\.(jpe?g|png|webp|heic)$/i
const FIELDS: (keyof ParsedTransitLicenseFields)[] = [
  'plate',
  'brand',
  'line',
  'model',
  'cylinderCc',
  'color',
]

/**
 * Clave de una foto: "1.jpeg", "1__gray.jpg" y "1" refieren a la misma foto, así que el
 * `esperado.csv` sirve tanto para la carpeta original como para `proc/` (variantes).
 */
function photoKey(file: string): string {
  return file
    .toLowerCase()
    .replace(/\.(jpe?g|png|webp|heic)$/i, '')
    .replace(/__(plain|gray)$/i, '')
    .trim()
}

async function readExpected(dir: string): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>()
  try {
    // El CSV vive en la carpeta del corpus; si corrés un subdirectorio (`proc`, `proc-gray`)
    // lo buscamos también en el padre.
    let raw: string
    try {
      raw = await readFile(join(dir, 'esperado.csv'), 'utf8')
    } catch {
      raw = await readFile(join(dirname(dir), 'esperado.csv'), 'utf8')
    }
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const [file, plate, brand, line2, model, cylinderCc, color] = line.split(',').map((s) => (s ?? '').trim())
      out.set(photoKey(file ?? ''), { plate, brand, line: line2, model, cylinderCc, color })
    }
  } catch {
    /* sin archivo esperado: solo imprimimos lo detectado */
  }
  return out
}

function norm(s: string | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function main() {
  const dir = resolve(process.argv[2] ?? join(process.cwd(), '..', 'tmp', 'ocr-corpus'))
  const files = (await readdir(dir)).filter((f) => IMAGE_RE.test(f)).sort()
  if (files.length === 0) {
    console.log(`No hay imÃ¡genes en ${dir}. CopiÃ¡ las 10 fotos ahÃ­ (01.jpg â€¦ 10.jpg).`)
    return
  }

  const expected = await readExpected(dir)
  console.log(`Corpus: ${files.length} foto(s) en ${dir}`)
  if (expected.size) console.log(`Con valores esperados para ${expected.size} archivo(s).`)
  console.log('')

  const worker = await createWorker('spa', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') process.stdout.write(`\r  leyendoâ€¦ ${Math.round((m.progress ?? 0) * 100)}%   `)
    },
  })

  const dump: Array<Record<string, unknown>> = []
  let fails = 0
  let total = 0

  for (const file of files) {
    const path = join(dir, file)
    let combinedText = ''
    let bestText = ''
    let bestData: unknown = null
    let bestConfidence = -1

    for (const psm of [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT]) {
      await worker.setParameters({ tessedit_pageseg_mode: psm as never })
      const { data } = await worker.recognize(path, { rotateAuto: true })
      const chunk = data.text ?? ''
      combinedText = combinedText ? `${combinedText}\n${chunk}` : chunk
      const conf = typeof data.confidence === 'number' ? data.confidence : 0
      if (conf > bestConfidence) {
        bestConfidence = conf
        bestData = data
        bestText = chunk
      }
    }

    // Mismo criterio que el panel: mejor pasada primero, las dos sólo para completar huecos.
    const fromLayout = parseTransitLicenseFromRecognizeData(bestData as never)
    const parsedBest = mergeTransitLicenseLayoutAndText(
      fromLayout,
      parseTransitLicenseOcrText(bestText),
      bestText,
    )
    const parsedAll = mergeTransitLicenseLayoutAndText(
      fromLayout,
      parseTransitLicenseOcrText(combinedText),
      combinedText,
    )
    const parsed = fillMissingTransitLicenseFields(parsedBest, parsedAll)

    console.log(`\nâ”€â”€ ${file}  (confianza ${bestConfidence.toFixed(1)}%)`)
    const exp = expected.get(photoKey(file))
    for (const f of FIELDS) {
      const got = (parsed[f] ?? 'â€”').toString()
      let mark = ''
      if (exp) {
        total += 1
        const want = (exp[f] ?? '').toString()
        const ok = !want || norm(got) === norm(want)
        if (!ok) fails += 1
        mark = want ? (ok ? ' âœ“' : ` âœ— (esperado: ${want})`) : ' ?'
      }
      console.log(`   ${f.padEnd(11)} ${got}${mark}`)
    }

    dump.push({ file, confidence: bestConfidence, parsed, rawOcrText: combinedText })
  }

  await worker.terminate()
  await writeFile(join(dir, 'resultados.json'), JSON.stringify(dump, null, 2), 'utf8')
  console.log(`\nTexto crudo y campos por foto: ${join(dir, 'resultados.json')}`)
  if (expected.size) console.log(`Fallos: ${fails}/${total} campos.`)
}

void main()
