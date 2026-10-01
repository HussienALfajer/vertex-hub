import { businessDate, businessTimeOfDay, OPEN_TASK_STATUSES } from '@vertex-hub/contracts';
import { taskReviews, taskRevisions, tasks } from '@vertex-hub/db';
import { type SQL, sql } from 'drizzle-orm';

/*
 * SQL over a row of `tasks` for the computed flags (spec F06, rules 10 and 12), shared by the list
 * and the views.
 */

/** Open: any status except delivered and cancelled. */
export const openSql = sql`${tasks.status} in (${sql.join(
  OPEN_TASK_STATUSES.map((status) => sql`${status}`),
  sql`, `,
)})`;

/** Open and past its due date and time (rule 12). */
export function overdueSql(now: Date): SQL {
  const today = businessDate(now);
  return sql`(${openSql} and (${tasks.dueDate} < ${today}
    or (${tasks.dueTime} is not null and ${tasks.dueDate} = ${today}
      and ${tasks.dueTime} < ${businessTimeOfDay(now)})))`;
}

/** A client revision over the limit waits for a decision (rule 10). */
export const overLimitPendingSql = sql<boolean>`exists (
  select 1 from ${taskRevisions} as r
  where r.task_id = "tasks"."id" and r.over_limit and r.decision is null)`;

/** The pass that cleared the task for the client is a medical one (F09 rule 8). */
export const clearedByMedicalSql = sql<boolean>`exists (
  select 1 from ${taskReviews} as p
  where p.id = "tasks"."cleared_review_id" and p.stage = 'medical')`;
