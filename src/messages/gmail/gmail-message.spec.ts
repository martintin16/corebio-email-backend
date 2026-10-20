import type { gmail_v1 } from 'googleapis';
import {
  decodeEntities,
  decodeMimeWords,
  extractBodies,
  getHeader,
  messageDateIso,
  parseAddress,
  replySubject,
} from './gmail-message';

const b64 = (s: string, encoding: BufferEncoding = 'utf8') =>
  Buffer.from(s, encoding).toString('base64url');

describe('parseAddress', () => {
  it.each([
    ['"Ana Pérez" <ana@x.com>', { name: 'Ana Pérez', email: 'ana@x.com' }],
    ['Ana <ana@x.com>', { name: 'Ana', email: 'ana@x.com' }],
    ['ana@x.com', { name: 'ana@x.com', email: 'ana@x.com' }],
    ['<ana@x.com>', { name: 'ana@x.com', email: 'ana@x.com' }],
    ['"Pérez, Ana" <ana@x.com>, otro@y.com', { name: 'Pérez, Ana', email: 'ana@x.com' }],
  ])('%p', (input, expected) => {
    expect(parseAddress(input)).toEqual(expected);
  });
});

describe('decodeMimeWords', () => {
  it('decodifica base64 y quoted-printable', () => {
    expect(decodeMimeWords(`=?UTF-8?B?${Buffer.from('Reunión').toString('base64')}?=`)).toBe(
      'Reunión',
    );
    expect(decodeMimeWords('=?UTF-8?Q?Reuni=C3=B3n_de_hoy?=')).toBe('Reunión de hoy');
    expect(decodeMimeWords('=?ISO-8859-1?Q?caf=E9?=')).toBe('café');
  });

  it('deja igual lo que no está codificado', () => {
    expect(decodeMimeWords('Hola')).toBe('Hola');
  });
});

describe('getHeader', () => {
  it('no distingue mayúsculas y devuelve "" si no está', () => {
    const msg: gmail_v1.Schema$Message = {
      payload: { headers: [{ name: 'Message-Id', value: '<a@b>' }] },
    };
    expect(getHeader(msg, 'message-id')).toBe('<a@b>');
    expect(getHeader(msg, 'Subject')).toBe('');
  });
});

describe('extractBodies', () => {
  it('encuentra html y texto en partes anidadas e ignora adjuntos', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Hola texto') } },
            { mimeType: 'text/html', body: { data: b64('<p>Hola html</p>') } },
          ],
        },
        { mimeType: 'text/plain', filename: 'nota.txt', body: { data: b64('adjunto') } },
      ],
    };
    expect(extractBodies(payload)).toEqual({ html: '<p>Hola html</p>', text: 'Hola texto' });
  });

  it('respeta el charset de la parte', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: b64('café', 'latin1') },
    };
    expect(extractBodies(payload).text).toBe('café');
  });

  it('sin cuerpos devuelve null', () => {
    expect(extractBodies(undefined)).toEqual({ html: null, text: null });
  });
});

describe('decodeEntities', () => {
  it('decodifica las entidades que usa Gmail en snippet', () => {
    expect(decodeEntities('It&#39;s &amp; &quot;ok&quot; &lt;3 &#x41;')).toBe(`It's & "ok" <3 A`);
  });
});

describe('messageDateIso', () => {
  it('usa internalDate (ms)', () => {
    expect(messageDateIso({ internalDate: '1700000000000' })).toBe('2023-11-14T22:13:20.000Z');
  });

  it('si no hay internalDate usa el encabezado Date', () => {
    const msg: gmail_v1.Schema$Message = {
      payload: { headers: [{ name: 'Date', value: 'Tue, 14 Nov 2023 22:13:20 +0000' }] },
    };
    expect(messageDateIso(msg)).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('replySubject', () => {
  it('agrega "Re: " una sola vez', () => {
    expect(replySubject('Hola')).toBe('Re: Hola');
    expect(replySubject('RE: Hola')).toBe('RE: Hola');
  });
});
