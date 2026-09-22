import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkOrdersVehicleHit } from '../types'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

type Props = {
  /** Placa actualmente seleccionada ('' si ninguna). El texto del input se sincroniza con ella. */
  selectedPlate: string
  onPick: (hit: WorkOrdersVehicleHit) => void
  /** El usuario escribió algo distinto a la placa seleccionada (invalida la selección actual). */
  onTyping: () => void
  search: (q: string) => Promise<WorkOrdersVehicleHit[]>
  disabled?: boolean
}

export function VehiclePlateAutocomplete({ selectedPlate, onPick, onTyping, search, disabled }: Props) {
  const [text, setText] = useState(selectedPlate)
  const [prevPlate, setPrevPlate] = useState(selectedPlate)
  const [results, setResults] = useState<WorkOrdersVehicleHit[]>([])
  const [resultFor, setResultFor] = useState('')
  const [focused, setFocused] = useState(false)
  const [hl, setHl] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  /** Sincroniza el texto cuando la placa seleccionada cambia desde afuera (ajuste durante el render). */
  if (selectedPlate !== prevPlate) {
    setPrevPlate(selectedPlate)
    setText(selectedPlate)
    setResults([])
    setResultFor('')
  }

  const selectedNorm = useMemo(
    () => selectedPlate.toUpperCase().replace(/\s+/g, ''),
    [selectedPlate],
  )
  const textNorm = useMemo(() => text.trim().toUpperCase().replace(/\s+/g, ''), [text])
  /** No buscar cuando el texto es exactamente la placa ya elegida (evita reabrir el dropdown al seleccionar). */
  const skipSearch = selectedNorm !== '' && textNorm === selectedNorm

  const debounced = useDebouncedValue(text.trim(), 280)
  const shouldSearch = debounced.length >= 2 && !skipSearch
  /** Hay una búsqueda en vuelo cuando el texto buscado ya no coincide con los resultados presentes. */
  const pending = shouldSearch && resultFor !== debounced
  const isFresh = resultFor === debounced
  const showLoading = focused && pending
  const showResults = focused && shouldSearch && isFresh && results.length > 0 && !pending
  const showEmpty = focused && shouldSearch && isFresh && !pending && results.length === 0
  const open = showLoading || showResults || showEmpty

  useEffect(() => {
    if (!shouldSearch) return
    let active = true
    search(debounced)
      .then((list) => {
        if (!active) return
        setResults(list)
        setResultFor(debounced)
        setHl(0)
      })
      .catch(() => {
        if (!active) return
        setResults([])
        setResultFor(debounced)
      })
    return () => {
      active = false
    }
  }, [debounced, search, shouldSearch])

  useEffect(() => {
    const onDocMousedown = (ev: globalThis.MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', onDocMousedown)
    return () => document.removeEventListener('mousedown', onDocMousedown)
  }, [])

  const pick = (v: WorkOrdersVehicleHit) => {
    setText(v.plate)
    setResults([])
    setResultFor('')
    setFocused(false)
    onPick(v)
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(ev) => {
          const v = ev.target.value
          setText(v)
          setHl(0)
          setFocused(true)
          if (v.trim().toUpperCase().replace(/\s+/g, '') !== selectedNorm) onTyping()
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowDown') {
            ev.preventDefault()
            setHl((h) => (results.length ? (h + 1) % results.length : 0))
          } else if (ev.key === 'ArrowUp') {
            ev.preventDefault()
            setHl((h) => (results.length ? (h - 1 + results.length) % results.length : 0))
          } else if (ev.key === 'Enter' && showResults) {
            ev.preventDefault()
            pick(results[hl] ?? results[0])
          } else if (ev.key === 'Escape') {
            setFocused(false)
          }
        }}
        placeholder="Escribí la placa para buscar…"
        className="va-field w-full font-mono text-sm"
        role="combobox"
        aria-expanded={open}
        aria-label="Buscar vehículo por placa"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-600 bg-slate-800 shadow-xl">
          {showLoading ? (
            <p className="px-3 py-2 text-xs text-slate-200">Buscando…</p>
          ) : showResults ? (
            <ul role="listbox" className="max-h-60 overflow-y-auto">
              {results.map((v, i) => (
                <li key={v.id} role="option" aria-selected={i === hl}>
                  <button
                    type="button"
                    onMouseDown={(ev) => {
                      ev.preventDefault()
                      pick(v)
                    }}
                    onMouseEnter={() => setHl(i)}
                    className={`w-full px-3 py-2 text-left text-sm ${
                      i === hl ? 'bg-slate-600' : 'hover:bg-slate-700'
                    }`}
                  >
                    <span className="font-mono font-medium text-white">{v.plate}</span>
                    {(v.brand || v.model) && (
                      <span className="mt-0.5 block text-xs text-slate-200">
                        {[v.brand, v.model].filter(Boolean).join(' ')}
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-slate-200">{v.customer.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-xs text-slate-200">Sin coincidencias.</p>
          )}
        </div>
      )}
    </div>
  )
}