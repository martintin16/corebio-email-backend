import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 8 — varios destinatarios (to / cc / bcc) y cupo diario.
 *
 * - scheduled_messages: `cc_addresses` y `bcc_addresses` (emails separados por
 *   coma, '' si no hay) y `recipient_count` (to + cc + bcc), que el job vuelve a
 *   chequear contra el cupo antes de enviar. `to_address` puede quedar '' si todo
 *   va en copia oculta.
 * - mailbox_send_log: un registro por envío hecho desde la app con cuántos
 *   destinatarios tuvo. El cupo se calcula sumando las últimas 24 horas; lo más
 *   viejo de 2 días se va borrando.
 *
 * Mismo cerrojo de RLS que el resto.
 */
export class AddRecipientsAndSendLog1791300000000 implements MigrationInterface {
  name = 'AddRecipientsAndSendLog1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.scheduled_messages
        ADD COLUMN cc_addresses text NOT NULL DEFAULT '',
        ADD COLUMN bcc_addresses text NOT NULL DEFAULT '',
        ADD COLUMN recipient_count integer NOT NULL DEFAULT 1,
        ADD CONSTRAINT scheduled_messages_recipient_count_check CHECK (recipient_count > 0)
    `);
    await queryRunner.query(`
      CREATE TABLE public.mailbox_send_log (
        id bigint GENERATED ALWAYS AS IDENTITY,
        mailbox_id uuid NOT NULL,
        recipients integer NOT NULL,
        source varchar(16) NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT mailbox_send_log_pkey PRIMARY KEY (id),
        CONSTRAINT mailbox_send_log_mailbox_id_fkey FOREIGN KEY (mailbox_id)
          REFERENCES public.mailboxes (id) ON DELETE CASCADE,
        CONSTRAINT mailbox_send_log_recipients_check CHECK (recipients > 0),
        CONSTRAINT mailbox_send_log_source_check
          CHECK (source IN ('compose', 'reply', 'scheduled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX mailbox_send_log_mailbox_sent_idx ON public.mailbox_send_log (mailbox_id, sent_at)`,
    );
    await queryRunner.query(`ALTER TABLE public.mailbox_send_log ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`REVOKE ALL ON TABLE public.mailbox_send_log FROM anon, authenticated`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.mailbox_send_log`);
    await queryRunner.query(`
      ALTER TABLE public.scheduled_messages
        DROP CONSTRAINT IF EXISTS scheduled_messages_recipient_count_check,
        DROP COLUMN IF EXISTS recipient_count,
        DROP COLUMN IF EXISTS bcc_addresses,
        DROP COLUMN IF EXISTS cc_addresses
    `);
  }
}
