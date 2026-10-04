import {
  addDays,
  BUSINESS_TIME_ZONE,
  businessInstant,
  type ReportPeriod,
} from '@vertex-hub/contracts';
import { and, gte, lt, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** The calendar day in Asia/Damascus of a `timestamptz` column, as a SQL `date`. */
export function businessDateSql(column: SQLWrapper): SQL<string> {
  return sql<string>`(${column} at time zone ${BUSINESS_TIME_ZONE})::date`;
}

/**
 * A `timestamptz` column falls on a day of the period in Asia/Damascus. Compared as a range of
 * instants, so an index on the column serves it (F15 "Indexes").
 */
export function inBusinessPeriod(column: PgColumn, period: ReportPeriod): SQL {
  return and(
    gte(column, businessInstant(period.from, '00:00')),
    lt(column, businessInstant(addDays(period.to, 1), '00:00')),
  ) as SQL;
}
