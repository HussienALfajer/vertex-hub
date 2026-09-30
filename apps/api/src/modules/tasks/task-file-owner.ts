import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { holdsAll, isReadOnly, readableTask, taskRights } from './task-access.js';

type Executor = Database | Transaction;

/**
 * The `task` owner policy of the files module (spec F10, "Changes to earlier features"): task
 * files follow the task's read rules, workers and manage scope add deliverables, every reader
 * adds references, and manage scope removes and marks final.
 */
@Injectable()
export class TaskFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
  ) {}

  onModuleInit(): void {
    this.registry.register('task', {
      find: (executor, actor, id, options) => this.find(executor, actor, id, options),
      ownersOfClient: (executor, clientId) => this.ownersOfClient(executor, clientId),
    });
  }

  private async find(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileOwner> {
    const task = await readableTask(
      executor,
      { clients: this.clients, engagements: this.engagements },
      actor,
      id,
      options,
    );
    const rights = taskRights(actor, task);
    return {
      type: 'task',
      id: task.id,
      clientId: task.clientId,
      clientName: task.client?.name ?? null,
      label: task.title,
      archivedCode: isReadOnly(task) ? 'TASK_ARCHIVED' : null,
      task: {
        status: task.status,
        assigneeId: task.assigneeId,
        snapshot: {
          title: task.title,
          department: task.department,
          client: task.client?.name ?? null,
          project: task.project?.name ?? null,
        },
      },
      rights: {
        addDeliverable: rights.work || rights.manage,
        addReference: true,
        manageTask: rights.manage,
        manageDocuments: false,
        confidentialReader: false,
        scopeAll: holdsAll(actor, 'tasks.manage'),
      },
    };
  }

  /**
   * Rule 13: the library shows files of non-archived, non-cancelled tasks; a task of an archived
   * project or retainer is read-only and hidden (rule 17 of F06), so its files are left out too.
   */
  private async ownersOfClient(executor: Executor, clientId: string) {
    const rows = await executor
      .select({
        id: tasks.id,
        label: tasks.title,
        projectId: tasks.projectId,
        cycleId: tasks.retainerCycleId,
      })
      .from(tasks)
      .where(
        and(eq(tasks.clientId, clientId), isNull(tasks.archivedAt), ne(tasks.status, 'cancelled')),
      )
      .orderBy(asc(tasks.id));
    const [projects, cycles] = await Promise.all([
      this.engagements.projects(
        rows.flatMap((row) => (row.projectId ? [row.projectId] : [])),
        executor,
      ),
      this.engagements.cycles(
        rows.flatMap((row) => (row.cycleId ? [row.cycleId] : [])),
        executor,
      ),
    ]);
    return rows
      .filter(
        (row) =>
          !(row.projectId && projects.get(row.projectId)?.archived) &&
          !(row.cycleId && cycles.get(row.cycleId)?.retainerArchived),
      )
      .map((row) => ({ id: row.id, label: row.label }));
  }
}
