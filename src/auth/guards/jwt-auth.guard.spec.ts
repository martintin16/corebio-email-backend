import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UsersService } from '../../users/users.service';
import type { UserProfile } from '../../users/entities/user-profile.entity';
import type { SupabaseJwtVerifier } from '../supabase-jwt.verifier';
import type { AuthenticatedRequest } from '../types/authenticated-user';
import { extractBearerToken, JwtAuthGuard } from './jwt-auth.guard';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: USER_ID,
    name: 'Ana',
    role: 'user',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('extractBearerToken', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['Bearer', null],
    ['Basic abc', null],
    ['Bearer abc def', null],
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['  Bearer   abc  ', 'abc'],
  ])('%p → %p', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });
});

describe('JwtAuthGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let verifier: { verify: jest.Mock };
  let users: { findProfileById: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    verifier = {
      verify: jest.fn().mockResolvedValue({ sub: USER_ID, email: 'ana@example.org' }),
    };
    users = { findProfileById: jest.fn().mockResolvedValue(buildProfile()) };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      verifier as unknown as SupabaseJwtVerifier,
      users as unknown as UsersService,
    );
  });

  it('deja pasar endpoints @Public() sin token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(buildContext({ headers: {} }))).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('responde 401 si no hay header Authorization', async () => {
    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 401 si el header no es Bearer', async () => {
    const ctx = buildContext({ headers: { authorization: 'Basic abc' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propaga el 401 del verificador si el token es inválido', async () => {
    verifier.verify.mockRejectedValue(new UnauthorizedException());
    const ctx = buildContext({ headers: { authorization: 'Bearer malo' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findProfileById).not.toHaveBeenCalled();
  });

  it('responde 403 si el usuario no tiene perfil', async () => {
    users.findProfileById.mockResolvedValue(null);
    const ctx = buildContext({ headers: { authorization: 'Bearer ok' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('responde 403 si el usuario está desactivado', async () => {
    users.findProfileById.mockResolvedValue(buildProfile({ status: 'inactive' }));
    const ctx = buildContext({ headers: { authorization: 'Bearer ok' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deja pasar a un usuario invitado (ya tiene sesión válida)', async () => {
    users.findProfileById.mockResolvedValue(buildProfile({ status: 'invited' }));
    const ctx = buildContext({ headers: { authorization: 'Bearer ok' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('carga request.user con el rol de la DB, no del token', async () => {
    users.findProfileById.mockResolvedValue(buildProfile({ role: 'admin' }));
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer ok' } };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);

    expect(verifier.verify).toHaveBeenCalledWith('ok');
    expect(users.findProfileById).toHaveBeenCalledWith(USER_ID);
    expect(request.user).toEqual({ id: USER_ID, email: 'ana@example.org', role: 'admin' });
  });
});
