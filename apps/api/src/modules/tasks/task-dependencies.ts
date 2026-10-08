import {
  createsDependencyCycle,
  isTaskBlocked,
  isTaskFinished,
  TASK_LIMITS,
  type TaskDependency,
  type TaskStatus,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskDependencies, tasks } from '@vertex-hub/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';

type Executor = Database | Transaction;

/*
 * Dependencies between tasks (spec F06, rules 3 and 4). Blocked is computed, never stored.
 */

/**
 * Serializes changes to existing dependency edges and to the client of a linked task, so two
 * concurrent edits cannot each pass the cycle check and together close a cycle (rule 4). Taken
 * before any task row lock (and after `lockAccessChanges`). A new task needs no lock: nothing
 * can depend on it before it commits.
 */
export async function lockDependencyGraph(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${7_140_016})`);
}

/**
 * SQL over a row of `tasks`: it is open and waits on a live dependency that is not finished
 * (rule 3). A delivered or cancelled task waits on nothing, whatever its dependencies.
 */
export const blockedSql = sql<boolean>`("tasks"."status" not in ('delivered', 'cancelled') and exists (
  select 1 from ${taskDependencies} as d
  inner join ${tasks} as dependency on dependency.id = d.depends_on_id
  where d.task_id = "tasks"."id"
    and dependency.archived_at is null
    and dependency.status not in ('approved', 'delivered', 'cancelled')))`;

/** The ids among `taskIds` that are blocked. */
export async function blockedIds(taskIds: string[], executor: Executor): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const rows = await executor
    .selectDistinct({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), blockedSql));
  return new Set(rows.map((row) => row.id));
}

const dependencyColumns = {
  id: tasks.id,
  title: tasks.title,
  department: tasks.department,
  status: tasks.status,
  archivedAt: tasks.archivedAt,
};

type DependencyRow = {
  id: string;
  title: string;
  department: TaskDependency['department'];
  status: TaskStatus;
  archivedAt: Date | null;
};

const toDependency = (row: DependencyRow): TaskDependency => ({
  id: row.id,
  title: row.title,
  department: row.department,
  status: row.status,
  finished: isTaskFinished(row.status),
  archived: !!row.archivedAt,
});

/** The tasks `taskId` waits on, by title. */
export async function dependenciesOf(taskId: string, executor: Executor) {
  const rows = await executor
    .select(dependencyColumns)
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
    .where(eq(taskDependencies.taskId, taskId))
    .orderBy(tasks.title);
  return rows.map(toDependency);
}

/** The tasks waiting on `taskId`, by title. */
export async function dependentsOf(taskId: string, executor: Executor) {
  const rows = await executor
    .select(dependencyColumns)
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(eq(taskDependencies.dependsOnId, taskId))
    .orderBy(tasks.title);
  return rows.map(toDependency);
}

/** Whether the task is blocked now (rule 3). */
export async function isBlocked(taskId: string, executor: Executor): Promise<boolean> {
  const dependencies = await dependenciesOf(taskId, executor);
  return isTaskBlocked(dependencies.map((d) => ({ status: d.status, archived: d.archived })));
}

/**
 * Rule 4: at most 10, and no cycle. Each dependency in `added` (all of them by default) must be a
 * non-archived task of the same client, or both without one; kept dependencies stay even if they
 * were archived since (edge case 3). `task.id` is null for a task being created, which cannot
 * close a cycle. Returns the added dependencies.
 */
export async function assertValidDependencies(
  tx: Transaction,
  task: { id: string | null; clientId: string | null },
  dependsOn: string[],
  added: string[] = dependsOn,
): Promise<{ id: string; title: string }[]> {
  if (dependsOn.length > TASK_LIMITS.dependencies) {
    throw new CodedException(409, 'LIMIT_REACHED', 'A task waits on at most 10 tasks');
  }
  if (task.id && dependsOn.includes(task.id)) {
    throw new CodedException(409, 'DEPENDENCY_CYCLE', 'A task cannot wait on itself');
  }
  const rows =
    added.length === 0
      ? []
      : await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            clientId: tasks.clientId,
            archivedAt: tasks.archivedAt,
          })
          .from(tasks)
          .where(inArray(tasks.id, added));
  const valid = rows.filter((row) => !row.archivedAt && row.clientId === task.clientId);
  if (valid.length !== added.length) {
    throw new CodedException(
      400,
      'INVALID_DEPENDENCY',
      'A dependency must be a non-archived task of the same client',
    );
  }
  if (
    task.id &&
    dependsOn.length > 0 &&
    createsDependencyCycle(task.id, dependsOn, await reachableEdges(tx, dependsOn))
  ) {
    throw new CodedException(409, 'DEPENDENCY_CYCLE', 'The dependencies would form a cycle');
  }
  return valid.map((row) => ({ id: row.id, title: row.title }));
}

/**
 * Rule 4 when a task changes client: the tasks it waits on and the tasks waiting on it must all
 * be of the new client (or all without one).
 */
export async function assertSameClientLinks(
  tx: Transaction,
  taskId: string,
  clientId: string | null,
): Promise<void> {
  const linked = await tx
    .select({ clientId: tasks.clientId })
    .from(taskDependencies)
    .innerJoin(
      tasks,
      sql`${tasks.id} = case when ${taskDependencies.taskId} = ${taskId}
        then ${taskDependencies.dependsOnId} else ${taskDependencies.taskId} end`,
    )
    .where(
      sql`(${taskDependencies.taskId} = ${taskId} or ${taskDependencies.dependsOnId} = ${taskId})`,
    );
  if (linked.some((row) => row.clientId !== clientId)) {
    throw new CodedException(
      400,
      'INVALID_DEPENDENCY',
      'Remove the dependencies on tasks of other clients before changing the client',
    );
  }
}

/** Every dependency edge reachable from `from`, as task → the tasks it waits on. */
async function reachableEdges(tx: Transaction, from: string[]) {
  const result = await tx.execute<{ task_id: string; depends_on_id: string }>(sql`
    with recursive reach(task_id, depends_on_id) as (
      select task_id, depends_on_id from ${taskDependencies}
      where task_id in (${sql.join(
        from.map((id) => sql`${id}`),
        sql`, `,
      )})
      union
      select d.task_id, d.depends_on_id from ${taskDependencies} as d
      inner join reach on d.task_id = reach.depends_on_id
    )
    select task_id, depends_on_id from reach`);
  const edges = new Map<string, string[]>();
  for (const row of result.rows) {
    edges.set(row.task_id, [...(edges.get(row.task_id) ?? []), row.depends_on_id]);
  }
  return edges;
}
