/**
 * Registra auditoría HTTP para POST/PUT/PATCH/DELETE al terminar la respuesta (evento `finish`),
 * cuando el código de estado ya es el definitivo. Cubre éxitos, errores de validación y
 * rechazos de guards (casos en los que un interceptor sobre el observable no llega a auditar).
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { AuditService } from '../../modules/audit/audit.service';
import type { JwtUserPayload } from '../../modules/auth/types/jwt-user.payload';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditHttpMiddleware implements NestMiddleware {
  constructor(
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request & { user?: JwtUserPayload }, res: Response, next: NextFunction): void {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }
    if (this.config.get<string>('AUDIT_HTTP') === 'false') {
      next();
      return;
    }

    const path = req.originalUrl ?? req.url;
    // Portal público de clientes: el cuerpo (placa + celular) es información personal y
    // no debe quedar persistida en auditoría HTTP. El control de intentos ya lo hace su propio
    // rate limit con huellas anónimas.
    if (path.includes('/client-portal/')) {
      next();
      return;
    }
    let logged = false;

    const logOnce = () => {
      if (logged) {
        return;
      }
      logged = true;
      const actorUserId = req.user?.sub ?? null;
      void this.audit.recordHttpEvent({
        actorUserId,
        method: req.method,
        path,
        statusCode: res.statusCode,
        query: req.query,
        body: redactBody(req.body),
        requestId: (req.headers['x-request-id'] as string) ?? null,
        ipAddress: normalizeIp(req.ip ?? req.socket.remoteAddress),
        userAgent: (req.headers['user-agent'] as string) ?? null,
      });
    };

    res.once('finish', logOnce);
    next();
  }
}

function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('password') ||
      lower.includes('token') ||
      lower === 'authorization' ||
      lower.includes('secret')
    ) {
      clone[key] = '[REDACTED]';
      continue;
    }
    if (typeof clone[key] === 'object' && clone[key] !== null) {
      clone[key] = redactBody(clone[key]);
    }
  }
  return clone;
}

function normalizeIp(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  return ip === '::1' ? '127.0.0.1' : ip;
}
