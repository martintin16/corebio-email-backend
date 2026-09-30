import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Permisos de un usuario sobre una casilla. Solo existe si al menos uno de los
 * dos permisos es true (CHECK en la base); "sin acceso" = no hay fila.
 */
@Entity({ name: 'mailbox_access' })
export class MailboxAccess {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'mailbox_id', type: 'uuid' })
  mailboxId: string;

  @Column({ name: 'can_send', type: 'boolean', default: false })
  canSend: boolean;

  @Column({ name: 'can_read', type: 'boolean', default: false })
  canRead: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
