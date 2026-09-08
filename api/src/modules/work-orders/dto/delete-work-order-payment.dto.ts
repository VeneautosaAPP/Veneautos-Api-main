import { IsString, MaxLength } from 'class-validator';

/**
 * Elimina un abono de una OT abierta (no Entregada ni Cancelada). Requiere motivo:
 * se borra también el ingreso de caja vinculado y el movimiento queda en auditoría.
 */
export class DeleteWorkOrderPaymentDto {
  /** Motivo de la eliminación; longitud mínima según `notes.min_length_chars` (ver `docs/NOTAS_POLITICA.md`). */
  @IsString()
  @MaxLength(2000)
  reason!: string;
}