import { Injectable } from '@nestjs/common';
import {
  type HandoverEntry,
  runDependencies,
  type TaskStage,
  type TaskStatus,
} from '@vertex-hub/contracts';
import {
  type Database,
  type Transaction,
  taskDependencies,
  taskStages,
  tasks,
} from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { personRef, UserDirectory } from '../auth/index.js';
import { FileVersions } from '../files/index.js';
import type { Notice } from '../notifications/index.js';
import { blockedIds, closesCycle } from './task-dependencies.js';
import { TaskNotices } from './task-notices.js';

type Executor = Database | Transaction;

/** A subtask as the run and the handover read it. */
type SubtaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  position: number | null;
  stageId: string | null;
  handoverNote: string | null;
  dueDate: string;
  dueTime: string | null;
  archivedAt: Date | null;
};

const subtaskColumns = {
  id: tasks.id,
  title: tasks.title,
  status: tasks.status,
  assigneeId: tasks.assigneeId,
  position: tasks.position,
  stageId: tasks.stageId,
  handoverNote: tasks.handoverNote,
  dueDate: tasks.dueDate,
  dueTime: tasks.dueTime,
  archivedAt: tasks.archivedAt,
};

/** Neither cancelled nor archived: the subtasks the run, the progress and the stages count. */
const isLive = (subtask: SubtaskRow) => !subtask.archivedAt && subtask.status !== 'cancelled';

/**
 * The run of a parent's subtasks (F06B rules A3, A4, A6, A9 and A12): keeps its `run` dependencies
 * equal to what the run mode and the order imply, tells the subtasks that wait again or open, and
 * notices when a stage or the whole set is delivered.
 */
@Injectable()
export class SubtaskRuns {
  constructor(
    private readonly notices: TaskNotices,
    private readonly users: UserDirectory,
    private readonly files: FileVersions,
  ) {}

  /** The parent's subtasks, archived ones included, by position. */
  subtasksOf(executor: Executor, parentId: string): Promise<SubtaskRow[]> {
    return executor
      .select(subtaskColumns)
      .from(tasks)
      .where(eq(tasks.parentId, parentId))
      .orderBy(asc(tasks.position), asc(tasks.id));
  }

  /** The parent's non-archived stages, by position. */
  stagesOf(executor: Executor, parentId: string) {
    return executor
      .select({ id: taskStages.id, name: taskStages.name, position: taskStages.position })
      .from(taskStages)
      .where(and(eq(taskStages.taskId, parentId), isNull(taskStages.archivedAt)))
      .orderBy(asc(taskStages.position));
  }

  /**
   * Rule A4: rewrites the parent's `run` dependencies after its mode, order, stages or set of
   * live subtasks changed. A started subtask stays started (F06 edge case 3); a `new` or started
   * one that waits again is told (`task_blocked`), and a `new` one no longer waiting opens. The
   * caller took `lockDependencyGraph` and the parent's lock. `DEPENDENCY_CYCLE` when the new
   * order contradicts a manual dependency between the subtasks.
   */
  async sync(tx: Transaction, parentId: string, actorId: string | null): Promise<void> {
    const [parent] = await tx
      .select({ runMode: tasks.runMode })
      .from(tasks)
      .where(eq(tasks.id, parentId));
    const subtasks = await this.subtasksOf(tx, parentId);
    if (!parent || subtasks.length === 0) return;
    const ids = subtasks.map((subtask) => subtask.id);
    const stagePositions = new Map(
      (await this.stagesOf(tx, parentId)).map((stage) => [stage.id, stage.position]),
    );
    const wanted = parent.runMode
      ? runDependencies(
          parent.runMode,
          subtasks.filter(isLive).map((subtask) => ({
            id: subtask.id,
            position: subtask.position ?? 0,
            stagePosition: subtask.stageId ? (stagePositions.get(subtask.stageId) ?? null) : null,
          })),
        )
      : [];
    const existing = await tx
      .select({
        taskId: taskDependencies.taskId,
        dependsOnId: taskDependencies.dependsOnId,
        source: taskDependencies.source,
      })
      .from(taskDependencies)
      .where(
        and(inArray(taskDependencies.taskId, ids), inArray(taskDependencies.dependsOnId, ids)),
      );
    const key = (edge: { taskId: string; dependsOnId: string }) =>
      `${edge.taskId}>${edge.dependsOnId}`;
    // A manual dependency the run also implies stays manual.
    const manual = new Set(existing.filter((e) => e.source === 'manual').map(key));
    const run = new Set(existing.filter((e) => e.source === 'run').map(key));
    const want = wanted.filter((edge) => !manual.has(key(edge)));
    const wantKeys = new Set(want.map(key));
    const added = want.filter((edge) => !run.has(key(edge)));
    const removed = existing.filter((e) => e.source === 'run' && !wantKeys.has(key(e)));
    if (added.length === 0 && removed.length === 0) return;

    const watched = subtasks.filter(
      (subtask) =>
        isLive(subtask) && (subtask.status === 'new' || subtask.status === 'in_progress'),
    );
    const watchedIds = watched.map((subtask) => subtask.id);
    const blockedBefore = await blockedIds(watchedIds, tx);
    if (removed.length > 0) {
      await tx
        .delete(taskDependencies)
        .where(
          or(
            ...removed.map((edge) =>
              and(
                eq(taskDependencies.taskId, edge.taskId),
                eq(taskDependencies.dependsOnId, edge.dependsOnId),
              ),
            ),
          ),
        );
    }
    if (added.length > 0) {
      await tx
        .insert(taskDependencies)
        .values(added.map((edge) => ({ ...edge, source: 'run' as const, createdById: actorId })));
      for (const edge of added) {
        if (await closesCycle(tx, edge.taskId, edge.dependsOnId)) {
          throw new CodedException(
            409,
            'DEPENDENCY_CYCLE',
            'The order contradicts a dependency between the subtasks',
          );
        }
      }
    }
    const blockedAfter = await blockedIds(watchedIds, tx);

    const notices: Notice[] = [];
    for (const subtask of watched) {
      const was = blockedBefore.has(subtask.id);
      const is = blockedAfter.has(subtask.id);
      if (was === is) continue;
      const task = await this.notices.load(tx, subtask.id);
      if (is) {
        // Rule A4: it waits again; its turn is no longer due.
        notices.push(this.notices.notice(task, 'task_blocked', [task.assigneeId], actorId));
        await this.notices.resolve(tx, {
          subject: { type: 'task', id: task.id },
          types: ['subtask_turn', 'subtask_handover'],
          outcome: 'void',
          actorId,
        });
      } else if (subtask.status === 'new') {
        notices.push(
          (await this.notices.subtaskOpened(tx, task, actorId)) ??
            this.notices.notice(
              task,
              'task_opened',
              await this.notices.assigneeOrManagers(tx, task),
              actorId,
            ),
        );
      }
    }
    await this.notices.send(tx, notices);
  }

  /**
   * Rules A9 and A12, after a subtask was delivered: when its stage is finished, the handover
   * summary is audited on the stage and the parent's assignee told; when every live subtask is
   * delivered, the parent's assignee hears it. Recipients fall back to the parent's department
   * managers.
   */
  async delivered(
    tx: Transaction,
    subtask: { id: string; parentId: string | null; stageId: string | null },
    actor: AuditActor,
  ): Promise<Notice[]> {
    if (!subtask.parentId) return [];
    const parent = await this.notices.load(tx, subtask.parentId);
    const live = (await this.subtasksOf(tx, parent.id)).filter(isLive);
    const recipients = await this.notices.assigneeOrManagers(tx, parent);
    const notices: Notice[] = [];
    const stageSubtasks = live.filter((s) => !!subtask.stageId && s.stageId === subtask.stageId);
    if (
      parent.runMode === 'stages' &&
      stageSubtasks.length > 0 &&
      stageSubtasks.every((s) => s.status === 'delivered')
    ) {
      const [stage] = await tx
        .select({ id: taskStages.id, name: taskStages.name })
        .from(taskStages)
        .where(eq(taskStages.id, subtask.stageId as string));
      if (stage) {
        const handover = await this.handover(tx, stageSubtasks);
        await recordAudit(tx, {
          actor,
          action: 'task_stage.finished',
          entityType: 'task_stage',
          entityId: stage.id,
          after: {
            taskId: parent.id,
            name: stage.name,
            handover: handover.map((entry) => ({
              title: entry.title,
              by: entry.assignee?.name ?? null,
              note: entry.note,
              finals: entry.finals.map((file) => file.name),
            })),
          },
        });
        notices.push(
          this.notices.notice(parent, 'subtask_stage_finished', recipients, actor.id, {
            stage: stage.name,
          }),
        );
      }
    }
    if (live.length > 0 && live.every((s) => s.status === 'delivered')) {
      notices.push(this.notices.notice(parent, 'subtasks_all_finished', recipients, actor.id));
    }
    return notices;
  }

  /** Rule A10: a subtask added or reopened, so the parent no longer has everything delivered. */
  rearm(tx: Transaction, parentId: string, actorId: string | null): Promise<number> {
    return this.notices.resolve(tx, {
      subject: { type: 'task', id: parentId },
      types: ['subtasks_all_finished'],
      outcome: 'void',
      actorId,
    });
  }

  /** The parent's stages for its page, each finished one with its handover (rule A12). */
  async stages(executor: Executor, parentId: string): Promise<TaskStage[]> {
    const [stages, subtasks] = await Promise.all([
      this.stagesOf(executor, parentId),
      this.subtasksOf(executor, parentId),
    ]);
    const live = subtasks.filter(isLive);
    const result: TaskStage[] = [];
    for (const stage of stages) {
      const own = live.filter((s) => s.stageId === stage.id);
      const finished = own.length > 0 && own.every((s) => s.status === 'delivered');
      result.push({
        id: stage.id,
        name: stage.name,
        position: stage.position,
        finished,
        handover: finished ? await this.handover(executor, own) : null,
      });
    }
    return result;
  }

  /** The delivered subtasks among `subtasks`: who did each, their note and their finals. */
  private async handover(executor: Executor, subtasks: SubtaskRow[]): Promise<HandoverEntry[]> {
    const delivered = subtasks.filter((s) => s.status === 'delivered');
    const [people, finals] = await Promise.all([
      this.users.summaries(
        delivered.flatMap((s) => (s.assigneeId ? [s.assigneeId] : [])),
        executor,
      ),
      this.files.finalVersions(
        delivered.map((s) => s.id),
        executor,
      ),
    ]);
    return delivered.map((s) => ({
      id: s.id,
      title: s.title,
      assignee: s.assigneeId ? personRef(people, s.assigneeId) : null,
      note: s.handoverNote,
      finals: (finals.get(s.id) ?? []).map((v) => ({ fileItemId: v.fileItemId, name: v.name })),
    }));
  }
}
