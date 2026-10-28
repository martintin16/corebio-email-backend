/** Tipos de respuesta — los mismos que `lib/types/mail.ts` del frontend (+ adjuntos). */

/** Un adjunto, para listarlo y bajarlo con GET …/attachments/:id. */
export interface AttachmentInfo {
  /** Id del adjunto dentro del mensaje (el `partId` de Gmail, ej. "1"). */
  id: string;
  filename: string;
  mimeType: string;
  /** Bytes. */
  size: number;
}

/** Referencia a un adjunto de un mensaje de la misma casilla (para "Reenviar"). */
export interface ForwardedAttachmentRef {
  messageId: string;
  attachmentId: string;
}

export interface MessageSummary {
  id: string;
  from: { name: string; email: string };
  subject: string;
  snippet: string;
  receivedAt: string; // ISO
  unread: boolean;
  /** Etiquetas de usuario de Gmail aplicadas (ver MailLabel). */
  labelIds: string[];
}

/** Una etiqueta de Gmail creada por el usuario — `MailLabel` del frontend. */
export interface MailLabel {
  id: string;
  name: string;
  /** Color de fondo de Gmail ("#RRGGBB"), o null si no tiene. */
  color: string | null;
}

export interface MessageDetail extends MessageSummary {
  /** Texto plano (el frontend lo muestra como texto, no como HTML). */
  body: string;
  to: string;
  /** Header Cc tal cual ('' si no hay). En un recibido no existe el Bcc. */
  cc: string;
  attachments: AttachmentInfo[];
}

export interface SentMessageSummary {
  id: string;
  to: string;
  subject: string;
  snippet: string;
  sentAt: string; // ISO
}

export interface SentMessageDetail extends SentMessageSummary {
  mailboxId: string;
  /** HTML sanitizado (el frontend lo renderiza con dangerouslySetInnerHTML). */
  body: string;
  /** Headers Cc y Bcc tal cual ('' si no hay). Gmail guarda el Bcc en la copia de Enviados. */
  cc: string;
  bcc: string;
  attachments: AttachmentInfo[];
}

/** Un adjunto ya bajado de Gmail, listo para devolver como archivo. */
export interface DownloadedAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/**
 * Una página de una lista de Gmail (Recibidos, una etiqueta, Enviados).
 * `nextPageToken` se pasa como `?pageToken=` para pedir la siguiente; null =
 * no hay más.
 */
export interface MessagePage<T> {
  items: T[];
  nextPageToken: string | null;
}
