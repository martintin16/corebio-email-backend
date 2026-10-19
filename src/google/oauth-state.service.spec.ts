import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { InvalidOAuthStateError, OAuthStateService } from './oauth-state.service';

const SECRET = 's'.repeat(32);
const service = new OAuthStateService(new ConfigService({ OAUTH_STATE_SECRET: SECRET }));

describe('OAuthStateService', () => {
  it('firma y verifica casilla + admin', async () => {
    const state = await service.sign({ mailboxId: 'm1', adminId: 'a1' });
    await expect(service.verify(state)).resolves.toEqual({ mailboxId: 'm1', adminId: 'a1' });
  });

  it('rechaza un state firmado con otro secreto', async () => {
    const other = new OAuthStateService(new ConfigService({ OAUTH_STATE_SECRET: 'o'.repeat(32) }));
    const state = await other.sign({ mailboxId: 'm1', adminId: 'a1' });
    await expect(service.verify(state)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('distingue un state vencido', async () => {
    const expired = await new SignJWT({ mbx: 'm1', adm: 'a1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('mailbox-oauth')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(service.verify(expired)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('rechaza un JWT válido pero de otro uso (audience)', async () => {
    const token = await new SignJWT({ mbx: 'm1', adm: 'a1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('otra-cosa')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(service.verify(token)).rejects.toBeInstanceOf(InvalidOAuthStateError);
  });

  it('rechaza basura', async () => {
    await expect(service.verify('no-es-un-jwt')).rejects.toBeInstanceOf(InvalidOAuthStateError);
  });
});
