import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

/**
 * Fase 8 — Contactos y grupos de Google Contacts de cada casilla (People API),
 * solo lectura. MailboxesModule aporta `@RequireMailboxAccess`.
 */
@Module({
  imports: [GoogleModule, MailboxesModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
