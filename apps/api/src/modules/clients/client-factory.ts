import { Inject, Injectable } from '@nestjs/common';
import {
  CLIENT_LIMITS,
  type ClientStatus,
  type CreateContact,
  type NoteChannel,
} from '@vertex-hub/contracts';
import {
  clientContacts,
  clientNotes,
  clients,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { UserDirectory, type UserSummary } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';

type Executor = Database | Transaction;

/** Statuses in which a client needs a valid account manager (rules 3 and 8). */
export const LIVE_STATUSES: ClientStatus[] = ['active', 'paused'];

export interface NewClient {
  tradeName: string;
  sector: string | null;
  accountManagerId: string;
  status: ClientStatus;
  isHealthcare: boolean;
}

/** An entry of another log copied into the client's communication log. */
export interface CopiedNote {
  authorId: string;
  occurredAt: Date;
  channel: NoteChannel;
  summary: string;
}

/**
 * Creates clients, contacts and log entries with F02's rules, audit and notices, inside the
 * caller's transaction: the F02 endpoints and the lead conversion (F03 rule 10). The caller holds
 * `lockAccessChanges` before calling `create` or `reactivate` (rule 14) and checks permissions.
 */
@Injectable()
export class ClientFactory {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly notifications: NotificationCenter,
  ) {}

  /** Rules 2 and 6; the account manager gets `client_account_manager_assigned`. */
  async create(tx: Transaction, actor: AuditActor, input: NewClient): Promise<string> {
    const manager = await this.validAccountManager(tx, input.accountManagerId);
    await this.assertNameFree(tx, input.tradeName);
    const [created] = await tx
      .insert(clients)
      .values({
        tradeName: input.tradeName,
        sector: input.sector,
        accountManagerId: manager.id,
        status: input.status,
        isHealthcare: input.isHealthcare,
      })
      .returning({ id: clients.id });
    if (!created) throw new Error('Client insert returned no row');
    await recordAudit(tx, {
      actor,
      action: 'client.created',
      entityType: 'client',
      entityId: created.id,
      after: {
        tradeName: input.tradeName,
        sector: input.sector,
        accountManager: { id: manager.id, name: manager.name },
        status: input.status,
        isHealthcare: input.isHealthcare,
      },
    });
    await this.notifyManager(tx, actor, created.id, manager.id, input.tradeName);
    return created.id;
  }

  /** An `ended` client becomes `active` (rule 8: with a valid account manager); others stay. */
  async reactivate(tx: Transaction, actor: AuditActor, clientId: string): Promise<void> {
    const [client] = await tx
      .select({ status: clients.status, accountManagerId: clients.accountManagerId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .for('update');
    if (client?.status !== 'ended') return;
    await this.validAccountManager(tx, client.accountManagerId);
    await tx.update(clients).set({ status: 'active' }).where(eq(clients.id, clientId));
    await recordAudit(tx, {
      actor,
      action: 'client.status_changed',
      entityType: 'client',
      entityId: clientId,
      before: { status: client.status },
      after: { status: 'active' },
    });
  }

  /** Rule 9; at most `CLIENT_LIMITS.contacts` non-archived contacts (`LIMIT_REACHED`). */
  async addContact(
    tx: Transaction,
    actor: AuditActor,
    clientId: string,
    input: CreateContact,
  ): Promise<string> {
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
      .returning({ id: clientContacts.id });
    if (!contact) throw new Error('Contact insert returned no row');
    await recordAudit(tx, {
      actor,
      action: 'client_contact.created',
      entityType: 'client_contact',
      entityId: contact.id,
      after: { clientId, ...values },
    });
    return contact.id;
  }

  /** Copies entries into the communication log with their authors and times (F03 rule 10). */
  async copyNotes(
    tx: Transaction,
    actor: AuditActor,
    clientId: string,
    notes: readonly CopiedNote[],
    contactId: string | null,
  ): Promise<void> {
    for (const note of notes) {
      const values = {
        occurredAt: note.occurredAt,
        channel: note.channel,
        contactId,
        summary: note.summary,
      };
      const [row] = await tx
        .insert(clientNotes)
        .values({ clientId, authorId: note.authorId, ...values })
        .returning({ id: clientNotes.id });
      if (!row) throw new Error('Note insert returned no row');
      await recordAudit(tx, {
        actor,
        action: 'client_note.created',
        entityType: 'client_note',
        entityId: row.id,
        after: {
          clientId,
          ...values,
          authorId: note.authorId,
          occurredAt: values.occurredAt.toISOString(),
        },
      });
    }
  }

  /** Whether a non-archived contact of the client has this phone or email. */
  async hasContact(
    clientId: string,
    match: { phone: string | null; email: string | null },
    executor: Executor = this.db,
  ): Promise<boolean> {
    const matches = [
      match.phone ? eq(clientContacts.phone, match.phone) : undefined,
      match.email ? sql`lower(${clientContacts.email}) = ${match.email.toLowerCase()}` : undefined,
    ].filter((filter) => !!filter);
    if (matches.length === 0) return false;
    const [row] = await executor
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.archivedAt),
          sql`(${sql.join(matches, sql` or `)})`,
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Rule 2: a non-archived user with the Account Manager role. */
  async validAccountManager(tx: Transaction, userId: string): Promise<UserSummary> {
    const manager = await this.users.accountManager(userId, tx);
    if (!manager) {
      throw new CodedException(
        400,
        'INVALID_ACCOUNT_MANAGER',
        'The account manager must be a non-archived user with the Account Manager role',
      );
    }
    return manager;
  }

  /** Rule 6: unique case-insensitively among non-archived clients. */
  async assertNameFree(executor: Executor, tradeName: string, exceptId?: string): Promise<void> {
    const [taken] = await executor
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          sql`lower(${clients.tradeName}) = lower(${tradeName})`,
          isNull(clients.archivedAt),
          exceptId ? ne(clients.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(409, 'CLIENT_NAME_TAKEN', 'Another client has this trade name');
    }
  }

  /** F14: the new primary account manager learns about the client. */
  notifyManager(
    tx: Transaction,
    actor: AuditActor | null,
    clientId: string,
    managerId: string,
    tradeName: string,
  ) {
    return this.notifications.notify(tx, {
      type: 'client_account_manager_assigned',
      recipients: [managerId],
      actorId: actor?.id ?? null,
      subjectId: clientId,
      data: { client: tradeName },
    });
  }
}
