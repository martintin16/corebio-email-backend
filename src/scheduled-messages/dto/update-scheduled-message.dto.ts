import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { toArrayField, trimString } from '../../common/transforms';
import { MAX_ATTACHMENTS } from '../../messages/attachments';
import { ForwardedAttachmentDto } from '../../messages/dto/forwarded-attachment.dto';
import { HasVisibleText } from '../../messages/dto/has-visible-text.validator';
import { MAX_BODY_LENGTH } from '../../messages/dto/send-message.dto';
import { ATTACHMENT_ID } from '../../messages/pipes/parse-gmail-id.pipe';

/**
 * Body de PATCH /scheduled-messages/:id. Todo es opcional: lo que no viene,
 * queda como estaba. Adjuntos:
 * - `keepAttachmentIds` omitido → se conservan todos los que tenía;
 *   `[]` → no se conserva ninguno; `["1","3"]` → solo esos.
 * - Los archivos nuevos (`attachments`, multipart) y `forwardedAttachments` se suman.
 * En una respuesta programada `to` y `subject` se ignoran (salen del original).
 */
export class UpdateScheduledMessageDto {
  /** Mover a otra casilla (pide canSend también en la nueva). */
  @IsOptional()
  @IsUUID(undefined, { message: 'mailboxId inválido' })
  mailboxId?: string;

  @IsOptional()
  @Transform(trimString)
  @IsEmail({}, { message: 'to tiene que ser un email válido' })
  @MaxLength(254)
  to?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'subject no puede estar vacío' })
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY_LENGTH)
  @HasVisibleText()
  body?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'scheduledAt tiene que ser una fecha ISO 8601' })
  scheduledAt?: string;

  @IsOptional()
  @Transform(toArrayField())
  @IsArray({ message: 'keepAttachmentIds tiene que ser una lista' })
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @Matches(ATTACHMENT_ID, { each: true, message: 'keepAttachmentIds tiene ids inválidos' })
  keepAttachmentIds?: string[];

  @IsOptional()
  @Transform(toArrayField(ForwardedAttachmentDto))
  @IsArray({ message: 'forwardedAttachments tiene que ser una lista' })
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  forwardedAttachments?: ForwardedAttachmentDto[];
}
