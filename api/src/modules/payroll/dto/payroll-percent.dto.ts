import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class PayrollPercentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El porcentaje debe ser un número con hasta 2 decimales.' })
  @Min(0, { message: 'El porcentaje no puede ser menor a 0.' })
  @Max(100, { message: 'El porcentaje máximo es 100.' })
  commissionPct!: number;
}