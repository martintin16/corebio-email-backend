import {
  Body,
  Controller,
  Get,
  BadRequestException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { UpdateLabelsDto } from './dto/update-labels.dto';
import { MessagesService } from './messages.service';
import type {
  MailLabel,
  MessageDetail,
  MessagePage,
  MessageSummary,
  SentMessageDetail,
  SentMessageSummary,
  ThreadMessage,
} from './messages.types';
import {
  PAGE_TOKEN,
  ParseAttachmentIdPipe,
  ParseGmailIdPipe,
  USER_LABEL_ID,
} from './pipes/parse-gmail-id.pipe';

/** Máximo de la búsqueda (`?q=`). */
const MAX_QUERY_LENGTH = 200;

/** `?q=` opcional: la búsqueda de Gmail. Vacía = sin búsqueda. */
function checkQuery(q: unknown): string | undefined {
  if (q === undefined) return undefined;
  if (typeof q !== 'string' || q.length > MAX_QUERY_LENGTH) {
    throw new BadRequestException(`q: máximo ${MAX_QUERY_LENGTH} caracteres`);
  }
  return q.trim() || undefined;
}

/** `?pageToken=` opcional: el `nextPageToken` de la página anterior. */
function checkPageToken(pageToken: unknown): string | undefined {
  if (pageToken === undefined || pageToken === '') return undefined;
  if (typeof pageToken !== 'string' || !PAGE_TOKEN.test(pageToken)) {
    throw new BadRequestException('pageToken inválido');
  }
  return pageToken;
}

@Controller('mailboxes/:mailboxId')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // --- Recibidos ---------------------------------------------------------------

  /**
   * Una página de Recibidos (25). `?labelId=Label_…` → los de esa etiqueta
   * (también archivados). `?q=` → búsqueda de Gmail. `?pageToken=` → la
   * página siguiente (con los mismos labelId y q).
   */
  @RequireMailboxAccess('read')
  @Get('messages')
  listInbox(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Query('labelId') labelId?: string,
    @Query('pageToken') pageToken?: string,
    @Query('q') q?: string,
  ): Promise<MessagePage<MessageSummary>> {
    if (labelId !== undefined && !USER_LABEL_ID.test(labelId)) {
      throw new BadRequestException('labelId inválido');
    }
    return this.messages.listInbox(mailboxId, labelId, checkPageToken(pageToken), checkQuery(q));
  }

  // --- Etiquetas -----------------------------------------------------------------

  @RequireMailboxAccess('read')
  @Get('labels')
  listLabels(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<MailLabel[]> {
    return this.messages.listLabels(mailboxId);
  }

  /** Etiquetar es organizar lo que ya se lee: pide canRead. Se aplica a la conversación. */
  @RequireMailboxAccess('read')
  @Patch('messages/:messageId/labels')
  updateLabels(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('messageId', ParseGmailIdPipe) messageId: string,
    @Body() dto: UpdateLabelsDto,
  ): Promise<{ labelIds: string[] }> {
    return this.messages.updateLabels(mailboxId, messageId, dto.add ?? [], dto.remove ?? []);
  }

  @RequireMailboxAccess('read')
  @Get('messages/:messageId')
  getInboxMessage(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('messageId', ParseGmailIdPipe) messageId: string,
  ): Promise<MessageDetail> {
    return this.messages.getInboxMessage(mailboxId, messageId);
  }

  /** La conversación del mensaje (recibido o enviado), del más viejo al más nuevo. */
  @RequireMailboxAccess('read')
  @Get('messages/:messageId/thread')
  getThread(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('messageId', ParseGmailIdPipe) messageId: string,
  ): Promise<ThreadMessage[]> {
    return this.messages.getThread(mailboxId, messageId);
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
  /** Una página de Enviados (25); `?q=` → búsqueda; `?pageToken=` → la siguiente. */
  @Get('sent')
  listSent(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Query('pageToken') pageToken?: string,
    @Query('q') q?: string,
  ): Promise<MessagePage<SentMessageSummary>> {
    return this.messages.listSent(mailboxId, checkPageToken(pageToken), checkQuery(q));
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
