import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLIENT_LIMITS,
  type Contact,
  type CreateContact,
  type UpdateContact,
} from '@vertex-hub/contracts';
import { clientContacts, type Database, type Transaction } from '@vertex-hub/db';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { actorOf, manageableClient } from './client-access.js';

const contactColumns = {
  id: clientContacts.id,
  clientId: clientContacts.clientId,
  name: clientContacts.name,
  jobTitle: clientContacts.jobTitle,
  phone: clientContacts.phone,
  email: clientContacts.email,
  hasFinalApproval: clientContacts.hasFinalApproval,
  notes: clientContacts.notes,
};

/** People at the client, some with final-approval authority (rule 9). */
@Injectable()
export class ClientContactsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(actor: CurrentUserInfo, clientId: string, input: CreateContact): Promise<Contact> {
    return this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, clientId);
      const [existing] = await tx
        .select({ value: count() })
        .from(clientContacts)
        .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.archivedAt)));
      if ((existing?.value ?? 0) >= CLIENT_LIMITS.contacts) {
        throw new CodedException(409, 'LIMIT_REACHED', 'The client has the maximum of contacts');
      }
      const values = {
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        hasFinalApproval: input.hasFinalApproval ?? false,
        notes: input.notes ?? null,
      };
      const [contact] = await tx
        .insert(clientContacts)
        .values({ clientId, ...values })
        .returning(contactColumns);
      if (!contact) throw new Error('Contact insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_contact.created',
        entityType: 'client_contact',
        entityId: contact.id,
        after: { clientId, ...values },
      });
      return contact;
    });
  }

  async update(
    actor: CurrentUserInfo,
    clientId: string,
    contactId: string,
    input: UpdateContact,
  ): Promise<Contact> {
    return this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, clientId);
      const current = await this.activeContact(tx, clientId, contactId);
      const change = changedFields(current, input);
      if (!change) return current;
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
        before: change.before,
        after: { clientId, ...change.after },
      });
      return contact;
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
