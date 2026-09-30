import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { MailboxAccess } from './entities/mailbox-access.entity';
import { MailboxAccessService } from './mailbox-access.service';

const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MBX_A = '11111111-1111-4111-8111-111111111111';
const MBX_B = '22222222-2222-4222-8222-222222222222';

describe('MailboxAccessService', () => {
  let repo: { findOneBy: jest.Mock; query: jest.Mock; find: jest.Mock };
  let em: { find: jest.Mock; delete: jest.Mock; insert: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: MailboxAccessService;

  beforeEach(() => {
    repo = { findOneBy: jest.fn(), query: jest.fn(), find: jest.fn() };
    em = {
      find: jest.fn().mockResolvedValue([{ id: MBX_A }, { id: MBX_B }]),
      delete: jest.fn(),
      insert: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn((run: (manager: EntityManager) => Promise<void>) =>
        run(em as unknown as EntityManager),
      ),
    };
    service = new MailboxAccessService(
      repo as unknown as Repository<MailboxAccess>,
      dataSource as unknown as DataSource,
    );
  });

  describe('permisos', () => {
    it('getPermissions devuelve null si no hay fila', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.getPermissions(USER, MBX_A)).resolves.toBeNull();
    });

    it('hasPermission distingue read de send', async () => {
      repo.findOneBy.mockResolvedValue({ canRead: true, canSend: false });
      await expect(service.hasPermission(USER, MBX_A, 'read')).resolves.toBe(true);
      await expect(service.hasPermission(USER, MBX_A, 'send')).resolves.toBe(false);
    });

    it('hasPermission es false sin fila', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.hasPermission(USER, MBX_A, 'read')).resolves.toBe(false);
    });
  });

  describe('findSummariesByUser', () => {
    it('no consulta la base si no hay usuarios', async () => {
      await expect(service.findSummariesByUser([])).resolves.toEqual(new Map());
      expect(repo.query).not.toHaveBeenCalled();
    });

    it('agrupa por usuario y deja [] a quien no tiene accesos', async () => {
      const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      repo.query.mockResolvedValue([
        {
          user_id: USER,
          mailbox_id: MBX_A,
          email: 'a@corebio.org',
          can_send: true,
          can_read: true,
        },
        {
          user_id: USER,
          mailbox_id: MBX_B,
          email: 'b@corebio.org',
          can_send: false,
          can_read: true,
        },
      ]);

      const result = await service.findSummariesByUser([USER, other]);

      expect(result.get(USER)).toEqual([
        { mailboxId: MBX_A, email: 'a@corebio.org', canSend: true, canRead: true },
        { mailboxId: MBX_B, email: 'b@corebio.org', canSend: false, canRead: true },
      ]);
      expect(result.get(other)).toEqual([]);
    });
  });

  describe('replaceForUser', () => {
    it('borra los permisos anteriores e inserta solo los que tienen algún true', async () => {
      await service.replaceForUser(USER, {
        [MBX_A]: { canSend: true, canRead: false },
        [MBX_B]: { canSend: false, canRead: false },
      });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(em.delete).toHaveBeenCalledWith(MailboxAccess, { userId: USER });
      expect(em.insert).toHaveBeenCalledWith(MailboxAccess, [
        { userId: USER, mailboxId: MBX_A, canSend: true, canRead: false },
      ]);
    });

    it('con todo en false deja al usuario sin accesos', async () => {
      await service.replaceForUser(USER, { [MBX_A]: { canSend: false, canRead: false } });
      expect(em.delete).toHaveBeenCalled();
      expect(em.insert).not.toHaveBeenCalled();
    });

    it('con {} deja al usuario sin accesos sin consultar casillas', async () => {
      await service.replaceForUser(USER, {});
      expect(em.find).not.toHaveBeenCalled();
      expect(em.delete).toHaveBeenCalledWith(MailboxAccess, { userId: USER });
    });

    it('400 si un id no es uuid, sin tocar la base', async () => {
      await expect(
        service.replaceForUser(USER, { mbx_1: { canSend: true, canRead: true } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('400 si una casilla no existe, sin borrar nada', async () => {
      em.find.mockResolvedValue([{ id: MBX_A }]);
      await expect(
        service.replaceForUser(USER, {
          [MBX_A]: { canSend: true, canRead: true },
          [MBX_B]: { canSend: true, canRead: true },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(em.delete).not.toHaveBeenCalled();
    });

    it('usa el EntityManager recibido en vez de abrir otra transacción', async () => {
      await service.replaceForUser(
        USER,
        { [MBX_A]: { canSend: false, canRead: true } },
        em as unknown as EntityManager,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(em.insert).toHaveBeenCalled();
    });
  });
});
