import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { GoogleMailboxClient } from '../google/google-mailbox-client';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import type { MessagesService } from '../messages/messages.service';
import { rowsOf } from '../common/query-rows';
import type { ScheduledMessage } from './entities/scheduled-message.entity';
import {
  MAX_LEAD_MS,
  MIN_LEAD_MS,
  parseScheduledAt,
  ScheduledMessagesService,
  toView,
} from './scheduled-messages.service';

const MBX = '11111111-1111-4111-8111-111111111111';
const MBX2 = '22222222-2222-4222-8222-222222222222';
const SCH = '33333333-3333-4333-8333-333333333333';
const USER = 'u1';
const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function buildRow(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: SCH,
    mailboxId: MBX,
    createdBy: 'creator',
    updatedBy: 'creator',
    to: 'ana@x.com',
    subject: 'Hola',
    body: '<p>Hola Ana</p>',
    attachments: [{ id: '1', filename: 'a.pdf', mimeType: 'application/pdf', size: 3 }],
    scheduledAt: new Date('2030-01-01T12:00:00.000Z'),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date('2030-01-01T12:00:00.000Z'),
    lockedUntil: null,
    sendingStartedAt: null,
    lastError: null,
    gmailDraftId: 'r-draft1',
    gmailMessageId: null,
    gmailThreadId: null,
    replyToMessageId: null,
    replyThreadId: null,
    replyInReplyTo: null,
    replyReferences: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('parseScheduledAt', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');

  it('acepta entre 1 minuto y 1 año', () => {
    expect(parseScheduledAt(new Date(now + MIN_LEAD_MS).toISOString(), now)).toEqual(
      new Date(now + MIN_LEAD_MS),
    );
    expect(() => parseScheduledAt(new Date(now + MAX_LEAD_MS).toISOString(), now)).not.toThrow();
  });

  it.each([
    ['en el pasado', new Date(now - 1000).toISOString()],
    ['dentro de 30 segundos', new Date(now + 30_000).toISOString()],
    ['a más de un año', new Date(now + MAX_LEAD_MS + 60_000).toISOString()],
    ['inválida', 'mañana'],
  ])('400 si la fecha está %s', (_case, value) => {
    expect(() => parseScheduledAt(value, now)).toThrow(BadRequestException);
  });
});

describe('rowsOf', () => {
  it('entiende las dos formas de dataSource.query', () => {
    expect(rowsOf([[{ id: 'a' }], 1])).toEqual([{ id: 'a' }]);
    expect(rowsOf([{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(rowsOf([])).toEqual([]);
    expect(rowsOf([[], 0])).toEqual([]);
  });
});

describe('toView', () => {
  it('arma la respuesta con preview en texto y fechas ISO', () => {
    expect(toView(buildRow())).toEqual({
      id: SCH,
      mailboxId: MBX,
      to: 'ana@x.com',
      subject: 'Hola',
      bodyPreview: 'Hola Ana',
      body: '<p>Hola Ana</p>',
      scheduledAt: '2030-01-01T12:00:00.000Z',
      status: 'pending',
      lastError: null,
      attachments: [{ id: '1', filename: 'a.pdf', mimeType: 'application/pdf', size: 3 }],
      replyToMessageId: null,
      sentAt: null,
    });
  });
});

describe('ScheduledMessagesService', () => {
  let repo: { find: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: { query: jest.Mock };
  let messages: Record<
    | 'resolveReply'
    | 'collectAttachments'
    | 'composeRaw'
    | 'createDraft'
    | 'updateDraft'
    | 'getDraftMessage'
    | 'deleteDraft'
    | 'downloadAttachment',
    jest.Mock
  >;
  let google: { forMailbox: jest.Mock };
  let permissions: Record<string, { read: boolean; send: boolean }>;
  let access: { hasPermission: jest.Mock };
  let service: ScheduledMessagesService;

  const draftMessage = {
    id: 'draftmsg1',
    payload: {
      mimeType: 'multipart/mixed',
      parts: [
        { partId: '0', mimeType: 'text/html', body: { data: 'eA' } },
        {
          partId: '1',
          mimeType: 'application/pdf',
          filename: 'a.pdf',
          body: { attachmentId: 'A', size: 3 },
        },
      ],
    },
  };

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(buildRow()),
      create: jest.fn((data: Partial<ScheduledMessage>) => ({ ...data })),
      save: jest.fn((row: Partial<ScheduledMessage>) =>
        Promise.resolve(buildRow({ ...row, id: row.id ?? SCH })),
      ),
    };
    // Por defecto: el lock y el borrado condicional encuentran la fila.
    dataSource = {
      query: jest.fn().mockResolvedValue([[{ id: SCH, gmail_draft_id: 'r-draft1' }], 1]),
    };
    messages = {
      resolveReply: jest.fn().mockResolvedValue({
        to: 'Ana <ana@x.com>',
        subject: 'Re: Consulta',
        threadId: 'thr1',
        inReplyTo: '<orig@x.com>',
        references: '<orig@x.com>',
      }),
      collectAttachments: jest
        .fn()
        .mockResolvedValue([
          { filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') },
        ]),
      composeRaw: jest.fn().mockResolvedValue(Buffer.from('raw')),
      createDraft: jest.fn().mockResolvedValue('r-new'),
      updateDraft: jest.fn().mockResolvedValue(undefined),
      getDraftMessage: jest.fn().mockResolvedValue(draftMessage),
      deleteDraft: jest.fn().mockResolvedValue(undefined),
      downloadAttachment: jest.fn(),
    };
    google = { forMailbox: jest.fn((mailboxId: string) => Promise.resolve({ mailboxId })) };
    permissions = {
      [MBX]: { read: true, send: true },
      [MBX2]: { read: true, send: true },
    };
    access = {
      hasPermission: jest.fn((_user: string, mailboxId: string, p: 'read' | 'send') =>
        Promise.resolve(permissions[mailboxId]?.[p] ?? false),
      ),
    };
    service = new ScheduledMessagesService(
      repo as unknown as Repository<ScheduledMessage>,
      dataSource as unknown as DataSource,
      messages as unknown as MessagesService,
      google as unknown as GoogleMailboxClient,
      access as unknown as MailboxAccessService,
    );
  });

  describe('consulta', () => {
    it('lista pendientes, enviándose y con error, por fecha', async () => {
      repo.find.mockResolvedValue([buildRow()]);
      const list = await service.listForMailbox(MBX);
      expect(list).toHaveLength(1);
      const options = repo.find.mock.calls[0][0] as { order: object; where: { mailboxId: string } };
      expect(options.where.mailboxId).toBe(MBX);
      expect(options.order).toEqual({ scheduledAt: 'ASC' });
    });

    it('404 si no existe o si no tiene ningún permiso en la casilla', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findForUser(USER, SCH)).rejects.toBeInstanceOf(NotFoundException);
      permissions[MBX] = { read: false, send: false };
      await expect(service.findForUser(USER, SCH)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403 para ver el detalle con solo canSend', async () => {
      permissions[MBX] = { read: false, send: true };
      await expect(service.findForUser(USER, SCH)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('baja un adjunto desde el borrador', async () => {
      messages.downloadAttachment.mockResolvedValue({ filename: 'a.pdf' });
      await service.getAttachment(USER, SCH, '1');
      expect(messages.getDraftMessage).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-draft1');
      expect(messages.downloadAttachment).toHaveBeenCalledWith(
        { mailboxId: MBX },
        draftMessage,
        '1',
      );
    });
  });

  describe('alta', () => {
    const dto = () => ({
      mailboxId: MBX,
      to: 'ana@x.com',
      subject: 'Hola',
      body: '<p>Hola <script>x</script>Ana</p>',
      scheduledAt: inOneHour(),
    });

    it('arma el mensaje, lo guarda como borrador y crea la fila pendiente', async () => {
      const files = [
        { originalname: 'a.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('pdf') },
      ];
      const view = await service.create(USER, dto(), files);

      expect(messages.collectAttachments).toHaveBeenCalledWith(
        { mailboxId: MBX },
        { files, forwarded: [] },
      );
      expect(messages.composeRaw).toHaveBeenCalledWith(
        { mailboxId: MBX },
        expect.objectContaining({ to: 'ana@x.com', subject: 'Hola', html: '<p>Hola Ana</p>' }),
      );
      expect(messages.createDraft).toHaveBeenCalledWith(
        { mailboxId: MBX },
        Buffer.from('raw'),
        undefined,
      );

      const created = repo.create.mock.calls[0][0] as Partial<ScheduledMessage>;
      expect(created).toEqual(
        expect.objectContaining({
          mailboxId: MBX,
          createdBy: USER,
          updatedBy: USER,
          status: 'pending',
          gmailDraftId: 'r-new',
          body: '<p>Hola Ana</p>',
          attachments: [{ id: '1', filename: 'a.pdf', mimeType: 'application/pdf', size: 3 }],
        }),
      );
      expect(created.nextAttemptAt).toEqual(created.scheduledAt);
      expect(view.status).toBe('pending');
    });

    it('sin adjuntos no lee el borrador', async () => {
      messages.collectAttachments.mockResolvedValue([]);
      await service.create(USER, dto());
      expect(messages.getDraftMessage).not.toHaveBeenCalled();
      expect((repo.create.mock.calls[0][0] as Partial<ScheduledMessage>).attachments).toEqual([]);
    });

    it('una respuesta toma destinatario, asunto e hilo del original', async () => {
      await service.create(USER, {
        mailboxId: MBX,
        body: '<p>Gracias</p>',
        scheduledAt: inOneHour(),
        replyToMessageId: 'msg00001',
      });
      expect(messages.resolveReply).toHaveBeenCalledWith({ mailboxId: MBX }, 'msg00001');
      expect(messages.createDraft).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'thr1',
      );
      expect(repo.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          to: 'Ana <ana@x.com>',
          subject: 'Re: Consulta',
          replyToMessageId: 'msg00001',
          replyThreadId: 'thr1',
          replyInReplyTo: '<orig@x.com>',
        }),
      );
    });

    it('403 sin canSend, y sin canRead si reenvía adjuntos', async () => {
      permissions[MBX] = { read: true, send: false };
      await expect(service.create(USER, dto())).rejects.toBeInstanceOf(ForbiddenException);
      permissions[MBX] = { read: false, send: true };
      await expect(
        service.create(USER, {
          ...dto(),
          forwardedAttachments: [{ messageId: 'msg00001', attachmentId: '1' }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(google.forMailbox).not.toHaveBeenCalled();
    });

    it('400 con fecha muy cercana', async () => {
      await expect(
        service.create(USER, { ...dto(), scheduledAt: new Date().toISOString() }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('si falla guardar la fila, borra el borrador', async () => {
      repo.save.mockRejectedValue(new Error('db'));
      await expect(service.create(USER, dto())).rejects.toThrow('db');
      expect(messages.deleteDraft).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-new');
    });
  });

  describe('edición', () => {
    it('actualiza el borrador, conserva los adjuntos pedidos y vuelve a pending un failed', async () => {
      repo.findOne.mockResolvedValue(
        buildRow({ status: 'failed', attempts: 4, lastError: 'boom', nextAttemptAt: null }),
      );
      const scheduledAt = inOneHour();
      await service.update(USER, SCH, {
        body: '<p>Nuevo</p>',
        scheduledAt,
        keepAttachmentIds: ['1'],
      });

      expect(messages.collectAttachments).toHaveBeenCalledWith(
        { mailboxId: MBX },
        {
          files: undefined,
          forwarded: [],
          kept: { apis: { mailboxId: MBX }, message: draftMessage, partIds: ['1'] },
        },
      );
      expect(messages.updateDraft).toHaveBeenCalledWith(
        { mailboxId: MBX },
        'r-draft1',
        Buffer.from('raw'),
        undefined,
      );
      expect(messages.createDraft).not.toHaveBeenCalled();
      const saved = repo.save.mock.calls[0][0] as ScheduledMessage;
      expect(saved).toEqual(
        expect.objectContaining({
          status: 'pending',
          attempts: 0,
          lastError: null,
          body: '<p>Nuevo</p>',
          updatedBy: USER,
          scheduledAt: new Date(scheduledAt),
          nextAttemptAt: new Date(scheduledAt),
        }),
      );
      // Reservó la fila y la liberó al terminar.
      expect(dataSource.query.mock.calls[0][0]).toContain('SET locked_until = now()');
      expect(dataSource.query.mock.calls.at(-1)?.[0]).toContain('SET locked_until = NULL');
    });

    it('sin keepAttachmentIds conserva todos los que tenía', async () => {
      await service.update(USER, SCH, { subject: 'Otro' });
      const sources = messages.collectAttachments.mock.calls[0][1] as {
        kept: { partIds: string[] };
      };
      expect(sources.kept.partIds).toEqual(['1']);
    });

    it('409 si ya se envió o se está enviando', async () => {
      repo.findOne.mockResolvedValue(buildRow({ status: 'sending' }));
      await expect(service.update(USER, SCH, { subject: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('409 si el job lo tomó justo (no se pudo reservar)', async () => {
      dataSource.query.mockResolvedValueOnce([[], 0]);
      await expect(service.update(USER, SCH, { subject: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(messages.updateDraft).not.toHaveBeenCalled();
    });

    it('si el borrador ya no está y tenía adjuntos → 400 (y libera la fila)', async () => {
      messages.getDraftMessage.mockRejectedValue(new NotFoundException());
      await expect(service.update(USER, SCH, { subject: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(dataSource.query.mock.calls.at(-1)?.[0]).toContain('SET locked_until = NULL');
    });

    it('si el borrador ya no está y no se conserva nada, crea uno nuevo', async () => {
      messages.getDraftMessage.mockRejectedValueOnce(new NotFoundException());
      await service.update(USER, SCH, { keepAttachmentIds: [] });
      expect(messages.createDraft).toHaveBeenCalled();
      expect(messages.deleteDraft).not.toHaveBeenCalled();
    });

    it('borrador en la Papelera: crea uno nuevo con los adjuntos del viejo y borra el viejo', async () => {
      const trashed = { ...draftMessage, labelIds: ['DRAFT', 'TRASH'] };
      messages.getDraftMessage.mockResolvedValue(trashed);
      await service.update(USER, SCH, { subject: 'Mandalo igual' });

      expect(messages.collectAttachments).toHaveBeenCalledWith(
        { mailboxId: MBX },
        expect.objectContaining({
          kept: { apis: { mailboxId: MBX }, message: trashed, partIds: ['1'] },
        }),
      );
      expect(messages.updateDraft).not.toHaveBeenCalled();
      expect(messages.createDraft).toHaveBeenCalledWith(
        { mailboxId: MBX },
        Buffer.from('raw'),
        undefined,
      );
      expect(messages.deleteDraft).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-draft1');
      const saved = repo.save.mock.calls[0][0] as ScheduledMessage;
      expect(saved.gmailDraftId).toBe('r-new');
      expect(saved.status).toBe('pending');
    });

    it('mover de casilla: borrador nuevo en la otra, se borra el viejo', async () => {
      await service.update(USER, SCH, { mailboxId: MBX2 });
      expect(messages.createDraft).toHaveBeenCalledWith(
        { mailboxId: MBX2 },
        Buffer.from('raw'),
        undefined,
      );
      expect(messages.deleteDraft).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-draft1');
      expect((repo.save.mock.calls[0][0] as ScheduledMessage).mailboxId).toBe(MBX2);
    });

    it('mover de casilla pide canSend en la nueva; una respuesta no se puede mover', async () => {
      permissions[MBX2] = { read: true, send: false };
      await expect(service.update(USER, SCH, { mailboxId: MBX2 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      permissions[MBX2] = { read: true, send: true };
      repo.findOne.mockResolvedValue(buildRow({ replyToMessageId: 'msg00001' }));
      await expect(service.update(USER, SCH, { mailboxId: MBX2 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('en una respuesta, to y subject no cambian', async () => {
      repo.findOne.mockResolvedValue(
        buildRow({
          to: 'Ana <ana@x.com>',
          subject: 'Re: Consulta',
          replyToMessageId: 'msg00001',
          replyThreadId: 'thr1',
        }),
      );
      await service.update(USER, SCH, { to: 'otro@x.com', subject: 'Cambiado' });
      expect(messages.composeRaw).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ to: 'Ana <ana@x.com>', subject: 'Re: Consulta' }),
      );
      expect(messages.updateDraft).toHaveBeenCalledWith(
        expect.anything(),
        'r-draft1',
        expect.anything(),
        'thr1',
      );
    });
  });

  describe('cancelación', () => {
    it('borra la fila y el borrador', async () => {
      await service.remove(USER, SCH);
      expect(dataSource.query.mock.calls[0][0]).toContain('DELETE FROM public.scheduled_messages');
      expect(messages.deleteDraft).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-draft1');
    });

    it('409 si el job ya lo tomó', async () => {
      repo.findOne.mockResolvedValue(buildRow({ status: 'sending' }));
      dataSource.query.mockResolvedValueOnce([[], 0]);
      await expect(service.remove(USER, SCH)).rejects.toBeInstanceOf(ConflictException);
      expect(messages.deleteDraft).not.toHaveBeenCalled();
    });

    it('si no se puede borrar el borrador, igual queda cancelado', async () => {
      google.forMailbox.mockRejectedValue(new Error('needs reconnect'));
      await expect(service.remove(USER, SCH)).resolves.toBeUndefined();
    });

    it('403 sin canSend', async () => {
      permissions[MBX] = { read: true, send: false };
      await expect(service.remove(USER, SCH)).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });
});
