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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
