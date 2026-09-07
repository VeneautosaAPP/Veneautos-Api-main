/**
 * Fase 11 — catálogo maestro de repuestos (mecánica «Autopiezas Tegui»):
 * SKU + nombre + precio sugerido, stock ilimitado, con CRUD e import/export XLSX.
 */
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SparePartsController } from './spare-parts.controller';
import { SparePartsService } from './spare-parts.service';

@Module({
  imports: [AuditModule],
  controllers: [SparePartsController],
  providers: [SparePartsService],
  exports: [SparePartsService],
})
export class SparePartsModule {}