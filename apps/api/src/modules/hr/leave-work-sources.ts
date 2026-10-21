import { Injectable } from '@nestjs/common';
import type { CalendarDate, OverlappingWork } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';

/** One module's open work of a user in `[from, to]`. */
export type LeaveWorkSource = (
  executor: Database | Transaction,
  userId: string,
  range: { from: CalendarDate; to: CalendarDate },
) => Promise<OverlappingWork[]>;

/**
 * Rule B14: before deciding a leave, the GM sees the employee's open tasks due, shoots and
 * meetings in its period. `tasks` and `calendar` register their sources, so `hr` imports neither.
 */
@Injectable()
export class LeaveWorkSources {
  private readonly sources: LeaveWorkSource[] = [];

  register(source: LeaveWorkSource): void {
    this.sources.push(source);
  }

  /** Every source's work, by date. */
  async find(
    executor: Database | Transaction,
    userId: string,
    range: { from: CalendarDate; to: CalendarDate },
  ): Promise<OverlappingWork[]> {
    const found: OverlappingWork[] = [];
    // One query at a time: a transaction runs on a single connection.
    for (const source of this.sources) found.push(...(await source(executor, userId, range)));
    return found.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startsAt ?? '').localeCompare(b.startsAt ?? '') ||
        a.id.localeCompare(b.id),
    );
  }
}
