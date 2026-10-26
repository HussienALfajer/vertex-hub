import type { DepartmentCode, QuestionStatus } from '@vertex-hub/contracts';
import { type Transaction, taskComments } from '@vertex-hub/db';
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { managesDepartment } from './task-access.js';

/*
 * Questions of a task's thread (spec F06B part B, ADR 0041): comments of kind `question` with an
 * addressee, a status and replies linked by `question_id`.
 */

export type CommentRow = typeof taskComments.$inferSelect;

/** The open, live questions. */
export const openQuestionSql = and(
  eq(taskComments.kind, 'question'),
  eq(taskComments.questionStatus, 'open'),
  isNull(taskComments.archivedAt),
) as SQL;

/**
 * Rule B4: the addressee of a question, as the actor stands to it: the person asked, the member a
 * department question was forwarded to, or a manager of the addressed department.
 */
export const isAddressee = (actor: CurrentUserInfo, question: CommentRow): boolean =>
  (!!question.addressedUserId && question.addressedUserId === actor.id) ||
  (!!question.addressedDepartment && managesDepartment(actor, question.addressedDepartment));

/** Rule B5: a manager of the department a question is addressed to forwards it. */
export const mayForward = (actor: CurrentUserInfo, question: CommentRow): boolean =>
  !!question.addressedDepartment && managesDepartment(actor, question.addressedDepartment);

/**
 * Rule B7: live questions in `status` waiting for the actor's answer: addressed to them, or to a
 * department they manage and not forwarded to someone else.
 */
export function waitingQuestionsSql(actor: CurrentUserInfo, status: QuestionStatus = 'open'): SQL {
  const managed: DepartmentCode[] = actor.access.departments
    .filter((department) => department.isManager)
    .map((department) => department.code);
  const department =
    managed.length > 0
      ? sql` or (${taskComments.addressedUserId} is null and ${inArray(taskComments.addressedDepartment, managed)})`
      : sql``;
  return sql`(${taskComments.kind} = 'question' and ${taskComments.questionStatus} = ${status}
    and ${taskComments.archivedAt} is null
    and (${taskComments.addressedUserId} = ${actor.id}${department}))`;
}

/**
 * Rule B10: a task back from delivered, cancelled or the archive restarts the clock of its open
 * questions, so reminders count from now (a new `timed_reminders` key each).
 */
export async function restartQuestionClocks(
  tx: Transaction,
  taskIds: readonly string[],
  now: Date,
): Promise<void> {
  if (taskIds.length === 0) return;
  await tx
    .update(taskComments)
    .set({ clockStartedAt: now })
    .where(and(inArray(taskComments.taskId, [...taskIds]), openQuestionSql));
}
