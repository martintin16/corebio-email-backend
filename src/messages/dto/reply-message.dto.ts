import { IsString, MaxLength } from 'class-validator';
import { HasVisibleText } from './has-visible-text.validator';
import { MAX_BODY_LENGTH } from './send-message.dto';
import { BODY_TOO_LONG, notText } from '../../common/validation-messages';

/** Body de POST /mailboxes/:mailboxId/messages/:messageId/reply (JSON o multipart). */
export class ReplyMessageDto {
  @IsString({ message: notText('body') })
  @MaxLength(MAX_BODY_LENGTH, { message: BODY_TOO_LONG })
  @HasVisibleText()
  body: string;
}
