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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { UsersService } from './users.service';
import type { AdminUser, MailboxAccessEntry } from './users.types';

/** Gestión de usuarios — solo admins. */
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<AdminUser[]> {
    return this.users.listAdminUsers();
  }

  /** Crea el usuario y le manda la invitación por email. */
  @Post()
  create(@Body() dto: CreateUserDto): Promise<AdminUser> {
    return this.users.create(dto);
  }

  @Patch(':id/permissions')
  updatePermissions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserPermissionsDto,
  ): Promise<AdminUser> {
    return this.users.updatePermissions(actor.id, id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUser> {
    return this.users.deactivate(actor.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.users.remove(actor.id, id);
  }

  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  resendInvite(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.users.resendInvite(id);
  }
}

/**
 * GET /mailboxes/:id/access vive en Users porque devuelve usuarios completos
 * (`{ user: AdminUser, access }[]`, igual que `getMailboxAccessList` del frontend).
 */
@Roles('admin')
@Controller('mailboxes')
export class MailboxUsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id/access')
  list(@Param('id', ParseUUIDPipe) id: string): Promise<MailboxAccessEntry[]> {
    return this.users.listMailboxAccess(id);
  }
}
