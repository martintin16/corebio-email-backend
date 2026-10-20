import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { drive_v3 } from 'googleapis';
import { DataSource } from 'typeorm';
import { mapWithConcurrency } from '../common/concurrency';
import {
  GoogleMailboxClient,
  isInvalidGrant,
  type MailboxGoogleApis,
} from '../google/google-mailbox-client';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { isGmailNotFound } from '../messages/messages.service';
import type {
  DriveAccessFailure,
  DriveAccessResult,
  DriveItem,
  DriveRevokeResult,
} from './drive-access.types';
import {
  FOLDER_MIME,
  sameDriveAccount,
  driveAccountEmail,
  sharedWithClause,
  driveQueryValue,
} from './drive-query';

/** Permiso con el que se comparte (decisión de la Fase 7: Editor). */
export const SHARE_ROLE = 'writer';
/** Pedidos a Drive en paralelo al aplicar cambios (cuota por usuario de la API). */
const DRIVE_CONCURRENCY = 3;
/** Tope de páginas al listar (1000 ítems por página). */
const MAX_PAGES = 10;

interface TargetUser {
  id: string;
  email: string;
  status: string;
}

/**
 * Compartir carpetas y archivos del Drive de una casilla con una persona de la
 * app, con la Drive API y el permiso de Google de la casilla (Fase 3).
 *
 * Drive es la fuente de verdad (no hay tabla propia): "compartido" quiere decir
 * que en Drive esa cuenta tiene acceso de lectura o edición al ítem. Solo se
 * tocan ítems de los que la casilla es dueña, para no quitarle a nadie un
 * acceso que le dio otra persona.
 */
@Injectable()
export class DriveAccessService {
  private readonly logger = new Logger(DriveAccessService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly google: GoogleMailboxClient,
    private readonly access: MailboxAccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Explorador (admin)
  // ---------------------------------------------------------------------------

  /** Contenido de una carpeta, con `shared` según la persona pedida. */
  async listItems(mailboxId: string, folderId: string, userId: string): Promise<DriveItem[]> {
    const user = await this.targetUser(mailboxId, userId);
    const apis = await this.google.forMailbox(mailboxId);
    const inFolder = `${driveQueryValue(folderId)} in parents and trashed = false`;

    const [files, shared] = await Promise.all([
      this.listAll(apis, inFolder, 'folder,name_natural'),
      this.listAll(apis, `${inFolder} and 'me' in owners and ${sharedWithClause(user.email)}`),
    ]);
    const sharedIds = new Set(shared.map((f) => f.id));

    return files
      .filter((f): f is drive_v3.Schema$File & { id: string } => Boolean(f.id))
      .map((f) => ({
        id: f.id,
        name: f.name ?? '(sin nombre)',
        type: f.mimeType === FOLDER_MIME ? 'folder' : 'file',
        parentId: folderId,
        shared: sharedIds.has(f.id),
      }));
  }

  /** Ids de todo lo que la persona tiene compartido en el Drive de la casilla. */
  async listSharedIds(mailboxId: string, userId: string): Promise<string[]> {
    const user = await this.targetUser(mailboxId, userId);
    const apis = await this.google.forMailbox(mailboxId);
    return this.sharedIds(apis, user.email);
  }

  // ---------------------------------------------------------------------------
  // Guardar la selección (admin)
  // ---------------------------------------------------------------------------

  /**
   * Recibe la selección FINAL: comparte lo nuevo (como Editor) y quita lo que
   * se destildó. Cada ítem se aplica por separado: si uno falla, el resto se
   * aplica igual y el que falló vuelve en `failed` con el motivo.
   */
  async applyAccess(
    mailboxId: string,
    userId: string,
    itemIds: string[],
  ): Promise<DriveAccessResult> {
    const user = await this.targetUser(mailboxId, userId);
    if (user.status === 'inactive') {
      throw new ConflictException('La persona está desactivada: no se le puede compartir nada');
    }
    const apis = await this.google.forMailbox(mailboxId);
    if (sameDriveAccount(user.email, apis.email)) {
      throw new BadRequestException('La persona usa la misma cuenta de Google que la casilla');
    }

    const desired = new Set(itemIds);
    const current = new Set(await this.sharedIds(apis, user.email));
    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    const failed: DriveAccessFailure[] = [];
    const added = (
      await mapWithConcurrency(toAdd, DRIVE_CONCURRENCY, async (id) => {
        const failure = await this.share(apis, id, user.email);
        if (failure) failed.push(failure);
        return failure ? null : id;
      })
    ).filter((id): id is string => id !== null);
    const removed = (
      await mapWithConcurrency(toRemove, DRIVE_CONCURRENCY, async (id) => {
        const failure = await this.unshare(apis, id, user.email);
        if (failure) failed.push(failure);
        return failure ? null : id;
      })
    ).filter((id): id is string => id !== null);

    return { added, removed, failed };
  }

  // ---------------------------------------------------------------------------
  // Revocación automática (la usa UsersService)
  // ---------------------------------------------------------------------------

  /**
   * Le quita a una cuenta todo lo compartido en el Drive de una casilla. Se usa
   * cuando la persona pierde el acceso a la casilla (permisos, desactivar,
   * borrar). Nunca tira error: el cambio en la app ya se hizo y no se deshace;
   * lo que no se pudo quitar queda en el log y en el resultado.
   */
  async revokeAllForEmail(mailboxId: string, email: string): Promise<DriveRevokeResult> {
    const result: DriveRevokeResult = { mailboxId, removed: 0, failed: 0, error: null };
    try {
      const apis = await this.google.forMailbox(mailboxId);
      if (sameDriveAccount(email, apis.email)) return result;
      const ids = await this.sharedIds(apis, email);
      const failures = await mapWithConcurrency(ids, DRIVE_CONCURRENCY, (id) =>
        this.unshare(apis, id, email),
      );
      result.failed = failures.filter(Boolean).length;
      result.removed = ids.length - result.failed;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    if (result.error || result.failed > 0) {
      this.logger.warn(
        `Drive de ${mailboxId}: no se pudo quitar todo el acceso de ${email} ` +
          `(quitados ${result.removed}, fallaron ${result.failed}${result.error ? `, error: ${result.error}` : ''})`,
      );
    } else if (result.removed > 0) {
      this.logger.log(
        `Drive de ${mailboxId}: se quitó el acceso de ${email} a ${result.removed} ítems`,
      );
    }
    return result;
  }

  // ---------------------------------------------------------------------------

  /** La persona, su email y que tenga algún acceso a la casilla en la app. */
  private async targetUser(mailboxId: string, userId: string): Promise<TargetUser> {
    const rows = await this.dataSource.query<TargetUser[]>(
      `SELECT p.id, u.email, p.status
         FROM public.user_profiles p
         JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1`,
      [userId],
    );
    const user = rows[0];
    if (!user) throw new NotFoundException('El usuario no existe');
    if (!(await this.access.getPermissions(userId, mailboxId))) {
      throw new BadRequestException('La persona no tiene acceso a esta casilla');
    }
    return user;
  }

  private async sharedIds(apis: MailboxGoogleApis, email: string): Promise<string[]> {
    const files = await this.listAll(apis, `'me' in owners and ${sharedWithClause(email)}`);
    return files.map((f) => f.id).filter((id): id is string => Boolean(id));
  }

  private async listAll(
    apis: MailboxGoogleApis,
    q: string,
    orderBy?: string,
  ): Promise<drive_v3.Schema$File[]> {
    return this.call(
      apis.mailboxId,
      async () => {
        const files: drive_v3.Schema$File[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data } = await apis.drive.files.list({
            q,
            orderBy,
            pageSize: 1000,
            pageToken,
            fields: 'nextPageToken, files(id, name, mimeType)',
            spaces: 'drive',
          });
          files.push(...(data.files ?? []));
          pageToken = data.nextPageToken ?? undefined;
          if (!pageToken) break;
        }
        return files;
      },
      'La carpeta no existe',
    );
  }

  /** Comparte un ítem como Editor. Devuelve el motivo si no se pudo. */
  private async share(
    apis: MailboxGoogleApis,
    fileId: string,
    email: string,
  ): Promise<DriveAccessFailure | null> {
    if (fileId === 'root') {
      return { id: fileId, name: 'Mi unidad', reason: 'Mi unidad no se puede compartir entera' };
    }
    let name: string | null = null;
    try {
      const { data: file } = await apis.drive.files.get({
        fileId,
        fields: 'id, name, ownedByMe, trashed, capabilities(canShare)',
      });
      name = file.name ?? null;
      if (!file.ownedByMe) return { id: fileId, name, reason: 'No es de la casilla' };
      if (file.trashed) return { id: fileId, name, reason: 'Está en la papelera' };
      if (file.capabilities?.canShare === false) {
        return { id: fileId, name, reason: 'La casilla no puede compartirlo' };
      }
      await apis.drive.permissions.create({
        fileId,
        sendNotificationEmail: true,
        fields: 'id',
        requestBody: { type: 'user', role: SHARE_ROLE, emailAddress: driveAccountEmail(email) },
      });
      return null;
    } catch (err) {
      return this.itemFailure(apis, fileId, name, err);
    }
  }

  /** Quita los permisos de la cuenta sobre un ítem (nunca el de dueño). */
  private async unshare(
    apis: MailboxGoogleApis,
    fileId: string,
    email: string,
  ): Promise<DriveAccessFailure | null> {
    try {
      const { data } = await apis.drive.permissions.list({
        fileId,
        fields: 'permissions(id, emailAddress, role, type)',
      });
      const mine = (data.permissions ?? []).filter(
        (p) =>
          p.id &&
          p.type === 'user' &&
          p.role !== 'owner' &&
          p.emailAddress &&
          sameDriveAccount(p.emailAddress, email),
      );
      for (const permission of mine) {
        await apis.drive.permissions.delete({ fileId, permissionId: permission.id ?? '' });
      }
      return null;
    } catch (err) {
      return this.itemFailure(apis, fileId, null, err);
    }
  }

  /**
   * Error de un ítem: si la casilla perdió el permiso de Google se corta todo
   * (409 needs_reconnect); si no, queda como falla de ese ítem.
   */
  private async itemFailure(
    apis: MailboxGoogleApis,
    fileId: string,
    name: string | null,
    err: unknown,
  ): Promise<DriveAccessFailure> {
    if (isInvalidGrant(err)) return this.google.handleGoogleError(apis.mailboxId, err);
    if (isGmailNotFound(err))
      return { id: fileId, name, reason: 'No existe en el Drive de la casilla' };
    this.logger.warn(
      `Drive de ${apis.mailboxId}: falló el ítem ${fileId}`,
      err instanceof Error ? err.message : String(err),
    );
    return { id: fileId, name, reason: googleReason(err) };
  }

  private async call<T>(mailboxId: string, fn: () => Promise<T>, notFound: string): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isGmailNotFound(err)) throw new NotFoundException(notFound);
      return this.google.handleGoogleError(mailboxId, err);
    }
  }
}

/** Mensaje corto de un error de Google para mostrar junto al ítem. */
function googleReason(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  return message
    ? `Google rechazó el cambio: ${message.slice(0, 200)}`
    : 'Google rechazó el cambio';
}
