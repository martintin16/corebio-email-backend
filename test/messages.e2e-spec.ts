import request from 'supertest';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import { MessagesController, SentLookupController } from '../src/messages/messages.controller';
import { MessagesService } from '../src/messages/messages.service';
import { RecipientLimitExceededException } from '../src/messages/send-quota.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const MSG = '18c2f0a1b2c3d4e5';

/** Junta la respuesta en un Buffer (supertest no lo hace solo para tipos binarios). */
function binaryParser(
  res: { on(event: string, listener: (chunk: Buffer) => void): unknown },
  done: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

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
    getAttachment: jest.fn(),
    listLabels: jest.fn(),
    updateLabels: jest.fn(),
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
      ['get', `/mailboxes/${OTHER}/messages/${MSG}/attachments/1`],
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
        USER_ID,
      );
    });

    it('to/cc/bcc como emails separados por coma; alcanza con uno en cualquiera', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send({
          to: '',
          cc: 'ana@x.com, beto@y.com',
          bcc: 'oculto@w.com',
          subject: 'Hola',
          body: '<p>Hola</p>',
        })
        .expect(201);
      expect(messages.send).toHaveBeenCalledWith(
        MBX,
        expect.objectContaining({ to: '', cc: 'ana@x.com, beto@y.com', bcc: 'oculto@w.com' }),
        undefined,
        USER_ID,
      );
    });

    it.each([
      ['los tres vacíos', { to: '', cc: '', bcc: '' }],
      ['sin ningún campo de destinatarios', {}],
      ['un email inválido en cc', { to: 'a@b.com', cc: 'bien@x.com, mal' }],
      ['bcc que no es texto', { to: 'a@b.com', bcc: ['x@y.com'] }],
    ])('400 con destinatarios: %s', async (_case, recipients) => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send({ subject: 's', body: '<p>x</p>', ...recipients })
        .expect(400);
      expect(messages.send).not.toHaveBeenCalled();
    });

    it('cupo superado → 429 con code, limit y remaining para el front', async () => {
      messages.send.mockRejectedValueOnce(new RecipientLimitExceededException(500, 2, 5));
      const res = await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send({ to: 'a@b.com', subject: 's', body: '<p>x</p>' })
        .expect(429);
      expect(res.body).toEqual(
        expect.objectContaining({
          code: 'RECIPIENT_LIMIT_EXCEEDED',
          limit: 500,
          remaining: 2,
          requested: 5,
        }),
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
      const res = await req.expect(400);
      expect((res.body as { message: string }).message).toBe('Máximo 10 adjuntos');
      expect(messages.send).not.toHaveBeenCalled();
    });

    it('adjuntos en otro campo → 400 en español', async () => {
      const res = await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .field('to', 'a@b.com')
        .field('subject', 's')
        .field('body', '<p>x</p>')
        .attach('archivo', Buffer.from('x'), 'f.txt')
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(/campo "attachments"/);
    });

    it('forwardedAttachments por multipart (JSON en un campo) llega como lista validada', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .field('to', 'a@b.com')
        .field('subject', 'Fwd: x')
        .field('body', '<p>x</p>')
        .field('forwardedAttachments', JSON.stringify([{ messageId: MSG, attachmentId: '1' }]))
        .expect(201);
      const dto = messages.send.mock.calls[0][1] as { forwardedAttachments: unknown[] };
      expect(dto.forwardedAttachments).toEqual([{ messageId: MSG, attachmentId: '1' }]);
    });

    it('forwardedAttachments por JSON', async () => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send({
          to: 'a@b.com',
          subject: 's',
          body: '<p>x</p>',
          forwardedAttachments: [{ messageId: MSG, attachmentId: '0.1' }],
        })
        .expect(201);
    });

    it.each([
      ['no es lista', 'nope'],
      ['id de adjunto inválido', [{ messageId: MSG, attachmentId: '../1' }]],
      ['campo de más', [{ messageId: MSG, attachmentId: '1', x: 1 }]],
    ])('forwardedAttachments inválido (%s) → 400', async (_case, forwardedAttachments) => {
      await http()
        .post(`/mailboxes/${MBX}/messages`)
        .set('Authorization', await asUser())
        .send({ to: 'a@b.com', subject: 's', body: '<p>x</p>', forwardedAttachments })
        .expect(400);
      expect(messages.send).not.toHaveBeenCalled();
    });
  });

  describe('Etiquetas', () => {
    it('GET labels con canRead', async () => {
      messages.listLabels.mockResolvedValue([{ id: 'Label_1', name: 'Salud', color: null }]);
      await http()
        .get(`/mailboxes/${MBX}/labels`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .expect(200, [{ id: 'Label_1', name: 'Salud', color: null }]);
    });

    it('PATCH labels con canRead (sin canSend también) pasa add y remove', async () => {
      messages.updateLabels.mockResolvedValue({ labelIds: ['Label_1'] });
      await http()
        .patch(`/mailboxes/${MBX}/messages/${MSG}/labels`)
        .set('Authorization', await t.authHeader(ADMIN_ID))
        .send({ add: ['Label_1'], remove: ['Label_2'] })
        .expect(200, { labelIds: ['Label_1'] });
      expect(messages.updateLabels).toHaveBeenCalledWith(MBX, MSG, ['Label_1'], ['Label_2']);
    });

    it('PATCH sin add/remove los toma como listas vacías', async () => {
      messages.updateLabels.mockResolvedValue({ labelIds: [] });
      await http()
        .patch(`/mailboxes/${MBX}/messages/${MSG}/labels`)
        .set('Authorization', await asUser())
        .send({})
        .expect(200);
      expect(messages.updateLabels).toHaveBeenCalledWith(MBX, MSG, [], []);
    });

    it.each([
      ['etiqueta de sistema', { add: ['INBOX'] }],
      ['TRASH en remove', { remove: ['TRASH'] }],
      ['no es lista', { add: 'Label_1' }],
      ['campo de más', { add: [], color: 'red' }],
    ])('PATCH 400 con %s', async (_case, body) => {
      await http()
        .patch(`/mailboxes/${MBX}/messages/${MSG}/labels`)
        .set('Authorization', await asUser())
        .send(body)
        .expect(400);
      expect(messages.updateLabels).not.toHaveBeenCalled();
    });

    it('sin acceso a la casilla → 403', async () => {
      await http()
        .get(`/mailboxes/${OTHER}/labels`)
        .set('Authorization', await asUser())
        .expect(403);
      await http()
        .patch(`/mailboxes/${OTHER}/messages/${MSG}/labels`)
        .set('Authorization', await asUser())
        .send({ add: ['Label_1'] })
        .expect(403);
    });

    it('GET messages?labelId= filtra por etiqueta; un labelId de sistema → 400', async () => {
      messages.listInbox.mockResolvedValue([]);
      await http()
        .get(`/mailboxes/${MBX}/messages?labelId=Label_7`)
        .set('Authorization', await asUser())
        .expect(200);
      expect(messages.listInbox).toHaveBeenCalledWith(MBX, 'Label_7');
      await http()
        .get(`/mailboxes/${MBX}/messages?labelId=TRASH`)
        .set('Authorization', await asUser())
        .expect(400);
    });
  });

  describe('Descargar adjunto', () => {
    it('devuelve el archivo con nombre, tipo y como descarga', async () => {
      messages.getAttachment.mockResolvedValue({
        filename: 'Información.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('%PDF-1.4'),
      });
      const res = await http()
        .get(`/mailboxes/${MBX}/messages/${MSG}/attachments/1`)
        .set('Authorization', await asUser())
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(messages.getAttachment).toHaveBeenCalledWith(MBX, MSG, '1');
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="Informacion.pdf"; filename*=UTF-8''Informaci%C3%B3n.pdf`,
      );
      expect(Buffer.from(res.body as Buffer).toString()).toBe('%PDF-1.4');
    });

    it('id de adjunto inválido → 400', async () => {
      await http()
        .get(`/mailboxes/${MBX}/messages/${MSG}/attachments/abc`)
        .set('Authorization', await asUser())
        .expect(400);
      expect(messages.getAttachment).not.toHaveBeenCalled();
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
