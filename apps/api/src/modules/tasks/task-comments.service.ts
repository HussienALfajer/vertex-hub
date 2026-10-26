import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  commentExcerpt,
  type MyQuestionPage,
  type MyQuestionsQuery,
  mentionedUserIds,
  richTextFromPlain,
  richTextPlain,
  type TaskComment,
  type TaskCommentDoc,
  type TaskCommentInput,
  type TaskCommentListQuery,
  type TaskCommentPage,
  type TaskCommentUpdate,
  type TaskReply,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskComments, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory, type UserSummary } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { FileAttachments } from '../files/index.js';
import { EngagementDirectory } from '../projects/index.js';
import {
  actorOf,
  assertTaskWritable,
  holdsAll,
  isReadOnly,
  managesSubtasks,
  readableTask,
  type TaskAccess,
  taskRights,
} from './task-access.js';
import { TaskNotices } from './task-notices.js';
import { type CommentRow, isAddressee, mayForward, waitingQuestionsSql } from './task-questions.js';
import { TasksService } from './tasks.service.js';

type Executor = Database | Transaction;

/** The comment-to-be: its plain extract with `@{userId}` tokens and its mentions. */
export const bodyOf = (doc: TaskCommentDoc) => {
  const body = richTextPlain(doc);
  return { body, bodyDoc: doc, mentions: mentionedUserIds(body) };
};

/**
 * The thread of a task (spec F06, rule 16; F06B part B): comments, questions and replies as rich
 * text with mentions and attachments. Every active user comments on a writable task; the author
 * edits, the author or a scope-all holder removes. Questions' own actions are in
 * `TaskQuestionsService`, which presents through this service.
 */
@Injectable()
export class TaskCommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly notices: TaskNotices,
    private readonly attachments: FileAttachments,
    private readonly tasks: TasksService,
  ) {}

  /** Comments and questions oldest first, each question with its replies; removed ones stay in place. */
  async list(
    actor: CurrentUserInfo,
    taskId: string,
    query: TaskCommentListQuery,
  ): Promise<TaskCommentPage> {
    const task = await this.task(this.db, actor, taskId);
    const filters: (SQL | undefined)[] = [
      eq(taskComments.taskId, taskId),
      isNull(taskComments.questionId),
      query.kind ? eq(taskComments.kind, query.kind) : undefined,
      query.status ? eq(taskComments.questionStatus, query.status) : undefined,
    ];
    const where = and(...filters);
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
      items: await this.present(actor, new Map([[taskId, task]]), rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rule B7: the open (or answered) questions waiting for the actor's answer, oldest first. */
  async mine(actor: CurrentUserInfo, query: MyQuestionsQuery): Promise<MyQuestionPage> {
    const where = and(
      holdsAll(actor, 'tasks.read') ? undefined : sql`false`,
      waitingQuestionsSql(actor, query.status),
      this.tasks.visibleSql(),
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ comment: taskComments })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .where(where)
        .orderBy(asc(taskComments.clockStartedAt), asc(taskComments.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .where(where),
    ]);
    const comments = rows.map((row) => row.comment);
    const taskIds = [...new Set(comments.map((row) => row.taskId))];
    const access = new Map<string, TaskAccess>();
    for (const id of taskIds) access.set(id, await this.task(this.db, actor, id));
    const items = await this.present(actor, access, comments);
    return {
      items: items.map((item, index) => {
        const task = access.get((comments[index] as CommentRow).taskId) as TaskAccess;
        return { ...item, task: { id: task.id, title: task.title, status: task.status } };
      }),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** A comment, or a reply to a question of the task (rule B3), with its attachments. */
  async create(
    actor: CurrentUserInfo,
    taskId: string,
    input: TaskCommentInput,
  ): Promise<TaskComment> {
    const { task, created, preview } = await this.db.transaction(async (tx) => {
      const task = await this.task(tx, actor, taskId);
      assertTaskWritable(task);
      const question = input.questionId
        ? await this.liveQuestion(tx, taskId, input.questionId)
        : null;
      const { body, bodyDoc, mentions } = bodyOf(input.bodyDoc);
      await this.assertMentions(tx, mentions);
      const [created] = await tx
        .insert(taskComments)
        .values({
          taskId,
          authorId: actor.id,
          body,
          bodyDoc,
          mentionedUserIds: mentions,
          questionId: question?.id ?? null,
        })
        .returning();
      if (!created) throw new Error('Comment insert returned no row');
      const preview = await this.attachments.attach(
        tx,
        actor,
        { taskId, clientId: task.clientId, commentId: created.id },
        input.files.map((file) => file.uploadId),
      );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.created',
        entityType: 'task_comment',
        entityId: created.id,
        after: {
          taskId,
          body,
          mentionedUserIds: mentions,
          ...(question && { questionId: question.id }),
          ...(input.files.length > 0 && { attachments: input.files.length }),
        },
      });
      // A mentioned assignee gets the mention only, unless they muted it (F14 rule 2).
      const excerpt = await this.excerpt(tx, body);
      // F16 rule B12: followers hear of the comment; the commenter and those mentioned follow.
      const followers = await this.notices.followersOf(tx, taskId);
      await this.notices.send(
        tx,
        [
          this.notices.notice(task, 'task_mentioned', mentions, actor.id, { excerpt }),
          // Rule B3: the asker hears of a reply to their question.
          ...(question
            ? [
                this.notices.notice(task, 'task_question_answered', [question.authorId], actor.id, {
                  ...(await this.questionData(tx, question, excerpt)),
                  reply: true,
                }),
              ]
            : []),
          // The asker hears of the reply above, not of a comment (the first match would drop it).
          this.notices.notice(
            task,
            'task_commented',
            [task.assigneeId, ...followers].filter((id) => id !== question?.authorId),
            actor.id,
            { excerpt },
          ),
        ],
        // F16 part C: commenting answers the commenter's own mention.
        [
          {
            subject: { type: 'task', id: taskId },
            types: ['task_mentioned'],
            outcome: 'done',
            actorId: actor.id,
            recipients: [actor.id],
          },
        ],
      );
      await this.notices.follow(tx, taskId, [actor.id, ...mentions]);
      return { task, created, preview };
    });
    if (preview) await this.attachments.queuePreviews();
    return this.one(actor, task, created);
  }

  /** The author edits their text; mentions already in it may name users archived since. */
  async update(
    actor: CurrentUserInfo,
    taskId: string,
    commentId: string,
    input: TaskCommentUpdate,
  ): Promise<TaskComment> {
    const row = await this.db.transaction(async (tx) => {
      const task = await this.task(tx, actor, taskId);
      const comment = await this.liveComment(tx, taskId, commentId);
      if (comment.authorId !== actor.id) {
        throw new CodedException(403, 'NOT_COMMENT_AUTHOR', 'Only the author edits a comment');
      }
      assertTaskWritable(task);
      const { body, bodyDoc, mentions } = bodyOf(input.bodyDoc);
      if (JSON.stringify(comment.bodyDoc) === JSON.stringify(bodyDoc)) return { task, comment };
      await this.assertMentions(
        tx,
        mentions.filter((id) => !comment.mentionedUserIds.includes(id)),
      );
      const [updated] = await tx
        .update(taskComments)
        .set({ body, bodyDoc, mentionedUserIds: mentions, editedAt: new Date() })
        .where(eq(taskComments.id, commentId))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.updated',
        entityType: 'task_comment',
        entityId: commentId,
        before: { body: comment.body, mentionedUserIds: comment.mentionedUserIds },
        after: { taskId, body, mentionedUserIds: mentions },
      });
      // Edge case 12: only mentions the edit adds notify.
      const added = mentions.filter((id) => !comment.mentionedUserIds.includes(id));
      if (added.length > 0) {
        const excerpt = await this.excerpt(tx, body);
        await this.notices.send(tx, [
          this.notices.notice(task, 'task_mentioned', added, actor.id, { excerpt }),
        ]);
        await this.notices.follow(tx, taskId, added);
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
      // A removed question waits on nobody any more.
      if (comment.kind === 'question') {
        await this.notices.resolve(tx, {
          subject: { type: 'task', id: taskId },
          types: ['task_question_asked', 'task_question_reminder', 'task_question_escalated'],
          outcome: 'void',
          actorId: actor.id,
          data: { questionId: commentId },
        });
      }
    });
  }

  task(executor: Executor, actor: CurrentUserInfo, taskId: string) {
    return readableTask(
      executor,
      { clients: this.clients, engagements: this.engagements },
      actor,
      taskId,
    );
  }

  async liveComment(tx: Transaction, taskId: string, commentId: string): Promise<CommentRow> {
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

  /** A live question of the task, locked (`QUESTION_NOT_FOUND`). */
  async liveQuestion(tx: Transaction, taskId: string, questionId: string): Promise<CommentRow> {
    const [question] = await tx
      .select()
      .from(taskComments)
      .where(
        and(
          eq(taskComments.id, questionId),
          eq(taskComments.taskId, taskId),
          eq(taskComments.kind, 'question'),
          isNull(taskComments.archivedAt),
        ),
      )
      .for('update');
    if (!question) {
      throw new CodedException(404, 'QUESTION_NOT_FOUND', 'The question does not exist');
    }
    return question;
  }

  /** Rule 16: mentioned users exist and are not archived. */
  async assertMentions(tx: Transaction, ids: string[]) {
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
  async excerpt(tx: Transaction, body: string): Promise<string> {
    const people = await this.users.summaries(mentionedUserIds(body), tx);
    return commentExcerpt(body, (id) => people.get(id)?.name ?? '');
  }

  /** What every question notification carries (F06B part B). */
  async questionData(tx: Transaction, question: CommentRow, excerpt?: string) {
    const addressee = question.addressedUserId
      ? (await this.users.summaries([question.addressedUserId], tx)).get(question.addressedUserId)
      : undefined;
    return {
      excerpt: excerpt ?? (await this.excerpt(tx, question.body)),
      questionId: question.id,
      department: question.addressedDepartment,
      addressee: addressee?.name ?? null,
    };
  }

  async one(actor: CurrentUserInfo, task: TaskAccess, row: CommentRow): Promise<TaskComment> {
    const [comment] = await this.present(actor, new Map([[task.id, task]]), [row]);
    if (!comment) throw new NotFoundException();
    return comment;
  }

  /** Top-level rows (comments and questions) with their replies, as `actor` sees them. */
  async present(
    actor: CurrentUserInfo,
    access: ReadonlyMap<string, TaskAccess>,
    rows: CommentRow[],
  ): Promise<TaskComment[]> {
    const questionIds = rows.filter((row) => row.kind === 'question').map((row) => row.id);
    const replies =
      questionIds.length > 0
        ? await this.db
            .select()
            .from(taskComments)
            .where(inArray(taskComments.questionId, questionIds))
            .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
        : [];
    const all = [...rows, ...replies];
    const live = all.filter((row) => !row.archivedAt);
    const peopleIds = all.flatMap((row) => [
      row.authorId,
      ...(row.archivedAt ? [] : row.mentionedUserIds),
      ...(row.addressedUserId ? [row.addressedUserId] : []),
      ...(row.answeredById ? [row.answeredById] : []),
    ]);
    const convertedIds = live.flatMap((row) => (row.convertedTaskId ? [row.convertedTaskId] : []));
    const [people, memberships, files, converted] = await Promise.all([
      this.users.summaries(peopleIds),
      this.users.memberships(
        rows.flatMap((row) => (row.addressedUserId ? [row.addressedUserId] : [])),
      ),
      this.attachments.ofComments(live.map((row) => row.id)),
      convertedIds.length > 0
        ? this.db
            .select({ id: tasks.id, title: tasks.title })
            .from(tasks)
            .where(inArray(tasks.id, convertedIds))
        : [],
    ]);
    const person = (id: string): UserSummary =>
      people.get(id) ?? { id, name: '', imageId: null, archived: false };
    const titles = new Map(converted.map((task) => [task.id, task.title]));
    const removesAny = holdsAll(actor, 'tasks.manage');
    const repliesOf = new Map<string, CommentRow[]>();
    for (const reply of replies) {
      if (!reply.questionId) continue;
      repliesOf.set(reply.questionId, [...(repliesOf.get(reply.questionId) ?? []), reply]);
    }

    const fields = (row: CommentRow): TaskReply => {
      const task = access.get(row.taskId) as TaskAccess;
      const writable = !isReadOnly(task);
      const removed = !!row.archivedAt;
      const own = row.authorId === actor.id;
      return {
        id: row.id,
        kind: row.kind,
        author: person(row.authorId),
        body: removed ? null : row.body,
        // A comment written by the previous release has no document yet (expand only).
        bodyDoc: removed
          ? null
          : ((row.bodyDoc as TaskCommentDoc | null) ??
            (richTextFromPlain(row.body, { mentions: true }) as TaskCommentDoc)),
        mentions: removed ? [] : row.mentionedUserIds.map(person),
        attachments: removed ? [] : (files.get(row.id) ?? []),
        questionId: row.questionId,
        convertedTask: row.convertedTaskId
          ? { id: row.convertedTaskId, title: titles.get(row.convertedTaskId) ?? '' }
          : null,
        editedAt: row.editedAt?.toISOString() ?? null,
        removed,
        createdAt: row.createdAt.toISOString(),
        canEdit: writable && !removed && own,
        canRemove: writable && !removed && (own || removesAny),
        canConvert: writable && !removed && !row.convertedTaskId && convertsIn(actor, task),
      };
    };

    return rows.map((row) => {
      const task = access.get(row.taskId) as TaskAccess;
      const writable = !isReadOnly(task);
      const ownReplies = repliesOf.get(row.id) ?? [];
      if (row.kind !== 'question' || !row.questionStatus) {
        return { ...fields(row), question: null, replies: [] };
      }
      const open = row.questionStatus === 'open' && !row.archivedAt;
      const asker = row.authorId === actor.id;
      const replied = ownReplies.some((reply) => !reply.archivedAt);
      const replyAuthor = ownReplies.some(
        (reply) => !reply.archivedAt && reply.authorId === actor.id,
      );
      const addressee = row.addressedUserId ? person(row.addressedUserId) : null;
      return {
        ...fields(row),
        question: {
          addressee: addressee && {
            ...addressee,
            inDepartment:
              !row.addressedDepartment ||
              !!memberships.get(addressee.id)?.has(row.addressedDepartment),
          },
          department: row.addressedDepartment,
          status: row.questionStatus,
          answeredBy: row.answeredById ? person(row.answeredById) : null,
          answeredAt: row.answeredAt?.toISOString() ?? null,
          canAnswer:
            writable && open && (asker || (replied && (isAddressee(actor, row) || replyAuthor))),
          canReopen: writable && !row.archivedAt && row.questionStatus === 'answered' && asker,
          canForward: writable && open && mayForward(actor, row),
        },
        replies: ownReplies.map(fields),
      };
    });
  }
}

/**
 * Rule B11: who may turn a row of this task's thread into a subtask: the right to add subtasks
 * to the task, or to its parent when it is a subtask, while that parent is open.
 */
export function convertsIn(actor: CurrentUserInfo, task: TaskAccess): boolean {
  if (task.parent) {
    return (
      !task.parent.archivedAt &&
      task.parent.status !== 'delivered' &&
      task.parent.status !== 'cancelled' &&
      taskRights(actor, task).parentManager
    );
  }
  return task.status !== 'delivered' && task.status !== 'cancelled' && managesSubtasks(actor, task);
}
