import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/transforms';
import { HasVisibleText } from '../../messages/dto/has-visible-text.validator';
import { MAX_BODY_LENGTH } from '../../messages/dto/send-message.dto';

export const MAX_TEMPLATE_NAME_LENGTH = 100;

/** Body de POST /mailboxes/:mailboxId/templates. */
export class CreateTemplateDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name no puede estar vacío' })
  @MaxLength(MAX_TEMPLATE_NAME_LENGTH)
  name: string;

  /** Opcional. Vacío o null = la plantilla no completa el asunto. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  subject?: string | null;

  @IsString()
  @MaxLength(MAX_BODY_LENGTH)
  @HasVisibleText()
  body: string;
}
