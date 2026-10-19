import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { MailboxUsersController, UsersController } from '../src/users/users.controller';
import type { AdminUser } from '../src/users/users.types';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const TARGET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const adminUser: AdminUser = {
  id: TARGET,
  name: 'Ana',
  email: 'ana@gmail.com',
  role: 'user',
  status: 'invited',
  mailboxAccess: [{ mailboxId: MBX, email: 'tesoreria@corebio.org', canSend: true, canRead: true }],
};

const validBody = {
  name: 'Ana',
  email: 'ana@gmail.com',
  role: 'user',
  access: { [MBX]: { canSend: true, canRead: true } },
};

describe('Users (e2e)', () => {
  let t: TestApp;
  const users = {
    listAdminUsers: jest.fn(),
    create: jest.fn(),
    updatePermissions: jest.fn(),
    deactivate: jest.fn(),
    remove: jest.fn(),
    resendInvite: jest.fn(),
    listMailboxAccess: jest.fn(),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [UsersController, MailboxUsersController],
      usersService: users,
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const http = () => request(t.app.getHttpServer());
  const asAdmin = () => t.authHeader(ADMIN_ID);

  describe('autorización', () => {
    it('sin token → 401', async () => {
      await http().get('/users').expect(401);
    });

    it.each([
      ['get', '/users'],
      ['post', '/users'],
      ['patch', `/users/${TARGET}/permissions`],
      ['patch', `/users/${TARGET}/deactivate`],
      ['delete', `/users/${TARGET}`],
      ['post', `/users/${TARGET}/resend-invite`],
      ['get', `/mailboxes/${MBX}/access`],
    ] as const)('usuario no admin → 403 en %s %s', async (method, path) => {
      await http()
        [method](path)
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(403);
    });
  });

  it('GET /users devuelve AdminUser[]', async () => {
    users.listAdminUsers.mockResolvedValue([adminUser]);
    const res = await http()
      .get('/users')
      .set('Authorization', await asAdmin())
      .expect(200);
    expect(res.body).toEqual([adminUser]);
  });

  describe('POST /users', () => {
    it('crea el usuario con el body normalizado → 201', async () => {
      users.create.mockResolvedValue(adminUser);
      const res = await http()
        .post('/users')
        .set('Authorization', await asAdmin())
        .send({ ...validBody, name: '  Ana ', email: ' Ana@Gmail.com ' })
        .expect(201);
      expect(res.body).toEqual(adminUser);
      expect(users.create).toHaveBeenCalledWith(validBody);
    });

    it.each([
      ['email inválido', { ...validBody, email: 'no-es-email' }],
      ['nombre vacío', { ...validBody, name: '  ' }],
      ['rol desconocido', { ...validBody, role: 'owner' }],
      [
        'access con id que no es uuid',
        { ...validBody, access: { mbx_1: { canSend: true, canRead: true } } },
      ],
      ['access con flags inválidos', { ...validBody, access: { [MBX]: { canSend: 'si' } } }],
      ['sin access', { name: 'Ana', email: 'ana@gmail.com', role: 'user' }],
      ['campo de más', { ...validBody, status: 'active' }],
    ])('400 con %s', async (_case, body) => {
      await http()
        .post('/users')
        .set('Authorization', await asAdmin())
        .send(body)
        .expect(400);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('409 si el email ya existe', async () => {
      users.create.mockRejectedValue(new ConflictException());
      await http()
        .post('/users')
        .set('Authorization', await asAdmin())
        .send(validBody)
        .expect(409);
    });

    it('400 si una casilla no existe (lo decide el servicio)', async () => {
      users.create.mockRejectedValue(new BadRequestException());
      await http()
        .post('/users')
        .set('Authorization', await asAdmin())
        .send(validBody)
        .expect(400);
    });
  });

  describe('PATCH /users/:id/permissions', () => {
    it('pasa el admin que hace el pedido, el id y el body', async () => {
      users.updatePermissions.mockResolvedValue({ ...adminUser, role: 'admin' });
      const body = { role: 'admin', access: {} };
      const res = await http()
        .patch(`/users/${TARGET}/permissions`)
        .set('Authorization', await asAdmin())
        .send(body)
        .expect(200);
      expect(res.body.role).toBe('admin');
      expect(users.updatePermissions).toHaveBeenCalledWith(ADMIN_ID, TARGET, body);
    });

    it('400 si se intenta cambiar el nombre o el email', async () => {
      await http()
        .patch(`/users/${TARGET}/permissions`)
        .set('Authorization', await asAdmin())
        .send({ role: 'user', access: {}, email: 'otro@gmail.com' })
        .expect(400);
    });

    it('409 si el admin se quita el rol a sí mismo', async () => {
      users.updatePermissions.mockRejectedValue(new ConflictException());
      await http()
        .patch(`/users/${ADMIN_ID}/permissions`)
        .set('Authorization', await asAdmin())
        .send({ role: 'user', access: {} })
        .expect(409);
    });
  });

  it('PATCH /users/:id/deactivate → 200 con el usuario', async () => {
    users.deactivate.mockResolvedValue({ ...adminUser, status: 'inactive' });
    const res = await http()
      .patch(`/users/${TARGET}/deactivate`)
      .set('Authorization', await asAdmin())
      .expect(200);
    expect(res.body.status).toBe('inactive');
    expect(users.deactivate).toHaveBeenCalledWith(ADMIN_ID, TARGET);
  });

  it('DELETE /users/:id → 204', async () => {
    users.remove.mockResolvedValue(undefined);
    await http()
      .delete(`/users/${TARGET}`)
      .set('Authorization', await asAdmin())
      .expect(204);
    expect(users.remove).toHaveBeenCalledWith(ADMIN_ID, TARGET);
  });

  it('DELETE de un usuario inexistente → 404', async () => {
    users.remove.mockRejectedValue(new NotFoundException());
    await http()
      .delete(`/users/${TARGET}`)
      .set('Authorization', await asAdmin())
      .expect(404);
  });

  it('POST /users/:id/resend-invite → 204', async () => {
    users.resendInvite.mockResolvedValue(undefined);
    await http()
      .post(`/users/${TARGET}/resend-invite`)
      .set('Authorization', await asAdmin())
      .expect(204);
    expect(users.resendInvite).toHaveBeenCalledWith(TARGET);
  });

  it('id que no es uuid → 400', async () => {
    await http()
      .delete('/users/usr_1')
      .set('Authorization', await asAdmin())
      .expect(400);
    expect(users.remove).not.toHaveBeenCalled();
  });

  it('GET /mailboxes/:id/access devuelve { user, access }[]', async () => {
    const entries = [{ user: adminUser, access: adminUser.mailboxAccess[0] }];
    users.listMailboxAccess.mockResolvedValue(entries);
    const res = await http()
      .get(`/mailboxes/${MBX}/access`)
      .set('Authorization', await asAdmin())
      .expect(200);
    expect(res.body).toEqual(entries);
    expect(users.listMailboxAccess).toHaveBeenCalledWith(MBX);
  });
});
