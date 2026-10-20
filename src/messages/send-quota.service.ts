import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export const RECIPIENT_LIMIT_EXCEEDED = 'RECIPIENT_LIMIT_EXCEEDED';

/**
 * 429 con lo necesario para que el frontend muestre cuántos quedan:
 * `{ code: 'RECIPIENT_LIMIT_EXCEEDED', limit, remaining, requested, message }`.
 */
export class RecipientLimitExceededException extends HttpException {
  constructor(
    readonly limit: number,
    readonly remaining: number,
    readonly requested: number,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        code: RECIPIENT_LIMIT_EXCEEDED,
        message: recipientLimitMessage(remaining, requested),
        limit,
        remaining,
        requested,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function recipientLimitMessage(remaining: number, requested: number): string {
  return (
    `Se superó el cupo diario de la casilla: este envío tiene ${requested} ` +
    `destinatario${requested === 1 ? '' : 's'} y quedan ${remaining} en las últimas 24 horas`
  );
}

/**
 * Gmail rechazó el envío por su propio cupo (por ejemplo, porque se mandaron
 * mails desde Gmail directamente, que la app no cuenta).
 */
export function isGmailSendingLimitError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    message?: unknown;
    errors?: { reason?: unknown }[];
    response?: { data?: { error?: { errors?: { reason?: unknown }[] } } };
  };
  const reasons = [...(e.errors ?? []), ...(e.response?.data?.error?.errors ?? [])].map((x) =>
    typeof x.reason === 'string' ? x.reason : '',
  );
  return (
    reasons.includes('dailyLimitExceeded') ||
    (typeof e.message === 'string' && /sending (limit|quota)|daily user sending/i.test(e.message))
  );
}

/**
 * Cupo diario de destinatarios por casilla (Gmail común: ~500 en 24 horas;
 * Workspace: 2000). Se cuenta en una ventana móvil de 24 horas, como Gmail,
 * con lo enviado DESDE LA APP (tabla `mailbox_send_log`). Lo que se mande
 * directo desde Gmail no se ve: si Gmail igual rechaza, se informa con el mismo
 * código.
 */
@Injectable()
export class SendQuotaService {
  private readonly logger = new Logger(SendQuotaService.name);
  readonly limit: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.limit = config.get<number>('MAILBOX_DAILY_RECIPIENT_LIMIT') ?? 500;
  }

  /** Cuántos destinatarios le quedan a la casilla en las últimas 24 horas. */
  async remaining(mailboxId: string): Promise<number> {
    const rows = await this.dataSource.query<{ used: string | number | null }[]>(
      `SELECT COALESCE(SUM(recipients), 0) AS used
         FROM public.mailbox_send_log
        WHERE mailbox_id = $1 AND sent_at > now() - interval '24 hours'`,
      [mailboxId],
    );
    return Math.max(0, this.limit - Number(rows[0]?.used ?? 0));
  }

  /** 429 RECIPIENT_LIMIT_EXCEEDED si este envío no entra en el cupo. */
  async assertAvailable(mailboxId: string, requested: number): Promise<void> {
    const remaining = await this.remaining(mailboxId);
    if (requested > remaining) {
      throw new RecipientLimitExceededException(this.limit, remaining, requested);
    }
  }

  /** Anota un envío. Si falla, no se frena nada (el mail ya salió): queda en el log. */
  async record(mailboxId: string, recipients: number, source: SendSource): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO public.mailbox_send_log (mailbox_id, recipients, source) VALUES ($1, $2, $3)`,
        [mailboxId, recipients, source],
      );
      // Lo de más de 2 días ya no cuenta para nada.
      await this.dataSource.query(
        `DELETE FROM public.mailbox_send_log
          WHERE mailbox_id = $1 AND sent_at < now() - interval '2 days'`,
        [mailboxId],
      );
    } catch (err) {
      this.logger.error(
        `No se pudo anotar el envío de la casilla ${mailboxId} (${recipients} destinatarios)`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export type SendSource = 'compose' | 'reply' | 'scheduled';
