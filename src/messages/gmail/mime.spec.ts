import { buildRawMessage } from './mime';

describe('buildRawMessage', () => {
  it('arma un mensaje con remitente, asunto codificado, texto, HTML y adjuntos', async () => {
    const raw = (
      await buildRawMessage({
        from: { name: 'Tesorería', address: 'casilla@gmail.com' },
        to: 'ana@x.com',
        subject: 'Reunión',
        html: '<p>Hola</p>',
        text: 'Hola',
        attachments: [
          { filename: 'nota.txt', contentType: 'text/plain', content: Buffer.from('contenido') },
        ],
      })
    ).toString('utf8');

    expect(raw).toMatch(/^From: =\?UTF-8\?.+\?= <casilla@gmail\.com>/m);
    expect(raw).toMatch(/^To: ana@x\.com/m);
    expect(raw).toMatch(/^Subject: =\?UTF-8\?/m); // tilde → encoded word
    expect(raw).toContain('multipart/mixed');
    expect(raw).toContain('text/html');
    expect(raw).toContain('filename=nota.txt');
  });

  it('incluye In-Reply-To y References al responder', async () => {
    const raw = (
      await buildRawMessage({
        from: { name: 'Casilla', address: 'casilla@gmail.com' },
        to: 'Ana <ana@x.com>',
        subject: 'Re: Hola',
        html: '<p>ok</p>',
        text: 'ok',
        inReplyTo: '<orig@mail.gmail.com>',
        references: '<a@x> <orig@mail.gmail.com>',
      })
    ).toString('utf8');

    expect(raw).toMatch(/^In-Reply-To: <orig@mail\.gmail\.com>/m);
    expect(raw).toMatch(/^References: <a@x> <orig@mail\.gmail\.com>/m);
  });

  it('varios destinatarios en To y Cc, y el Bcc va en el mensaje (Gmail lo necesita para entregar)', async () => {
    const raw = (
      await buildRawMessage({
        from: { name: 'Casilla', address: 'casilla@gmail.com' },
        to: ['ana@x.com', 'beto@y.com'],
        cc: ['carla@z.com'],
        bcc: ['oculto1@w.com', 'oculto2@w.com'],
        subject: 'Hola',
        html: '<p>ok</p>',
        text: 'ok',
      })
    ).toString('utf8');

    expect(raw).toMatch(/^To: ana@x\.com, beto@y\.com/m);
    expect(raw).toMatch(/^Cc: carla@z\.com/m);
    expect(raw).toMatch(/^Bcc: oculto1@w\.com, oculto2@w\.com/m);
  });

  it('sin cc ni bcc no agrega esos encabezados', async () => {
    const raw = (
      await buildRawMessage({
        from: { name: 'Casilla', address: 'casilla@gmail.com' },
        to: [],
        bcc: ['solo@w.com'],
        subject: 'Hola',
        html: '<p>ok</p>',
        text: 'ok',
      })
    ).toString('utf8');
    expect(raw).not.toMatch(/^Cc:/m);
    expect(raw).toMatch(/^Bcc: solo@w\.com/m);
  });
});
