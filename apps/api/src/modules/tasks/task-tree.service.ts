import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  bottleneck,
  isTaskOpen,
  type Task,
  type TaskTree,
  type TaskTreeNode,
  type TaskTreeQuery,
} from '@vertex-hub/contracts';
import { type Database, taskDependencies, tasks } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { accessColumns, holdsAll } from './task-access.js';
import { TasksService } from './tasks.service.js';

type TreeItem = Omit<Task, 'parent'> & { parentId: string | null; position: number | null };

const nodeOf = (item: TreeItem) => ({
  id: item.id,
  title: item.title,
  department: item.department,
  assignee: item.assignee,
  status: item.status,
  dueDate: item.dueDate,
  dueTime: item.dueTime,
  overdue: item.overdue,
  blocked: item.blocked,
  estimateMinutes: item.estimateMinutes,
});

/**
 * The tree of a project's or a retainer cycle's tasks (spec F06B rule D4): milestones, their
 * tasks and each parent's subtasks, the "waits for" arrows, and the bottleneck.
 */
@Injectable()
export class TaskTreeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly engagements: EngagementDirectory,
    private readonly tasks: TasksService,
  ) {}

  /**
   * 404 for a project or cycle the actor may not read; read-only tasks (an archived client,
   * F06 rule 17) are left out below scope all, as in the list.
   */
  async tree(actor: CurrentUserInfo, query: TaskTreeQuery): Promise<TaskTree> {
    const milestones = query.projectId
      ? await this.milestones(actor, query.projectId)
      : await this.cycle(actor, query.retainerCycleId as string);
    const visible = holdsAll(actor, 'tasks.manage')
      ? isNull(tasks.archivedAt)
      : this.tasks.visibleSql();
    const rows = await this.db
      .select(accessColumns)
      .from(tasks)
      .where(
        and(
          query.projectId
            ? eq(tasks.projectId, query.projectId)
            : eq(tasks.retainerCycleId, query.retainerCycleId as string),
          visible,
        ),
      )
      .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.id));
    const items = await this.tasks.present(rows, this.db, new Date());
    const byId = new Map(
      items.map((item, index) => [
        item.id,
        {
          ...item,
          parentId: rows[index]?.parentId ?? null,
          position: rows[index]?.position ?? null,
        },
      ]),
    );
    const ids = [...byId.keys()];
    const edges = ids.length
      ? await this.db
          .select({
            taskId: taskDependencies.taskId,
            dependsOnId: taskDependencies.dependsOnId,
            source: taskDependencies.source,
          })
          .from(taskDependencies)
          .where(inArray(taskDependencies.taskId, ids))
          .orderBy(asc(taskDependencies.taskId), asc(taskDependencies.dependsOnId))
      : [];
    const outsideIds = [...new Set(edges.map((edge) => edge.dependsOnId))].filter(
      (id) => !byId.has(id),
    );
    const outside = outsideIds.length
      ? await this.db
          .select({ id: tasks.id, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(and(inArray(tasks.id, outsideIds), visible))
          .orderBy(asc(tasks.title))
      : [];

    const runModes = new Map(rows.map((row) => [row.id, row.runMode]));
    const all = [...byId.values()];
    const treeNode = (item: TreeItem): TaskTreeNode => ({
      ...nodeOf(item),
      runMode: runModes.get(item.id) ?? null,
      subtasks: all
        .filter((subtask) => subtask.parentId === item.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(nodeOf),
    });
    // A subtask whose parent is in another project or cycle is shown at the top level.
    const topLevel = all.filter((item) => !item.parentId || !byId.has(item.parentId));
    const groups: TaskTree['groups'] = milestones.map((milestone) => ({
      milestone,
      tasks: topLevel.filter((item) => item.milestone?.id === milestone.id).map(treeNode),
    }));
    const known = new Set(milestones.map((milestone) => milestone.id));
    const rest = topLevel.filter((item) => !item.milestone || !known.has(item.milestone.id));
    if (rest.length > 0 || groups.length === 0) {
      groups.push({ milestone: null, tasks: rest.map(treeNode) });
    }
    return {
      groups,
      edges,
      outside,
      bottleneckId: bottleneck(
        all.map((item) => ({
          id: item.id,
          open: isTaskOpen(item.status),
          blocked: item.blocked,
          dueDate: item.dueDate,
          dueTime: item.dueTime,
          overdue: item.overdue,
        })),
        edges.filter((edge) => byId.has(edge.dependsOnId)),
      ),
    };
  }

  /** The project's milestones by position; 404 for a project the actor may not read. */
  private async milestones(
    actor: CurrentUserInfo,
    projectId: string,
  ): Promise<{ id: string; name: string }[]> {
    await this.engagements.readableProject(actor, projectId);
    const milestones = await this.engagements.projectMilestones(projectId, this.db);
    return milestones.map((milestone) => ({ id: milestone.id, name: milestone.name }));
  }

  /** A cycle has one group, without a milestone; 404 for a cycle the actor may not read. */
  private async cycle(
    actor: CurrentUserInfo,
    cycleId: string,
  ): Promise<{ id: string; name: string }[]> {
    const cycle = (await this.engagements.cycles([cycleId], this.db)).get(cycleId);
    if (!cycle) throw new NotFoundException();
    await this.engagements.readableRetainer(actor, cycle.retainerId);
    return [];
  }
}
