/**
 * "Huella" de una casilla para que el front sepa si tiene que volver a pedir
 * las listas. No hay que interpretar los valores: si alguno cambió, algo
 * cambió.
 */
export interface MailboxSyncState {
  /**
   * `historyId` de Gmail: cambia con cualquier novedad de la casilla (llega un
   * mail, se envía, se lee, se etiqueta, se borra).
   */
  historyId: string;
  /** Cambia al crear, editar, cancelar, enviar o fallar un programado de la casilla. */
  scheduledVersion: string;
}
