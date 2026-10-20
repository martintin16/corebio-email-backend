import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleModule } from '../google/google.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MessagesModule } from '../messages/messages.module';
import { ScheduledMessage } from './entities/scheduled-message.entity';
import {
  MailboxScheduledMessagesController,
  ScheduledMessagesController,
} from './scheduled-messages.controller';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { ScheduledSenderService } from './scheduled-sender.service';

/**
 * Fase 5 — Envíos programados: tabla `scheduled_messages`, el mensaje como
 * borrador de Gmail en la casilla, y un job por minuto que envía los vencidos
 * (con reintentos y estado de error). MessagesModule aporta el armado y los
 * borradores; MailboxesModule, los permisos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduledMessage]),
    GoogleModule,
    MailboxesModule,
    MessagesModule,
  ],
  controllers: [MailboxScheduledMessagesController, ScheduledMessagesController],
  providers: [ScheduledMessagesService, ScheduledSenderService],
})
export class ScheduledMessagesModule {}
