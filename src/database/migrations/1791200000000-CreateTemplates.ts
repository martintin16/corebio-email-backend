import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 6 — plantillas por casilla.
 *
 * - `name` no se repite dentro de una casilla, sin distinguir mayúsculas
 *   (índice único sobre `lower(name)`).
 * - `subject` es opcional: si está, al elegir la plantilla también se completa el asunto.
 * - `body` es HTML ya sanitizado (mismo filtro que Redactar).
 * - Borrar la casilla borra sus plantillas; borrar a quien la creó o editó la deja
 *   sin autor (SET NULL).
 *
 * Mismo cerrojo de RLS que el resto de las tablas.
 */
export class CreateTemplates1791200000000 implements MigrationInterface {
  name = 'CreateTemplates1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.templates (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        mailbox_id uuid NOT NULL,
        name text NOT NULL,
        subject text NULL,
        body text NOT NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT templates_pkey PRIMARY KEY (id),
        CONSTRAINT templates_mailbox_id_fkey FOREIGN KEY (mailbox_id)
          REFERENCES public.mailboxes (id) ON DELETE CASCADE,
        CONSTRAINT templates_created_by_fkey FOREIGN KEY (created_by)
          REFERENCES public.user_profiles (id) ON DELETE SET NULL,
        CONSTRAINT templates_updated_by_fkey FOREIGN KEY (updated_by)
          REFERENCES public.user_profiles (id) ON DELETE SET NULL,
        CONSTRAINT templates_name_not_blank_check CHECK (length(btrim(name)) > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX templates_mailbox_name_key ON public.templates (mailbox_id, lower(name))`,
    );
    await queryRunner.query(`ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`REVOKE ALL ON TABLE public.templates FROM anon, authenticated`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.templates`);
  }
}
