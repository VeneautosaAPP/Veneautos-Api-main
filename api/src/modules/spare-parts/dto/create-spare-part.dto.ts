import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Monto COP en texto: entero (25.000 → "25000") o con hasta 2 decimales. Se guarda como Decimal(18,2). */
export const PRICE_DECIMAL_REGEX = /^\d{1,10}(\.\d{1,2})?$/;

export class CreateSparePartDto {
  /** Referencia/código de barras. Se normaliza a MAYÚSCULAS alfanumérico antes de guardar. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sku!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  name!: string;

  /** Precio sugerido en COP (0 = precio variable, se define en cada OT). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(PRICE_DECIMAL_REGEX, { message: 'Precio inválido (COP con hasta 2 decimales)' })
  price?: string;
}