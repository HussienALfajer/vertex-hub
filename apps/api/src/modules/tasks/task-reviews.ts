import { Inject, Injectable } from '@nestjs/common';
import {
  type ReviewStage,
  type ReviewVersion,
  type RevisionSource,
  reviewContentToken,
  type TaskClientResponse,
  type TaskDetail,
  type TaskReview,
} from '@vertex-hub/contracts';
import {
  type Database,
  type Transaction,
  taskClientResponses,
  taskReviews,
  taskRevisions,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { FileVersions } from '../files/index.js';
import type { Notice } from '../notifications/index.js';
import type { TaskAccess } from './task-access.js';
import { type NoticeTask, TaskNotices } from './task-notices.js';

type Executor = Database | Transaction;

type ReviewRow = typeof taskReviews.$inferSelect;

/** What a review looks at: the latest version of each deliverable and the text for the client. */
export interface ReviewContent {
  versionIds: string[];
  clientText: string | null;
  token: string;
}

/** The review part of a task's detail. */
type ReviewDetail = Pick<
  TaskDetail,
  'clientText' | 'contentToken' | 'clearedReview' | 'reviewHistory' | 'clientResponses'
>;

/**
 * Review snapshots (spec F09 rules 1–5, ADR 0020): the content a review looks at, the pass and
 * return records, and the revisions they write. Used inside the transactions of the workflow.
 */
@Injectable()
export class TaskReviews {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly files: FileVersions,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly notices: TaskNotices,
  ) {}

  /** Rule 1: the content of the task now, with its token. */
  async content(
    executor: Executor,
    task: Pick<TaskAccess, 'id' | 'clientText'>,
  ): Promise<ReviewContent> {
    const versionIds = await this.files.latestDeliverableVersions(task.id, executor);
    return {
      versionIds,
      clientText: task.clientText,
      token: reviewContentToken(versionIds, task.clientText),
    };
  }

  /** Rule 2: a pass with the snapshot it approved; returns the review id. */
  async recordPass(
    tx: Transaction,
    taskId: string,
    stage: ReviewStage,
    reviewer: AuditActor,
    snapshot: { versionIds: string[]; clientText: string | null },
    note: string | null = null,
  ): Promise<string> {
    const [review] = await tx
      .insert(taskReviews)
      .values({
        taskId,
        stage,
        outcome: 'passed',
        note,
        reviewerId: reviewer.id,
        versionIds: snapshot.versionIds,
        clientText: snapshot.clientText,
      })
      .returning({ id: taskReviews.id });
    if (!review) throw new Error('Review insert returned no row');
    const versions = await this.files.versionRefs(snapshot.versionIds, tx);
    await recordAudit(tx, {
      actor: reviewer,
      action: 'task.reviewed',
      entityType: 'task',
      entityId: taskId,
      after: {
        stage,
        outcome: 'passed',
        ...(note && { note }),
        versions: snapshot.versionIds.flatMap((id) => {
          const version = versions.get(id);
          return version ? [{ name: version.name, number: version.number }] : [];
        }),
        hasText: !!snapshot.clientText,
      },
    });
    return review.id;
  }

  /** Rule 2: a return, with the revision it wrote. */
  async recordReturn(
    tx: Transaction,
    taskId: string,
    stage: ReviewStage,
    reviewer: AuditActor,
    note: string,
    revisionId: string,
  ): Promise<void> {
    await tx.insert(taskReviews).values({
      taskId,
      stage,
      outcome: 'returned',
      note,
      reviewerId: reviewer.id,
      revisionId,
    });
    await recordAudit(tx, {
      actor: reviewer,
      action: 'task.reviewed',
      entityType: 'task',
      entityId: taskId,
      after: { stage, outcome: 'returned', note },
    });
  }

  /**
   * F06 rules 9 and 10: every move to revisions is recorded; client ones count against the
   * limit, internal and medical ones never do.
   */
  async recordRevision(
    tx: Transaction,
    task: Pick<TaskAccess, 'id' | 'revisionLimit'>,
    source: RevisionSource,
    note: string,
    contactId: string | null,
    authorId: string,
  ) {
    let number: number | null = null;
    if (source === 'client') {
      const [counted] = await tx
        .select({ value: count() })
        .from(taskRevisions)
        .where(and(eq(taskRevisions.taskId, task.id), eq(taskRevisions.source, 'client')));
      number = (counted?.value ?? 0) + 1;
    }
    const values = {
      taskId: task.id,
      source,
      number,
      note,
      contactId: source === 'client' ? contactId : null,
      overLimit: number !== null && number > task.revisionLimit,
      authorId,
    };
    const [revision] = await tx
      .insert(taskRevisions)
      .values(values)
      .returning({ id: taskRevisions.id });
    if (!revision) throw new Error('Revision insert returned no row');
    return { ...values, id: revision.id };
  }

  /** The internal pass that started the medical stage: the latest internal pass of the task. */
  async startingPass(executor: Executor, taskId: string): Promise<ReviewRow> {
    const [pass] = await executor
      .select()
      .from(taskReviews)
      .where(
        and(
          eq(taskReviews.taskId, taskId),
          eq(taskReviews.stage, 'internal'),
          eq(taskReviews.outcome, 'passed'),
        ),
      )
      .orderBy(desc(taskReviews.createdAt), desc(taskReviews.id))
      .limit(1);
    if (!pass) throw new Error(`Task ${taskId} is in the medical stage without an internal pass`);
    return pass;
  }

  /** The pass that cleared the task for the client; `INVALID_TRANSITION` when it has none. */
  async clearedPass(
    executor: Executor,
    task: Pick<TaskAccess, 'clearedReviewId'>,
  ): Promise<ReviewRow> {
    const [pass] = task.clearedReviewId
      ? await executor.select().from(taskReviews).where(eq(taskReviews.id, task.clearedReviewId))
      : [];
    if (!pass) {
      throw new CodedException(
        409,
        'INVALID_TRANSITION',
        'The task has no reviewed snapshot: withdraw it for re-review first',
      );
    }
    return pass;
  }

  /**
   * Edge case 4: the versions of the snapshot under medical review or with the client, which
   * cannot be removed until the task is withdrawn.
   */
  async sentVersionIds(
    executor: Executor,
    task: Pick<TaskAccess, 'id' | 'status' | 'reviewStage' | 'clearedReviewId'>,
  ): Promise<string[]> {
    if (task.reviewStage === 'medical') {
      return (await this.startingPass(executor, task.id)).versionIds;
    }
    if (task.status !== 'awaiting_client' || !task.clearedReviewId) return [];
    return (await this.clearedPass(executor, task)).versionIds;
  }

  /** Rule 4 (A13): the Medical Consultation members hear about a task entering their stage. */
  async medicalRequested(
    tx: Transaction,
    task: NoticeTask,
    actorId: string | null,
  ): Promise<Notice> {
    const members = await this.users.activeMembers(['medical_consultation'], tx);
    return this.notices.notice(
      task,
      'task_medical_review_requested',
      members.map((member) => member.id).filter((id) => id !== task.assigneeId),
      actorId,
    );
  }

  /** The stage of each task's cleared review, for the "ready to send" rule (rule 8). */
  async clearedStage(
    executor: Executor,
    task: Pick<TaskAccess, 'clearedReviewId'>,
  ): Promise<ReviewStage | null> {
    if (!task.clearedReviewId) return null;
    const [pass] = await executor
      .select({ stage: taskReviews.stage })
      .from(taskReviews)
      .where(eq(taskReviews.id, task.clearedReviewId));
    return pass?.stage ?? null;
  }

  /** The reviews and client responses of a task, oldest first, for its page. */
  async detail(task: TaskAccess): Promise<ReviewDetail> {
    const [content, reviews, responses] = await Promise.all([
      this.content(this.db, task),
      this.db
        .select()
        .from(taskReviews)
        .where(eq(taskReviews.taskId, task.id))
        .orderBy(asc(taskReviews.createdAt), asc(taskReviews.id)),
      this.db
        .select()
        .from(taskClientResponses)
        .where(eq(taskClientResponses.taskId, task.id))
        .orderBy(asc(taskClientResponses.createdAt), asc(taskClientResponses.id)),
    ]);
    const [versions, people, contacts] = await Promise.all([
      this.files.versionRefs(reviews.flatMap((review) => review.versionIds)),
      this.users.summaries([
        ...reviews.flatMap((review) => (review.reviewerId ? [review.reviewerId] : [])),
        ...responses.flatMap((response) => (response.recordedById ? [response.recordedById] : [])),
      ]),
      this.clients.contactSummaries(responses.map((response) => response.contactId)),
    ]);
    const person = (userId: string) => ({ id: userId, name: people.get(userId)?.name ?? '' });
    const versionsOf = (ids: string[]): ReviewVersion[] =>
      ids
        .flatMap((id) => versions.get(id) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.number - b.number);
    const toReview = (review: ReviewRow): TaskReview => ({
      id: review.id,
      stage: review.stage,
      outcome: review.outcome,
      note: review.note,
      reviewer: review.reviewerId ? person(review.reviewerId) : null,
      versions: versionsOf(review.versionIds),
      clientText: review.clientText,
      createdAt: review.createdAt.toISOString(),
    });
    const byId = new Map(reviews.map((review) => [review.id, review]));
    const cleared = task.clearedReviewId ? byId.get(task.clearedReviewId) : undefined;
    return {
      clientText: task.clientText,
      contentToken: content.token,
      clearedReview: cleared ? toReview(cleared) : null,
      reviewHistory: reviews.map(toReview),
      clientResponses: responses.map(
        (response): TaskClientResponse => ({
          id: response.id,
          decision: response.decision,
          channel: response.channel,
          contact: contacts.get(response.contactId) ?? {
            id: response.contactId,
            name: '',
            archived: true,
          },
          note: response.note,
          versions: versionsOf(byId.get(response.reviewId)?.versionIds ?? []),
          recordedBy: response.recordedById ? person(response.recordedById) : null,
          createdAt: response.createdAt.toISOString(),
        }),
      ),
    };
  }
}
