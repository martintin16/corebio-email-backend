import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { google, type Auth, type drive_v3, type gmail_v1 } from 'googleapis';
import { Repository } from 'typeorm';
import { Mailbox } from '../mailboxes/entities/mailbox.entity';
import type { MailboxAuthType } from '../mailboxes/mailboxes.types';
import { GoogleOAuthClient } from './google-oauth.client';
import { TokenCipher, TokenDecryptionError } from './token-cipher';

/** Clientes de Google listos para usar, autenticados como la casilla. */
export interface MailboxGoogleApis {
  mailboxId: string;
  /** Email de la casilla (el "me" de Gmail). */
  email: string;
  /** Nombre visible de la casilla (va como nombre del remitente al enviar). */
  displayName: string;
  gmail: gmail_v1.Gmail;
  drive: drive_v3.Drive;
}

/**
 * La casilla no tiene credenciales válidas: nunca se conectó, se desconectó o
 * Google rechazó el token. Responde 409 con `code` para que el frontend pueda
 * mostrar "reconectar".
 */
export class MailboxNeedsReconnectException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: 'mailbox_needs_reconnect',
      message: 'La casilla necesita reconectarse con Google',
    });
  }
}

/**
 * Punto único de acceso a Gmail y Drive de una casilla. Messages, Scheduled,
 * Templates y Drive (Fases 4–7) usan SOLO esto: no saben si por debajo hay un
 * refresh_token por casilla (OAuth) o una cuenta de servicio con domain-wide
 * delegation de Google Workspace.
 */
export abstract class GoogleMailboxClient {
  abstract forMailbox(mailboxId: string): Promise<MailboxGoogleApis>;

  /**
   * Para envolver las llamadas a Gmail/Drive de las fases siguientes: si Google
   * rechazó las credenciales, marca la casilla `needs_reconnect` y responde 409;
   * cualquier otro error de Google → 502.
   */
  abstract handleGoogleError(mailboxId: string, err: unknown): Promise<never>;

  /** Descarta el cliente cacheado (después de reconectar o desconectar). */
  abstract invalidate(mailboxId: string): void;
}

/** Cómo se obtiene un cliente autenticado para una casilla, según su `authType`. */
interface MailboxAuthStrategy {
  authorize(mailbox: Mailbox): Auth.OAuth2Client;
}

export function isInvalidGrant(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { message?: unknown; response?: { data?: { error?: unknown } } };
  return (
    e.response?.data?.error === 'invalid_grant' ||
    (typeof e.message === 'string' && e.message.includes('invalid_grant'))
  );
}

@Injectable()
export class DefaultGoogleMailboxClient extends GoogleMailboxClient {
  private readonly logger = new Logger(DefaultGoogleMailboxClient.name);
  /**
   * Un cliente OAuth2 por casilla, reutilizado entre requests: así el access_token
   * (válido ~1 h) se renueva solo cuando vence y no en cada pedido. Vive en memoria
   * del proceso (Railway corre una sola instancia); `invalidate()` lo descarta.
   */
  private readonly clients = new Map<string, Auth.OAuth2Client>();
  private readonly strategies: Record<MailboxAuthType, MailboxAuthStrategy>;

  constructor(
    @InjectRepository(Mailbox)
    private readonly mailboxes: Repository<Mailbox>,
    oauth: GoogleOAuthClient,
    cipher: TokenCipher,
  ) {
    super();
    this.strategies = {
      oauth: {
        authorize: (mailbox) => {
          if (!mailbox.googleRefreshToken) throw new MailboxNeedsReconnectException();
          return oauth.createAuthorizedClient(cipher.decrypt(mailbox.googleRefreshToken));
        },
      },
      // Se implementa cuando el Google Workspace de Corebio esté disponible: una
      // cuenta de servicio que impersona a la casilla. Las casillas `oauth` siguen
      // funcionando igual; cada una usa la estrategia de su propio `authType`.
      domain_wide: {
        authorize: () => {
          throw new NotImplementedException('Domain-wide delegation todavía no está implementado');
        },
      },
    };
  }

  async forMailbox(mailboxId: string): Promise<MailboxGoogleApis> {
    const mailbox = await this.mailboxes
      .createQueryBuilder('m')
      .addSelect('m.googleRefreshToken')
      .where('m.id = :id', { id: mailboxId })
      .getOne();
    if (!mailbox) throw new NotFoundException('La casilla no existe');
    if (mailbox.status !== 'connected') throw new MailboxNeedsReconnectException();

    let client = this.clients.get(mailboxId);
    if (!client) {
      try {
        client = this.strategies[mailbox.authType].authorize(mailbox);
      } catch (err) {
        if (err instanceof TokenDecryptionError) {
          // Cambió GOOGLE_TOKEN_ENCRYPTION_KEY o el dato se alteró: el token no sirve más.
          this.logger.error(`No se pudo desencriptar el token de la casilla ${mailboxId}`);
          await this.markNeedsReconnect(mailboxId);
          throw new MailboxNeedsReconnectException();
        }
        throw err;
      }
    }

    try {
      // Obtiene (o renueva) el access_token: si Google ya no acepta el
      // refresh_token, se detecta acá y no a mitad de una operación.
      await client.getAccessToken();
    } catch (err) {
      return this.handleGoogleError(mailboxId, err);
    }
    this.clients.set(mailboxId, client);

    return {
      mailboxId,
      email: mailbox.email,
      displayName: mailbox.displayName,
      gmail: google.gmail({ version: 'v1', auth: client }),
      drive: google.drive({ version: 'v3', auth: client }),
    };
  }

  async handleGoogleError(mailboxId: string, err: unknown): Promise<never> {
    if (isInvalidGrant(err)) {
      this.logger.warn(`Google rechazó las credenciales de la casilla ${mailboxId}`);
      await this.markNeedsReconnect(mailboxId);
      throw new MailboxNeedsReconnectException();
    }
    this.logger.error(
      `Error de Google en la casilla ${mailboxId}`,
      err instanceof Error ? err.stack : String(err),
    );
    throw new BadGatewayException('Google no respondió como se esperaba. Intentá de nuevo.');
  }

  invalidate(mailboxId: string): void {
    this.clients.delete(mailboxId);
  }

  private async markNeedsReconnect(mailboxId: string): Promise<void> {
    this.invalidate(mailboxId);
    await this.mailboxes.update({ id: mailboxId }, { status: 'needs_reconnect' });
  }
}
