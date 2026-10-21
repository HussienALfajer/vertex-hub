import { Inject, Injectable } from '@nestjs/common';
import type {
  AssigneeLeave,
  CalendarDate,
  CalendarLeave,
  LeaveHalf,
  LeaveType,
} from '@vertex-hub/contracts';
import { type Database, hrRequests, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { HrScope, reaches } from './hr-scope.js';

type Executor = Database | Transaction;

/** An approved leave, as other modules see it. */
export interface ApprovedLeave {
  requestId: string;
  userId: string;
  startsOn: CalendarDate;
  endsOn: CalendarDate;
  half: LeaveHalf | null;
  leaveType: LeaveType;
}

/**
 * Approved leave for other modules (rules B16 and B17): the calendar's "On leave" entries and
 * conflicts, and the warning on task assignments. The leave type leaves `hr` only for `hr.read`
 * holders covering the employee.
 */
@Injectable()
export class LeaveDirectory {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly scope: HrScope,
  ) {}

  /** The approved leaves sharing a day with `[from, to]`, of these users or of everyone. */
  async approved(
    range: { from: CalendarDate; to: CalendarDate; userIds?: readonly string[] },
    executor: Executor = this.db,
  ): Promise<ApprovedLeave[]> {
    if (range.userIds?.length === 0) return [];
    const rows = await executor
      .select({
        requestId: hrRequests.id,
        userId: hrRequests.userId,
        startsOn: hrRequests.startsOn,
        endsOn: hrRequests.endsOn,
        half: hrRequests.half,
        leaveType: hrRequests.leaveType,
      })
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.kind, 'leave'),
          eq(hrRequests.status, 'approved'),
          isNull(hrRequests.archivedAt),
          lte(hrRequests.startsOn, range.to),
          gte(hrRequests.endsOn, range.from),
          range.userIds ? inArray(hrRequests.userId, [...new Set(range.userIds)]) : undefined,
        ),
      )
      .orderBy(asc(hrRequests.startsOn), asc(hrRequests.id));
    return rows.flatMap((row) => (row.leaveType ? [{ ...row, leaveType: row.leaveType }] : []));
  }

  /** Rule B17: the user's approved leaves covering `date`. */
  async covering(executor: Executor, userId: string, date: CalendarDate): Promise<AssigneeLeave[]> {
    const leaves = await this.approved({ from: date, to: date, userIds: [userId] }, executor);
    return leaves.map((leave) => ({ startsOn: leave.startsOn, endsOn: leave.endsOn }));
  }

  /** Rule B16: "On leave" on the calendar, with the type for `hr.read` holders in scope. */
  async calendar(
    actor: CurrentUserInfo,
    range: { from: CalendarDate; to: CalendarDate; userId?: string },
  ): Promise<CalendarLeave[]> {
    const leaves = await this.approved({
      from: range.from,
      to: range.to,
      userIds: range.userId ? [range.userId] : undefined,
    });
    if (leaves.length === 0) return [];
    const [people, reach] = await Promise.all([
      this.users.summaries(leaves.map((leave) => leave.userId)),
      this.scope.reach(actor),
    ]);
    return leaves.map((leave) => ({
      requestId: leave.requestId,
      user: { id: leave.userId, name: people.get(leave.userId)?.name ?? '' },
      startsOn: leave.startsOn,
      endsOn: leave.endsOn,
      half: leave.half,
      leaveType: leave.userId === actor.id || reaches(reach, leave.userId) ? leave.leaveType : null,
    }));
  }
}
