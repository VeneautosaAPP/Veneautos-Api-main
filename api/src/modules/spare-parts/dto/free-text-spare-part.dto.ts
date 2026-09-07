import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Alta rápida por texto libre (coincide con el flujo "agregar nuevo" de autopiezas).
 * El SKU se genera automáticamente con el siguiente consecutivo (R####).
 */
export class FreeTextSparePartDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  name!: string;
}