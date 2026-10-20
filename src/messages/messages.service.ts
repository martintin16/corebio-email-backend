import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { gmail_v1 } from 'googleapis';
import { Readable } from 'stream';
import { mapWithConcurrency } from '../common/concurrency';
import { GoogleMailboxClient, type MailboxGoogleApis } from '../google/google-mailbox-client';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { toOutgoingAttachments, type UploadedAttachment } from './attachments';
import {
  htmlToPlainText,
  plainTextToHtml,
  sanitizeEmailHtml,
  toSnippet,
} from './content/html-content';
import type { ReplyMessageDto } from './dto/reply-message.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import {
  decodeEntities,
  extractBodies,
  getHeader,
  hasLabel,
  messageDateIso,
  parseAddress,
  replySubject,
} from './gmail/gmail-message';
import { buildRawMessage } from './gmail/mime';
import type {
  MessageDetail,
  MessageSummary,
  SentMessageDetail,
  SentMessageSummary,
} from './messages.types';

type GmailMessage = gmail_v1.Schema$Message;

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

  async send(
    mailboxId: string,
    dto: SendMessageDto,
    files?: UploadedAttachment[],
  ): Promise<SentMessageSummary> {
    if (dto.mailboxId && dto.mailboxId !== mailboxId) {
      throw new BadRequestException('mailboxId no coincide con la casilla de la ruta');
    }
    const attachments = toOutgoingAttachments(files);
    const apis = await this.google.forMailbox(mailboxId);
    const html = sanitizeEmailHtml(dto.body);
    const text = htmlToPlainText(html);

    const raw = await buildRawMessage({
      from: { name: apis.displayName, address: apis.email },
      to: dto.to,
      subject: dto.subject,
      html,
      text,
      attachments,
    });
    const sent = await this.sendRaw(apis, raw);

    return {
      id: sent.id ?? '',
      to: dto.to,
      subject: dto.subject,
      snippet: toSnippet(text),
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
    const apis = await this.google.forMailbox(mailboxId);
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
    const subject = replySubject(getHeader(original, 'Subject'));
    const originalId = getHeader(original, 'Message-ID');
    const references = [getHeader(original, 'References'), originalId].filter(Boolean).join(' ');

    const html = sanitizeEmailHtml(dto.body);
    const text = htmlToPlainText(html);
    const raw = await buildRawMessage({
      from: { name: apis.displayName, address: apis.email },
      to,
      subject,
      html,
      text,
      inReplyTo: originalId || undefined,
      references: references || undefined,
      attachments,
    });
    const sent = await this.sendRaw(apis, raw, original.threadId ?? undefined);

    return {
      id: sent.id ?? '',
      to: parseAddress(to).email,
      subject,
      snippet: toSnippet(text),
      sentAt: new Date().toISOString(),
    };
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
  private sendRaw(apis: MailboxGoogleApis, raw: Buffer, threadId?: string): Promise<GmailMessage> {
    return this.call(apis.mailboxId, async () => {
      const { data } = await apis.gmail.users.messages.send({
        userId: 'me',
        requestBody: threadId ? { threadId } : {},
        media: { mimeType: 'message/rfc822', body: Readable.from([raw]) },
      });
      return data;
    });
  }

  /** Traduce los errores de Gmail: 404 → NotFound; el resto lo resuelve GoogleMailboxClient. */
  private async call<T>(mailboxId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isGmailNotFound(err)) throw new NotFoundException('El mensaje no existe');
      return this.google.handleGoogleError(mailboxId, err);
    }
  }
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
  };
}
