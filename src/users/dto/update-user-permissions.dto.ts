import { IsIn } from 'class-validator';
import type { MailboxAccessInput } from '../../mailboxes/mailboxes.types';
import { APP_ROLES, type AppRole } from '../users.types';
import { IsMailboxAccessRecord } from './is-mailbox-access-record.validator';

/**
 * Body de PATCH /users/:id/permissions — mismo shape que `editPermissionsSchema`
 * del frontend. `access` reemplaza TODOS los permisos del usuario.
 */
export class UpdateUserPermissionsDto {
  @IsIn(APP_ROLES, { message: 'role tiene que ser "user" o "admin"' })
  role: AppRole;

  @IsMailboxAccessRecord()
  access: MailboxAccessInput;
}
