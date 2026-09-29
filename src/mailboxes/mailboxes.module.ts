import { Module } from '@nestjs/common';

/**
 * Fase 2 — Casillas institucionales (admin).
 * CRUD de `mailboxes` + `mailbox_access` (canSend/canRead por usuario), GET /me/mailboxes,
 * flujo OAuth de Google por casilla (refresh_token encriptado, campo `authType`)
 * y la interfaz `GoogleMailboxClient.forMailbox(mailboxId)`.
 */
@Module({})
export class MailboxesModule {}
