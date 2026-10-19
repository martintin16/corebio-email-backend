import { BadGatewayException, NotFoundException, NotImplementedException } from '@nestjs/common';
import type { Auth } from 'googleapis';
import type { Repository } from 'typeorm';
import type { Mailbox } from '../mailboxes/entities/mailbox.entity';
import {
  DefaultGoogleMailboxClient,
  isInvalidGrant,
  MailboxNeedsReconnectException,
} from './google-mailbox-client';
import type { GoogleOAuthClient } from './google-oauth.client';
import { TokenDecryptionError, type TokenCipher } from './token-cipher';

const ID = '11111111-1111-4111-8111-111111111111';

function mailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: ID,
    email: 'casilla@gmail.com',
    displayName: 'Casilla',
    authType: 'oauth',
    status: 'connected',
    googleRefreshToken: 'v1.enc',
    googleScopes: null,
    connectedAt: null,
    connectedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('isInvalidGrant', () => {
  it.each([
    [{ response: { data: { error: 'invalid_grant' } } }, true],
    [new Error('invalid_grant: Token has been expired or revoked.'), true],
    [new Error('ECONNRESET'), false],
    ['x', false],
  ])('%p → %p', (err, expected) => {
    expect(isInvalidGrant(err)).toBe(expected);
  });
});

describe('DefaultGoogleMailboxClient', () => {
  let found: Mailbox | null;
  let repo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let authClient: { getAccessToken: jest.Mock };
  let oauth: { createAuthorizedClient: jest.Mock };
  let cipher: { decrypt: jest.Mock };
  let client: DefaultGoogleMailboxClient;

  beforeEach(() => {
    found = mailbox();
    const qb = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(() => Promise.resolve(found)),
    };
    repo = { createQueryBuilder: jest.fn(() => qb), update: jest.fn() };
    authClient = { getAccessToken: jest.fn().mockResolvedValue({ token: 'at' }) };
    oauth = { createAuthorizedClient: jest.fn(() => authClient as unknown as Auth.OAuth2Client) };
    cipher = { decrypt: jest.fn(() => 'refresh') };
    client = new DefaultGoogleMailboxClient(
      repo as unknown as Repository<Mailbox>,
      oauth as unknown as GoogleOAuthClient,
      cipher as unknown as TokenCipher,
    );
  });

  it('404 si la casilla no existe', async () => {
    found = null;
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 needs_reconnect si la casilla no está conectada', async () => {
    found = mailbox({ status: 'needs_reconnect' });
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(MailboxNeedsReconnectException);
  });

  it('409 needs_reconnect si está "connected" pero sin token', async () => {
    found = mailbox({ googleRefreshToken: null });
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(MailboxNeedsReconnectException);
  });

  it('domain_wide todavía no está implementado → 501', async () => {
    found = mailbox({ authType: 'domain_wide' });
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('devuelve Gmail y Drive autenticados con el refresh_token desencriptado', async () => {
    const apis = await client.forMailbox(ID);
    expect(cipher.decrypt).toHaveBeenCalledWith('v1.enc');
    expect(oauth.createAuthorizedClient).toHaveBeenCalledWith('refresh');
    expect(apis.email).toBe('casilla@gmail.com');
    expect(apis.gmail).toBeDefined();
    expect(apis.drive).toBeDefined();
  });

  it('reutiliza el cliente entre pedidos y lo descarta con invalidate()', async () => {
    await client.forMailbox(ID);
    await client.forMailbox(ID);
    expect(oauth.createAuthorizedClient).toHaveBeenCalledTimes(1);

    client.invalidate(ID);
    await client.forMailbox(ID);
    expect(oauth.createAuthorizedClient).toHaveBeenCalledTimes(2);
  });

  it('si Google rechaza el token (invalid_grant), marca needs_reconnect → 409', async () => {
    authClient.getAccessToken.mockRejectedValue(new Error('invalid_grant'));
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(MailboxNeedsReconnectException);
    expect(repo.update).toHaveBeenCalledWith({ id: ID }, { status: 'needs_reconnect' });
  });

  it('si el token no se puede desencriptar, marca needs_reconnect → 409', async () => {
    cipher.decrypt.mockImplementation(() => {
      throw new TokenDecryptionError();
    });
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(MailboxNeedsReconnectException);
    expect(repo.update).toHaveBeenCalledWith({ id: ID }, { status: 'needs_reconnect' });
  });

  it('otros errores de Google → 502, sin tocar el estado', async () => {
    authClient.getAccessToken.mockRejectedValue(new Error('ECONNRESET'));
    await expect(client.forMailbox(ID)).rejects.toBeInstanceOf(BadGatewayException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
