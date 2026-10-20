import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DriveAccessService } from '../drive-access/drive-access.service';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { UserProfile } from './entities/user-profile.entity';
import { EmailAlreadyRegisteredError, SupabaseAdminClient } from './supabase-admin.client';
import type { AdminUser, AppRole, MailboxAccessEntry, UserStatus } from './users.types';

interface AdminUserRow {
  id: string;
  name: string;
  role: AppRole;
  status: UserStatus;
  email: string;
}

/**
 * El email no se guarda en user_profiles (se desincronizaría): se lee de
 * auth.users. El backend se conecta como `postgres`, que puede leer ese schema.
 */
const ADMIN_USER_SELECT = `
  SELECT p.id, p.name, p.role, p.status, u.email
  FROM public.user_profiles p
  JOIN auth.users u ON u.id = p.id
`;
const ADMIN_USER_ORDER = 'ORDER BY lower(p.name), u.email';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly inviteRedirectTo: string;

  constructor(
    @InjectRepository(UserProfile)
    private readonly profiles: Repository<UserProfile>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly mailboxAccess: MailboxAccessService,
    private readonly mailboxes: MailboxesService,
    private readonly supabase: SupabaseAdminClient,
    config: ConfigService,
    private readonly driveAccess: DriveAccessService,
  ) {
    const frontendUrl = config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    this.inviteRedirectTo = `${frontendUrl}/reset-password`;
  }

  // ---------------------------------------------------------------------------
  // Usado por el guard de autenticación (en cada request)
  // ---------------------------------------------------------------------------

  findProfileById(id: string): Promise<UserProfile | null> {
    return this.profiles.findOneBy({ id });
  }

  /**
   * `invited → active`. Lo llama el guard en el primer request autenticado de un
   * usuario invitado: tener una sesión válida implica que aceptó la invitación.
   */
  async markActive(id: string): Promise<void> {
    await this.profiles.update({ id, status: 'invited' }, { status: 'active' });
  }

  // ---------------------------------------------------------------------------
  // Lectura (admin)
  // ---------------------------------------------------------------------------

  async listAdminUsers(): Promise<AdminUser[]> {
    const rows: AdminUserRow[] = await this.dataSource.query(
      `${ADMIN_USER_SELECT} ${ADMIN_USER_ORDER}`,
    );
    return this.withMailboxAccess(rows);
  }

  async findAdminUser(id: string): Promise<AdminUser> {
    const rows: AdminUserRow[] = await this.dataSource.query(
      `${ADMIN_USER_SELECT} WHERE p.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('El usuario no existe');
    const [user] = await this.withMailboxAccess(rows);
    return user;
  }

  /** GET /mailboxes/:id/access — usuarios con algún permiso sobre la casilla. */
  async listMailboxAccess(mailboxId: string): Promise<MailboxAccessEntry[]> {
    await this.mailboxes.findForAdmin(mailboxId); // 404 si la casilla no existe

    const withAccess = await this.mailboxAccess.findUsersWithAccess(mailboxId);
    if (withAccess.length === 0) return [];

    const rows: AdminUserRow[] = await this.dataSource.query(
      `${ADMIN_USER_SELECT} WHERE p.id = ANY($1::uuid[]) ${ADMIN_USER_ORDER}`,
      [withAccess.map((a) => a.userId)],
    );
    const users = await this.withMailboxAccess(rows);

    const entries: MailboxAccessEntry[] = [];
    for (const user of users) {
      const access = user.mailboxAccess.find((a) => a.mailboxId === mailboxId);
      if (access) entries.push({ user, access });
    }
    return entries;
  }

  // ---------------------------------------------------------------------------
  // Escritura (admin)
  // ---------------------------------------------------------------------------

  /**
   * Alta + invitación:
   * 1. Valida el `access` y que el email no exista, ANTES de mandar ningún email.
   * 2. Supabase crea el usuario en Auth y manda la invitación; el trigger de la
   *    Fase 0 le crea el perfil.
   * 3. En una transacción: nombre/rol/estado del perfil + permisos por casilla.
   * 4. Copia el rol a `app_metadata.role` (para la UI del frontend).
   * Si 3 o 4 fallan, se borra el usuario de Auth: no quedan cuentas a medias.
   * (El email de invitación ya salió; el link deja de servir porque el usuario no existe.)
   */
  async create(dto: CreateUserDto): Promise<AdminUser> {
    await this.mailboxAccess.validateInput(dto.access);
    await this.assertEmailAvailable(dto.email);

    let userId: string;
    try {
      userId = await this.supabase.inviteUser(dto.email, {
        name: dto.name,
        redirectTo: this.inviteRedirectTo,
      });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        throw new ConflictException('Ya existe un usuario con ese email');
      }
      throw err;
    }

    try {
      await this.dataSource.transaction(async (em) => {
        await em.upsert(
          UserProfile,
          { id: userId, name: dto.name, role: dto.role, status: 'invited' },
          ['id'],
        );
        await this.mailboxAccess.replaceForUser(userId, dto.access, em);
      });
      await this.supabase.setAppRole(userId, dto.role);
    } catch (err) {
      await this.supabase.deleteUser(userId).catch((cleanupErr: unknown) => {
        this.logger.error(
          `No se pudo deshacer el alta del usuario ${userId} en Supabase Auth`,
          cleanupErr instanceof Error ? cleanupErr.stack : String(cleanupErr),
        );
      });
      throw err;
    }

    return this.findAdminUser(userId);
  }

  /**
   * Cambia rol y permisos (reemplazo completo). Un admin no puede quitarse el
   * rol a sí mismo: como quien hace el pedido es siempre un admin activo, esa
   * regla alcanza para que nunca se quede el sistema sin administradores.
   * Las casillas que pierde por completo también le quitan lo compartido en su
   * Drive (Fase 7).
   */
  async updatePermissions(
    actorId: string,
    id: string,
    dto: UpdateUserPermissionsDto,
  ): Promise<AdminUser> {
    const profile = await this.getProfileOrThrow(id);
    if (id === actorId && dto.role !== 'admin') {
      throw new ConflictException('No podés quitarte el rol de administrador a vos mismo');
    }
    const before = await this.findAdminUser(id);

    await this.dataSource.transaction(async (em) => {
      await em.update(UserProfile, { id }, { role: dto.role });
      await this.mailboxAccess.replaceForUser(id, dto.access, em);
    });

    if (profile.role !== dto.role) {
      // app_metadata.role es solo una ayuda para la UI: la autorización real lee
      // user_profiles. Si falla, se loguea pero no se revierte el cambio.
      await this.supabase.setAppRole(id, dto.role).catch((err: unknown) => {
        this.logger.warn(
          `Rol actualizado en la base pero no en app_metadata de ${id}`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    const after = await this.findAdminUser(id);
    const kept = new Set(after.mailboxAccess.map((a) => a.mailboxId));
    await this.revokeDrive(
      before.email,
      before.mailboxAccess.map((a) => a.mailboxId).filter((mailboxId) => !kept.has(mailboxId)),
    );
    return after;
  }

  /**
   * Desactiva: el guard lo bloquea en el próximo request (status en la base) y
   * además se banea en Supabase Auth para que no pueda loguearse ni renovar su
   * token. Es idempotente: si el ban falla (502), se puede reintentar.
   * También le quita lo compartido en el Drive de sus casillas (Fase 7); los
   * permisos en la app se conservan por si se lo vuelve a activar.
   */
  async deactivate(actorId: string, id: string): Promise<AdminUser> {
    if (id === actorId) throw new ConflictException('No podés desactivarte a vos mismo');
    await this.getProfileOrThrow(id);

    await this.profiles.update({ id }, { status: 'inactive' });
    await this.supabase.banUser(id);

    const user = await this.findAdminUser(id);
    await this.revokeDrive(
      user.email,
      user.mailboxAccess.map((a) => a.mailboxId),
    );
    return user;
  }

  /**
   * Borra el usuario de Supabase Auth; perfil y permisos se borran en cascada.
   * Antes de borrarlo se anotan email y casillas para quitarle lo compartido en
   * sus Drives (Fase 7).
   */
  async remove(actorId: string, id: string): Promise<void> {
    if (id === actorId) throw new ConflictException('No podés borrarte a vos mismo');
    await this.getProfileOrThrow(id);
    const user = await this.findAdminUser(id);
    await this.supabase.deleteUser(id);
    await this.revokeDrive(
      user.email,
      user.mailboxAccess.map((a) => a.mailboxId),
    );
  }

  /** Solo para usuarios que todavía no aceptaron la invitación. */
  async resendInvite(id: string): Promise<void> {
    const user = await this.findAdminUser(id);
    if (user.status !== 'invited') {
      throw new ConflictException('El usuario ya aceptó la invitación');
    }
    await this.supabase.resendInvite(user.email, this.inviteRedirectTo);
  }

  // ---------------------------------------------------------------------------

  /**
   * Quita lo compartido en el Drive de esas casillas. Nunca falla: el cambio en
   * la app ya está hecho; lo que no se pudo quitar queda en el log
   * (DriveAccessService) para hacerlo a mano.
   */
  private async revokeDrive(email: string, mailboxIds: string[]): Promise<void> {
    for (const mailboxId of mailboxIds) {
      await this.driveAccess.revokeAllForEmail(mailboxId, email);
    }
  }

  private async getProfileOrThrow(id: string): Promise<UserProfile> {
    const profile = await this.profiles.findOneBy({ id });
    if (!profile) throw new NotFoundException('El usuario no existe');
    return profile;
  }

  /** 409 si el email ya tiene una cuenta en Supabase Auth (aunque no haya aceptado). */
  private async assertEmailAvailable(email: string): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      'SELECT 1 FROM auth.users WHERE lower(email) = lower($1) LIMIT 1',
      [email],
    );
    if (rows.length > 0) throw new ConflictException('Ya existe un usuario con ese email');
  }

  private async withMailboxAccess(rows: AdminUserRow[]): Promise<AdminUser[]> {
    const access = await this.mailboxAccess.findSummariesByUser(rows.map((r) => r.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      mailboxAccess: access.get(row.id) ?? [],
    }));
  }
}
