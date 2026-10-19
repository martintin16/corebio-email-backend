import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleModule } from '../google/google.module';
import { MailboxAccess } from './entities/mailbox-access.entity';
import { Mailbox } from './entities/mailbox.entity';
import { MailboxAccessGuard } from './guards/mailbox-access.guard';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxConnectionService } from './mailbox-connection.service';
import {
  MailboxesController,
  MailboxOAuthController,
  MeMailboxesController,
} from './mailboxes.controller';
import { MailboxesService } from './mailboxes.service';

/**
 * Casillas institucionales y permisos por casilla.
 * Fase 1: CRUD de admin, GET /me/mailboxes, MailboxAccessService y el guard
 * `@RequireMailboxAccess`.
 * Fase 3: conexión con Google por OAuth (reconnect → authUrl, callback, revocar al
 * desconectar). El acceso a Gmail/Drive en sí vive en GoogleModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Mailbox, MailboxAccess]), GoogleModule],
  controllers: [MailboxesController, MailboxOAuthController, MeMailboxesController],
  providers: [MailboxesService, MailboxAccessService, MailboxAccessGuard, MailboxConnectionService],
  // MailboxesService se exporta para que Users (GET /mailboxes/:id/access) responda 404
  // con la misma regla que el resto de los endpoints de casillas.
  exports: [MailboxesService, MailboxAccessService, MailboxAccessGuard],
})
export class MailboxesModule {}
