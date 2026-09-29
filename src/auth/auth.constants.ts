/** Metadata que marca un endpoint como público (sin token). */
export const IS_PUBLIC_KEY = 'corebio:isPublic';

/** Metadata con los roles requeridos por un endpoint. */
export const ROLES_KEY = 'corebio:roles';

/** Token de inyección de la función que resuelve las claves públicas del JWKS. */
export const JWKS_RESOLVER = Symbol('JWKS_RESOLVER');

/** Issuer de los JWT de Supabase Auth: `<SUPABASE_URL>/auth/v1`. */
export function supabaseIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

/** URL del JWKS público de Supabase Auth. */
export function supabaseJwksUrl(supabaseUrl: string): string {
  return `${supabaseIssuer(supabaseUrl)}/.well-known/jwks.json`;
}
