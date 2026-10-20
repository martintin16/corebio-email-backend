import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Readable } from 'stream';
import {
  MailboxNeedsReconnectException,
  type GoogleMailboxClient,
} from '../google/google-mailbox-client';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { isGmailNotFound, LIST_LIMIT, MessagesService } from './messages.service';

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
      messages: { list: jest.Mock; get: jest.Mock; modify: jest.Mock; send: jest.Mock };
    };
  };
  let google: { forMailbox: jest.Mock; handleGoogleError: jest.Mock };
  let access: { findSummariesByUser: jest.Mock };
  let service: MessagesService;

  beforeEach(() => {
    gmail = {
      users: {
        messages: {
          list: jest.fn().mockResolvedValue({ data: { messages: [{ id: 'msg00001' }] } }),
          get: jest.fn().mockResolvedValue({ data: inboxMessage }),
          modify: jest.fn().mockResolvedValue({ data: {} }),
          send: jest.fn().mockResolvedValue({ data: { id: 'sent0001' } }),
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
    access = { findSummariesByUser: jest.fn() };
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
});
