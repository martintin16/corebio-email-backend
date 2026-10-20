import request from 'supertest';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import {
  MailboxScheduledMessagesController,
  ScheduledMessagesController,
} from '../src/scheduled-messages/scheduled-messages.controller';
import { ScheduledMessagesService } from '../src/scheduled-messages/scheduled-messages.service';
import { createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const SCH = '33333333-3333-4333-8333-333333333333';
const MSG = '18c2f0a1b2c3d4e5';
const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

/**
 * El servicio está simulado: acá se prueba lo que es HTTP (rutas, guard de la
 * vista por casilla, validación de DTOs, multipart). Las reglas de permisos por
 * fila, fechas y estados están en el spec del servicio.
 */
describe('Scheduled messages (e2e)', () => {
  let t: TestApp;
  const scheduled = {
    listForMailbox: jest.fn(),
    findForUser: jest.fn(),
    getAttachment: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const access = {
    hasPermission: jest.fn((userId: string, mailboxId: string) =>
      Promise.resolve(userId === USER_ID && mailboxId === MBX),
    ),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [MailboxScheduledMessagesController, ScheduledMessagesController],
      providers: [
        { provide: ScheduledMessagesService, useValue: scheduled },
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
    scheduled.create.mockResolvedValue({ id: SCH });
    scheduled.update.mockResolvedValue({ id: SCH });
    scheduled.remove.mockResolvedValue(undefined);
  });

  const http = () => request(t.app.getHttpServer());
  const auth = () => t.authHeader(USER_ID);

  describe('vista por casilla', () => {
    it('lista con canRead', async () => {
      scheduled.listForMailbox.mockResolvedValue([{ id: SCH }]);
      await http()
        .get(`/mailboxes/${MBX}/scheduled-messages`)
        .set('Authorization', await auth())
        .expect(200, [{ id: SCH }]);
      expect(scheduled.listForMailbox).toHaveBeenCalledWith(MBX);
    });

    it('403 sin acceso a la casilla; 401 sin token', async () => {
      await http()
        .get(`/mailboxes/${OTHER}/scheduled-messages`)
        .set('Authorization', await auth())
        .expect(403);
      await http().get(`/mailboxes/${MBX}/scheduled-messages`).expect(401);
    });
  });

  describe('alta', () => {
    const valid = () => ({
      mailboxId: MBX,
      to: ' ana@x.com ',
      subject: ' Hola ',
      body: '<p>Hola</p>',
      scheduledAt: inOneHour(),
    });

    it('JSON → 201 con el usuario y el DTO limpio', async () => {
      const body = valid();
      await http()
        .post('/scheduled-messages')
        .set('Authorization', await auth())
        .send(body)
        .expect(201, { id: SCH });
      expect(scheduled.create).toHaveBeenCalledWith(
        USER_ID,
        { ...body, to: 'ana@x.com', subject: 'Hola' },
        undefined,
      );
    });

    it('multipart con adjuntos y forwardedAttachments en JSON', async () => {
      await http()
        .post('/scheduled-messages')
        .set('Authorization', await auth())
        .field('mailboxId', MBX)
        .field('to', 'ana@x.com')
        .field('subject', 'Con adjunto')
        .field('body', '<p>Hola</p>')
        .field('scheduledAt', inOneHour())
        .field('forwardedAttachments', JSON.stringify([{ messageId: MSG, attachmentId: '2' }]))
        .attach('attachments', Buffer.from('contenido'), 'nota.txt')
        .expect(201);
      const [, dto, files] = scheduled.create.mock.calls[0] as [
        string,
        { forwardedAttachments: unknown[] },
        { originalname: string }[],
      ];
      expect(dto.forwardedAttachments).toEqual([{ messageId: MSG, attachmentId: '2' }]);
      expect(files.map((f) => f.originalname)).toEqual(['nota.txt']);
    });

    it('solo con copia oculta (to vacío) vale; cc y bcc llegan al servicio', async () => {
      await http()
        .post('/scheduled-messages')
        .set('Authorization', await auth())
        .send({ ...valid(), to: '', cc: 'a@x.com', bcc: 'b@x.com, c@x.com' })
        .expect(201);
      expect(scheduled.create).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ to: '', cc: 'a@x.com', bcc: 'b@x.com, c@x.com' }),
        undefined,
      );
    });

    it('respuesta programada: alcanza con replyToMessageId, body y fecha', async () => {
      await http()
        .post('/scheduled-messages')
        .set('Authorization', await auth())
        .send({
          mailboxId: MBX,
          body: '<p>Gracias</p>',
          scheduledAt: inOneHour(),
          replyToMessageId: MSG,
        })
        .expect(201);
    });

    it.each([
      ['sin destinatario (y no es respuesta)', { to: undefined }],
      ['email inválido', { to: 'no-es-email' }],
      ['los tres destinatarios vacíos', { to: '', cc: '', bcc: '' }],
      ['un email inválido en bcc', { bcc: 'bien@x.com, mal' }],
      ['sin fecha', { scheduledAt: undefined }],
      ['fecha que no es ISO', { scheduledAt: 'mañana a las 9' }],
      ['mailboxId que no es uuid', { mailboxId: 'mbx_1' }],
      ['cuerpo vacío', { body: '<p> </p>' }],
      ['replyToMessageId inválido', { replyToMessageId: '../x' }],
      ['campo de más', { foo: 1 }],
    ])('400 con %s', async (_case, patch) => {
      await http()
        .post('/scheduled-messages')
        .set('Authorization', await auth())
        .send({ ...valid(), ...patch })
        .expect(400);
      expect(scheduled.create).not.toHaveBeenCalled();
    });

    it('más de 10 adjuntos → 400 en español', async () => {
      let req = http()
        .post('/scheduled-messages')
        .set('Authorization', await auth())
        .field('mailboxId', MBX)
        .field('to', 'a@b.com')
        .field('subject', 's')
        .field('body', '<p>x</p>')
        .field('scheduledAt', inOneHour());
      for (let i = 0; i < 11; i++) req = req.attach('attachments', Buffer.from('x'), `f${i}.txt`);
      const res = await req.expect(400);
      expect((res.body as { message: string }).message).toBe('Máximo 10 adjuntos');
    });
  });

  describe('detalle, edición y cancelación', () => {
    it('GET detalle pasa usuario e id', async () => {
      scheduled.findForUser.mockResolvedValue({ id: SCH });
      await http()
        .get(`/scheduled-messages/${SCH}`)
        .set('Authorization', await auth())
        .expect(200, { id: SCH });
      expect(scheduled.findForUser).toHaveBeenCalledWith(USER_ID, SCH);
    });

    it('id que no es uuid → 400', async () => {
      await http()
        .get('/scheduled-messages/sch_1')
        .set('Authorization', await auth())
        .expect(400);
    });

    it('PATCH con keepAttachmentIds por multipart (un valor suelto o JSON)', async () => {
      await http()
        .patch(`/scheduled-messages/${SCH}`)
        .set('Authorization', await auth())
        .field('keepAttachmentIds', '1')
        .field('scheduledAt', inOneHour())
        .expect(200, { id: SCH });
      expect(
        (scheduled.update.mock.calls[0][2] as { keepAttachmentIds: string[] }).keepAttachmentIds,
      ).toEqual(['1']);

      await http()
        .patch(`/scheduled-messages/${SCH}`)
        .set('Authorization', await auth())
        .send({ keepAttachmentIds: [] })
        .expect(200);
      expect(scheduled.update.mock.calls[1][2]).toEqual({ keepAttachmentIds: [] });
    });

    it('PATCH 400 con ids de adjunto inválidos', async () => {
      await http()
        .patch(`/scheduled-messages/${SCH}`)
        .set('Authorization', await auth())
        .send({ keepAttachmentIds: ['1', 'x'] })
        .expect(400);
    });

    it('DELETE → 204', async () => {
      await http()
        .delete(`/scheduled-messages/${SCH}`)
        .set('Authorization', await auth())
        .expect(204);
      expect(scheduled.remove).toHaveBeenCalledWith(USER_ID, SCH);
    });

    it('descarga un adjunto del programado', async () => {
      scheduled.getAttachment.mockResolvedValue({
        filename: 'a.txt',
        mimeType: 'text/plain',
        content: Buffer.from('hola'),
      });
      const res = await http()
        .get(`/scheduled-messages/${SCH}/attachments/1`)
        .set('Authorization', await auth())
        .expect(200);
      expect(res.headers['content-disposition']).toContain('filename="a.txt"');
      expect(scheduled.getAttachment).toHaveBeenCalledWith(USER_ID, SCH, '1');
    });
  });
});
