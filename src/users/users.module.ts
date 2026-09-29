import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from './entities/user-profile.entity';
import { UsersService } from './users.service';

/**
 * Usuarios de Corebio Mail.
 * Fase 0: entidad + lectura de perfil (la usa AuthModule).
 * Fase 1: UsersController con GET/POST /users, permisos, desactivar, reenviar invitación.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserProfile])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
