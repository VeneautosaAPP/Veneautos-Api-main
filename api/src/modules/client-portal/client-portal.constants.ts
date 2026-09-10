/**
 * Parámetros del portal público de clientes (consulta de cuenta por placa + celular).
 */
export const CLIENT_PORTAL_RATE = {
  /** Ventana de intentos (minutos) para una misma huella IP. */
  windowMinutes: 15,
  /** Intentos permitidos por ventana antes de bloquear la huella. */
  maxAttempts: 8,
  /** Duración del bloqueo tras exceder los intentos (minutos). */
  blockMinutes: 30,
  /** Días que se conservan las huellas antes de purgarlas. */
  purgeDays: 7,
} as const;

/** Mensaje genérico: no revela cuál de los dos campos falló ni si existe el vehículo. */
export const CLIENT_PORTAL_NOT_FOUND =
  'No encontramos un vehículo y celular que coincidan. Verificá la placa y el celular con el que registraste el vehículo en el taller.';

export const CLIENT_PORTAL_RATE_LIMITED =
  'Demasiados intentos. Esperá un rato antes de volver a intentar.';