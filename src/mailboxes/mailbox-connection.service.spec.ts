import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { GoogleMailboxClient } from '../google/google-mailbox-client';
import type { GoogleOAuthClient } from '../google/google-oauth.client';
import { GOOGLE_SCOPES } from '../google/google.constants';
import { InvalidOAuthStateError, type OAuthStateService } from '../google/oauth-state.service';
import type { TokenCipher } from '../google/token-cipher';
import type { Mailbox } from './entities/mailbox.entity';
import { MailboxConnectionService } from './mailbox-connection.service';

const MBX = '11111111-1111-4111-8111-111111111111';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_URL = 'https://front.test/admin/mailboxes';

function mailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: MBX,
    email: 'casilla.prueba.tesoreria@gmail.com',
    displayName: 'Tesorería',
    authType: 'oauth',
    status: 'needs_reconnect',
    googleRefreshToken: null,
    googleScopes: null,
    connectedAt: null,
    connectedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MailboxConnectionService', () => {
  let found: Mailbox | null;
  /** Casillas con credenciales guardadas (lo que consulta isAccountInUse). */
  let connected: { id: string; email: string }[];
  let repo: {
    findOneBy: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let oauth: {
    buildAuthUrl: jest.Mock;
    exchangeCode: jest.Mock;
    getAccountEmail: jest.Mock;
    revokeToken: jest.Mock;
  };
  let state: { sign: jest.Mock; verify: jest.Mock };
  let cipher: { encrypt: jest.Mock; decrypt: jest.Mock };
  let googleClient: { invalidate: jest.Mock };
  let service: MailboxConnectionService;

  const goodTokens = {
    refreshToken: 'refresh-1',
    accessToken: 'access-1',
    scopes: [...GOOGLE_SCOPES],
  };

  beforeEach(() => {
    found = mailbox();
    connected = [];
    const qb = {
      addSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(() => Promise.resolve(found)),
      getMany: jest.fn(() => Promise.resolve(connected)),
    };
    repo = {
      findOneBy: jest.fn(() => Promise.resolve(found)),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(() => qb),
    };
    oauth = {
      buildAuthUrl: jest.fn(() => 'https://accounts.google.com/o/oauth2/auth?x'),
      exchangeCode: jest.fn().mockResolvedValue(goodTokens),
      getAccountEmail: jest.fn().mockResolvedValue('Casilla.Prueba.Tesoreria@gmail.com'),
      revokeToken: jest.fn().mockResolvedValue(undefined),
    };
    state = {
      sign: jest.fn().mockResolvedValue('signed-state'),
      verify: jest.fn().mockResolvedValue({ mailboxId: MBX, adminId: ADMIN }),
    };
    cipher = { encrypt: jest.fn(() => 'v1.cifrado'), decrypt: jest.fn(() => 'refresh-viejo') };
    googleClient = { invalidate: jest.fn() };
    service = new MailboxConnectionService(
      repo as unknown as Repository<Mailbox>,
      oauth as unknown as GoogleOAuthClient,
      state as unknown as OAuthStateService,
      cipher as unknown as TokenCipher,
      googleClient as unknown as GoogleMailboxClient,
      new ConfigService({ FRONTEND_URL: 'https://front.test/' }),
    );
  });

  describe('startConnection', () => {
    it('devuelve la URL de Google con el state firmado y la casilla preseleccionada', async () => {
      await expect(service.startConnection(MBX, ADMIN)).resolves.toEqual({
        authUrl: 'https://accounts.google.com/o/oauth2/auth?x',
      });
      expect(state.sign).toHaveBeenCalledWith({ mailboxId: MBX, adminId: ADMIN });
      expect(oauth.buildAuthUrl).toHaveBeenCalledWith({
        state: 'signed-state',
        loginHint: 'casilla.prueba.tesoreria@gmail.com',
      });
    });

    it('404 si la casilla no existe', async () => {
      found = null;
      await expect(service.startConnection(MBX, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 si la casilla es domain_wide', async () => {
      found = mailbox({ authType: 'domain_wide' });
      await expect(service.startConnection(MBX, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('handleCallback', () => {
    const query = { code: 'code-1', state: 'signed-state' };

    it('guarda el token encriptado, marca connected y redirige con connected=<id>', async () => {
      await expect(service.handleCallback(query)).resolves.toBe(`${ADMIN_URL}?connected=${MBX}`);

      expect(cipher.encrypt).toHaveBeenCalledWith('refresh-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: MBX },
        expect.objectContaining({
          googleRefreshToken: 'v1.cifrado',
          googleScopes: GOOGLE_SCOPES.join(' '),
          connectedBy: ADMIN,
          status: 'connected',
        }),
      );
      expect(googleClient.invalidate).toHaveBeenCalledWith(MBX);
      expect(oauth.revokeToken).not.toHaveBeenCalled();
    });

    it('la persona canceló en Google → connectionError=access_denied', async () => {
      await expect(service.handleCallback({ error: 'access_denied' })).resolves.toBe(
        `${ADMIN_URL}?connectionError=access_denied`,
      );
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it('si al cancelar viene un state válido, informa de qué casilla era', async () => {
      await expect(
        service.handleCallback({ error: 'access_denied', state: 'signed-state' }),
      ).resolves.toBe(`${ADMIN_URL}?connectionError=access_denied&mailboxId=${MBX}`);
      expect(state.verify).toHaveBeenCalledWith('signed-state');
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('si al cancelar el state no es válido, no incluye mailboxId', async () => {
      state.verify.mockRejectedValue(new InvalidOAuthStateError('invalid'));
      await expect(
        service.handleCallback({ error: 'access_denied', state: 'falso' }),
      ).resolves.toBe(`${ADMIN_URL}?connectionError=access_denied`);
    });

    it('otro error de Google → google_error (con mailboxId si el state es válido)', async () => {
      await expect(
        service.handleCallback({ error: 'server_error', state: 'signed-state' }),
      ).resolves.toBe(`${ADMIN_URL}?connectionError=google_error&mailboxId=${MBX}`);
    });

    it('sin code o state → invalid_request', async () => {
      await expect(service.handleCallback({ code: 'x' })).resolves.toBe(
        `${ADMIN_URL}?connectionError=invalid_request`,
      );
    });

    it('state inválido → invalid_state, sin canjear el code', async () => {
      state.verify.mockRejectedValue(new InvalidOAuthStateError('invalid'));
      await expect(service.handleCallback(query)).resolves.toBe(
        `${ADMIN_URL}?connectionError=invalid_state`,
      );
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it('state vencido → expired_state', async () => {
      state.verify.mockRejectedValue(new InvalidOAuthStateError('expired'));
      await expect(service.handleCallback(query)).resolves.toBe(
        `${ADMIN_URL}?connectionError=expired_state`,
      );
    });

    it('casilla borrada en el medio → mailbox_not_found', async () => {
      found = null;
      await expect(service.handleCallback(query)).resolves.toBe(
        `${ADMIN_URL}?connectionError=mailbox_not_found`,
      );
    });

    it('falla el canje del code → token_exchange_failed (con mailboxId)', async () => {
      oauth.exchangeCode.mockRejectedValue(new Error('invalid_grant'));
      await expect(service.handleCallback(query)).resolves.toBe(
        `${ADMIN_URL}?connectionError=token_exchange_failed&mailboxId=${MBX}`,
      );
    });

    it('Google no devolvió refresh_token → no_refresh_token', async () => {
      oauth.exchangeCode.mockResolvedValue({ ...goodTokens, refreshToken: null });
      await expect(service.handleCallback(query)).resolves.toContain('no_refresh_token');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('faltan permisos en una primera conexión → missing_scopes y se revoca', async () => {
      oauth.exchangeCode.mockResolvedValue({ ...goodTokens, scopes: [GOOGLE_SCOPES[0]] });
      await expect(service.handleCallback(query)).resolves.toContain(
        'connectionError=missing_scopes',
      );
      expect(oauth.revokeToken).toHaveBeenCalledWith('refresh-1');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('faltan permisos al RECONECTAR una casilla que ya tenía credenciales → no se revoca', async () => {
      connected = [{ id: MBX, email: 'casilla.prueba.tesoreria@gmail.com' }];
      oauth.exchangeCode.mockResolvedValue({ ...goodTokens, scopes: [GOOGLE_SCOPES[0]] });
      await expect(service.handleCallback(query)).resolves.toContain(
        'connectionError=missing_scopes',
      );
      expect(oauth.revokeToken).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('otra cuenta que no es de ninguna casilla → wrong_account y se revoca', async () => {
      oauth.getAccountEmail.mockResolvedValue('otra.persona@gmail.com');
      await expect(service.handleCallback(query)).resolves.toContain(
        'connectionError=wrong_account',
      );
      expect(oauth.revokeToken).toHaveBeenCalledWith('refresh-1');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('la cuenta equivocada es la de OTRA casilla conectada → wrong_account SIN revocar', async () => {
      // Caso real: conectar Secretaría con la cuenta de Tesorería. Revocar dejaría a
      // Tesorería sin credenciales (Google revoca el permiso de toda la cuenta).
      connected = [{ id: 'otra', email: 'casillapruebasecretaria@gmail.com' }];
      oauth.getAccountEmail.mockResolvedValue('casilla.prueba.secretaria@gmail.com');
      await expect(service.handleCallback(query)).resolves.toContain(
        'connectionError=wrong_account',
      );
      expect(oauth.revokeToken).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('no se pudo leer el email de la cuenta → profile_failed SIN revocar (cuenta desconocida)', async () => {
      oauth.getAccountEmail.mockRejectedValue(new Error('403'));
      await expect(service.handleCallback(query)).resolves.toContain(
        'connectionError=profile_failed',
      );
      expect(oauth.revokeToken).not.toHaveBeenCalled();
    });

    it('si faltan permisos y además no se puede leer la cuenta → missing_scopes sin revocar', async () => {
      oauth.exchangeCode.mockResolvedValue({ ...goodTokens, scopes: [GOOGLE_SCOPES[1]] });
      oauth.getAccountEmail.mockRejectedValue(new Error('403'));
      await expect(service.handleCallback(query)).resolves.toContain(
        'connectionError=missing_scopes',
      );
      expect(oauth.revokeToken).not.toHaveBeenCalled();
    });

    it('un error inesperado igual termina en redirección (unexpected)', async () => {
      repo.update.mockRejectedValue(new Error('db caída'));
      await expect(service.handleCallback(query)).resolves.toBe(
        `${ADMIN_URL}?connectionError=unexpected`,
      );
    });
  });

  describe('disconnect', () => {
    it('revoca el token en Google, borra la casilla y descarta el cliente', async () => {
      found = mailbox({ status: 'connected', googleRefreshToken: 'v1.guardado' });
      await service.disconnect(MBX);
      expect(cipher.decrypt).toHaveBeenCalledWith('v1.guardado');
      expect(oauth.revokeToken).toHaveBeenCalledWith('refresh-viejo');
      expect(repo.delete).toHaveBeenCalledWith({ id: MBX });
      expect(googleClient.invalidate).toHaveBeenCalledWith(MBX);
    });

    it('si Google no responde al revocar, igual borra', async () => {
      found = mailbox({ googleRefreshToken: 'v1.guardado' });
      oauth.revokeToken.mockRejectedValue(new Error('timeout'));
      await service.disconnect(MBX);
      expect(repo.delete).toHaveBeenCalledWith({ id: MBX });
    });

    it('sin token no llama a Google', async () => {
      await service.disconnect(MBX);
      expect(oauth.revokeToken).not.toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalled();
    });

    it('404 si no existe', async () => {
      found = null;
      await expect(service.disconnect(MBX)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
