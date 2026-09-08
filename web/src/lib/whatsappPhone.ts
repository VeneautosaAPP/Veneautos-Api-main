/**
 * Normalización de teléfonos para WhatsApp.
 *
 * WhatsApp Web/wa.me esperan el número completo con código de país y sin símbolos
 * (solo dígitos). Esta utilidad:
 *  - quita espacios, guiones, paréntesis, puntos y barras;
 *  - respeta prefijos internacionales `+` y `00`;
 *  - si no viene código de país y hay un `defaultCountryCode`, lo antepone
 *    (por defecto `57`, Colombia, por el régimen DIAN del taller).
 */
export function normalizeWhatsAppPhone(
  raw: string | null | undefined,
  defaultCountryCode = '57',
): string {
  if (!raw) return ''
  let s = raw.trim()
  if (!s) return ''

  let prefix = ''
  if (/^\+/.test(s)) {
    prefix = '+'
    s = s.slice(1)
  } else if (/^00/.test(s)) {
    s = s.slice(2)
  }

  const digits = s.replace(/\D/g, '')
  if (!digits) return ''

  const cc = defaultCountryCode.replace(/\D/g, '')
  if (prefix === '+' || (cc && digits.startsWith(cc))) {
    return digits
  }
  if (cc) return cc + digits
  return digits
}

/** ¿El teléfono normalizado se ve razonable? (~7 a 15 dígitos). */
export function isValidWhatsAppPhone(phoneDigits: string): boolean {
  return /^\d{7,15}$/.test(phoneDigits)
}