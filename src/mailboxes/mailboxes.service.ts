import {
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-errors';
import type { CreateMailboxDto } from './dto/create-mailbox.dto';
import type { UpdateMailboxDto } from './dto/update-mailbox.dto';
import { Mailbox } from './entities/mailbox.entity';
import type { AdminMailbox, MailboxConnectionStatus, UserMailbox } from './mailboxes.types';

interface AdminMailboxRow {
  id: string;
  email: string;
  display_name: string;
  status: MailboxConnectionStatus;
  connected_users_count: number;
}

/**
 * `connectedUsersCount` cuenta a todos los usuarios con algún permiso sobre la
 * casilla, incluidos los desactivados: es el mismo criterio que usa el frontend
 * (mocks de admin) y coincide con la lista de "Ver usuarios con acceso".
 */
const ADMIN_MAILBOX_SELECT = `
  SELECT
    m.id,
    m.email,
    m.display_name,
    m.status,
    (SELECT count(*)::int FROM public.mailbox_access a WHERE a.mailbox_id = m.id)
      AS connected_users_count
  FROM public.mailboxes m
`;

function toAdminMailbox(row: AdminMailboxRow): AdminMailbox {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    connectedUsersCount: Number(row.connected_users_count),
    status: row.status,
  };
}

@Injectable()
export class MailboxesService {
  constructor(
    @InjectRepository(Mailbox)
    private readonly mailboxes: Repository<Mailbox>,
  ) {}

  async listForAdmin(): Promise<AdminMailbox[]> {
    const rows: AdminMailboxRow[] = await this.mailboxes.query(
      `${ADMIN_MAILBOX_SELECT} ORDER BY lower(m.display_name), m.email`,
    );
    return rows.map(toAdminMailbox);
  }

  async findForAdmin(id: string): Promise<AdminMailbox> {
    const rows: AdminMailboxRow[] = await this.mailboxes.query(
      `${ADMIN_MAILBOX_SELECT} WHERE m.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('La casilla no existe');
    return toAdminMailbox(rows[0]);
  }

  /**
   * Da de alta la casilla (email + nombre visible). Queda en `needs_reconnect`
   * hasta que complete el consentimiento de Google (Fase 3).
   */
  async create(dto: CreateMailboxDto): Promise<AdminMailbox> {
    let saved: Mailbox;
    try {
      saved = await this.mailboxes.save(
        this.mailboxes.create({
          email: dto.email,
          displayName: dto.displayName,
          authType: 'oauth',
          status: 'needs_reconnect',
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err, 'mailboxes_email_key')) {
        throw new ConflictException('Ya existe una casilla con ese email');
      }
      throw err;
    }
    return {
      id: saved.id,
      email: saved.email,
      displayName: saved.displayName,
      connectedUsersCount: 0,
      status: saved.status,
    };
  }

  async update(id: string, dto: UpdateMailboxDto): Promise<AdminMailbox> {
    const result = await this.mailboxes.update({ id }, { displayName: dto.displayName });
    if (!result.affected) throw new NotFoundException('La casilla no existe');
    return this.findForAdmin(id);
  }

  /**
   * "Desconectar" = borrar la casilla y, en cascada, todos sus accesos.
   * En la Fase 3 se suma revocar el token de Google antes de borrar.
   */
  async remove(id: string): Promise<void> {
    const result = await this.mailboxes.delete({ id });
    if (!result.affected) throw new NotFoundException('La casilla no existe');
  }

  /** Placeholder hasta la Fase 3 (OAuth de Google). */
  async reconnect(id: string): Promise<never> {
    await this.assertExists(id);
    throw new NotImplementedException(
      'La reconexión con Google todavía no está disponible (Fase 3)',
    );
  }

  /** Casillas a las que el usuario tiene algún permiso (GET /me/mailboxes). */
  async listForUser(userId: string): Promise<UserMailbox[]> {
    const rows: { id: string; email: string; display_name: string }[] = await this.mailboxes.query(
      `
        SELECT m.id, m.email, m.display_name
        FROM public.mailboxes m
        JOIN public.mailbox_access a ON a.mailbox_id = m.id
        WHERE a.user_id = $1
        ORDER BY lower(m.display_name), m.email
        `,
      [userId],
    );
    return rows.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name }));
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.mailboxes.exists({ where: { id } });
    if (!exists) throw new NotFoundException('La casilla no existe');
  }
}
