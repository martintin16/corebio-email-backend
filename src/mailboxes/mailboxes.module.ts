import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailboxAccess } from './entities/mailbox-access.entity';
import { Mailbox } from './entities/mailbox.entity';
import { MailboxAccessGuard } from './guards/mailbox-access.guard';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxesController, MeMailboxesController } from './mailboxes.controller';
import { MailboxesService } from './mailboxes.service';

/**
 * Casillas institucionales y permisos por casilla.
 * Fase 1: CRUD de admin, GET /me/mailboxes, MailboxAccessService y el guard
 * `@RequireMailboxAccess`. Fase 3 suma el OAuth de Google y GoogleMailboxClient.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Mailbox, MailboxAccess])],
  controllers: [MailboxesController, MeMailboxesController],
  providers: [MailboxesService, MailboxAccessService, MailboxAccessGuard],
  exports: [MailboxAccessService, MailboxAccessGuard],
})
export class MailboxesModule {}
