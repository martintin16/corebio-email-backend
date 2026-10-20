/** Tipos de respuesta — los mismos que `lib/types/mail.ts` del frontend. */

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
}
