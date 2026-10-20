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
}

export interface MessageDetail extends MessageSummary {
  /** Texto plano (el frontend lo muestra como texto, no como HTML). */
  body: string;
  to: string;
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
  attachments: AttachmentInfo[];
}

/** Un adjunto ya bajado de Gmail, listo para devolver como archivo. */
export interface DownloadedAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}
