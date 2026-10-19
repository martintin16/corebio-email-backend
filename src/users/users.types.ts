import type { MailboxAccessSummary } from '../mailboxes/mailboxes.types';

export const APP_ROLES = ['user', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const USER_STATUSES = ['active', 'invited', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Respuesta de los endpoints de admin — igual a `AdminUser` del frontend. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: UserStatus;
  mailboxAccess: MailboxAccessSummary[];
}

/** Respuesta de GET /mailboxes/:id/access — igual a lo que arma `getMailboxAccessList` en el front. */
export interface MailboxAccessEntry {
  user: AdminUser;
  access: MailboxAccessSummary;
}
