import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { UpdateMailboxDto } from './dto/update-mailbox.dto';
import { MailboxesService } from './mailboxes.service';
import type { AdminMailbox, UserMailbox } from './mailboxes.types';

/** Gestión de casillas — solo admins. */
@Roles('admin')
@Controller('mailboxes')
export class MailboxesController {
  constructor(private readonly mailboxes: MailboxesService) {}

  @Get()
  list(): Promise<AdminMailbox[]> {
    return this.mailboxes.listForAdmin();
  }

  @Post()
  create(@Body() dto: CreateMailboxDto): Promise<AdminMailbox> {
    return this.mailboxes.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMailboxDto,
  ): Promise<AdminMailbox> {
    return this.mailboxes.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.mailboxes.remove(id);
  }

  /** 501 hasta la Fase 3 (OAuth de Google). */
  @Post(':id/reconnect')
  reconnect(@Param('id', ParseUUIDPipe) id: string): Promise<never> {
    return this.mailboxes.reconnect(id);
  }
}

/** Casillas del usuario logueado — cualquier rol. */
@Controller('me')
export class MeMailboxesController {
  constructor(private readonly mailboxes: MailboxesService) {}

  @Get('mailboxes')
  list(@CurrentUser() user: AuthenticatedUser): Promise<UserMailbox[]> {
    return this.mailboxes.listForUser(user.id);
  }
}
