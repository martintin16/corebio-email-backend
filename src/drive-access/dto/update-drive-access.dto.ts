import { ArrayMaxSize, IsArray, Matches } from 'class-validator';
import { DRIVE_ID } from '../drive-query';
import { tooMany } from '../../common/validation-messages';

export const MAX_DRIVE_ITEMS = 200;

/**
 * Body de PUT /mailboxes/:mailboxId/drive/access/:userId — `updateDriveAccess`
 * del frontend: la selección FINAL (lo que no está, se deja de compartir).
 */
export class UpdateDriveAccessDto {
  @IsArray({ message: 'itemIds tiene que ser una lista' })
  @ArrayMaxSize(MAX_DRIVE_ITEMS, { message: tooMany('itemIds', MAX_DRIVE_ITEMS) })
  @Matches(DRIVE_ID, { each: true, message: 'itemIds tiene ids inválidos' })
  itemIds: string[];
}
