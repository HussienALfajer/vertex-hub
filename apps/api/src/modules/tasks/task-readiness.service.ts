import { Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  DEFAULT_ESTIMATE_MINUTES,
  draftWarnings,
  isWorkDay,
  nextWorkDay,
  READINESS_WARNINGS,
  type ReadinessWarning,
  type TaskReadiness,
  type TaskReadinessInput,
  weekOf,
} from '@vertex-hub/contracts';
import { type Database, tasks } from '@vertex-hub/db';
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { HolidayCalendar, LeaveDirectory, WorkCapacity } from '../hr/index.js';
import { openSql } from './task-sql.js';
import { TasksService } from './tasks.service.js';

/** A task of the draft: the task itself (`index` null) or one of its subtasks. */
type Item = TaskReadinessInput['subtasks'][number] & { index: number | null };

/**
 * The readiness check (spec F06B rule C5): warnings for a draft and each of its subtasks before
 * it is saved, assigned or re-dated. Warnings never block (v2-scope); only the leave one is
 * confirmed on save (`acceptLeave`, F17 rule B17).
 */
@Injectable()
export class TaskReadinessService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly holidays: HolidayCalendar,
    private readonly leave: LeaveDirectory,
    private readonly capacity: WorkCapacity,
  ) {}

  async check(input: TaskReadinessInput): Promise<TaskReadiness> {
    const items: Item[] = [
      { ...input, index: null },
      ...input.subtasks.map((subtask, index) => ({ ...subtask, index })),
    ];
    const today = businessDate();
    const earliest = items.reduce((min, item) => (item.dueDate < min ? item.dueDate : min), today);
    const holidays = await this.holidays.from(earliest);
    const warnings: ReadinessWarning[] = [];
    for (const item of items) {
      if (!item.assigneeId) continue;
      const leaves = await this.leave.covering(this.db, item.assigneeId, item.dueDate);
      if (leaves.length > 0) {
        warnings.push({ subtaskIndex: item.index, code: 'assignee_on_leave', leaves });
      }
    }
    warnings.push(...(await this.overloaded(items, input.taskId, today)));
    for (const item of items) {
      if (!isWorkDay(item.dueDate, holidays)) {
        warnings.push({
          subtaskIndex: item.index,
          code: 'due_on_day_off',
          suggestedDate: nextWorkDay(item.dueDate, holidays),
        });
      }
    }
    warnings.push(...draftWarnings(input));
    // The task first, then each subtask, each in the order of the codes; `no_criteria` last.
    const rank = (warning: ReadinessWarning) =>
      warning.code === 'no_criteria'
        ? Number.MAX_SAFE_INTEGER
        : ((warning.subtaskIndex ?? -1) + 1) * READINESS_WARNINGS.length +
          READINESS_WARNINGS.indexOf(warning.code);
    return { warnings: warnings.sort((a, b) => rank(a) - rank(b)) };
  }

  /**
   * Rule C5, "assignee overloaded": in the week of the due date (Saturday to Friday), the
   * assignee's estimated minutes of open tasks due that week, plus the draft's own for them,
   * exceed the work minutes of their schedule left from today (or the week's start) to its end.
   * Tasks without an estimate count `DEFAULT_ESTIMATE_MINUTES`; a person without an employee file
   * is not warned (edge case 21).
   */
  private async overloaded(
    items: Item[],
    taskId: string | undefined,
    today: CalendarDate,
  ): Promise<ReadinessWarning[]> {
    const groups = new Map<
      string,
      { userId: string; week: { from: string; to: string }; items: Item[] }
    >();
    for (const item of items) {
      const week = weekOf(item.dueDate);
      if (!item.assigneeId || week.to < today) continue;
      const key = `${item.assigneeId}:${week.from}`;
      const group = groups.get(key) ?? { userId: item.assigneeId, week, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    const warnings: ReadinessWarning[] = [];
    for (const { userId, week, items: group } of groups.values()) {
      const from = week.from > today ? week.from : today;
      const capacity = (await this.capacity.minutes([userId], from, week.to)).get(userId);
      if (capacity === null || capacity === undefined) continue;
      const [row] = await this.db
        .select({
          minutes:
            sql<number>`coalesce(sum(coalesce(${tasks.estimateMinutes}, ${DEFAULT_ESTIMATE_MINUTES})), 0)`.mapWith(
              Number,
            ),
        })
        .from(tasks)
        .where(
          and(
            this.tasks.visibleSql(),
            openSql,
            eq(tasks.assigneeId, userId),
            gte(tasks.dueDate, week.from),
            lte(tasks.dueDate, week.to),
            taskId ? ne(tasks.id, taskId) : undefined,
          ),
        );
      const estimated =
        (row?.minutes ?? 0) +
        group.reduce((sum, item) => sum + (item.estimateMinutes ?? DEFAULT_ESTIMATE_MINUTES), 0);
      if (estimated <= capacity) continue;
      for (const item of group) {
        warnings.push({
          subtaskIndex: item.index,
          code: 'assignee_overloaded',
          estimatedMinutes: estimated,
          capacityMinutes: capacity,
        });
      }
    }
    return warnings;
  }
}
