import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateSubtask,
  type CreateTaskStage,
  DEFAULT_REVISION_LIMIT,
  type HandoverNoteInput,
  type ReopenSubtasks,
  SUBTASK_LIMITS,
  type SubtaskOrder,
  type SubtaskRunModeInput,
  type TaskDetail,
  type TaskStage,
  type TaskSubtasks,
  type UpdateTaskStage,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskStages, tasks } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { FileAttachments } from '../files/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { SubtaskRuns } from './subtask-runs.js';
import {
  accessColumns,
  actorOf,
  assertParentOpen,
  assertTaskWritable,
  dueAfter,
  managesSubtasks,
  readableTask,
  reopensSubtasks,
  type TaskAccess,
  taskRights,
} from './task-access.js';
import { lockDependencyGraph } from './task-dependencies.js';
import { TaskNotices } from './task-notices.js';
import { restartQuestionClocks } from './task-questions.js';
import { TaskQuestionsService } from './task-questions.service.js';
import { TaskReviews } from './task-reviews.js';
import { TasksService } from './tasks.service.js';

/** The first stage when a parent switches to stages without one (rule A4); stored in Arabic. */
const FIRST_STAGE_NAME = 'المرحلة 1';

/**
 * A parent's subtasks (spec F06B part A): adding them, their order and run mode, stages,
 * reopening chosen ones while the parent is in revisions, and handover notes. Every change runs
 * under the dependency graph's lock and the parent's row lock, then rewrites the run.
 */
@Injectable()
export class TaskSubtasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly users: UserDirectory,
    private readonly tasks: TasksService,
    private readonly runs: SubtaskRuns,
    private readonly notices: TaskNotices,
    private readonly reviews: TaskReviews,
    private readonly questions: TaskQuestionsService,
    private readonly attachments: FileAttachments,
  ) {}

  private get directories() {
    return { clients: this.clients, engagements: this.engagements };
  }

  /**
   * Rule A2: a subtask added to an open parent, checked as its own create; rule B11: made from a
   * question or a comment of the parent's thread or of one of its subtasks'.
   */
  async add(actor: CurrentUserInfo, parentId: string, input: CreateSubtask): Promise<TaskDetail> {
    const { id, preview } = await this.db.transaction(async (tx) => {
      // The access lock comes first, as in every create with an assignee (F01 change).
      if (input.assigneeId) await lockAccessChanges(tx);
      const parent = await this.lockParent(tx, actor, parentId);
      const source = input.fromCommentId
        ? await this.questions.convertSource(tx, parentId, input.fromCommentId)
        : null;
      const subtasks = await this.runs.subtasksOf(tx, parentId);
      const kept = subtasks.filter((s) => !s.archivedAt);
      if (kept.filter((s) => s.status !== 'cancelled').length >= SUBTASK_LIMITS.subtasks) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A task holds at most 30 subtasks');
      }
      // A parent's first subtask gives it a run mode: one after another by default.
      const runMode = parent.runMode ?? 'sequential';
      if (!parent.runMode) await this.writeRunMode(tx, actor, parent, runMode);
      const stageId = await this.stageFor(tx, parentId, runMode, input.stageId ?? null);
      const due = { dueDate: input.dueDate, dueTime: input.dueTime ?? null };
      if (dueAfter(due, parent)) {
        throw new CodedException(400, 'INVALID_DATES', 'A subtask is due no later than its parent');
      }
      const position = Math.min(input.position ?? kept.length + 1, kept.length + 1);
      // The ones from that place on move down one.
      for (const subtask of kept) {
        if ((subtask.position ?? 0) >= position) {
          await tx
            .update(tasks)
            .set({ position: (subtask.position ?? 0) + 1 })
            .where(eq(tasks.id, subtask.id));
        }
      }
      const created = await this.tasks.createIn(
        tx,
        actor,
        {
          type: 'work',
          title: input.title,
          brief: input.brief ?? null,
          briefDoc: input.briefDoc,
          department: input.department,
          assigneeId: input.assigneeId,
          priority: input.priority,
          dueDate: input.dueDate,
          dueTime: input.dueTime ?? null,
          clientId: parent.clientId,
          projectId: parent.projectId,
          milestoneId: null,
          retainerCycleId: parent.retainerCycleId,
          cycleLineId: null,
          needsClientApproval: false,
          revisionLimit: DEFAULT_REVISION_LIMIT,
          dependsOn: [],
          checklist: input.checklist,
          criteria: input.criteria,
          briefFields: input.briefFields,
          estimateMinutes: input.estimateMinutes,
          links: [],
          requestScope: undefined,
          acceptLeave: input.acceptLeave,
        },
        {
          checkLeave: true,
          // Rule A1: the parent's links, kept even if its cycle closed since.
          inheritsLinks: true,
          parent: { id: parentId, position, stageId, assigneeId: parent.assigneeId },
        },
      );
      const filesPreview = await this.attachments.attachToTask(
        tx,
        actor,
        { taskId: created, clientId: parent.clientId },
        input.files,
      );
      const preview = source
        ? await this.questions.converted(tx, actor, source, {
            id: created,
            title: input.title,
            clientId: parent.clientId,
          })
        : false;
      await this.runs.sync(tx, parentId, actor.id);
      await this.runs.rearm(tx, parentId, actor.id);
      return { id: created, preview: preview || filesPreview };
    });
    if (preview) await this.attachments.queuePreviews();
    return this.tasks.detail(actor, id);
  }

  /** Rule A4: the whole order at once, each subtask with its stage. */
  async order(
    actor: CurrentUserInfo,
    parentId: string,
    input: SubtaskOrder,
  ): Promise<TaskSubtasks> {
    await this.db.transaction(async (tx) => {
      const parent = await this.lockParent(tx, actor, parentId);
      const kept = (await this.runs.subtasksOf(tx, parentId)).filter((s) => !s.archivedAt);
      const ids = input.items.map((item) => item.id);
      const invalid = () =>
        new CodedException(409, 'INVALID_ORDER', 'The order must list every subtask once');
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== kept.length ||
        kept.some((s) => !ids.includes(s.id))
      ) {
        throw invalid();
      }
      const stages = new Map(
        (await this.runs.stagesOf(tx, parentId)).map((stage) => [stage.id, stage.name]),
      );
      const byStage = parent.runMode === 'stages';
      if (
        input.items.some((item) =>
          byStage ? !item.stageId || !stages.has(item.stageId) : item.stageId !== null,
        )
      ) {
        throw invalid();
      }
      const before = kept.map((s) => ({ id: s.id, position: s.position, stageId: s.stageId }));
      let changed = false;
      for (const [index, item] of input.items.entries()) {
        const current = kept.find((s) => s.id === item.id);
        if (current?.position === index + 1 && current.stageId === item.stageId) continue;
        changed = true;
        await tx
          .update(tasks)
          .set({ position: index + 1, stageId: item.stageId })
          .where(eq(tasks.id, item.id));
      }
      if (!changed) return;
      const titleOf = (id: string) => kept.find((s) => s.id === id)?.title ?? '';
      const describe = (list: { id: string; stageId: string | null }[]) =>
        list.map((item) => ({
          title: titleOf(item.id),
          ...(item.stageId && { stage: stages.get(item.stageId) ?? null }),
        }));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.subtasks_reordered',
        entityType: 'task',
        entityId: parentId,
        before: {
          order: describe([...before].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))),
        },
        after: { order: describe(input.items) },
      });
      await this.runs.sync(tx, parentId, actor.id);
    });
    return this.subtasks(parentId);
  }

  /** Rule A4: switching to stages puts every subtask in the first stage; leaving keeps them. */
  async setRunMode(
    actor: CurrentUserInfo,
    parentId: string,
    input: SubtaskRunModeInput,
  ): Promise<TaskSubtasks> {
    await this.db.transaction(async (tx) => {
      const parent = await this.lockParent(tx, actor, parentId);
      if (parent.runMode === input.runMode) return;
      await this.writeRunMode(tx, actor, parent, input.runMode);
      let stageId: string | null = null;
      if (input.runMode === 'stages') {
        const [first] = await this.runs.stagesOf(tx, parentId);
        stageId =
          first?.id ??
          (await this.runs.insertStage(tx, actorOf(actor), parentId, FIRST_STAGE_NAME, 1));
      }
      await tx
        .update(tasks)
        .set({ stageId })
        .where(and(eq(tasks.parentId, parentId), isNull(tasks.archivedAt)));
      await this.runs.sync(tx, parentId, actor.id);
    });
    return this.subtasks(parentId);
  }

  async createStage(
    actor: CurrentUserInfo,
    parentId: string,
    input: CreateTaskStage,
  ): Promise<TaskStage> {
    const id = await this.db.transaction(async (tx) => {
      await this.lockParent(tx, actor, parentId);
      const stages = await this.runs.stagesOf(tx, parentId);
      if (stages.length >= SUBTASK_LIMITS.stages) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A task holds at most 10 stages');
      }
      const position = Math.min(input.position ?? stages.length + 1, stages.length + 1);
      for (const stage of stages) {
        if (stage.position >= position) {
          await tx
            .update(taskStages)
            .set({ position: stage.position + 1 })
            .where(eq(taskStages.id, stage.id));
        }
      }
      const created = await this.runs.insertStage(
        tx,
        actorOf(actor),
        parentId,
        input.name,
        position,
      );
      await this.runs.sync(tx, parentId, actor.id);
      return created;
    });
    return this.stage(parentId, id);
  }

  async updateStage(
    actor: CurrentUserInfo,
    parentId: string,
    stageId: string,
    input: UpdateTaskStage,
  ): Promise<TaskStage> {
    await this.db.transaction(async (tx) => {
      await this.lockParent(tx, actor, parentId);
      const stages = await this.runs.stagesOf(tx, parentId);
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) throw new NotFoundException();
      const position = Math.min(input.position ?? stage.position, stages.length);
      const change = changedFields(
        { name: stage.name, position: stage.position },
        { name: input.name, position },
      );
      if (!change) return;
      if (position !== stage.position) {
        const others = stages.filter((s) => s.id !== stageId);
        others.splice(position - 1, 0, stage);
        for (const [index, other] of others.entries()) {
          if (other.position !== index + 1) {
            await tx
              .update(taskStages)
              .set({ position: index + 1 })
              .where(eq(taskStages.id, other.id));
          }
        }
      }
      if (input.name !== undefined && input.name !== stage.name) {
        await tx.update(taskStages).set({ name: input.name }).where(eq(taskStages.id, stageId));
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_stage.updated',
        entityType: 'task_stage',
        entityId: stageId,
        before: change.before,
        after: { ...change.after, taskId: parentId },
      });
      await this.runs.sync(tx, parentId, actor.id);
    });
    return this.stage(parentId, stageId);
  }

  /** Only a stage without non-archived subtasks is removed (`STAGE_NOT_EMPTY`). */
  async archiveStage(actor: CurrentUserInfo, parentId: string, stageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockParent(tx, actor, parentId);
      const stages = await this.runs.stagesOf(tx, parentId);
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) throw new NotFoundException();
      const subtasks = await this.runs.subtasksOf(tx, parentId);
      if (subtasks.some((s) => !s.archivedAt && s.stageId === stageId)) {
        throw new CodedException(
          409,
          'STAGE_NOT_EMPTY',
          'Move the subtasks out of the stage first',
        );
      }
      await tx.update(taskStages).set({ archivedAt: new Date() }).where(eq(taskStages.id, stageId));
      for (const [index, other] of stages.filter((s) => s.id !== stageId).entries()) {
        if (other.position !== index + 1) {
          await tx
            .update(taskStages)
            .set({ position: index + 1 })
            .where(eq(taskStages.id, other.id));
        }
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task_stage.archived',
        entityType: 'task_stage',
        entityId: stageId,
        before: { archived: false },
        after: { archived: true, taskId: parentId, name: stage.name },
      });
    });
  }

  /**
   * Rule A10: while the parent is in revisions, chosen delivered subtasks go back to work, each
   * with an internal revision carrying its note; the others stay delivered.
   */
  async reopen(
    actor: CurrentUserInfo,
    parentId: string,
    input: ReopenSubtasks,
  ): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      // Reopened work must not go back to an archived user (F06 rule 6): the access lock first.
      await lockAccessChanges(tx);
      await lockDependencyGraph(tx);
      const parent = await readableTask(tx, this.directories, actor, parentId, {
        forUpdate: true,
      });
      if (!reopensSubtasks(actor, parent)) throw new ForbiddenException();
      assertTaskWritable(parent);
      const invalid = (message: string) => new CodedException(409, 'INVALID_TRANSITION', message);
      if (parent.status !== 'revisions') throw invalid('The parent is not in revisions');
      const ids = input.items.map((item) => item.id);
      const rows = await tx
        .select(accessColumns)
        .from(tasks)
        .where(and(eq(tasks.parentId, parentId), inArray(tasks.id, ids)))
        .orderBy(asc(tasks.id))
        .for('update');
      if (rows.length !== ids.length) throw new NotFoundException();
      if (rows.some((row) => row.status !== 'delivered' || row.archivedAt)) {
        throw invalid('Only delivered subtasks are reopened');
      }
      for (const row of rows) {
        if (row.assigneeId && !(await this.users.activeUser(row.assigneeId, tx))) {
          throw new CodedException(
            409,
            'INVALID_ASSIGNEE',
            'The assignee is archived: assign the subtask to someone else first',
          );
        }
      }
      // F06 edge case 3: the work they held that is free now waits again.
      const freeDependents = await this.runs.freeDependents(
        tx,
        rows.map((row) => row.id),
      );
      const reopened: { id: string; title: string; note: string }[] = [];
      for (const row of rows) {
        const note = input.items.find((item) => item.id === row.id)?.note ?? '';
        await tx
          .update(tasks)
          .set({ status: 'in_progress', reviewStage: null, deliveredAt: null })
          .where(eq(tasks.id, row.id));
        await this.reviews.recordRevision(tx, row, 'internal', note, null, actor.id);
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'task.status_changed',
          entityType: 'task',
          entityId: row.id,
          before: { status: row.status },
          after: { status: 'in_progress', note, revisionSource: 'internal', parentId },
        });
        const task = await this.notices.load(tx, row.id);
        await this.notices.sendChange(tx, row, actor.id, [
          this.notices.notice(task, 'task_reopened', [task.assigneeId], actor.id),
        ]);
        reopened.push({ id: row.id, title: row.title, note });
      }
      // Rule B10: back to work, their open questions count from now again.
      await restartQuestionClocks(
        tx,
        rows.map((row) => row.id),
        new Date(),
      );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.subtasks_reopened',
        entityType: 'task',
        entityId: parentId,
        after: { subtasks: reopened },
      });
      await this.runs.sync(tx, parentId, actor.id);
      await this.runs.rearm(tx, parentId, actor.id);
      await this.notices.send(tx, await this.runs.blockedAgain(tx, actor.id, freeDependents));
    });
    return this.tasks.detail(actor, parentId);
  }

  /** Rule A12: the subtask's assignee or its department managers write its handover note. */
  async setHandoverNote(
    actor: CurrentUserInfo,
    id: string,
    input: HandoverNoteInput,
  ): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (!task.parentId) {
        throw new CodedException(400, 'INVALID_LINK', 'Only a subtask has a handover note');
      }
      if (!taskRights(actor, task).work) throw new ForbiddenException();
      assertTaskWritable(task);
      if (task.handoverNote === input.note) return;
      await tx.update(tasks).set({ handoverNote: input.note }).where(eq(tasks.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.handover_noted',
        entityType: 'task',
        entityId: id,
        before: { handoverNote: task.handoverNote },
        after: { handoverNote: input.note, parentId: task.parentId },
      });
    });
    return this.tasks.detail(actor, id);
  }

  /** The parent's run mode, stages and subtasks. */
  async subtasks(parentId: string): Promise<TaskSubtasks> {
    const [[parent], stages, subtasks] = await Promise.all([
      this.db.select({ runMode: tasks.runMode }).from(tasks).where(eq(tasks.id, parentId)),
      this.runs.stages(this.db, parentId),
      this.tasks.subtaskItems(this.db, parentId, new Date()),
    ]);
    return { runMode: parent?.runMode ?? null, stages, subtasks };
  }

  private async stage(parentId: string, stageId: string): Promise<TaskStage> {
    const stage = (await this.runs.stages(this.db, parentId)).find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException();
    return stage;
  }

  /**
   * The graph lock, then the parent's row lock; the caller must manage the parent's subtasks
   * (manage scope or its assignee) and the parent must take changes (rule A2).
   */
  private async lockParent(
    tx: Transaction,
    actor: CurrentUserInfo,
    parentId: string,
  ): Promise<TaskAccess> {
    await lockDependencyGraph(tx);
    const parent = await readableTask(tx, this.directories, actor, parentId, { forUpdate: true });
    if (parent.parentId) {
      throw new CodedException(409, 'SUBTASK_DEPTH', 'A subtask has no subtasks');
    }
    if (!managesSubtasks(actor, parent)) throw new ForbiddenException();
    assertParentOpen(parent);
    return parent;
  }

  /** Rule A3: the stage a new subtask goes in; required by stages, refused otherwise. */
  private async stageFor(
    tx: Transaction,
    parentId: string,
    runMode: string,
    stageId: string | null,
  ): Promise<string | null> {
    if (runMode !== 'stages') {
      if (stageId) throw new BadRequestException('Stages apply only when the task runs by stages');
      return null;
    }
    if (!stageId) throw new BadRequestException('Choose the stage of the subtask');
    const stages = await this.runs.stagesOf(tx, parentId);
    if (!stages.some((stage) => stage.id === stageId)) throw new NotFoundException();
    return stageId;
  }

  private async writeRunMode(
    tx: Transaction,
    actor: CurrentUserInfo,
    parent: TaskAccess,
    runMode: NonNullable<TaskAccess['runMode']>,
  ): Promise<void> {
    await tx.update(tasks).set({ runMode }).where(eq(tasks.id, parent.id));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task.run_mode_changed',
      entityType: 'task',
      entityId: parent.id,
      before: { runMode: parent.runMode },
      after: { runMode },
    });
  }
}
