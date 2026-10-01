import { Inject, Injectable } from '@nestjs/common';
import type { ClientStatus } from '@vertex-hub/contracts';
import { clientContacts, clients, type Database, type Transaction } from '@vertex-hub/db';
import { and, eq, getTableName, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';

export interface ContactSummary {
  id: string;
  name: string;
  archived: boolean;
}

export interface ClientSummary {
  id: string;
  name: string;
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

const summaryColumns = {
  id: clients.id,
  tradeName: clients.tradeName,
  status: clients.status,
  archivedAt: clients.archivedAt,
  accountManagerId: clients.accountManagerId,
  isHealthcare: clients.isHealthcare,
};

function toSummary(row: {
  id: string;
  tradeName: string;
  status: ClientStatus;
  archivedAt: Date | null;
  accountManagerId: string;
  isHealthcare: boolean;
}): ClientSummary {
  return {
    id: row.id,
    name: row.tradeName,
    status: row.status,
    archived: !!row.archivedAt,
    accountManagerId: row.accountManagerId,
    isHealthcare: row.isHealthcare,
  };
}
