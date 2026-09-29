import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth.constants';
import type { AuthenticatedUser } from '../types/authenticated-user';
import { RolesGuard } from './roles.guard';

function buildContext(user?: AuthenticatedUser): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function buildReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

const admin: AuthenticatedUser = { id: 'a', email: 'admin@example.org', role: 'admin' };
const user: AuthenticatedUser = { id: 'u', email: 'user@example.org', role: 'user' };

describe('RolesGuard', () => {
  it('deja pasar si el endpoint no pide roles', () => {
    const guard = new RolesGuard(buildReflector({}));
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('deja pasar endpoints públicos aunque pidan roles', () => {
    const guard = new RolesGuard(buildReflector({ [IS_PUBLIC_KEY]: true, [ROLES_KEY]: ['admin'] }));
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('deja pasar a un admin en un endpoint de admin', () => {
    const guard = new RolesGuard(buildReflector({ [ROLES_KEY]: ['admin'] }));
    expect(guard.canActivate(buildContext(admin))).toBe(true);
  });

  it('responde 403 a un user en un endpoint de admin', () => {
    const guard = new RolesGuard(buildReflector({ [ROLES_KEY]: ['admin'] }));
    expect(() => guard.canActivate(buildContext(user))).toThrow(ForbiddenException);
  });

  it('responde 403 si no hay usuario en el request', () => {
    const guard = new RolesGuard(buildReflector({ [ROLES_KEY]: ['admin'] }));
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });
});
