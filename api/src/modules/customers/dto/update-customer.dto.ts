import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  primaryPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^$|^[^\s]+$/, {
    message: 'email no puede contener espacios',
  })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
