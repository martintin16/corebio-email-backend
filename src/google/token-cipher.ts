import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class TokenDecryptionError extends Error {
  constructor() {
    super('No se pudo desencriptar el token (clave distinta o dato alterado)');
  }
}

/**
 * Encriptación de secretos guardados en la base (los refresh_token de Google).
 *
 * AES-256-GCM: además de cifrar, autentica — si alguien modifica el valor en la
 * base, desencriptar falla en vez de devolver basura. Cada valor lleva su propio
 * IV aleatorio, así dos tokens iguales no producen el mismo texto cifrado.
 *
 * Formato guardado: `v1.<iv>.<authTag>.<ciphertext>` (base64url). El prefijo de
 * versión deja la puerta abierta a rotar la clave más adelante.
 */
@Injectable()
export class TokenCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('GOOGLE_TOKEN_ENCRYPTION_KEY'), 'base64');
    if (this.key.length !== 32) {
      throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY tiene que ser 32 bytes en base64');
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new TokenDecryptionError();
    try {
      const [, iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new TokenDecryptionError();
    }
  }
}
