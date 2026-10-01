import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  ClientDecision,
  ClientResponseEntry,
  ClientResponsePage,
  PageQuery,
  ReadyTask,
  ResponseChannel,
} from '@vertex-hub/contracts';
import {
  type Database,
  type Transaction,
  taskClientResponses,
  taskReviews,
  tasks,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { FileVersions } from '../files/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { accessColumns, actorOf, hasClientScope, type TaskAccess } from './task-access.js';
import { TaskNotices } from './task-notices.js';
import { TaskReviews } from './task-reviews.js';
import { TasksService } from './tasks.service.js';

type Executor = Database | Transaction;

/** A client's answer recorded by hand, as the workflow passes it after moving the task. */
export interface ManualResponse {
  /** The task as it was before the move. */
  task: TaskAccess;
  decision: ClientDecision;
  note: string | null;
  contactId: string;
  /** Requested changes only: the client revision the move wrote. */
  revisionId: string | null;
  recordedBy: CurrentUserInfo;
}

/** A client's answer through an approval link, as the `approvals` module passes it. */
export interface LinkResponse {
  taskId: string;
  /** The pending item it answers, and the snapshot that item sent. */
  itemId: string;
  reviewId: string;
  decision: ClientDecision;
  note: string | null;
  contact: { id: string; name: string };
  ip: string | null;
  userAgent: string | null;
}

/** A task that goes into an approval request, with the snapshot it sends. */
export interface SendableTask {
  id: string;
  title: string;
  reviewId: string;
}

/** What a pass approved: the versions and the text an approval item shows. */
export interface ReviewSnapshot {
  versionIds: string[];
  clientText: string | null;
}

/** A client response as an approval item shows it. */
export interface ResponseSummary {
  decision: ClientDecision;
  channel: ResponseChannel;
  note: string | null;
  createdAt: Date;
}

/**
 * Client responses on a task (spec F09 rules 13–16, ADR 0020): one record against the snapshot
 * answered, the final markers of an approval, and the pending approval item that follows. Also
 * what the `approvals` module reads and changes of tasks: the ready ones, their snapshots and
 * the response a link records.
 */
@Injectable()
export class TaskApprovals {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reviews: TaskReviews,
    private readonly files: FileVersions,
    private readonly hooks: ClientReviewHooks,
    private readonly tasks: TasksService,
    private readonly notices: TaskNotices,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
  ) {}

  /** Client scope: who sends, reissues and revokes links for the client's tasks. */
  hasClientScope(actor: CurrentUserInfo, client: ClientSummary): boolean {
    return hasClientScope(actor, client);
  }

  /**
   * Rule 16: records the response against the task's cleared review, in the transaction that
   * moved the task. An approval marks the snapshot's versions final (rule 13); a response on a
   * task that was with the client closes its pending item.
   */
  async recordManual(tx: Transaction, response: ManualResponse): Promise<void> {
    const { task, decision, note, contactId, recordedBy } = response;
    const pass = await this.reviews.clearedPass(tx, task);
    const sent = task.status === 'awaiting_client';
    const pending = sent ? (await this.hooks.pending([task.id], tx)).get(task.id) : undefined;
    const [created] = await tx
      .insert(taskClientResponses)
      .values({
        taskId: task.id,
        decision,
        channel: 'manual',
        contactId,
        note,
        reviewId: pass.id,
        approvalItemId: pending?.itemId ?? null,
        revisionId: response.revisionId,
        recordedById: recordedBy.id,
      })
      .returning({ id: taskClientResponses.id });
    if (!created) throw new Error('Client response insert returned no row');
    await recordAudit(tx, {
      actor: actorOf(recordedBy),
      action: 'task.client_response_recorded',
      entityType: 'task',
      entityId: task.id,
      after: {
        decision,
        channel: 'manual',
        contactId,
        ...(note && { note }),
        versions: await this.versionNames(tx, pass.versionIds),
      },
    });
    if (decision === 'approved') {
      await this.files.markSnapshotFinal(tx, task.id, pass.versionIds, actorOf(recordedBy));
    }
    if (sent) {
      await this.hooks.left(tx, {
        taskId: task.id,
        actor: actorOf(recordedBy),
        response: { id: created.id, decision },
      });
    }
  }

  /**
   * Rules 13 and 14 (A05): the client's decision through a link moves the task, in the
   * transaction that closes the item. The caller locked the task (`lock`) before the item, and
   * closes the item itself. No user acts: the audit entries carry the contact's name.
   */
  async recordLink(
    tx: Transaction,
    response: LinkResponse,
  ): Promise<ResponseSummary & { id: string }> {
    const { taskId, decision, note, contact } = response;
    const task = await this.notices.load(tx, taskId);
    if (task.status !== 'awaiting_client' || task.clearedReviewId !== response.reviewId) {
      throw new CodedException(409, 'ITEM_WITHDRAWN', 'The task is no longer with the client');
    }
    const pass = await this.reviews.clearedPass(tx, task);
    const approved = decision === 'approved';
    const to = approved ? 'approved' : 'revisions';
    await tx.update(tasks).set({ status: to }).where(eq(tasks.id, taskId));
    // The contract requires the note of requested changes.
    const revision = approved
      ? null
      : await this.reviews.recordRevision(tx, task, 'client', note ?? '', contact.id, null);
    await recordAudit(tx, {
      actor: null,
      actorName: contact.name,
      action: 'task.status_changed',
      entityType: 'task',
      entityId: taskId,
      before: { status: 'awaiting_client' },
      after: {
        status: to,
        via: 'approval_link',
        ...(note && { note }),
        contactId: contact.id,
        ...(revision && {
          revisionSource: revision.source,
          revisionNumber: revision.number,
          ...(revision.overLimit && { overLimit: true }),
        }),
      },
    });
    const [created] = await tx
      .insert(taskClientResponses)
      .values({
        taskId,
        decision,
        channel: 'link',
        contactId: contact.id,
        note,
        reviewId: pass.id,
        approvalItemId: response.itemId,
        revisionId: revision?.id ?? null,
        ip: response.ip,
        userAgent: response.userAgent?.slice(0, 500) ?? null,
      })
      .returning({ id: taskClientResponses.id, createdAt: taskClientResponses.createdAt });
    if (!created) throw new Error('Client response insert returned no row');
    await recordAudit(tx, {
      actor: null,
      actorName: contact.name,
      action: 'task.client_response_recorded',
      entityType: 'task',
      entityId: taskId,
      after: {
        decision,
        channel: 'link',
        via: 'approval_link',
        contactId: contact.id,
        ...(note && { note }),
        versions: await this.versionNames(tx, pass.versionIds),
      },
    });
    const notice = this.notices.notice.bind(this.notices);
    if (approved) {
      await this.files.markSnapshotFinal(tx, taskId, pass.versionIds, null);
      await this.notices.send(tx, [
        notice(task, 'task_approved', [task.assigneeId], null, { source: 'client' }),
        ...(await this.notices.openedDependents(tx, [taskId], null)),
      ]);
    } else {
      await this.notices.send(tx, [
        notice(task, 'task_returned', [task.assigneeId], null, { source: 'client' }),
        ...(revision?.overLimit
          ? [notice(task, 'task_over_limit', [task.client?.accountManagerId ?? null], null)]
          : []),
      ]);
    }
    return { id: created.id, decision, channel: 'link', note, createdAt: created.createdAt };
  }

  /** Locks the task rows, by id: the order every task lock set follows. */
  async lock(tx: Transaction, taskIds: readonly string[]): Promise<void> {
    if (taskIds.length === 0) return;
    await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, [...taskIds]))
      .orderBy(asc(tasks.id))
      .for('update');
  }

  /**
   * Rule 8, without the pending item (the `approvals` module knows it): locks the tasks and
   * checks that each is a live task of the client waiting for it, cleared by a medical pass for a
   * healthcare client. `TASK_NOT_READY` or `MEDICAL_REVIEW_REQUIRED` otherwise.
   */
  async sendable(
    tx: Transaction,
    client: ClientSummary,
    taskIds: readonly string[],
  ): Promise<SendableTask[]> {
    await this.lock(tx, taskIds);
    const rows = await tx
      .select({ id: tasks.id, title: tasks.title, reviewId: tasks.clearedReviewId })
      .from(tasks)
      .where(
        and(
          inArray(tasks.id, [...taskIds]),
          eq(tasks.clientId, client.id),
          eq(tasks.status, 'awaiting_client'),
          this.tasks.visibleSql(),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const stages = await this.stages(
      tx,
      rows.flatMap((row) => (row.reviewId ? [row.reviewId] : [])),
    );
    return taskIds.map((id) => {
      const row = byId.get(id);
      if (!row?.reviewId) {
        throw new CodedException(409, 'TASK_NOT_READY', 'A task is not ready to send', {
          taskId: id,
        });
      }
      if (client.isHealthcare && stages.get(row.reviewId) !== 'medical') {
        throw new CodedException(
          409,
          'MEDICAL_REVIEW_REQUIRED',
          'A task was not cleared by a medical review: withdraw it for re-review',
          { taskId: id },
        );
      }
      return { id: row.id, title: row.title, reviewId: row.reviewId };
    });
  }

  /**
   * The tasks ready to send (rule 8) under the actor's client scope, by due date, each with what
   * its cleared review would send; 403 without any client scope.
   */
  async ready(actor: CurrentUserInfo, clientId?: string): Promise<ReadyTask[]> {
    const scope = this.tasks.clientScopeSql(actor);
    if (!scope) throw new ForbiddenException();
    const rows = await this.db
      .select(accessColumns)
      .from(tasks)
      .where(
        and(
          this.tasks.visibleSql(),
          this.tasks.readyToSendSql(),
          scope,
          clientId ? eq(tasks.clientId, clientId) : undefined,
        ),
      )
      .orderBy(asc(tasks.dueDate), asc(tasks.id));
    const [items, snapshots] = await Promise.all([
      this.tasks.present(rows, this.db, new Date()),
      this.snapshots(rows.flatMap((row) => (row.clearedReviewId ? [row.clearedReviewId] : []))),
    ]);
    return rows.map((row, index) => {
      const snapshot = row.clearedReviewId ? snapshots.get(row.clearedReviewId) : undefined;
      return {
        ...(items[index] as (typeof items)[number]),
        snapshot: { files: snapshot?.versionIds.length ?? 0, hasText: !!snapshot?.clientText },
      };
    });
  }

  /** The snapshots of the given passes, by review id. */
  async snapshots(
    reviewIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, ReviewSnapshot>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await executor
      .select({
        id: taskReviews.id,
        versionIds: taskReviews.versionIds,
        clientText: taskReviews.clientText,
      })
      .from(taskReviews)
      .where(inArray(taskReviews.id, [...new Set(reviewIds)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Titles of the given tasks, archived or not. */
  async titles(
    taskIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, string>> {
    if (taskIds.length === 0) return new Map();
    const rows = await executor
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, [...new Set(taskIds)]));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  /** Client responses by id, as approval items show them. */
  async responses(
    ids: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, ResponseSummary>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({
        id: taskClientResponses.id,
        decision: taskClientResponses.decision,
        channel: taskClientResponses.channel,
        note: taskClientResponses.note,
        createdAt: taskClientResponses.createdAt,
      })
      .from(taskClientResponses)
      .where(inArray(taskClientResponses.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** The responses of a client on all its tasks, newest first, for its Approvals tab. */
  async clientResponses(clientId: string, query: PageQuery): Promise<ClientResponsePage> {
    const where = eq(tasks.clientId, clientId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ response: taskClientResponses, title: tasks.title })
        .from(taskClientResponses)
        .innerJoin(tasks, eq(tasks.id, taskClientResponses.taskId))
        .where(where)
        .orderBy(desc(taskClientResponses.createdAt), desc(taskClientResponses.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(taskClientResponses)
        .innerJoin(tasks, eq(tasks.id, taskClientResponses.taskId))
        .where(where),
    ]);
    const responses = rows.map((row) => row.response);
    const snapshots = await this.snapshots(responses.map((response) => response.reviewId));
    const [versions, people, contacts] = await Promise.all([
      this.files.versionRefs([...snapshots.values()].flatMap((snapshot) => snapshot.versionIds)),
      this.users.summaries(responses.flatMap((r) => (r.recordedById ? [r.recordedById] : []))),
      this.clients.contactSummaries(responses.map((response) => response.contactId)),
    ]);
    return {
      items: rows.map(
        ({ response, title }): ClientResponseEntry => ({
          id: response.id,
          kind: 'task',
          task: { id: response.taskId, title },
          post: null,
          decision: response.decision,
          channel: response.channel,
          contact: contacts.get(response.contactId) ?? {
            id: response.contactId,
            name: '',
            archived: true,
          },
          note: response.note,
          versions: (snapshots.get(response.reviewId)?.versionIds ?? [])
            .flatMap((id) => versions.get(id) ?? [])
            .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.number - b.number),
          recordedBy: response.recordedById
            ? { id: response.recordedById, name: people.get(response.recordedById)?.name ?? '' }
            : null,
          createdAt: response.createdAt.toISOString(),
        }),
      ),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async stages(executor: Executor, reviewIds: string[]) {
    if (reviewIds.length === 0) return new Map<string, 'internal' | 'medical'>();
    const rows = await executor
      .select({ id: taskReviews.id, stage: taskReviews.stage })
      .from(taskReviews)
      .where(inArray(taskReviews.id, reviewIds));
    return new Map(rows.map((row) => [row.id, row.stage]));
  }

  /** The versions of a snapshot as an audit entry names them. */
  private async versionNames(tx: Transaction, versionIds: readonly string[]) {
    const versions = await this.files.versionRefs(versionIds, tx);
    return versionIds.flatMap((id) => {
      const version = versions.get(id);
      return version ? [{ name: version.name, number: version.number }] : [];
    });
  }
}
