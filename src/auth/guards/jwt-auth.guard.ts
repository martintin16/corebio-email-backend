import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { IS_PUBLIC_KEY } from '../auth.constants';
import { SupabaseJwtVerifier } from '../supabase-jwt.verifier';
import type { AuthenticatedRequest } from '../types/authenticated-user';

/** Extrae el token de `Authorization: Bearer <token>`. Devuelve null si el header no es válido. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== 'bearer' || token.length === 0) return null;
  return token;
}

/**
 * Guard global de autenticación (registrado como APP_GUARD en AuthModule).
 *
 * 1. Endpoints con @Public() pasan sin token.
 * 2. Verifica el JWT de Supabase → identidad (sub, email). Falla → 401.
 * 3. Carga el perfil de `user_profiles` → rol y estado. Sin perfil o inactivo → 403.
 *    El rol sale de la DB y no del JWT, para que desactivar a alguien o cambiarle
 *    el rol tenga efecto inmediato, sin esperar a que venza su token.
 * 4. Deja `request.user = { id, email, role }` para el RolesGuard y @CurrentUser().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseJwtVerifier,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    const claims = await this.verifier.verify(token);

    const profile = await this.users.findProfileById(claims.sub);
    if (!profile) {
      throw new ForbiddenException('El usuario no está habilitado en Corebio Mail');
    }
    if (profile.status === 'inactive') {
      throw new ForbiddenException('El usuario está desactivado');
    }

    request.user = { id: profile.id, email: claims.email, role: profile.role };
    return true;
  }
}
