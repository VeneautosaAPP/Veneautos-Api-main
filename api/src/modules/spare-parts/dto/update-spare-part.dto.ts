import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PRICE_DECIMAL_REGEX } from './create-spare-part.dto';

export class UpdateSparePartDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  name?: string;

  /** `null` = borrar el precio sugerido (queda precio variable = 0). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(PRICE_DECIMAL_REGEX, { message: 'Precio inválido (COP con hasta 2 decimales)' })
  price?: string | null;
}