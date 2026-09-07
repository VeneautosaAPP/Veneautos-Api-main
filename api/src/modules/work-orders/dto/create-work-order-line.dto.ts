import { WorkOrderLineType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MONEY_DECIMAL_REGEX } from '../../cash/cash.constants';
import { QTY_DECIMAL_REGEX } from '../../../common/regex/qty-decimal.regex';

export class CreateWorkOrderLineDto {
  @IsEnum(WorkOrderLineType)
  lineType!: WorkOrderLineType;

  /** Texto libre del repuesto o mano de obra (autocompleta desde el diccionario). */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsString()
  @MinLength(1)
  @Matches(QTY_DECIMAL_REGEX, {
    message: 'Cantidad inválida (entero o hasta 4 decimales)',
  })
  quantity!: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_DECIMAL_REGEX, {
    message: 'Precio unitario: solo pesos enteros en dígitos, sin decimales',
  })
  unitPrice?: string;

  /** Tarifa de impuesto aplicada a la línea. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  taxRateId?: string;

  /**
   * SKU del repuesto elegido del catálogo (snapshot; se ignora/normaliza).
   * Solo aplica a PART; null = repuesto en texto libre.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sparePartSku?: string;

  /** Descuento de línea en COP enteros (no porcentaje). */
  @IsOptional()
  @IsString()
  @Matches(MONEY_DECIMAL_REGEX, {
    message: 'Descuento: solo pesos enteros en dígitos, sin decimales',
  })
  discountAmount?: string;

  /**
   * Precio proveedor (costo) en COP enteros. Solo perfiles con `reports:read`
   * (administración / dueño) pueden cargarlo. No se muestra en la factura.
   */
  @IsOptional()
  @IsString()
  @Matches(MONEY_DECIMAL_REGEX, {
    message: 'Precio proveedor: solo pesos enteros en dígitos, sin decimales',
  })
  costSnapshot?: string;
}