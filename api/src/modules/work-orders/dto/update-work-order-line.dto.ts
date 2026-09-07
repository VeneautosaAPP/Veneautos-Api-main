import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MONEY_DECIMAL_REGEX } from '../../cash/cash.constants';
import { QTY_DECIMAL_REGEX } from '../../../common/regex/qty-decimal.regex';

export class UpdateWorkOrderLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(QTY_DECIMAL_REGEX, {
    message: 'Cantidad inválida (entero o hasta 4 decimales)',
  })
  quantity?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_DECIMAL_REGEX, {
    message: 'Precio unitario: solo pesos enteros en dígitos, sin decimales',
  })
  unitPrice?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description?: string;

  /** Cambiar la tarifa de impuesto aplicada (null → quitar). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  taxRateId?: string | null;

  /** SKU del catálogo vinculado (null → la línea deja de estar vinculada al catálogo). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sparePartSku?: string | null;

  /** Descuento de línea en COP enteros (null → quitar). */
  @IsOptional()
  @IsString()
  @Matches(MONEY_DECIMAL_REGEX, {
    message: 'Descuento: solo pesos enteros en dígitos, sin decimales',
  })
  discountAmount?: string | null;

  /**
   * Precio proveedor (costo) en COP enteros (null → quitar). Solo perfiles con
   * `reports:read` (administración / dueño). No se muestra en la factura.
   */
  @IsOptional()
  @IsString()
  @Matches(MONEY_DECIMAL_REGEX, {
    message: 'Precio proveedor: solo pesos enteros en dígitos, sin decimales',
  })
  costSnapshot?: string | null;
}
