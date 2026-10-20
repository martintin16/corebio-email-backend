import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sameMailboxAddress } from '../google/email-address';
import { GoogleMailboxClient } from '../google/google-mailbox-client';
import { GoogleOAuthClient, type ExchangedTokens } from '../google/google-oauth.client';
import { REQUIRED_GOOGLE_SCOPES } from '../google/google.constants';
import { OAuthStateService } from '../google/oauth-state.service';
import { TokenCipher } from '../google/token-cipher';
import { Mailbox } from './entities/mailbox.entity';

/** Motivos por los que una conexión con Google no se completó (van al frontend). */
export type ConnectionErrorCode =
  | 'access_denied'
  | 'google_error'
  | 'invalid_request'
  | 'invalid_state'
  | 'expired_state'
  | 'mailbox_not_found'
  | 'token_exchange_failed'
  | 'no_refresh_token'
  | 'missing_scopes'
  | 'profile_failed'
  | 'wrong_account'
  | 'unexpected';

class ConnectionFailed extends Error {
  constructor(
    readonly code: ConnectionErrorCode,
    readonly mailboxId?: string,
  ) {
    super(code);
  }
}

export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Flujo de conexión de una casilla con Google (OAuth por casilla):
 *
 * 1. `startConnection`: el admin pide conectar → URL de consentimiento de Google,
 *    con un `state` firmado que identifica casilla y admin.
 * 2. La persona entra con la cuenta de Gmail de la casilla y acepta.
 * 3. `handleCallback`: Google vuelve al backend → se valida todo, se guarda el
 *    refresh_token encriptado y se redirige al frontend con el resultado.
 */
@Injectable()
export class MailboxConnectionService {
  private readonly logger = new Logger(MailboxConnectionService.name);
  private readonly adminMailboxesUrl: string;

  constructor(
    @InjectRepository(Mailbox)
    private readonly mailboxes: Repository<Mailbox>,
    private readonly oauth: GoogleOAuthClient,
    private readonly state: OAuthStateService,
    private readonly cipher: TokenCipher,
    private readonly googleClient: GoogleMailboxClient,
    config: ConfigService,
  ) {
    const frontendUrl = config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    this.adminMailboxesUrl = `${frontendUrl}/admin/mailboxes`;
  }

  /** POST /mailboxes/:id/reconnect — sirve para la primera conexión y para reconectar. */
  async startConnection(mailboxId: string, adminId: string): Promise<{ authUrl: string }> {
    const mailbox = await this.mailboxes.findOneBy({ id: mailboxId });
    if (!mailbox) throw new NotFoundException('La casilla no existe');
    if (mailbox.authType !== 'oauth') {
      throw new ConflictException('Esta casilla no se conecta con OAuth');
    }
    const state = await this.state.sign({ mailboxId, adminId });
    return { authUrl: this.oauth.buildAuthUrl({ state, loginHint: mailbox.email }) };
  }

  /**
   * GET /mailboxes/oauth/callback — siempre termina en una redirección al
   * frontend (nunca en una pantalla de error del backend):
   * `/admin/mailboxes?connected=<id>` o `/admin/mailboxes?connectionError=<code>`.
   */
  async handleCallback(query: OAuthCallbackQuery): Promise<string> {
    try {
      const mailboxId = await this.completeConnection(query);
      return `${this.adminMailboxesUrl}?connected=${encodeURIComponent(mailboxId)}`;
    } catch (err) {
      const failure = err instanceof ConnectionFailed ? err : new ConnectionFailed('unexpected');
      if (!(err instanceof ConnectionFailed)) {
        this.logger.error(
          'Error inesperado en el callback de Google',
          err instanceof Error ? err.stack : String(err),
        );
      } else {
        this.logger.warn(`Conexión con Google no completada: ${failure.code}`);
      }
      const params = new URLSearchParams({ connectionError: failure.code });
      if (failure.mailboxId) params.set('mailboxId', failure.mailboxId);
      return `${this.adminMailboxesUrl}?${params.toString()}`;
    }
  }

  /**
   * DELETE /mailboxes/:id — revoca el permiso en Google (si había) y borra la
   * casilla con sus accesos. Si Google no responde, igual se borra: el token
   * queda inservible para nosotros y la persona puede quitar el acceso desde su
   * cuenta de Google.
   */
  async disconnect(mailboxId: string): Promise<void> {
    const mailbox = await this.findWithToken(mailboxId);
    if (!mailbox) throw new NotFoundException('La casilla no existe');

    if (mailbox.googleRefreshToken) {
      try {
        await this.oauth.revokeToken(this.cipher.decrypt(mailbox.googleRefreshToken));
      } catch (err) {
        this.logger.warn(
          `No se pudo revocar el token de la casilla ${mailboxId} en Google`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    await this.mailboxes.delete({ id: mailboxId });
    this.googleClient.invalidate(mailboxId);
  }

  // ---------------------------------------------------------------------------

  private async completeConnection(query: OAuthCallbackQuery): Promise<string> {
    if (query.error) {
      // Google devuelve el `state` también cuando hay error (ej. la persona canceló):
      // si es válido, se informa de qué casilla venía el intento. Si no se puede
      // verificar, no se usa (no se confía en un id que no firmamos).
      const verified = query.state ? await this.state.verify(query.state).catch(() => null) : null;
      throw new ConnectionFailed(
        query.error === 'access_denied' ? 'access_denied' : 'google_error',
        verified?.mailboxId,
      );
    }
    if (!query.code || !query.state) throw new ConnectionFailed('invalid_request');

    let payload: { mailboxId: string; adminId: string };
    try {
      payload = await this.state.verify(query.state);
    } catch (err) {
      const expired = (err as { reason?: string }).reason === 'expired';
      throw new ConnectionFailed(expired ? 'expired_state' : 'invalid_state');
    }
    const { mailboxId, adminId } = payload;

    const mailbox = await this.mailboxes.findOneBy({ id: mailboxId });
    if (!mailbox) throw new ConnectionFailed('mailbox_not_found');

    let tokens: ExchangedTokens;
    try {
      tokens = await this.oauth.exchangeCode(query.code);
    } catch {
      throw new ConnectionFailed('token_exchange_failed', mailboxId);
    }
    if (!tokens.refreshToken) throw new ConnectionFailed('no_refresh_token', mailboxId);
    const refreshToken = tokens.refreshToken;

    // Se identifica la cuenta antes de decidir nada (puede fallar si, por ejemplo,
    // la persona destildó el permiso de Gmail).
    let accountEmail: string | null = null;
    try {
      if (tokens.accessToken) accountEmail = await this.oauth.getAccountEmail(tokens.accessToken);
    } catch {
      accountEmail = null;
    }

    // Si algo no cierra, el token recién emitido se descarta. Revocarlo en Google
    // revoca TODO el permiso de esa cuenta para la app, no solo este token: si la
    // cuenta ya está conectada como alguna casilla (otra, o esta misma al
    // reconectar), revocar la dejaría sin credenciales. Por eso solo se revoca
    // cuando la cuenta es conocida y no pertenece a ninguna casilla conectada; en
    // cualquier otro caso queda, como mucho, un permiso sin usar en esa cuenta.
    const reject = async (code: ConnectionErrorCode): Promise<never> => {
      if (accountEmail && !(await this.isAccountInUse(accountEmail))) {
        await this.oauth.revokeToken(refreshToken).catch(() => undefined);
      }
      throw new ConnectionFailed(code, mailboxId);
    };

    // La pantalla de Google permite destildar permisos: sin Gmail y Drive la casilla
    // no sirve. Los de Contactos son opcionales (ver google.constants.ts).
    const missing = REQUIRED_GOOGLE_SCOPES.filter((scope) => !tokens.scopes.includes(scope));
    if (missing.length > 0) return reject('missing_scopes');

    if (!accountEmail) return reject('profile_failed');

    // Que la cuenta conectada sea la casilla: si no, `tesoreria@` quedaría leyendo
    // el correo de otra persona.
    if (!sameMailboxAddress(accountEmail, mailbox.email)) return reject('wrong_account');

    await this.mailboxes.update(
      { id: mailboxId },
      {
        googleRefreshToken: this.cipher.encrypt(refreshToken),
        googleScopes: tokens.scopes.join(' '),
        connectedAt: new Date(),
        connectedBy: adminId,
        status: 'connected',
      },
    );
    this.googleClient.invalidate(mailboxId);
    return mailboxId;
  }

  /** true si la cuenta de Google ya es la de alguna casilla con credenciales guardadas. */
  private async isAccountInUse(accountEmail: string): Promise<boolean> {
    const withCredentials = await this.mailboxes
      .createQueryBuilder('m')
      .select(['m.id', 'm.email'])
      .where('m.googleRefreshToken IS NOT NULL')
      .getMany();
    return withCredentials.some((m) => sameMailboxAddress(m.email, accountEmail));
  }

  private findWithToken(mailboxId: string): Promise<Mailbox | null> {
    return this.mailboxes
      .createQueryBuilder('m')
      .addSelect('m.googleRefreshToken')
      .where('m.id = :id', { id: mailboxId })
      .getOne();
  }
}
