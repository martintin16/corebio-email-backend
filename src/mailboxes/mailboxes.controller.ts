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
  Query,
  Redirect,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { UpdateMailboxDto } from './dto/update-mailbox.dto';
import { MailboxConnectionService } from './mailbox-connection.service';
import { MailboxesService } from './mailboxes.service';
import type { AdminMailbox, UserMailbox } from './mailboxes.types';

/** Gestión de casillas — solo admins. */
@Roles('admin')
@Controller('mailboxes')
export class MailboxesController {
  constructor(
    private readonly mailboxes: MailboxesService,
    private readonly connection: MailboxConnectionService,
  ) {}

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

  /** Desconecta: revoca el permiso en Google y borra la casilla con sus accesos. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.connection.disconnect(id);
  }

  /**
   * Primera conexión o reconexión con Google. Devuelve `{ authUrl }`: el frontend
   * tiene que llevar el navegador a esa URL (consentimiento de Google).
   */
  @Post(':id/reconnect')
  @HttpCode(HttpStatus.OK)
  reconnect(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ authUrl: string }> {
    return this.connection.startConnection(id, actor.id);
  }
}

/**
 * Vuelta del consentimiento de Google. Es pública: la abre el navegador
 * redirigido por Google, sin nuestro token. La seguridad la da el `state` firmado.
 * Siempre redirige al frontend (`/admin/mailboxes?connected=…` o `?connectionError=…`).
 */
@Public()
@Controller('mailboxes/oauth')
export class MailboxOAuthController {
  constructor(private readonly connection: MailboxConnectionService) {}

  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.connection.handleCallback({ code, state, error });
    return { url, statusCode: HttpStatus.FOUND };
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
