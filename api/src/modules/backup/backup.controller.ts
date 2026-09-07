/**
 * Controller de backup y restore de base de datos.
 *
 * Endpoints:
 *   POST /api/v1/backup/create       - Crear backup (local o production)
 *   GET  /api/v1/backup/list         - Listar backups disponibles
 *   GET  /api/v1/backup/download/:fn - Descargar backup
 *   POST /api/v1/backup/restore      - Restaurar desde archivo subido
 *   POST /api/v1/backup/validate     - Validar archivo de backup
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  StreamableFile,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { BackupService, BackupType, BackupResult } from './backup.service';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

@Controller('backup')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);
  constructor(private readonly backupService: BackupService) {}

  /**
   * Crea un backup de la base de datos.
   * POST /api/v1/backup/create
   */
  @Post('create')
  @RequirePermissions('settings:update')
  async createBackup(@Body() body: { type?: BackupType }) {
    const type = body.type || 'local';

    if (!['local', 'production'].includes(type)) {
      throw new BadRequestException('Tipo debe ser "local" o "production"');
    }

    let result: BackupResult;
    try {
      result = await this.backupService.createBackup(type);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Backup ${type} falló: ${message}`);
      throw new BadRequestException(`No se pudo crear el backup: ${message}`);
    }

    return {
      success: true,
      message: `Backup ${type} creado exitosamente`,
      data: {
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        sizeFormatted: this.formatBytes(result.sizeBytes),
        createdAt: result.createdAt,
        type: result.type,
      },
    };
  }

  /**
   * Lista todos los backups disponibles.
   * GET /api/v1/backup/list
   */
  @Get('list')
  @RequirePermissions('settings:read')
  listBackups() {
    const backups = this.backupService.listBackups();

    return {
      success: true,
      data: backups.map((b) => ({
        filename: b.filename,
        sizeBytes: b.sizeBytes,
        sizeFormatted: this.formatBytes(b.sizeBytes),
        createdAt: b.createdAt,
        type: b.type,
      })),
    };
  }

  /**
   * Descarga un archivo de backup.
   * GET /api/v1/backup/download/:filename
   */
  @Get('download/:filename')
  @RequirePermissions('settings:read')
  async downloadBackup(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Sanitizar nombre de archivo
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new BadRequestException('Nombre de archivo inválido');
    }

    const filepath = this.backupService.getBackupPath(filename);
    if (!filepath) {
      throw new NotFoundException('Backup no encontrado');
    }

    const stat = fs.statSync(filepath);

    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stat.size.toString(),
    });

    const fileStream = fs.createReadStream(filepath);
    return new StreamableFile(fileStream);
  }

  /**
   * Restaura la base de datos desde un archivo subido.
   * POST /api/v1/backup/restore
   */
  @Post('restore')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max
      },
      dest: path.resolve(process.cwd(), 'backups', 'tmp'),
    }),
  )
  @RequirePermissions('settings:update')
  async restoreBackup(
    @UploadedFile() file: MulterFile,
    @Body() body: { type?: BackupType },
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó un archivo');
    }

    const type = body.type || 'local';

    if (!['local', 'production'].includes(type)) {
      throw new BadRequestException('Tipo debe ser "local" o "production"');
    }

    // Validar archivo (la extensión se toma del nombre ORIGINAL, no de la ruta temporal)
    const validation = this.backupService.validateBackupFile(file.path, file.originalname);
    if (!validation.valid) {
      // Limpiar archivo temporal
      fs.unlinkSync(file.path);
      throw new BadRequestException(validation.reason);
    }

    try {
      const result = await this.backupService.restoreFromUpload(file.path, type, file.originalname);

      // Limpiar archivo temporal
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      if (!result.success) {
        throw new BadRequestException(result.message);
      }

      return {
        success: true,
        message: result.message,
        duration: result.duration,
      };
    } catch (error) {
      // Limpiar archivo temporal en caso de error
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw error;
    }
  }

  /**
   * Valida si un archivo es un backup válido.
   * POST /api/v1/backup/validate
   */
  @Post('validate')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 },
      dest: path.resolve(process.cwd(), 'backups', 'tmp'),
    }),
  )
  @RequirePermissions('settings:read')
  async validateBackup(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException('No se proporcionó un archivo');
    }

    const validation = this.backupService.validateBackupFile(file.path, file.originalname);

    // Limpiar archivo temporal
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return {
      success: true,
      valid: validation.valid,
      reason: validation.reason,
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}
