import { IsString, MaxLength, MinLength } from 'class-validator';

/** Cuerpo de `POST /client-portal/account` (sin JWT): placa + celular. */
export class LookupClientPortalDto {
  @IsString({ message: 'La placa debe ser texto.' })
  @MinLength(1, { message: 'Ingresá la placa del vehículo.' })
  @MaxLength(24, { message: 'La placa ingresada es demasiado larga.' })
  plate!: string;

  @IsString({ message: 'El celular debe ser texto.' })
  @MinLength(7, { message: 'El celular debe tener al menos 7 dígitos.' })
  @MaxLength(40, { message: 'El celular ingresado es demasiado largo.' })
  phone!: string;
}