import { WorkOrderStatus } from '@prisma/client';
import {
  Allow,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsPrismaCuid } from '../../../common/decorators/is-prisma-cuid.decorator';

const STATUSES = Object.values(WorkOrderStatus);

/** Actualización parcial; si se envía `status`, debe ser una transición válida desde el estado actual. */
export class UpdateWorkOrderDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerPhone?: string;

  /** Correo para facturación u otros usos en esta OT; vacío o `null` lo borra. */
  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @MaxLength(120)
  customerEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehiclePlate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  vehicleBrand?: string;

  /** Modelo al ingreso (instantánea en la OT); vacío o `null` lo borra. */
  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(80)
  vehicleModel?: string | null;

  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(120)
  vehicleLine?: string | null;

  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(32)
  vehicleCylinderCc?: string | null;

  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(80)
  vehicleColor?: string | null;

  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  intakeOdometerKm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  vehicleNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNotes?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: WorkOrderStatus;

  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null)
  @IsPrismaCuid()
  assignedToId?: string | null;

  /** Enlazar o desenlazar vehículo formal; `null` quita el vínculo (no borra texto legado). */
  @IsOptional()
  @Allow()
  @ValidateIf((_, v) => v != null)
  @IsPrismaCuid()
  vehicleId?: string | null;

  /** Copia del texto de consentimiento mostrado al cliente (solo con `clientSignaturePngBase64`). */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(50000)
  clientConsentTextSnapshot?: string;

  /**
   * PNG en base64 (opcional prefijo `data:image/png;base64,`). Solo se acepta si aún no hay firma en la orden.
   * Debe enviarse junto con `clientConsentTextSnapshot`.
   */
  @IsOptional()
  @IsString()
  @MinLength(200)
  @MaxLength(2_500_000)
  clientSignaturePngBase64?: string;
}
