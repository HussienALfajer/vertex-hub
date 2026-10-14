import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Contact, type CreateContact, type UpdateContact } from '@vertex-hub/contracts';
import { clientContacts, type Database, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { actorOf, coversNationalId, manageableClient } from './client-access.js';
import { ClientFactory, maskNationalId } from './client-factory.js';

const contactColumns = {
  id: clientContacts.id,
  clientId: clientContacts.clientId,
  name: clientContacts.name,
  jobTitle: clientContacts.jobTitle,
  phone: clientContacts.phone,
  email: clientContacts.email,
  hasFinalApproval: clientContacts.hasFinalApproval,
  notes: clientContacts.notes,
  fatherName: clientContacts.fatherName,
  nationalId: clientContacts.nationalId,
};

type ContactRow = Omit<Contact, 'nationalId'> & { nationalId: string | null };

/** The contact as the actor may see it: the national ID only with its access (F05C). */
export function contactFor(row: ContactRow, seesNationalId: boolean): Contact {
  const { nationalId, ...contact } = row;
  return seesNationalId ? { ...contact, nationalId } : contact;
}

/** People at the client, some with final-approval authority (rule 9). */
@Injectable()
export class ClientContactsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly factory: ClientFactory,
  ) {}

  async create(actor: CurrentUserInfo, clientId: string, input: CreateContact): Promise<Contact> {
    return this.db.transaction(async (tx) => {
      const client = await manageableClient(tx, actor, clientId);
      const seesNationalId = coversNationalId(actor, client);
      if (input.nationalId !== undefined && !seesNationalId) throw new ForbiddenException();
      const id = await this.factory.addContact(tx, actorOf(actor), clientId, input);
      const [contact] = await tx
        .select(contactColumns)
        .from(clientContacts)
        .where(eq(clientContacts.id, id));
      if (!contact) throw new Error('Contact insert returned no row');
      return contactFor(contact, seesNationalId);
    });
  }

  async update(
    actor: CurrentUserInfo,
    clientId: string,
    contactId: string,
    input: UpdateContact,
  ): Promise<Contact> {
    return this.db.transaction(async (tx) => {
      const client = await manageableClient(tx, actor, clientId);
      const seesNationalId = coversNationalId(actor, client);
      if (input.nationalId !== undefined && !seesNationalId) throw new ForbiddenException();
      const current = await this.activeContact(tx, clientId, contactId);
      const change = changedFields(current, input);
      if (!change) return contactFor(current, seesNationalId);
      const [contact] = await tx
        .update(clientContacts)
        .set(change.after)
        .where(eq(clientContacts.id, contactId))
        .returning(contactColumns);
      if (!contact) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_contact.updated',
        entityType: 'client_contact',
        entityId: contactId,
        before: maskNationalId(change.before),
        after: { clientId, ...maskNationalId(change.after) },
      });
      return contactFor(contact, seesNationalId);
    });
  }

  /** Removes the contact from the client; notes that name it keep it (rule 10). */
  async archive(actor: CurrentUserInfo, clientId: string, contactId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, clientId);
      const current = await this.activeContact(tx, clientId, contactId);
      await tx
        .update(clientContacts)
        .set({ archivedAt: new Date() })
        .where(eq(clientContacts.id, contactId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_contact.archived',
        entityType: 'client_contact',
        entityId: contactId,
        before: { name: current.name },
        after: { clientId },
      });
    });
  }

  private async activeContact(tx: Transaction, clientId: string, contactId: string) {
    const [contact] = await tx
      .select(contactColumns)
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .for('update');
    if (!contact) throw new NotFoundException();
    return contact;
  }
}
