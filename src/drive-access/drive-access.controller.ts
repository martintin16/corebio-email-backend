import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { DriveAccessService } from './drive-access.service';
import type { DriveAccessResult, DriveItem } from './drive-access.types';
import { DRIVE_ID } from './drive-query';
import { UpdateDriveAccessDto } from './dto/update-drive-access.dto';

/**
 * "Gestionar Drive" en Editar permisos (admin). Usa el permiso de Google de la
 * casilla: el admin ve nombres de carpetas y archivos de su Drive (no
 * contenidos) aunque no tenga canRead, porque es la herramienta de gestión.
 */
@Roles('admin')
@Controller('mailboxes/:mailboxId/drive')
export class DriveAccessController {
  constructor(private readonly drive: DriveAccessService) {}

  /** GET …/drive/items?folderId=root&userId=… → contenido de una carpeta. */
  @Get('items')
  listItems(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
    @Query('folderId') folderId = 'root',
  ): Promise<DriveItem[]> {
    if (!DRIVE_ID.test(folderId)) throw new BadRequestException('folderId inválido');
    return this.drive.listItems(mailboxId, folderId, userId);
  }

  /** GET …/drive/shared?userId=… → ids de lo que la persona ya tiene compartido. */
  @Get('shared')
  listShared(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<string[]> {
    return this.drive.listSharedIds(mailboxId, userId);
  }

  /** PUT …/drive/access/:userId { itemIds } → comparte lo nuevo y quita lo destildado. */
  @Put('access/:userId')
  applyAccess(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateDriveAccessDto,
  ): Promise<DriveAccessResult> {
    return this.drive.applyAccess(mailboxId, userId, dto.itemIds);
  }
}
