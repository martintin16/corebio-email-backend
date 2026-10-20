import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { trimString } from '../../common/transforms';
import { HasVisibleText } from './has-visible-text.validator';

/** Máximo de HTML aceptado en el cuerpo (los adjuntos van aparte). */
export const MAX_BODY_LENGTH = 1_000_000;

/**
 * Body de POST /mailboxes/:mailboxId/messages (Redactar) — mismo shape que
 * `composeSchema` del frontend. Puede llegar como JSON o como multipart/form-data
 * (con los archivos en el campo `attachments`).
 */
export class SendMessageDto {
  /** Opcional: si viene, tiene que coincidir con el `:mailboxId` de la ruta. */
  @IsOptional()
  @IsUUID()
  mailboxId?: string;

  @Transform(trimString)
  @IsEmail({}, { message: 'to tiene que ser un email válido' })
  @MaxLength(254)
  to: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'subject no puede estar vacío' })
  @MaxLength(500)
  subject: string;

  @IsString()
  @MaxLength(MAX_BODY_LENGTH)
  @HasVisibleText()
  body: string;
}
