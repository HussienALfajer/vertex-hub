import { Inject, Injectable } from '@nestjs/common';
import {
  averageOf,
  businessDate,
  DASHBOARD_LIMITS,
  type DepartmentCode,
  type DepartmentDashboard,
  deliveredOnTime,
  OPEN_TASK_STATUSES,
  onTimeRate,
  type ProductivityMeasures,
  type ReportPeriod,
  weekOf,
} from '@vertex-hub/contracts';
import { type Database, taskRevisions, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, min, type SQL, sql } from 'drizzle-orm';
import { inBusinessPeriod } from '../../core/database/business-date.js';
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

/** F15 rules 9 and 10 for the departments asked for, and per current assignee within each. */
export interface TaskProductivity {
  departments: Map<
    DepartmentCode,
    { measures: ProductivityMeasures; unassigned: { count: number; oldestOn: string | null } }
  >;
  /** By department, then by assignee: only people with a counted task. */
  people: Map<DepartmentCode, Map<string, ProductivityMeasures>>;
}

/** A delivered task of a client (F15 rule 18.4). */
export interface DeliveredTask {
  id: string;
  title: string;
  department: DepartmentCode;
  deliveredOn: string;
}

/** The sums behind `ProductivityMeasures`, added task by task. */
class MeasureSums {
  created = 0;
  delivered = 0;
  onTime = 0;
  clientRevisions = 0;
  internalRevisions = 0;
  cycleDays = 0;
  openNow = 0;
  overdueNow = 0;

  measures(): ProductivityMeasures {
    return {
      new: this.created,
      delivered: this.delivered,
      onTimeRate: onTimeRate(this.onTime, this.delivered),
      averageClientRevisions: averageOf(this.clientRevisions, this.delivered),
      averageInternalRevisions: averageOf(this.internalRevisions, this.delivered),
      averageCycleDays: averageOf(this.cycleDays, this.delivered),
      openNow: this.openNow,
      overdueNow: this.overdueNow,
    };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

  /**
   * F15 rules 9 and 10: per department and per current assignee, tasks created and delivered in
   * the period (on time, revisions, cycle time) and those open and overdue now. A task reopened
   * after delivery is not delivered (edge case 4).
   */
  async productivity(
    departments: readonly DepartmentCode[],
    period: ReportPeriod,
    now: Date = new Date(),
  ): Promise<TaskProductivity> {
    const result: TaskProductivity = { departments: new Map(), people: new Map() };
    if (departments.length === 0) return result;
    const ofDepartments = and(this.tasks.visibleSql(), inArray(tasks.department, [...departments]));
    const totals = new Map(departments.map((code) => [code, new MeasureSums()]));
    const people = new Map(departments.map((code) => [code, new Map<string, MeasureSums>()]));
    /** The department's sums, and the assignee's within it when the task has one. */
    const sumsOf = (code: DepartmentCode, assigneeId: string | null): MeasureSums[] => {
      const total = totals.get(code);
      const byPerson = people.get(code);
      if (!total || !byPerson) return [];
      if (!assigneeId) return [total];
      const person = byPerson.get(assigneeId) ?? new MeasureSums();
      byPerson.set(assigneeId, person);
      return [total, person];
    };
    const [created, delivered, open, unassigned] = await Promise.all([
      this.db
        .select({ department: tasks.department, assigneeId: tasks.assigneeId, value: count() })
        .from(tasks)
        .where(and(ofDepartments, inBusinessPeriod(tasks.createdAt, period)))
        .groupBy(tasks.department, tasks.assigneeId),
      this.db
        .select({
          id: tasks.id,
          department: tasks.department,
          assigneeId: tasks.assigneeId,
          dueDate: tasks.dueDate,
          dueTime: tasks.dueTime,
          createdAt: tasks.createdAt,
          startedAt: tasks.startedAt,
          deliveredAt: tasks.deliveredAt,
        })
        .from(tasks)
        .where(
          and(
            ofDepartments,
            eq(tasks.status, 'delivered'),
            inBusinessPeriod(tasks.deliveredAt, period),
          ),
        ),
      this.db
        .select({
          department: tasks.department,
          assigneeId: tasks.assigneeId,
          open: count(),
          overdue: countWhere(overdueSql(now)),
        })
        .from(tasks)
        .where(and(ofDepartments, openSql))
        .groupBy(tasks.department, tasks.assigneeId),
      this.db
        .select({ department: tasks.department, count: count(), oldest: min(tasks.createdAt) })
        .from(tasks)
        .where(and(ofDepartments, openSql, isNull(tasks.assigneeId)))
        .groupBy(tasks.department),
    ]);
    const revisions = await this.revisionCounts(delivered.map((task) => task.id));
    for (const row of created) {
      for (const sums of sumsOf(row.department, row.assigneeId)) sums.created += row.value;
    }
    for (const task of delivered) {
      if (!task.deliveredAt) continue;
      const start = task.startedAt ?? task.createdAt;
      const counted = revisions.get(task.id);
      for (const sums of sumsOf(task.department, task.assigneeId)) {
        sums.delivered += 1;
        if (deliveredOnTime(task.deliveredAt, task)) sums.onTime += 1;
        sums.clientRevisions += counted?.client ?? 0;
        sums.internalRevisions += counted?.internal ?? 0;
        sums.cycleDays += Math.max(0, task.deliveredAt.getTime() - start.getTime()) / DAY_MS;
      }
    }
    for (const row of open) {
      for (const sums of sumsOf(row.department, row.assigneeId)) {
        sums.openNow += row.open;
        sums.overdueNow += row.overdue;
      }
    }
    const waiting = new Map(unassigned.map((row) => [row.department, row]));
    for (const code of departments) {
      const row = waiting.get(code);
      result.departments.set(code, {
        measures: (totals.get(code) ?? new MeasureSums()).measures(),
        unassigned: {
          count: row?.count ?? 0,
          oldestOn: row?.oldest ? businessDate(row.oldest) : null,
        },
      });
      result.people.set(
        code,
        new Map([...(people.get(code) ?? [])].map(([id, sums]) => [id, sums.measures()])),
      );
    }
    return result;
  }

  /** F15 rule 18.4: the client's tasks delivered in the period, by delivery. */
  async deliveredForClient(clientId: string, period: ReportPeriod): Promise<DeliveredTask[]> {
    const rows = await this.db
      .select({
        id: tasks.id,
        title: tasks.title,
        department: tasks.department,
        deliveredAt: tasks.deliveredAt,
      })
      .from(tasks)
      .where(
        and(
          this.tasks.visibleSql(),
          eq(tasks.clientId, clientId),
          eq(tasks.status, 'delivered'),
          inBusinessPeriod(tasks.deliveredAt, period),
        ),
      )
      .orderBy(asc(tasks.deliveredAt), asc(tasks.id));
    return rows.flatMap((row) =>
      row.deliveredAt
        ? [
            {
              id: row.id,
              title: row.title,
              department: row.department,
              deliveredOn: businessDate(row.deliveredAt),
            },
          ]
        : [],
    );
  }

  /** Client and internal (`internal`, `medical`) revisions of each task. */
  private async revisionCounts(
    taskIds: string[],
  ): Promise<Map<string, { client: number; internal: number }>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        taskId: taskRevisions.taskId,
        client: countWhere(sql`${taskRevisions.source} = 'client'`),
        internal: countWhere(sql`${taskRevisions.source} <> 'client'`),
      })
      .from(taskRevisions)
      .where(inArray(taskRevisions.taskId, taskIds))
      .groupBy(taskRevisions.taskId);
    return new Map(rows.map(({ taskId, ...counts }) => [taskId, counts]));
  }
}
