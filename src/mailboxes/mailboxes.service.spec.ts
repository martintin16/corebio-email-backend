import { ConflictException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { Mailbox } from './entities/mailbox.entity';
import { MailboxesService } from './mailboxes.service';

const ID = '11111111-2222-4333-8444-555555555555';

function pgError(code: string, constraint?: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT ...',
    [],
    Object.assign(new Error('pg'), { code, constraint }),
  );
}

describe('MailboxesService', () => {
  let repo: {
    query: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
  };
  let service: MailboxesService;

  beforeEach(() => {
    repo = {
      query: jest.fn(),
      create: jest.fn((data: Partial<Mailbox>) => data),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    };
    service = new MailboxesService(repo as unknown as Repository<Mailbox>);
  });

  describe('listForAdmin', () => {
    it('mapea las filas al formato AdminMailbox', async () => {
      repo.query.mockResolvedValue([
        {
          id: ID,
          email: 'tesoreria@corebio.org',
          display_name: 'Tesorería',
          status: 'connected',
          connected_users_count: '3',
        },
      ]);
      await expect(service.listForAdmin()).resolves.toEqual([
        {
          id: ID,
          email: 'tesoreria@corebio.org',
          displayName: 'Tesorería',
          connectedUsersCount: 3,
          status: 'connected',
        },
      ]);
    });
  });

  describe('findForAdmin', () => {
    it('404 si no existe', async () => {
      repo.query.mockResolvedValue([]);
      await expect(service.findForAdmin(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = { email: 'tesoreria@corebio.org', displayName: 'Tesorería' };

    it('crea la casilla en needs_reconnect, con authType oauth y 0 usuarios', async () => {
      repo.save.mockImplementation((data: Partial<Mailbox>) =>
        Promise.resolve({ id: ID, ...data }),
      );

      await expect(service.create(dto)).resolves.toEqual({
        id: ID,
        email: dto.email,
        displayName: dto.displayName,
        connectedUsersCount: 0,
        status: 'needs_reconnect',
      });
      expect(repo.create).toHaveBeenCalledWith({
        ...dto,
        authType: 'oauth',
        status: 'needs_reconnect',
      });
    });

    it('409 si el email ya existe', async () => {
      repo.save.mockRejectedValue(pgError('23505', 'mailboxes_email_key'));
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('propaga cualquier otro error de la base', async () => {
      const err = pgError('08006');
      repo.save.mockRejectedValue(err);
      await expect(service.create(dto)).rejects.toBe(err);
    });
  });

  describe('update', () => {
    it('404 si no existe', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.update(ID, { displayName: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('actualiza solo displayName y devuelve la casilla', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.query.mockResolvedValue([
        {
          id: ID,
          email: 'a@b.org',
          display_name: 'X',
          status: 'connected',
          connected_users_count: 0,
        },
      ]);
      const result = await service.update(ID, { displayName: 'X' });
      expect(repo.update).toHaveBeenCalledWith({ id: ID }, { displayName: 'X' });
      expect(result.displayName).toBe('X');
    });
  });

  describe('remove', () => {
    it('404 si no existe', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove(ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('borra la casilla', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.remove(ID)).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith({ id: ID });
    });
  });

  describe('reconnect', () => {
    it('404 si no existe', async () => {
      repo.exists.mockResolvedValue(false);
      await expect(service.reconnect(ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('501 si existe (se implementa en la Fase 3)', async () => {
      repo.exists.mockResolvedValue(true);
      await expect(service.reconnect(ID)).rejects.toBeInstanceOf(NotImplementedException);
    });
  });

  describe('listForUser', () => {
    it('mapea las casillas del usuario al formato Mailbox del frontend', async () => {
      repo.query.mockResolvedValue([{ id: ID, email: 'a@b.org', display_name: 'A' }]);
      await expect(service.listForUser('u1')).resolves.toEqual([
        { id: ID, email: 'a@b.org', displayName: 'A' },
      ]);
      expect(repo.query).toHaveBeenCalledWith(expect.any(String), ['u1']);
    });
  });
});
