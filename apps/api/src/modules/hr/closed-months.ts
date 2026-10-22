import { type CalendarDate, monthsOf } from '@vertex-hub/contracts';
import { attendanceMonths, type Database, type Transaction } from '@vertex-hub/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';

type Executor = Database | Transaction;

/**
 * Rule D2: the closed months among those `from`–`to` touches. Closing holds the holiday lock and
 * every employee's HR lock (`lockLeave`), so a caller holding either reads a settled answer.
 */
export async function closedMonths(
  executor: Executor,
  from: CalendarDate,
  to: CalendarDate,
): Promise<Set<string>> {
  const rows = await executor
    .select({ month: attendanceMonths.month })
    .from(attendanceMonths)
    .where(
      and(
        inArray(attendanceMonths.month, monthsOf(from, to)),
        eq(attendanceMonths.status, 'closed'),
        isNull(attendanceMonths.archivedAt),
      ),
    );
  return new Set(rows.map((row) => row.month));
}

/** Rule D2 and edge cases 12 and 13: `MONTH_CLOSED` when `from`–`to` touches a closed month. */
export async function assertMonthsOpen(
  executor: Executor,
  from: CalendarDate,
  to: CalendarDate = from,
): Promise<void> {
  const [month] = [...(await closedMonths(executor, from, to))].sort();
  if (month) {
    throw new CodedException(409, 'MONTH_CLOSED', `The month ${month} is closed`, { month });
  }
}
