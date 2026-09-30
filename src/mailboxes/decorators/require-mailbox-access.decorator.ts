import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { MAILBOX_PERMISSION_KEY, MailboxAccessGuard } from '../guards/mailbox-access.guard';
import type { MailboxPermission } from '../mailboxes.types';

/**
 * Exige que el usuario tenga el permiso indicado sobre la casilla `:mailboxId`
 * de la ruta. Ej:
 *
 *   @RequireMailboxAccess('read')
 *   @Get(':mailboxId/messages')
 *
 * El módulo que lo use tiene que importar MailboxesModule.
 */
export const RequireMailboxAccess = (permission: MailboxPermission) =>
  applyDecorators(SetMetadata(MAILBOX_PERMISSION_KEY, permission), UseGuards(MailboxAccessGuard));
