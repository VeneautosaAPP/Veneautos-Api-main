import { useState } from 'react'

type Props = {
  isSaas: boolean
  busy: boolean
  msg: string | null
  name: string
  phone: string
  plate: string
  brand: string
  onNameChange: (v: string) => void
  onPhoneChange: (v: string) => void
  onPlateChange: (v: string) => void
  onBrandChange: (v: string) => void
  onSubmit: () => void
}

export function QuickCreateCustomerSection({
  isSaas,
  busy,
  msg,
  name,
  phone,
  plate,
  brand,
  onNameChange,
  onPhoneChange,
  onPlateChange,
  onBrandChange,
  onSubmit,
}: Props) {
  const [open, setOpen] = useState(true)
  return (
    <div
      className={`rounded-2xl border border-brand-300 ${
        isSaas
          ? 'bg-[var(--va-accent-soft)]'
          : 'bg-brand-50 dark:border-brand-700 dark:bg-brand-950'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          ¿Cliente nuevo? Crearlo rápido
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open ? (
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="va-label">Nombre <span className="text-red-600 dark:text-red-400">(obligatorio)</span></span>
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                maxLength={200}
                placeholder="Nombre completo del cliente"
                className="va-field mt-1"
              />
            </label>
            <label className="block text-sm">
              <span className="va-label">Teléfono <span className="text-red-600 dark:text-red-400">(obligatorio)</span></span>
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="Ej. 0412 1234567"
                className="va-field mt-1"
              />
            </label>
            <label className="block text-sm">
              <span className="va-label">Placa del vehículo <span className="text-red-600 dark:text-red-400">(obligatorio)</span></span>
              <input
                autoCapitalize="characters"
                value={plate}
                onChange={(e) => onPlateChange(e.target.value)}
                maxLength={20}
                placeholder="Ej. ABC123"
                className="va-field mt-1 font-mono uppercase"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="va-label">Marca del vehículo <span className="text-red-600 dark:text-red-400">(obligatorio)</span></span>
              <input
                value={brand}
                onChange={(e) => onBrandChange(e.target.value)}
                maxLength={80}
                placeholder="Ej. Toyota"
                className="va-field mt-1"
              />
            </label>
          </div>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onSubmit}
              disabled={busy}
              className="va-btn-primary"
            >
              {busy ? 'Creando…' : 'Crear cliente y vehículo'}
            </button>
            {msg ? (
              <p
                className={
                  msg.startsWith('La placa')
                    ? 'text-xs font-medium text-amber-800 dark:text-amber-200'
                    : msg.startsWith('Cliente y vehículo')
                      ? 'text-xs font-medium text-emerald-700 dark:text-emerald-300'
                      : 'text-xs font-medium text-red-700 dark:text-red-300'
                }
              >
                {msg}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}