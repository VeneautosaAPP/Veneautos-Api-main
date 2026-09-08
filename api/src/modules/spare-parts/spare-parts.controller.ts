import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { JwtUserPayload } from '../auth/types/jwt-user.payload';
import { CreateSparePartDto } from './dto/create-spare-part.dto';
import { FreeTextSparePartDto } from './dto/free-text-spare-part.dto';
import { UpdateSparePartDto } from './dto/update-spare-part.dto';
import { SparePartsService } from './spare-parts.service';

/**
 * Catálogo maestro de repuestos (SKU + nombre + precio sugerido).
 * Los perfiles que cargan líneas PART en la OT necesitan solo `repuestos:read`
 * (la búsqueda queda abierta también a quienes editan líneas, como en tax-rates).
 */
@Controller('spare-parts')
export class SparePartsController {
  constructor(private readonly spareParts: SparePartsService) {}

  @Get()
  @RequireAnyPermission('repuestos:read', 'work_order_lines:create', 'work_order_lines:update')
  list(@Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const parsedLimit = Number.parseInt(limit ?? '12', 10);
    const parsedOffset = Number.parseInt(offset ?? '0', 10);
    return this.spareParts.list(
      q,
      Number.isFinite(parsedLimit) ? parsedLimit : 12,
      Number.isFinite(parsedOffset) ? parsedOffset : 0,
    );
  }

  /**
   * Catálogo completo para el buscador de la OT: una sola descarga y el filtrado se hace en el
   * navegador (antes cada tecla era un viaje al servidor). Cacheado en el API.
   */
  @Get('catalog')
  @RequireAnyPermission('repuestos:read', 'work_order_lines:create', 'work_order_lines:update')
  catalog() {
    return this.spareParts.catalog();
  }

  /** Export XLSX del catálogo (binario directo al cliente). */
  @Get('export')
  @RequirePermissions('repuestos:read')
  async export(@Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.spareParts.exportXlsx();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** Import XLSX del catálogo (alta/actualización por SKU normalizado). */
  @Post('import')
  @RequirePermissions('repuestos:create', 'repuestos:update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024 } }))
  import(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.spareParts.importXlsx(file, actor.sub, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  /** Alta por texto libre (foco autopiezas): devuelve el repuesto existente o crea uno con SKU consecutivo. */
  @Post('free-text')
  @RequirePermissions('repuestos:create')
  createFromFreeText(
    @Body() dto: FreeTextSparePartDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.spareParts.createFromFreeText(actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post()
  @RequirePermissions('repuestos:create')
  create(
    @Body() dto: CreateSparePartDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.spareParts.create(actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Patch(':id')
  @RequirePermissions('repuestos:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSparePartDto,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.spareParts.update(id, actor.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Delete(':id')
  @RequirePermissions('repuestos:delete')
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.spareParts.remove(id, actor.sub, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}