import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { errors, jwtVerify, SignJWT } from 'jose';

const AUDIENCE = 'mailbox-oauth';
const TTL = '10m';

export interface OAuthStatePayload {
  mailboxId: string;
  adminId: string;
}

export class InvalidOAuthStateError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(`state OAuth ${reason === 'expired' ? 'vencido' : 'inválido'}`);
  }
}

/**
 * El `state` que viaja a Google y vuelve en el callback.
 *
 * Es un JWT firmado (HS256, OAUTH_STATE_SECRET) que dice qué casilla se está
 * conectando y qué admin lo pidió, y vence a los 10 minutos. El callback es
 * público (Google redirige el navegador, sin token nuestro): esta firma es lo que
 * impide que alguien arme un callback falso para pisar las credenciales de una
 * casilla.
 */
@Injectable()
export class OAuthStateService {
  private readonly secret: Uint8Array;

  constructor(config: ConfigService) {
    this.secret = new TextEncoder().encode(config.getOrThrow<string>('OAUTH_STATE_SECRET'));
  }

  sign(payload: OAuthStatePayload): Promise<string> {
    return new SignJWT({ mbx: payload.mailboxId, adm: payload.adminId })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(TTL)
      .sign(this.secret);
  }

  async verify(state: string): Promise<OAuthStatePayload> {
    try {
      const { payload } = await jwtVerify(state, this.secret, {
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.mbx !== 'string' || typeof payload.adm !== 'string') {
        throw new InvalidOAuthStateError('invalid');
      }
      return { mailboxId: payload.mbx, adminId: payload.adm };
    } catch (err) {
      if (err instanceof InvalidOAuthStateError) throw err;
      if (err instanceof errors.JWTExpired) throw new InvalidOAuthStateError('expired');
      throw new InvalidOAuthStateError('invalid');
    }
  }
}
