import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  type GoogleMailboxClient,
  MailboxNeedsReconnectException,
} from '../google/google-mailbox-client';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { DriveAccessService, INHERITED_REASON, SHARE_ROLE } from './drive-access.service';
import {
  driveAccountEmail,
  driveQueryValue,
  sameDriveAccount,
  sharedWithClause,
} from './drive-query';

const MBX = '11111111-1111-4111-8111-111111111111';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOLDER = '1AbCdEfGhIjKlMnOp';

describe('drive-query', () => {
  it('driveAccountEmail saca el +alias de Gmail (es la misma cuenta)', () => {
    expect(driveAccountEmail(' Martin+Lector@Gmail.com ')).toBe('martin@gmail.com');
    expect(driveAccountEmail('ana+x@corebio.org')).toBe('ana+x@corebio.org');
  });

  it('sameDriveAccount ignora +alias, puntos y mayúsculas en Gmail', () => {
    expect(sameDriveAccount('m.a.r.tin+lector@gmail.com', 'MARTIN@googlemail.com')).toBe(true);
    expect(sameDriveAccount('ana@gmail.com', 'otra@gmail.com')).toBe(false);
  });

  it('escapa comillas y barras en la consulta', () => {
    expect(driveQueryValue("o'brien\\x")).toBe("'o\\'brien\\\\x'");
    expect(sharedWithClause('ana+x@gmail.com')).toBe(
      "('ana@gmail.com' in writers or 'ana@gmail.com' in readers)",
    );
  });
});

describe('DriveAccessService', () => {
  let userRows: { id: string; email: string; status: string }[];
  let hasAccess: boolean;
  let dataSource: { query: jest.Mock };
  let access: { getPermissions: jest.Mock };
  let drive: {
    files: { list: jest.Mock; get: jest.Mock };
    permissions: { create: jest.Mock; list: jest.Mock; delete: jest.Mock };
  };
  let google: { forMailbox: jest.Mock; handleGoogleError: jest.Mock };
  let service: DriveAccessService;

  /** Respuesta de files.list según la consulta: "compartidos" o contenido de carpeta. */
  let sharedFiles: { id: string; name: string; mimeType: string; parents?: string[] }[];
  let folderFiles: { id: string; name: string; mimeType: string }[];

  beforeEach(() => {
    userRows = [{ id: USER, email: 'ana+app@gmail.com', status: 'active' }];
    hasAccess = true;
    sharedFiles = [{ id: 'file_shared', name: 'Compartido.xlsx', mimeType: 'x' }];
    folderFiles = [
      { id: 'f_folder', name: 'Balances', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'file_shared', name: 'Compartido.xlsx', mimeType: 'x' },
    ];
    dataSource = { query: jest.fn(() => Promise.resolve(userRows)) };
    access = {
      getPermissions: jest.fn(() =>
        Promise.resolve(hasAccess ? { canRead: true, canSend: false } : null),
      ),
    };
    drive = {
      files: {
        list: jest.fn(({ q }: { q: string }) =>
          Promise.resolve({
            data: { files: q.includes('in writers') ? sharedFiles : folderFiles },
          }),
        ),
        get: jest.fn(({ fileId }: { fileId: string }) =>
          Promise.resolve({
            data: { id: fileId, name: `Nombre ${fileId}`, ownedByMe: true, trashed: false },
          }),
        ),
      },
      permissions: {
        create: jest.fn().mockResolvedValue({ data: { id: 'perm1' } }),
        list: jest.fn().mockResolvedValue({
          data: {
            permissions: [
              { id: 'owner', type: 'user', role: 'owner', emailAddress: 'casilla@gmail.com' },
              { id: 'pAna', type: 'user', role: 'writer', emailAddress: 'ana@gmail.com' },
              { id: 'pOtra', type: 'user', role: 'writer', emailAddress: 'otra@gmail.com' },
            ],
          },
        }),
        delete: jest.fn().mockResolvedValue({ data: {} }),
      },
    };
    google = {
      forMailbox: jest.fn((mailboxId: string) =>
        Promise.resolve({ mailboxId, email: 'casilla@gmail.com', displayName: 'C', drive }),
      ),
      handleGoogleError: jest.fn(() => Promise.reject(new BadGatewayException())),
    };
    service = new DriveAccessService(
      dataSource as unknown as DataSource,
      google as unknown as GoogleMailboxClient,
      access as unknown as MailboxAccessService,
    );
  });

  describe('explorador', () => {
    it('lista la carpeta con "shared" según la persona y sin la papelera', async () => {
      const items = await service.listItems(MBX, FOLDER, USER);
      expect(items).toEqual([
        {
          id: 'f_folder',
          name: 'Balances',
          type: 'folder',
          parentId: FOLDER,
          shared: false,
          inherited: false,
        },
        {
          id: 'file_shared',
          name: 'Compartido.xlsx',
          type: 'file',
          parentId: FOLDER,
          shared: true,
          inherited: false,
        },
      ]);
      const queries = drive.files.list.mock.calls.map(([p]: [{ q: string }]) => p.q);
      expect(queries[0]).toBe(`'${FOLDER}' in parents and trashed = false`);
      expect(queries[1]).toContain("'me' in owners");
      expect(queries[1]).toContain("'ana@gmail.com' in writers");
    });

    it('pagina hasta juntar todo', async () => {
      drive.files.list
        .mockResolvedValueOnce({ data: { files: [folderFiles[0]], nextPageToken: 'p2' } })
        .mockResolvedValueOnce({ data: { files: [folderFiles[1]] } });
      expect(await service.listSharedIds(MBX, USER)).toEqual(['f_folder', 'file_shared']);
      expect(drive.files.list.mock.calls[1][0]).toEqual(
        expect.objectContaining({ pageToken: 'p2' }),
      );
    });

    it('404 si el usuario no existe; 400 si no tiene acceso a la casilla', async () => {
      userRows = [];
      await expect(service.listSharedIds(MBX, USER)).rejects.toBeInstanceOf(NotFoundException);
      userRows = [{ id: USER, email: 'ana@gmail.com', status: 'active' }];
      hasAccess = false;
      await expect(service.listSharedIds(MBX, USER)).rejects.toBeInstanceOf(BadRequestException);
      expect(google.forMailbox).not.toHaveBeenCalled();
    });

    it('carpeta inexistente → 404; otros errores de Google → handleGoogleError', async () => {
      drive.files.list.mockRejectedValueOnce({ status: 404 });
      await expect(service.listItems(MBX, FOLDER, USER)).rejects.toBeInstanceOf(NotFoundException);
      drive.files.list.mockRejectedValue(new Error('boom'));
      await expect(service.listItems(MBX, FOLDER, USER)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('guardar la selección', () => {
    it('comparte lo nuevo como Editor, quita lo destildado y deja lo que ya estaba', async () => {
      sharedFiles = [
        { id: 'keep', name: 'k', mimeType: 'x' },
        { id: 'drop', name: 'd', mimeType: 'x' },
      ];
      const result = await service.applyAccess(MBX, USER, ['keep', 'new1']);

      expect(result).toEqual({ added: ['new1'], removed: ['drop'], failed: [] });
      expect(drive.permissions.create).toHaveBeenCalledTimes(1);
      expect(drive.permissions.create).toHaveBeenCalledWith({
        fileId: 'new1',
        sendNotificationEmail: true,
        fields: 'id',
        requestBody: { type: 'user', role: SHARE_ROLE, emailAddress: 'ana@gmail.com' },
      });
      expect(SHARE_ROLE).toBe('writer');
      // Solo el permiso de esa persona, nunca el del dueño ni el de otros.
      expect(drive.permissions.delete).toHaveBeenCalledTimes(1);
      expect(drive.permissions.delete).toHaveBeenCalledWith({
        fileId: 'drop',
        permissionId: 'pAna',
      });
    });

    it('cada ítem que no se puede compartir vuelve en failed con el motivo; el resto se aplica', async () => {
      sharedFiles = [];
      drive.files.get.mockImplementation(({ fileId }: { fileId: string }) => {
        if (fileId === 'ajeno') {
          return Promise.resolve({ data: { id: fileId, name: 'De otro', ownedByMe: false } });
        }
        if (fileId === 'tacho') {
          return Promise.resolve({
            data: { id: fileId, name: 'Viejo', ownedByMe: true, trashed: true },
          });
        }
        if (fileId === 'no_existe') {
          return Promise.reject(Object.assign(new Error('Not Found'), { status: 404 }));
        }
        return Promise.resolve({ data: { id: fileId, name: 'Ok', ownedByMe: true } });
      });

      const result = await service.applyAccess(MBX, USER, [
        'ajeno',
        'tacho',
        'no_existe',
        'root',
        'ok',
      ]);
      expect(result.added).toEqual(['ok']);
      expect(result.failed).toEqual(
        expect.arrayContaining([
          { id: 'ajeno', name: 'De otro', reason: 'No es de la casilla' },
          { id: 'tacho', name: 'Viejo', reason: 'Está en la papelera' },
          { id: 'no_existe', name: null, reason: 'No existe en el Drive de la casilla' },
          { id: 'root', name: 'Mi unidad', reason: 'Mi unidad no se puede compartir entera' },
        ]),
      );
      expect(drive.permissions.create).toHaveBeenCalledTimes(1);
    });

    it('si Google rechaza un permiso, queda en failed con el motivo', async () => {
      sharedFiles = [];
      drive.permissions.create.mockRejectedValue(new Error('Bad Request'));
      const result = await service.applyAccess(MBX, USER, ['x1']);
      expect(result.failed).toEqual([
        { id: 'x1', name: 'Nombre x1', reason: 'Google rechazó el cambio: Bad Request' },
      ]);
    });

    it('si la casilla perdió el permiso de Google, corta todo con 409', async () => {
      sharedFiles = [];
      drive.permissions.create.mockRejectedValue({
        response: { data: { error: 'invalid_grant' } },
      });
      google.handleGoogleError.mockRejectedValue(new MailboxNeedsReconnectException());
      await expect(service.applyAccess(MBX, USER, ['x1'])).rejects.toBeInstanceOf(
        MailboxNeedsReconnectException,
      );
    });

    it('409 si la persona está desactivada', async () => {
      userRows = [{ id: USER, email: 'ana@gmail.com', status: 'inactive' }];
      await expect(service.applyAccess(MBX, USER, ['x1'])).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('400 si la persona usa la misma cuenta de Google que la casilla', async () => {
      userRows = [{ id: USER, email: 'casilla+yo@gmail.com', status: 'active' }];
      await expect(service.applyAccess(MBX, USER, ['x1'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('permisos heredados de una carpeta', () => {
    /** La carpeta compartida y dos archivos adentro (Drive los devuelve a todos). */
    beforeEach(() => {
      sharedFiles = [
        { id: 'carpeta', name: 'Carpeta', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'hijo', name: 'Hijo.pdf', mimeType: 'x', parents: ['carpeta'] },
        { id: 'propio', name: 'Propio.pdf', mimeType: 'x', parents: ['carpeta'] },
      ] as typeof sharedFiles;
      folderFiles = sharedFiles.slice(1);
      drive.permissions.list.mockImplementation(({ fileId }: { fileId: string }) => {
        const details =
          fileId === 'propio'
            ? [{ inherited: true }, { inherited: false }]
            : fileId === 'hijo'
              ? [{ inherited: true }]
              : [{ inherited: false }];
        return Promise.resolve({
          data: {
            permissions: [
              { id: 'owner', type: 'user', role: 'owner', emailAddress: 'casilla@gmail.com' },
              {
                id: `p-${fileId}`,
                type: 'user',
                role: 'writer',
                emailAddress: 'ana@gmail.com',
                permissionDetails: details,
              },
            ],
          },
        });
      });
    });

    it('lo que hereda no cuenta como compartido; lo que tiene permiso propio, sí', async () => {
      expect(await service.listSharedIds(MBX, USER)).toEqual(
        expect.arrayContaining(['carpeta', 'propio']),
      );
      expect(await service.listSharedIds(MBX, USER)).not.toContain('hijo');
      // Solo se piden permisos de los que están dentro de una carpeta de la lista.
      const asked = drive.permissions.list.mock.calls.map(([p]: [{ fileId: string }]) => p.fileId);
      expect(asked).not.toContain('carpeta');
    });

    it('el explorador marca el heredado como inherited (sin tildar)', async () => {
      const items = await service.listItems(MBX, 'carpeta', USER);
      expect(items.find((i) => i.id === 'hijo')).toEqual(
        expect.objectContaining({ shared: false, inherited: true }),
      );
      expect(items.find((i) => i.id === 'propio')).toEqual(
        expect.objectContaining({ shared: true, inherited: false }),
      );
    });

    it('sin permissionDetails, uno de adentro de una carpeta compartida se toma como heredado', async () => {
      drive.permissions.list.mockResolvedValue({
        data: {
          permissions: [
            { id: 'pAna', type: 'user', role: 'writer', emailAddress: 'ana@gmail.com' },
          ],
        },
      });
      expect(await service.listSharedIds(MBX, USER)).toEqual(['carpeta']);
    });

    it('dejar de compartir la carpeta no intenta quitar los heredados', async () => {
      const result = await service.applyAccess(MBX, USER, ['propio']);
      expect(result).toEqual({ added: [], removed: ['carpeta'], failed: [] });
      expect(drive.permissions.delete).toHaveBeenCalledTimes(1);
      expect(drive.permissions.delete).toHaveBeenCalledWith({
        fileId: 'carpeta',
        permissionId: 'p-carpeta',
      });
    });

    it('si Google igual dice "inherited", el motivo es claro y trae el nombre', async () => {
      drive.permissions.delete.mockRejectedValue(
        new Error(
          'The authenticated user cannot delete the permission. If the permission is inherited, it must be removed from the parent.',
        ),
      );
      const result = await service.applyAccess(MBX, USER, ['carpeta']);
      expect(result.failed).toEqual([
        { id: 'propio', name: 'Propio.pdf', reason: INHERITED_REASON },
      ]);
    });

    it('en la revocación automática, un heredado no cuenta como falla', async () => {
      drive.permissions.delete.mockImplementation(({ fileId }: { fileId: string }) =>
        fileId === 'propio'
          ? Promise.reject(new Error('cannot delete: the permission is inherited'))
          : Promise.resolve({ data: {} }),
      );
      expect(await service.revokeAllForEmail(MBX, 'ana@gmail.com')).toEqual({
        mailboxId: MBX,
        removed: 1,
        failed: 0,
        error: null,
      });
    });
  });

  it('el motivo de un error de Google va completo', async () => {
    sharedFiles = [];
    const long = `Bad Request: ${'x'.repeat(300)} (detalle)`;
    drive.permissions.create.mockRejectedValue(new Error(long));
    const result = await service.applyAccess(MBX, USER, ['x1']);
    expect(result.failed[0].reason).toBe(`Google rechazó el cambio: ${long}`);
  });

  describe('revocación automática', () => {
    it('quita todo lo compartido de las que son de la casilla', async () => {
      sharedFiles = [
        { id: 'a', name: 'a', mimeType: 'x' },
        { id: 'b', name: 'b', mimeType: 'x' },
      ];
      const result = await service.revokeAllForEmail(MBX, 'ana@gmail.com');
      expect(result).toEqual({ mailboxId: MBX, removed: 2, failed: 0, error: null });
      expect(drive.permissions.delete).toHaveBeenCalledTimes(2);
      expect(drive.files.list.mock.calls[0][0].q).toContain("'me' in owners");
    });

    it('nunca tira error: cuenta las fallas y anota si no pudo empezar', async () => {
      drive.permissions.delete.mockRejectedValue(new Error('500'));
      expect(await service.revokeAllForEmail(MBX, 'ana@gmail.com')).toEqual(
        expect.objectContaining({ removed: 0, failed: 1, error: null }),
      );

      google.forMailbox.mockRejectedValue(new MailboxNeedsReconnectException());
      const result = await service.revokeAllForEmail(MBX, 'ana@gmail.com');
      expect(result.error).toMatch(/reconectarse/);
    });
  });
});
