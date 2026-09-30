import type { INestApplication, Provider, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { configureApp } from '../../src/app.setup';
import { JWKS_RESOLVER } from '../../src/auth/auth.constants';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { SupabaseJwtVerifier } from '../../src/auth/supabase-jwt.verifier';
import type { UserProfile } from '../../src/users/entities/user-profile.entity';
import { UsersService } from '../../src/users/users.service';
import { createTestKeys, signTestToken, TEST_AUDIENCE, TEST_SUPABASE_URL } from './jwt';

export const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function buildProfile(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    name: 'Test',
    role: 'user',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface TestApp {
  app: INestApplication;
  /** Devuelve un header `Authorization` válido para el usuario pedido. */
  authHeader: (userId: string) => Promise<string>;
}

/**
 * Levanta una app Nest de prueba con la autenticación real (guards globales,
 * verificación ES256) pero con Supabase y la DB simulados:
 * - JWKS: claves ES256 generadas para el test.
 * - Perfiles: un admin (ADMIN_ID) y un user (USER_ID), activos.
 * Los controllers y providers del módulo bajo prueba se pasan por parámetro.
 */
export async function createTestApp(options: {
  controllers: Type<unknown>[];
  providers?: Provider[];
}): Promise<TestApp> {
  const keys = await createTestKeys();
  const profiles = new Map<string, UserProfile>([
    [ADMIN_ID, buildProfile(ADMIN_ID, { role: 'admin' })],
    [USER_ID, buildProfile(USER_ID)],
  ]);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [() => ({ SUPABASE_URL: TEST_SUPABASE_URL, SUPABASE_JWT_AUDIENCE: TEST_AUDIENCE })],
      }),
    ],
    controllers: options.controllers,
    providers: [
      { provide: JWKS_RESOLVER, useValue: keys.jwks },
      SupabaseJwtVerifier,
      {
        provide: UsersService,
        useValue: { findProfileById: (id: string) => Promise.resolve(profiles.get(id) ?? null) },
      },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      ...(options.providers ?? []),
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    authHeader: async (userId: string) =>
      `Bearer ${await signTestToken(keys.privateKey, { sub: userId })}`,
  };
}
