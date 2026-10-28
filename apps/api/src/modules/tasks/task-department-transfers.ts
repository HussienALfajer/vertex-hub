import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DepartmentCode } from '@vertex-hub/contracts';
import { type Transaction, taskComments, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { DepartmentTransfers, type TransferPreview } from '../auth/index.js';
import { openSql } from './task-sql.js';

const PREVIEW_ITEMS = 5;

/** Open, not archived tasks of the department, assigned or in its queue (F23 rule 8). */
const openTasksOf = (code: DepartmentCode) =>
  and(eq(tasks.department, code), openSql, isNull(tasks.archivedAt)) as SQL;

/** Open questions addressed to the department, forwarded or not (F23 rule 8). */
const openQuestionsOf = (code: DepartmentCode) =>
  and(
    eq(taskComments.addressedDepartment, code),
    eq(taskComments.questionStatus, 'open'),
    isNull(taskComments.archivedAt),
  ) as SQL;

/**
 * F23 rule 10: an archived department's open tasks and open questions move to their targets.
 * Tasks keep their assignee, status, dates and history (a queued task lands in the target's
 * queue); a forwarded question keeps the member it was forwarded to. Closed ones stay (rule 11).
 */
@Injectable()
export class TaskDepartmentTransfers implements OnModuleInit {
  constructor(private readonly transfers: DepartmentTransfers) {}

  onModuleInit(): void {
    this.transfers.register({
      category: 'tasks',
      preview: (tx, code) => this.previewTasks(tx, code),
      move: (tx, from, to, actor) => this.moveTasks(tx, from, to, actor),
    });
    this.transfers.register({
      category: 'questions',
      preview: (tx, code) => this.previewQuestions(tx, code),
      move: (tx, from, to, actor) => this.moveQuestions(tx, from, to, actor),
    });
  }

  private async previewTasks(tx: Transaction, code: DepartmentCode): Promise<TransferPreview> {
    const [total] = await tx.select({ value: count() }).from(tasks).where(openTasksOf(code));
    const items = await tx
      .select({ id: tasks.id, name: tasks.title })
      .from(tasks)
      .where(openTasksOf(code))
      .orderBy(asc(tasks.dueDate), asc(tasks.title), asc(tasks.id))
      .limit(PREVIEW_ITEMS);
    return { count: total?.value ?? 0, items };
  }

  private async moveTasks(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    const moved = await tx
      .update(tasks)
      .set({ department: to })
      .where(openTasksOf(from))
      .returning({ id: tasks.id });
    for (const task of moved) {
      await recordAudit(tx, {
        actor,
        action: 'task.updated',
        entityType: 'task',
        entityId: task.id,
        before: { department: from },
        after: { department: to, reason: 'department_archived' },
      });
    }
    return moved.length;
  }

  private async previewQuestions(tx: Transaction, code: DepartmentCode): Promise<TransferPreview> {
    const [total] = await tx
      .select({ value: count() })
      .from(taskComments)
      .where(openQuestionsOf(code));
    const items = await tx
      .select({ id: taskComments.id, name: tasks.title })
      .from(taskComments)
      .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
      .where(openQuestionsOf(code))
      .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
      .limit(PREVIEW_ITEMS);
    return { count: total?.value ?? 0, items };
  }

  private async moveQuestions(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    const moved = await tx
      .update(taskComments)
      .set({ addressedDepartment: to })
      .where(openQuestionsOf(from))
      .returning({ id: taskComments.id, taskId: taskComments.taskId });
    for (const question of moved) {
      await recordAudit(tx, {
        actor,
        action: 'task_comment.updated',
        entityType: 'task_comment',
        entityId: question.id,
        before: { addressedDepartment: from },
        after: { taskId: question.taskId, addressedDepartment: to, reason: 'department_archived' },
      });
    }
    return moved.length;
  }
}
