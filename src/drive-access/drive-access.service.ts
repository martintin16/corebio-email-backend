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

/** Lo compartido con una cuenta, separado en directo y heredado de una carpeta. */
interface SharedState {
  /** Ítems con un permiso propio para esa cuenta (los que se tildan). */
  direct: Map<string, string | null>;
  /** Ítems a los que llega solo por estar dentro de una carpeta compartida. */
  inherited: Set<string>;
}

/** Falla al quitar un permiso; `inherited` = el permiso viene de una carpeta. */
type UnshareFailure = DriveAccessFailure & { inherited?: boolean };

export const INHERITED_REASON =
  'Tiene acceso por la carpeta que lo contiene: para quitárselo, dejá de compartir esa carpeta';

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

  /**
   * Contenido de una carpeta. `shared` = compartido directamente con la persona;
   * `inherited` = tiene acceso solo por estar dentro de una carpeta compartida.
   */
  async listItems(mailboxId: string, folderId: string, userId: string): Promise<DriveItem[]> {
    const user = await this.targetUser(mailboxId, userId);
    const apis = await this.google.forMailbox(mailboxId);
    const inFolder = `${driveQueryValue(folderId)} in parents and trashed = false`;

    const [files, state] = await Promise.all([
      this.listAll(apis, inFolder, 'folder,name_natural'),
      this.sharedState(apis, user.email),
    ]);

    return files
      .filter((f): f is drive_v3.Schema$File & { id: string } => Boolean(f.id))
      .map((f) => ({
        id: f.id,
        name: f.name ?? '(sin nombre)',
        type: f.mimeType === FOLDER_MIME ? 'folder' : 'file',
        parentId: folderId,
        shared: state.direct.has(f.id),
        inherited: !state.direct.has(f.id) && state.inherited.has(f.id),
      }));
  }

  /** Ids de lo compartido DIRECTAMENTE con la persona en el Drive de la casilla. */
  async listSharedIds(mailboxId: string, userId: string): Promise<string[]> {
    const user = await this.targetUser(mailboxId, userId);
    const apis = await this.google.forMailbox(mailboxId);
    return [...(await this.sharedState(apis, user.email)).direct.keys()];
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
    const current = (await this.sharedState(apis, user.email)).direct;
    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current.keys()].filter((id) => !desired.has(id));

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
        const failure = await this.unshare(apis, id, current.get(id) ?? null, user.email);
        if (failure) failed.push(withoutKind(failure));
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
      const direct = [...(await this.sharedState(apis, email)).direct];
      const failures = await mapWithConcurrency(direct, DRIVE_CONCURRENCY, ([id, name]) =>
        this.unshare(apis, id, name, email),
      );
      // Un permiso heredado no es una falla: se va junto con la carpeta, que
      // también está en la lista.
      result.failed = failures.filter((f) => f !== null && !f.inherited).length;
      result.removed = failures.filter((f) => f === null).length;
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

  /**
   * Lo que la cuenta tiene compartido en ítems de la casilla, separando lo
   * directo de lo heredado. La búsqueda de Drive (`in writers / in readers`)
   * devuelve las dos cosas: el contenido de una carpeta compartida también
   * aparece. Un ítem cuya carpeta también está en la lista probablemente
   * hereda: solo para esos se piden los permisos y se mira `permissionDetails`.
   * Si Google no lo informa (en Mi unidad no siempre viene), se toma como heredado.
   */
  private async sharedState(apis: MailboxGoogleApis, email: string): Promise<SharedState> {
    const files = (
      await this.listAll(apis, `'me' in owners and ${sharedWithClause(email)}`)
    ).filter((f): f is drive_v3.Schema$File & { id: string } => Boolean(f.id));
    const ids = new Set(files.map((f) => f.id));

    const direct = new Map<string, string | null>();
    const inherited = new Set<string>();
    const suspects = files.filter((f) => (f.parents ?? []).some((p) => ids.has(p)));
    for (const f of files) if (!suspects.includes(f)) direct.set(f.id, f.name ?? null);

    await mapWithConcurrency(suspects, DRIVE_CONCURRENCY, async (f) => {
      let permissions: drive_v3.Schema$Permission[];
      try {
        permissions = await this.accountPermissions(apis, f.id, email);
      } catch (err) {
        if (isGmailNotFound(err)) return; // se borró mientras tanto
        return this.google.handleGoogleError(apis.mailboxId, err);
      }
      if (permissions.some(isDirectPermission)) direct.set(f.id, f.name ?? null);
      else inherited.add(f.id);
    });
    return { direct, inherited };
  }

  /** Los permisos de la cuenta sobre un ítem (sin el de dueño). */
  private async accountPermissions(
    apis: MailboxGoogleApis,
    fileId: string,
    email: string,
  ): Promise<drive_v3.Schema$Permission[]> {
    const { data } = await apis.drive.permissions.list({
      fileId,
      fields: 'permissions(id, emailAddress, role, type, permissionDetails(inherited))',
    });
    return (data.permissions ?? []).filter(
      (p) =>
        p.id &&
        p.type === 'user' &&
        p.role !== 'owner' &&
        p.emailAddress &&
        sameDriveAccount(p.emailAddress, email),
    );
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
            fields: 'nextPageToken, files(id, name, mimeType, parents)',
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

  /**
   * Quita los permisos PROPIOS de la cuenta sobre un ítem (nunca el de dueño ni
   * uno heredado de una carpeta, que Google no deja borrar).
   */
  private async unshare(
    apis: MailboxGoogleApis,
    fileId: string,
    name: string | null,
    email: string,
  ): Promise<UnshareFailure | null> {
    try {
      const permissions = await this.accountPermissions(apis, fileId, email);
      const own = permissions.filter((p) => !isInheritedOnly(p));
      if (own.length === 0 && permissions.length > 0) {
        return { id: fileId, name, reason: INHERITED_REASON, inherited: true };
      }
      for (const permission of own) {
        await apis.drive.permissions.delete({ fileId, permissionId: permission.id ?? '' });
      }
      return null;
    } catch (err) {
      if (isInheritedPermissionError(err)) {
        return { id: fileId, name, reason: INHERITED_REASON, inherited: true };
      }
      return this.itemFailure(apis, fileId, name, err);
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

/** El mensaje de Google, completo, para mostrar junto al ítem. */
function googleReason(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : '';
  return message ? `Google rechazó el cambio: ${message}` : 'Google rechazó el cambio';
}

/** Google informa que el permiso es (al menos en parte) propio del ítem. */
function isDirectPermission(p: drive_v3.Schema$Permission): boolean {
  return (p.permissionDetails ?? []).some((d) => d.inherited === false);
}

/**
 * Permiso que viene solo de una carpeta. Sin `permissionDetails` no se sabe:
 * se intenta borrar y, si Google dice que es heredado, se trata como tal.
 */
function isInheritedOnly(p: drive_v3.Schema$Permission): boolean {
  const details = p.permissionDetails ?? [];
  return details.length > 0 && details.every((d) => d.inherited === true);
}

/** "The authenticated user cannot delete the permission. If the permission is inherited…" */
function isInheritedPermissionError(err: unknown): boolean {
  return err instanceof Error && /inherited/i.test(err.message);
}

function withoutKind(failure: UnshareFailure): DriveAccessFailure {
  return { id: failure.id, name: failure.name, reason: failure.reason };
}
