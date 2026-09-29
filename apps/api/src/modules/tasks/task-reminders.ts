import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type CalendarDate,
  isWorkDay,
  type NotificationReminderKind,
  nextWorkDay,
  OPEN_TASK_STATUSES,
} from '@vertex-hub/contracts';
import { type Database, tasks } from '@vertex-hub/db';
import { and, gt, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
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
    return (await this.dueSoon(today)) + (await this.overdue(today)) + (await this.escalate(today));
  }

  /** Rule 9: assigned tasks due after `today` and on or before the next work day. */
  private async dueSoon(today: CalendarDate): Promise<number> {
    const due = await this.open(
      isNotNull(tasks.assigneeId),
      gt(tasks.dueDate, today),
      lte(tasks.dueDate, nextWorkDay(today)),
    );
    return this.send(today, due, 'due_soon', async (task) =>
      this.notices.notice(task, 'task_due_soon', [task.assigneeId], null, dueOf(task)),
    );
  }

  /** Rule 10: open tasks due before `today`, to the assignee or the department's managers. */
  private async overdue(today: CalendarDate): Promise<number> {
    const late = await this.open(lt(tasks.dueDate, today));
    return this.send(today, late, 'overdue', async (task) =>
      this.notices.notice(
        task,
        'task_overdue',
        await this.notices.assigneeOrManagers(this.db, task),
        null,
        dueOf(task),
      ),
    );
  }

  /**
   * Rule 11: assigned tasks still overdue whose overdue reminder for the current due date went
   * out on an earlier work day, to the department's managers.
   */
  private async escalate(today: CalendarDate): Promise<number> {
    const late = await this.open(isNotNull(tasks.assigneeId), lt(tasks.dueDate, today));
    const sent = await this.reminders.sentOn(
      'overdue',
      late.map((task) => ({ subjectId: task.id, occurrence: task.dueDate })),
    );
    const due = late.filter((task) => {
      const sentOn = sent.get(task.id);
      return !!sentOn && sentOn < today;
    });
    const people = await this.users.summaries(due.flatMap((task) => task.assigneeId ?? []));
    return this.send(today, due, 'overdue_escalated', async (task) =>
      this.notices.notice(
        task,
        'task_overdue_escalated',
        await this.notices.managers(this.db, task.department),
        null,
        {
          ...dueOf(task),
          assignee: (task.assigneeId && people.get(task.assigneeId)?.name) || null,
        },
      ),
    );
  }

  /** Open tasks shown in views (not archived, nor under archived work) matching `filters`. */
  private async open(...filters: Parameters<typeof and>): Promise<NoticeTask[]> {
    const rows = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(inArray(tasks.status, [...OPEN_TASK_STATUSES]), this.tasks.visibleSql(), ...filters),
      );
    return this.notices.loadMany(
      this.db,
      rows.map((row) => row.id),
    );
  }

  /** One transaction per reminder: recorded first, sent only if this run recorded it (rule 8). */
  private async send(
    today: CalendarDate,
    due: NoticeTask[],
    kind: NotificationReminderKind,
    build: (task: NoticeTask) => Promise<Notice>,
  ): Promise<number> {
    let sent = 0;
    for (const task of due) {
      const notice = await build(task);
      const key = { kind, subjectId: task.id, occurrence: task.dueDate };
      const recorded = await this.db.transaction((tx) =>
        this.reminders.remindOnce(tx, key, today, notice),
      );
      if (recorded) sent += 1;
    }
    return sent;
  }
}

const dueOf = (task: NoticeTask) => ({ dueDate: task.dueDate, dueTime: toTimeOfDay(task.dueTime) });
