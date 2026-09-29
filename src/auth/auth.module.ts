import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { JWKS_RESOLVER, supabaseJwksUrl } from './auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier';

/**
 * Autenticación (JWT de Supabase) y autorización (roles) para toda la API.
 * Los dos guards se registran como globales, en este orden: primero se
 * autentica (JwtAuthGuard), después se chequea el rol (RolesGuard).
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    {
      provide: JWKS_RESOLVER,
      inject: [ConfigService],
      // jose cachea las claves y solo vuelve a pedir el JWKS si aparece un `kid` nuevo.
      useFactory: (config: ConfigService) =>
        createRemoteJWKSet(new URL(supabaseJwksUrl(config.getOrThrow<string>('SUPABASE_URL')))),
    },
    SupabaseJwtVerifier,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SupabaseJwtVerifier],
})
export class AuthModule {}
