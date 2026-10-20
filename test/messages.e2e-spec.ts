import request from 'supertest';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import { MessagesController, SentLookupController } from '../src/messages/messages.controller';
import { MessagesService } from '../src/messages/messages.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const MSG = '18c2f0a1b2c3d4e5';

/**
 * Permisos simulados:
 * - USER_ID: lee y envía en MBX; no tiene nada en OTHER.
 * - ADMIN_ID: solo lee MBX (para probar que sin canSend no puede enviar).
 */
const permissions: Record<string, Record<string, { read: boolean; send: boolean }>> = {
  [USER_ID]: { [MBX]: { read: true, send: true } },
  [ADMIN_ID]: { [MBX]: { read: true, send: false } },
};

describe('Messages (e2e)', () => {
  let t: TestApp;
  const messages = {
    listInbox: jest.fn(),
    getInboxMessage: jest.fn(),
    send: jest.fn(),
    reply: jest.fn(),
    listSent: jest.fn(),
    getSentMessage: jest.fn(),
    findSentForUser: jest.fn(),
  };
  const access = {
    hasPermission: jest.fn((userId: string, mailboxId: string, p: 'read' | 'send') =>
      Promise.resolve(permissions[userId]?.[mailboxId]?.[p] ?? false),
    ),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [MessagesController, SentLookupController],
      providers: [
        { provide: MessagesService, useValue: messages },
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
    messages.send.mockResolvedValue({ id: 'sent0001' });
    messages.reply.mockResolvedValue({ id: 'sent0002' });
  });

  const http = () => request(t.app.getHttpServer());
  const asUser = () => t.authHeader(USER_ID);

  describe('permisos', () => {
    it('sin token → 401', async () => {
      await http().get(`/mailboxes/${MBX}/messages`).expect(401);
    });

    it.each([
      ['get', `/mailboxes/${OTHER}/messages`],
      ['get', `/mailboxes/${OTHER}/messages/${MSG}`],
      ['get', `/mailboxes/${OTHER}/sent`],
      ['get', `/mailboxes/${OTHER}/sent/${MSG}`],
      ['post', `/mailboxes/${OTHER}/messages`],
      ['post', `/mailboxes/${OTHER}/messages/${MSG}/reply`],
    ] as const)('sin acceso a la casilla → 403 en %s %s', async (method, path) => {
      await http()
        [method](path)
        .set('Authorization', await asUser())
        .expect(403);
    });

    it('con canRead pero sin canSend no puede enviar ni responder', async () => {
      const auth = await t.authHeader(ADMIN_ID);
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', auth)
        .send({ to: 'a@b.com', subject: 's', body: '<p>x</p>' })
        .expect(403);
      await http()
        .post(`/mailboxes/${MBX}/messages/${MSG}/reply`)
        .set('Authorization', auth)
        .send({ body: '<p>x</p>' })
        .expect(403);
      expect(messages.send).not.toHaveBeenCalled();
      expect(messages.reply).not.toHaveBeenCalled();
    });

    it('con canRead puede leer', async () => {
      messages.listInbox.mockResolvedValue([]);
      await http()
        .get(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(200, []);
    });
  });

  describe('lectura', () => {
    it('GET detalle pasa casilla e id', async () => {
      messages.getInboxMessage.mockResolvedValue({ id: MSG });
      await http()
        .get(`/mailboxes/${MBX}/messages/${MSG}`)
        .set('Authorization', await asUser())
        .expect(200);
      expect(messages.getInboxMessage).toHaveBeenCalledWith(MBX, MSG);
    });

    it('id de mensaje con formato inválido → 400', async () => {
      await http()
        .get(`/mailboxes/${MBX}/messages/no.valido`)
        .set('Authorization', await asUser())
        .expect(400);
      expect(messages.getInboxMessage).not.toHaveBeenCalled();
    });

    it('GET /sent/:id busca en las casillas del usuario', async () => {
      messages.findSentForUser.mockResolvedValue({ id: MSG, mailboxId: MBX });
      const res = await http()
        .get(`/sent/${MSG}`)
        .set('Authorization', await asUser())
        .expect(200);
      expect(res.body.mailboxId).toBe(MBX);
      expect(messages.findSentForUser).toHaveBeenCalledWith(USER_ID, MSG);
    });
  });

  describe('Redactar', () => {
    it('acepta JSON sin adjuntos → 201', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send({ mailboxId: MBX, to: ' ana@x.com ', subject: ' Hola ', body: '<p>Hola</p>' })
        .expect(201, { id: 'sent0001' });
      expect(messages.send).toHaveBeenCalledWith(
        MBX,
        { mailboxId: MBX, to: 'ana@x.com', subject: 'Hola', body: '<p>Hola</p>' },
        undefined,
      );
    });

    it('acepta multipart con adjuntos en el campo "attachments"', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .field('to', 'ana@x.com')
        .field('subject', 'Con adjunto')
        .field('body', '<p>Hola</p>')
        .attach('attachments', Buffer.from('contenido'), 'nota.txt')
        .attach('attachments', Buffer.from('%PDF'), 'doc.pdf')
        .expect(201);

      const files = messages.send.mock.calls[0][2] as { originalname: string; size: number }[];
      expect(files.map((f) => f.originalname)).toEqual(['nota.txt', 'doc.pdf']);
      expect(files[0].size).toBe(9);
    });

    it.each([
      ['email inválido', { to: 'no-es-email', subject: 's', body: '<p>x</p>' }],
      ['asunto vacío', { to: 'a@b.com', subject: '  ', body: '<p>x</p>' }],
      ['cuerpo vacío del editor', { to: 'a@b.com', subject: 's', body: '<p></p>' }],
      ['campo de más', { to: 'a@b.com', subject: 's', body: '<p>x</p>', cc: 'c@d.com' }],
      [
        'mailboxId que no es uuid',
        { mailboxId: 'mbx_1', to: 'a@b.com', subject: 's', body: '<p>x</p>' },
      ],
    ])('400 con %s', async (_case, body) => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send(body)
        .expect(400);
      expect(messages.send).not.toHaveBeenCalled();
    });

    it('más de 10 adjuntos → 400', async () => {
      let req = http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .field('to', 'a@b.com')
        .field('subject', 's')
        .field('body', '<p>x</p>');
      for (let i = 0; i < 11; i++) req = req.attach('attachments', Buffer.from('x'), `f${i}.txt`);
      await req.expect(400);
      expect(messages.send).not.toHaveBeenCalled();
    });
  });

  describe('Responder', () => {
    it('201 y pasa casilla, id y cuerpo', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages/${MSG}/reply`)
        .set('Authorization', await asUser())
        .send({ body: '<p>Gracias</p>' })
        .expect(201, { id: 'sent0002' });
      expect(messages.reply).toHaveBeenCalledWith(MBX, MSG, { body: '<p>Gracias</p>' }, undefined);
    });

    it('400 con cuerpo vacío', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages/${MSG}/reply`)
        .set('Authorization', await asUser())
        .send({ body: '<p> </p>' })
        .expect(400);
    });
  });
});
