/**
 * Mayúsculas operativas al escribir.
 *
 * La UI ya muestra en mayúscula lo que se teclea (`index.css`: `text-transform: uppercase` en
 * `input`, `textarea` y `select`). Ese cambio es **solo visual**: el estado de React —y por tanto
 * lo que viaja al API— conservaba las minúsculas. Este módulo convierte el **valor** a mayúscula
 * en el mismo momento de la entrada, así lo que se ve es lo que se guarda.
 *
 * Exclusiones: los `select` (su `value` es el de la opción: ids, códigos, estados) y los campos
 * donde mayusculizar rompe datos o credenciales: email, url, password, fecha, búsqueda, numéricos,
 * archivos y OTP. Cualquier campo puede escaparse con el atributo `data-no-uppercase`.
 */

const SKIP_INPUT_TYPES = new Set([
  'email',
  'url',
  'password',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  'search',
  'number',
  'file',
  'hidden',
  'checkbox',
  'radio',
  'range',
  'color',
  'tel',
])

const SKIP_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code'])

/** True si el campo debe guardarse en mayúscula. */
export function shouldUppercaseElement(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.disabled || el.readOnly) return false
  if (el.closest('[data-no-uppercase]')) return false
  if (el instanceof HTMLTextAreaElement) return true
  const type = (el.getAttribute('type') ?? 'text').toLowerCase()
  if (SKIP_INPUT_TYPES.has(type)) return false
  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
  if (SKIP_AUTOCOMPLETE.has(autocomplete)) return false
  return true
}

/** Pasa el valor actual a mayúscula conservando el caret (para poder editar en el medio). */
export function uppercaseElementValue(el: HTMLInputElement | HTMLTextAreaElement): void {
  const next = el.value.toUpperCase()
  if (next === el.value) return
  const start = el.selectionStart
  const end = el.selectionEnd
  el.value = next
  if (start != null && end != null) {
    try {
      el.setSelectionRange(start, end)
    } catch {
      /* Algunos tipos de input no permiten selección: ya quedó el valor correcto. */
    }
  }
}

/**
 * Instala el listener global (fase de captura: corre antes que los `onChange` de React, así el
 * estado ya nace en mayúscula). Devuelve la función para desinstalarlo.
 */
export function installUppercaseTyping(): () => void {
  const onInput = (ev: Event) => {
    // Teclados con composición (IME): no interrumpir mientras se arma la palabra.
    if ((ev as InputEvent).isComposing) return
    const el = ev.target
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
    if (!shouldUppercaseElement(el)) return
    uppercaseElementValue(el)
  }

  document.addEventListener('input', onInput, true)
  return () => document.removeEventListener('input', onInput, true)
}
