import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Plantilla de una casilla (nombre, asunto opcional y cuerpo HTML). */
@Entity({ name: 'templates' })
export class Template {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'mailbox_id', type: 'uuid' })
  mailboxId: string;

  /** Único por casilla sin distinguir mayúsculas (índice en la base). */
  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  subject: string | null;

  /** HTML sanitizado. */
  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
