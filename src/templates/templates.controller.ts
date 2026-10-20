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
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { RequireMailboxAccess } from '../mailboxes/decorators/require-mailbox-access.decorator';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplatesService } from './templates.service';
import type { MessageTemplate } from './templates.types';

/**
 * Plantillas de una casilla: el selector de Redactar y la pantalla Plantillas
 * (crear, editar, duplicar = crear, borrar). Todo pide canSend en la casilla.
 */
@RequireMailboxAccess('send')
@Controller('mailboxes/:mailboxId/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<MessageTemplate[]> {
    return this.templates.listForMailbox(mailboxId);
  }

  @Get(':templateId')
  find(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ): Promise<MessageTemplate> {
    return this.templates.findInMailbox(mailboxId, templateId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body() dto: CreateTemplateDto,
  ): Promise<MessageTemplate> {
    return this.templates.create(user.id, mailboxId, dto);
  }

  @Patch(':templateId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<MessageTemplate> {
    return this.templates.update(user.id, mailboxId, templateId, dto);
  }

  @Delete(':templateId')
  @HttpCode(204)
  remove(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ): Promise<void> {
    return this.templates.remove(mailboxId, templateId);
  }
}
