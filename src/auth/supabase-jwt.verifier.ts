import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { JWKS_RESOLVER, supabaseIssuer } from './auth.constants';

export interface SupabaseTokenClaims {
  sub: string;
  email: string;
}

/**
 * Verifica los access tokens de Supabase Auth.
 *
 * - Firma: ES256 contra el JWKS público del proyecto (sin secretos en el backend).
 *   La key legacy HS256 no se acepta.
 * - Valida issuer (`<SUPABASE_URL>/auth/v1`), audience (`authenticated`) y expiración.
 * - Si no se puede obtener el JWKS (Supabase caído / timeout) responde 503, no 401:
 *   que el token no se pueda verificar no significa que sea inválido.
 */
@Injectable()
export class SupabaseJwtVerifier {
  private readonly logger = new Logger(SupabaseJwtVerifier.name);
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    @Inject(JWKS_RESOLVER) private readonly getKey: JWTVerifyGetKey,
    config: ConfigService,
  ) {
    this.issuer = supabaseIssuer(config.getOrThrow<string>('SUPABASE_URL'));
    this.audience = config.getOrThrow<string>('SUPABASE_JWT_AUDIENCE');
  }

  async verify(token: string): Promise<SupabaseTokenClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['ES256'],
      }));
    } catch (err) {
      if (err instanceof errors.JWKSTimeout) {
        this.logger.error('Timeout obteniendo el JWKS de Supabase');
        throw new ServiceUnavailableException('No se pudo verificar el token en este momento');
      }
      if (err instanceof errors.JOSEError) {
        throw new UnauthorizedException('Token inválido o vencido');
      }
      this.logger.error('Error inesperado verificando el token', err as Error);
      throw new ServiceUnavailableException('No se pudo verificar el token en este momento');
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('Token sin usuario');
    }

    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
    };
  }
}
