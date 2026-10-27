import request from 'supertest';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import { SyncStateController } from '../src/sync/sync-state.controller';
import { SyncStateService } from '../src/sync/sync-state.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

/** USER_ID: solo lee MBX (alcanza: es parte de leer). ADMIN_ID: nada (admin no tiene acceso implícito). */
const permissions: Record<string, Record<string, { read: boolean; send: boolean }>> = {
  [USER_ID]: { [MBX]: { read: true, send: false } },
};

describe('Sync state (e2e)', () => {
  let t: TestApp;
  const sync = { getState: jest.fn() };
  const access = {
    hasPermission: jest.fn((userId: string, mailboxId: string, p: 'read' | 'send') =>
      Promise.resolve(permissions[userId]?.[mailboxId]?.[p] ?? false),
    ),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [SyncStateController],
      providers: [
        { provide: SyncStateService, useValue: sync },
        { provide: MailboxAccessService, useValue: access },
        MailboxAccessGuard,
      ],
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sync.getState.mockResolvedValue({ historyId: '123', scheduledVersion: '1:1700000000000' });
  });

  const http = () => request(t.app.getHttpServer());

  it('con canRead devuelve el estado', async () => {
    await http()
      .get(`/mailboxes/${MBX}/sync-state`)
      .set('Authorization', await t.authHeader(USER_ID))
      .expect(200, { historyId: '123', scheduledVersion: '1:1700000000000' });
    expect(sync.getState).toHaveBeenCalledWith(MBX);
  });

  it('sin acceso a la casilla → 403 (también un admin)', async () => {
    await http()
      .get(`/mailboxes/${OTHER}/sync-state`)
      .set('Authorization', await t.authHeader(USER_ID))
      .expect(403);
    await http()
      .get(`/mailboxes/${MBX}/sync-state`)
      .set('Authorization', await t.authHeader(ADMIN_ID))
      .expect(403);
    expect(sync.getState).not.toHaveBeenCalled();
  });

  it('mailboxId que no es uuid → 400; sin token → 401', async () => {
    await http()
      .get('/mailboxes/mbx_1/sync-state')
      .set('Authorization', await t.authHeader(USER_ID))
      .expect(400);
    await http().get(`/mailboxes/${MBX}/sync-state`).expect(401);
  });
});
