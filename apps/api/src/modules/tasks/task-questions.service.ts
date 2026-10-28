import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type DepartmentCode,
  type ForwardQuestion,
  TASK_QUESTION_TYPES,
  type TaskComment,
  type TaskQuestionInput,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskComments, tasks } from '@vertex-hub/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { FileAttachments } from '../files/index.js';
import type { Resolution } from '../notifications/index.js';
import { actorOf, assertTaskWritable, managesDepartment, type TaskAccess } from './task-access.js';
import { bodyOf, TaskCommentsService } from './task-comments.service.js';
import { type NoticeTask, TaskNotices } from './task-notices.js';
import { type CommentRow, forwardingDepartment, isAddressee } from './task-questions.js';

/**
 * Questions on a task (spec F06B part B, ADR 0041): asked to a person or a department (rule B1),
 * answered by the asker, the addressee or a reply's author (B4), reopened by the asker, forwarded
 * by the department's managers (B5), and turned into a subtask (B11). They never block the task
 * (B6). Reminders and escalation are `QuestionReminders` (B8).
 */
@Injectable()
export class TaskQuestionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly comments: TaskCommentsService,
    private readonly notices: TaskNotices,
    private readonly attachments: FileAttachments,
  ) {}

  /** Rule B1: a question on a non-archived task in any status, with its attachments. */
  async ask(
    actor: CurrentUserInfo,
    taskId: string,
    input: TaskQuestionInput,
  ): Promise<TaskComment> {
    const { task, created, preview } = await this.db.transaction(async (tx) => {
      const task = await this.comments.task(tx, actor, taskId);
      return { task, ...(await this.askIn(tx, actor, task, input)) };
    });
    if (preview) await this.attachments.queuePreviews();
    return this.comments.one(actor, task, created);
  }

  /**
   * Rule B1 in the caller's transaction, on a task the caller read: also the questions asked in
   * the creation wizard (rule C2). Returns whether a preview waits (`queuePreviews` after commit).
   */
  async askIn(
    tx: Transaction,
    actor: CurrentUserInfo,
    task: TaskAccess,
    input: TaskQuestionInput,
  ): Promise<{ created: CommentRow; preview: boolean }> {
    const taskId = task.id;
    assertTaskWritable(task);
    const addressedUserId = input.addressedUserId ?? null;
    if (
      addressedUserId &&
      (addressedUserId === actor.id || !(await this.users.activeUser(addressedUserId, tx)))
    ) {
      throw new CodedException(
        400,
        'INVALID_ADDRESSEE',
        'A question is addressed to another active user or a department',
      );
    }
    if (input.addressedDepartment) {
      await this.users.assertActiveDepartments([input.addressedDepartment], tx);
    }
    const { body, bodyDoc, mentions } = bodyOf(input.bodyDoc);
    await this.comments.assertMentions(tx, mentions);
    const [created] = await tx
      .insert(taskComments)
      .values({
        taskId,
        authorId: actor.id,
        kind: 'question',
        body,
        bodyDoc,
        mentionedUserIds: mentions,
        addressedUserId,
        addressedDepartment: input.addressedDepartment ?? null,
        questionStatus: 'open',
        clockStartedAt: new Date(),
      })
      .returning();
    if (!created) throw new Error('Question insert returned no row');
    const preview = await this.attachments.attach(
      tx,
      actor,
      { taskId, clientId: task.clientId, commentId: created.id },
      input.files.map((file) => file.uploadId),
    );
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task_comment.question_asked',
      entityType: 'task_comment',
      entityId: created.id,
      after: {
        taskId,
        body,
        mentionedUserIds: mentions,
        ...(addressedUserId && { addressedUserId }),
        ...(input.addressedDepartment && { addressedDepartment: input.addressedDepartment }),
        ...(input.files.length > 0 && { attachments: input.files.length }),
      },
    });
    const data = await this.comments.questionData(tx, created);
    const addressees = await this.waitingOn(tx, created);
    await this.notices.send(tx, [
      // The addressee gets the question, which waits on them, not the earlier-ranked mention.
      this.notices.notice(
        task,
        'task_mentioned',
        mentions.filter((id) => !addressees.includes(id)),
        actor.id,
        { excerpt: data.excerpt },
      ),
      this.notices.notice(task, 'task_question_asked', addressees, actor.id, {
        ...data,
        forwarded: false,
      }),
    ]);
    // F16 rule B12: the asker, those mentioned and the person asked follow the task.
    await this.notices.follow(tx, taskId, [actor.id, ...mentions, addressedUserId]);
    return { created, preview };
  }

  /** Rule B4: marks a question answered; without a reply only the asker may. */
  async answer(actor: CurrentUserInfo, taskId: string, questionId: string): Promise<TaskComment> {
    const { task, question } = await this.db.transaction(async (tx) => {
      const task = await this.comments.task(tx, actor, taskId);
      const question = await this.comments.liveQuestion(tx, taskId, questionId);
      const asker = question.authorId === actor.id;
      if (!asker) {
        const replies = await this.replies(tx, questionId);
        const replyAuthor = replies.some((reply) => reply.authorId === actor.id);
        if (!replyAuthor && !isAddressee(actor, question)) throw new ForbiddenException();
        if (replies.length === 0) {
          throw new CodedException(
            409,
            'QUESTION_NO_REPLY',
            'Reply first: only the asker marks a question without a reply answered',
          );
        }
      }
      assertTaskWritable(task);
      if (question.questionStatus === 'answered') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The question is already answered');
      }
      const answered = await this.markAnswered(tx, actor, question, task);
      if (!asker) {
        const data = await this.comments.questionData(tx, question);
        await this.notices.send(tx, [
          this.notices.notice(task, 'task_question_answered', [question.authorId], actor.id, {
            ...data,
            reply: false,
          }),
        ]);
      }
      return { task, question: answered };
    });
    return this.comments.one(actor, task, question);
  }

  /** Rule B4: the asker reopens an answered question; its clock starts again. */
  async reopen(actor: CurrentUserInfo, taskId: string, questionId: string): Promise<TaskComment> {
    const { task, question } = await this.db.transaction(async (tx) => {
      const task = await this.comments.task(tx, actor, taskId);
      const question = await this.comments.liveQuestion(tx, taskId, questionId);
      if (question.authorId !== actor.id) {
        throw new CodedException(403, 'NOT_QUESTION_ASKER', 'Only the asker reopens a question');
      }
      assertTaskWritable(task);
      if (question.questionStatus !== 'answered') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The question is open');
      }
      const [reopened] = await tx
        .update(taskComments)
        .set({
          questionStatus: 'open',
          clockStartedAt: new Date(),
          answeredAt: null,
          answeredById: null,
        })
        .where(eq(taskComments.id, questionId))
        .returning();
      if (!reopened) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.question_reopened',
        entityType: 'task_comment',
        entityId: questionId,
        before: { questionStatus: 'answered', answeredById: question.answeredById },
        after: { taskId, questionStatus: 'open' },
      });
      return { task, question: reopened };
    });
    return this.comments.one(actor, task, question);
  }

  /**
   * Rule B5: a manager of the addressed department hands an open department question to one of
   * its members; the department stays, the clock does not restart.
   */
  async forward(
    actor: CurrentUserInfo,
    taskId: string,
    questionId: string,
    input: ForwardQuestion,
  ): Promise<TaskComment> {
    const { task, question } = await this.db.transaction(async (tx) => {
      const task = await this.comments.task(tx, actor, taskId);
      const question = await this.comments.liveQuestion(tx, taskId, questionId);
      const department = forwardingDepartment(question, await this.formerDepartment(tx, question));
      if (!department || !managesDepartment(actor, department)) throw new ForbiddenException();
      assertTaskWritable(task);
      if (question.questionStatus !== 'open') {
        throw new CodedException(409, 'QUESTION_CLOSED', 'The question is answered');
      }
      if (!(await this.users.activeMember(input.userId, department, tx))) {
        throw new CodedException(
          400,
          'INVALID_ADDRESSEE',
          'A question is forwarded to an active member of its department',
        );
      }
      if (question.addressedUserId === input.userId) return { task, question };
      const before = await this.waitingOn(tx, question);
      const [forwarded] = await tx
        .update(taskComments)
        // Edge case 14: an archived person's question joins their former department.
        .set({ addressedUserId: input.userId, addressedDepartment: department })
        .where(eq(taskComments.id, questionId))
        .returning();
      if (!forwarded) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_comment.question_forwarded',
        entityType: 'task_comment',
        entityId: questionId,
        before: {
          addressedUserId: question.addressedUserId,
          addressedDepartment: question.addressedDepartment,
        },
        after: { taskId, addressedDepartment: department, addressedUserId: input.userId },
      });
      const data = await this.comments.questionData(tx, forwarded);
      await this.notices.send(
        tx,
        [
          this.notices.notice(task, 'task_question_asked', [input.userId], actor.id, {
            ...data,
            forwarded: true,
          }),
        ],
        // The managers' (or the previous member's) notice no longer waits on them.
        [
          {
            subject: { type: 'task', id: taskId },
            types: ['task_question_asked', 'task_question_reminder'],
            outcome: 'void',
            actorId: actor.id,
            recipients: before.filter((id) => id !== input.userId),
            data: { questionId },
          },
        ],
      );
      await this.notices.follow(tx, taskId, [input.userId]);
      return { task, question: forwarded };
    });
    return this.comments.one(actor, task, question);
  }

  /**
   * Rule B11: the row of the parent's thread, or of one of its subtasks', that becomes a new
   * subtask; locked, live and not turned into one before.
   */
  async convertSource(tx: Transaction, parentId: string, commentId: string): Promise<CommentRow> {
    const [row] = await tx
      .select({ comment: taskComments })
      .from(taskComments)
      .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
      .where(
        and(
          eq(taskComments.id, commentId),
          isNull(taskComments.archivedAt),
          or(eq(taskComments.taskId, parentId), eq(tasks.parentId, parentId)),
        ),
      )
      .for('update', { of: taskComments });
    if (!row) throw new NotFoundException();
    if (row.comment.convertedTaskId) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'It was turned into a subtask already');
    }
    return row.comment;
  }

  /**
   * Rule B11: links the source to the subtask made from it, copies its attachments as the
   * subtask's references, marks an open question answered and tells the asker or author and the
   * addressee. Returns whether a preview waits (`queuePreviews` after the commit).
   */
  async converted(
    tx: Transaction,
    actor: CurrentUserInfo,
    source: CommentRow,
    subtask: { id: string; title: string; clientId: string | null },
  ): Promise<boolean> {
    const preview = await this.attachments.copyAsReferences(tx, actor, source.id, {
      taskId: subtask.id,
      clientId: subtask.clientId,
    });
    await tx
      .update(taskComments)
      .set({ convertedTaskId: subtask.id })
      .where(eq(taskComments.id, source.id));
    const answers = source.kind === 'question' && source.questionStatus === 'open';
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task_comment.converted',
      entityType: 'task_comment',
      entityId: source.id,
      after: { taskId: source.taskId, subtaskId: subtask.id, ...(answers && { answered: true }) },
    });
    const task = await this.notices.load(tx, source.taskId);
    if (answers) await this.markAnswered(tx, actor, source, task);
    const data = await this.comments.questionData(tx, source);
    await this.notices.send(tx, [
      this.notices.notice(
        task,
        'task_question_converted',
        [source.authorId, ...(source.kind === 'question' ? await this.waitingOn(tx, source) : [])],
        actor.id,
        { ...data, subtask: subtask.title, question: source.kind === 'question' },
      ),
    ]);
    return preview;
  }

  /**
   * Rule B8: who a question waits on now: the person asked or the member it was forwarded to;
   * for a department question still with its department, its managers. An archived addressee's
   * question goes to the managers of their former primary department (edge case 14).
   */
  async waitingOn(tx: Transaction, question: CommentRow): Promise<string[]> {
    if (question.addressedUserId) {
      if (await this.users.activeUser(question.addressedUserId, tx)) {
        return [question.addressedUserId];
      }
      const primary = (await this.users.primaryDepartments([question.addressedUserId], tx)).get(
        question.addressedUserId,
      );
      const department = primary ?? question.addressedDepartment;
      return department ? this.notices.managers(tx, department) : [];
    }
    return question.addressedDepartment
      ? this.notices.managers(tx, question.addressedDepartment)
      : [];
  }

  /** Edge case 14: the primary department of a question's archived addressee, else null. */
  private async formerDepartment(
    tx: Transaction,
    question: CommentRow,
  ): Promise<DepartmentCode | null> {
    const addressee = question.addressedUserId;
    if (!addressee || (await this.users.activeUser(addressee, tx))) return null;
    return (await this.users.primaryDepartments([addressee], tx)).get(addressee) ?? null;
  }

  private async markAnswered(
    tx: Transaction,
    actor: CurrentUserInfo,
    question: CommentRow,
    task: TaskAccess | NoticeTask,
  ): Promise<CommentRow> {
    const [answered] = await tx
      .update(taskComments)
      .set({ questionStatus: 'answered', answeredAt: new Date(), answeredById: actor.id })
      .where(eq(taskComments.id, question.id))
      .returning();
    if (!answered) throw new NotFoundException();
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task_comment.question_answered',
      entityType: 'task_comment',
      entityId: question.id,
      before: { questionStatus: 'open' },
      after: { taskId: task.id, questionStatus: 'answered' },
    });
    const resolution: Resolution = {
      subject: { type: 'task', id: task.id },
      types: TASK_QUESTION_TYPES,
      outcome: 'done',
      actorId: actor.id,
      data: { questionId: question.id },
    };
    await this.notices.resolve(tx, resolution);
    return answered;
  }

  private replies(tx: Transaction, questionId: string) {
    return tx
      .select({ authorId: taskComments.authorId })
      .from(taskComments)
      .where(and(eq(taskComments.questionId, questionId), isNull(taskComments.archivedAt)));
  }
}
