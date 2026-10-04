import { Inject, Injectable } from '@nestjs/common';
import {
  BOARD_LIMITS,
  BOARD_STATUSES,
  businessDate,
  DEPARTMENT_CODES,
  type DepartmentCode,
  hasPermission,
  type MyTaskSummary,
  permissionScopes,
  type TaskBoard,
  type TaskBoardQuery,
  type TaskWorkload,
  type TaskWorkloadQuery,
  weekOf,
} from '@vertex-hub/contracts';
import { type Database, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, gte, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { accessColumns } from './task-access.js';
import { blockedSql } from './task-dependencies.js';
import { TaskReports } from './task-reports.js';
import { openSql, overdueSql } from './task-sql.js';
import { TasksService } from './tasks.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `count(*)` of the rows matching `condition`. */
const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/**
 * The board, the workload and the My tasks counts (spec F06, "Screens" 1, 3 and 4). Archived and
 * read-only tasks are left out, like in the list.
 */
@Injectable()
export class TaskViewsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly tasks: TasksService,
    private readonly reports: TaskReports,
  ) {}

  /** Columns by status; `delivered` holds the last 14 days, `cancelled` is not shown. */
  async board(actor: CurrentUserInfo, query: TaskBoardQuery): Promise<TaskBoard> {
    const departments = query.department ?? defaultDepartments(actor);
    const now = new Date();
    const filters: (SQL | undefined)[] = [
      this.tasks.visibleSql(),
      inArray(tasks.department, departments),
    ];
    if (query.assigneeId) {
      filters.push(eq(tasks.assigneeId, query.assigneeId === 'me' ? actor.id : query.assigneeId));
    }
    if (query.clientId) filters.push(eq(tasks.clientId, query.clientId));
    const since = new Date(now.getTime() - BOARD_LIMITS.deliveredDays * DAY_MS);
    const columns = await Promise.all(
      BOARD_STATUSES.map(async (status) => {
        const where = and(
          ...filters,
          eq(tasks.status, status),
          status === 'delivered' ? gte(tasks.deliveredAt, since) : undefined,
        );
        const [rows, [total]] = await Promise.all([
          this.db
            .select(accessColumns)
            .from(tasks)
            .where(where)
            .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.id))
            .limit(BOARD_LIMITS.cards),
          this.db.select({ value: count() }).from(tasks).where(where),
        ]);
        return { status, rows, total: total?.value ?? 0 };
      }),
    );
    const items = await this.tasks.present(
      columns.flatMap((column) => column.rows),
      this.db,
      now,
    );
    const byId = new Map(items.map(({ readOnly: _, ...item }) => [item.id, item]));
    return {
      departments,
      columns: columns.map((column) => ({
        status: column.status,
        items: column.rows.flatMap((row) => byId.get(row.id) ?? []),
        total: column.total,
      })),
    };
  }

  /** Per person of the departments: overdue, due in the week and open; unassigned per department. */
  async workload(actor: CurrentUserInfo, query: TaskWorkloadQuery): Promise<TaskWorkload> {
    const departments = query.department ?? defaultDepartments(actor);
    const week = weekOf(query.week ?? businessDate());
    const now = new Date();
    const people = await this.users.activeMembers(departments);
    const ids = people.map((person) => person.id);
    const [byPerson, unassigned] = await Promise.all([
      this.reports.personCounts(ids, week, now),
      this.db
        .select({ department: tasks.department, count: count() })
        .from(tasks)
        .where(
          and(
            this.tasks.visibleSql(),
            openSql,
            isNull(tasks.assigneeId),
            inArray(tasks.department, departments),
          ),
        )
        .groupBy(tasks.department),
    ]);
    const byDepartment = new Map(unassigned.map((row) => [row.department, row.count]));
    return {
      week,
      departments,
      people: people.map((person) => {
        const row = byPerson.get(person.id);
        return {
          user: { id: person.id, name: person.name },
          departments: person.departments,
          overdue: row?.overdue ?? 0,
          dueThisWeek: row?.dueThisWeek ?? 0,
          open: row?.open ?? 0,
        };
      }),
      unassigned: departments.map((department) => ({
        department,
        count: byDepartment.get(department) ?? 0,
      })),
    };
  }

  /** Counts for the sections of My tasks. */
  async summary(actor: CurrentUserInfo): Promise<MyTaskSummary> {
    const now = new Date();
    const today = businessDate(now);
    const weekEnd = weekOf(today).to;
    const overdue = overdueSql(now);
    const managed = actor.access.departments.filter((d) => d.isManager).map((d) => d.code);
    const clientScope = this.tasks.clientScopeSql(actor);
    const [[mine], [others], [unassigned], [medical], [ready]] = await Promise.all([
      this.db
        .select({
          overdue: countWhere(and(eq(tasks.assigneeId, actor.id), overdue) as SQL),
          today: countWhere(
            sql`${tasks.assigneeId} = ${actor.id} and ${tasks.dueDate} = ${today} and not ${overdue}`,
          ),
          thisWeek: countWhere(
            sql`${tasks.assigneeId} = ${actor.id} and ${tasks.dueDate} > ${today} and ${tasks.dueDate} <= ${weekEnd}`,
          ),
          later: countWhere(
            sql`${tasks.assigneeId} = ${actor.id} and ${tasks.dueDate} > ${weekEnd}`,
          ),
          waiting: countWhere(
            sql`${tasks.assigneeId} = ${actor.id} and (${blockedSql} or ${tasks.status} = 'awaiting_client')`,
          ),
          requestedByMe: countWhere(
            and(
              eq(tasks.createdById, actor.id),
              or(isNull(tasks.assigneeId), ne(tasks.assigneeId, actor.id)),
            ) as SQL,
          ),
        })
        .from(tasks)
        .where(and(this.tasks.visibleSql(), openSql)),
      this.db
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            this.tasks.visibleSql(),
            eq(tasks.status, 'internal_review'),
            this.tasks.manageScopeSql(actor),
          ),
        ),
      managed.length === 0
        ? [null]
        : this.db
            .select({ value: count() })
            .from(tasks)
            .where(
              and(
                this.tasks.visibleSql(),
                openSql,
                isNull(tasks.assigneeId),
                inArray(tasks.department, managed),
              ),
            ),
      // F09: the medical queue, without the caller's own tasks (they cannot review them).
      hasPermission(actor.access, 'approvals.review_medical')
        ? this.db
            .select({ value: count() })
            .from(tasks)
            .where(
              and(
                this.tasks.visibleSql(),
                eq(tasks.reviewStage, 'medical'),
                or(isNull(tasks.assigneeId), ne(tasks.assigneeId, actor.id)),
              ),
            )
        : [null],
      clientScope
        ? this.db
            .select({ value: count() })
            .from(tasks)
            .where(and(this.tasks.visibleSql(), this.tasks.readyToSendSql(), clientScope))
        : [null],
    ]);
    return {
      overdue: mine?.overdue ?? 0,
      today: mine?.today ?? 0,
      thisWeek: mine?.thisWeek ?? 0,
      later: mine?.later ?? 0,
      waiting: mine?.waiting ?? 0,
      toReview: others?.value ?? 0,
      medicalReview: medical ? medical.value : null,
      readyToSend: ready ? ready.value : null,
      requestedByMe: mine?.requestedByMe ?? 0,
      unassignedInMyDepartments: unassigned ? unassigned.value : null,
    };
  }
}

/**
 * The departments the actor manages; else all of them for those who oversee work across
 * departments (General Manager, Operations: scope all; account managers: their clients' work);
 * else their own departments, else all of them.
 */
function defaultDepartments(actor: CurrentUserInfo): DepartmentCode[] {
  const managed = actor.access.departments.filter((d) => d.isManager).map((d) => d.code);
  if (managed.length > 0) return managed;
  const scopes = permissionScopes(actor.access, 'tasks.manage');
  if (scopes.includes('all') || scopes.includes('own_clients')) return [...DEPARTMENT_CODES];
  const own = actor.access.departments.map((d) => d.code);
  return own.length > 0 ? own : [...DEPARTMENT_CODES];
}
