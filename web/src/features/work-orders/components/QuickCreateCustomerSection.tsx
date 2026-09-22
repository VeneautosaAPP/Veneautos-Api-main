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
  return (
    <div
      className={`space-y-3 rounded-2xl border border-brand-300 p-4 ${
        isSaas
          ? 'bg-[var(--va-accent-soft)]'
          : 'bg-brand-50 dark:border-brand-700 dark:bg-brand-950'
      }`}
    >
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          ¿Cliente nuevo? Crearlo rápido
        </h3>
      </div>
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
  )
}