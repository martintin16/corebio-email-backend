import request from 'supertest';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import { TemplatesController } from '../src/templates/templates.controller';
import { TemplateNameTakenException, TemplatesService } from '../src/templates/templates.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
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
    findInMailbox: jest.fn(),
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
      controllers: [TemplatesController],
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
    templates.findInMailbox.mockResolvedValue({ id: TPL });
    templates.remove.mockResolvedValue(undefined);
  });

  const http = () => request(t.app.getHttpServer());
  const asUser = () => t.authHeader(USER_ID);
  const base = `/mailboxes/${MBX}/templates`;

  describe('permisos', () => {
    it('401 sin token', async () => {
      await http().get(base).expect(401);
    });

    it.each([
      ['get', base],
      ['post', base],
      ['get', `${base}/${TPL}`],
      ['patch', `${base}/${TPL}`],
      ['delete', `${base}/${TPL}`],
    ] as const)('con solo canRead → 403 en %s %s', async (method, path) => {
      await http()
        [method](path)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ name: 'x', body: '<p>x</p>' })
        .expect(403);
    });

    it('sin acceso a la casilla → 403', async () => {
      await http()
        .get(`/mailboxes/${OTHER}/templates`)
        .set('Authorization', await asUser())
        .expect(403);
      expect(templates.listForMailbox).not.toHaveBeenCalled();
    });
  });

  describe('CRUD', () => {
    it('lista con canSend', async () => {
      await http()
        .get(base)
        .set('Authorization', await asUser())
        .expect(200, []);
      expect(templates.listForMailbox).toHaveBeenCalledWith(MBX);
    });

    it('crea → 201 con usuario, casilla y DTO limpio', async () => {
      await http()
        .post(base)
        .set('Authorization', await asUser())
        .send({ name: '  Bienvenida ', subject: ' Hola ', body: '<p>Hola</p>' })
        .expect(201, { id: TPL });
      expect(templates.create).toHaveBeenCalledWith(USER_ID, MBX, {
        name: 'Bienvenida',
        subject: 'Hola',
        body: '<p>Hola</p>',
      });
    });

    it('detalle, edición y borrado cuelgan de la casilla', async () => {
      const auth = await asUser();
      await http().get(`${base}/${TPL}`).set('Authorization', auth).expect(200, { id: TPL });
      expect(templates.findInMailbox).toHaveBeenCalledWith(MBX, TPL);

      await http()
        .patch(`${base}/${TPL}`)
        .set('Authorization', auth)
        .send({ name: 'Otro', subject: null })
        .expect(200);
      expect(templates.update).toHaveBeenCalledWith(USER_ID, MBX, TPL, {
        name: 'Otro',
        subject: null,
      });

      await http().delete(`${base}/${TPL}`).set('Authorization', auth).expect(204);
      expect(templates.remove).toHaveBeenCalledWith(MBX, TPL);
    });

    it('nombre repetido → 409 con code TEMPLATE_NAME_TAKEN', async () => {
      templates.create.mockRejectedValueOnce(new TemplateNameTakenException());
      const res = await http()
        .post(base)
        .set('Authorization', await asUser())
        .send({ name: 'Confirmación', body: '<p>x</p>' })
        .expect(409);
      expect(res.body).toEqual(expect.objectContaining({ code: 'TEMPLATE_NAME_TAKEN' }));
    });

    it('la ruta vieja /templates/:id ya no existe', async () => {
      await http()
        .get(`/templates/${TPL}`)
        .set('Authorization', await asUser())
        .expect(404);
    });
  });

  describe('validaciones', () => {
    it.each([
      ['sin nombre', { body: '<p>x</p>' }],
      ['nombre en blanco', { name: '   ', body: '<p>x</p>' }],
      ['nombre de más de 60', { name: 'x'.repeat(61), body: '<p>x</p>' }],
      ['cuerpo vacío del editor', { name: 'x', body: '<p></p>' }],
      ['asunto que no es texto', { name: 'x', subject: 3, body: '<p>x</p>' }],
      ['campo de más', { name: 'x', body: '<p>x</p>', foo: 1 }],
    ])('POST 400 con %s', async (_case, body) => {
      await http()
        .post(base)
        .set('Authorization', await asUser())
        .send(body)
        .expect(400);
      expect(templates.create).not.toHaveBeenCalled();
    });

    it('acepta un nombre de 60', async () => {
      await http()
        .post(base)
        .set('Authorization', await asUser())
        .send({ name: 'x'.repeat(60), body: '<p>x</p>' })
        .expect(201);
    });

    it('PATCH 400 con cuerpo vacío o nombre en blanco; id que no es uuid → 400', async () => {
      const auth = await asUser();
      await http()
        .patch(`${base}/${TPL}`)
        .set('Authorization', auth)
        .send({ body: '<p> </p>' })
        .expect(400);
      await http()
        .patch(`${base}/${TPL}`)
        .set('Authorization', auth)
        .send({ name: ' ' })
        .expect(400);
      await http().get(`${base}/tpl_1`).set('Authorization', auth).expect(400);
      expect(templates.update).not.toHaveBeenCalled();
    });
  });
});
