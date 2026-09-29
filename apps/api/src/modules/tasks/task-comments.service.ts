import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  commentExcerpt,
  mentionedUserIds,
  type PageQuery,
  type TaskComment,
  type TaskCommentInput,
  type TaskCommentPage,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskComments } from '@vertex-hub/db';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import {
  actorOf,
  assertTaskWritable,
  holdsAll,
  isReadOnly,
  readableTask,
  type TaskAccess,
} from './task-access.js';
import { TaskNotices } from './task-notices.js';

type CommentRow = typeof taskComments.$inferSelect;

/**
 * Comments on a task with @mentions (spec F06, rule 16): every active user comments on a
 * writable task; the author edits, the author or a scope-all holder removes.
 */
@Injectable()
export class TaskCommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly notices: TaskNotices,
  ) {}

  /** Oldest first; removed comments stay in place without their body. */
  async list(actor: CurrentUserInfo, taskId: string, query: PageQuery): Promise<TaskCommentPage> {
    const task = await this.task(this.db, actor, taskId);
    const where = eq(taskComments.taskId, taskId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(taskComments)
        .where(where)
        .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(taskComments).where(where),
    ]);
    return {
      items: await this.present(actor, task, rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    actor: CurrentUserInfo,
    taskId: string,
    input: TaskCommentInput,
  ): Promise<TaskComment> {
    const row = await this.db.transaction(async (tx) => {
      const task = await this.task(tx, actor, taskId);
      assertTaskWritable(task);
      const mentions = mentionedUserIds(input.body);
      await this.assertMentions(tx, mentions);
      const [created] = await tx
        .insert(taskComments)
        .values({ taskId, authorId: actor.id, body: input.body, mentionedUserIds: mentions })
        .returning();
      if (!created) throw new Error('Comment insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.created',
        entityType: 'task_comment',
        entityId: created.id,
        after: { taskId, body: input.body, mentionedUserIds: mentions },
      });
      // A mentioned assignee gets the mention only, unless they muted it (F14 rule 2).
      const excerpt = await this.excerpt(tx, input.body);
      await this.notices.send(tx, [
        this.notices.notice(task, 'task_mentioned', mentions, actor.id, { excerpt }),
        this.notices.notice(task, 'task_commented', [task.assigneeId], actor.id, { excerpt }),
      ]);
      return { task, created };
    });
    return this.one(actor, row.task, row.created);
  }

  /** The author edits their comment; mentions already in it may name users archived since. */
  async update(
    actor: CurrentUserInfo,
    taskId: string,
    commentId: string,
    input: TaskCommentInput,
  ): Promise<TaskComment> {
    const row = await this.db.transaction(async (tx) => {
      const task = await this.task(tx, actor, taskId);
      const comment = await this.liveComment(tx, taskId, commentId);
      if (comment.authorId !== actor.id) {
        throw new CodedException(403, 'NOT_COMMENT_AUTHOR', 'Only the author edits a comment');
      }
      assertTaskWritable(task);
      if (comment.body === input.body) return { task, comment };
      const mentions = mentionedUserIds(input.body);
      await this.assertMentions(
        tx,
        mentions.filter((id) => !comment.mentionedUserIds.includes(id)),
      );
      const [updated] = await tx
        .update(taskComments)
        .set({ body: input.body, mentionedUserIds: mentions, editedAt: new Date() })
        .where(eq(taskComments.id, commentId))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.updated',
        entityType: 'task_comment',
        entityId: commentId,
        before: { body: comment.body, mentionedUserIds: comment.mentionedUserIds },
        after: { taskId, body: input.body, mentionedUserIds: mentions },
      });
      // Edge case 12: only mentions the edit adds notify.
      const added = mentions.filter((id) => !comment.mentionedUserIds.includes(id));
      if (added.length > 0) {
        const excerpt = await this.excerpt(tx, input.body);
        await this.notices.send(tx, [
          this.notices.notice(task, 'task_mentioned', added, actor.id, { excerpt }),
        ]);
      }
      return { task, comment: updated };
    });
    return this.one(actor, row.task, row.comment);
  }

  /** The author, or a holder of `tasks.manage` with scope all, removes a comment. */
  async archive(actor: CurrentUserInfo, taskId: string, commentId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const task = await this.task(tx, actor, taskId);
      const comment = await this.liveComment(tx, taskId, commentId);
      if (comment.authorId !== actor.id && !holdsAll(actor, 'tasks.manage')) {
        throw new CodedException(
          403,
          'NOT_COMMENT_AUTHOR',
          'Only the author or a manager of all tasks removes a comment',
        );
      }
      assertTaskWritable(task);
      await tx
        .update(taskComments)
        .set({ archivedAt: new Date() })
        .where(eq(taskComments.id, commentId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.archived',
        entityType: 'task_comment',
        entityId: commentId,
        before: { archived: false },
        after: { taskId, archived: true },
      });
    });
  }

  private task(executor: Database | Transaction, actor: CurrentUserInfo, taskId: string) {
    return readableTask(
      executor,
      { clients: this.clients, engagements: this.engagements },
      actor,
      taskId,
    );
  }

  private async liveComment(tx: Transaction, taskId: string, commentId: string) {
    const [comment] = await tx
      .select()
      .from(taskComments)
      .where(
        and(
          eq(taskComments.id, commentId),
          eq(taskComments.taskId, taskId),
          isNull(taskComments.archivedAt),
        ),
      )
      .for('update');
    if (!comment) throw new NotFoundException();
    return comment;
  }

  /** Rule 16: mentioned users exist and are not archived. */
  private async assertMentions(tx: Transaction, ids: string[]) {
    if (ids.length === 0) return;
    const people = await this.users.summaries(ids, tx);
    if (ids.some((id) => !people.get(id) || people.get(id)?.archived)) {
      throw new CodedException(
        400,
        'INVALID_MENTION',
        'Only active users can be mentioned',
        ids.filter((id) => !people.get(id) || people.get(id)?.archived),
      );
    }
  }

  /** The comment as a notification shows it, mentions by their current names. */
  private async excerpt(tx: Transaction, body: string): Promise<string> {
    const people = await this.users.summaries(mentionedUserIds(body), tx);
    return commentExcerpt(body, (id) => people.get(id)?.name ?? '');
  }

  private async one(actor: CurrentUserInfo, task: TaskAccess, row: CommentRow) {
    const [comment] = await this.present(actor, task, [row]);
    if (!comment) throw new NotFoundException();
    return comment;
  }

  private async present(
    actor: CurrentUserInfo,
    task: TaskAccess,
    rows: CommentRow[],
  ): Promise<TaskComment[]> {
    const people = await this.users.summaries(
      rows.flatMap((row) => [row.authorId, ...(row.archivedAt ? [] : row.mentionedUserIds)]),
    );
    const person = (id: string) => people.get(id) ?? { id, name: '', archived: false };
    const writable = !isReadOnly(task);
    const removesAny = holdsAll(actor, 'tasks.manage');
    return rows.map((row) => {
      const removed = !!row.archivedAt;
      const own = row.authorId === actor.id;
      return {
        id: row.id,
        author: person(row.authorId),
        body: removed ? null : row.body,
        mentions: removed ? [] : row.mentionedUserIds.map(person),
        editedAt: row.editedAt?.toISOString() ?? null,
        removed,
        createdAt: row.createdAt.toISOString(),
        canEdit: writable && !removed && own,
        canRemove: writable && !removed && (own || removesAny),
      };
    });
  }
}
