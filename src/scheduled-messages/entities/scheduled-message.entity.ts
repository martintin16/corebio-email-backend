import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AttachmentInfo } from '../../messages/messages.types';
import type { ScheduledMessageStatus } from '../scheduled-messages.types';

/** Un envío programado. El contenido real está en un borrador de Gmail de la casilla. */
@Entity({ name: 'scheduled_messages' })
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'mailbox_id', type: 'uuid' })
  mailboxId: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  /** Destinatario (puede ser `Nombre <email>` si es una respuesta). */
  @Column({ name: 'to_address', type: 'text' })
  to: string;

  @Column({ type: 'text' })
  subject: string;

  /** HTML sanitizado. */
  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  attachments: AttachmentInfo[];

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ScheduledMessageStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'sending_started_at', type: 'timestamptz', nullable: true })
  sendingStartedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'gmail_draft_id', type: 'text', nullable: true })
  gmailDraftId: string | null;

  @Column({ name: 'gmail_message_id', type: 'text', nullable: true })
  gmailMessageId: string | null;

  @Column({ name: 'gmail_thread_id', type: 'text', nullable: true })
  gmailThreadId: string | null;

  @Column({ name: 'reply_to_message_id', type: 'text', nullable: true })
  replyToMessageId: string | null;

  @Column({ name: 'reply_thread_id', type: 'text', nullable: true })
  replyThreadId: string | null;

  @Column({ name: 'reply_in_reply_to', type: 'text', nullable: true })
  replyInReplyTo: string | null;

  @Column({ name: 'reply_references', type: 'text', nullable: true })
  replyReferences: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
