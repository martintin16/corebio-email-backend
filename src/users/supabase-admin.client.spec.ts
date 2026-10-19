import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailAlreadyRegisteredError, SupabaseJsAdminClient } from './supabase-admin.client';

const mockSupabase = {
  auth: {
    admin: {
      inviteUserByEmail: jest.fn(),
      updateUserById: jest.fn(),
      deleteUser: jest.fn(),
    },
    resetPasswordForEmail: jest.fn(),
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

const ok = (data: unknown = {}) => Promise.resolve({ data, error: null });
const fail = (error: { code?: string; status?: number; message: string }) =>
  Promise.resolve({ data: null, error });

describe('SupabaseJsAdminClient', () => {
  let client: SupabaseJsAdminClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SupabaseJsAdminClient(
      new ConfigService({
        SUPABASE_URL: 'https://ref.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
      }),
    );
    client.onModuleInit();
  });

  describe('inviteUser', () => {
    it('devuelve el id del usuario creado', async () => {
      mockSupabase.auth.admin.inviteUserByEmail.mockReturnValue(ok({ user: { id: 'u1' } }));
      await expect(
        client.inviteUser('a@b.org', { name: 'Ana', redirectTo: 'https://f/reset-password' }),
      ).resolves.toBe('u1');
      expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('a@b.org', {
        data: { name: 'Ana' },
        redirectTo: 'https://f/reset-password',
      });
    });

    it('traduce "email ya registrado" a EmailAlreadyRegisteredError', async () => {
      mockSupabase.auth.admin.inviteUserByEmail.mockReturnValue(
        fail({ code: 'email_exists', status: 422, message: 'exists' }),
      );
      await expect(
        client.inviteUser('a@b.org', { name: 'Ana', redirectTo: 'x' }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    });

    it('cualquier otro error → 502', async () => {
      mockSupabase.auth.admin.inviteUserByEmail.mockReturnValue(
        fail({ status: 500, message: 'boom' }),
      );
      await expect(
        client.inviteUser('a@b.org', { name: 'Ana', redirectTo: 'x' }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('resendInvite', () => {
    it('reenvía la invitación si Supabase lo permite', async () => {
      mockSupabase.auth.admin.inviteUserByEmail.mockReturnValue(ok({ user: { id: 'u1' } }));
      await expect(client.resendInvite('a@b.org', 'r')).resolves.toBe('invite');
      expect(mockSupabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('si Supabase rechaza el reenvío, manda el email de recovery', async () => {
      mockSupabase.auth.admin.inviteUserByEmail.mockReturnValue(
        fail({
          status: 422,
          message: 'A user with this email address has already been registered',
        }),
      );
      mockSupabase.auth.resetPasswordForEmail.mockReturnValue(ok());
      await expect(client.resendInvite('a@b.org', 'r')).resolves.toBe('recovery');
      expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.org', {
        redirectTo: 'r',
      });
    });
  });

  it('setAppRole escribe app_metadata.role', async () => {
    mockSupabase.auth.admin.updateUserById.mockReturnValue(ok());
    await client.setAppRole('u1', 'admin');
    expect(mockSupabase.auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: { role: 'admin' },
    });
  });

  it('banUser aplica un ban de larga duración', async () => {
    mockSupabase.auth.admin.updateUserById.mockReturnValue(ok());
    await client.banUser('u1');
    expect(mockSupabase.auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      ban_duration: '876000h',
    });
  });

  describe('deleteUser', () => {
    it('ignora "usuario no encontrado" (ya estaba borrado)', async () => {
      mockSupabase.auth.admin.deleteUser.mockReturnValue(
        fail({ code: 'user_not_found', status: 404, message: 'not found' }),
      );
      await expect(client.deleteUser('u1')).resolves.toBeUndefined();
    });

    it('otros errores → 502', async () => {
      mockSupabase.auth.admin.deleteUser.mockReturnValue(fail({ status: 500, message: 'boom' }));
      await expect(client.deleteUser('u1')).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
