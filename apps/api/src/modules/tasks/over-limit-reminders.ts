import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CalendarDate,
  isWorkDay,
  nthWorkDay,
  OVER_LIMIT_REMINDER_WORK_DAYS,
} from '@vertex-hub/contracts';
import { type Database, taskRevisions, tasks } from '@vertex-hub/db';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { ClientDirectory } from '../clients/index.js';
import { DailyReminders } from '../notifications/index.js';
import { TaskNotices } from './task-notices.js';

/**
 * The follow-up on over-limit revisions (A06, spec P2A rules 8–11), a source of the
 * `notifications.daily` job: once per revision whose "free or extra work" decision is still
 * pending on the second work day after it was recorded, to the client's primary account manager
 * and the managers of Internal Operations.
 */
@Injectable()
export class OverLimitReminders implements OnModuleInit {
  private readonly logger = new Logger(OverLimitReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly notices: TaskNotices,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('over-limit-decisions', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    // Rule 8: undecided over-limit revisions of live, non-cancelled tasks of live clients.
    const pending = and(
      taskRevisions.overLimit,
      isNull(taskRevisions.decision),
      isNull(tasks.archivedAt),
      ne(tasks.status, 'cancelled'),
      this.clients.isLive(tasks.clientId),
    );
    const rows = await this.db
      .select({ id: taskRevisions.id, taskId: tasks.id, createdAt: taskRevisions.createdAt })
      .from(taskRevisions)
      .innerJoin(tasks, eq(tasks.id, taskRevisions.taskId))
      .where(pending)
      .orderBy(asc(taskRevisions.id));
    const candidates = rows
      .map((row) => ({ ...row, recordedOn: businessDate(row.createdAt) }))
      .filter(
        ({ recordedOn }) =>
          nthWorkDay(addDays(recordedOn, 1), OVER_LIMIT_REMINDER_WORK_DAYS) <= today,
      );
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Over-limit reminder ${id}`,
      async ({ id, taskId, recordedOn }) => {
        // Read again under the task lock: decided, cancelled or archived since sends nothing.
        const recorded = await this.db.transaction(async (tx) => {
          await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).for('update');
          const [revision] = await tx
            .select({ number: taskRevisions.number })
            .from(taskRevisions)
            .innerJoin(tasks, eq(tasks.id, taskRevisions.taskId))
            .where(and(eq(taskRevisions.id, id), pending));
          if (!revision?.number) return false;
          const task = await this.notices.load(tx, taskId);
          if (!task.client) return false;
          // Rule 10: the account manager too, even when they recorded the revision themselves.
          const recipients = [
            task.client.accountManagerId,
            ...(await this.notices.managers(tx, 'internal_operations')),
          ];
          return this.reminders.remindOnce(
            tx,
            { kind: 'over_limit_pending', subjectId: id, occurrence: recordedOn },
            today,
            this.notices.notice(task, 'task_over_limit_pending', recipients, null, {
              revisionNumber: revision.number,
              recordedOn,
            }),
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
