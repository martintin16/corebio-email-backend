import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { gmail_v1 } from 'googleapis';
import { DataSource, In, Repository } from 'typeorm';
import { type QueryRows, rowsOf } from '../common/query-rows';
import { GoogleMailboxClient, type MailboxGoogleApis } from '../google/google-mailbox-client';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import type { MailboxPermission } from '../mailboxes/mailboxes.types';
import { toOutgoingAttachments, type UploadedAttachment } from '../messages/attachments';
import { htmlToPlainText, sanitizeEmailHtml, toSnippet } from '../messages/content/html-content';
import {
  isTrashed,
  MessagesService,
  type ReplyContext,
  toAttachmentInfos,
} from '../messages/messages.service';
import type { AttachmentInfo, DownloadedAttachment } from '../messages/messages.types';
import type { CreateScheduledMessageDto } from './dto/create-scheduled-message.dto';
import type { UpdateScheduledMessageDto } from './dto/update-scheduled-message.dto';
import { ScheduledMessage } from './entities/scheduled-message.entity';
import type { ScheduledMessageView } from './scheduled-messages.types';

/** Lo más cerca que se puede programar (el job corre una vez por minuto). */
export const MIN_LEAD_MS = 60_000;
/** Lo más lejos que se puede programar. */
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
/** Cuánto dura la reserva de una fila mientras se edita o cancela (el job no la toma). */
export const EDIT_LOCK_SECONDS = 120;

const NOT_FOUND = 'El envío programado no existe';
const NOT_EDITABLE = 'Ya se envió o se está enviando: no se puede modificar';
const BUSY = 'El envío programado se está enviando o modificando en este momento';

type GmailMessage = gmail_v1.Schema$Message;

/**
 * Envíos programados: alta, edición, cancelación y consulta.
 *
 * El mensaje completo (con adjuntos) se guarda como BORRADOR en la casilla de
 * Gmail; la tabla tiene lo necesario para listarlo y para que el job
 * (ScheduledSenderService) envíe ese borrador a horario.
 */
@Injectable()
export class ScheduledMessagesService {
  private readonly logger = new Logger(ScheduledMessagesService.name);

  constructor(
    @InjectRepository(ScheduledMessage) private readonly repo: Repository<ScheduledMessage>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly messages: MessagesService,
    private readonly google: GoogleMailboxClient,
    private readonly access: MailboxAccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------------

  /** Pendientes, enviándose y con error de la casilla (los enviados están en Enviados). */
  async listForMailbox(mailboxId: string): Promise<ScheduledMessageView[]> {
    const rows = await this.repo.find({
      where: { mailboxId, status: In(['pending', 'sending', 'failed']) },
      order: { scheduledAt: 'ASC' },
    });
    return rows.map(toView);
  }

  async findForUser(userId: string, id: string): Promise<ScheduledMessageView> {
    const row = await this.findVisible(userId, id);
    await this.assertPermission(userId, row.mailboxId, 'read');
    return toView(row);
  }

  async getAttachment(
    userId: string,
    id: string,
    attachmentId: string,
  ): Promise<DownloadedAttachment> {
    const row = await this.findVisible(userId, id);
    await this.assertPermission(userId, row.mailboxId, 'read');
    if (!row.gmailDraftId) throw new NotFoundException('El adjunto no existe');
    const apis = await this.google.forMailbox(row.mailboxId);
    const draft = await this.messages.getDraftMessage(apis, row.gmailDraftId);
    return this.messages.downloadAttachment(apis, draft, attachmentId);
  }

  // ---------------------------------------------------------------------------
  // Alta
  // ---------------------------------------------------------------------------

  async create(
    userId: string,
    dto: CreateScheduledMessageDto,
    files?: UploadedAttachment[],
  ): Promise<ScheduledMessageView> {
    const scheduledAt = parseScheduledAt(dto.scheduledAt);
    const forwarded = dto.forwardedAttachments ?? [];
    await this.assertPermission(userId, dto.mailboxId, 'send');
    if (forwarded.length > 0) await this.assertCanForward(userId, dto.mailboxId);
    toOutgoingAttachments(files);

    const apis = await this.google.forMailbox(dto.mailboxId);
    const reply = dto.replyToMessageId
      ? await this.messages.resolveReply(apis, dto.replyToMessageId)
      : undefined;
    const to = reply?.to ?? dto.to ?? '';
    const subject = reply?.subject ?? dto.subject ?? '';
    const html = sanitizeEmailHtml(dto.body);

    const attachments = await this.messages.collectAttachments(apis, { files, forwarded });
    const raw = await this.messages.composeRaw(apis, { to, subject, html, attachments, reply });
    const draftId = await this.messages.createDraft(apis, raw, reply?.threadId);

    const row = this.repo.create({
      mailboxId: dto.mailboxId,
      createdBy: userId,
      updatedBy: userId,
      to,
      subject,
      body: html,
      attachments: await this.draftAttachments(apis, draftId, attachments.length),
      scheduledAt,
      nextAttemptAt: scheduledAt,
      status: 'pending',
      attempts: 0,
      gmailDraftId: draftId,
      replyToMessageId: dto.replyToMessageId ?? null,
      replyThreadId: reply?.threadId ?? null,
      replyInReplyTo: reply?.inReplyTo ?? null,
      replyReferences: reply?.references ?? null,
    });
    try {
      return toView(await this.repo.save(row));
    } catch (err) {
      // Que no quede un borrador huérfano en la casilla.
      await this.safeDeleteDraft(apis, draftId);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Edición
  // ---------------------------------------------------------------------------

  async update(
    userId: string,
    id: string,
    dto: UpdateScheduledMessageDto,
    files?: UploadedAttachment[],
  ): Promise<ScheduledMessageView> {
    const row = await this.findVisible(userId, id);
    await this.assertPermission(userId, row.mailboxId, 'send');
    const targetMailboxId = dto.mailboxId ?? row.mailboxId;
    const moving = targetMailboxId !== row.mailboxId;
    if (moving) {
      await this.assertPermission(userId, targetMailboxId, 'send');
      if (row.replyToMessageId) {
        throw new BadRequestException('Una respuesta programada no puede cambiar de casilla');
      }
    }
    if (row.status !== 'pending' && row.status !== 'failed') {
      throw new ConflictException(NOT_EDITABLE);
    }
    const forwarded = dto.forwardedAttachments ?? [];
    if (forwarded.length > 0) await this.assertCanForward(userId, targetMailboxId);
    const scheduledAt = dto.scheduledAt ? parseScheduledAt(dto.scheduledAt) : row.scheduledAt;
    toOutgoingAttachments(files);

    await this.lock(id);
    try {
      const sourceApis = await this.google.forMailbox(row.mailboxId);
      const targetApis = moving ? await this.google.forMailbox(targetMailboxId) : sourceApis;

      const draft = await this.currentDraft(sourceApis, row);
      const keepIds = dto.keepAttachmentIds ?? row.attachments.map((a) => a.id);
      if (!draft && keepIds.length > 0) {
        throw new BadRequestException(
          'Los adjuntos anteriores ya no están disponibles en Gmail: volvé a adjuntarlos',
        );
      }

      const reply = replyContextOf(row);
      const to = reply?.to ?? dto.to ?? row.to;
      const subject = reply?.subject ?? dto.subject ?? row.subject;
      const html = dto.body !== undefined ? sanitizeEmailHtml(dto.body) : row.body;

      const attachments = await this.messages.collectAttachments(targetApis, {
        files,
        forwarded,
        kept: draft ? { apis: sourceApis, message: draft, partIds: keepIds } : undefined,
      });
      const raw = await this.messages.composeRaw(targetApis, {
        to,
        subject,
        html,
        attachments,
        reply,
      });

      // Un borrador en la Papelera (se "borró" desde Gmail) no se reutiliza:
      // editarlo es decir "mandalo igual", así que va uno nuevo fuera de la
      // Papelera (con los adjuntos copiados del viejo) y el viejo se elimina.
      const trashed = isTrashed(draft ?? undefined);
      let draftId: string;
      if (!moving && draft && !trashed && row.gmailDraftId) {
        draftId = row.gmailDraftId;
        await this.messages.updateDraft(targetApis, draftId, raw, reply?.threadId);
      } else {
        draftId = await this.messages.createDraft(targetApis, raw, reply?.threadId);
        if (row.gmailDraftId && draft) await this.safeDeleteDraft(sourceApis, row.gmailDraftId);
      }

      Object.assign(row, {
        mailboxId: targetMailboxId,
        updatedBy: userId,
        to,
        subject,
        body: html,
        attachments: await this.draftAttachments(targetApis, draftId, attachments.length),
        scheduledAt,
        // Uno vencido (un `failed` que no cambió de fecha) sale en la próxima vuelta del job.
        nextAttemptAt: scheduledAt,
        status: 'pending',
        attempts: 0,
        lastError: null,
        sendingStartedAt: null,
        lockedUntil: null,
        gmailDraftId: draftId,
      } satisfies Partial<ScheduledMessage>);
      return toView(await this.repo.save(row));
    } finally {
      await this.unlock(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Cancelación
  // ---------------------------------------------------------------------------

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.findVisible(userId, id);
    await this.assertPermission(userId, row.mailboxId, 'send');

    // Condicional: si el job lo tomó (o alguien lo está editando) no se borra.
    const deleted = rowsOf(
      await this.dataSource.query<QueryRows<{ gmail_draft_id: string | null }>>(
        `DELETE FROM public.scheduled_messages
          WHERE id = $1
            AND status IN ('pending', 'failed')
            AND (locked_until IS NULL OR locked_until < now())
          RETURNING gmail_draft_id`,
        [id],
      ),
    );
    if (deleted.length === 0) {
      throw new ConflictException(
        row.status === 'sending' || row.status === 'sent' ? NOT_EDITABLE : BUSY,
      );
    }

    const draftId = deleted[0].gmail_draft_id;
    if (!draftId) return;
    try {
      const apis = await this.google.forMailbox(row.mailboxId);
      await this.messages.deleteDraft(apis, draftId);
    } catch (err) {
      // El programado ya está cancelado; un borrador que no se pudo borrar no lo envía nadie.
      this.logger.warn(
        `No se pudo borrar el borrador ${draftId} del programado ${id}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * La fila, si la persona tiene algún permiso sobre su casilla. Si no, 404:
   * no se revela que existe un programado en una casilla ajena.
   */
  private async findVisible(userId: string, id: string): Promise<ScheduledMessage> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(NOT_FOUND);
    const [canRead, canSend] = await Promise.all([
      this.access.hasPermission(userId, row.mailboxId, 'read'),
      this.access.hasPermission(userId, row.mailboxId, 'send'),
    ]);
    if (!canRead && !canSend) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async assertPermission(
    userId: string,
    mailboxId: string,
    permission: MailboxPermission,
  ): Promise<void> {
    if (!(await this.access.hasPermission(userId, mailboxId, permission))) {
      throw new ForbiddenException(
        permission === 'read'
          ? 'No tenés permiso para leer esta casilla'
          : 'No tenés permiso para enviar desde esta casilla',
      );
    }
  }

  private async assertCanForward(userId: string, mailboxId: string): Promise<void> {
    if (!(await this.access.hasPermission(userId, mailboxId, 'read'))) {
      throw new ForbiddenException(
        'Para reenviar adjuntos necesitás también permiso de lectura en la casilla',
      );
    }
  }

  /** Reserva la fila para editarla: el job no la toma mientras tanto. */
  private async lock(id: string): Promise<void> {
    const locked = await this.dataSource.query<QueryRows<{ id: string }>>(
      `UPDATE public.scheduled_messages
          SET locked_until = now() + make_interval(secs => $2)
        WHERE id = $1
          AND status IN ('pending', 'failed')
          AND (locked_until IS NULL OR locked_until < now())
        RETURNING id`,
      [id, EDIT_LOCK_SECONDS],
    );
    if (rowsOf(locked).length === 0) throw new ConflictException(BUSY);
  }

  private async unlock(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE public.scheduled_messages SET locked_until = NULL WHERE id = $1`,
      [id],
    );
  }

  /** El mensaje del borrador actual, o null si ya no existe en Gmail. */
  private async currentDraft(
    apis: MailboxGoogleApis,
    row: ScheduledMessage,
  ): Promise<GmailMessage | null> {
    if (!row.gmailDraftId) return null;
    try {
      return await this.messages.getDraftMessage(apis, row.gmailDraftId);
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  /**
   * Los adjuntos tal como quedaron en el borrador (con sus ids de Gmail). Si
   * leerlo falla, se deducen: el armado MIME pone el cuerpo primero y los
   * adjuntos después, así que Gmail los numera "1", "2", …
   */
  private async draftAttachments(
    apis: MailboxGoogleApis,
    draftId: string,
    count: number,
  ): Promise<AttachmentInfo[]> {
    if (count === 0) return [];
    try {
      return toAttachmentInfos(await this.messages.getDraftMessage(apis, draftId));
    } catch (err) {
      this.logger.warn(
        `No se pudieron leer los adjuntos del borrador ${draftId}`,
        err instanceof Error ? err.message : String(err),
      );
      return Array.from({ length: count }, (_, i) => ({
        id: String(i + 1),
        filename: `adjunto-${i + 1}`,
        mimeType: 'application/octet-stream',
        size: 0,
      }));
    }
  }

  private async safeDeleteDraft(apis: MailboxGoogleApis, draftId: string): Promise<void> {
    try {
      await this.messages.deleteDraft(apis, draftId);
    } catch (err) {
      this.logger.warn(
        `No se pudo borrar el borrador ${draftId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

// -----------------------------------------------------------------------------

/** Valida que la fecha esté entre 1 minuto y 1 año desde ahora. */
export function parseScheduledAt(value: string, now = Date.now()): Date {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) throw new BadRequestException('scheduledAt inválido');
  if (time < now + MIN_LEAD_MS) {
    throw new BadRequestException('La fecha tiene que ser al menos 1 minuto en el futuro');
  }
  if (time > now + MAX_LEAD_MS) {
    throw new BadRequestException('No se puede programar a más de 1 año');
  }
  return date;
}

function replyContextOf(row: ScheduledMessage): ReplyContext | undefined {
  if (!row.replyToMessageId) return undefined;
  return {
    to: row.to,
    subject: row.subject,
    threadId: row.replyThreadId ?? undefined,
    inReplyTo: row.replyInReplyTo ?? undefined,
    references: row.replyReferences ?? undefined,
  };
}

export function toView(row: ScheduledMessage): ScheduledMessageView {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    to: row.to,
    subject: row.subject,
    bodyPreview: toSnippet(htmlToPlainText(row.body)),
    body: row.body,
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status,
    lastError: row.lastError,
    attachments: row.attachments ?? [],
    replyToMessageId: row.replyToMessageId,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  };
}
