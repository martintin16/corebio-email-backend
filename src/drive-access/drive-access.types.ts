/** Respuesta de la API — `DriveItem` de `lib/types/drive.ts` del frontend. */
export interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  /** La carpeta pedida ("root" para Mi unidad). */
  parentId: string | null;
  /** Si la persona pedida (`userId`) ya tiene acceso a este ítem hoy. */
  shared: boolean;
}

export interface DriveAccessFailure {
  id: string;
  /** Nombre del ítem, si se pudo leer. */
  name: string | null;
  reason: string;
}

/** Resultado de PUT /mailboxes/:id/drive/access/:userId. */
export interface DriveAccessResult {
  /** Ids que se compartieron ahora. */
  added: string[];
  /** Ids a los que se le quitó el acceso. */
  removed: string[];
  /** Los que no se pudieron cambiar (el resto sí se aplicó). */
  failed: DriveAccessFailure[];
}

/** Resultado de quitarle a alguien todo lo compartido en el Drive de una casilla. */
export interface DriveRevokeResult {
  mailboxId: string;
  removed: number;
  failed: number;
  /** Si no se pudo ni empezar (ej. la casilla necesita reconectarse). */
  error: string | null;
}
