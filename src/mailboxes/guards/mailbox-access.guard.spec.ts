import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import type { MailboxAccessService } from '../mailbox-access.service';
import type { MailboxPermission } from '../mailboxes.types';
import { MailboxAccessGuard } from './mailbox-access.guard';

const MBX = '11111111-1111-4111-8111-111111111111';
const user: AuthenticatedUser = { id: 'u1', email: 'u@example.org', role: 'user' };

function buildContext(params: Record<string, string | undefined>, reqUser?: AuthenticatedUser) {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ params, user: reqUser }) }),
  } as unknown as ExecutionContext;
}

function buildGuard(permission: MailboxPermission | undefined, allowed = true) {
  const reflector = { getAllAndOverride: () => permission } as unknown as Reflector;
  const access = { hasPermission: jest.fn().mockResolvedValue(allowed) };
  return {
    guard: new MailboxAccessGuard(reflector, access as unknown as MailboxAccessService),
    access,
  };
}

describe('MailboxAccessGuard', () => {
  it('deja pasar si el endpoint no pide permiso de casilla', async () => {
    const { guard, access } = buildGuard(undefined);
    await expect(guard.canActivate(buildContext({}, user))).resolves.toBe(true);
    expect(access.hasPermission).not.toHaveBeenCalled();
  });

  it('deja pasar con el permiso pedido', async () => {
    const { guard, access } = buildGuard('send', true);
    await expect(guard.canActivate(buildContext({ mailboxId: MBX }, user))).resolves.toBe(true);
    expect(access.hasPermission).toHaveBeenCalledWith('u1', MBX, 'send');
  });

  it('403 sin el permiso', async () => {
    const { guard } = buildGuard('read', false);
    await expect(guard.canActivate(buildContext({ mailboxId: MBX }, user))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 si no hay usuario en el request', async () => {
    const { guard } = buildGuard('read');
    await expect(guard.canActivate(buildContext({ mailboxId: MBX }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([[{}], [{ mailboxId: 'mbx_1' }]])(
    '400 si mailboxId falta o no es uuid (%p)',
    async (params) => {
      const { guard, access } = buildGuard('read');
      await expect(guard.canActivate(buildContext(params, user))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(access.hasPermission).not.toHaveBeenCalled();
    },
  );
});
