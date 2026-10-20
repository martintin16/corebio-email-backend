import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Readable } from 'stream';
import {
  MailboxNeedsReconnectException,
  type GoogleMailboxClient,
} from '../google/google-mailbox-client';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { DRAFT_NOT_FOUND, isGmailNotFound, LIST_LIMIT, MessagesService } from './messages.service';

const MBX = '11111111-1111-4111-8111-111111111111';
const MBX2 = '22222222-2222-4222-8222-222222222222';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function headers(h: Record<string, string>) {
  return Object.entries(h).map(([name, value]) => ({ name, value }));
}

const inboxMessage = {
  id: 'msg00001',
  threadId: 'thr00001',
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'It&#39;s ok',
  internalDate: '1700000000000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: headers({
      From: '"Ana" <ana@x.com>',
      To: 'casilla@gmail.com',
      Subject: 'Hola',
      'Message-ID': '<orig@x.com>',
    }),
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Hola texto') } },
      { mimeType: 'text/html', body: { data: b64('<p>Hola <script>x</script>html</p>') } },
    ],
  },
};

describe('isGmailNotFound', () => {
  it.each([
    [{ status: 404 }, true],
    [{ response: { status: 404 } }, true],
    [{ code: 404 }, true],
    [{ status: 400, message: 'Invalid id value' }, true],
    [{ status: 500 }, false],
    [null, false],
  ])('%p → %p', (err, expected) => {
    expect(isGmailNotFound(err)).toBe(expected);
  });
});

describe('MessagesService', () => {
  let gmail: {
    users: {
      messages: {
        list: jest.Mock;
        get: jest.Mock;
        modify: jest.Mock;
        send: jest.Mock;
        attachments: { get: jest.Mock };
      };
      drafts: {
        create: jest.Mock;
        update: jest.Mock;
        get: jest.Mock;
        send: jest.Mock;
        delete: jest.Mock;
      };
    };
  };
  let google: { forMailbox: jest.Mock; handleGoogleError: jest.Mock };
  let access: { findSummariesByUser: jest.Mock; hasPermission: jest.Mock };
  let service: MessagesService;

  beforeEach(() => {
    gmail = {
      users: {
        messages: {
          list: jest.fn().mockResolvedValue({ data: { messages: [{ id: 'msg00001' }] } }),
          get: jest.fn().mockResolvedValue({ data: inboxMessage }),
          modify: jest.fn().mockResolvedValue({ data: {} }),
          send: jest.fn().mockResolvedValue({ data: { id: 'sent0001' } }),
          attachments: {
            get: jest.fn().mockResolvedValue({ data: { data: b64('contenido grande') } }),
          },
        },
        drafts: {
          create: jest.fn().mockResolvedValue({ data: { id: 'r-draft1' } }),
          update: jest.fn().mockResolvedValue({ data: { id: 'r-draft1' } }),
          get: jest.fn(),
          send: jest.fn().mockResolvedValue({ data: { id: 'sent0009', threadId: 'thr9' } }),
          delete: jest.fn().mockResolvedValue({ data: {} }),
        },
      },
    };
    google = {
      forMailbox: jest.fn((mailboxId: string) =>
        Promise.resolve({
          mailboxId,
          email: 'casilla@gmail.com',
          displayName: 'Tesorería',
          gmail,
          drive: {},
        }),
      ),
      handleGoogleError: jest.fn(() => Promise.reject(new BadGatewayException())),
    };
    access = { findSummariesByUser: jest.fn(), hasPermission: jest.fn().mockResolvedValue(true) };
    service = new MessagesService(
      google as unknown as GoogleMailboxClient,
      access as unknown as MailboxAccessService,
    );
  });

  describe('Recibidos', () => {
    it('lista los últimos de INBOX con los encabezados necesarios', async () => {
      const [summary] = await service.listInbox(MBX);
      expect(gmail.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: LIST_LIMIT,
      });
      expect(gmail.users.messages.get).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg00001', format: 'metadata' }),
      );
      expect(summary).toEqual({
        id: 'msg00001',
        from: { name: 'Ana', email: 'ana@x.com' },
        subject: 'Hola',
        snippet: "It's ok",
        receivedAt: '2023-11-14T22:13:20.000Z',
        unread: true,
      });
    });

    it('el detalle devuelve el cuerpo en texto plano y lo marca como leído', async () => {
      const detail = await service.getInboxMessage(MBX, 'msg00001');
      expect(detail.body).toBe('Hola texto');
      expect(detail.to).toBe('casilla@gmail.com');
      expect(detail.unread).toBe(false);
      expect(gmail.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg00001',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });

    it('si no se puede marcar como leído, igual devuelve el mensaje', async () => {
      gmail.users.messages.modify.mockRejectedValue(new Error('403'));
      const detail = await service.getInboxMessage(MBX, 'msg00001');
      expect(detail.unread).toBe(true);
    });

    it('si solo hay HTML, lo convierte a texto (sin scripts)', async () => {
      gmail.users.messages.get.mockResolvedValue({
        data: {
          ...inboxMessage,
          labelIds: ['INBOX'],
          payload: {
            ...inboxMessage.payload,
            parts: [inboxMessage.payload.parts[1]],
          },
        },
      });
      const detail = await service.getInboxMessage(MBX, 'msg00001');
      expect(detail.body).toBe('Hola html');
      expect(gmail.users.messages.modify).not.toHaveBeenCalled();
    });

    it('mensaje inexistente en Gmail → 404', async () => {
      gmail.users.messages.get.mockRejectedValue({ status: 404 });
      await expect(service.getInboxMessage(MBX, 'msg00001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('otros errores de Gmail pasan por handleGoogleError', async () => {
      const err = new Error('boom');
      gmail.users.messages.list.mockRejectedValue(err);
      await expect(service.listInbox(MBX)).rejects.toBeInstanceOf(BadGatewayException);
      expect(google.handleGoogleError).toHaveBeenCalledWith(MBX, err);
    });
  });

  describe('Enviados', () => {
    const sentMessage = { ...inboxMessage, id: 'sent0001', labelIds: ['SENT'] };

    it('el detalle devuelve HTML sanitizado y la casilla', async () => {
      gmail.users.messages.get.mockResolvedValue({ data: sentMessage });
      const detail = await service.getSentMessage(MBX, 'sent0001');
      expect(detail.mailboxId).toBe(MBX);
      expect(detail.body).toBe('<p>Hola html</p>');
    });

    it('un mensaje que no está en SENT → 404', async () => {
      await expect(service.getSentMessage(MBX, 'msg00001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('findSentForUser busca solo en casillas con canRead y saltea las que no lo tienen', async () => {
      access.findSummariesByUser.mockResolvedValue(
        new Map([
          [
            'u1',
            [
              { mailboxId: MBX, email: 'a', canRead: false, canSend: true },
              { mailboxId: MBX2, email: 'b', canRead: true, canSend: false },
            ],
          ],
        ]),
      );
      gmail.users.messages.get.mockResolvedValue({ data: sentMessage });
      const found = await service.findSentForUser('u1', 'sent0001');
      expect(found.mailboxId).toBe(MBX2);
      expect(google.forMailbox).toHaveBeenCalledTimes(1);
      expect(google.forMailbox).toHaveBeenCalledWith(MBX2);
    });

    it('findSentForUser sigue de largo si una casilla está desconectada, y 404 si no aparece', async () => {
      access.findSummariesByUser.mockResolvedValue(
        new Map([
          [
            'u1',
            [
              { mailboxId: MBX, email: 'a', canRead: true, canSend: false },
              { mailboxId: MBX2, email: 'b', canRead: true, canSend: false },
            ],
          ],
        ]),
      );
      google.forMailbox.mockRejectedValueOnce(new MailboxNeedsReconnectException());
      gmail.users.messages.get.mockRejectedValue({ status: 404 });
      await expect(service.findSentForUser('u1', 'sent0001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('Redactar', () => {
    const dto = { to: 'ana@x.com', subject: 'Hola', body: '<p>Hola <script>x</script>Ana</p>' };

    it('envía el mensaje armado como message/rfc822 y devuelve el resumen', async () => {
      const result = await service.send(MBX, dto, [
        { originalname: 'a.txt', mimetype: 'text/plain', size: 3, buffer: Buffer.from('abc') },
      ]);

      const call = gmail.users.messages.send.mock.calls[0][0] as {
        requestBody: object;
        media: { mimeType: string; body: Readable };
      };
      expect(call.requestBody).toEqual({});
      expect(call.media.mimeType).toBe('message/rfc822');
      const raw = await streamToString(call.media.body);
      expect(raw).toMatch(/^To: ana@x\.com/m);
      expect(raw).toContain('<casilla@gmail.com>');
      expect(raw).toContain('filename=a.txt');
      expect(raw).not.toContain('<script>');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'sent0001',
          to: 'ana@x.com',
          subject: 'Hola',
          snippet: 'Hola Ana',
        }),
      );
    });

    it('400 si el mailboxId del body no coincide con la ruta', async () => {
      await expect(service.send(MBX, { ...dto, mailboxId: MBX2 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(gmail.users.messages.send).not.toHaveBeenCalled();
    });
  });

  describe('Responder', () => {
    it('responde en el hilo, a Reply-To, con Re: e In-Reply-To/References', async () => {
      gmail.users.messages.get.mockResolvedValue({
        data: {
          ...inboxMessage,
          payload: {
            headers: headers({
              From: 'Ana <ana@x.com>',
              'Reply-To': 'Respuestas <resp@x.com>',
              Subject: 'Consulta',
              'Message-ID': '<orig@x.com>',
              References: '<prev@x.com>',
            }),
          },
        },
      });

      const result = await service.reply(MBX, 'msg00001', { body: '<p>Gracias</p>' });

      const call = gmail.users.messages.send.mock.calls[0][0] as {
        requestBody: { threadId?: string };
        media: { body: Readable };
      };
      expect(call.requestBody).toEqual({ threadId: 'thr00001' });
      const raw = await streamToString(call.media.body);
      expect(raw).toMatch(/^To: Respuestas <resp@x\.com>/m);
      expect(raw).toMatch(/^Subject: Re: Consulta/m);
      expect(raw).toMatch(/^In-Reply-To: <orig@x\.com>/m);
      expect(raw).toMatch(/^References: <prev@x\.com> <orig@x\.com>/m);
      expect(result.to).toBe('resp@x.com');
      expect(result.subject).toBe('Re: Consulta');
    });

    it('sin Reply-To responde a From', async () => {
      await service.reply(MBX, 'msg00001', { body: '<p>ok</p>' });
      const call = gmail.users.messages.send.mock.calls[0][0] as { media: { body: Readable } };
      expect(await streamToString(call.media.body)).toMatch(/^To: Ana <ana@x\.com>/m);
    });
  });

  describe('Adjuntos', () => {
    const withAttachments = {
      ...inboxMessage,
      id: 'msg00002',
      payload: {
        ...inboxMessage.payload,
        mimeType: 'multipart/mixed',
        parts: [
          ...inboxMessage.payload.parts,
          {
            partId: '1',
            mimeType: 'application/pdf',
            filename: 'informe.pdf',
            body: { attachmentId: 'ATT-LARGO', size: 16 },
          },
          {
            partId: '2',
            mimeType: 'text/plain',
            filename: 'nota.txt',
            body: { data: b64('chico'), size: 5 },
          },
        ],
      },
    };

    beforeEach(() => {
      gmail.users.messages.get.mockResolvedValue({ data: withAttachments });
    });

    it('el detalle de recibidos y de enviados lista los adjuntos', async () => {
      const detail = await service.getInboxMessage(MBX, 'msg00002');
      expect(detail.attachments).toEqual([
        { id: '1', filename: 'informe.pdf', mimeType: 'application/pdf', size: 16 },
        { id: '2', filename: 'nota.txt', mimeType: 'text/plain', size: 5 },
      ]);
      gmail.users.messages.get.mockResolvedValue({
        data: { ...withAttachments, labelIds: ['SENT'] },
      });
      expect((await service.getSentMessage(MBX, 'msg00002')).attachments).toHaveLength(2);
    });

    it('descarga uno que Gmail manda aparte (attachments.get)', async () => {
      const file = await service.getAttachment(MBX, 'msg00002', '1');
      expect(gmail.users.messages.attachments.get).toHaveBeenCalledWith({
        userId: 'me',
        messageId: 'msg00002',
        id: 'ATT-LARGO',
      });
      expect(file).toEqual({
        filename: 'informe.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('contenido grande'),
      });
    });

    it('descarga uno que viene adentro del mensaje sin pedir nada más', async () => {
      const file = await service.getAttachment(MBX, 'msg00002', '2');
      expect(file.content.toString()).toBe('chico');
      expect(gmail.users.messages.attachments.get).not.toHaveBeenCalled();
    });

    it('adjunto inexistente → 404', async () => {
      await expect(service.getAttachment(MBX, 'msg00002', '7')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    describe('reenviar', () => {
      const dto = {
        to: 'ana@x.com',
        subject: 'Fwd: informe',
        body: '<p>Te lo reenvío</p>',
        forwardedAttachments: [
          { messageId: 'msg00002', attachmentId: '1' },
          { messageId: 'msg00002', attachmentId: '1' },
          { messageId: 'msg00002', attachmentId: '2' },
        ],
      };

      it('baja los adjuntos del original (sin duplicados) y los suma a los subidos', async () => {
        await service.send(
          MBX,
          dto,
          [
            {
              originalname: 'nuevo.txt',
              mimetype: 'text/plain',
              size: 3,
              buffer: Buffer.from('abc'),
            },
          ],
          'u1',
        );
        expect(access.hasPermission).toHaveBeenCalledWith('u1', MBX, 'read');
        expect(gmail.users.messages.get).toHaveBeenCalledTimes(1);
        const call = gmail.users.messages.send.mock.calls[0][0] as { media: { body: Readable } };
        const raw = await streamToString(call.media.body);
        expect(raw).toContain('filename=informe.pdf');
        expect(raw).toContain('filename=nota.txt');
        expect(raw).toContain('filename=nuevo.txt');
        expect(raw.match(/filename=informe\.pdf/g)).toHaveLength(1);
      });

      it('sin canRead en la casilla → 403 y no toca Gmail', async () => {
        access.hasPermission.mockResolvedValue(false);
        await expect(service.send(MBX, dto, undefined, 'u1')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(google.forMailbox).not.toHaveBeenCalled();
      });

      it('mensaje o adjunto que no está en la casilla → 400', async () => {
        await expect(
          service.send(
            MBX,
            { ...dto, forwardedAttachments: [{ messageId: 'msg00002', attachmentId: '9' }] },
            undefined,
            'u1',
          ),
        ).rejects.toThrow(
          new BadRequestException('Un adjunto reenviado no existe en esta casilla'),
        );

        gmail.users.messages.get.mockRejectedValue({ status: 404 });
        await expect(service.send(MBX, dto, undefined, 'u1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(gmail.users.messages.send).not.toHaveBeenCalled();
      });

      it('los límites cuentan reenviados + subidos, con el tamaño que informa Gmail', async () => {
        gmail.users.messages.get.mockResolvedValue({
          data: {
            ...withAttachments,
            payload: {
              ...withAttachments.payload,
              parts: [
                {
                  partId: '1',
                  mimeType: 'video/mp4',
                  filename: 'video.mp4',
                  body: { attachmentId: 'A', size: 19 * 1024 * 1024 },
                },
              ],
            },
          },
        });
        await expect(
          service.send(
            MBX,
            { ...dto, forwardedAttachments: [{ messageId: 'msg00002', attachmentId: '1' }] },
            [
              {
                originalname: 'b.bin',
                mimetype: '',
                size: 2 * 1024 * 1024,
                buffer: Buffer.alloc(2 * 1024 * 1024),
              },
            ],
            'u1',
          ),
        ).rejects.toBeInstanceOf(PayloadTooLargeException);
        expect(gmail.users.messages.attachments.get).not.toHaveBeenCalled();
      });
    });

    it('collectAttachments conserva los pedidos de un borrador', async () => {
      const apis = (await google.forMailbox(MBX)) as Parameters<
        MessagesService['collectAttachments']
      >[0];
      const result = await service.collectAttachments(apis, {
        kept: { apis, message: withAttachments, partIds: ['2'] },
      });
      expect(result).toEqual([
        { filename: 'nota.txt', contentType: 'text/plain', content: Buffer.from('chico') },
      ]);
      await expect(
        service.collectAttachments(apis, {
          kept: { apis, message: withAttachments, partIds: ['5'] },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('Borradores (para programados)', () => {
    const apis = () =>
      google.forMailbox(MBX) as Promise<Parameters<MessagesService['createDraft']>[0]>;

    it('createDraft sube el RFC 822 y respeta el hilo', async () => {
      const id = await service.createDraft(await apis(), Buffer.from('raw'), 'thr00001');
      expect(id).toBe('r-draft1');
      const call = gmail.users.drafts.create.mock.calls[0][0] as {
        requestBody: object;
        media: { mimeType: string; body: Readable };
      };
      expect(call.requestBody).toEqual({ message: { threadId: 'thr00001' } });
      expect(call.media.mimeType).toBe('message/rfc822');
      expect(await streamToString(call.media.body)).toBe('raw');
    });

    it('updateDraft reemplaza el contenido', async () => {
      await service.updateDraft(await apis(), 'r-draft1', Buffer.from('raw2'));
      expect(gmail.users.drafts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'r-draft1',
          requestBody: { id: 'r-draft1', message: {} },
        }),
      );
    });

    it('sendDraft devuelve el id del mensaje enviado', async () => {
      expect(await service.sendDraft(await apis(), 'r-draft1')).toEqual({
        messageId: 'sent0009',
        threadId: 'thr9',
      });
      expect(gmail.users.drafts.send).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: { id: 'r-draft1' },
      });
    });

    it('borrador inexistente → NotFound con mensaje propio; deleteDraft lo ignora', async () => {
      gmail.users.drafts.send.mockRejectedValue({ status: 404 });
      gmail.users.drafts.get.mockRejectedValue({ status: 404 });
      gmail.users.drafts.delete.mockRejectedValue({ status: 404 });
      await expect(service.sendDraft(await apis(), 'r-draft1')).rejects.toThrow(
        new NotFoundException(DRAFT_NOT_FOUND),
      );
      await expect(service.getDraftMessage(await apis(), 'r-draft1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.deleteDraft(await apis(), 'r-draft1')).resolves.toBeUndefined();
    });

    it('otros errores al enviar el borrador pasan por handleGoogleError (502)', async () => {
      gmail.users.drafts.send.mockRejectedValue(new Error('boom'));
      await expect(service.sendDraft(await apis(), 'r-draft1')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('resolveReply arma destinatario, asunto y encabezados del hilo', async () => {
      expect(await service.resolveReply(await apis(), 'msg00001')).toEqual({
        to: '"Ana" <ana@x.com>',
        subject: 'Re: Hola',
        threadId: 'thr00001',
        inReplyTo: '<orig@x.com>',
        references: '<orig@x.com>',
      });
    });
  });
});
