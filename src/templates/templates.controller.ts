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

/** Plantillas de una casilla: listar (selector de Redactar) y crear. Pide canSend. */
@Controller('mailboxes/:mailboxId/templates')
export class MailboxTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @RequireMailboxAccess('send')
  @Get()
  list(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<MessageTemplate[]> {
    return this.templates.listForMailbox(mailboxId);
  }

  @RequireMailboxAccess('send')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body() dto: CreateTemplateDto,
  ): Promise<MessageTemplate> {
    return this.templates.create(user.id, mailboxId, dto);
  }
}

/** Detalle, edición y borrado. canSend en la casilla de la plantilla (si no, 404). */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get(':id')
  find(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageTemplate> {
    return this.templates.findForUser(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<MessageTemplate> {
    return this.templates.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.templates.remove(user.id, id);
  }
}
