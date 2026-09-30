import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-user';
import { MailboxAccessService } from '../mailbox-access.service';
import type { MailboxPermission } from '../mailboxes.types';

export const MAILBOX_PERMISSION_KEY = 'corebio:mailboxPermission';

/**
 * Barrera de seguridad de todo lo que opera sobre el contenido de una casilla
 * (mensajes, envíos programados, plantillas, Drive). Se aplica con
 * `@RequireMailboxAccess('read' | 'send')` y lee la casilla de `:mailboxId`.
 *
 * - Ser admin NO da acceso implícito: el admin gestiona casillas y permisos,
 *   pero para leer o enviar necesita tener el permiso asignado como cualquiera.
 * - Casilla inexistente o sin permiso → 403 en ambos casos (no se revela cuál).
 */
@Injectable()
export class MailboxAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: MailboxAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<MailboxPermission | undefined>(
      MAILBOX_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('No tenés acceso a esta casilla');

    const mailboxId = request.params?.mailboxId;
    if (typeof mailboxId !== 'string' || !isUUID(mailboxId)) {
      throw new BadRequestException('mailboxId inválido');
    }

    const allowed = await this.access.hasPermission(user.id, mailboxId, permission);
    if (!allowed) {
      throw new ForbiddenException(
        permission === 'read'
          ? 'No tenés permiso para leer esta casilla'
          : 'No tenés permiso para enviar desde esta casilla',
      );
    }
    return true;
  }
}
