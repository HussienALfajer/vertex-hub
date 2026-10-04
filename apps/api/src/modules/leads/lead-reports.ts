import { Inject, Injectable } from '@nestjs/common';
import type { ReportPeriod } from '@vertex-hub/contracts';
import { type Database, leads } from '@vertex-hub/db';
import { isNull, type SQL, sql } from 'drizzle-orm';
import { businessDateSql } from '../../core/database/business-date.js';
import { DATABASE } from '../../core/database/database.module.js';

/** `count(*)` of the rows matching `condition`. */
const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** Read-only lead figures for dashboards (F15, ADR 0027); archived leads are left out. */
@Injectable()
export class LeadReports {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Rule 1: leads created in the period, and those closed in it as won or lost. */
  async counts(period: ReportPeriod): Promise<{ new: number; won: number; lost: number }> {
    const inPeriod = (column: SQL<string>) =>
      sql`${column} between ${period.from} and ${period.to}`;
    const closed = inPeriod(businessDateSql(leads.closedAt));
    const [row] = await this.db
      .select({
        new: countWhere(inPeriod(businessDateSql(leads.createdAt))),
        won: countWhere(sql`${leads.stage} = 'won' and ${closed}`),
        lost: countWhere(sql`${leads.stage} = 'lost' and ${closed}`),
      })
      .from(leads)
      .where(isNull(leads.archivedAt));
    return { new: row?.new ?? 0, won: row?.won ?? 0, lost: row?.lost ?? 0 };
  }
}
