import request from 'supertest';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import {
  MailboxTemplatesController,
  TemplatesController,
} from '../src/templates/templates.controller';
import { TemplatesService } from '../src/templates/templates.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const TPL = '44444444-4444-4444-8444-444444444444';

/**
 * Permisos simulados:
 * - USER_ID: lee y envía en MBX.
 * - ADMIN_ID: solo lee MBX (sin canSend no usa ni gestiona plantillas).
 */
const permissions: Record<string, Record<string, { read: boolean; send: boolean }>> = {
  [USER_ID]: { [MBX]: { read: true, send: true } },
  [ADMIN_ID]: { [MBX]: { read: true, send: false } },
};

describe('Templates (e2e)', () => {
  let t: TestApp;
  const templates = {
    listForMailbox: jest.fn(),
    findForUser: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const access = {
    hasPermission: jest.fn((userId: string, mailboxId: string, p: 'read' | 'send') =>
      Promise.resolve(permissions[userId]?.[mailboxId]?.[p] ?? false),
    ),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [MailboxTemplatesController, TemplatesController],
      providers: [
        { provide: TemplatesService, useValue: templates },
        { provide: MailboxAccessService, useValue: access },
        MailboxAccessGuard,
      ],
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    templates.listForMailbox.mockResolvedValue([]);
    templates.create.mockResolvedValue({ id: TPL });
    templates.update.mockResolvedValue({ id: TPL });
    templates.findForUser.mockResolvedValue({ id: TPL });
    templates.remove.mockResolvedValue(undefined);
  });

  const http = () => request(t.app.getHttpServer());
  const asUser = () => t.authHeader(USER_ID);

  describe('por casilla', () => {
    it('lista con canSend', async () => {
      await http()
        .get(`/mailboxes/${MBX}/templates`)
        .set('Authorization', await asUser())
        .expect(200, []);
      expect(templates.listForMailbox).toHaveBeenCalledWith(MBX);
    });

    it('con solo canRead no puede listar ni crear → 403', async () => {
      const auth = await t.authHeader(ADMIN_ID);
      await http().get(`/mailboxes/${MBX}/templates`).set('Authorization', auth).expect(403);
      await http()
        .post(`/mailboxes/${MBX}/templates`)
        .set('Authorization', auth)
        .send({ name: 'x', body: '<p>x</p>' })
        .expect(403);
      expect(templates.create).not.toHaveBeenCalled();
    });

    it('401 sin token', async () => {
      await http().get(`/mailboxes/${MBX}/templates`).expect(401);
    });

    it('crea → 201 con usuario, casilla y DTO limpio', async () => {
      await http()
        .post(`/mailboxes/${MBX}/templates`)
        .set('Authorization', await asUser())
        .send({ name: '  Bienvenida ', subject: ' Hola ', body: '<p>Hola</p>' })
        .expect(201, { id: TPL });
      expect(templates.create).toHaveBeenCalledWith(USER_ID, MBX, {
        name: 'Bienvenida',
        subject: 'Hola',
        body: '<p>Hola</p>',
      });
    });

    it('sin asunto también vale', async () => {
      await http()
        .post(`/mailboxes/${MBX}/templates`)
        .set('Authorization', await asUser())
        .send({ name: 'Bienvenida', body: '<p>Hola</p>' })
        .expect(201);
    });

    it.each([
      ['sin nombre', { body: '<p>x</p>' }],
      ['nombre en blanco', { name: '   ', body: '<p>x</p>' }],
      ['nombre de más de 100', { name: 'x'.repeat(101), body: '<p>x</p>' }],
      ['cuerpo vacío del editor', { name: 'x', body: '<p></p>' }],
      ['asunto que no es texto', { name: 'x', subject: 3, body: '<p>x</p>' }],
      ['campo de más', { name: 'x', body: '<p>x</p>', mailboxId: MBX }],
    ])('400 con %s', async (_case, body) => {
      await http()
        .post(`/mailboxes/${MBX}/templates`)
        .set('Authorization', await asUser())
        .send(body)
        .expect(400);
      expect(templates.create).not.toHaveBeenCalled();
    });
  });

  describe('por id', () => {
    it('GET, PATCH y DELETE pasan usuario e id', async () => {
      const auth = await asUser();
      await http().get(`/templates/${TPL}`).set('Authorization', auth).expect(200, { id: TPL });
      expect(templates.findForUser).toHaveBeenCalledWith(USER_ID, TPL);

      await http()
        .patch(`/templates/${TPL}`)
        .set('Authorization', auth)
        .send({ subject: null })
        .expect(200);
      expect(templates.update).toHaveBeenCalledWith(USER_ID, TPL, { subject: null });

      await http().delete(`/templates/${TPL}`).set('Authorization', auth).expect(204);
      expect(templates.remove).toHaveBeenCalledWith(USER_ID, TPL);
    });

    it('PATCH 400 con cuerpo vacío o nombre en blanco', async () => {
      const auth = await asUser();
      await http()
        .patch(`/templates/${TPL}`)
        .set('Authorization', auth)
        .send({ body: '<p> </p>' })
        .expect(400);
      await http()
        .patch(`/templates/${TPL}`)
        .set('Authorization', auth)
        .send({ name: ' ' })
        .expect(400);
      expect(templates.update).not.toHaveBeenCalled();
    });

    it('id que no es uuid → 400', async () => {
      await http()
        .get('/templates/tpl_1')
        .set('Authorization', await asUser())
        .expect(400);
    });
  });
});
