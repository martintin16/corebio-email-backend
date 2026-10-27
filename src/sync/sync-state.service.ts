import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GoogleMailboxClient } from '../google/google-mailbox-client';
import type { MailboxSyncState } from './sync-state.types';

/**
 * Estado de sincronización de una casilla. El front lo consulta cada minuto
 * (y al volver a la pestaña) y recién si cambió vuelve a pedir las listas.
 *
 * Es barato a propósito: `users.getProfile` cuesta 1 unidad de cuota de
 * Gmail; pedir Recibidos cuesta ~100 (la lista + leer cada mensaje). Por eso
 * no se usa push de Gmail (Pub/Sub): para pocas personas con la app abierta,
 * preguntar cada minuto alcanza y no suma piezas para mantener.
 */
@Injectable()
export class SyncStateService {
  constructor(
    private readonly google: GoogleMailboxClient,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getState(mailboxId: string): Promise<MailboxSyncState> {
    const [historyId, scheduledVersion] = await Promise.all([
      this.gmailHistoryId(mailboxId),
      this.scheduledVersion(mailboxId),
    ]);
    return { historyId, scheduledVersion };
  }

  private async gmailHistoryId(mailboxId: string): Promise<string> {
    const apis = await this.google.forMailbox(mailboxId);
    try {
      const { data } = await apis.gmail.users.getProfile({ userId: 'me' });
      return data.historyId ?? '';
    } catch (err) {
      return this.google.handleGoogleError(mailboxId, err);
    }
  }

  /**
   * Cuántos programados hay y cuándo cambió el último. El conteo cubre
   * cancelar (se borra la fila); la fecha, el resto (editar, enviar, fallar).
   */
  private async scheduledVersion(mailboxId: string): Promise<string> {
    const rows = await this.dataSource.query<{ total: string; last: string | null }[]>(
      `SELECT count(*)::text AS total,
              (extract(epoch FROM max(updated_at)) * 1000)::bigint::text AS last
         FROM public.scheduled_messages
        WHERE mailbox_id = $1`,
      [mailboxId],
    );
    const row = rows[0];
    return `${row?.total ?? '0'}:${row?.last ?? ''}`;
  }
}
