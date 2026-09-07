/**
 * Formato de cantidad decimal: entero o hasta 4 decimales (p. ej. "3" o "0.25").
 * Se trasladó fuera de `inventory.constants` porque las líneas de OT lo usan
 * y el módulo de inventario ya no existe.
 */
export const QTY_DECIMAL_REGEX = /^\d+(\.\d{1,4})?$/;