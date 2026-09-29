import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 0 — tabla de perfiles de usuario de Corebio Mail.
 *
 * - `id` es el mismo uuid de `auth.users` (FK con ON DELETE CASCADE).
 * - El rol y el estado viven acá (fuente de verdad del RolesGuard), no en el JWT.
 * - El email NO se duplica: se lee de `auth.users` / del JWT para que no se desincronice.
 * - Trigger: todo usuario nuevo de Supabase Auth recibe un perfil automáticamente,
 *   aunque lo creen desde el dashboard y no desde la app.
 * - Backfill: los usuarios que ya existen hoy reciben su perfil, tomando el rol de
 *   `app_metadata.role` (así el admin actual sigue siéndolo sin tocar nada a mano).
 * - RLS habilitado SIN políticas + REVOKE a anon/authenticated: la tabla queda
 *   cerrada para la Data API pública de Supabase (que usa la anon key del frontend).
 *   El backend se conecta como `postgres` (dueño de la tabla), que no está sujeto a RLS.
 */
export class CreateUserProfiles1790711400000 implements MigrationInterface {
  name = 'CreateUserProfiles1790711400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.user_profiles (
        id uuid NOT NULL,
        name text NOT NULL,
        role varchar(16) NOT NULL DEFAULT 'user',
        status varchar(16) NOT NULL DEFAULT 'invited',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
        CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id)
          REFERENCES auth.users (id) ON DELETE CASCADE,
        CONSTRAINT user_profiles_role_check CHECK (role IN ('user', 'admin')),
        CONSTRAINT user_profiles_status_check CHECK (status IN ('active', 'invited', 'inactive'))
      )
    `);

    await queryRunner.query(`ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
      BEGIN
        INSERT INTO public.user_profiles (id, name, role, status)
        VALUES (
          NEW.id,
          COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            split_part(NEW.email, '@', 1),
            ''
          ),
          CASE WHEN NEW.raw_app_meta_data ->> 'role' = 'admin' THEN 'admin' ELSE 'user' END,
          CASE WHEN NEW.invited_at IS NOT NULL THEN 'invited' ELSE 'active' END
        )
        ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated`,
    );

    await queryRunner.query(`
      CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()
    `);

    await queryRunner.query(`
      INSERT INTO public.user_profiles (id, name, role, status)
      SELECT
        u.id,
        COALESCE(
          NULLIF(u.raw_user_meta_data ->> 'name', ''),
          NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
          split_part(u.email, '@', 1),
          ''
        ),
        CASE WHEN u.raw_app_meta_data ->> 'role' = 'admin' THEN 'admin' ELSE 'user' END,
        CASE WHEN u.invited_at IS NOT NULL AND u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END
      FROM auth.users u
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.handle_new_auth_user()`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.user_profiles`);
  }
}
