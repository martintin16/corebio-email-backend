import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, type Auth } from 'googleapis';
import { GOOGLE_SCOPES } from './google.constants';

export interface ExchangedTokens {
  refreshToken: string | null;
  accessToken: string | null;
  /** Permisos que la persona realmente otorgó (puede destildar alguno). */
  scopes: string[];
}

/**
 * Operaciones OAuth contra Google. Es una clase abstracta para poder simularla en
 * los tests: el resto del código no conoce googleapis directamente.
 */
export abstract class GoogleOAuthClient {
  /** URL de la pantalla de consentimiento de Google. */
  abstract buildAuthUrl(options: { state: string; loginHint: string }): string;
  /** Canjea el `code` del callback por los tokens. */
  abstract exchangeCode(code: string): Promise<ExchangedTokens>;
  /** Email de la cuenta de Gmail dueña del token (para verificar que sea la casilla). */
  abstract getAccountEmail(accessToken: string): Promise<string>;
  /** Revoca el permiso otorgado (deja de servir el refresh_token). */
  abstract revokeToken(token: string): Promise<void>;
  /** Cliente OAuth2 autenticado con el refresh_token de una casilla. */
  abstract createAuthorizedClient(refreshToken: string): Auth.OAuth2Client;
}

@Injectable()
export class GoogleApisOAuthClient extends GoogleOAuthClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService) {
    super();
    this.clientId = config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.clientSecret = config.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
    this.redirectUri = config.getOrThrow<string>('GOOGLE_OAUTH_REDIRECT_URI');
  }

  buildAuthUrl(options: { state: string; loginHint: string }): string {
    return this.newClient().generateAuthUrl({
      // `offline` + `consent`: Google devuelve SIEMPRE un refresh_token (si no,
      // en una reconexión podría no mandarlo y la casilla quedaría sin credenciales).
      access_type: 'offline',
      prompt: 'consent',
      scope: [...GOOGLE_SCOPES],
      state: options.state,
      // Preselecciona la cuenta de la casilla en la pantalla de Google.
      login_hint: options.loginHint,
    });
  }

  async exchangeCode(code: string): Promise<ExchangedTokens> {
    const { tokens } = await this.newClient().getToken(code);
    return {
      refreshToken: tokens.refresh_token ?? null,
      accessToken: tokens.access_token ?? null,
      scopes: (tokens.scope ?? '').split(' ').filter((s) => s.length > 0),
    };
  }

  async getAccountEmail(accessToken: string): Promise<string> {
    const auth = this.newClient();
    auth.setCredentials({ access_token: accessToken });
    const { data } = await google.gmail({ version: 'v1', auth }).users.getProfile({ userId: 'me' });
    if (!data.emailAddress) throw new Error('Gmail no devolvió el email de la cuenta');
    return data.emailAddress;
  }

  async revokeToken(token: string): Promise<void> {
    await this.newClient().revokeToken(token);
  }

  createAuthorizedClient(refreshToken: string): Auth.OAuth2Client {
    const client = this.newClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  private newClient(): Auth.OAuth2Client {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }
}
