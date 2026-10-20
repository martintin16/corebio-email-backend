import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/transforms';
import { HasVisibleText } from '../../messages/dto/has-visible-text.validator';
import { MAX_BODY_LENGTH } from '../../messages/dto/send-message.dto';
import { MAX_TEMPLATE_NAME_LENGTH } from './create-template.dto';

/** Body de PATCH /templates/:id. Lo que no viene queda igual; `subject: null` lo quita. */
export class UpdateTemplateDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name no puede estar vacío' })
  @MaxLength(MAX_TEMPLATE_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  subject?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY_LENGTH)
  @HasVisibleText()
  body?: string;
}
