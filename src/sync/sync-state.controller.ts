import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequireMailboxAccess } from '../mailboxes/decorators/require-mailbox-access.decorator';
import { SyncStateService } from './sync-state.service';
import type { MailboxSyncState } from './sync-state.types';

/** Para que el front detecte mails nuevos sin recargar. Es parte de leer la casilla: canRead. */
@RequireMailboxAccess('read')
@Controller('mailboxes/:mailboxId')
export class SyncStateController {
  constructor(private readonly sync: SyncStateService) {}

  @Get('sync-state')
  getState(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<MailboxSyncState> {
    return this.sync.getState(mailboxId);
  }
}
