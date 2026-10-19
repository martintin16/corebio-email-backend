import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3 — credenciales de Google por casilla (OAuth).
 *
 * - `google_refresh_token`: el refresh_token ENCRIPTADO en la aplicación
 *   (AES-256-GCM, clave GOOGLE_TOKEN_ENCRYPTION_KEY). La base nunca ve el token
 *   en claro: un dump o un acceso indebido a la tabla no alcanza para usarlo.
 * - `google_scopes`: los permisos que Google realmente otorgó (separados por espacio).
 * - `connected_at` / `connected_by`: cuándo y qué admin hizo la última conexión.
 *
 * Son nullable: una casilla recién creada (o en `needs_reconnect`) no tiene credenciales.
 * La tabla ya tiene el cerrojo de RLS de la Fase 1.
 */
export class AddMailboxGoogleCredentials1791000000000 implements MigrationInterface {
  name = 'AddMailboxGoogleCredentials1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.mailboxes
        ADD COLUMN google_refresh_token text NULL,
        ADD COLUMN google_scopes text NULL,
        ADD COLUMN connected_at timestamptz NULL,
        ADD COLUMN connected_by uuid NULL,
        ADD CONSTRAINT mailboxes_connected_by_fkey FOREIGN KEY (connected_by)
          REFERENCES public.user_profiles (id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.mailboxes
        DROP CONSTRAINT IF EXISTS mailboxes_connected_by_fkey,
        DROP COLUMN IF EXISTS connected_by,
        DROP COLUMN IF EXISTS connected_at,
        DROP COLUMN IF EXISTS google_scopes,
        DROP COLUMN IF EXISTS google_refresh_token
    `);
  }
}
