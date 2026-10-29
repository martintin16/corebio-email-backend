import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimLowerString, trimString } from '../../common/transforms';
import type { MailboxAccessInput } from '../../mailboxes/mailboxes.types';
import { APP_ROLES, type AppRole } from '../users.types';
import { IsMailboxAccessRecord } from './is-mailbox-access-record.validator';
import { notText, tooLong } from '../../common/validation-messages';

/** Body de POST /users — mismo shape que `newUserSchema` del frontend. */
export class CreateUserDto {
  @Transform(trimString)
  @IsString({ message: notText('name') })
  @IsNotEmpty({ message: 'name no puede estar vacío' })
  @MaxLength(100, { message: tooLong('name', 100) })
  name: string;

  /** Email personal de la persona (no el institucional). */
  @Transform(trimLowerString)
  @IsEmail({}, { message: 'email tiene que ser un email válido' })
  @MaxLength(254, { message: tooLong('email', 254) })
  email: string;

  @IsIn(APP_ROLES, { message: 'role tiene que ser "user" o "admin"' })
  role: AppRole;

  @IsMailboxAccessRecord()
  access: MailboxAccessInput;
}
