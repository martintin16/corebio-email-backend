import { BadGatewayException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type AuthError, type SupabaseClient } from '@supabase/supabase-js';
import type { AppRole } from './users.types';

/** El email ya tiene una cuenta confirmada en Supabase Auth. */
export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('El email ya está registrado');
  }
}

/** Qué email terminó mandando un reenvío de invitación. */
export type ResendKind = 'invite' | 'recovery';

/**
 * Operaciones de administración sobre Supabase Auth que necesita Users.
 * Es una clase abstracta (y no la librería directa) para poder simularla en los
 * tests y para que el resto del código no dependa de la forma de supabase-js.
 */
export abstract class SupabaseAdminClient {
  /** Crea el usuario en Auth y le manda el email de invitación. Devuelve su id. */
  abstract inviteUser(
    email: string,
    options: { name: string; redirectTo: string },
  ): Promise<string>;
  /** Reenvía la invitación (o, si Supabase no lo permite, un email para elegir contraseña). */
  abstract resendInvite(email: string, redirectTo: string): Promise<ResendKind>;
  /** Copia el rol a `app_metadata.role` (solo lo usa el frontend para ocultar UI). */
  abstract setAppRole(userId: string, role: AppRole): Promise<void>;
  /** Bloquea el login y la renovación de tokens del usuario. */
  abstract banUser(userId: string): Promise<void>;
  /** Borra el usuario de Auth (su perfil y accesos se borran en cascada). */
  abstract deleteUser(userId: string): Promise<void>;
}

/** ~100 años: Supabase no tiene "ban permanente", se usa una duración muy larga. */
const PERMANENT_BAN = '876000h';

function isEmailExists(error: AuthError): boolean {
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    /already (been )?registered/i.test(error.message)
  );
}

function isUserNotFound(error: AuthError): boolean {
  return error.code === 'user_not_found' || error.status === 404;
}

@Injectable()
export class SupabaseJsAdminClient extends SupabaseAdminClient implements OnModuleInit {
  private readonly logger = new Logger(SupabaseJsAdminClient.name);
  private client: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    super();
  }

  onModuleInit(): void {
    this.client = createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      // Cliente de servidor: sin sesión propia, sin refresco ni lectura de URL.
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    );
  }

  async inviteUser(email: string, options: { name: string; redirectTo: string }): Promise<string> {
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, {
      data: { name: options.name },
      redirectTo: options.redirectTo,
    });
    if (error) {
      if (isEmailExists(error)) throw new EmailAlreadyRegisteredError();
      throw this.upstream('invitar al usuario', error);
    }
    return data.user.id;
  }

  async resendInvite(email: string, redirectTo: string): Promise<ResendKind> {
    const invite = await this.client.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (!invite.error) return 'invite';
    if (!isEmailExists(invite.error)) throw this.upstream('reenviar la invitación', invite.error);

    // Supabase no reenvía invitaciones a cuentas que considera confirmadas. Plan B:
    // el email de "elegir contraseña" (plantilla Reset password), que con el link
    // `token_hash` lleva a la misma pantalla de /reset-password.
    this.logger.warn('Supabase rechazó reenviar la invitación; se manda el email de recovery');
    const recovery = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (recovery.error) throw this.upstream('reenviar la invitación', recovery.error);
    return 'recovery';
  }

  async setAppRole(userId: string, role: AppRole): Promise<void> {
    const { error } = await this.client.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    });
    if (error) throw this.upstream('actualizar el rol en Supabase', error);
  }

  async banUser(userId: string): Promise<void> {
    const { error } = await this.client.auth.admin.updateUserById(userId, {
      ban_duration: PERMANENT_BAN,
    });
    if (error) throw this.upstream('bloquear el login del usuario', error);
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (error && !isUserNotFound(error)) throw this.upstream('borrar el usuario', error);
  }

  private upstream(action: string, error: AuthError): BadGatewayException {
    this.logger.error(`Supabase Auth falló al ${action}: [${error.status}] ${error.message}`);
    return new BadGatewayException(`No se pudo ${action} (Supabase Auth). Intentá de nuevo.`);
  }
}
