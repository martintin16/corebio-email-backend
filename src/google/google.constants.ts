/**
 * Permisos que se le piden a Google al conectar una casilla.
 * - gmail.modify: leer, marcar como leído, etiquetar, enviar y responder (Fases 4, 5 y 8).
 * - drive: compartir carpetas/archivos que YA existen en el Drive de la casilla
 *   (Fase 7). `drive.file` no alcanza: solo cubre archivos creados por la app.
 * - contacts.readonly / contacts.other.readonly: leer contactos, grupos y
 *   "Otros contactos" para Redactar (Fase 8). Solo lectura.
 */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
export const OTHER_CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.other.readonly';

/**
 * Sin estos la casilla no sirve: si en la pantalla de Google se destildan, la
 * conexión se rechaza (`missing_scopes`).
 */
export const REQUIRED_GOOGLE_SCOPES = [GMAIL_SCOPE, DRIVE_SCOPE] as const;

/**
 * Todo lo que se pide. Los de Contactos son opcionales: si se destildan, la
 * casilla conecta igual y solo Contactos responde 409 `mailbox_missing_scope`.
 */
export const GOOGLE_SCOPES = [
  ...REQUIRED_GOOGLE_SCOPES,
  CONTACTS_SCOPE,
  OTHER_CONTACTS_SCOPE,
] as const;
