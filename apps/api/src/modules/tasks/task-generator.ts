import { Inject, Injectable } from '@nestjs/common';
import type { DepartmentCode, TaskPriority, TaskStatus } from '@vertex-hub/contracts';
import {
  type Database,
  newId,
  type Transaction,
  taskChecklistItems,
  taskDependencies,
  tasks,
} from '@vertex-hub/db';
import { inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { readableTask } from './task-access.js';

/** A task another module generates (F07): `dependsOn` holds keys of drafts of the same batch. */
export interface TaskDraft {
  key: string;
  title: string;
  brief: string | null;
  department: DepartmentCode;
  assigneeId: string | null;
  priority: TaskPriority;
  dueDate: string;
  clientId: string;
  projectId: string | null;
  milestoneId: string | null;
  retainerCycleId: string | null;
  cycleLineId: string | null;
  needsClientApproval: boolean;
  revisionLimit: number;
  checklist: string[];
  dependsOn: string[];
}

/**
 * Creates tasks for the `templates` module (spec F07, "Changes to other modules") in the caller's
 * transaction, and checks that a task is readable for its run history. The caller has checked
 * the links, assignees and due dates (F06 rules 6, 7 and 12); the drafts are `work` tasks in
 * status `new`.
 */
@Injectable()
export class TaskGenerator {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
  ) {}

  /** 404 unless the actor may read the task (F06, rule 17 for read-only tasks). */
  async assertReadable(actor: CurrentUserInfo, id: string): Promise<void> {
    await readableTask(
      this.db,
      { clients: this.clients, engagements: this.engagements },
      actor,
      id,
    );
  }

  /**
   * Inserts the drafts, their checklists and dependencies, and a `task.created` entry per task
   * with `templateRunId`. A null actor is the system: the tasks have no creator. Returns the new
   * task id of each draft key.
   */
  async createMany(
    tx: Transaction,
    drafts: TaskDraft[],
    actor: AuditActor | null,
    templateRunId: string,
  ): Promise<Map<string, string>> {
    const ids = new Map(drafts.map((draft) => [draft.key, newId()]));
    if (drafts.length === 0) return ids;
    const idOf = (key: string) => ids.get(key) as string;
    const valuesOf = ({ key, checklist, dependsOn, ...draft }: TaskDraft) => draft;
    await tx.insert(tasks).values(
      drafts.map((draft) => ({
        ...valuesOf(draft),
        id: idOf(draft.key),
        type: 'work' as const,
        createdById: actor?.id ?? null,
      })),
    );
    const checklist = drafts.flatMap((draft) =>
      draft.checklist.map((text, index) => ({
        taskId: idOf(draft.key),
        text,
        position: index + 1,
      })),
    );
    if (checklist.length > 0) await tx.insert(taskChecklistItems).values(checklist);
    const dependencies = drafts.flatMap((draft) =>
      draft.dependsOn
        .filter((key) => ids.has(key))
        .map((key) => ({
          taskId: idOf(draft.key),
          dependsOnId: idOf(key),
          createdById: actor?.id ?? null,
        })),
    );
    if (dependencies.length > 0) await tx.insert(taskDependencies).values(dependencies);

    const titles = new Map(drafts.map((draft) => [draft.key, draft.title]));
    for (const draft of drafts) {
      const dependsOn = draft.dependsOn
        .filter((key) => ids.has(key))
        .map((key) => ({ id: idOf(key), title: titles.get(key) }));
      await recordAudit(tx, {
        actor,
        action: 'task.created',
        entityType: 'task',
        entityId: idOf(draft.key),
        after: {
          ...valuesOf(draft),
          type: 'work',
          templateRunId,
          ...(dependsOn.length > 0 && { dependsOn }),
          ...(draft.checklist.length > 0 && { checklist: draft.checklist }),
        },
      });
    }
    return ids;
  }

  /** Titles and statuses of tasks, for a run's task list. */
  async summaries(
    executor: Database | Transaction,
    ids: string[],
  ): Promise<Map<string, { id: string; title: string; status: TaskStatus; archived: boolean }>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(inArray(tasks.id, [...new Set(ids)]));
    return new Map(
      rows.map(({ archivedAt, ...row }) => [row.id, { ...row, archived: !!archivedAt }]),
    );
  }
}
