import { IsString, MaxLength, MinLength } from 'class-validator';
import { LookupClientPortalDto } from './lookup-client-portal.dto';

/**
 * Cuerpo de `POST /client-portal/account/receipt` (sin JWT): misma identidad placa + celular
 * que la consulta de cuenta, más el código público de la OT cuyo comprobante se pide.
 */
export class ReceiptClientPortalDto extends LookupClientPortalDto {
  @IsString({ message: 'El código de la orden debe ser texto.' })
  @MinLength(2, { message: 'Ingresá el código de la orden.' })
  @MaxLength(32, { message: 'El código de la orden es demasiado largo.' })
  orderCode!: string;
}