export const MAILBOX_AUTH_TYPES = ['oauth', 'domain_wide'] as const;
/** Cómo se autentica la casilla contra Google (ver Fase 3). */
export type MailboxAuthType = (typeof MAILBOX_AUTH_TYPES)[number];

export const MAILBOX_STATUSES = ['connected', 'needs_reconnect'] as const;
/** Igual a `MailboxConnectionStatus` del frontend. */
export type MailboxConnectionStatus = (typeof MAILBOX_STATUSES)[number];

export type MailboxPermission = 'read' | 'send';

/** Respuesta de los endpoints de admin — igual a `AdminMailbox` del frontend. */
export interface AdminMailbox {
  id: string;
  email: string;
  displayName: string;
  connectedUsersCount: number;
  status: MailboxConnectionStatus;
}

/** Respuesta de GET /me/mailboxes — igual a `Mailbox` del frontend. */
export interface UserMailbox {
  id: string;
  email: string;
  displayName: string;
}

/** Igual a `MailboxAccessSummary` del frontend (va dentro de `AdminUser`). */
export interface MailboxAccessSummary {
  mailboxId: string;
  email: string;
  canSend: boolean;
  canRead: boolean;
}

export interface MailboxAccessFlags {
  canSend: boolean;
  canRead: boolean;
}

/** Formato del campo `access` que manda el frontend: mailboxId → permisos. */
export type MailboxAccessInput = Record<string, MailboxAccessFlags>;
