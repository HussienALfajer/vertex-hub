import { Inject, Injectable } from '@nestjs/common';
import type { ClientStatus } from '@vertex-hub/contracts';
import { clients, type Database, type Transaction } from '@vertex-hub/db';
import { eq, getTableName, inArray, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';

export interface ClientSummary {
  id: string;
  name: string;
  status: ClientStatus;
  archived: boolean;
  accountManagerId: string;
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

  /** `column` holds a non-archived client (F05 rule G2). */
  isLive(column: PgColumn): SQL {
    return sql`${qualified(column)} in (select ${clients.id} from ${clients}
      where ${clients.archivedAt} is null)`;
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
};

function toSummary(row: {
  id: string;
  tradeName: string;
  status: ClientStatus;
  archivedAt: Date | null;
  accountManagerId: string;
}): ClientSummary {
  return {
    id: row.id,
    name: row.tradeName,
    status: row.status,
    archived: !!row.archivedAt,
    accountManagerId: row.accountManagerId,
  };
}
