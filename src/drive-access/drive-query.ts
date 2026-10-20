import { canonicalEmail } from '../google/email-address';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * La cuenta de Google a la que llega una dirección, para compartir en Drive.
 * En Gmail, `ana+algo@gmail.com` es la MISMA cuenta que `ana@gmail.com`: Drive
 * comparte con la cuenta y en sus permisos aparece la dirección principal. Por
 * eso se busca y se compara sin el `+algo`.
 */
export function driveAccountEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split('@');
  if (!domain || !GMAIL_DOMAINS.has(domain)) return normalized;
  return `${local.split('+')[0]}@${domain}`;
}

/** true si dos direcciones son la misma cuenta para Drive. */
export function sameDriveAccount(a: string, b: string): boolean {
  return canonicalEmail(driveAccountEmail(a)) === canonicalEmail(driveAccountEmail(b));
}

/** Escapa un valor para ponerlo entre comillas simples en una consulta `q` de Drive. */
export function driveQueryValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Ítems a los que la cuenta tiene acceso de lectura o edición. */
export function sharedWithClause(email: string): string {
  const v = driveQueryValue(driveAccountEmail(email));
  return `(${v} in writers or ${v} in readers)`;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** "root" (Mi unidad) o un id de Drive. */
export const DRIVE_ID = /^(root|[A-Za-z0-9_-]{10,200})$/;
