import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { SyncStateController } from './sync-state.controller';
import { SyncStateService } from './sync-state.service';

/**
 * Estado de sincronización de cada casilla (`GET /mailboxes/:id/sync-state`),
 * para que el front se entere de mails nuevos sin recargar.
 * MailboxesModule aporta `@RequireMailboxAccess`.
 */
@Module({
  imports: [GoogleModule, MailboxesModule],
  controllers: [SyncStateController],
  providers: [SyncStateService],
})
export class SyncModule {}
