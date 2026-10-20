/** Respuesta de la API — `lib/types/contact.ts` del frontend. */

export interface ContactGroup {
  id: string;
  name: string;
  /** Lo que informa Google (incluye contactos sin email, que no se listan como miembros). */
  memberCount: number;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
}
