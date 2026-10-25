import { Inject, Injectable } from '@nestjs/common';
import type { ClientRef, ClientStatus } from '@vertex-hub/contracts';
import { clientContacts, clients, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, getTableName, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { coversNationalId } from './client-access.js';

export interface ContactSummary {
  id: string;
  name: string;
  archived: boolean;
}

/** A contact as an approval request needs it (F09). */
export interface ContactDetail extends ContactSummary {
  clientId: string;
  phone: string | null;
  email: string | null;
  hasFinalApproval: boolean;
}

/** What a retainer contract prints for the client and its signatory (F05C K6). */
export interface ContractParty {
  tradeName: string;
  registrationNumber: string | null;
  billingAddress: string | null;
  signatory: {
    id: string;
    name: string;
    fatherName: string | null;
    nationalId: string | null;
    jobTitle: string | null;
    phone: string | null;
    email: string | null;
    archived: boolean;
  } | null;
}

/** A client as a contract's `clientRefSchema` shows it; a missing one keeps its id with no name. */
export const clientRef = (clients: ReadonlyMap<string, ClientSummary>, id: string): ClientRef => {
  const client = clients.get(id);
  return { id, name: client?.name ?? '', imageId: client?.imageId ?? null };
};

export interface ClientSummary {
  id: string;
  name: string;
  /** The current logo (F01C). */
  imageId: string | null;
  status: ClientStatus;
  archived: boolean;
  accountManagerId: string;
  /** Content for the client passes medical review first (F09 rule 4). */
  isHealthcare: boolean;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * A column of another module's table, qualified by hand: Drizzle leaves columns unqualified in
 * single-table selects, and inside a subquery on `clients` an unqualified name could bind there.
 */
const qualified = (column: PgColumn) =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

/**
 * Clients as other modules may see them (F05): basics, status, account manager, and SQL filters
 * over a column that holds a client id. Never the tables.
 */
@Injectable()
export class ClientDirectory {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** A client, archived or not; `forUpdate` locks its row until the transaction ends. */
  async summary(
    id: string,
    executor: Database | Transaction = this.db,
    options: { forUpdate?: boolean } = {},
  ): Promise<ClientSummary | null> {
    const query = executor.select(summaryColumns).from(clients).where(eq(clients.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    return row ? toSummary(row) : null;
  }

  async summaries(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, ClientSummary>();
    const rows = await executor
      .select(summaryColumns)
      .from(clients)
      .where(inArray(clients.id, unique));
    return new Map(rows.map((row) => [row.id, toSummary(row)]));
  }

  /** The non-archived clients `userId` is primary account manager of, by name (F15 My clients). */
  async managed(userId: string): Promise<ClientSummary[]> {
    const rows = await this.db
      .select(summaryColumns)
      .from(clients)
      .where(and(eq(clients.accountManagerId, userId), isNull(clients.archivedAt)))
      .orderBy(asc(sql`lower(${clients.tradeName})`));
    return rows.map(toSummary);
  }

  /** What invoices, receipts and statements print for the client (F13): billing name and address. */
  async billingDetails(
    id: string,
    executor: Database | Transaction = this.db,
  ): Promise<{ name: string; address: string | null } | null> {
    const [row] = await executor
      .select({
        tradeName: clients.tradeName,
        billingName: clients.billingName,
        billingAddress: clients.billingAddress,
      })
      .from(clients)
      .where(eq(clients.id, id));
    return row ? { name: row.billingName || row.tradeName, address: row.billingAddress } : null;
  }

  /**
   * F05C K6: the client's legal details and the signatory contact (of this client), national ID
   * included: the caller decides who sees it (`coversNationalId`).
   */
  async contractParty(
    clientId: string,
    signatoryId: string | null,
    executor: Database | Transaction = this.db,
  ): Promise<ContractParty | null> {
    const [client] = await executor
      .select({
        tradeName: clients.tradeName,
        registrationNumber: clients.registrationNumber,
        billingAddress: clients.billingAddress,
      })
      .from(clients)
      .where(eq(clients.id, clientId));
    if (!client) return null;
    const [contact] = signatoryId
      ? await executor
          .select({
            id: clientContacts.id,
            name: clientContacts.name,
            fatherName: clientContacts.fatherName,
            nationalId: clientContacts.nationalId,
            jobTitle: clientContacts.jobTitle,
            phone: clientContacts.phone,
            email: clientContacts.email,
            archivedAt: clientContacts.archivedAt,
          })
          .from(clientContacts)
          .where(and(eq(clientContacts.id, signatoryId), eq(clientContacts.clientId, clientId)))
      : [];
    const signatory = contact
      ? (({ archivedAt, ...rest }) => ({ ...rest, archived: !!archivedAt }))(contact)
      : null;
    return { ...client, signatory };
  }

  /** F05C Roles: whether the actor reads the client's contacts' national IDs. */
  coversNationalId(actor: CurrentUserInfo, client: ClientSummary): boolean {
    return coversNationalId(actor, {
      id: client.id,
      accountManagerId: client.accountManagerId,
      archivedAt: client.archived ? new Date(0) : null,
    });
  }

  /** Whether `contactId` is a non-archived contact of the client. */
  async isActiveContact(
    clientId: string,
    contactId: string,
    executor: Database | Transaction = this.db,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.archivedAt),
        ),
      );
    return !!row;
  }

  /** Contacts by id, archived or not. */
  async contactSummaries(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, ContactSummary>();
    const rows = await executor
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        archivedAt: clientContacts.archivedAt,
      })
      .from(clientContacts)
      .where(inArray(clientContacts.id, unique));
    return new Map(
      rows.map((row) => [row.id, { id: row.id, name: row.name, archived: !!row.archivedAt }]),
    );
  }

  /** Contacts by id, archived or not, with their client, phone and approval authority. */
  async contacts(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, ContactDetail>();
    const rows = await executor
      .select(contactColumns)
      .from(clientContacts)
      .where(inArray(clientContacts.id, unique));
    return new Map(rows.map((row) => [row.id, toContact(row)]));
  }

  /** The non-archived contacts with final-approval authority of the clients, by name (F02 rule 9). */
  async approvers(clientIds: string[]): Promise<ContactDetail[]> {
    const unique = [...new Set(clientIds)];
    if (unique.length === 0) return [];
    const rows = await this.db
      .select(contactColumns)
      .from(clientContacts)
      .where(
        and(
          inArray(clientContacts.clientId, unique),
          clientContacts.hasFinalApproval,
          isNull(clientContacts.archivedAt),
        ),
      )
      .orderBy(clientContacts.name, clientContacts.id);
    return rows.map(toContact);
  }

  /**
   * Non-archived clients whose trade name equals one of `names` (case-insensitive) or with a
   * non-archived contact of the same phone or email, by trade name (F03 rule 2).
   */
  async duplicates(
    match: { names: readonly string[]; phone: string | null; email: string | null },
    executor: Database | Transaction = this.db,
  ): Promise<ClientSummary[]> {
    const names = [...new Set(match.names.map((name) => name.toLowerCase()))];
    const contactMatches = [
      match.phone ? eq(clientContacts.phone, match.phone) : undefined,
      match.email ? sql`lower(${clientContacts.email}) = ${match.email.toLowerCase()}` : undefined,
    ].filter((filter): filter is SQL => !!filter);
    const byName = names.length > 0 ? inArray(sql`lower(${clients.tradeName})`, names) : undefined;
    const byContact =
      contactMatches.length > 0
        ? sql`${clients.id} in (select ${clientContacts.clientId} from ${clientContacts}
            where ${clientContacts.archivedAt} is null and (${or(...contactMatches)}))`
        : undefined;
    if (!byName && !byContact) return [];
    const rows = await executor
      .select(summaryColumns)
      .from(clients)
      .where(and(isNull(clients.archivedAt), or(byName, byContact)))
      .orderBy(clients.tradeName, clients.id);
    return rows.map(toSummary);
  }

  /** `column` holds a non-archived client (F05 rule G2). */
  isLive(column: PgColumn): SQL {
    return sql`${qualified(column)} in (select ${clients.id} from ${clients}
      where ${clients.archivedAt} is null)`;
  }

  /** `column` holds a client whose primary account manager is `userId`. */
  managedBy(column: PgColumn, userId: string): SQL {
    return sql`${qualified(column)} in (select ${clients.id} from ${clients}
      where ${clients.accountManagerId} = ${userId})`;
  }

  /** `column` holds a client flagged healthcare. */
  isHealthcare(column: PgColumn): SQL {
    return sql`${qualified(column)} in (select ${clients.id} from ${clients}
      where ${clients.isHealthcare})`;
  }

  /** The trade name of the client in `column`, lowercased, to sort by. */
  sortName(column: PgColumn): SQL {
    return sql`(select lower(${clients.tradeName}) from ${clients}
      where ${clients.id} = ${qualified(column)})`;
  }

  /** `column` holds a client whose trade name contains `search`, case-insensitively. */
  nameContains(column: PgColumn, search: string): SQL {
    return sql`${qualified(column)} in (select ${clients.id} from ${clients}
      where ${clients.tradeName} ilike ${`%${escapeLike(search)}%`})`;
  }
}

const contactColumns = {
  id: clientContacts.id,
  clientId: clientContacts.clientId,
  name: clientContacts.name,
  phone: clientContacts.phone,
  email: clientContacts.email,
  hasFinalApproval: clientContacts.hasFinalApproval,
  archivedAt: clientContacts.archivedAt,
};

const toContact = ({
  archivedAt,
  ...row
}: {
  id: string;
  clientId: string;
  name: string;
  phone: string | null;
  email: string | null;
  hasFinalApproval: boolean;
  archivedAt: Date | null;
}): ContactDetail => ({ ...row, archived: !!archivedAt });

const summaryColumns = {
  id: clients.id,
  tradeName: clients.tradeName,
  imageId: clients.imageId,
  status: clients.status,
  archivedAt: clients.archivedAt,
  accountManagerId: clients.accountManagerId,
  isHealthcare: clients.isHealthcare,
};

function toSummary(row: {
  id: string;
  tradeName: string;
  imageId: string | null;
  status: ClientStatus;
  archivedAt: Date | null;
  accountManagerId: string;
  isHealthcare: boolean;
}): ClientSummary {
  return {
    id: row.id,
    name: row.tradeName,
    imageId: row.imageId,
    status: row.status,
    archived: !!row.archivedAt,
    accountManagerId: row.accountManagerId,
    isHealthcare: row.isHealthcare,
  };
}
