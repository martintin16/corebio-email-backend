import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import request from 'supertest';
import { RequireMailboxAccess } from '../src/mailboxes/decorators/require-mailbox-access.decorator';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import { MailboxesController, MeMailboxesController } from '../src/mailboxes/mailboxes.controller';
import { MailboxesService } from '../src/mailboxes/mailboxes.service';
import type { AdminMailbox } from '../src/mailboxes/mailboxes.types';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MAILBOX_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_MAILBOX_ID = '99999999-8888-4777-8666-555555555555';

const adminMailbox: AdminMailbox = {
  id: MAILBOX_ID,
  email: 'tesoreria@corebio.org',
  displayName: 'Tesorería',
  connectedUsersCount: 2,
  status: 'needs_reconnect',
};

/** Simula un endpoint de una fase futura protegido por permisos de casilla. */
@Controller('probe/mailboxes')
class MailboxProbeController {
  @RequireMailboxAccess('read')
  @Get(':mailboxId/messages')
  read() {
    return { ok: true };
  }

  @RequireMailboxAccess('send')
  @Post(':mailboxId/messages')
  send() {
    return { ok: true };
  }
}

describe('Mailboxes (e2e)', () => {
  let t: TestApp;
  const service = {
    listForAdmin: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    reconnect: jest.fn(),
    listForUser: jest.fn(),
  };
  // USER_ID puede leer MAILBOX_ID pero no enviar; no tiene nada sobre OTHER_MAILBOX_ID.
  const accessService = {
    hasPermission: jest.fn((userId: string, mailboxId: string, permission: string) =>
      Promise.resolve(userId === USER_ID && mailboxId === MAILBOX_ID && permission === 'read'),
    ),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [MailboxesController, MeMailboxesController, MailboxProbeController],
      providers: [
        { provide: MailboxesService, useValue: service },
        { provide: MailboxAccessService, useValue: accessService },
        MailboxAccessGuard,
      ],
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const http = () => request(t.app.getHttpServer());

  describe('endpoints de admin', () => {
    it('sin token → 401', async () => {
      await http().get('/mailboxes').expect(401);
    });

    it('usuario no admin → 403', async () => {
      await http()
        .get('/mailboxes')
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(403);
      expect(service.listForAdmin).not.toHaveBeenCalled();
    });

    it('GET /mailboxes devuelve AdminMailbox[]', async () => {
      service.listForAdmin.mockResolvedValue([adminMailbox]);
      const res = await http()
        .get('/mailboxes')
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(200);
      expect(res.body).toEqual([adminMailbox]);
    });

    it('POST /mailboxes normaliza el email y devuelve 201', async () => {
      service.create.mockResolvedValue({ ...adminMailbox, connectedUsersCount: 0 });
      await http()
        .post('/mailboxes')
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ email: '  Tesoreria@Corebio.ORG ', displayName: ' Tesorería ' })
        .expect(201);
      expect(service.create).toHaveBeenCalledWith({
        email: 'tesoreria@corebio.org',
        displayName: 'Tesorería',
      });
    });

    it.each([
      [{ email: 'no-es-email', displayName: 'X' }],
      [{ email: 'a@b.org', displayName: '   ' }],
      [{ email: 'a@b.org' }],
      [{ email: 'a@b.org', displayName: 'X', status: 'connected' }],
    ])('POST /mailboxes con body inválido %p → 400', async (body) => {
      await http()
        .post('/mailboxes')
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send(body)
        .expect(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('POST /mailboxes con email repetido → 409', async () => {
      service.create.mockRejectedValue(new ConflictException());
      await http()
        .post('/mailboxes')
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ email: 'a@b.org', displayName: 'X' })
        .expect(409);
    });

    it('PATCH /mailboxes/:id cambia el nombre', async () => {
      service.update.mockResolvedValue({ ...adminMailbox, displayName: 'Nuevo' });
      const res = await http()
        .patch(`/mailboxes/${MAILBOX_ID}`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ displayName: 'Nuevo' })
        .expect(200);
      expect(res.body.displayName).toBe('Nuevo');
      expect(service.update).toHaveBeenCalledWith(MAILBOX_ID, { displayName: 'Nuevo' });
    });

    it('PATCH /mailboxes/:id no permite cambiar el email', async () => {
      await http()
        .patch(`/mailboxes/${MAILBOX_ID}`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ displayName: 'X', email: 'otro@corebio.org' })
        .expect(400);
    });

    it('id que no es uuid → 400', async () => {
      await http()
        .patch('/mailboxes/mbx_1')
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ displayName: 'X' })
        .expect(400);
      expect(service.update).not.toHaveBeenCalled();
    });

    it('DELETE /mailboxes/:id → 204', async () => {
      service.remove.mockResolvedValue(undefined);
      await http()
        .delete(`/mailboxes/${MAILBOX_ID}`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(204);
      expect(service.remove).toHaveBeenCalledWith(MAILBOX_ID);
    });

    it('DELETE de una casilla inexistente → 404', async () => {
      service.remove.mockRejectedValue(new NotFoundException());
      await http()
        .delete(`/mailboxes/${MAILBOX_ID}`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(404);
    });

    it('POST /mailboxes/:id/reconnect → 501 hasta la Fase 3', async () => {
      service.reconnect.mockRejectedValue(new NotImplementedException());
      await http()
        .post(`/mailboxes/${MAILBOX_ID}/reconnect`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(501);
    });
  });

  describe('GET /me/mailboxes', () => {
    it('sin token → 401', async () => {
      await http().get('/me/mailboxes').expect(401);
    });

    it('devuelve las casillas del usuario logueado (cualquier rol)', async () => {
      const mine = [{ id: MAILBOX_ID, email: 'tesoreria@corebio.org', displayName: 'Tesorería' }];
      service.listForUser.mockResolvedValue(mine);
      const res = await http()
        .get('/me/mailboxes')
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(200);
      expect(res.body).toEqual(mine);
      expect(service.listForUser).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe('@RequireMailboxAccess', () => {
    it('con canRead puede leer', async () => {
      await http()
        .get(`/probe/mailboxes/${MAILBOX_ID}/messages`)
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(200, { ok: true });
    });

    it('sin canSend no puede enviar → 403', async () => {
      await http()
        .post(`/probe/mailboxes/${MAILBOX_ID}/messages`)
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(403);
    });

    it('sin acceso a la casilla → 403', async () => {
      await http()
        .get(`/probe/mailboxes/${OTHER_MAILBOX_ID}/messages`)
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(403);
    });

    it('ser admin no da acceso implícito → 403', async () => {
      await http()
        .get(`/probe/mailboxes/${MAILBOX_ID}/messages`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(403);
    });

    it('mailboxId que no es uuid → 400', async () => {
      await http()
        .get('/probe/mailboxes/mbx_1/messages')
        .set('Authorization', await t.authHeader(USER_ID))
        .expect(400);
      expect(accessService.hasPermission).not.toHaveBeenCalled();
    });

    it('sin token → 401 (el guard de auth corre antes)', async () => {
      await http().get(`/probe/mailboxes/${MAILBOX_ID}/messages`).expect(401);
    });
  });
});
