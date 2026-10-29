import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/transforms';
import { HasVisibleText } from '../../messages/dto/has-visible-text.validator';
import { MAX_BODY_LENGTH } from '../../messages/dto/send-message.dto';
import { BODY_TOO_LONG, notText, tooLong } from '../../common/validation-messages';

export const MAX_TEMPLATE_NAME_LENGTH = 60;

/** Body de POST /mailboxes/:mailboxId/templates. */
export class CreateTemplateDto {
  @Transform(trimString)
  @IsString({ message: notText('name') })
  @IsNotEmpty({ message: 'name no puede estar vacío' })
  @MaxLength(MAX_TEMPLATE_NAME_LENGTH, { message: tooLong('name', MAX_TEMPLATE_NAME_LENGTH) })
  name: string;

  /** Opcional. Vacío o null = la plantilla no completa el asunto. */
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: notText('subject') })
  @MaxLength(500, { message: tooLong('subject', 500) })
  subject?: string | null;

  @IsString({ message: notText('body') })
  @MaxLength(MAX_BODY_LENGTH, { message: BODY_TOO_LONG })
  @HasVisibleText()
  body: string;
}
