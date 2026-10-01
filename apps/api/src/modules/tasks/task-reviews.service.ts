import { ForbiddenException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  isTaskOpen,
  type MedicalReview,
  type TaskClientTextInput,
  type TaskDetail,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, ClientFlagHooks, type HealthcareChange } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { actorOf, assertTaskWritable, readableTask, taskRights } from './task-access.js';
import { TaskNotices } from './task-notices.js';
import { TaskReviews } from './task-reviews.js';
import { TasksService } from './tasks.service.js';

/**
 * The medical review stage, the text for the client and healthcare flag changes (spec F09 rules
 * 4, 5, 7, 18 and 19).
 */
@Injectable()
export class TaskReviewsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly tasks: TasksService,
    private readonly reviews: TaskReviews,
    private readonly notices: TaskNotices,
    private readonly flagHooks: ClientFlagHooks,
    private readonly reviewHooks: ClientReviewHooks,
  ) {}

  onModuleInit(): void {
    this.flagHooks.register((tx, change) => this.healthcareChanged(tx, change));
  }

  private get directories() {
    return { clients: this.clients, engagements: this.engagements };
  }

  /**
   * Rules 4 and 5: a medical reviewer who is not the assignee approves the snapshot of the
   * internal pass unchanged, or returns the task with notes (a `medical` revision, not counted).
   */
  async medicalReview(
    actor: CurrentUserInfo,
    id: string,
    input: MedicalReview,
  ): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      assertTaskWritable(task);
      if (task.reviewStage !== 'medical') {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'The task is not waiting for medical review',
        );
      }
      if (task.assigneeId === actor.id) {
        throw new CodedException(403, 'SELF_REVIEW', 'The assignee does not review their own task');
      }
      const reviewer = actorOf(actor);
      const assignee = [task.assigneeId];
      if (input.decision === 'approve') {
        const internal = await this.reviews.startingPass(tx, id);
        const reviewId = await this.reviews.recordPass(
          tx,
          id,
          'medical',
          reviewer,
          internal,
          input.note ?? null,
        );
        await tx
          .update(tasks)
          .set({ status: 'awaiting_client', reviewStage: null, clearedReviewId: reviewId })
          .where(eq(tasks.id, id));
        await this.auditMove(tx, reviewer, id, 'awaiting_client', input.note ?? null);
        await this.notices.send(tx, [
          this.notices.notice(task, 'task_approved', assignee, actor.id, { source: 'medical' }),
          this.notices.notice(
            task,
            'task_awaiting_client',
            [task.client?.accountManagerId ?? null],
            actor.id,
          ),
        ]);
        return;
      }
      // The contract requires the note of a return.
      const note = input.note ?? '';
      const revision = await this.reviews.recordRevision(tx, task, 'medical', note, null, actor.id);
      await this.reviews.recordReturn(tx, id, 'medical', reviewer, note, revision.id);
      await tx
        .update(tasks)
        .set({ status: 'revisions', reviewStage: null })
        .where(eq(tasks.id, id));
      await this.auditMove(tx, reviewer, id, 'revisions', note, { revisionSource: 'medical' });
      await this.notices.send(tx, [
        this.notices.notice(task, 'task_returned', assignee, actor.id, { source: 'medical' }),
      ]);
    });
    return this.tasks.detail(actor, id);
  }

  /** Rule 7: task workers and manage scope edit the text while the task is open. */
  async setClientText(
    actor: CurrentUserInfo,
    id: string,
    input: TaskClientTextInput,
  ): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      const rights = taskRights(actor, task);
      if (!rights.work && !rights.manage) throw new ForbiddenException();
      assertTaskWritable(task);
      if (!isTaskOpen(task.status)) {
        throw new CodedException(409, 'TASK_CLOSED', 'Reopen the task to change its text');
      }
      if (input.clientText === task.clientText) return;
      await tx.update(tasks).set({ clientText: input.clientText }).where(eq(tasks.id, id));
      // The audit log keeps the lengths, not the text.
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.client_text_updated',
        entityType: 'task',
        entityId: id,
        before: { length: task.clientText?.length ?? 0 },
        after: { length: input.clientText?.length ?? 0 },
      });
    });
    return this.tasks.detail(actor, id);
  }

  /**
   * Rules 18 and 19, in the transaction that changes the flag. Turned off: tasks in the medical
   * stage go to the client with their internal pass. Turned on: tasks waiting for the client
   * without a pending approval item go back to the medical stage; sent ones stay sent.
   */
  private async healthcareChanged(tx: Transaction, change: HealthcareChange): Promise<void> {
    const affected = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, change.clientId),
          isNull(tasks.archivedAt),
          change.isHealthcare
            ? eq(tasks.status, 'awaiting_client')
            : eq(tasks.reviewStage, 'medical'),
        ),
      )
      // By id, the order every task lock set follows, so a concurrent move cannot deadlock.
      .orderBy(asc(tasks.id))
      .for('update');
    const ids = affected.map((task) => task.id);
    const pending = change.isHealthcare ? await this.reviewHooks.pending(ids, tx) : new Map();
    for (const id of ids) {
      if (pending.has(id)) continue;
      const task = await this.notices.load(tx, id);
      if (change.isHealthcare) {
        await tx
          .update(tasks)
          .set({ status: 'internal_review', reviewStage: 'medical' })
          .where(eq(tasks.id, id));
        await recordAudit(tx, {
          actor: change.actor,
          action: 'task.status_changed',
          entityType: 'task',
          entityId: id,
          before: { status: 'awaiting_client' },
          after: { status: 'internal_review', reviewStage: 'medical', reason: 'healthcare_on' },
        });
        await this.notices.send(tx, [
          await this.reviews.medicalRequested(tx, task, change.actor.id),
        ]);
        continue;
      }
      const internal = await this.reviews.startingPass(tx, id);
      await tx
        .update(tasks)
        .set({ status: 'awaiting_client', reviewStage: null, clearedReviewId: internal.id })
        .where(eq(tasks.id, id));
      await recordAudit(tx, {
        actor: change.actor,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: id,
        before: { status: 'internal_review', reviewStage: 'medical' },
        after: { status: 'awaiting_client', reason: 'healthcare_off' },
      });
      await this.notices.send(tx, [
        this.notices.notice(
          task,
          'task_awaiting_client',
          [task.client?.accountManagerId ?? null],
          change.actor.id,
        ),
      ]);
    }
  }

  private auditMove(
    tx: Transaction,
    actor: { id: string; name: string },
    id: string,
    to: 'awaiting_client' | 'revisions',
    note: string | null,
    extra: Record<string, unknown> = {},
  ) {
    return recordAudit(tx, {
      actor,
      action: 'task.status_changed',
      entityType: 'task',
      entityId: id,
      before: { status: 'internal_review', reviewStage: 'medical' },
      after: { status: to, ...(note && { note }), ...extra },
    });
  }
}
