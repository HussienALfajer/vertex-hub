import { Inject, Injectable } from '@nestjs/common';
import { isOpenLeadStage, type LeadStage, leadDisplayName } from '@vertex-hub/contracts';
import { type Database, leads, type Transaction } from '@vertex-hub/db';
import { eq, getTableName, inArray, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { coversLead, holdsAll } from './lead-access.js';

type Executor = Database | Transaction;

export interface LeadSummary {
  id: string;
  /** Company name, else contact name. */
  displayName: string;
  contactName: string;
  ownerId: string;
  stage: LeadStage;
  /** New, Contacted, Meeting or Quote sent. */
  open: boolean;
  archived: boolean;
  /** The created or linked client of a won lead. */
  clientId: string | null;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** A column of another module's table, qualified by hand (as `ClientDirectory` does). */
const qualified = (column: PgColumn) =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

const summaryOf = (row: typeof leads.$inferSelect): LeadSummary => ({
  id: row.id,
  displayName: leadDisplayName(row),
  contactName: row.contactName,
  ownerId: row.ownerId,
  stage: row.stage,
  open: isOpenLeadStage(row.stage),
  archived: !!row.archivedAt,
  clientId: row.clientId,
});

/**
 * Leads as other modules may see them (F03, ADR 0026): summaries, read scope and SQL filters
 * over a column that holds a lead id. Never the tables.
 */
@Injectable()
export class LeadDirectory {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** A lead, archived or not; `forUpdate` locks its row until the transaction ends. */
  async summary(
    id: string,
    executor: Executor = this.db,
    options: { forUpdate?: boolean } = {},
  ): Promise<LeadSummary | null> {
    const query = executor.select().from(leads).where(eq(leads.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    return row ? summaryOf(row) : null;
  }

  async summaries(ids: string[], executor: Executor = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, LeadSummary>();
    const rows = await executor.select().from(leads).where(inArray(leads.id, unique));
    return new Map(rows.map((row) => [row.id, summaryOf(row)]));
  }

  /** `leads.read` covers the lead; an archived one only for lead managers with scope all. */
  readable(actor: CurrentUserInfo, lead: LeadSummary): boolean {
    if (lead.archived) return holdsAll(actor, 'leads.manage');
    return coversLead(actor, 'leads.read', lead);
  }

  /** `column` holds a lead owned by `userId`. */
  ownedBy(column: PgColumn, userId: string): SQL {
    return sql`${qualified(column)} in (select ${leads.id} from ${leads}
      where ${leads.ownerId} = ${userId})`;
  }

  /** `column` holds a lead whose company or contact name contains `search`. */
  nameContains(column: PgColumn, search: string): SQL {
    const pattern = `%${escapeLike(search)}%`;
    return sql`${qualified(column)} in (select ${leads.id} from ${leads}
      where ${leads.companyName} ilike ${pattern} or ${leads.contactName} ilike ${pattern})`;
  }
}
