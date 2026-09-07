/**
 * Servicio de backup y restore de base de datos.
 *
 * Ejecuta pg_dump/pg_restore como procesos externos.
 * Los backups se almacenan temporalmente en api/backups/ con auto-limpieza de 24h.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(execCb);

const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Resuelve la ruta de una herramienta PostgreSQL (pg_dump/pg_restore/psql).
 * Prioridad: variable de entorno → rutas Windows conocidas → PATH del sistema.
 */
function resolveToolPath(envVar: string, exeName: string): string {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;

  if (process.platform === 'win32') {
    const candidates = [16, 15, 14, 13].map(
      (v) => `C:\\Program Files\\PostgreSQL\\${v}\\bin\\${exeName}.exe`,
    );
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  return exeName;
}

const PG_DUMP_PATH = resolveToolPath('PG_DUMP_PATH', 'pg_dump');
const PG_RESTORE_PATH = resolveToolPath('PG_RESTORE_PATH', 'pg_restore');
const PSQL_PATH = resolveToolPath('PSQL_PATH', 'psql');

export type BackupType = 'local' | 'production';

export interface BackupResult {
  filename: string;
  filepath: string;
  sizeBytes: number;
  createdAt: Date;
  type: BackupType;
}

export interface RestoreResult {
  success: boolean;
  message: string;
  duration: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;

  constructor(private readonly config: ConfigService) {
    this.backupDir = path.resolve(process.cwd(), 'backups');
    this.ensureBackupDir();
    this.scheduleCleanup();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Limpia backups automáticos mayores a 24h.
   */
  private scheduleCleanup(): void {
    setInterval(() => this.cleanOldBackups(), 60 * 60 * 1000); // Cada hora
    this.cleanOldBackups(); // Ejecutar al iniciar
  }

  private cleanOldBackups(): void {
    try {
      const files = fs.readdirSync(this.backupDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        if (!file.startsWith('vene_autos_')) continue;
        const filepath = path.join(this.backupDir, file);
        const stat = fs.statSync(filepath);
        if (now - stat.mtimeMs > MAX_BACKUP_AGE_MS) {
          fs.unlinkSync(filepath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Limpieza de backups: ${cleaned} archivos eliminados`);
      }
    } catch (error) {
      this.logger.warn(`Error en limpieza de backups: ${error}`);
    }
  }

  /**
   * Parsea una DATABASE_URL de PostgreSQL.
   */
  private parseDatabaseUrl(url: string) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.slice(1),
      user: parsed.username,
      password: parsed.password,
    };
  }

  /**
   * Obtiene la URL de conexión según el tipo.
   */
  private getConnectionUrl(type: BackupType): string {
    const key = type === 'production' ? 'DIRECT_URL' : 'DATABASE_URL';
    const url = this.config.get<string>(key);
    if (!url) {
      throw new Error(`Variable ${key} no configurada en .env`);
    }
    return url;
  }

  /**
   * Ejecuta pg_dump y retorna la información del archivo generado.
   */
  async createBackup(type: BackupType): Promise<BackupResult> {
    this.logger.log(`Iniciando backup ${type}...`);

    const url = this.getConnectionUrl(type);
    const db = this.parseDatabaseUrl(url);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `vene_autos_${type}_${timestamp}.sql`;
    const filepath = path.join(this.backupDir, filename);

    const env = {
      ...process.env,
      PGPASSWORD: db.password,
    };

    const cmd = [
      `"${PG_DUMP_PATH}"`,
      `--host=${db.host}`,
      `--port=${db.port}`,
      `--username=${db.user}`,
      `--dbname=${db.database}`,
      // Formato SQL plano: compatible con cualquier versión de psql/pg_restore,
      // no depende de la versión del binario que lo generó.
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      `--file="${filepath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, {
        env,
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      });

      const stat = fs.statSync(filepath);
      this.logger.log(`Backup completado: ${filename} (${stat.size} bytes)`);

      return {
        filename,
        filepath,
        sizeBytes: stat.size,
        createdAt: new Date(),
        type,
      };
    } catch (error) {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      throw new Error(`Error en pg_dump: ${error}`);
    }
  }

  /**
   * Lista backups disponibles en el directorio.
   */
  listBackups(): BackupResult[] {
    this.ensureBackupDir();

    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith('vene_autos_') && (f.endsWith('.sql') || f.endsWith('.sql.gz') || f.endsWith('.dump')))
      .map((filename) => {
        const filepath = path.join(this.backupDir, filename);
        const stat = fs.statSync(filepath);
        const type: BackupType = filename.includes('_local_') ? 'local' : 'production';

        return {
          filename,
          filepath,
          sizeBytes: stat.size,
          createdAt: stat.mtime,
          type,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Retorna la ruta de un archivo de backup específico.
   */
  getBackupPath(filename: string): string | null {
    const filepath = path.join(this.backupDir, filename);
    if (!fs.existsSync(filepath)) return null;
    return filepath;
  }

  /**
   * Restaura la base de datos desde un archivo.
   * ADVERTENCIA: Borra todos los datos existentes.
   */
  async restoreFromUpload(
    filepath: string,
    type: BackupType,
    originalName?: string,
  ): Promise<RestoreResult> {
    const startTime = Date.now();
    this.logger.log(`Iniciando restore ${type} desde ${originalName || path.basename(filepath)}...`);

    const url = this.getConnectionUrl(type);
    const db = this.parseDatabaseUrl(url);

    const env = {
      ...process.env,
      PGPASSWORD: db.password,
    };

    try {
      // Paso 1: Vaciar el esquema public EN SITIO (sin DROP DATABASE).
      // Así la API en ejecución no pierde la conexión y no se rompen
      // requests en curso durante el restore.
      this.logger.log('Vaciando esquema public...');
      await execAsync(
        `"${PSQL_PATH}" --host=${db.host} --port=${db.port} --username=${db.user} --dbname=${db.database} -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE;" -c "CREATE SCHEMA public AUTHORIZATION ${db.user};"`,
        { env, timeout: 120_000 },
      );

      // Paso 2: Restaurar
      this.logger.log('Restaurando datos...');

      // Si el archivo es SQL plano (.sql), usar psql; formato custom usa pg_restore.
      const isPlainSql = (originalName || filepath).toLowerCase().endsWith('.sql');

      if (isPlainSql) {
        const restoreCmd = `"${PSQL_PATH}" --host=${db.host} --port=${db.port} --username=${db.user} --dbname=${db.database} -v ON_ERROR_STOP=1 -f "${filepath}"`;

        await execAsync(restoreCmd, {
          env,
          timeout: 600_000,
          maxBuffer: 100 * 1024 * 1024,
        });
      } else {
        const restoreCmd = [
          `"${PG_RESTORE_PATH}"`,
          `--host=${db.host}`,
          `--port=${db.port}`,
          `--username=${db.user}`,
          `--dbname=${db.database}`,
          '--no-owner',
          '--no-privileges',
          '--verbose',
          '--if-exists',
          '--clean',
          `"${filepath}"`,
        ].join(' ');

        await execAsync(restoreCmd, {
          env,
          timeout: 600_000,
          maxBuffer: 100 * 1024 * 1024,
        });
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Restore completado en ${duration}s`);

      return {
        success: true,
        message: 'Base de datos restaurada exitosamente',
        duration: `${duration}s`,
      };
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error en restore: ${errorMsg}`);

      return {
        success: false,
        message: `Error al restaurar: ${errorMsg}`,
        duration: `${duration}s`,
      };
    }
  }

  /**
   * Valida que un archivo sea un backup válido (formato pg_dump custom o SQL).
   * `originalName` es el nombre del archivo subido; `filepath` es la ruta temporal guardada por Multer.
   */
  validateBackupFile(
    filepath: string,
    originalName?: string,
  ): { valid: boolean; reason?: string } {
    try {
      const stat = fs.statSync(filepath);

      // Verificar tamaño máximo (500MB)
      if (stat.size > 500 * 1024 * 1024) {
        return { valid: false, reason: 'El archivo excede 500MB' };
      }

      // Verificar tamaño mínimo (1KB)
      if (stat.size < 1024) {
        return { valid: false, reason: 'El archivo es demasiado pequeño para ser un backup válido' };
      }

      // Verificar extensión sobre el nombre ORIGINAL del archivo subido
      // (la ruta temporal de Multer no conserva la extensión).
      const name = originalName ?? filepath;
      const lower = name.toLowerCase();
      const ok =
        lower.endsWith('.sql.gz') ||
        lower.endsWith('.sql') ||
        lower.endsWith('.dump') ||
        lower.endsWith('.gz');
      if (!ok) {
        return { valid: false, reason: 'Extensión de archivo no válida (use .sql.gz, .sql o .dump)' };
      }

      return { valid: true };
    } catch {
      return { valid: false, reason: 'No se pudo leer el archivo' };
    }
  }
}
