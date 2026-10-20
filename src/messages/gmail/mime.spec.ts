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
});
