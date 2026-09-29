import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { JWKS_RESOLVER } from '../src/auth/auth.constants';
import { Public } from '../src/auth/decorators/public.decorator';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { SupabaseJwtVerifier } from '../src/auth/supabase-jwt.verifier';
import type { UserProfile } from '../src/users/entities/user-profile.entity';
import { UsersService } from '../src/users/users.service';
import {
  createTestKeys,
  signTestToken,
  TEST_AUDIENCE,
  TEST_SUPABASE_URL,
  type TestKeys,
} from './utils/jwt';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INACTIVE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NO_PROFILE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Endpoints de prueba para ejercitar los guards de punta a punta. */
@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  publicEndpoint() {
    return { ok: true };
  }

  @Roles('admin')
  @Get('admin')
  adminEndpoint() {
    return { ok: true };
  }
}

function profile(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
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

const profiles = new Map<string, UserProfile>([
  [ADMIN_ID, profile(ADMIN_ID, { role: 'admin' })],
  [USER_ID, profile(USER_ID)],
  [INACTIVE_ID, profile(INACTIVE_ID, { status: 'inactive' })],
]);

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let keys: TestKeys;

  const tokenFor = (sub: string) =>
    signTestToken(keys.privateKey, { sub, email: `${sub.slice(0, 4)}@example.org` });

  beforeAll(async () => {
    keys = await createTestKeys();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ SUPABASE_URL: TEST_SUPABASE_URL, SUPABASE_JWT_AUDIENCE: TEST_AUDIENCE })],
        }),
      ],
      controllers: [AuthController, ProbeController],
      providers: [
        { provide: JWKS_RESOLVER, useValue: keys.jwks },
        SupabaseJwtVerifier,
        {
          provide: UsersService,
          useValue: { findProfileById: (id: string) => Promise.resolve(profiles.get(id) ?? null) },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('endpoint público responde sin token', async () => {
    await request(app.getHttpServer()).get('/probe/public').expect(200, { ok: true });
  });

  it('GET /me sin token → 401', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('GET /me con token inválido → 401', async () => {
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer no-es-un-jwt')
      .expect(401);
  });

  it('GET /me con token válido devuelve el usuario con el rol de la DB', async () => {
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${await tokenFor(ADMIN_ID)}`)
      .expect(200);
    expect(res.body).toEqual({ id: ADMIN_ID, email: 'aaaa@example.org', role: 'admin' });
  });

  it('usuario sin perfil → 403', async () => {
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${await tokenFor(NO_PROFILE_ID)}`)
      .expect(403);
  });

  it('usuario desactivado → 403 aunque el token sea válido', async () => {
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${await tokenFor(INACTIVE_ID)}`)
      .expect(403);
  });

  it('endpoint de admin con rol user → 403', async () => {
    await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${await tokenFor(USER_ID)}`)
      .expect(403);
  });

  it('endpoint de admin con rol admin → 200', async () => {
    await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${await tokenFor(ADMIN_ID)}`)
      .expect(200, { ok: true });
  });
});
