import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { UserProfile } from './entities/user-profile.entity';
import { SupabaseAdminClient, SupabaseJsAdminClient } from './supabase-admin.client';
import { MailboxUsersController, UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Usuarios de Corebio Mail.
 * Fase 0: entidad + lectura de perfil (la usa AuthModule en cada request).
 * Fase 2: gestión de admin (listar, invitar, permisos, desactivar, borrar,
 * reenviar invitación) + GET /mailboxes/:id/access.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserProfile]), MailboxesModule],
  controllers: [UsersController, MailboxUsersController],
  providers: [UsersService, { provide: SupabaseAdminClient, useClass: SupabaseJsAdminClient }],
  exports: [UsersService],
})
export class UsersModule {}
