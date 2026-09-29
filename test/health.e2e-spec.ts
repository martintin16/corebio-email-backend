import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { SupabaseJwtVerifier } from '../src/auth/supabase-jwt.verifier';
import { HealthController } from '../src/health/health.controller';
import { UsersService } from '../src/users/users.service';

/**
 * El ping real a Postgres se reemplaza por un doble: acá se prueba el endpoint
 * (público, 200/503), no la conexión a Supabase (esa se prueba en local/Railway).
 */
describe('Health (e2e)', () => {
  let app: INestApplication;
  const pingCheck = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        // El guard global real: /health tiene que pasar sin token por ser @Public().
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: SupabaseJwtVerifier, useValue: { verify: jest.fn() } },
        { provide: UsersService, useValue: { findProfileById: jest.fn() } },
      ],
    })
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue({ pingCheck })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 sin token cuando la DB está arriba', async () => {
    pingCheck.mockResolvedValue({ database: { status: 'up' } });
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('responde 503 cuando la DB no responde', async () => {
    pingCheck.mockRejectedValue(new ServiceUnavailableException({ database: { status: 'down' } }));
    await request(app.getHttpServer()).get('/health').expect(503);
  });
});
