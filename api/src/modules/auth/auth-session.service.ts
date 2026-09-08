/**
 * Sesiones de acceso en servidor: un solo dispositivo/sesión vigente por usuario al iniciar sesión,
 * cierre por inactividad según `auth.session_idle_timeout_minutes` en configuración del taller.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const IDLE_SETTING_KEY = 'auth.session_idle_timeout_minutes';
const DEFAULT_IDLE_MINUTES = 10;
const MIN_IDLE = 1;
const MAX_IDLE = 24 * 60;

/** Vigencia en memoria del ajuste de inactividad: se lee en cada petición autenticada. */
const IDLE_SETTING_TTL_MS = 60_000;
/** Mínimo entre escrituras de `last_activity_at` por sesión (evita un UPDATE por request). */
const TOUCH_MIN_INTERVAL_MS = 30_000;

@Injectable()
export class AuthSessionService {
  constructor(private readonly prisma: PrismaService) {}

  private idleSettingCache: { at: number; value: number } | null = null;
  private readonly lastTouchAt = new Map<string, number>();

  async getSessionIdleTimeoutMinutes(): Promise<number> {
    const now = Date.now();
    if (this.idleSettingCache && now - this.idleSettingCache.at < IDLE_SETTING_TTL_MS) {
      return this.idleSettingCache.value;
    }

    const row = await this.prisma.workshopSetting.findUnique({
      where: { key: IDLE_SETTING_KEY },
    });
    const raw = row?.value;
    let n = DEFAULT_IDLE_MINUTES;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      n = raw;
    } else if (typeof raw === 'string') {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        n = parsed;
      }
    }
    const value = Math.min(MAX_IDLE, Math.max(MIN_IDLE, n));
    this.idleSettingCache = { at: now, value };
    return value;
  }

  /**
   * Cierra sesiones previas del mismo usuario y abre una nueva (un solo uso activo a la vez).
   */
  async createSessionForUser(
    userId: string,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<string> {
    const now = new Date();
    await this.prisma.userAuthSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });

    const row = await this.prisma.userAuthSession.create({
      data: {
        userId,
        lastActivityAt: now,
        createdFromIp: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
    return row.id;
  }

  /**
   * Comprueba que la sesión exista, no esté revocada, pertenezca al usuario y no haya superado el tiempo sin actividad.
   */
  async assertSessionValid(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.userAuthSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session) {
      throw new UnauthorizedException('Sesión inválida o cerrada. Inicie sesión de nuevo.');
    }

    const idleMinutes = await this.getSessionIdleTimeoutMinutes();
    const limitMs = idleMinutes * 60_000;
    if (Date.now() - session.lastActivityAt.getTime() > limitMs) {
      await this.prisma.userAuthSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sesión cerrada por inactividad. Inicie sesión de nuevo.');
    }
  }

  /**
   * Marca actividad (se llama en cada petición autenticada exitosa).
   *
   * Se limita a una escritura cada `TOUCH_MIN_INTERVAL_MS` por sesión: escribir en cada request
   * era una consulta extra por petición y no aporta precisión útil al corte por inactividad.
   */
  async touchSession(sessionId: string, userId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastTouchAt.get(sessionId) ?? 0;
    if (now - last < TOUCH_MIN_INTERVAL_MS) return;
    this.lastTouchAt.set(sessionId, now);

    await this.prisma.userAuthSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { lastActivityAt: new Date() },
    });
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    this.lastTouchAt.delete(sessionId);
    await this.prisma.userAuthSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.userAuthSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
