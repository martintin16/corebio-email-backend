import {
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { type QueryRows, rowsOf } from '../common/query-rows';
import {
  GoogleMailboxClient,
  MailboxNeedsReconnectException,
} from '../google/google-mailbox-client';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { MessagesService } from '../messages/messages.service';

/** Cada cuánto se buscan programados vencidos. */
export const TICK_MS = 60_000;
/** Cuántos se toman por vuelta (el resto queda para la siguiente). */
export const BATCH_SIZE = 20;
/** Esperas entre reintentos ante errores transitorios de Google (minutos). */
export const RETRY_DELAYS_MINUTES = [1, 5, 15] as const;
/** Un `sending` más viejo que esto es un envío que se cortó (se reinició el proceso). */
export const STUCK_AFTER_MINUTES = 10;

export const ERRORS = {
  noPermission: 'Quien lo programó ya no tiene permiso para enviar desde esta casilla',
  needsReconnect: 'La casilla necesita reconectarse con Google',
  draftTrashed:
    'El borrador se eliminó desde Gmail (está en la Papelera), así que no se envió. ' +
    'Si querés mandarlo igual, editalo y se vuelve a programar.',
  draftMissing:
    'El borrador ya no existe en Gmail (¿se envió o se borró desde Gmail?). Revisá Enviados.',
  noDraft: 'No hay borrador para enviar',
  stuck: 'El envío se interrumpió y no se sabe si salió: revisá Enviados antes de reintentar',
} as const;

/** Lo que el job toma de cada fila. */
export interface ClaimedRow {
  id: string;
  mailbox_id: string;
  gmail_draft_id: string | null;
  /** Quién responde por el envío: el último que lo editó, o quien lo creó. */
  responsible: string | null;
  attempts: number;
}

/**
 * Job de envíos programados. Corre en el mismo proceso de la API, una vez por
 * minuto: no hace falta que nadie tenga la sesión abierta.
 *
 * Cada vuelta:
 * 1. Marca `failed` los que quedaron `sending` de un proceso que se cortó (no se
 *    reenvían solos: Gmail pudo haberlos mandado).
 * 2. Toma hasta 20 vencidos con `FOR UPDATE SKIP LOCKED` y los pasa a `sending`
 *    en la misma sentencia: dos instancias no pueden tomar el mismo.
 * 3. Envía cada borrador con `drafts.send`. Enviar un borrador es idempotente:
 *    si Gmail ya lo mandó, el borrador no existe más y el reintento falla en vez
 *    de duplicar el mail.
 */
@Injectable()
export class ScheduledSenderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledSenderService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly messages: MessagesService,
    private readonly google: GoogleMailboxClient,
    private readonly access: MailboxAccessService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<boolean>('SCHEDULED_SENDER_ENABLED') === false) {
      this.logger.log('Envíos programados desactivados (SCHEDULED_SENDER_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Que el timer no impida que el proceso termine.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Una vuelta del job. Si la anterior sigue corriendo, no hace nada. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.failStuck();
      const rows = await this.claimDue();
      for (const row of rows) await this.process(row);
    } catch (err) {
      this.logger.error(
        'Falló la vuelta de envíos programados',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.running = false;
    }
  }

  async failStuck(): Promise<void> {
    await this.dataSource.query(
      `UPDATE public.scheduled_messages
          SET status = 'failed', last_error = $1, sending_started_at = NULL,
              next_attempt_at = NULL, updated_at = now()
        WHERE status = 'sending'
          AND sending_started_at < now() - make_interval(mins => $2)`,
      [ERRORS.stuck, STUCK_AFTER_MINUTES],
    );
  }

  async claimDue(): Promise<ClaimedRow[]> {
    const result = await this.dataSource.query<QueryRows<ClaimedRow>>(
      `UPDATE public.scheduled_messages
          SET status = 'sending', sending_started_at = now(), attempts = attempts + 1,
              updated_at = now()
        WHERE id IN (
          SELECT id FROM public.scheduled_messages
           WHERE status = 'pending'
             AND next_attempt_at <= now()
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, mailbox_id, gmail_draft_id,
                  COALESCE(updated_by, created_by) AS responsible, attempts`,
      [BATCH_SIZE],
    );
    return rowsOf(result);
  }

  async process(row: ClaimedRow): Promise<void> {
    try {
      if (!row.gmail_draft_id) return await this.fail(row, ERRORS.noDraft);
      if (!(await this.responsibleCanSend(row))) return await this.fail(row, ERRORS.noPermission);

      const apis = await this.google.forMailbox(row.mailbox_id);
      // Un borrador "borrado" desde Gmail va a la Papelera y drafts.send lo
      // enviaría igual: si está ahí, la persona quiso cancelarlo.
      if (await this.messages.isDraftTrashed(apis, row.gmail_draft_id)) {
        return await this.fail(row, ERRORS.draftTrashed);
      }
      const sent = await this.messages.sendDraft(apis, row.gmail_draft_id);
      await this.dataSource.query(
        `UPDATE public.scheduled_messages
            SET status = 'sent', sent_at = now(), gmail_message_id = $2, gmail_thread_id = $3,
                gmail_draft_id = NULL, last_error = NULL, sending_started_at = NULL,
                next_attempt_at = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id, sent.messageId, sent.threadId],
      );
      this.logger.log(`Programado ${row.id} enviado (${sent.messageId})`);
    } catch (err) {
      if (err instanceof MailboxNeedsReconnectException) {
        return this.fail(row, ERRORS.needsReconnect);
      }
      if (err instanceof NotFoundException) return this.fail(row, ERRORS.draftMissing);

      const message = err instanceof Error ? err.message : String(err);
      const delay = RETRY_DELAYS_MINUTES[row.attempts - 1];
      if (delay === undefined) {
        return this.fail(row, `No se pudo enviar después de ${row.attempts} intentos: ${message}`);
      }
      this.logger.warn(`Programado ${row.id}: intento ${row.attempts} falló (${message})`);
      await this.dataSource.query(
        `UPDATE public.scheduled_messages
            SET status = 'pending', next_attempt_at = now() + make_interval(mins => $2),
                last_error = $3, sending_started_at = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id, delay, message],
      );
    }
  }

  /** El responsable sigue activo y con canSend en la casilla. */
  private async responsibleCanSend(row: ClaimedRow): Promise<boolean> {
    if (!row.responsible) return false;
    const profiles = await this.dataSource.query<{ status: string }[]>(
      `SELECT status FROM public.user_profiles WHERE id = $1`,
      [row.responsible],
    );
    if (profiles[0]?.status !== 'active') return false;
    return this.access.hasPermission(row.responsible, row.mailbox_id, 'send');
  }

  private async fail(row: ClaimedRow, reason: string): Promise<void> {
    this.logger.warn(`Programado ${row.id} falló: ${reason}`);
    await this.dataSource.query(
      `UPDATE public.scheduled_messages
          SET status = 'failed', last_error = $2, sending_started_at = NULL,
              next_attempt_at = NULL, updated_at = now()
        WHERE id = $1`,
      [row.id, reason],
    );
  }
}
