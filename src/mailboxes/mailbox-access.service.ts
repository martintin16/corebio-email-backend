import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { MailboxAccess } from './entities/mailbox-access.entity';
import { Mailbox } from './entities/mailbox.entity';
import type {
  MailboxAccessFlags,
  MailboxAccessInput,
  MailboxAccessSummary,
  MailboxPermission,
} from './mailboxes.types';

export interface MailboxUserAccess extends MailboxAccessFlags {
  userId: string;
}

/**
 * Dueño de la tabla `mailbox_access`. Lo exporta MailboxesModule para que:
 * - Users (Fase 2) guarde el campo `access` de cada usuario y arme `mailboxAccess`.
 * - MailboxAccessGuard chequee canRead/canSend en cada request a una casilla.
 */
@Injectable()
export class MailboxAccessService {
  constructor(
    @InjectRepository(MailboxAccess)
    private readonly access: Repository<MailboxAccess>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Permisos del usuario sobre la casilla, o null si no tiene ninguno. */
  async getPermissions(userId: string, mailboxId: string): Promise<MailboxAccessFlags | null> {
    const row = await this.access.findOneBy({ userId, mailboxId });
    return row ? { canSend: row.canSend, canRead: row.canRead } : null;
  }

  async hasPermission(
    userId: string,
    mailboxId: string,
    permission: MailboxPermission,
  ): Promise<boolean> {
    const flags = await this.getPermissions(userId, mailboxId);
    if (!flags) return false;
    return permission === 'read' ? flags.canRead : flags.canSend;
  }

  /** `mailboxAccess` de cada usuario pedido (para armar `AdminUser[]`). */
  async findSummariesByUser(userIds: string[]): Promise<Map<string, MailboxAccessSummary[]>> {
    const result = new Map<string, MailboxAccessSummary[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return result;

    const rows: {
      user_id: string;
      mailbox_id: string;
      email: string;
      can_send: boolean;
      can_read: boolean;
    }[] = await this.access.query(
      `
      SELECT a.user_id, a.mailbox_id, m.email, a.can_send, a.can_read
      FROM public.mailbox_access a
      JOIN public.mailboxes m ON m.id = a.mailbox_id
      WHERE a.user_id = ANY($1::uuid[])
      ORDER BY m.email
      `,
      [userIds],
    );

    for (const row of rows) {
      result.get(row.user_id)?.push({
        mailboxId: row.mailbox_id,
        email: row.email,
        canSend: row.can_send,
        canRead: row.can_read,
      });
    }
    return result;
  }

  /** Usuarios con algún permiso sobre la casilla (para GET /mailboxes/:id/access, Fase 2). */
  async findUsersWithAccess(mailboxId: string): Promise<MailboxUserAccess[]> {
    const rows = await this.access.find({ where: { mailboxId } });
    return rows.map((row) => ({ userId: row.userId, canSend: row.canSend, canRead: row.canRead }));
  }

  /**
   * Reemplaza TODOS los permisos del usuario por los de `input` (formato del
   * frontend: mailboxId → { canSend, canRead }).
   *
   * - Las casillas con los dos permisos en false no generan fila (= sin acceso).
   * - Un id que no es uuid o que no existe → 400, sin tocar nada.
   * - Corre en una transacción. Si se pasa `manager`, usa esa (así Users puede
   *   crear el perfil y sus permisos en la misma transacción).
   */
  async replaceForUser(
    userId: string,
    input: MailboxAccessInput,
    manager?: EntityManager,
  ): Promise<void> {
    const mailboxIds = Object.keys(input);
    const invalid = mailboxIds.filter((id) => !isUUID(id));
    if (invalid.length > 0) {
      throw new BadRequestException(`Ids de casilla inválidos: ${invalid.join(', ')}`);
    }

    const granted = Object.entries(input)
      .filter(([, flags]) => flags.canSend || flags.canRead)
      .map(([mailboxId, flags]) => ({
        userId,
        mailboxId,
        canSend: flags.canSend,
        canRead: flags.canRead,
      }));

    const run = async (em: EntityManager): Promise<void> => {
      if (mailboxIds.length > 0) {
        const existing = await em.find(Mailbox, {
          select: { id: true },
          where: { id: In(mailboxIds) },
        });
        const existingIds = new Set(existing.map((m) => m.id));
        const unknown = mailboxIds.filter((id) => !existingIds.has(id));
        if (unknown.length > 0) {
          throw new BadRequestException(`Casillas inexistentes: ${unknown.join(', ')}`);
        }
      }

      await em.delete(MailboxAccess, { userId });
      if (granted.length > 0) {
        await em.insert(MailboxAccess, granted);
      }
    };

    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }
}
