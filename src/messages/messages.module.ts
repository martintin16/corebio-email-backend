import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MessagesController, SentLookupController } from './messages.controller';
import { MessagesService } from './messages.service';

/**
 * Fase 4 — Recibidos, Enviados, Redactar y Responder contra la Gmail API
 * (vía GoogleMailboxClient). No hay tabla propia: Gmail es la fuente de verdad.
 * MailboxesModule aporta `@RequireMailboxAccess` (canRead / canSend).
 */
@Module({
  imports: [GoogleModule, MailboxesModule],
  controllers: [MessagesController, SentLookupController],
  providers: [MessagesService],
})
export class MessagesModule {}
