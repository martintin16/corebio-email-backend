import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MessagesController, SentLookupController } from './messages.controller';
import { MessagesService } from './messages.service';

/**
 * Fases 4 y 4.5 — Recibidos, Enviados, Redactar, Responder y adjuntos contra la Gmail API
 * (vía GoogleMailboxClient). No hay tabla propia: Gmail es la fuente de verdad.
 * MailboxesModule aporta `@RequireMailboxAccess` (canRead / canSend).
 */
@Module({
  imports: [GoogleModule, MailboxesModule],
  controllers: [MessagesController, SentLookupController],
  providers: [MessagesService],
  // Lo usa ScheduledMessagesModule para armar, guardar y enviar los programados.
  exports: [MessagesService],
})
export class MessagesModule {}
