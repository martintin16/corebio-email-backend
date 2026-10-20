import { BadGatewayException, NotFoundException } from '@nestjs/common';
import type { GoogleMailboxClient } from '../google/google-mailbox-client';
import { CONTACTS_SCOPE, OTHER_CONTACTS_SCOPE } from '../google/google.constants';
import {
  ContactsService,
  GoogleRateLimitedException,
  MailboxMissingScopeException,
  SEARCH_LIMIT,
  toContact,
  toContacts,
} from './contacts.service';

const MBX = '11111111-1111-4111-8111-111111111111';

const person = (id: string, name: string, ...emails: string[]) => ({
  resourceName: `people/${id}`,
  names: [{ displayName: name }],
  emailAddresses: emails.map((value, i) => ({ value, metadata: { primary: i === 0 } })),
});

describe('toContact / toContacts', () => {
  it('usa el email principal y el nombre; sin nombre, el email', () => {
    expect(
      toContact({
        resourceName: 'people/c1',
        names: [{ displayName: 'Ana' }],
        emailAddresses: [
          { value: 'otro@x.com' },
          { value: 'ana@x.com', metadata: { primary: true } },
        ],
      }),
    ).toEqual({ id: 'c1', name: 'Ana', email: 'ana@x.com' });
    expect(
      toContact({ resourceName: 'otherContacts/c9', emailAddresses: [{ value: 'b@y.com' }] }),
    ).toEqual({
      id: 'o_c9',
      name: 'b@y.com',
      email: 'b@y.com',
    });
  });

  it('sin email no va; sin repetidos por email; ordenados por nombre', () => {
    expect(
      toContacts([
        person('c2', 'Zoe', 'zoe@x.com'),
        { resourceName: 'people/c3', names: [{ displayName: 'Sin mail' }] },
        person('c4', 'álvaro', 'alvaro@x.com'),
        person('c5', 'Zoe duplicada', 'ZOE@x.com'),
      ]),
    ).toEqual([
      { id: 'c4', name: 'álvaro', email: 'alvaro@x.com' },
      { id: 'c2', name: 'Zoe', email: 'zoe@x.com' },
    ]);
  });
});

describe('ContactsService', () => {
  let scopes: string[];
  let people: {
    contactGroups: { list: jest.Mock; get: jest.Mock };
    people: { getBatchGet: jest.Mock; connections: { list: jest.Mock }; searchContacts: jest.Mock };
    otherContacts: { search: jest.Mock };
  };
  let google: { forMailbox: jest.Mock; handleGoogleError: jest.Mock };
  let service: ContactsService;

  beforeEach(() => {
    scopes = [CONTACTS_SCOPE, OTHER_CONTACTS_SCOPE];
    people = {
      contactGroups: {
        list: jest.fn().mockResolvedValue({
          data: {
            contactGroups: [
              {
                resourceName: 'contactGroups/starred',
                groupType: 'SYSTEM_CONTACT_GROUP',
                name: 'starred',
              },
              {
                resourceName: 'contactGroups/g2',
                groupType: 'USER_CONTACT_GROUP',
                name: 'Voluntarios',
                memberCount: 3,
              },
              {
                resourceName: 'contactGroups/g1',
                groupType: 'USER_CONTACT_GROUP',
                name: 'Donantes',
                memberCount: 2,
              },
            ],
          },
        }),
        get: jest.fn().mockResolvedValue({
          data: {
            groupType: 'USER_CONTACT_GROUP',
            memberResourceNames: ['people/c1', 'people/c2'],
          },
        }),
      },
      people: {
        getBatchGet: jest.fn().mockResolvedValue({
          data: {
            responses: [
              { person: person('c1', 'Ana', 'ana@x.com') },
              { person: { resourceName: 'people/c2', names: [{ displayName: 'Sin mail' }] } },
            ],
          },
        }),
        connections: {
          list: jest.fn().mockResolvedValue({
            data: {
              connections: [person('c1', 'Ana', 'ana@x.com'), person('c3', 'Beto', 'beto@y.com')],
            },
          }),
        },
        searchContacts: jest.fn().mockResolvedValue({
          data: { results: [{ person: person('c1', 'Ana', 'ana@x.com') }] },
        }),
      },
      otherContacts: {
        search: jest.fn().mockResolvedValue({
          data: {
            results: [
              {
                person: {
                  resourceName: 'otherContacts/o1',
                  emailAddresses: [{ value: 'ANA@x.com' }],
                },
              },
              {
                person: {
                  resourceName: 'otherContacts/o2',
                  emailAddresses: [{ value: 'ani@z.com' }],
                },
              },
            ],
          },
        }),
      },
    };
    google = {
      forMailbox: jest.fn((mailboxId: string) => Promise.resolve({ mailboxId, scopes, people })),
      handleGoogleError: jest.fn(() => Promise.reject(new BadGatewayException())),
    };
    service = new ContactsService(google as unknown as GoogleMailboxClient);
  });

  it('grupos: solo los del usuario, por nombre, con el id corto', async () => {
    expect(await service.listGroups(MBX)).toEqual([
      { id: 'g1', name: 'Donantes', memberCount: 2 },
      { id: 'g2', name: 'Voluntarios', memberCount: 3 },
    ]);
  });

  it('grupos y miembros quedan en caché (no se le vuelve a pedir a Google)', async () => {
    await service.listGroups(MBX);
    await service.listGroups(MBX);
    expect(people.contactGroups.list).toHaveBeenCalledTimes(1);
  });

  it('miembros: con email, en tandas de getBatchGet', async () => {
    expect(await service.listGroupMembers(MBX, 'g1')).toEqual([
      { id: 'c1', name: 'Ana', email: 'ana@x.com' },
    ]);
    expect(people.contactGroups.get).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: 'contactGroups/g1' }),
    );
    expect(people.people.getBatchGet).toHaveBeenCalledWith({
      resourceNames: ['people/c1', 'people/c2'],
      personFields: 'names,emailAddresses',
    });
  });

  it('miembros de un grupo inexistente o de sistema → 404', async () => {
    people.contactGroups.get.mockRejectedValueOnce({ status: 404 });
    await expect(service.listGroupMembers(MBX, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    people.contactGroups.get.mockResolvedValueOnce({ data: { groupType: 'SYSTEM_CONTACT_GROUP' } });
    await expect(service.listGroupMembers(MBX, 'starred')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sin q: todos los de "Mis contactos"', async () => {
    expect(await service.searchContacts(MBX)).toEqual([
      { id: 'c1', name: 'Ana', email: 'ana@x.com' },
      { id: 'c3', name: 'Beto', email: 'beto@y.com' },
    ]);
    expect(people.people.searchContacts).not.toHaveBeenCalled();
  });

  it('con q: Mis contactos + Otros contactos sin repetidos; despierta la búsqueda una vez', async () => {
    const result = await service.searchContacts(MBX, ' an ');
    expect(result).toEqual([
      { id: 'c1', name: 'Ana', email: 'ana@x.com' },
      { id: 'o_o2', name: 'ani@z.com', email: 'ani@z.com' },
    ]);
    expect(people.people.searchContacts).toHaveBeenNthCalledWith(1, {
      query: '',
      readMask: 'names,emailAddresses',
    });
    expect(people.people.searchContacts).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'an' }),
    );
    await service.searchContacts(MBX, 'be');
    // 1 de calentamiento + 2 búsquedas.
    expect(people.people.searchContacts).toHaveBeenCalledTimes(3);
  });

  it(`con q devuelve hasta ${SEARCH_LIMIT}`, async () => {
    people.people.searchContacts.mockResolvedValue({
      data: {
        results: Array.from({ length: 30 }, (_, i) => ({
          person: person(`c${i}`, `P${String(i).padStart(2, '0')}`, `p${i}@x.com`),
        })),
      },
    });
    expect(await service.searchContacts(MBX, 'p')).toHaveLength(SEARCH_LIMIT);
  });

  it('sin el permiso de "Otros contactos" busca solo en Mis contactos', async () => {
    scopes = [CONTACTS_SCOPE];
    await service.searchContacts(MBX, 'an');
    expect(people.otherContacts.search).not.toHaveBeenCalled();
  });

  it('casilla conectada sin permiso de Contactos → 409 mailbox_missing_scope', async () => {
    scopes = [];
    await expect(service.listGroups(MBX)).rejects.toBeInstanceOf(MailboxMissingScopeException);
    expect(people.contactGroups.list).not.toHaveBeenCalled();
  });

  it('Google dice que falta el permiso (403 insufficient) → 409 mailbox_missing_scope', async () => {
    people.contactGroups.list.mockRejectedValue(
      Object.assign(new Error('Request had insufficient authentication scopes.'), { status: 403 }),
    );
    await expect(service.listGroups(MBX)).rejects.toBeInstanceOf(MailboxMissingScopeException);
  });

  it('cuota de Google (429) → 429 GOOGLE_RATE_LIMITED; otros errores → handleGoogleError', async () => {
    people.people.connections.list.mockRejectedValueOnce({ status: 429 });
    await expect(service.searchContacts(MBX)).rejects.toBeInstanceOf(GoogleRateLimitedException);
    people.people.connections.list.mockRejectedValueOnce(new Error('boom'));
    await expect(service.searchContacts(MBX)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
