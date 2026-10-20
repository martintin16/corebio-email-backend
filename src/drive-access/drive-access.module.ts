import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { DriveAccessController } from './drive-access.controller';
import { DriveAccessService } from './drive-access.service';

/**
 * Fase 7 — Compartir carpetas y archivos del Drive de una casilla con una
 * persona (como Editor), vía Drive API con el permiso de Google de la casilla.
 * Exporta el servicio: UsersModule lo usa para quitar el acceso a Drive cuando
 * alguien pierde la casilla.
 */
@Module({
  imports: [GoogleModule, MailboxesModule],
  controllers: [DriveAccessController],
  providers: [DriveAccessService],
  exports: [DriveAccessService],
})
export class DriveAccessModule {}
