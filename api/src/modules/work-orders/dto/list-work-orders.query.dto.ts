import { WorkOrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsPrismaCuid } from '../../../common/decorators/is-prisma-cuid.decorator';

const STATUSES = Object.values(WorkOrderStatus);

export class ListWorkOrdersQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: WorkOrderStatus;

  @IsOptional()
  @IsPrismaCuid()
  vehicleId?: string;

  /** Todas las OT cuyo vehículo pertenezca a este cliente (cualquier unidad del maestro). */
  @IsOptional()
  @IsPrismaCuid()
  customerId?: string;

  /** Texto libre: coincide con código público, descripción, nombre de cliente o patente (snapshot en la OT). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Entregas desde (inclusive): filtra por fecha de entrega (`deliveredAt`). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Entregas hasta (inclusive): filtra por fecha de entrega (`deliveredAt`). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  /** Cache-bust del cliente; no se usa en el servidor (`forbidNonWhitelisted` lo exige explícito). */
  @IsOptional()
  @IsString()
  _?: string;
}
