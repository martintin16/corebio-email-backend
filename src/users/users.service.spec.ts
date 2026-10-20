import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { DriveAccessService } from '../drive-access/drive-access.service';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import type { MailboxesService } from '../mailboxes/mailboxes.service';
import { UserProfile } from './entities/user-profile.entity';
import { EmailAlreadyRegisteredError } from './supabase-admin.client';
import { UsersService } from './users.service';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MBX = '11111111-1111-4111-8111-111111111111';

const userRow = {
  id: USER,
  name: 'Ana',
  role: 'user',
  status: 'invited',
  email: 'ana@gmail.com',
};

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: USER,
    name: 'Ana',
    role: 'user',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UsersService', () => {
  let profiles: { findOneBy: jest.Mock; update: jest.Mock };
  let em: { upsert: jest.Mock; update: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let mailboxAccess: {
    validateInput: jest.Mock;
    replaceForUser: jest.Mock;
    findSummariesByUser: jest.Mock;
    findUsersWithAccess: jest.Mock;
  };
  let mailboxes: { findForAdmin: jest.Mock };
  let supabase: {
    inviteUser: jest.Mock;
    resendInvite: jest.Mock;
    setAppRole: jest.Mock;
    banUser: jest.Mock;
    deleteUser: jest.Mock;
  };
  let driveAccess: { revokeAllForEmail: jest.Mock };
  /** Filas que devuelve la consulta "¿el email ya existe en auth.users?". */
  let existingEmails: unknown[];
  /** Filas que devuelven las consultas de AdminUser. */
  let userRows: unknown[];
  let service: UsersService;

  beforeEach(() => {
    existingEmails = [];
    userRows = [userRow];
    profiles = { findOneBy: jest.fn().mockResolvedValue(profile()), update: jest.fn() };
    em = { upsert: jest.fn(), update: jest.fn() };
    dataSource = {
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('lower(email)') ? existingEmails : userRows),
      ),
      transaction: jest.fn((run: (m: EntityManager) => Promise<void>) =>
        run(em as unknown as EntityManager),
      ),
    };
    mailboxAccess = {
      validateInput: jest.fn().mockResolvedValue(undefined),
      replaceForUser: jest.fn().mockResolvedValue(undefined),
      findSummariesByUser: jest.fn((ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              [{ mailboxId: MBX, email: 'tesoreria@corebio.org', canSend: true, canRead: true }],
            ]),
          ),
        ),
      ),
      findUsersWithAccess: jest.fn().mockResolvedValue([]),
    };
    mailboxes = { findForAdmin: jest.fn().mockResolvedValue({ id: MBX }) };
    driveAccess = { revokeAllForEmail: jest.fn().mockResolvedValue({ removed: 0 }) };
    supabase = {
      inviteUser: jest.fn().mockResolvedValue(USER),
      resendInvite: jest.fn().mockResolvedValue('invite'),
      setAppRole: jest.fn().mockResolvedValue(undefined),
      banUser: jest.fn().mockResolvedValue(undefined),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    service = new UsersService(
      profiles as unknown as Repository<UserProfile>,
      dataSource as unknown as DataSource,
      mailboxAccess as unknown as MailboxAccessService,
      mailboxes as unknown as MailboxesService,
      supabase,
      new ConfigService({ FRONTEND_URL: 'https://front.test/' }),
      driveAccess as unknown as DriveAccessService,
    );
  });

  describe('lectura', () => {
    it('listAdminUsers arma AdminUser con su mailboxAccess', async () => {
      await expect(service.listAdminUsers()).resolves.toEqual([
        {
          ...userRow,
          mailboxAccess: [
            { mailboxId: MBX, email: 'tesoreria@corebio.org', canSend: true, canRead: true },
          ],
        },
      ]);
    });

    it('findAdminUser → 404 si no existe', async () => {
      userRows = [];
      await expect(service.findAdminUser(USER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('markActive solo actualiza perfiles en estado invited', async () => {
      await service.markActive(USER);
      expect(profiles.update).toHaveBeenCalledWith(
        { id: USER, status: 'invited' },
        { status: 'active' },
      );
    });
  });

  describe('listMailboxAccess', () => {
    it('404 si la casilla no existe', async () => {
      mailboxes.findForAdmin.mockRejectedValue(new NotFoundException());
      await expect(service.listMailboxAccess(MBX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('[] si nadie tiene acceso, sin consultar usuarios', async () => {
      await expect(service.listMailboxAccess(MBX)).resolves.toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('devuelve { user, access } por cada usuario con acceso', async () => {
      mailboxAccess.findUsersWithAccess.mockResolvedValue([
        { userId: USER, canSend: true, canRead: true },
      ]);
      const [entry] = await service.listMailboxAccess(MBX);
      expect(entry.user.id).toBe(USER);
      expect(entry.access).toEqual({
        mailboxId: MBX,
        email: 'tesoreria@corebio.org',
        canSend: true,
        canRead: true,
      });
    });
  });

  describe('create', () => {
    const dto = {
      name: 'Ana',
      email: 'ana@gmail.com',
      role: 'user' as const,
      access: { [MBX]: { canSend: true, canRead: true } },
    };

    it('invita, guarda perfil y permisos, sincroniza el rol y devuelve el usuario', async () => {
      const result = await service.create(dto);

      expect(mailboxAccess.validateInput).toHaveBeenCalledWith(dto.access);
      expect(supabase.inviteUser).toHaveBeenCalledWith('ana@gmail.com', {
        name: 'Ana',
        redirectTo: 'https://front.test/reset-password',
      });
      expect(em.upsert).toHaveBeenCalledWith(
        UserProfile,
        { id: USER, name: 'Ana', role: 'user', status: 'invited' },
        ['id'],
      );
      expect(mailboxAccess.replaceForUser).toHaveBeenCalledWith(USER, dto.access, em);
      expect(supabase.setAppRole).toHaveBeenCalledWith(USER, 'user');
      expect(supabase.deleteUser).not.toHaveBeenCalled();
      expect(result.id).toBe(USER);
    });

    it('409 si el email ya existe, sin mandar invitación', async () => {
      existingEmails = [{ '?column?': 1 }];
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(supabase.inviteUser).not.toHaveBeenCalled();
    });

    it('400 si el access es inválido, sin mandar invitación', async () => {
      mailboxAccess.validateInput.mockRejectedValue(new BadRequestException());
      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(supabase.inviteUser).not.toHaveBeenCalled();
    });

    it('409 si Supabase dice que el email ya está registrado', async () => {
      supabase.inviteUser.mockRejectedValue(new EmailAlreadyRegisteredError());
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('si falla guardar los permisos, borra el usuario de Auth y propaga el error', async () => {
      const err = new BadRequestException('casilla inexistente');
      mailboxAccess.replaceForUser.mockRejectedValue(err);
      await expect(service.create(dto)).rejects.toBe(err);
      expect(supabase.deleteUser).toHaveBeenCalledWith(USER);
    });

    it('si falla sincronizar el rol, también deshace el alta', async () => {
      supabase.setAppRole.mockRejectedValue(new BadGatewayException());
      await expect(service.create(dto)).rejects.toBeInstanceOf(BadGatewayException);
      expect(supabase.deleteUser).toHaveBeenCalledWith(USER);
    });

    it('si además falla el borrado de limpieza, igual propaga el error original', async () => {
      const err = new BadGatewayException('setAppRole');
      supabase.setAppRole.mockRejectedValue(err);
      supabase.deleteUser.mockRejectedValue(new Error('cleanup'));
      await expect(service.create(dto)).rejects.toBe(err);
    });
  });

  describe('updatePermissions', () => {
    const dto = { role: 'admin' as const, access: {} };

    it('404 si no existe', async () => {
      profiles.findOneBy.mockResolvedValue(null);
      await expect(service.updatePermissions(ADMIN, USER, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409 si un admin intenta quitarse el rol a sí mismo', async () => {
      profiles.findOneBy.mockResolvedValue(profile({ id: ADMIN, role: 'admin' }));
      await expect(
        service.updatePermissions(ADMIN, ADMIN, { role: 'user', access: {} }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('guarda rol y permisos en una transacción y sincroniza el rol si cambió', async () => {
      await service.updatePermissions(ADMIN, USER, dto);
      expect(em.update).toHaveBeenCalledWith(UserProfile, { id: USER }, { role: 'admin' });
      expect(mailboxAccess.replaceForUser).toHaveBeenCalledWith(USER, {}, em);
      expect(supabase.setAppRole).toHaveBeenCalledWith(USER, 'admin');
    });

    it('no llama a Supabase si el rol no cambió', async () => {
      await service.updatePermissions(ADMIN, USER, { role: 'user', access: {} });
      expect(supabase.setAppRole).not.toHaveBeenCalled();
    });

    it('si falla la sincronización del rol, no falla el pedido', async () => {
      supabase.setAppRole.mockRejectedValue(new BadGatewayException());
      await expect(service.updatePermissions(ADMIN, USER, dto)).resolves.toBeDefined();
    });

    it('si pierde una casilla por completo, le quita lo compartido en su Drive', async () => {
      mailboxAccess.findSummariesByUser
        .mockResolvedValueOnce(
          new Map([[USER, [{ mailboxId: MBX, email: 't', canSend: true, canRead: true }]]]),
        )
        .mockResolvedValueOnce(new Map([[USER, []]]));
      await service.updatePermissions(ADMIN, USER, { role: 'user', access: {} });
      expect(driveAccess.revokeAllForEmail).toHaveBeenCalledWith(MBX, 'ana@gmail.com');
    });

    it('si conserva la casilla (aunque cambien los permisos), no toca el Drive', async () => {
      await service.updatePermissions(ADMIN, USER, {
        role: 'user',
        access: { [MBX]: { canSend: false, canRead: true } },
      });
      expect(driveAccess.revokeAllForEmail).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('409 si es uno mismo', async () => {
      await expect(service.deactivate(ADMIN, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 si no existe', async () => {
      profiles.findOneBy.mockResolvedValue(null);
      await expect(service.deactivate(ADMIN, USER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('marca inactive en la base y banea en Supabase', async () => {
      await service.deactivate(ADMIN, USER);
      expect(profiles.update).toHaveBeenCalledWith({ id: USER }, { status: 'inactive' });
      expect(supabase.banUser).toHaveBeenCalledWith(USER);
    });

    it('le quita lo compartido en el Drive de todas sus casillas', async () => {
      await service.deactivate(ADMIN, USER);
      expect(driveAccess.revokeAllForEmail).toHaveBeenCalledWith(MBX, 'ana@gmail.com');
    });
  });

  describe('remove', () => {
    it('409 si es uno mismo', async () => {
      await expect(service.remove(ADMIN, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(supabase.deleteUser).not.toHaveBeenCalled();
    });

    it('404 si no existe', async () => {
      profiles.findOneBy.mockResolvedValue(null);
      await expect(service.remove(ADMIN, USER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('borra el usuario de Supabase Auth', async () => {
      await service.remove(ADMIN, USER);
      expect(supabase.deleteUser).toHaveBeenCalledWith(USER);
    });

    it('después de borrarlo, le quita lo compartido en el Drive de sus casillas', async () => {
      await service.remove(ADMIN, USER);
      expect(driveAccess.revokeAllForEmail).toHaveBeenCalledWith(MBX, 'ana@gmail.com');
      expect(supabase.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(
        driveAccess.revokeAllForEmail.mock.invocationCallOrder[0],
      );
    });

    it('si falla el borrado en Supabase, no toca el Drive', async () => {
      supabase.deleteUser.mockRejectedValue(new BadGatewayException());
      await expect(service.remove(ADMIN, USER)).rejects.toBeInstanceOf(BadGatewayException);
      expect(driveAccess.revokeAllForEmail).not.toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('409 si el usuario ya aceptó la invitación', async () => {
      userRows = [{ ...userRow, status: 'active' }];
      await expect(service.resendInvite(USER)).rejects.toBeInstanceOf(ConflictException);
      expect(supabase.resendInvite).not.toHaveBeenCalled();
    });

    it('reenvía al email del usuario con el link a /reset-password', async () => {
      await service.resendInvite(USER);
      expect(supabase.resendInvite).toHaveBeenCalledWith(
        'ana@gmail.com',
        'https://front.test/reset-password',
      );
    });
  });
});
