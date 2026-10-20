import request from 'supertest';
import { ContactsController } from '../src/contacts/contacts.controller';
import { ContactsService } from '../src/contacts/contacts.service';
import { MailboxAccessGuard } from '../src/mailboxes/guards/mailbox-access.guard';
import { MailboxAccessService } from '../src/mailboxes/mailbox-access.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';

/** USER_ID: lee y envía en MBX. ADMIN_ID: solo lee (sin canSend no ve contactos). */
const permissions: Record<string, Record<string, { read: boolean; send: boolean }>> = {
  [USER_ID]: { [MBX]: { read: true, send: true } },
  [ADMIN_ID]: { [MBX]: { read: true, send: false } },
};

describe('Contacts (e2e)', () => {
  let t: TestApp;
  const contacts = {
    listGroups: jest.fn(),
    listGroupMembers: jest.fn(),
    searchContacts: jest.fn(),
  };
  const access = {
    hasPermission: jest.fn((userId: string, mailboxId: string, p: 'read' | 'send') =>
      Promise.resolve(permissions[userId]?.[mailboxId]?.[p] ?? false),
    ),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [ContactsController],
      providers: [
        { provide: ContactsService, useValue: contacts },
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
    contacts.listGroups.mockResolvedValue([{ id: 'g1', name: 'Donantes', memberCount: 2 }]);
    contacts.listGroupMembers.mockResolvedValue([]);
    contacts.searchContacts.mockResolvedValue([]);
  });

  const http = () => request(t.app.getHttpServer());
  const asUser = () => t.authHeader(USER_ID);

  it('con canSend: grupos, miembros y contactos', async () => {
    const auth = await asUser();
    await http()
      .get(`/mailboxes/${MBX}/contact-groups`)
      .set('Authorization', auth)
      .expect(200, [{ id: 'g1', name: 'Donantes', memberCount: 2 }]);
    await http()
      .get(`/mailboxes/${MBX}/contact-groups/g1/members`)
      .set('Authorization', auth)
      .expect(200);
    expect(contacts.listGroupMembers).toHaveBeenCalledWith(MBX, 'g1');
    await http().get(`/mailboxes/${MBX}/contacts`).set('Authorization', auth).expect(200);
    expect(contacts.searchContacts).toHaveBeenLastCalledWith(MBX, undefined);
    await http().get(`/mailboxes/${MBX}/contacts?q=ana`).set('Authorization', auth).expect(200);
    expect(contacts.searchContacts).toHaveBeenLastCalledWith(MBX, 'ana');
  });

  it('con solo canRead → 403', async () => {
    const auth = await t.authHeader(ADMIN_ID);
    await http().get(`/mailboxes/${MBX}/contact-groups`).set('Authorization', auth).expect(403);
    await http().get(`/mailboxes/${MBX}/contacts`).set('Authorization', auth).expect(403);
    expect(contacts.listGroups).not.toHaveBeenCalled();
  });

  it('401 sin token', async () => {
    await http().get(`/mailboxes/${MBX}/contacts`).expect(401);
  });

  it('400 con groupId inválido o q demasiado largo', async () => {
    const auth = await asUser();
    await http()
      .get(`/mailboxes/${MBX}/contact-groups/a.b/members`)
      .set('Authorization', auth)
      .expect(400);
    await http()
      .get(`/mailboxes/${MBX}/contacts?q=${'x'.repeat(101)}`)
      .set('Authorization', auth)
      .expect(400);
    expect(contacts.listGroupMembers).not.toHaveBeenCalled();
    expect(contacts.searchContacts).not.toHaveBeenCalled();
  });
});
