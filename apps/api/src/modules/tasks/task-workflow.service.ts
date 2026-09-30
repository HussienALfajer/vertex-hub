import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  businessDate,
  canMakeTaskMove,
  isTaskBlocked,
  type RevisionDecisionInput,
  revisionExtraWorkTitle,
  revisionSourceOf,
  type TaskDependenciesInput,
  type TaskDependencyList,
  type TaskDetail,
  type TaskMove,
  type TaskRevision,
  type TaskStatus,
  type TaskStatusChange,
  taskMove,
  taskMoveNeedsNote,
} from '@vertex-hub/contracts';
import {
  type Database,
  type Transaction,
  taskDependencies,
  taskRevisions,
  tasks,
} from '@vertex-hub/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import type { Notice } from '../notifications/index.js';
import { EngagementDirectory } from '../projects/index.js';
import {
  actorOf,
  assertTaskWritable,
  inClosedProject,
  readableTask,
  type TaskAccess,
  taskRights,
} from './task-access.js';
import {
  assertValidDependencies,
  dependenciesOf,
  isBlocked,
  lockDependencyGraph,
} from './task-dependencies.js';
import { blocksDependents, requesterOf, TaskNotices } from './task-notices.js';
import { TasksService } from './tasks.service.js';

/** Moves where the client answers, and so a contact may be named. */
const CLIENT_MOVES: readonly TaskMove[] = ['client_approved', 'client_changes', 'reopen_client'];

/** Moves that turn a delivered or cancelled task back into open work. */
const REOPEN_MOVES: readonly TaskMove[] = ['reopen', 'reopen_client', 'reopen_internal'];
const REOPEN_TARGETS: readonly TaskStatus[] = ['new', 'in_progress', 'revisions'];

/**
 * The task workflow (spec F06, "Task status" and rules 1–5, 9–14): status moves, over-limit
 * revision decisions and dependencies.
 */
@Injectable()
export class TaskWorkflowService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly tasks: TasksService,
    private readonly notices: TaskNotices,
    private readonly users: UserDirectory,
  ) {}

  private get directories() {
    return { clients: this.clients, engagements: this.engagements };
  }

  async changeStatus(
    actor: CurrentUserInfo,
    id: string,
    change: TaskStatusChange,
  ): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      // A reopen must not hand open work back to an archived user (rule 6, edge case 4): it
      // waits for user archiving, which checks open tasks under the same lock, taken first.
      if (REOPEN_TARGETS.includes(change.status)) await lockAccessChanges(tx);
      // The row lock makes a second concurrent move see the first one's status (edge case 1).
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      assertTaskWritable(task);
      const move = this.moveOf(task, change);
      const rights = taskRights(actor, task);
      if (REOPEN_MOVES.includes(move)) {
        if (inClosedProject(task)) {
          throw new CodedException(409, 'PROJECT_CLOSED', 'Reopen the project first');
        }
        if (task.assigneeId && !(await this.users.activeUser(task.assigneeId, tx))) {
          throw new CodedException(
            409,
            'INVALID_ASSIGNEE',
            'The assignee is archived: assign the task to someone else first',
          );
        }
      }

      if (move === 'start' && !task.assigneeId) {
        throw new CodedException(409, 'ASSIGNEE_REQUIRED', 'Assign the task before starting it');
      }
      // Rule 3: a blocked task starts only with an override, by assign scope.
      let blocked = false;
      if (move === 'start') {
        const dependencies = await dependenciesOf(id, tx);
        blocked = isTaskBlocked(dependencies);
        if (blocked && !change.overrideDependencies) {
          throw new CodedException(
            409,
            'TASK_BLOCKED',
            'The task waits on unfinished tasks',
            dependencies.filter((d) => !d.archived && !d.finished && d.status !== 'cancelled'),
          );
        }
      }
      if (!canMakeTaskMove(this.state(task, blocked), move, rights)) throw new ForbiddenException();
      const overridden = blocked;
      const note = change.note ?? null;
      if (taskMoveNeedsNote(move) && !note) {
        throw new BadRequestException('This move needs a note');
      }
      const contactId = change.contactId ?? null;
      if (contactId) {
        if (!CLIENT_MOVES.includes(move)) {
          throw new BadRequestException('A contact is named only for client responses');
        }
        if (!task.clientId || !(await this.clients.isActiveContact(task.clientId, contactId, tx))) {
          throw new CodedException(
            400,
            'UNKNOWN_CONTACT',
            'The contact is not a contact of the client',
          );
        }
      }

      const to = change.status;
      const now = new Date();
      await tx
        .update(tasks)
        .set({
          status: to,
          ...(to === 'in_progress' && !task.startedAt && { startedAt: now }),
          ...(move === 'deliver' && { deliveredAt: now }),
          ...((move === 'reopen_client' || move === 'reopen_internal') && { deliveredAt: null }),
          ...(move === 'cancel' && { cancelledAt: now, cancelReason: note }),
          ...(move === 'reopen' && { cancelledAt: null, cancelReason: null }),
        })
        .where(eq(tasks.id, id));

      const revision = await this.recordRevision(tx, actor, task, move, note, contactId);
      // Edge case 10: a cancelled out-of-scope request withdraws its unbilled extra work.
      const withdrawn = move === 'cancel' && (await this.withdrawRequestExtraWork(tx, actor, task));

      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.status_changed',
        entityType: 'task',
        entityId: id,
        before: {
          status: task.status,
          ...(withdrawn && { extraWorkItemId: task.extraWorkItemId }),
        },
        after: {
          status: to,
          ...(withdrawn && { extraWorkItemId: null }),
          ...(note && { note }),
          ...(contactId && { contactId }),
          ...(revision && {
            revisionSource: revision.source,
            ...(revision.number && { revisionNumber: revision.number }),
            ...(revision.overLimit && { overLimit: true }),
          }),
          ...(overridden && { overrideReason: change.reason }),
        },
      });
      const overLimit = !!revision?.overLimit;
      await this.notices.send(tx, await this.moveNotices(tx, actor, task, move, overLimit));
    });
    return this.tasks.detail(actor, id);
  }

  /** Rule 10: the account manager decides on an over-limit client revision, once. */
  async decideRevision(
    actor: CurrentUserInfo,
    id: string,
    revisionId: string,
    input: RevisionDecisionInput,
  ): Promise<TaskRevision> {
    await this.db.transaction(async (tx) => {
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (!taskRights(actor, task).client) throw new ForbiddenException();
      assertTaskWritable(task);
      const [revision] = await tx
        .select()
        .from(taskRevisions)
        .where(and(eq(taskRevisions.id, revisionId), eq(taskRevisions.taskId, id)))
        .for('update');
      if (!revision) throw new NotFoundException();
      if (!revision.overLimit) {
        throw new CodedException(409, 'NOT_OVER_LIMIT', 'The revision is within the limit');
      }
      if (revision.decision) {
        throw new CodedException(409, 'ALREADY_DECIDED', 'The revision is already decided');
      }
      let extraWorkItemId: string | null = null;
      if (input.decision === 'extra_work') {
        const owner = await this.tasks.engagementOf(tx, task);
        const item = await this.engagements.createExtraWork(
          tx,
          {
            owner,
            title: revisionExtraWorkTitle(revision.number ?? 0, task.title),
            description: revision.note,
            requestedOn: businessDate(),
            requestedByContactId: revision.contactId,
          },
          actorOf(actor),
        );
        extraWorkItemId = item.id;
      }
      const decisionNote = input.note ?? null;
      await tx
        .update(taskRevisions)
        .set({
          decision: input.decision,
          decisionNote,
          extraWorkItemId,
          decidedById: actor.id,
          decidedAt: new Date(),
        })
        .where(eq(taskRevisions.id, revisionId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.revision_decided',
        entityType: 'task',
        entityId: id,
        after: {
          revisionId,
          revisionNumber: revision.number,
          decision: input.decision,
          ...(decisionNote && { note: decisionNote }),
          ...(extraWorkItemId && { extraWorkItemId }),
        },
      });
    });
    const detail = await this.tasks.detail(actor, id);
    const decided = detail.revisionHistory.find((revision) => revision.id === revisionId);
    if (!decided) throw new NotFoundException();
    return decided;
  }

  /** Replaces every dependency of the task at once (rules 3 and 4). */
  async setDependencies(
    actor: CurrentUserInfo,
    id: string,
    input: TaskDependenciesInput,
  ): Promise<TaskDependencyList> {
    await this.db.transaction(async (tx) => {
      await lockDependencyGraph(tx);
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (!taskRights(actor, task).manage) throw new ForbiddenException();
      assertTaskWritable(task);
      const current = await dependenciesOf(id, tx);
      const currentIds = current.map((d) => d.id);
      const added = input.dependsOn.filter((dependsOn) => !currentIds.includes(dependsOn));
      const removed = currentIds.filter((dependsOn) => !input.dependsOn.includes(dependsOn));
      if (added.length === 0 && removed.length === 0) return;
      // Kept dependencies stay even if they were archived since; added ones are checked.
      const checked = await assertValidDependencies(tx, task, input.dependsOn, added);
      const kept = current.filter((d) => input.dependsOn.includes(d.id));
      const after = [...kept.map((d) => ({ id: d.id, title: d.title })), ...checked];
      if (removed.length > 0) {
        await tx
          .delete(taskDependencies)
          .where(
            and(eq(taskDependencies.taskId, id), inArray(taskDependencies.dependsOnId, removed)),
          );
      }
      if (added.length > 0) {
        await tx
          .insert(taskDependencies)
          .values(added.map((dependsOnId) => ({ taskId: id, dependsOnId, createdById: actor.id })));
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.dependencies_updated',
        entityType: 'task',
        entityId: id,
        before: { dependsOn: current.map((d) => ({ id: d.id, title: d.title })) },
        after: { dependsOn: after },
      });
      // Rule 7 (A03): removing the last open dependency opens a new task.
      if (task.status === 'new' && isTaskBlocked(current) && !(await isBlocked(id, tx))) {
        const recipients = await this.notices.assigneeOrManagers(tx, task);
        await this.notices.send(tx, [
          this.notices.notice(task, 'task_opened', recipients, actor.id),
        ]);
      }
    });
    return { items: await dependenciesOf(id, this.db) };
  }

  /** F14: who hears about a move ("Notification types"); `task` is as it was before the move. */
  private async moveNotices(
    tx: Transaction,
    actor: CurrentUserInfo,
    task: TaskAccess,
    move: TaskMove,
    overLimit: boolean,
  ): Promise<Notice[]> {
    const notice = this.notices.notice.bind(this.notices);
    const assignee = [task.assigneeId];
    const accountManager = task.client?.accountManagerId ?? null;
    switch (move) {
      case 'submit':
      case 'resubmit': {
        const managers = await this.notices.managers(tx, task.department);
        return [notice(task, 'task_review_requested', [...managers, accountManager], actor.id)];
      }
      case 'return':
        return [notice(task, 'task_returned', assignee, actor.id, { source: 'internal' })];
      case 'client_changes':
      case 'reopen_client':
        return [
          notice(task, 'task_returned', assignee, actor.id, { source: 'client' }),
          ...(overLimit ? [notice(task, 'task_over_limit', [accountManager], actor.id)] : []),
        ];
      case 'send_to_client':
        return [
          notice(task, 'task_approved', assignee, actor.id, { source: 'internal' }),
          notice(task, 'task_awaiting_client', [accountManager], actor.id),
        ];
      case 'approve':
      case 'client_approved':
        return [
          notice(task, 'task_approved', assignee, actor.id, {
            source: move === 'approve' ? 'internal' : 'client',
          }),
          ...(await this.notices.openedDependents(tx, [task.id], actor.id)),
        ];
      case 'deliver':
        return [
          notice(task, 'request_finished', [requesterOf(task)], actor.id, {
            outcome: 'delivered',
          }),
        ];
      case 'cancel':
        return [
          ...this.notices.cancelled(task, actor.id),
          // An approved task no longer blocked anything.
          ...(blocksDependents(task)
            ? await this.notices.openedDependents(tx, [task.id], actor.id)
            : []),
        ];
      default:
        return [];
    }
  }

  /** The move the change asks for; `INVALID_TRANSITION` when the workflow has none. */
  private moveOf(task: TaskAccess, change: TaskStatusChange): TaskMove {
    const move = taskMove(task.status, change.status);
    const invalid = () =>
      new CodedException(
        409,
        'INVALID_TRANSITION',
        `A ${task.status} task cannot become ${change.status}`,
      );
    if (!move) throw invalid();
    // A cancelled task reopens to work, or to the queue when unassigned.
    if (move === 'reopen' && change.status !== (task.assigneeId ? 'in_progress' : 'new')) {
      throw invalid();
    }
    // The client step follows the approval flag; client moves need a client.
    if (move === 'send_to_client' && !task.needsClientApproval) throw invalid();
    if (move === 'approve' && task.needsClientApproval) throw invalid();
    if (CLIENT_MOVES.includes(move) && !task.clientId) throw invalid();
    // `revisionSource` may confirm a reopen from delivered; it must match the target.
    if (change.revisionSource && change.revisionSource !== (revisionSourceOf(move) ?? 'internal')) {
      throw invalid();
    }
    return move;
  }

  private state(task: TaskAccess, blocked: boolean) {
    return {
      status: task.status,
      assigneeId: task.assigneeId,
      hasClient: !!task.clientId,
      needsClientApproval: task.needsClientApproval,
      blocked,
    };
  }

  /** Rules 9 and 10: every move to revisions is recorded; client ones count against the limit. */
  private async recordRevision(
    tx: Transaction,
    actor: CurrentUserInfo,
    task: TaskAccess,
    move: TaskMove,
    note: string | null,
    contactId: string | null,
  ) {
    const source = revisionSourceOf(move);
    if (!source || !note) return null;
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
      contactId,
      overLimit: number !== null && number > task.revisionLimit,
      authorId: actor.id,
    };
    await tx.insert(taskRevisions).values(values);
    return values;
  }

  /** Edge case 10: returns whether an unbilled item was withdrawn and unlinked. */
  private async withdrawRequestExtraWork(
    tx: Transaction,
    actor: CurrentUserInfo,
    task: TaskAccess,
  ): Promise<boolean> {
    if (!task.extraWorkItemId) return false;
    const item = (await this.engagements.extraWork([task.extraWorkItemId], tx)).get(
      task.extraWorkItemId,
    );
    if (!item || item.archived || item.billingStatus !== 'unbilled') return false;
    await this.engagements.archiveExtraWork(tx, item.id, actorOf(actor));
    await tx.update(tasks).set({ extraWorkItemId: null }).where(eq(tasks.id, task.id));
    return true;
  }
}
