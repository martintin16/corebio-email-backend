import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { RequireMailboxAccess } from '../mailboxes/decorators/require-mailbox-access.decorator';
import { toDownload, type UploadedAttachment } from './attachments';
import { AttachmentsInterceptor } from './attachments.interceptor';
import { ReplyMessageDto } from './dto/reply-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';
import type {
  MessageDetail,
  MessageSummary,
  SentMessageDetail,
  SentMessageSummary,
} from './messages.types';
import { ParseAttachmentIdPipe, ParseGmailIdPipe } from './pipes/parse-gmail-id.pipe';

@Controller('mailboxes/:mailboxId')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // --- Recibidos ---------------------------------------------------------------

  @RequireMailboxAccess('read')
  @Get('messages')
  listInbox(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<MessageSummary[]> {
    return this.messages.listInbox(mailboxId);
  }

  @RequireMailboxAccess('read')
  @Get('messages/:messageId')
  getInboxMessage(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('messageId', ParseGmailIdPipe) messageId: string,
  ): Promise<MessageDetail> {
    return this.messages.getInboxMessage(mailboxId, messageId);
  }

  /** Descarga de un adjunto. Sirve para recibidos y enviados (mismos ids de Gmail). */
  @RequireMailboxAccess('read')
  @Get('messages/:messageId/attachments/:attachmentId')
  async downloadAttachment(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('messageId', ParseGmailIdPipe) messageId: string,
    @Param('attachmentId', ParseAttachmentIdPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    return toDownload(await this.messages.getAttachment(mailboxId, messageId, attachmentId));
  }

  // --- Redactar y Responder ----------------------------------------------------

  @RequireMailboxAccess('send')
  @Post('messages')
  @UseInterceptors(AttachmentsInterceptor)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body() dto: SendMessageDto,
    @UploadedFiles() files?: UploadedAttachment[],
  ): Promise<SentMessageSummary> {
    return this.messages.send(mailboxId, dto, files, user.id);
  }

  @RequireMailboxAccess('send')
  @Post('messages/:messageId/reply')
  @UseInterceptors(AttachmentsInterceptor)
  reply(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('messageId', ParseGmailIdPipe) messageId: string,
    @Body() dto: ReplyMessageDto,
    @UploadedFiles() files?: UploadedAttachment[],
  ): Promise<SentMessageSummary> {
    return this.messages.reply(mailboxId, messageId, dto, files);
  }

  // --- Enviados ----------------------------------------------------------------

  @RequireMailboxAccess('read')
  @Get('sent')
  listSent(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<SentMessageSummary[]> {
    return this.messages.listSent(mailboxId);
  }

  @RequireMailboxAccess('read')
  @Get('sent/:sentId')
  getSentMessage(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('sentId', ParseGmailIdPipe) sentId: string,
  ): Promise<SentMessageDetail> {
    return this.messages.getSentMessage(mailboxId, sentId);
  }
}

/**
 * GET /sent/:sentId — para "Reenviar" desde el detalle de un enviado: el frontend
 * tiene el id pero no la casilla. Solo busca en casillas con `canRead`.
 */
@Controller('sent')
export class SentLookupController {
  constructor(private readonly messages: MessagesService) {}

  @Get(':sentId')
  find(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sentId', ParseGmailIdPipe) sentId: string,
  ): Promise<SentMessageDetail> {
    return this.messages.findSentForUser(user.id, sentId);
  }
}
