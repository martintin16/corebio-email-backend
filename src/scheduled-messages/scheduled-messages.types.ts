import type { AttachmentInfo } from '../messages/messages.types';

export const SCHEDULED_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;
export type ScheduledMessageStatus = (typeof SCHEDULED_STATUSES)[number];

/**
 * Respuesta de la API — `lib/types/scheduled-message.ts` del frontend
 * (`id, mailboxId, to, subject, bodyPreview, body, scheduledAt`) + estado y adjuntos.
 */
export interface ScheduledMessageView {
  id: string;
  mailboxId: string;
  /** Emails separados por coma, como en Redactar ('' si no hay). */
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** Texto plano corto para la lista. */
  bodyPreview: string;
  /** HTML sanitizado completo (para prellenar el editor al editar). */
  body: string;
  /** ISO 8601, UTC. */
  scheduledAt: string;
  status: ScheduledMessageStatus;
  /** Por qué falló (o el último error transitorio mientras se reintenta). */
  lastError: string | null;
  attachments: AttachmentInfo[];
  /** Si es una respuesta: el mensaje al que responde. */
  replyToMessageId: string | null;
  sentAt: string | null;
}
