/**
 * Valida JWT + sesión de servidor (`sid`), permisos y usuario activo.
 * La inactividad se controla con `last_activity_at` y el ajuste `auth.session_idle_timeout_minutes`.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { permissionCode } from '../../../common/constants/permission-code';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthSessionService } from '../auth-session.service';
import type { JwtUserPayload } from '../types/jwt-user.payload';

/** Claims del token de acceso. `prv` = id de rol: permisos efectivos son los de ese rol + `auth:assume_role_preview`. */
type JwtBody = { sub: string; sid: string; prv?: string };

const PREVIEW_KEEPER = 'auth:assume_role_preview';

/**
 * Vigencia del contexto de usuario cacheado (permisos incluidos).
 *
 * `validate()` corre en **cada** petición autenticada. Sin caché resolvía usuario + roles +
 * permisos anidados en cada request (varias consultas), lo que dominaba la latencia medida
 * (~850 ms por petición). Con esta caché el costo cae a una sola consulta de sesión.
 *
 * 30 s: un cambio de rol/permiso tarda como máximo ese tiempo en aplicarse. La validez de la
 * sesión (revocada o inactiva) se sigue comprobando siempre contra la BD.
 */
const AUTH_CONTEXT_TTL_MS = 30_000;
/** Tope de entradas para que la caché no crezca sin límite en despliegues largos. */
const AUTH_CONTEXT_MAX_ENTRIES = 500;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /** `sub|prv` -> contexto resuelto. Se purga por TTL y por tope de entradas. */
  private readonly contextCache = new Map<string, { at: number; value: JwtUserPayload }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtBody): Promise<JwtUserPayload> {
    if (!payload?.sub || !payload?.sid) {
      throw new UnauthorizedException('Token incompleto. Inicie sesión de nuevo.');
    }

    const cacheKey = `${payload.sub}|${payload.prv ?? ''}`;
    const cached = this.contextCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < AUTH_CONTEXT_TTL_MS) {
      // La sesión se valida igual: una revocación o inactividad sigue cortando el acceso al instante.
      await this.sessions.assertSessionValid(payload.sid, payload.sub);
      return { ...cached.value, sid: payload.sid };
    }

    await this.sessions.assertSessionValid(payload.sid, payload.sub);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión inválida o usuario inactivo');
    }

    const canUseRolePreview = user.roles.some(
      (ur) => ur.role.slug === 'administrador' || ur.role.slug === 'dueno',
    );

    if (payload.prv) {
      if (!canUseRolePreview) {
        throw new UnauthorizedException('Vista por rol no permitida para esta cuenta.');
      }
      const preview = await this.prisma.role.findUnique({
        where: { id: payload.prv },
        include: { permissions: { include: { permission: true } } },
      });
      if (!preview) {
        throw new UnauthorizedException('El rol de vista ya no existe. Cerrá sesión y volvé a entrar.');
      }
      const set = new Set<string>();
      for (const rp of preview.permissions) {
        set.add(permissionCode(rp.permission.resource, rp.permission.action));
      }
      set.add(PREVIEW_KEEPER);
      const previewContext: JwtUserPayload = {
        sub: user.id,
        sid: payload.sid,
        email: user.email,
        fullName: user.fullName,
        permissions: [...set].sort(),
        portalCustomerId: user.portalCustomerId ?? null,
        previewRole: { id: preview.id, slug: preview.slug, name: preview.name },
      };
      this.remember(cacheKey, previewContext);
      return previewContext;
    }

    const set = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        set.add(permissionCode(rp.permission.resource, rp.permission.action));
      }
    }
    if (canUseRolePreview) {
      set.add(PREVIEW_KEEPER);
    }

    const context: JwtUserPayload = {
      sub: user.id,
      sid: payload.sid,
      email: user.email,
      fullName: user.fullName,
      permissions: [...set].sort(),
      portalCustomerId: user.portalCustomerId ?? null,
    };
    this.remember(cacheKey, context);
    return context;
  }

  private remember(key: string, value: JwtUserPayload): void {
    if (this.contextCache.size >= AUTH_CONTEXT_MAX_ENTRIES) {
      const oldest = this.contextCache.keys().next().value;
      if (oldest !== undefined) this.contextCache.delete(oldest);
    }
    this.contextCache.set(key, { at: Date.now(), value });
  }
}
