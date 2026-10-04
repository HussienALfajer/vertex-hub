import { BUSINESS_TIME_ZONE } from '@vertex-hub/contracts';
import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/** The calendar day in Asia/Damascus of a `timestamptz` column, as a SQL `date`. */
export function businessDateSql(column: SQLWrapper): SQL<string> {
  return sql<string>`(${column} at time zone ${BUSINESS_TIME_ZONE})::date`;
}
