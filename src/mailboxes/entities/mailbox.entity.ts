import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MailboxAuthType, MailboxConnectionStatus } from '../mailboxes.types';

/**
 * Casilla institucional de Gmail (ej. tesoreria@corebio.org).
 * Las credenciales de Google (refresh_token encriptado) se suman en la Fase 3.
 */
@Entity({ name: 'mailboxes' })
export class Mailbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Siempre en minúsculas (lo garantiza un CHECK en la base). */
  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName: string;

  @Column({ name: 'auth_type', type: 'varchar', length: 16, default: 'oauth' })
  authType: MailboxAuthType;

  @Column({ type: 'varchar', length: 16, default: 'needs_reconnect' })
  status: MailboxConnectionStatus;

  /**
   * refresh_token de Google ENCRIPTADO (ver TokenCipher). `select: false`: no se
   * carga en ninguna consulta salvo que se pida explícitamente con `addSelect`,
   * para que nunca termine por error en una respuesta o en un log.
   */
  @Column({ name: 'google_refresh_token', type: 'text', nullable: true, select: false })
  googleRefreshToken: string | null;

  /** Permisos que Google otorgó, separados por espacio. */
  @Column({ name: 'google_scopes', type: 'text', nullable: true })
  googleScopes: string | null;

  @Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
  connectedAt: Date | null;

  /** Admin que hizo la última conexión con Google. */
  @Column({ name: 'connected_by', type: 'uuid', nullable: true })
  connectedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
