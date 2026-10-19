/**
 * Permisos que se le piden a Google al conectar una casilla.
 * - gmail.modify: leer, marcar como leído, enviar y responder (Fases 4 y 5).
 * - drive: compartir carpetas/archivos que YA existen en el Drive de la casilla
 *   (Fase 7). `drive.file` no alcanza: solo cubre archivos creados por la app.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
] as const;
