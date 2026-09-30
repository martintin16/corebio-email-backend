import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 1 — casillas institucionales y permisos por casilla.
 *
 * mailboxes
 * - `email` se guarda siempre en minúsculas (CHECK) y es único: dos filas no
 *   pueden representar la misma casilla con distinto uso de mayúsculas.
 * - `auth_type` define cómo se autentica contra Google (Fase 3): OAuth con
 *   refresh_token propio, o domain-wide delegation de Workspace. Existe desde
 *   ahora para que sumar domain-wide no requiera migrar el esquema.
 * - `status` arranca en `needs_reconnect`: hasta que la casilla complete el
 *   OAuth (Fase 3) no hay credenciales para hablar con Gmail/Drive.
 *
 * mailbox_access
 * - Una fila por (usuario, casilla) con al menos un permiso en true (CHECK):
 *   "sin permisos" se representa borrando la fila, no con dos false.
 * - Borrar el usuario (auth.users → user_profiles) o la casilla borra sus accesos.
 *
 * Mismo cerrojo que user_profiles: RLS sin políticas + REVOKE a anon/authenticated,
 * para que la Data API pública de Supabase no pueda leer ni escribir estas tablas.
 */
export class CreateMailboxes1790800000000 implements MigrationInterface {
  name = 'CreateMailboxes1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.mailboxes (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        email text NOT NULL,
        display_name text NOT NULL,
        auth_type varchar(16) NOT NULL DEFAULT 'oauth',
        status varchar(16) NOT NULL DEFAULT 'needs_reconnect',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT mailboxes_pkey PRIMARY KEY (id),
        CONSTRAINT mailboxes_email_key UNIQUE (email),
        CONSTRAINT mailboxes_email_lowercase_check CHECK (email = lower(email)),
        CONSTRAINT mailboxes_auth_type_check CHECK (auth_type IN ('oauth', 'domain_wide')),
        CONSTRAINT mailboxes_status_check CHECK (status IN ('connected', 'needs_reconnect'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE public.mailbox_access (
        user_id uuid NOT NULL,
        mailbox_id uuid NOT NULL,
        can_send boolean NOT NULL DEFAULT false,
        can_read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT mailbox_access_pkey PRIMARY KEY (user_id, mailbox_id),
        CONSTRAINT mailbox_access_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES public.user_profiles (id) ON DELETE CASCADE,
        CONSTRAINT mailbox_access_mailbox_id_fkey FOREIGN KEY (mailbox_id)
          REFERENCES public.mailboxes (id) ON DELETE CASCADE,
        CONSTRAINT mailbox_access_any_permission_check CHECK (can_send OR can_read)
      )
    `);
    // La PK ya indexa por user_id; este índice cubre las búsquedas por casilla
    // (conteo de usuarios, "quién tiene acceso a esta casilla").
    await queryRunner.query(
      `CREATE INDEX mailbox_access_mailbox_id_idx ON public.mailbox_access (mailbox_id)`,
    );

    for (const table of ['mailboxes', 'mailbox_access']) {
      await queryRunner.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.mailbox_access`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.mailboxes`);
  }
}
