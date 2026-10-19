const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Forma canónica de una dirección para compararla con la que reporta Google.
 * En Gmail los puntos de la parte local no cuentan (`a.b@gmail.com` es la misma
 * casilla que `ab@gmail.com`) y `googlemail.com` es alias de `gmail.com`.
 * Para otros dominios (ej. Google Workspace de una organización) solo se ignoran
 * mayúsculas y espacios.
 */
export function canonicalEmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split('@');
  if (!domain) return email.trim().toLowerCase();
  if (GMAIL_DOMAINS.has(domain)) return `${local.replace(/\./g, '')}@gmail.com`;
  return `${local}@${domain}`;
}

/** true si las dos direcciones son la misma casilla. */
export function sameMailboxAddress(a: string, b: string): boolean {
  return canonicalEmail(a) === canonicalEmail(b);
}
