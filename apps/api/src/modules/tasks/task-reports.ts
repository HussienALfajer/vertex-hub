import { Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  DASHBOARD_LIMITS,
  type DepartmentCode,
  type DepartmentDashboard,
  OPEN_TASK_STATUSES,
  weekOf,
} from '@vertex-hub/contracts';
import { type Database, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { UserDirectory } from '../auth/index.js';
import { accessColumns } from './task-access.js';
import { openSql, overdueSql } from './task-sql.js';
import { TasksService } from './tasks.service.js';

/** `count(*)` of the rows matching `condition`. */
const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** F06 workload counts of a department's open tasks. */
export interface DepartmentTaskCounts {
  open: number;
  dueThisWeek: number;
  overdue: number;
  unassigned: number;
}

type DepartmentTasks = Omit<DepartmentDashboard, 'departments' | 'department' | 'week'>;

/**
 * Read-only task figures for dashboards and reports (F15, ADR 0027), over the tasks the list shows
 * (archived ones and those of archived clients or engagements left out). Callers check the scope.
 */
@Injectable()
export class TaskReports {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly tasks: TasksService,
  ) {}

  /** Rule 1: open, due this week, overdue and unassigned open tasks per department. */
  async departmentCounts(
    departments: readonly DepartmentCode[],
    now: Date = new Date(),
  ): Promise<Map<DepartmentCode, DepartmentTaskCounts>> {
    if (departments.length === 0) return new Map();
    const week = weekOf(businessDate(now));
    const rows = await this.db
      .select({
        department: tasks.department,
        open: count(),
        dueThisWeek: countWhere(sql`${tasks.dueDate} between ${week.from} and ${week.to}`),
        overdue: countWhere(overdueSql(now)),
        unassigned: countWhere(isNull(tasks.assigneeId)),
      })
      .from(tasks)
      .where(and(this.tasks.visibleSql(), openSql, inArray(tasks.department, [...departments])))
      .groupBy(tasks.department);
    const byDepartment = new Map(rows.map(({ department, ...counts }) => [department, counts]));
    return new Map(
      departments.map((department) => [
        department,
        byDepartment.get(department) ?? { open: 0, dueThisWeek: 0, overdue: 0, unassigned: 0 },
      ]),
    );
  }

  /**
   * Rule 3: a department's open tasks by status, its oldest overdue tasks, its unassigned count,
   * and per non-archived member the F06 workload counts over all of their open tasks.
   */
  async department(department: DepartmentCode, now: Date = new Date()): Promise<DepartmentTasks> {
    const week = weekOf(businessDate(now));
    const ofDepartment = and(this.tasks.visibleSql(), openSql, eq(tasks.department, department));
    const overdue = and(ofDepartment, overdueSql(now));
    const people = await this.users.activeMembers([department]);
    const ids = people.map((person) => person.id);
    const [statuses, [overdueTotal], oldest, [unassigned], counts] = await Promise.all([
      this.db
        .select({ status: tasks.status, count: count() })
        .from(tasks)
        .where(ofDepartment)
        .groupBy(tasks.status),
      this.db.select({ value: count() }).from(tasks).where(overdue),
      this.db
        .select(accessColumns)
        .from(tasks)
        .where(overdue)
        .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.id))
        .limit(DASHBOARD_LIMITS.overdueTasks),
      this.db
        .select({ value: count() })
        .from(tasks)
        .where(and(ofDepartment, isNull(tasks.assigneeId))),
      this.personCounts(ids, week, now),
    ]);
    const byStatus = new Map(statuses.map((row) => [row.status, row.count]));
    const presented = await this.tasks.present(oldest, this.db, now);
    return {
      byStatus: OPEN_TASK_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })),
      overdue: {
        count: overdueTotal?.value ?? 0,
        oldest: presented.map(({ readOnly: _, ...task }) => task),
      },
      unassigned: unassigned?.value ?? 0,
      people: people.map((person) => {
        const row = counts.get(person.id);
        return {
          user: { id: person.id, name: person.name },
          overdue: row?.overdue ?? 0,
          dueThisWeek: row?.dueThisWeek ?? 0,
          open: row?.open ?? 0,
        };
      }),
    };
  }

  /** F06 Workload: each person's open, overdue and due-in-`week` tasks, in any department. */
  async personCounts(
    userIds: readonly string[],
    week: { from: string; to: string },
    now: Date,
  ): Promise<Map<string, { open: number; overdue: number; dueThisWeek: number }>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        assigneeId: tasks.assigneeId,
        open: count(),
        overdue: countWhere(overdueSql(now)),
        dueThisWeek: countWhere(sql`${tasks.dueDate} between ${week.from} and ${week.to}`),
      })
      .from(tasks)
      .where(and(this.tasks.visibleSql(), openSql, inArray(tasks.assigneeId, [...userIds])))
      .groupBy(tasks.assigneeId);
    return new Map(
      rows.flatMap(({ assigneeId, ...row }) => (assigneeId ? [[assigneeId, row]] : [])),
    );
  }
}
