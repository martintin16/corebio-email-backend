import { Matches } from 'class-validator';
import { ATTACHMENT_ID, GMAIL_ID } from '../pipes/parse-gmail-id.pipe';

/** Un adjunto de otro mensaje de la MISMA casilla, para reenviarlo sin volver a subirlo. */
export class ForwardedAttachmentDto {
  @Matches(GMAIL_ID, { message: 'messageId inválido' })
  messageId: string;

  @Matches(ATTACHMENT_ID, { message: 'attachmentId inválido' })
  attachmentId: string;
}
