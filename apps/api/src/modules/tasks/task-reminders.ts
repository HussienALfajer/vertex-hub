import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type CalendarDate,
  isWorkDay,
  type NotificationReminderKind,
  nextWorkDay,
  OPEN_TASK_STATUSES,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNotNull, lt, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { DailyReminders, type Notice } from '../notifications/index.js';
import { type NoticeTask, TaskNotices, toTimeOfDay } from './task-notices.js';
import { TasksService } from './tasks.service.js';

/**
 * The task reminders of the `notifications.daily` job (spec F14 rules 9–11): due on the next work
 * day (A07), overdue (A08), and the escalation to the department's managers a work day later.
 * Each is sent once per task and due date; a new due date starts again.
 */
@Injectable()
export class TaskReminders implements OnModuleInit {
  private readonly logger = new Logger(TaskReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly tasks: TasksService,
    private readonly notices: TaskNotices,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('tasks', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    let sent = 0;
    // The three kinds run independently: one failing does not hold back the others.
    const kinds: [string, () => Promise<number>][] = [
      ['Due-soon reminders', () => this.dueSoon(today)],
      ['Overdue reminders', () => this.overdue(today)],
      ['Overdue escalations', () => this.escalate(today)],
    ];
    await runEach(
      kinds,
      this.logger,
      ([name]) => name,
      async ([, run]) => {
        sent += await run();
      },
    );
    return sent;
  }

  /** Rule 9: assigned tasks due after `today` and on or before the next work day. */
  private dueSoon(today: CalendarDate): Promise<number> {
    const filters = [
      isNotNull(tasks.assigneeId),
      gt(tasks.dueDate, today),
      lte(tasks.dueDate, nextWorkDay(today)),
    ];
    // F14 email rule 4: the assignee's morning digest lists the task.
    return this.send(today, 'due_soon', filters, async (_tx, task) => ({
      ...this.notices.notice(task, 'task_due_soon', [task.assigneeId], null, dueOf(task)),
      digestCovered: true,
    }));
  }

  /** Rule 10: open tasks due before `today`, to the assignee or the department's managers. */
  private overdue(today: CalendarDate): Promise<number> {
    return this.send(today, 'overdue', [lt(tasks.dueDate, today)], async (tx, task) => ({
      ...this.notices.notice(
        task,
        'task_overdue',
        await this.notices.assigneeOrManagers(tx, task),
        null,
        dueOf(task),
      ),
      // F14 email rule 4: the assignee's digest lists it; managers of an unassigned task get it.
      digestCovered: task.assigneeId !== null,
    }));
  }

  /**
   * Rule 11: assigned tasks still overdue whose overdue reminder for the current due date went
   * out on an earlier work day, to the department's managers.
   */
  private escalate(today: CalendarDate): Promise<number> {
    const filters = [isNotNull(tasks.assigneeId), lt(tasks.dueDate, today)];
    return this.send(today, 'overdue_escalated', filters, async (tx, task) => {
      const sentOn = (
        await this.reminders.sentOn(
          'overdue',
          [{ subjectId: task.id, occurrence: task.dueDate }],
          tx,
        )
      ).get(task.id);
      if (!sentOn || sentOn >= today) return null;
      const people = await this.users.summaries(task.assigneeId ? [task.assigneeId] : [], tx);
      return this.notices.notice(
        task,
        'task_overdue_escalated',
        await this.notices.managers(tx, task.department),
        null,
        {
          ...dueOf(task),
          assignee: (task.assigneeId && people.get(task.assigneeId)?.name) || null,
        },
      );
    });
  }

  /** Open tasks shown in views (not archived, nor under archived work) matching `filters`. */
  private eligible(filters: SQL[]): SQL {
    return and(
      inArray(tasks.status, [...OPEN_TASK_STATUSES]),
      this.tasks.visibleSql(),
      ...filters,
    ) as SQL;
  }

  /**
   * One transaction per reminder (rule 8). The task is locked and checked again inside it, so a
   * task delivered, re-dated or reassigned since the candidates were read gets no stale notice;
   * the reminder is recorded first and sent only if this run recorded it.
   */
  private async send(
    today: CalendarDate,
    kind: NotificationReminderKind,
    filters: SQL[],
    build: (tx: Transaction, task: NoticeTask) => Promise<Notice | null>,
  ): Promise<number> {
    const candidates = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(this.eligible(filters))
      .orderBy(asc(tasks.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Task ${kind} reminder ${id}`,
      async ({ id }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .select({ id: tasks.id })
            .from(tasks)
            .where(and(eq(tasks.id, id), this.eligible(filters)))
            .for('update', { of: tasks });
          if (!row) return false;
          const task = await this.notices.load(tx, id);
          const notice = await build(tx, task);
          if (!notice) return false;
          const key = { kind, subjectId: task.id, occurrence: task.dueDate };
          return this.reminders.remindOnce(tx, key, today, notice);
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}

const dueOf = (task: NoticeTask) => ({ dueDate: task.dueDate, dueTime: toTimeOfDay(task.dueTime) });
