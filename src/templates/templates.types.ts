/**
 * Respuesta de la API — `MessageTemplate` de `lib/types/template.ts` del frontend
 * (`id, name, preview, body, updatedAt, updatedByName`) + `subject` y `mailboxId`.
 */
export interface MessageTemplate {
  id: string;
  mailboxId: string;
  name: string;
  /** Comienzo del cuerpo en una línea de texto, para reconocerla en el menú. */
  preview: string;
  /** Asunto a completar al elegirla; null si la plantilla no tiene. */
  subject: string | null;
  /** HTML sanitizado (el mismo formato que guarda el editor). */
  body: string;
  /** Última edición (o alta), ISO 8601. */
  updatedAt: string;
  /** Nombre de quien la editó por última vez; null si esa persona ya no existe. */
  updatedByName: string | null;
}
