import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';

/**
 * Utilidades para tests: simulan a Supabase Auth con un par de claves ES256 propio,
 * así los tests de auth no dependen de la red ni de un proyecto real.
 */
export const TEST_SUPABASE_URL = 'https://test-project.supabase.co';
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;
export const TEST_AUDIENCE = 'authenticated';
export const TEST_KID = 'test-key';

export interface TestKeys {
  privateKey: KeyLike;
  jwks: JWTVerifyGetKey;
}

export async function createTestKeys(): Promise<TestKeys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = TEST_KID;
  jwk.alg = 'ES256';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

export interface TestTokenOptions {
  sub?: string;
  email?: string;
  issuer?: string;
  audience?: string;
  /** Epoch en segundos. Por defecto, dentro de 1 hora. */
  expiresAt?: number;
  kid?: string;
}

export function signTestToken(
  privateKey: KeyLike,
  options: TestTokenOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = options.expiresAt ?? now + 3600;
  return new SignJWT({ email: options.email ?? 'ana@example.org', role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: options.kid ?? TEST_KID })
    .setSubject(options.sub ?? '11111111-1111-4111-8111-111111111111')
    .setIssuer(options.issuer ?? TEST_ISSUER)
    .setAudience(options.audience ?? TEST_AUDIENCE)
    .setIssuedAt(Math.min(now, expiresAt - 60))
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}
