import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { people_v1 } from 'googleapis';
import { CONTACTS_SCOPE, OTHER_CONTACTS_SCOPE } from '../google/google.constants';
import { GoogleMailboxClient, type MailboxGoogleApis } from '../google/google-mailbox-client';
import type { Contact, ContactGroup } from './contacts.types';

/** Cuánto se guardan grupos, miembros y la lista completa (la People API tiene cuota). */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** Cada cuánto se "despierta" la búsqueda de Google (ver `warmUp`). */
const WARMUP_TTL_MS = 60 * 60 * 1000;
/** Resultados de una búsqueda con `q`. */
export const SEARCH_LIMIT = 20;
/** Tope de miembros por grupo y de páginas de "Mis contactos" (1000 por página). */
const MAX_GROUP_MEMBERS = 1000;
const MAX_CONNECTION_PAGES = 10;
/** People API: hasta 200 personas por `getBatchGet`. */
const BATCH_SIZE = 200;
const PERSON_FIELDS = 'names,emailAddresses';

/**
 * La casilla se conectó sin dar acceso a Contactos (antes de la Fase 8, o lo
 * destildaron en la pantalla de Google): 409 con `code` para mostrar "reconectar".
 */
export class MailboxMissingScopeException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: 'mailbox_missing_scope',
      message: 'Reconectá la casilla para dar acceso a Contactos',
    });
  }
}

/** Google cortó por cuota: no es una falla, alcanza con esperar unos segundos. */
export class GoogleRateLimitedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        code: 'GOOGLE_RATE_LIMITED',
        message: 'Demasiadas consultas de contactos a Google: probá de nuevo en unos segundos',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

/**
 * Contactos y grupos de Google Contacts de una casilla, con la People API.
 * Solo lectura: crear o editar contactos y grupos se hace en Google Contacts.
 *
 * Grupos, miembros y la lista completa se guardan 5 minutos en memoria (por
 * casilla): el front los pide al abrir Redactar y no cambian a cada rato. Un
 * contacto recién agregado en Google puede tardar ese tiempo en aparecer.
 */
@Injectable()
export class ContactsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly warmedUp = new Map<string, number>();

  constructor(private readonly google: GoogleMailboxClient) {}

  /** Grupos creados por el usuario (no los de sistema como "Destacados"). */
  async listGroups(mailboxId: string): Promise<ContactGroup[]> {
    return this.cached(`${mailboxId}:groups`, async () => {
      const apis = await this.apisWithContacts(mailboxId);
      const data = await this.call(apis, async () => {
        const groups: people_v1.Schema$ContactGroup[] = [];
        let pageToken: string | undefined;
        do {
          const res = await apis.people.contactGroups.list({
            pageSize: 1000,
            pageToken,
            groupFields: 'name,groupType,memberCount',
          });
          groups.push(...(res.data.contactGroups ?? []));
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
        return groups;
      });
      return data
        .filter((g) => g.groupType === 'USER_CONTACT_GROUP' && g.resourceName)
        .map((g) => ({
          id: shortId(g.resourceName ?? ''),
          name: g.formattedName || g.name || '(sin nombre)',
          memberCount: g.memberCount ?? 0,
        }))
        .sort(byName);
    });
  }

  /** Miembros con email de un grupo (los que no tienen email no sirven para enviar). */
  async listGroupMembers(mailboxId: string, groupId: string): Promise<Contact[]> {
    return this.cached(`${mailboxId}:group:${groupId}`, async () => {
      const apis = await this.apisWithContacts(mailboxId);
      const group = await this.call(
        apis,
        async () =>
          (
            await apis.people.contactGroups.get({
              resourceName: `contactGroups/${groupId}`,
              maxMembers: MAX_GROUP_MEMBERS,
              groupFields: 'name,groupType',
            })
          ).data,
        'El grupo no existe',
      );
      if (group.groupType !== 'USER_CONTACT_GROUP')
        throw new NotFoundException('El grupo no existe');

      const names = group.memberResourceNames ?? [];
      const people: people_v1.Schema$Person[] = [];
      for (let i = 0; i < names.length; i += BATCH_SIZE) {
        const chunk = names.slice(i, i + BATCH_SIZE);
        const res = await this.call(apis, () =>
          apis.people.people.getBatchGet({ resourceNames: chunk, personFields: PERSON_FIELDS }),
        );
        for (const r of res.data.responses ?? []) if (r.person) people.push(r.person);
      }
      return toContacts(people);
    });
  }

  /**
   * Sin `q`: todos los de "Mis contactos" (el front arma con eso el
   * autocompletado y "Todos los contactos"). Con `q`: busca en "Mis contactos"
   * y en "Otros contactos" (a quienes la casilla ya les escribió), sin repetidos.
   */
  async searchContacts(mailboxId: string, q?: string): Promise<Contact[]> {
    const query = (q ?? '').trim();
    if (!query) return this.allContacts(mailboxId);

    const apis = await this.apisWithContacts(mailboxId);
    await this.warmUp(apis);
    const mine = await this.call(apis, () =>
      apis.people.people.searchContacts({ query, readMask: PERSON_FIELDS, pageSize: 30 }),
    );
    const results = toContacts((mine.data.results ?? []).map((r) => r.person ?? {}));

    if (apis.scopes.includes(OTHER_CONTACTS_SCOPE)) {
      const other = await this.call(apis, () =>
        apis.people.otherContacts.search({ query, readMask: PERSON_FIELDS, pageSize: 30 }),
      );
      const seen = new Set(results.map((c) => c.email.toLowerCase()));
      for (const c of toContacts((other.data.results ?? []).map((r) => r.person ?? {}))) {
        if (!seen.has(c.email.toLowerCase())) results.push(c);
      }
    }
    return results.slice(0, SEARCH_LIMIT);
  }

  // ---------------------------------------------------------------------------

  private allContacts(mailboxId: string): Promise<Contact[]> {
    return this.cached(`${mailboxId}:all`, async () => {
      const apis = await this.apisWithContacts(mailboxId);
      const people = await this.call(apis, async () => {
        const all: people_v1.Schema$Person[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_CONNECTION_PAGES; page++) {
          const res = await apis.people.people.connections.list({
            resourceName: 'people/me',
            personFields: PERSON_FIELDS,
            pageSize: 1000,
            pageToken,
          });
          all.push(...(res.data.connections ?? []));
          pageToken = res.data.nextPageToken ?? undefined;
          if (!pageToken) break;
        }
        return all;
      });
      return toContacts(people);
    });
  }

  /**
   * La búsqueda de la People API necesita un pedido "en vacío" antes, para que
   * Google arme su índice (si no, las primeras búsquedas vuelven vacías). Se hace
   * una vez por hora y por casilla.
   */
  private async warmUp(apis: MailboxGoogleApis): Promise<void> {
    const last = this.warmedUp.get(apis.mailboxId) ?? 0;
    if (Date.now() - last < WARMUP_TTL_MS) return;
    await this.call(apis, () =>
      apis.people.people.searchContacts({ query: '', readMask: PERSON_FIELDS }),
    );
    if (apis.scopes.includes(OTHER_CONTACTS_SCOPE)) {
      await this.call(apis, () =>
        apis.people.otherContacts.search({ query: '', readMask: PERSON_FIELDS }),
      );
    }
    this.warmedUp.set(apis.mailboxId, Date.now());
  }

  private async apisWithContacts(mailboxId: string): Promise<MailboxGoogleApis> {
    const apis = await this.google.forMailbox(mailboxId);
    if (!apis.scopes.includes(CONTACTS_SCOPE)) throw new MailboxMissingScopeException();
    return apis;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    this.cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  /** Errores de la People API → respuestas claras; el resto, como siempre. */
  private async call<T>(
    apis: MailboxGoogleApis,
    fn: () => Promise<T>,
    notFound = 'No se encontró en Google Contacts',
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const status = googleStatus(err);
      if (status === 404) throw new NotFoundException(notFound);
      if (status === 429) throw new GoogleRateLimitedException();
      if (status === 403 && /insufficient|scope/i.test(errorText(err))) {
        throw new MailboxMissingScopeException();
      }
      return this.google.handleGoogleError(apis.mailboxId, err);
    }
  }
}

// -----------------------------------------------------------------------------

/** "contactGroups/abc123" → "abc123"; "people/c456" → "c456". */
function shortId(resourceName: string): string {
  return resourceName.slice(resourceName.indexOf('/') + 1);
}

/** Una persona → un contacto con su email principal (o el primero). Sin email, no va. */
export function toContact(person: people_v1.Schema$Person): Contact | null {
  const emails = (person.emailAddresses ?? []).filter((e) => e.value);
  const email = (emails.find((e) => e.metadata?.primary) ?? emails[0])?.value?.trim();
  if (!email) return null;
  const name =
    person.names?.find((n) => n.metadata?.primary)?.displayName ??
    person.names?.[0]?.displayName ??
    email;
  const resource = person.resourceName ?? email;
  const id = resource.startsWith('otherContacts/') ? `o_${shortId(resource)}` : shortId(resource);
  return { id, name, email };
}

/** Sin repetidos por email (sin distinguir mayúsculas) y por nombre. */
export function toContacts(people: people_v1.Schema$Person[]): Contact[] {
  const seen = new Set<string>();
  const result: Contact[] = [];
  for (const person of people) {
    const contact = toContact(person);
    if (!contact || seen.has(contact.email.toLowerCase())) continue;
    seen.add(contact.email.toLowerCase());
    result.push(contact);
  }
  return result.sort(byName);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
}

function googleStatus(err: unknown): number {
  if (typeof err !== 'object' || err === null) return 0;
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  return Number(e.response?.status ?? e.status ?? e.code) || 0;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : JSON.stringify(err ?? '');
}
