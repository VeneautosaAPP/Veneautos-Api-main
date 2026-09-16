/**
 * Extrae campos típicos de una licencia de tránsito (CO) desde texto OCR.
 * Soporta: (1) etiqueta sola y dato en la línea siguiente; (2) una línea tipo
 * "PLACA: XTZ-2366 COLINDRAJE: 1.400 MARCA: ..." (incluye typo COLINDRAJE).
 */

export type ParsedTransitLicenseFields = {
  plate?: string
  brand?: string
  line?: string
  model?: string
  cylinderCc?: string
  color?: string
}

function cleanSegment(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[:\-–—.\s]+|[:\-–—.\s]+$/g, '')
    .replace(/\.+$/g, '')
    .trim()
}

const LABEL_WORDS = new Set(
  [
    'placa',
    'marca',
    'linea',
    'línea',
    'modelo',
    'color',
    'cilindraje',
    'cilindrada',
    'colindraje',
    'vehiculo',
    'vehículo',
    'del',
    'no',
    'clase',
    'servicio',
    'capacidad',
    'motor',
    'combustible',
  ].map((w) => w.toLowerCase()),
)

export function looksLikeLabelOnlyValue(field: keyof ParsedTransitLicenseFields, v: string): boolean {
  const t = cleanSegment(v).toLowerCase()
  if (t.length < 2) return true
  if (LABEL_WORDS.has(t)) return true
  if (field === 'plate' && t.length < 3) return true
  if (field === 'plate' && /^placas?$/i.test(t)) return true
  if (field === 'cylinderCc' && /^(cilind|cc|cm)/i.test(t) && t.length < 4) return true
  if (field === 'model') {
    if (/^(modelo|model0|mod[eé]lo|mod)s?$/i.test(t)) return true
    if (/^mod(e|é|3)?l?o?$/i.test(t) && t.length <= 6 && !/\d/.test(t)) return true
  }
  return false
}

/** Normaliza placa colombiana a mayúsculas y quita espacios internos opcionales. */
export function normalizePlateFromOcr(raw: string): string {
  const t = cleanSegment(raw).toUpperCase().replace(/\s+/g, '')
  if (t.length < 3 || t.length > 12) return cleanSegment(raw).toUpperCase()
  return t
}

/** Si la línea es solo la etiqueta (sin dato útil a la derecha), devuelve el campo. */
export function classifyTransitLicenseLabelLine(line: string): keyof ParsedTransitLicenseFields | null {
  const t = line.trim()
  if (/^placa(?:\s+veh[íi]culo|\s+del\s+veh[íi]culo)?\s*[:.\s·]*$/i.test(t)) return 'plate'
  if (/^(?:colindraje|cilindr[aeo]je|cilindrada)\s*[:.\s·]*$/i.test(t)) return 'cylinderCc'
  if (/^marca\s*[:.\s·]*$/i.test(t)) return 'brand'
  if (/^(?:l[íi]nea|linea)\s*[:.\s·]*$/i.test(t)) return 'line'
  if (/^(?:modelo|model0|m[0o]de[1l]o|mod[eé]lo)(?:\s+veh[íi]culo)?\s*[:.\s·]*$/i.test(t)) return 'model'
  if (/^color\s*[:.\s·]*$/i.test(t)) return 'color'
  return null
}

const SAME_LINE_STOP =
  '(?:COLINDRAJE|CILINDR[AE]JE|CILINDRADA|MARCA|L[ÍI]NEA|LINEA|MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|COLOR|PLACA)\\s*:'
/** Tras LÍNEA: el siguiente campo suele ser MODELO (a veces sin `:` en el OCR). */
const STOP_AFTER_LINEA = `(?:\\s+${SAME_LINE_STOP}|\\s+\\b(?:MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO)\\b|$)`
const INLINE_MODELO = String.raw`(?:MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|MDOELO|MODLO|MODOLO)`

/** Etiqueta + valor en la misma línea (acotado hasta la siguiente etiqueta). */
function sameLineLabelValue(line: string): { field: keyof ParsedTransitLicenseFields; value: string } | null {
  let m: RegExpMatchArray | null

  m = line.match(
    new RegExp(
      `^\\s*placa(?:\\s+veh[íi]culo|\\s+del\\s+veh[íi]culo)?\\s*[:.\\-]?\\s*([A-Z0-9.\\s\\-]+?)(?=\\s+${SAME_LINE_STOP}|$)`,
      'i',
    ),
  )
  if (m?.[1] && cleanSegment(m[1]).length >= 2) return { field: 'plate', value: m[1] }

  m = line.match(
    new RegExp(
      `^\\s*(?:colindraje|cilindr[aeo]je|cilindrada)\\s*[:.\\-]?\\s*([^]+?)(?=\\s+${SAME_LINE_STOP}|$)`,
      'i',
    ),
  )
  if (m?.[1]) return { field: 'cylinderCc', value: m[1] }

  m = line.match(new RegExp(`^\\s*marca\\s*[:.\\-]?\\s*([^]+?)(?=\\s+${SAME_LINE_STOP}|$)`, 'i'))
  if (m?.[1]) return { field: 'brand', value: m[1] }

  m = line.match(new RegExp(`^\\s*(?:l[íi]nea|linea)\\s*[:.\\-]?\\s*([^]+?)(?=${STOP_AFTER_LINEA})`, 'i'))
  if (m?.[1]) return { field: 'line', value: m[1] }

  m = line.match(
    new RegExp(
      `^\\s*${INLINE_MODELO}(?:\\s+veh[íi]culo)?\\s*[:.\\-]?\\s*([^]+?)(?=\\s+${SAME_LINE_STOP}|$)`,
      'i',
    ),
  )
  if (m?.[1]) return { field: 'model', value: m[1] }

  m = line.match(/^\s*color\s*[:.\-]?\s*(.+)$/i)
  if (m?.[1]) return { field: 'color', value: m[1] }

  return null
}

const NEXT_INLINE_STOP =
  '(?:COLINDRAJE|CILINDR[AE]JE|CILINDRADA|MARCA|L[ÍI]NEA|LINEA|MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|COLOR|PLACA)\\s*:'
const NEXT_INLINE_OR_MODELO_WORD = `(?:${NEXT_INLINE_STOP}|\\b(?:MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO)\\b)`

/**
 * Texto en una sola línea (u OCR pegado): "PLACA: XTZ-2366 COLINDRAJE: 1.400 MARCA: ..."
 */
function parseCompactInline(flat: string): ParsedTransitLicenseFields {
  const s = flat.replace(/\s+/g, ' ').trim()
  const out: ParsedTransitLicenseFields = {}

  const take = (re: RegExp, key: keyof ParsedTransitLicenseFields, maxLen: number) => {
    const m = s.match(re)
    if (!m?.[1]) return
    let v = cleanSegment(m[1])
    if (!v || looksLikeLabelOnlyValue(key, v)) return
    if (key === 'plate') v = normalizePlateFromOcr(v)
    out[key] = v.slice(0, maxLen)
  }

  take(
    new RegExp(`\\bPLACA\\s*:\\s*([A-Z0-9.\\s\\-]+?)(?=\\s+${NEXT_INLINE_STOP}|\\s*$)`, 'i'),
    'plate',
    40,
  )
  take(
    new RegExp(
      `\\b(?:COLINDRAJE|CILINDR[AE]JE|CILINDRADA)\\s*:\\s*([^]+?)(?=\\s+${NEXT_INLINE_STOP}|\\s*$)`,
      'i',
    ),
    'cylinderCc',
    32,
  )
  take(
    new RegExp(`\\bMARCA\\s*:\\s*([^]+?)(?=\\s+${NEXT_INLINE_STOP}|\\s*$)`, 'i'),
    'brand',
    80,
  )
  take(
    new RegExp(`\\b(?:L[ÍI]NEA|LINEA)\\s*:\\s*([^]+?)(?=\\s+${NEXT_INLINE_OR_MODELO_WORD}|\\s*$)`, 'i'),
    'line',
    120,
  )
  take(
    new RegExp(
      `\\b${INLINE_MODELO}\\s*:\\s*([^]+?)(?=\\s+${NEXT_INLINE_STOP}|\\s*$)`,
      'i',
    ),
    'model',
    80,
  )
  take(
    new RegExp(
      `\\b${INLINE_MODELO}\\s+((?:19|20)\\d{2}|[A-Z0-9][A-Z0-9\\s\\-.]{0,35}?)(?=\\s+${NEXT_INLINE_STOP}|\\s*$)`,
      'i',
    ),
    'model',
    80,
  )
  take(new RegExp(`\\bCOLOR\\s*:\\s*(.+)$`, 'i'), 'color', 80)

  return out
}

/** Etiqueta en una línea; el dato suele ir en la línea siguiente (texto más grande en la tarjeta). */
function parseStackedLabelThenValue(text: string): ParsedTransitLicenseFields {
  const rawLines = text.split(/\n/).map((l) => l.trim())
  const lines = rawLines.filter((l) => l.length > 0)
  const out: ParsedTransitLicenseFields = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const inline = sameLineLabelValue(line)
    if (inline) {
      const v = cleanSegment(inline.value)
      if (v && !looksLikeLabelOnlyValue(inline.field, v)) {
        if (inline.field === 'plate') out.plate = normalizePlateFromOcr(v).slice(0, 40)
        else if (inline.field === 'cylinderCc') out.cylinderCc = v.slice(0, 32)
        else if (inline.field === 'brand') out.brand = v.slice(0, 80)
        else if (inline.field === 'line') out.line = v.slice(0, 120)
        else if (inline.field === 'model') out.model = v.slice(0, 80)
        else if (inline.field === 'color') out.color = v.slice(0, 80)
      }
      continue
    }

    const field = classifyTransitLicenseLabelLine(line)
    if (field && i + 1 < lines.length) {
      const next = lines[i + 1]
      if (classifyTransitLicenseLabelLine(next) || sameLineLabelValue(next)) {
        continue
      }
      let v = cleanSegment(next)
      if (!v || looksLikeLabelOnlyValue(field, v)) continue
      if (field === 'plate') v = normalizePlateFromOcr(v)
      if (field === 'plate') out.plate = v.slice(0, 40)
      else if (field === 'cylinderCc') out.cylinderCc = v.slice(0, 32)
      else if (field === 'brand') out.brand = v.slice(0, 80)
      else if (field === 'line') out.line = v.slice(0, 120)
      else if (field === 'model') out.model = v.slice(0, 80)
      else if (field === 'color') out.color = v.slice(0, 80)
      i++
    }
  }

  return out
}

function mergePreferData(
  a: ParsedTransitLicenseFields,
  b: ParsedTransitLicenseFields,
): ParsedTransitLicenseFields {
  const keys: (keyof ParsedTransitLicenseFields)[] = [
    'plate',
    'cylinderCc',
    'brand',
    'line',
    'model',
    'color',
  ]
  const out: ParsedTransitLicenseFields = {}
  for (const k of keys) {
    const va = a[k]
    const vb = b[k]
    const pick =
      va && !looksLikeLabelOnlyValue(k, va)
        ? va
        : vb && !looksLikeLabelOnlyValue(k, vb)
          ? vb
          : va || vb
    if (pick) out[k] = pick
  }
  return out
}

/**
 * Parsea texto OCR: prioriza datos bajo etiquetas y formato compacto "CLAVE: valor".
 */
export function parseTransitLicenseOcrText(raw: string): ParsedTransitLicenseFields {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const flat = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ')

  const stacked = parseStackedLabelThenValue(text)
  const inline = parseCompactInline(flat)
  return refineTransitLicenseFields(mergePreferData(stacked, inline), raw)
}

function dedupeWordsTransit(s: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of s.split(/\s+/)) {
    const k = w.toUpperCase()
    if (!w || seen.has(k)) continue
    seen.add(k)
    out.push(w)
  }
  return out.join(' ')
}

/** Patrones frecuentes de placa CO (letras + dígitos, opcional guión). */
export function extractColombiaPlateCandidate(s: string): string | null {
  const u = s.toUpperCase().replace(/\s+/g, ' ').trim()
  if (!u) return null
  const ordered: RegExp[] = [
    /\b([A-Z]{3}[\-]?\d{3})\b/,
    /\b([A-Z]{2}[\-]?\d{4})\b/,
    /\b(\d{3}[\-]?[A-Z]{3})\b/,
    /\b([A-Z]{2,4}\d{3,4})\b/,
  ]
  for (const re of ordered) {
    const m = u.match(re)
    if (m?.[1] && /\d/.test(m[1]) && m[1].length <= 12) return m[1].replace(/-/g, '')
  }
  return null
}

function splitPlateBrandMixed(out: ParsedTransitLicenseFields) {
  const blob = `${out.plate ?? ''} ${out.brand ?? ''}`.replace(/\s+/g, ' ').trim()
  if (!blob) return
  const tok = extractColombiaPlateCandidate(blob)
  if (!tok) return

  out.plate = normalizePlateFromOcr(tok)

  let brand = blob
    .replace(new RegExp(`\\b${tok.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
  brand = dedupeWordsTransit(brand)
  if (brand.length >= 2) out.brand = brand.slice(0, 80)
  else if ((out.brand ?? '').length > 0) {
    const b2 = out.brand!.replace(new RegExp(`\\b${tok}\\b`, 'gi'), '').trim()
    if (b2.length >= 2) out.brand = b2.slice(0, 80)
    else delete out.brand
  } else {
    delete out.brand
  }
}

function stripOcrFieldNoise(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[|]+$/g, '')
    .replace(/^[|]+\s*/g, '')
    .trim()
}

/**
 * Cilindraje y color a veces vienen en un solo blob ("1.400 AZUL UNIVERSO PARTICULAR |").
 * También color … 1.400 al final.
 */
function splitColorCylinderTail(out: ParsedTransitLicenseFields) {
  const scrub = stripOcrFieldNoise

  const splitLeadingDisplacement = (raw: string): boolean => {
    const c = scrub(raw)
    const m = c.match(/^(\d{1,2}[.,]\d{3})\s+(.+)$/i)
    if (!m) return false
    out.cylinderCc = m[1].replace(',', '.').slice(0, 32)
    out.color = m[2].trim().slice(0, 80)
    return true
  }

  const splitTrailingDisplacement = (raw: string): boolean => {
    const c = scrub(raw)
    const m = c.match(/^(.+?)\s+(\d{1,2}[.,]\d{3})\s*$/i)
    if (!m) return false
    out.color = m[1].trim().slice(0, 80)
    if (!out.cylinderCc) out.cylinderCc = m[2].replace(',', '.').slice(0, 32)
    return true
  }

  const sameBlob =
    out.color &&
    out.cylinderCc &&
    scrub(out.color) === scrub(out.cylinderCc)

  if (sameBlob && out.color) {
    const c0 = scrub(out.color)
    if (/^\d{1,2}[.,]\d{3}\s/i.test(c0)) splitLeadingDisplacement(out.color)
    else splitTrailingDisplacement(out.color)
  } else {
    if (out.color) {
      const c = scrub(out.color)
      if (/^\d{1,2}[.,]\d{3}\s/i.test(c)) splitLeadingDisplacement(out.color)
      else splitTrailingDisplacement(out.color)
    }
    if (out.cylinderCc) {
      const cc = scrub(out.cylinderCc)
      if (/^\d{1,2}[.,]\d{3}\s/i.test(cc) && /\s/.test(cc)) {
        splitLeadingDisplacement(out.cylinderCc)
      } else {
        const tail = cc.match(/^(\d{1,2}[.,]\d{3})(\s+.+)$/i)
        if (tail?.[2]) {
          const prevCc = cc
          out.cylinderCc = tail[1].replace(',', '.').slice(0, 32)
          if (!out.color || scrub(out.color) === prevCc) {
            out.color = tail[2].trim().slice(0, 80)
          }
        }
      }
    }
  }

  if (out.color) {
    let col = scrub(out.color).replace(/\s+(PARTICULAR|PÚBLICO|PUBLICO)\s*$/i, '')
    col = scrub(col)
    if (col) out.color = col.slice(0, 80)
    else delete out.color
  }
  if (out.cylinderCc) {
    const cc = scrub(out.cylinderCc)
    const num = cc.match(/^(\d{1,2}[.,]\d{3})$/i) ?? cc.match(/^(\d{1,2}[.,]\d{3})\b/i)
    if (num) out.cylinderCc = num[1].replace(',', '.').slice(0, 32)
    else if (cc) out.cylinderCc = cc.slice(0, 32)
    else delete out.cylinderCc
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')
}

/**
 * Si LÍNEA repitió placa / marca / año ya capturados en otros campos, los quita (deja p. ej. «CLIO DYNAMIQUE»).
 */
function stripKnownFieldsFromLine(out: ParsedTransitLicenseFields) {
  let L = (out.line ?? '').trim()
  if (!L) return

  const plate = (out.plate ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (plate.length >= 3) {
    L = L.replace(new RegExp(`\\b${escapeRegExp(plate)}\\b`, 'gi'), ' ')
    if (plate.length === 6 && /^[A-Z]{3}\d{3}$/.test(plate)) {
      const hy = `${plate.slice(0, 3)}-${plate.slice(3)}`
      L = L.replace(new RegExp(`\\b${escapeRegExp(hy)}\\b`, 'gi'), ' ')
    }
  }

  const brand = (out.brand ?? '').trim()
  if (brand.length >= 2) {
    const bFlat = brand.replace(/\s+/g, ' ')
    const reParts = bFlat.split(/\s+/).map((w) => escapeRegExp(w)).join('\\s+')
    L = L.replace(new RegExp(`\\b${reParts}\\b`, 'gi'), ' ')
  }

  const year = (out.model ?? '').trim()
  if (/^(19|20)\d{2}$/.test(year)) {
    L = L.replace(new RegExp(`\\b${year}\\b`), ' ')
  }

  L = cleanSegment(L).replace(/\s+/g, ' ').trim()
  if (L.length >= 2) out.line = L.slice(0, 120)
  else delete out.line
}

/** Si el valor de línea incluye «MODELO … año» (OCR pegó campos), separa. */
function splitModeloFromLineField(out: ParsedTransitLicenseFields) {
  const L = out.line?.trim()
  if (!L || (out.model ?? '').trim().length > 0) return
  const modeloWord = String.raw`(?:MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|MDOELO|MODLO|MODOLO)`
  const idx = L.search(new RegExp(`\\b${modeloWord}\\b`, 'i'))
  if (idx < 0) return
  const tail = L.slice(idx)
  const m = tail.match(
    new RegExp(`^${modeloWord}\\s*:?\\s*((?:19|20|2[Oo0])[0-9OolIiI|]{3})\\b`, 'i'),
  )
  if (!m) return
  const y = normalizeOcrYearDigits(m[1])
  if (!isPlausibleVehicleModelYear(y)) return
  out.model = y
  out.line = L.slice(0, idx).replace(/\s+$/g, '').trim().slice(0, 120)
}

/** Si la línea termina en año (modelo en tarjeta CO), separa a `model`. */
function splitYearFromEndOfLine(out: ParsedTransitLicenseFields) {
  if (!out.line || (out.model ?? '').trim().length > 0) return
  const L = out.line.trim()
  const strict = L.match(/^(.+?)\s+((?:19|20)\d{2})\s*$/)
  if (strict) {
    out.line = strict[1].trim().slice(0, 120)
    out.model = strict[2]
    return
  }
  const loose = L.match(/^(.+?)\s+((?:19|20|2[Oo0])[0-9OolIiI|]{3})\s*$/)
  if (!loose) return
  const y = normalizeOcrYearDigits(loose[2])
  if (!isPlausibleVehicleModelYear(y)) return
  out.line = loose[1].trim().slice(0, 120)
  out.model = y
}

function flatOcr(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** En tarjeta CO, «modelo» del vehículo es el año de fabricación (4 dígitos). */
function maxPlausibleModelYear(): number {
  return new Date().getFullYear() + 2
}

function isPlausibleVehicleModelYear(y: string): boolean {
  const n = Number.parseInt(y, 10)
  return Number.isFinite(n) && n >= 1950 && n <= maxPlausibleModelYear()
}

/** Corrige confusión típica OCR en un bloque de 4 caracteres que debería ser año. */
function normalizeOcrYearDigits(raw4: string): string {
  return raw4
    .replace(/[OoОοº]/g, '0')
    .replace(/[lI|¡!£]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss\$]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[Qq]/g, '9')
}

/** Tokens de 4 letras que pueden ser 19xx / 20xx con ruido OCR. */
const FUZZY_YEAR_TOKEN = /\b(?:19|20|2[Oo0])[0-9OolIiI|SsZzBbGg]{2}\b/gi

function allFuzzyYearCandidates(s: string): Array<{ index: number; year: string }> {
  const out: Array<{ index: number; year: string }> = []
  const re = new RegExp(FUZZY_YEAR_TOKEN.source, FUZZY_YEAR_TOKEN.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const t = normalizeOcrYearDigits(m[0])
    if (/^(19|20)\d{2}$/.test(t) && isPlausibleVehicleModelYear(t)) {
      out.push({ index: m.index, year: t })
    }
  }
  return out
}

function pickFirstFuzzyYear(s: string): string | null {
  const c = allFuzzyYearCandidates(s)
  return c[0]?.year ?? null
}

/** Tras MODELO: primer año (estricto o con O/0/l/1) en ventana corta. */
function extractYearAfterModeloLabelFuzzy(flat: string): string | null {
  const re = new RegExp(String.raw`\b${INLINE_MODELO}\b`, 'i')
  const m = re.exec(flat)
  if (!m) return null
  const window = flat.slice(m.index + m[0].length, m.index + m[0].length + 110)
  return pickFirstFuzzyYear(window)
}

/**
 * Elige año en recorte LÍNEA/MODELO: preferir el primero **después** de la palabra MODELO;
 * si no hay MODELO, el último candidato del recorte (suele ser el año bajo MODELO en la tarjeta).
 */
function pickBestFuzzyYearInSlice(slice: string): string | null {
  const cands = allFuzzyYearCandidates(slice)
  if (cands.length === 0) return null
  const modeloAt = slice.search(new RegExp(String.raw`\b${INLINE_MODELO}\b`, 'i'))
  if (modeloAt >= 0) {
    const after = cands.filter((c) => c.index >= modeloAt)
    if (after.length) return after[0].year
  }
  return cands[cands.length - 1].year
}

/**
 * Línea/caja OCR donde «MODELO» y el año vienen juntos (Tesseract a veces une o separa mal bloques).
 */
export function extractModelYearFromMixedOcrLine(line: string): string | null {
  const t = flatOcr(line)
  if (!t) return null
  const hintsModelo =
    new RegExp(String.raw`\b${INLINE_MODELO}\b`, 'i').test(t) ||
    /\b(?:L[ÍI]NEA|LINEA|LlNEA)\b.*\bMOD[EÉ]?L/i.test(t) ||
    /\bMOD[EÉ]?L[O0]\s*VEH/i.test(t)
  if (!hintsModelo) return null
  return extractYearAfterModeloLabel(t) ?? extractYearAfterModeloLabelFuzzy(t)
}

/** Primer año legible tras la etiqueta MODELO (incluye `MODELO:2004` y OCR con O/0). */
function extractYearAfterModeloLabel(flat: string): string | null {
  if (!flat) return null
  const strict: RegExp[] = [
    new RegExp(String.raw`\b${INLINE_MODELO}\b\s*[:]?\s*((?:19|20)\d{2})\b`, 'i'),
    new RegExp(
      String.raw`\b${INLINE_MODELO}\b(?:\s|\.|·|,|;|[^0-9A-Za-zÀ-ÿ]){0,55}?\b((?:19|20)\d{2})\b`,
      'i',
    ),
  ]
  for (const re of strict) {
    const m = flat.match(re)
    if (m?.[1] && isPlausibleVehicleModelYear(m[1])) return m[1]
  }
  return extractYearAfterModeloLabelFuzzy(flat)
}

/** Recorte del OCR donde suelen ir LÍNEA + MODELO + año (evita años de otros bloques). */
function ocrSliceAroundLineaModelo(flat: string): string {
  if (!flat) return ''
  const idxL = flat.search(/\b(?:L[ÍI]NEA|LINEA|LlNEA)\s*:/i)
  const idxM = flat.search(new RegExp(String.raw`\b${INLINE_MODELO}\b`, 'i'))
  const starts = [idxL, idxM].filter((n) => n >= 0)
  if (starts.length === 0) return flat
  const start = Math.max(0, Math.min(...starts) - 16)
  return flat.slice(start, Math.min(flat.length, start + 320))
}

/**
 * Último recurso: año en texto OCR/layout unido (cajas o `data.text`).
 * Exportado para el parse por geometría cuando no hubo valor bajo la etiqueta MODELO.
 */
export function extractTransitLicenseModelYearFromHaystack(raw: string | null | undefined): string | null {
  const flat = flatOcr(raw)
  if (!flat) return null
  const fromLabel = extractYearAfterModeloLabel(flat)
  if (fromLabel) return fromLabel
  const fromSlice = pickBestFuzzyYearInSlice(ocrSliceAroundLineaModelo(flat))
  if (fromSlice) return fromSlice
  const cands = allFuzzyYearCandidates(flat)
  return cands.length === 1 ? cands[0].year : null
}

/**
 * Deja `model` solo como año `19xx`/`20xx` o lo borra. No toca placa, marca, línea, etc.
 * Debe ejecutarse al final del refinado cuando ya exista `rawOcrText` y/o `line`.
 */
export function applyTransitLicenseModelAsYearOnly(
  out: ParsedTransitLicenseFields,
  rawOcrText?: string | null,
): void {
  const cur = (out.model ?? '').trim()

  if (/^(19|20)\d{2}$/.test(cur) && isPlausibleVehicleModelYear(cur)) {
    out.model = cur
    return
  }

  const curFuzz = pickFirstFuzzyYear(cur)
  if (curFuzz) {
    out.model = curFuzz
    return
  }

  const flats: string[] = []
  const pushFlat = (s: string) => {
    const f = flatOcr(s)
    if (f && !flats.includes(f)) flats.push(f)
  }
  pushFlat(typeof rawOcrText === 'string' ? rawOcrText : '')
  pushFlat([rawOcrText, out.line, out.brand].map((x) => (x ?? '').trim()).filter(Boolean).join(' '))

  for (const flat of flats) {
    const y = extractYearAfterModeloLabel(flat)
    if (y) {
      out.model = y
      return
    }
  }
  for (const flat of flats) {
    const y = pickBestFuzzyYearInSlice(ocrSliceAroundLineaModelo(flat))
    if (y) {
      out.model = y
      return
    }
  }

  const emb = cur.match(/\b((?:19|20)\d{2})\b/)?.[1]
  if (emb && isPlausibleVehicleModelYear(emb)) {
    out.model = emb
    return
  }

  delete out.model
}

/** Extrae valor de MODELO desde el texto completo del OCR (incluye sin `:`). */
function extractModeloFromRawOcr(raw: string | null | undefined): string | null {
  const flat = flatOcr(raw)
  if (!flat) return null
  const stop = String.raw`(?=\s+(?:COLOR|MARCA|PLACA|L[ÍI]NEA|LINEA|CILINDR|COLINDR|VEH[ÍI]CULO)\b|$)`
  const M = String.raw`(?:MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|MDOELO|MODLO|MODOLO)`
  const patterns: RegExp[] = [
    new RegExp(String.raw`\b(?:L[ÍI]NEA|LINEA)\s*:\s*.+?\b${M}\s*:?\s*((?:19|20)\d{2})\b`, 'i'),
    new RegExp(String.raw`\b${M}\s*(?:VEH[ÍI]CULO)?\s*[:.\s]*\s*((?:19|20)\d{2})\b`, 'i'),
    new RegExp(String.raw`\b${M}\s*(?:VEH[ÍI]CULO)?\s*:\s*([^]+?)${stop}`, 'i'),
    new RegExp(String.raw`\b${M}\s+(?!\s*:)((?:19|20)\d{2}|[A-Za-z0-9][A-Za-z0-9\s\-.]{0,38}?)${stop}`, 'i'),
  ]
  for (const re of patterns) {
    const m = flat.match(re)
    if (m?.[1]) {
      const v = cleanSegment(m[1])
      if (v && !looksLikeLabelOnlyValue('model', v)) return v.slice(0, 80)
    }
  }
  return null
}

function fillModelField(out: ParsedTransitLicenseFields, rawOcrText?: string | null) {
  splitModeloFromLineField(out)
  splitYearFromEndOfLine(out)

  const cur = (out.model ?? '').trim()
  if (!cur || cur.length <= 2) {
    const fromRaw = extractModeloFromRawOcr(rawOcrText)
    if (fromRaw) out.model = fromRaw
  } else if (!/^(19|20)\d{2}$/.test(cur)) {
    const fromRaw = extractModeloFromRawOcr(rawOcrText)
    if (fromRaw && /^(19|20)\d{2}$/.test(fromRaw)) out.model = fromRaw
  }

  const cur2 = (out.model ?? '').trim()
  if (/^(19|20)\d{2}$/.test(cur2)) return
  const junkModel = !cur2 || looksLikeLabelOnlyValue('model', cur2)
  if (!junkModel && cur2.length > 6) return

  const blob = [rawOcrText, out.line, out.brand, out.plate, out.color, out.cylinderCc]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join(' ')
  const flatBlob = flatOcr(blob)
  const candsAll = allFuzzyYearCandidates(flatBlob)
  const year =
    extractYearAfterModeloLabel(flatBlob) ??
    pickBestFuzzyYearInSlice(ocrSliceAroundLineaModelo(flatBlob)) ??
    (candsAll.length === 1 ? candsAll[0].year : null)
  if (year && isPlausibleVehicleModelYear(year)) out.model = year
}

const ALL_FIELDS: (keyof ParsedTransitLicenseFields)[] = [
  'plate',
  'cylinderCc',
  'brand',
  'line',
  'model',
  'color',
]

/**
 * Etiquetas de la tarjeta que el OCR deja pegadas al valor:
 * "CILINDRADA CC COLOR VOLKSWAGEN" -> "VOLKSWAGEN"; "MARCA LINEA MODELO" -> "" (se descarta).
 */
const LEADING_LABEL_NOISE = String.raw`^(?:\s*(?:PLACA|MARCA|L[ÍI]NEA|LINEA|MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|COLOR|CILINDRADA|CILINDR[AE]JE|COLINDRAJE|CC|CLASE|SERVICIO|CIL|DEL|VEH[ÍI]CULO|VEHICULO)\s*(?:[:.\-–—·|]?\s*)?)+`

export function stripLeadingLabels(raw: string): string {
  let v = raw.replace(/\s+/g, ' ').trim()
  let prev = ''
  while (v && v !== prev) {
    prev = v
    v = v.replace(new RegExp(LEADING_LABEL_NOISE, 'i'), '').trim()
  }
  return v.replace(/^[\s:.\-–—·|]+/, '').trim()
}

/** Palabras de etiqueta que el OCR arrastra al final ("ESCAPE SERVICIO"). */
const TRAILING_LABEL_NOISE =
  /(?:\s+(?:SERVICIO|PARTICULAR|P[ÚU]BLICO|PUBLICO|CLASE|CARROCER[ÍI]A|COMBUSTIBLE|CAPACIDAD|KGS?|CC|MODELO|MARCA|COLOR|PLACA|CILINDRADA|COLINDRAJE)\s*[:.–—·|-]?)+$/i

export function stripTrailingLabels(raw: string): string {
  let v = raw.replace(/\s+/g, ' ').trim()
  let prev = ''
  while (v && v !== prev) {
    prev = v
    v = v.replace(TRAILING_LABEL_NOISE, '').trim()
  }
  return v.replace(/[\s:.\-–—·|]+$/, '').trim()
}

/** Etiquetas al inicio y al final ("CILINDRADA CC COLOR VOLKSWAGEN", "ESCAPE SERVICIO"). */
export function stripLabelNoise(raw: string): string {
  return stripTrailingLabels(stripLeadingLabels(raw))
}

/** "JETTA EUROPA JETTA EUROPA" -> "JETTA EUROPA"; "BLANCO CANDY BLANCO" -> "BLANCO CANDY". */
export function dedupeRepeatedWords(raw: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of raw.split(/\s+/)) {
    if (!w) continue
    const k = w.toUpperCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(w)
  }
  return out.join(' ').trim()
}

/** Placa CO: auto `ABC123`, moto `ABC12D`. Admitimos formatos viejos `AB1234`. */
const PLATE_RE = /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]|[A-Z]{2}\d{4})$/

export function isValidColombianPlate(v: string): boolean {
  return PLATE_RE.test(v.toUpperCase().replace(/[\s-]/g, ''))
}

/**
 * Si la placa quedó con un carácter de más por ruido del OCR (p. ej. "MWRE651"),
 * prueba quitando uno y se queda con la primera combinación válida.
 */
export function normalizePlateFormat(raw: string | undefined): string | undefined {
  if (!raw) return raw
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!compact || isValidColombianPlate(compact)) return compact || undefined
  if (compact.length === 7) {
    for (let i = 0; i < compact.length; i++) {
      const candidate = compact.slice(0, i) + compact.slice(i + 1)
      if (isValidColombianPlate(candidate)) return candidate
    }
  }
  return compact
}

/** Quita la placa cuando el OCR la dejó pegada a la marca ("MWR651NISSAN NISSAN"). */
function stripPlateFromBrand(out: ParsedTransitLicenseFields) {
  const plate = (out.plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!plate || !out.brand) return
  const cleaned = out.brand
    .replace(new RegExp(escapeRegExp(out.plate ?? ''), 'gi'), ' ')
    .replace(new RegExp(escapeRegExp(plate), 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length >= 2) out.brand = cleaned.slice(0, 80)
  else delete out.brand
}

const DISPLACEMENT_RE = /^\d{1,2}[.,]\d{3}$/

/** Cada campo con su tipo: evita "cilindraje: GRIS" o "color: 1.6500". */
function enforceFieldTypes(out: ParsedTransitLicenseFields) {
  const swap = (from: keyof ParsedTransitLicenseFields, to: keyof ParsedTransitLicenseFields) => {
    const v = out[from]
    if (!v) return
    if (!out[to]) out[to] = v
    delete out[from]
  }

  if (out.cylinderCc) {
    const cc = out.cylinderCc.trim()
    // "1.797" / "1,797" = 1797 cc (el punto es separador de miles, no decimal).
    const grouped = cc.match(/^(\d{1,2})[.,](\d{3})$/)
    const plain = cc.match(/^(\d{3,5})$/)
    if (!grouped && !plain) {
      // No es un número: es texto (casi siempre el color que se corrió).
      swap('cylinderCc', 'color')
    } else {
      const value = grouped
        ? Number.parseInt(`${grouped[1]}${grouped[2]}`, 10)
        : Number.parseInt(cc, 10)
      if (!Number.isFinite(value) || value < 400 || value > 8000) delete out.cylinderCc
      else out.cylinderCc = cc.replace(',', '.')
    }
  }

  if (out.color) {
    const c = out.color.trim()
    if (/^\d/.test(c) && DISPLACEMENT_RE.test(c)) swap('color', 'cylinderCc')
    else if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(c)) delete out.color
  }
}

/** Limpia cruces típicos: placa+marca, color+cilindraje, modelo (año) faltante. */
export function refineTransitLicenseFields(
  f: ParsedTransitLicenseFields,
  rawOcrText?: string | null,
): ParsedTransitLicenseFields {
  const out: ParsedTransitLicenseFields = { ...f }

  // 1. Etiquetas pegadas al valor (el OCR une "CILINDRADA CC COLOR VOLKSWAGEN").
  for (const k of ALL_FIELDS) {
    const v = out[k]
    if (typeof v !== 'string') continue
    const cleaned = stripLabelNoise(v)
    if (cleaned) out[k] = cleaned
    else delete out[k]
  }

  splitPlateBrandMixed(out)
  stripPlateFromBrand(out)
  fillModelField(out, rawOcrText)
  applyTransitLicenseModelAsYearOnly(out, rawOcrText)
  stripKnownFieldsFromLine(out)
  splitColorCylinderTail(out)
  enforceFieldTypes(out)

  // 2. Placa con formato válido y valores sin frases repetidas.
  let plate = normalizePlateFormat(out.plate)
  if (!plate || !isValidColombianPlate(plate)) {
    // Último recurso: bloque "LLL999" en el texto crudo, corrigiendo O/0, I/1, etc.
    plate = recoverPlateFromOcrText(rawOcrText) ?? plate
  }
  if (plate) out.plate = plate
  else delete out.plate

  // 3. Marca: si no salió por etiqueta/geometría, búscala en el texto (catálogo conocido).
  if (!out.brand) {
    const known = findBrandInOcrText(rawOcrText)
    if (known) out.brand = known
  }

  for (const k of ALL_FIELDS) {
    const v = out[k]
    if (typeof v !== 'string') continue
    const deduped = dedupeRepeatedWords(stripLabelNoise(v))
    if (deduped) out[k] = deduped
    else delete out[k]
  }

  return out
}

/** Prioriza datos extraídos por geometría (Tesseract); si falta o es basura, usa el parse por texto. */
export function mergeTransitLicenseLayoutAndText(
  layout: ParsedTransitLicenseFields,
  text: ParsedTransitLicenseFields,
  rawOcrText?: string | null,
): ParsedTransitLicenseFields {
  const keys: (keyof ParsedTransitLicenseFields)[] = [
    'plate',
    'cylinderCc',
    'brand',
    'line',
    'model',
    'color',
  ]
  const out: ParsedTransitLicenseFields = {}
  for (const k of keys) {
    const L = layout[k]
    const T = text[k]
    let pick: string | undefined
    if (k === 'model') {
      const Ty = typeof T === 'string' ? T.trim() : ''
      const Ly = typeof L === 'string' ? L.trim() : ''
      const tYear = /^(19|20)\d{2}$/.test(Ty)
      const lYear = /^(19|20)\d{2}$/.test(Ly)
      if (tYear) pick = Ty
      else if (lYear) pick = Ly
      else {
        const tEmb =
          Ty.match(/\b((?:19|20)\d{2})\b/)?.[1] ??
          pickFirstFuzzyYear(Ty) ??
          undefined
        const lEmb =
          Ly.match(/\b((?:19|20)\d{2})\b/)?.[1] ??
          pickFirstFuzzyYear(Ly) ??
          undefined
        if (tEmb && isPlausibleVehicleModelYear(tEmb)) pick = tEmb
        else if (lEmb && isPlausibleVehicleModelYear(lEmb)) pick = lEmb
        else pick = undefined
      }
    } else {
      pick =
        L && !looksLikeLabelOnlyValue(k, L)
          ? L
          : T && !looksLikeLabelOnlyValue(k, T)
            ? T
            : L || T
    }
    if (pick) out[k] = pick
  }
  return refineTransitLicenseFields(out, rawOcrText)
}

export function parsedTransitLicenseHasAny(p: ParsedTransitLicenseFields): boolean {
  return Object.values(p).some((v) => v != null && String(v).trim() !== '')
}

/**
 * Completa los campos que quedaron vacíos en `base` con los de `extra` (nunca pisa).
 * Se usa para sumar el recall de la segunda pasada de Tesseract sin arrastrar sus errores.
 */
export function fillMissingTransitLicenseFields(
  base: ParsedTransitLicenseFields,
  extra: ParsedTransitLicenseFields,
): ParsedTransitLicenseFields {
  const out: ParsedTransitLicenseFields = { ...base }
  for (const k of ALL_FIELDS) {
    if (!out[k] && extra[k]) out[k] = extra[k]
  }
  return out
}

/** Marcas habituales en el taller: rescate cuando el parse por etiquetas falla. */
const KNOWN_BRANDS = [
  'CHEVROLET',
  'VOLKSWAGEN',
  'RENAULT',
  'NISSAN',
  'TOYOTA',
  'FORD',
  'HYUNDAI',
  'KIA',
  'MAZDA',
  'MITSUBISHI',
  'HONDA',
  'SUZUKI',
  'JEEP',
  'FIAT',
  'PEUGEOT',
  'MERCEDES BENZ',
  'BMW',
  'AUDI',
  'CHERY',
  'JAC',
  'DFSK',
  'FOTON',
  'ISUZU',
  'VOLVO',
  'SUBARU',
  'DODGE',
  'CHRYSLER',
  'SEAT',
  'SKODA',
]

/** Si la marca no salió del parse, búscala como palabra en el texto crudo del OCR. */
export function findBrandInOcrText(raw: string | null | undefined): string | null {
  if (!raw || !ocrTextHasLicenseLabels(raw)) return null
  const flat = raw.toUpperCase().replace(/\s+/g, ' ')
  for (const brand of KNOWN_BRANDS) {
    if (new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`).test(flat)) return brand
  }
  return null
}

/** Letras que el OCR confunde con dígitos dentro del bloque numérico de la placa. */
function plateDigitsFix(block: string): string {
  return block
    .replace(/[OoQqD]/g, '0')
    .replace(/[IlL|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[Tt]/g, '7')
    .replace(/[Aa]/g, '4')
}

/**
 * Último recurso para la placa: busca un bloque tipo "LLL999" en el texto crudo y
 * corrige las letras que en realidad son dígitos ("MOMI61" -> "MOM161").
 */
/**
 * El texto tiene al menos una etiqueta de la tarjeta. Si el OCR devolvió puro ruido
 * (foto borrosa/comprimida), los "rescates" terminan inventando placas: no se aplican.
 */
export function ocrTextHasLicenseLabels(raw: string | null | undefined): boolean {
  if (!raw) return false
  return /\b(PLACA|MARCA|L[IÍ]NEA|LINEA|MODELO|MODEL0|M[O0]DELO|MOD[EÉ]LO|COLOR|CILINDRADA|CILINDR[AE]JE|COLINDRAJE|CLASE|SERVICIO)\b/i.test(
    raw,
  )
}

export function recoverPlateFromOcrText(raw: string | null | undefined): string | null {
  if (!raw || !ocrTextHasLicenseLabels(raw)) return null
  const flat = raw.toUpperCase().replace(/\s+/g, ' ')

  /** Prioridad: lo que venga justo después de la etiqueta PLACA. */
  const labelAt = flat.search(/\bPLACA\b/)
  const window = labelAt >= 0 ? flat.slice(labelAt, labelAt + 70) : ''

  const scan = (text: string, allowMoto: boolean): string | null => {
    const tokens = text.replace(/[\s-]+/g, '').match(/[A-Z0-9]{5,8}/g) ?? []
    for (const token of tokens) {
      const auto = token.match(/([A-Z]{3})([A-Z0-9]{3})/)
      if (auto) {
        // Al menos 2 dígitos reales: evita aceptar "HFI44E" como placa.
        const digits = (auto[2].match(/\d/g) ?? []).length
        const fixed = plateDigitsFix(auto[2])
        const plate = `${auto[1]}${fixed}`
        if (digits >= 2 && /^[A-Z]{3}\d{3}$/.test(plate)) return plate
      }
      if (allowMoto) {
        const moto = token.match(/([A-Z]{3})([A-Z0-9]{2})([A-Z])/)
        if (moto) {
          const digits = (moto[2].match(/\d/g) ?? []).length
          const plate = `${moto[1]}${plateDigitsFix(moto[2])}${moto[3]}`
          if (digits >= 1 && /^[A-Z]{3}\d{2}[A-Z]$/.test(plate)) return plate
        }
      }
    }
    return null
  }

  return (
    scan(window, true) ??
    (labelAt >= 0 ? null : scan(flat.slice(0, 400), false))
  )
}
