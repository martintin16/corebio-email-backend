import { IsString, MaxLength } from 'class-validator';
import { HasVisibleText } from './has-visible-text.validator';
import { MAX_BODY_LENGTH } from './send-message.dto';

/** Body de POST /mailboxes/:mailboxId/messages/:messageId/reply (JSON o multipart). */
export class ReplyMessageDto {
  @IsString()
  @MaxLength(MAX_BODY_LENGTH)
  @HasVisibleText()
  body: string;
}
