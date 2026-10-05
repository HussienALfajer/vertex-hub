import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type DigestTask,
  daysInclusive,
  NOTIFICATION_EMAIL,
} from '@vertex-hub/contracts';
import { type Database, tasks } from '@vertex-hub/db';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { NotificationEmails, type ShortList } from '../notifications/index.js';
import { TaskNotices, toTimeOfDay } from './task-notices.js';
import { openSql, overdueSql } from './task-sql.js';
import { TasksService } from './tasks.service.js';

/**
 * The tasks part of the morning digest (F14 email rule 10): the user's open tasks that are
 * overdue (F06 rule 12) and those due today, as My tasks counts them.
 */
@Injectable()
export class TaskDigest implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly notices: TaskNotices,
    private readonly emails: NotificationEmails,
  ) {}

  onModuleInit(): void {
    this.emails.registerDigestSource((userId, now) => this.digest(userId, now));
  }

  async digest(
    userId: string,
    now: Date,
  ): Promise<{ overdue: ShortList<DigestTask>; dueToday: ShortList<DigestTask> }> {
    const today = businessDate(now);
    const overdue = overdueSql(now);
    const [late, dueToday] = await Promise.all([
      this.list(userId, today, overdue),
      this.list(userId, today, sql`${tasks.dueDate} = ${today} and not ${overdue}`),
    ]);
    return { overdue: late, dueToday };
  }

  /** The user's open tasks shown in views that match `filter`, earliest due first. */
  private async list(
    userId: string,
    today: CalendarDate,
    filter: SQL,
  ): Promise<ShortList<DigestTask>> {
    const rows = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), openSql, this.tasks.visibleSql(), filter))
      .orderBy(asc(tasks.dueDate), sql`${tasks.dueTime} asc nulls last`, asc(tasks.id));
    const shown = rows.slice(0, NOTIFICATION_EMAIL.digestTasks);
    const loaded = new Map(
      (
        await this.notices.loadMany(
          this.db,
          shown.map((row) => row.id),
        )
      ).map((task) => [task.id, task]),
    );
    const items = shown.flatMap(({ id }) => {
      const task = loaded.get(id);
      if (!task?.dueDate) return [];
      return [
        {
          id,
          title: task.title,
          client: task.client?.name ?? null,
          dueDate: task.dueDate,
          dueTime: toTimeOfDay(task.dueTime),
          daysLate: task.dueDate < today ? daysInclusive(task.dueDate, today) - 1 : 0,
        },
      ];
    });
    return { items, more: rows.length - shown.length };
  }
}
