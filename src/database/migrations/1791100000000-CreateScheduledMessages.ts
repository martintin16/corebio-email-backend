import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 5 — envíos programados.
 *
 * El mensaje completo (con adjuntos) vive como BORRADOR de Gmail en la casilla
 * (`gmail_draft_id`); acá se guarda lo necesario para listarlo, editarlo y que el
 * job lo envíe a horario:
 * - `body` es el HTML ya sanitizado; `attachments` es la lista de adjuntos del
 *   borrador (`{ id, filename, mimeType, size }`) para no ir a Gmail en cada listado.
 * - `status`: pending → sending → sent, o failed (con `last_error`). Editar uno
 *   `failed` lo vuelve a `pending`.
 * - `next_attempt_at`: cuándo lo toma el job (= `scheduled_at`, o más tarde si
 *   hay que reintentar). El índice parcial cubre la consulta del job.
 * - `locked_until`: mientras alguien lo edita o cancela, el job no lo toma.
 * - `sending_started_at`: si el proceso se corta enviando, queda `sending`; pasado
 *   un rato se marca `failed` ("revisá Enviados"), nunca se reenvía solo.
 * - `reply_*`: si es una respuesta, los datos del hilo para volver a armarlo al editar.
 * - `created_by` / `updated_by`: el envío sale si la última persona que lo
 *   programó o editó sigue activa y con `canSend` en la casilla.
 *
 * Borrar la casilla borra sus programados. Mismo cerrojo de RLS que el resto.
 */
export class CreateScheduledMessages1791100000000 implements MigrationInterface {
  name = 'CreateScheduledMessages1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.scheduled_messages (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        mailbox_id uuid NOT NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        to_address text NOT NULL,
        subject text NOT NULL,
        body text NOT NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        scheduled_at timestamptz NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NULL,
        locked_until timestamptz NULL,
        sending_started_at timestamptz NULL,
        last_error text NULL,
        gmail_draft_id text NULL,
        gmail_message_id text NULL,
        gmail_thread_id text NULL,
        reply_to_message_id text NULL,
        reply_thread_id text NULL,
        reply_in_reply_to text NULL,
        reply_references text NULL,
        sent_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id),
        CONSTRAINT scheduled_messages_mailbox_id_fkey FOREIGN KEY (mailbox_id)
          REFERENCES public.mailboxes (id) ON DELETE CASCADE,
        CONSTRAINT scheduled_messages_created_by_fkey FOREIGN KEY (created_by)
          REFERENCES public.user_profiles (id) ON DELETE SET NULL,
        CONSTRAINT scheduled_messages_updated_by_fkey FOREIGN KEY (updated_by)
          REFERENCES public.user_profiles (id) ON DELETE SET NULL,
        CONSTRAINT scheduled_messages_status_check
          CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
        CONSTRAINT scheduled_messages_attempts_check CHECK (attempts >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX scheduled_messages_due_idx
        ON public.scheduled_messages (next_attempt_at)
        WHERE status = 'pending'
    `);
    await queryRunner.query(`
      CREATE INDEX scheduled_messages_mailbox_idx
        ON public.scheduled_messages (mailbox_id, scheduled_at)
    `);
    await queryRunner.query(`ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `REVOKE ALL ON TABLE public.scheduled_messages FROM anon, authenticated`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.scheduled_messages`);
  }
}
