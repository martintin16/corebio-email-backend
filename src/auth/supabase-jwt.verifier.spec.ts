import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, generateKeyPair, SignJWT } from 'jose';
import {
  createTestKeys,
  signTestToken,
  TEST_AUDIENCE,
  TEST_SUPABASE_URL,
  type TestKeys,
} from '../../test/utils/jwt';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier';

function buildConfig(): ConfigService {
  return new ConfigService({
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_JWT_AUDIENCE: TEST_AUDIENCE,
  });
}

describe('SupabaseJwtVerifier', () => {
  let keys: TestKeys;
  let verifier: SupabaseJwtVerifier;

  beforeAll(async () => {
    keys = await createTestKeys();
  });

  beforeEach(() => {
    verifier = new SupabaseJwtVerifier(keys.jwks, buildConfig());
  });

  it('acepta un token válido y devuelve sub y email', async () => {
    const token = await signTestToken(keys.privateKey, {
      sub: '22222222-2222-4222-8222-222222222222',
      email: 'tesoreria@example.org',
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      sub: '22222222-2222-4222-8222-222222222222',
      email: 'tesoreria@example.org',
    });
  });

  it('rechaza un token vencido', async () => {
    const token = await signTestToken(keys.privateKey, {
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
    });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token con otro issuer', async () => {
    const token = await signTestToken(keys.privateKey, {
      issuer: 'https://otro-proyecto.supabase.co/auth/v1',
    });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token con otra audience', async () => {
    const token = await signTestToken(keys.privateKey, { audience: 'anon' });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token firmado con una clave que no está en el JWKS', async () => {
    const { privateKey: otherKey } = await generateKeyPair('ES256');
    const token = await signTestToken(otherKey);
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza tokens HS256 (la key legacy de Supabase no se acepta)', async () => {
    const secret = new TextEncoder().encode('legacy-shared-secret-legacy-shared-secret');
    const token = await new SignJWT({ email: 'x@example.org' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('33333333-3333-4333-8333-333333333333')
      .setIssuer(`${TEST_SUPABASE_URL}/auth/v1`)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime('1h')
      .sign(secret);
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza basura que no es un JWT', async () => {
    await expect(verifier.verify('no-es-un-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('responde 503 si el JWKS no responde a tiempo', async () => {
    const timingOut = new SupabaseJwtVerifier(() => {
      throw new errors.JWKSTimeout();
    }, buildConfig());
    const token = await signTestToken(keys.privateKey);
    await expect(timingOut.verify(token)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('responde 503 ante un error inesperado obteniendo las claves', async () => {
    const broken = new SupabaseJwtVerifier(() => {
      throw new Error('ECONNRESET');
    }, buildConfig());
    const token = await signTestToken(keys.privateKey);
    await expect(broken.verify(token)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
