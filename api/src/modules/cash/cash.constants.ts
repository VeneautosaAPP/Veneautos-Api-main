/**
 * Slugs de roles que pueden cerrar caja, gestionar delegados y registrar egresos sin estar
 * en la tabla de delegados. Deben coincidir con los roles sembrados en `prisma/seed.ts`.
 */
export const CASH_ELEVATED_ROLE_SLUGS = ['administrador', 'dueno'] as const;

/**
 * Límite de usuarios de confianza que pueden registrar egresos además de los elevados.
 * La validación duplicada en servicio + DTO evita depender solo de la base de datos.
 */
export const MAX_CASH_EXPENSE_DELEGATES = 3;

/** Montos COP en string para APIs: solo pesos enteros (sin decimales). Ej. "150000". */
export const MONEY_DECIMAL_REGEX = /^\d+$/;

/**
 * Valor de `CashMovement.referenceType` cuando el movimiento proviene de una solicitud aprobada.
 * Permite trazabilidad cruzada sin tocar el esquema de movimientos más allá de campos opcionales.
 */
export const CASH_EXPENSE_REQUEST_REFERENCE_TYPE = 'CashExpenseRequest';

/** `CashMovement.referenceType` cuando el movimiento se asocia a una orden de trabajo (Fase 3). */
export const CASH_WORK_ORDER_REFERENCE_TYPE = 'WorkOrder';

/** `CashMovement.referenceType` cuando el movimiento paga directamente una factura (Fase 5). */
export const CASH_INVOICE_REFERENCE_TYPE = 'Invoice';
