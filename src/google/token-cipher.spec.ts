import { ConfigService } from '@nestjs/config';
import { TokenCipher, TokenDecryptionError } from './token-cipher';

const cipherWith = (byte: number) =>
  new TokenCipher(
    new ConfigService({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, byte).toString('base64') }),
  );

describe('TokenCipher', () => {
  const cipher = cipherWith(1);

  it('encripta y desencripta el mismo valor', () => {
    const payload = cipher.encrypt('1//refresh-token');
    expect(payload).not.toContain('refresh-token');
    expect(payload.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(payload)).toBe('1//refresh-token');
  });

  it('el mismo valor produce textos cifrados distintos (IV aleatorio)', () => {
    expect(cipher.encrypt('x')).not.toBe(cipher.encrypt('x'));
  });

  it('falla si el dato fue alterado', () => {
    const [v, iv, tag, ct] = cipher.encrypt('secreto').split('.');
    const tampered = [v, iv, tag, (ct.startsWith('A') ? 'B' : 'A') + ct.slice(1)];
    expect(() => cipher.decrypt(tampered.join('.'))).toThrow(TokenDecryptionError);
  });

  it('falla con otra clave', () => {
    const payload = cipher.encrypt('secreto');
    expect(() => cipherWith(2).decrypt(payload)).toThrow(TokenDecryptionError);
  });

  it('falla con un formato desconocido', () => {
    expect(() => cipher.decrypt('texto-plano')).toThrow(TokenDecryptionError);
  });

  it('no arranca con una clave que no es de 32 bytes', () => {
    expect(
      () =>
        new TokenCipher(
          new ConfigService({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
        ),
    ).toThrow();
  });
});
