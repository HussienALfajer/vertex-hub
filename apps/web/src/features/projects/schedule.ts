import { type CalendarDate, daysInclusive } from '@vertex-hub/contracts';

export interface Schedule {
  /** Days from start to due, both included. */
  totalDays: number;
  /** The share of those days already begun, from 0 before the start to 1 from the due date on. */
  elapsed: number;
  /** Days until the due date: 0 on the day itself, negative once it has passed. */
  daysLeft: number;
}

/** Where today falls between a project's start and due dates (calendar days, Asia/Damascus). */
export function scheduleOf(start: CalendarDate, due: CalendarDate, today: CalendarDate): Schedule {
  const totalDays = daysInclusive(start, due);
  const begun = Math.min(daysInclusive(start, today), totalDays);
  const daysLeft = today <= due ? daysInclusive(today, due) - 1 : -(daysInclusive(due, today) - 1);
  return { totalDays, elapsed: totalDays === 0 ? 0 : begun / totalDays, daysLeft };
}
