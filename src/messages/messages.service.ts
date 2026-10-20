import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { gmail_v1 } from 'googleapis';
import { Readable } from 'stream';
import { mapWithConcurrency } from '../common/concurrency';
import { GoogleMailboxClient, type MailboxGoogleApis } from '../google/google-mailbox-client';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import {
  assertAttachmentLimits,
  toOutgoingAttachments,
  type UploadedAttachment,
} from './attachments';
import {
  htmlToPlainText,
  plainTextToHtml,
  sanitizeEmailHtml,
  toSnippet,
} from './content/html-content';
import type { ReplyMessageDto } from './dto/reply-message.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import {
  type AttachmentPart,
  decodeEntities,
  extractBodies,
  getHeader,
  hasLabel,
  listAttachmentParts,
  messageDateIso,
  parseAddress,
  replySubject,
} from './gmail/gmail-message';
import { buildRawMessage, type OutgoingAttachment } from './gmail/mime';
import { joinRecipients, recipientCount, resolveRecipients } from './recipients';
import {
  isGmailSendingLimitError,
  RecipientLimitExceededException,
  SendQuotaService,
} from './send-quota.service';
import type {
  AttachmentInfo,
  DownloadedAttachment,
  ForwardedAttachmentRef,
  MessageDetail,
  MessageSummary,
  SentMessageDetail,
  SentMessageSummary,
} from './messages.types';

type GmailMessage = gmail_v1.Schema$Message;

/** Datos del mensaje original para responder en su hilo. */
export interface ReplyContext {
  /** Reply-To (o From) del original, tal cual: `Nombre <email>`. */
  to: string;
  subject: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

/** Lo que hace falta para armar un mensaje saliente (envío directo o borrador). */
export interface ComposeInput {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** HTML ya sanitizado. */
  html: string;
  attachments: OutgoingAttachment[];
  reply?: ReplyContext;
}

/** De dónde salen los adjuntos de un mensaje saliente. */
export interface AttachmentSources {
  /** Subidos en este pedido (multipart). */
  files?: UploadedAttachment[];
  /** De otros mensajes de la misma casilla ("Reenviar"). */
  forwarded?: ForwardedAttachmentRef[];
  /** Los que se conservan de un borrador existente (editar un programado). */
  kept?: { apis: MailboxGoogleApis; message: GmailMessage; partIds: string[] };
}

const NOT_FOUND_MESSAGE = 'El mensaje no existe';
const FORWARDED_NOT_FOUND = 'Un adjunto reenviado no existe en esta casilla';
const KEPT_NOT_FOUND = 'Uno de los adjuntos a conservar ya no existe';
export const DRAFT_NOT_FOUND = 'El borrador ya no existe en Gmail';

/** Cuántos mensajes trae cada listado (el contrato del frontend no pagina). */
export const LIST_LIMIT = 25;
/** Pedidos de detalle en paralelo a Gmail (cuota por segundo de la API). */
const GMAIL_CONCURRENCY = 5;

export function isGmailNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };
  const status = Number(e.response?.status ?? e.status ?? e.code);
  return (
    status === 404 ||
    (status === 400 && typeof e.message === 'string' && /invalid id value/i.test(e.message))
  );
}

/**
 * Recibidos, Enviados, Redactar y Responder, contra la Gmail API de cada casilla.
 * No hay tabla propia: Gmail es la fuente de verdad. Los permisos (canRead /
 * canSend) los chequea `@RequireMailboxAccess` antes de llegar acá.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly google: GoogleMailboxClient,
    private readonly access: MailboxAccessService,
    private readonly quota: SendQuotaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Recibidos
  // ---------------------------------------------------------------------------

  async listInbox(mailboxId: string): Promise<MessageSummary[]> {
    const apis = await this.google.forMailbox(mailboxId);
    const messages = await this.listByLabel(apis, 'INBOX', ['From', 'Subject', 'Date']);
    return messages.map(toMessageSummary);
  }

  /** Detalle de un recibido. Lo marca como leído, igual que Gmail al abrirlo. */
  async getInboxMessage(mailboxId: string, messageId: string): Promise<MessageDetail> {
    const apis = await this.google.forMailbox(mailboxId);
    const message = await this.getFull(apis, messageId);

    let unread = hasLabel(message, 'UNREAD');
    if (unread) {
      try {
        await apis.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        unread = false;
      } catch (err) {
        // Que no se pueda marcar como leído no impide leerlo.
        this.logger.warn(
          `No se pudo marcar como leído ${messageId}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return { ...toMessageDetail(message), unread };
  }

  // ---------------------------------------------------------------------------
  // Enviados
  // ---------------------------------------------------------------------------

  async listSent(mailboxId: string): Promise<SentMessageSummary[]> {
    const apis = await this.google.forMailbox(mailboxId);
    const messages = await this.listByLabel(apis, 'SENT', ['To', 'Subject', 'Date']);
    return messages.map(toSentSummary);
  }

  async getSentMessage(mailboxId: string, sentId: string): Promise<SentMessageDetail> {
    const apis = await this.google.forMailbox(mailboxId);
    const message = await this.getFull(apis, sentId);
    if (!hasLabel(message, 'SENT')) throw new NotFoundException('El mensaje no existe');
    return toSentDetail(message, mailboxId);
  }

  /**
   * GET /sent/:sentId (para "Reenviar"): el frontend tiene solo el id, no la
   * casilla. Se busca en las casillas que la persona puede leer, de a una.
   */
  async findSentForUser(userId: string, sentId: string): Promise<SentMessageDetail> {
    const summaries = (await this.access.findSummariesByUser([userId])).get(userId) ?? [];
    for (const { mailboxId, canRead } of summaries) {
      if (!canRead) continue;
      try {
        return await this.getSentMessage(mailboxId, sentId);
      } catch (err) {
        // No está en esta casilla (404) o la casilla no está conectada (409): seguir.
        if (err instanceof NotFoundException || err instanceof ConflictException) continue;
        throw err;
      }
    }
    throw new NotFoundException('El mensaje no existe');
  }

  // ---------------------------------------------------------------------------
  // Redactar y Responder
  // ---------------------------------------------------------------------------

  /**
   * Redactar. `userId` hace falta solo para reenviar adjuntos: bajarlos de la
   * casilla es leerla, así que además de canSend (lo chequea el guard) pide canRead.
   */
  async send(
    mailboxId: string,
    dto: SendMessageDto,
    files?: UploadedAttachment[],
    userId?: string,
  ): Promise<SentMessageSummary> {
    if (dto.mailboxId && dto.mailboxId !== mailboxId) {
      throw new BadRequestException('mailboxId no coincide con la casilla de la ruta');
    }
    const forwarded = dto.forwardedAttachments ?? [];
    // Primero lo que se puede rechazar sin hablar con Google.
    const recipients = resolveRecipients(dto);
    const count = recipientCount(recipients);
    toOutgoingAttachments(files);
    assertAttachmentLimits((files?.length ?? 0) + forwarded.length, 0);
    if (forwarded.length > 0) await this.assertCanRead(userId, mailboxId);
    await this.quota.assertAvailable(mailboxId, count);

    const apis = await this.google.forMailbox(mailboxId);
    const html = sanitizeEmailHtml(dto.body);
    const attachments = await this.collectAttachments(apis, { files, forwarded });
    const raw = await this.composeRaw(apis, {
      ...recipients,
      subject: dto.subject,
      html,
      attachments,
    });
    const sent = await this.sendRaw(apis, raw, undefined, count);
    await this.quota.record(mailboxId, count, 'compose');

    return {
      id: sent.id ?? '',
      to: joinRecipients(recipients.to.length > 0 ? recipients.to : recipients.cc),
      subject: dto.subject,
      snippet: toSnippet(htmlToPlainText(html)),
      sentAt: new Date().toISOString(),
    };
  }

  /**
   * Responde en el mismo hilo de Gmail: a `Reply-To` (o `From`) del original,
   * con "Re: " en el asunto e `In-Reply-To` / `References` para que se agrupe.
   */
  async reply(
    mailboxId: string,
    messageId: string,
    dto: ReplyMessageDto,
    files?: UploadedAttachment[],
  ): Promise<SentMessageSummary> {
    const attachments = toOutgoingAttachments(files);
    await this.quota.assertAvailable(mailboxId, 1);
    const apis = await this.google.forMailbox(mailboxId);
    const reply = await this.resolveReply(apis, messageId);
    const html = sanitizeEmailHtml(dto.body);
    const raw = await this.composeRaw(apis, {
      to: reply.to,
      subject: reply.subject,
      html,
      attachments,
      reply,
    });
    const sent = await this.sendRaw(apis, raw, reply.threadId, 1);
    await this.quota.record(mailboxId, 1, 'reply');

    return {
      id: sent.id ?? '',
      to: parseAddress(reply.to).email,
      subject: reply.subject,
      snippet: toSnippet(htmlToPlainText(html)),
      sentAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Adjuntos
  // ---------------------------------------------------------------------------

  /** GET …/messages/:messageId/attachments/:attachmentId (recibidos y enviados). */
  async getAttachment(
    mailboxId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedAttachment> {
    const apis = await this.google.forMailbox(mailboxId);
    const message = await this.getFull(apis, messageId);
    return this.downloadAttachment(apis, message, attachmentId);
  }

  /** Baja un adjunto de un mensaje ya leído (de la casilla de `apis`). 404 si no está. */
  async downloadAttachment(
    apis: MailboxGoogleApis,
    message: GmailMessage,
    attachmentId: string,
  ): Promise<DownloadedAttachment> {
    const part = listAttachmentParts(message.payload ?? undefined).find(
      (p) => p.partId === attachmentId,
    );
    if (!part) throw new NotFoundException('El adjunto no existe');
    return {
      filename: part.filename,
      mimeType: part.mimeType,
      content: await this.partContent(apis, message.id ?? '', part),
    };
  }

  /**
   * Junta los adjuntos de un mensaje saliente: los que se conservan de un
   * borrador, los reenviados y los subidos, en ese orden. Valida los límites
   * con los tamaños que informa Gmail ANTES de bajar nada.
   */
  async collectAttachments(
    apis: MailboxGoogleApis,
    sources: AttachmentSources,
  ): Promise<OutgoingAttachment[]> {
    const uploaded = toOutgoingAttachments(sources.files);

    const kept: { apis: MailboxGoogleApis; messageId: string; part: AttachmentPart }[] = [];
    if (sources.kept) {
      const { message } = sources.kept;
      const parts = listAttachmentParts(message.payload ?? undefined);
      for (const id of new Set(sources.kept.partIds)) {
        const part = parts.find((p) => p.partId === id);
        if (!part) throw new BadRequestException(KEPT_NOT_FOUND);
        kept.push({ apis: sources.kept.apis, messageId: message.id ?? '', part });
      }
    }

    const forwarded: { apis: MailboxGoogleApis; messageId: string; part: AttachmentPart }[] = [];
    const refs = dedupeRefs(sources.forwarded ?? []);
    const byMessage = new Map<string, string[]>();
    for (const ref of refs) {
      byMessage.set(ref.messageId, [...(byMessage.get(ref.messageId) ?? []), ref.attachmentId]);
    }
    for (const [messageId, partIds] of byMessage) {
      let message: GmailMessage;
      try {
        message = await this.getFull(apis, messageId);
      } catch (err) {
        if (err instanceof NotFoundException) throw new BadRequestException(FORWARDED_NOT_FOUND);
        throw err;
      }
      const parts = listAttachmentParts(message.payload ?? undefined);
      for (const id of partIds) {
        const part = parts.find((p) => p.partId === id);
        if (!part) throw new BadRequestException(FORWARDED_NOT_FOUND);
        forwarded.push({ apis, messageId, part });
      }
    }

    const fromGmail = [...kept, ...forwarded];
    assertAttachmentLimits(
      uploaded.length + fromGmail.length,
      uploaded.reduce((sum, a) => sum + a.content.length, 0) +
        fromGmail.reduce((sum, a) => sum + a.part.size, 0),
    );

    const downloaded = await mapWithConcurrency(fromGmail, GMAIL_CONCURRENCY, async (a) => ({
      filename: a.part.filename,
      contentType: a.part.mimeType,
      content: await this.partContent(a.apis, a.messageId, a.part),
    }));
    return [...downloaded, ...uploaded];
  }

  // ---------------------------------------------------------------------------
  // Piezas para envíos programados (Fase 5)
  // ---------------------------------------------------------------------------

  /** Destinatario, asunto y encabezados de hilo para responder a `messageId`. */
  async resolveReply(apis: MailboxGoogleApis, messageId: string): Promise<ReplyContext> {
    const original = await this.call(apis.mailboxId, async () => {
      const { data } = await apis.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Reply-To', 'Subject', 'Message-ID', 'References'],
      });
      return data;
    });

    const to = getHeader(original, 'Reply-To') || getHeader(original, 'From');
    if (!to) throw new BadRequestException('El mensaje original no tiene remitente');
    const originalId = getHeader(original, 'Message-ID');
    const references = [getHeader(original, 'References'), originalId].filter(Boolean).join(' ');
    return {
      to,
      subject: replySubject(getHeader(original, 'Subject')),
      threadId: original.threadId ?? undefined,
      inReplyTo: originalId || undefined,
      references: references || undefined,
    };
  }

  /** Arma el RFC 822 con la casilla como remitente. */
  composeRaw(apis: MailboxGoogleApis, input: ComposeInput): Promise<Buffer> {
    return buildRawMessage({
      from: { name: apis.displayName, address: apis.email },
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      html: input.html,
      text: htmlToPlainText(input.html),
      inReplyTo: input.reply?.inReplyTo,
      references: input.reply?.references,
      attachments: input.attachments,
    });
  }

  /** Crea un borrador en la casilla. Devuelve el id del borrador. */
  async createDraft(apis: MailboxGoogleApis, raw: Buffer, threadId?: string): Promise<string> {
    const draft = await this.call(apis.mailboxId, async () => {
      const { data } = await apis.gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: threadId ? { threadId } : {} },
        media: { mimeType: 'message/rfc822', body: Readable.from([raw]) },
      });
      return data;
    });
    if (!draft.id) throw new Error('Gmail no devolvió el id del borrador');
    return draft.id;
  }

  /** Reemplaza el contenido de un borrador. 404 si ya no existe. */
  async updateDraft(
    apis: MailboxGoogleApis,
    draftId: string,
    raw: Buffer,
    threadId?: string,
  ): Promise<void> {
    await this.call(
      apis.mailboxId,
      () =>
        apis.gmail.users.drafts.update({
          userId: 'me',
          id: draftId,
          requestBody: { id: draftId, message: threadId ? { threadId } : {} },
          media: { mimeType: 'message/rfc822', body: Readable.from([raw]) },
        }),
      DRAFT_NOT_FOUND,
    );
  }

  /** El mensaje completo de un borrador (para ver y bajar sus adjuntos). 404 si no existe. */
  async getDraftMessage(apis: MailboxGoogleApis, draftId: string): Promise<GmailMessage> {
    const draft = await this.call(
      apis.mailboxId,
      async () => {
        const { data } = await apis.gmail.users.drafts.get({
          userId: 'me',
          id: draftId,
          format: 'full',
        });
        return data;
      },
      DRAFT_NOT_FOUND,
    );
    if (!draft.message) throw new NotFoundException(DRAFT_NOT_FOUND);
    return draft.message;
  }

  /**
   * Si el borrador está en la Papelera. Borrarlo con el tachito desde Gmail no
   * lo elimina: va a la Papelera, sigue existiendo para la API y `drafts.send`
   * lo enviaría igual. 404 si ya no existe (se eliminó para siempre o se envió).
   */
  async isDraftTrashed(apis: MailboxGoogleApis, draftId: string): Promise<boolean> {
    const draft = await this.call(
      apis.mailboxId,
      async () => {
        const { data } = await apis.gmail.users.drafts.get({
          userId: 'me',
          id: draftId,
          format: 'minimal',
        });
        return data;
      },
      DRAFT_NOT_FOUND,
    );
    return isTrashed(draft.message ?? undefined);
  }

  /** Envía un borrador. 404 si ya no existe (alguien lo envió o borró desde Gmail). */
  async sendDraft(
    apis: MailboxGoogleApis,
    draftId: string,
    recipients = 0,
  ): Promise<{ messageId: string; threadId: string | null }> {
    const sent = await this.call(
      apis.mailboxId,
      async () => {
        try {
          const { data } = await apis.gmail.users.drafts.send({
            userId: 'me',
            requestBody: { id: draftId },
          });
          return data;
        } catch (err) {
          throw this.sendingLimitOr(err, recipients);
        }
      },
      DRAFT_NOT_FOUND,
    );
    return { messageId: sent.id ?? '', threadId: sent.threadId ?? null };
  }

  /** Borra un borrador. Si ya no existe, no hace nada. */
  async deleteDraft(apis: MailboxGoogleApis, draftId: string): Promise<void> {
    try {
      await this.call(
        apis.mailboxId,
        () => apis.gmail.users.drafts.delete({ userId: 'me', id: draftId }),
        DRAFT_NOT_FOUND,
      );
    } catch (err) {
      if (err instanceof NotFoundException) return;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------

  private listByLabel(
    apis: MailboxGoogleApis,
    label: 'INBOX' | 'SENT',
    headers: string[],
  ): Promise<GmailMessage[]> {
    return this.call(apis.mailboxId, async () => {
      const { data } = await apis.gmail.users.messages.list({
        userId: 'me',
        labelIds: [label],
        maxResults: LIST_LIMIT,
      });
      const ids = (data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
      return mapWithConcurrency(ids, GMAIL_CONCURRENCY, async (id) => {
        const res = await apis.gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: headers,
        });
        return res.data;
      });
    });
  }

  private getFull(apis: MailboxGoogleApis, id: string): Promise<GmailMessage> {
    return this.call(apis.mailboxId, async () => {
      const { data } = await apis.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      return data;
    });
  }

  /**
   * Envía el mensaje ya armado como subida `message/rfc822` (admite hasta 35 MB,
   * a diferencia del campo `raw` en JSON).
   */
  private sendRaw(
    apis: MailboxGoogleApis,
    raw: Buffer,
    threadId: string | undefined,
    recipients: number,
  ): Promise<GmailMessage> {
    return this.call(apis.mailboxId, async () => {
      try {
        const { data } = await apis.gmail.users.messages.send({
          userId: 'me',
          requestBody: threadId ? { threadId } : {},
          media: { mimeType: 'message/rfc822', body: Readable.from([raw]) },
        });
        return data;
      } catch (err) {
        throw this.sendingLimitOr(err, recipients);
      }
    });
  }

  /** Si Gmail rechazó por su cupo de envío, el mismo 429 que el cupo de la app. */
  private sendingLimitOr(err: unknown, recipients: number): unknown {
    return isGmailSendingLimitError(err)
      ? new RecipientLimitExceededException(this.quota.limit, 0, recipients)
      : err;
  }

  /** Contenido de un adjunto: viene en la parte o se pide aparte a Gmail. */
  private async partContent(
    apis: MailboxGoogleApis,
    messageId: string,
    part: AttachmentPart,
  ): Promise<Buffer> {
    if (part.data !== null) return Buffer.from(part.data, 'base64url');
    if (part.attachmentId === null) return Buffer.alloc(0);
    const attachmentId = part.attachmentId;
    const body = await this.call(
      apis.mailboxId,
      async () => {
        const { data } = await apis.gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: attachmentId,
        });
        return data;
      },
      'El adjunto no existe',
    );
    return Buffer.from(body.data ?? '', 'base64url');
  }

  private async assertCanRead(userId: string | undefined, mailboxId: string): Promise<void> {
    if (!userId || !(await this.access.hasPermission(userId, mailboxId, 'read'))) {
      throw new ForbiddenException(
        'Para reenviar adjuntos necesitás también permiso de lectura en la casilla',
      );
    }
  }

  /** Traduce los errores de Gmail: 404 → NotFound; el resto lo resuelve GoogleMailboxClient. */
  private async call<T>(
    mailboxId: string,
    fn: () => Promise<T>,
    notFoundMessage = NOT_FOUND_MESSAGE,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RecipientLimitExceededException) throw err;
      if (isGmailNotFound(err)) throw new NotFoundException(notFoundMessage);
      return this.google.handleGoogleError(mailboxId, err);
    }
  }
}

/** Si el mensaje (o borrador) está en la Papelera de Gmail. */
export function isTrashed(message: GmailMessage | undefined): boolean {
  return (message?.labelIds ?? []).includes('TRASH');
}

function dedupeRefs(refs: ForwardedAttachmentRef[]): ForwardedAttachmentRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.messageId}/${r.attachmentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// -----------------------------------------------------------------------------
// Gmail → tipos del frontend
// -----------------------------------------------------------------------------

function subjectOf(message: GmailMessage): string {
  return getHeader(message, 'Subject') || '(sin asunto)';
}

export function toMessageSummary(message: GmailMessage): MessageSummary {
  return {
    id: message.id ?? '',
    from: parseAddress(getHeader(message, 'From')),
    subject: subjectOf(message),
    snippet: decodeEntities(message.snippet ?? ''),
    receivedAt: messageDateIso(message),
    unread: hasLabel(message, 'UNREAD'),
  };
}

/** El cuerpo va en texto plano: el frontend lo muestra como texto. */
export function toMessageDetail(message: GmailMessage): MessageDetail {
  const { html, text } = extractBodies(message.payload ?? undefined);
  return {
    ...toMessageSummary(message),
    body: text?.trim() || (html ? htmlToPlainText(sanitizeEmailHtml(html)) : ''),
    to: getHeader(message, 'To'),
    attachments: toAttachmentInfos(message),
  };
}

export function toSentSummary(message: GmailMessage): SentMessageSummary {
  return {
    id: message.id ?? '',
    to: getHeader(message, 'To'),
    subject: subjectOf(message),
    snippet: decodeEntities(message.snippet ?? ''),
    sentAt: messageDateIso(message),
  };
}

/** El cuerpo va en HTML sanitizado: el frontend lo renderiza como HTML. */
export function toSentDetail(message: GmailMessage, mailboxId: string): SentMessageDetail {
  const { html, text } = extractBodies(message.payload ?? undefined);
  return {
    ...toSentSummary(message),
    mailboxId,
    body: sanitizeEmailHtml(html ?? plainTextToHtml(text ?? '')),
    attachments: toAttachmentInfos(message),
  };
}

export function toAttachmentInfos(message: GmailMessage): AttachmentInfo[] {
  return listAttachmentParts(message.payload ?? undefined).map((p) => ({
    id: p.partId,
    filename: p.filename,
    mimeType: p.mimeType,
    size: p.size,
  }));
}
