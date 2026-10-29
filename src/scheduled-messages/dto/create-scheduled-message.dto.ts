import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { toArrayField, trimString } from '../../common/transforms';
import { MAX_ATTACHMENTS } from '../../messages/attachments';
import { ForwardedAttachmentDto } from '../../messages/dto/forwarded-attachment.dto';
import { HasVisibleText } from '../../messages/dto/has-visible-text.validator';
import { HasAnyRecipient, IsRecipientList } from '../../messages/dto/recipient-list.validator';
import { MAX_BODY_LENGTH } from '../../messages/dto/send-message.dto';
import { GMAIL_ID } from '../../messages/pipes/parse-gmail-id.pipe';
import { BODY_TOO_LONG, notText, tooLong, tooMany } from '../../common/validation-messages';

/**
 * Body de POST /scheduled-messages — `ScheduleMessageInput` del frontend
 * (`mailboxId, to, cc, bcc, subject, body, scheduledAt`) + adjuntos y respuesta.
 * JSON o multipart/form-data (archivos en `attachments`).
 *
 * Con `replyToMessageId` es una respuesta programada: destinatario y asunto
 * salen del mensaje original (igual que Responder), así que `to` y `subject`
 * no hacen falta y, si vienen, se ignoran; `cc` y `bcc` sí se usan.
 */
export class CreateScheduledMessageDto {
  @IsUUID(undefined, { message: 'mailboxId inválido' })
  mailboxId: string;

  /**
   * Destinatarios, como en Redactar: emails separados por coma; entre to, cc y
   * bcc al menos uno. En una respuesta `to` sale del original.
   */
  @ValidateIf((o: CreateScheduledMessageDto) => !o.replyToMessageId)
  @Transform(trimString)
  @IsRecipientList()
  @HasAnyRecipient()
  to?: string = '';

  @IsOptional()
  @Transform(trimString)
  @IsRecipientList()
  cc?: string;

  @IsOptional()
  @Transform(trimString)
  @IsRecipientList()
  bcc?: string;

  @ValidateIf((o: CreateScheduledMessageDto) => !o.replyToMessageId || o.subject !== undefined)
  @Transform(trimString)
  @IsString({ message: notText('subject') })
  @IsNotEmpty({ message: 'subject no puede estar vacío' })
  @MaxLength(500, { message: tooLong('subject', 500) })
  subject?: string;

  @IsString({ message: notText('body') })
  @MaxLength(MAX_BODY_LENGTH, { message: BODY_TOO_LONG })
  @HasVisibleText()
  body: string;

  /** ISO 8601 con zona (ej. `2026-10-21T11:00:00.000Z`). Entre 1 minuto y 1 año. */
  @IsISO8601({ strict: true }, { message: 'scheduledAt tiene que ser una fecha ISO 8601' })
  scheduledAt: string;

  @IsOptional()
  @Matches(GMAIL_ID, { message: 'replyToMessageId inválido' })
  replyToMessageId?: string;

  /** Adjuntos de otros mensajes de la misma casilla (pide también canRead). */
  @IsOptional()
  @Transform(toArrayField(ForwardedAttachmentDto))
  @IsArray({ message: 'forwardedAttachments tiene que ser una lista' })
  @ArrayMaxSize(MAX_ATTACHMENTS, { message: tooMany('forwardedAttachments', MAX_ATTACHMENTS) })
  @ValidateNested({ each: true })
  forwardedAttachments?: ForwardedAttachmentDto[];
}
