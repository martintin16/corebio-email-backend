import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { toArrayField, trimString } from '../../common/transforms';
import { MAX_ATTACHMENTS } from '../attachments';
import { ForwardedAttachmentDto } from './forwarded-attachment.dto';
import { HasVisibleText } from './has-visible-text.validator';
import { HasAnyRecipient, IsRecipientList } from './recipient-list.validator';
import { BODY_TOO_LONG, notText, tooLong, tooMany } from '../../common/validation-messages';

/** Máximo de HTML aceptado en el cuerpo (los adjuntos van aparte). */
export const MAX_BODY_LENGTH = 1_000_000;

/**
 * Body de POST /mailboxes/:mailboxId/messages (Redactar) — mismo shape que
 * `composeSchema` del frontend (`to`, `cc`, `bcc` con emails separados por coma). Puede llegar como JSON o como multipart/form-data
 * (con los archivos en el campo `attachments`).
 */
export class SendMessageDto {
  /** Opcional: si viene, tiene que coincidir con el `:mailboxId` de la ruta. */
  @IsOptional()
  @IsUUID(undefined, { message: 'mailboxId inválido' })
  mailboxId?: string;

  /**
   * Destinatarios: cada campo es un string de emails separados por coma (el
   * formato del header de Gmail). Pueden venir vacíos, pero entre los tres
   * tiene que haber al menos uno.
   */
  @Transform(trimString)
  @IsRecipientList()
  @HasAnyRecipient()
  // '' si no viene: así la validación de "al menos uno" corre igual.
  to = '';

  @IsOptional()
  @Transform(trimString)
  @IsRecipientList()
  cc?: string;

  @IsOptional()
  @Transform(trimString)
  @IsRecipientList()
  bcc?: string;

  @Transform(trimString)
  @IsString({ message: notText('subject') })
  @IsNotEmpty({ message: 'subject no puede estar vacío' })
  @MaxLength(500, { message: tooLong('subject', 500) })
  subject: string;

  @IsString({ message: notText('body') })
  @MaxLength(MAX_BODY_LENGTH, { message: BODY_TOO_LONG })
  @HasVisibleText()
  body: string;

  /**
   * "Reenviar": adjuntos de otro mensaje de esta misma casilla, que el backend
   * baja de Gmail (no hace falta volver a subirlos). Pide además canRead.
   * Por multipart puede ir como JSON en un solo campo.
   */
  @IsOptional()
  @Transform(toArrayField(ForwardedAttachmentDto))
  @IsArray({ message: 'forwardedAttachments tiene que ser una lista' })
  @ArrayMaxSize(MAX_ATTACHMENTS, { message: tooMany('forwardedAttachments', MAX_ATTACHMENTS) })
  @ValidateNested({ each: true })
  forwardedAttachments?: ForwardedAttachmentDto[];
}
