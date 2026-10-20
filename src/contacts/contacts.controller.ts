import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequireMailboxAccess } from '../mailboxes/decorators/require-mailbox-access.decorator';
import { ContactsService } from './contacts.service';
import type { Contact, ContactGroup } from './contacts.types';

const GROUP_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_QUERY_LENGTH = 100;

/**
 * Contactos y grupos de la casilla para Redactar (autocompletado de "Para" y
 * "Elegir desde contactos"). Solo lectura. Se usan al redactar: piden canSend.
 */
@RequireMailboxAccess('send')
@Controller('mailboxes/:mailboxId')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('contact-groups')
  listGroups(@Param('mailboxId', ParseUUIDPipe) mailboxId: string): Promise<ContactGroup[]> {
    return this.contacts.listGroups(mailboxId);
  }

  @Get('contact-groups/:groupId/members')
  listMembers(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('groupId') groupId: string,
  ): Promise<Contact[]> {
    if (!GROUP_ID.test(groupId)) throw new BadRequestException('groupId inválido');
    return this.contacts.listGroupMembers(mailboxId, groupId);
  }

  /** Sin `q`: todos los contactos. Con `q`: búsqueda (incluye "Otros contactos"). */
  @Get('contacts')
  search(
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Query('q') q?: string,
  ): Promise<Contact[]> {
    if (q !== undefined && (typeof q !== 'string' || q.length > MAX_QUERY_LENGTH)) {
      throw new BadRequestException(`q: máximo ${MAX_QUERY_LENGTH} caracteres`);
    }
    return this.contacts.searchContacts(mailboxId, q);
  }
}
