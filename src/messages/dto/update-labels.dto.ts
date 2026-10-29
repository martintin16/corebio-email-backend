import { ArrayMaxSize, IsArray, IsOptional, Matches } from 'class-validator';
import { USER_LABEL_ID } from '../pipes/parse-gmail-id.pipe';
import { tooMany } from '../../common/validation-messages';

const MAX_LABEL_CHANGES = 50;

/**
 * Body de PATCH /mailboxes/:mailboxId/messages/:messageId/labels —
 * `updateMessageLabels` del frontend: ids de etiqueta a agregar y a sacar.
 */
export class UpdateLabelsDto {
  @IsOptional()
  @IsArray({ message: 'add tiene que ser una lista' })
  @ArrayMaxSize(MAX_LABEL_CHANGES, { message: tooMany('add', MAX_LABEL_CHANGES) })
  @Matches(USER_LABEL_ID, { each: true, message: 'add tiene ids de etiqueta inválidos' })
  add?: string[];

  @IsOptional()
  @IsArray({ message: 'remove tiene que ser una lista' })
  @ArrayMaxSize(MAX_LABEL_CHANGES, { message: tooMany('remove', MAX_LABEL_CHANGES) })
  @Matches(USER_LABEL_ID, { each: true, message: 'remove tiene ids de etiqueta inválidos' })
  remove?: string[];
}
