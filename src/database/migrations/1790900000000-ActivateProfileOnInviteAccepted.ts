import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 — `invited → active` cuando la persona acepta la invitación.
 *
 * Aceptar = abrir el link del email y validarlo: Supabase confirma el email
 * (`email_confirmed_at`) y abre la sesión (`last_sign_in_at`). Este trigger mira
 * esas dos columnas de `auth.users` y pasa el perfil a `active` en ese momento,
 * sin depender de que el usuario después le haga un request al backend.
 *
 * - Solo toca perfiles en `invited`: un usuario desactivado (`inactive`) nunca
 *   vuelve a `active` por iniciar sesión.
 * - Backfill: los que ya aceptaron y quedaron en `invited` pasan a `active`.
 * - El chequeo en JwtAuthGuard queda como red de seguridad.
 */
export class ActivateProfileOnInviteAccepted1790900000000 implements MigrationInterface {
  name = 'ActivateProfileOnInviteAccepted1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.handle_auth_user_signed_in()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
      BEGIN
        IF (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
          OR (OLD.last_sign_in_at IS NULL AND NEW.last_sign_in_at IS NOT NULL) THEN
          UPDATE public.user_profiles
          SET status = 'active', updated_at = now()
          WHERE id = NEW.id AND status = 'invited';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.handle_auth_user_signed_in() FROM PUBLIC, anon, authenticated`,
    );

    await queryRunner.query(`
      CREATE TRIGGER on_auth_user_signed_in
      AFTER UPDATE OF email_confirmed_at, last_sign_in_at ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_signed_in()
    `);

    await queryRunner.query(`
      UPDATE public.user_profiles p
      SET status = 'active', updated_at = now()
      FROM auth.users u
      WHERE u.id = p.id
        AND p.status = 'invited'
        AND (u.email_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS on_auth_user_signed_in ON auth.users`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.handle_auth_user_signed_in()`);
  }
}
