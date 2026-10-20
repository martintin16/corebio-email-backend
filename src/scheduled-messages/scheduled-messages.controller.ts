import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { RequireMailboxAccess } from '../mailboxes/decorators/require-mailbox-access.decorator';
import { toDownload, type UploadedAttachment } from '../messages/attachments';
import { AttachmentsInterceptor } from '../messages/attachments.interceptor';
import { ParseAttachmentIdPipe } from '../messages/pipes/parse-gmail-id.pipe';
import { CreateScheduledMessageDto } from './dto/create-scheduled-message.dto';
import { UpdateScheduledMessageDto } from './dto/update-scheduled-message.dto';
import { ScheduledMessagesService } from './scheduled-messages.service';
import type { ScheduledMessageView } from './scheduled-messages.types';

/** Vista "Programados" de una casilla. */
@Controller('mailboxes/:mailboxId/scheduled-messages')
export class MailboxScheduledMessagesController {
  constructor(private readonly scheduled: ScheduledMessagesService) {}

  @RequireMailboxAccess('read')
  @Get()
  list(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<ScheduledMessageView[]> {
    return this.scheduled.listForMailbox(mailboxId);
  }
}

/**
 * Alta, detalle, edición y cancelación. La casilla sale del body (alta) o del
 * programado: los permisos se chequean en el servicio (canRead para ver,
 * canSend para crear, editar y cancelar; 404 si no tiene ninguno).
 */
@Controller('scheduled-messages')
export class ScheduledMessagesController {
  constructor(private readonly scheduled: ScheduledMessagesService) {}

  @Get(':id')
  find(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ScheduledMessageView> {
    return this.scheduled.findForUser(user.id, id);
  }

  @Get(':id/attachments/:attachmentId')
  async downloadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseAttachmentIdPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    return toDownload(await this.scheduled.getAttachment(user.id, id, attachmentId));
  }

  @Post()
  @UseInterceptors(AttachmentsInterceptor)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduledMessageDto,
    @UploadedFiles() files?: UploadedAttachment[],
  ): Promise<ScheduledMessageView> {
    return this.scheduled.create(user.id, dto, files);
  }

  @Patch(':id')
  @UseInterceptors(AttachmentsInterceptor)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduledMessageDto,
    @UploadedFiles() files?: UploadedAttachment[],
  ): Promise<ScheduledMessageView> {
    return this.scheduled.update(user.id, id, dto, files);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.scheduled.remove(user.id, id);
  }
}
