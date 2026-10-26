import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type CalendarDate,
  type DepartmentCode,
  permissionScopes,
  richTextFromPlain,
  type SubtaskRunMode,
  type TaskBriefDoc,
  type TaskBriefFields,
  type TaskPriority,
} from '@vertex-hub/contracts';
import { type Database, taskChecklistItems, tasks } from '@vertex-hub/db';
import { and, asc, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { SubtaskRuns } from './subtask-runs.js';
import { belongsTo, hasAssignScope, managesDepartment, readableTask } from './task-access.js';

/** One task of a snapshot: the fields a `task` template keeps (F06B rule D1). */
export interface TaskSnapshotItem {
  title: string;
  brief: string | null;
  briefDoc: TaskBriefDoc | null;
  briefFields: TaskBriefFields | null;
  department: DepartmentCode;
  priority: TaskPriority;
  estimateMinutes: number | null;
  dueDate: CalendarDate;
  /** Null when the assignee is no longer an active member of the department. */
  assigneeId: string | null;
  checklist: string[];
  criteria: string[];
}

/** A top-level task with its run mode, stages and non-cancelled subtasks in order. */
export interface TaskSnapshot extends TaskSnapshotItem {
  id: string;
  /** When the task was created: its due days count from that business date. */
  createdAt: Date;
  needsClientApproval: boolean;
  revisionLimit: number;
  runMode: SubtaskRunMode | null;
  stages: { id: string; name: string }[];
  subtasks: (TaskSnapshotItem & { stageId: string | null })[];
}

/**
 * Task templates for the `templates` module (spec F06B part D), which never reads task tables:
 * the snapshot a template is saved from, and who may be a draft's default assignee.
 */
@Injectable()
export class TaskTemplates {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly users: UserDirectory,
    private readonly runs: SubtaskRuns,
  ) {}

  /**
   * Rule D1: the task the actor saves as a template. 404 unless readable, `INVALID_LINK` for a
   * subtask, 403 without assign scope on it (not a project manager alone).
   */
  async snapshot(actor: CurrentUserInfo, taskId: string): Promise<TaskSnapshot> {
    const task = await readableTask(
      this.db,
      { clients: this.clients, engagements: this.engagements },
      actor,
      taskId,
    );
    if (task.parentId) {
      throw new CodedException(400, 'INVALID_LINK', 'A template is saved from a top-level task');
    }
    if (!hasAssignScope(actor, task)) throw new ForbiddenException();
    const subtaskIds = (await this.runs.subtasksOf(this.db, taskId))
      .filter((subtask) => !subtask.archivedAt && subtask.status !== 'cancelled')
      .map((subtask) => subtask.id);
    const [rows, items, stages] = await Promise.all([
      this.db
        .select({
          id: tasks.id,
          title: tasks.title,
          brief: tasks.brief,
          briefDoc: tasks.briefDoc,
          briefFields: tasks.briefFields,
          department: tasks.department,
          priority: tasks.priority,
          estimateMinutes: tasks.estimateMinutes,
          dueDate: tasks.dueDate,
          assigneeId: tasks.assigneeId,
          stageId: tasks.stageId,
          position: tasks.position,
          needsClientApproval: tasks.needsClientApproval,
          revisionLimit: tasks.revisionLimit,
          createdAt: tasks.createdAt,
        })
        .from(tasks)
        .where(inArray(tasks.id, [taskId, ...subtaskIds]))
        .orderBy(asc(tasks.position)),
      this.db
        .select({
          taskId: taskChecklistItems.taskId,
          kind: taskChecklistItems.kind,
          text: taskChecklistItems.text,
        })
        .from(taskChecklistItems)
        .where(
          and(
            inArray(taskChecklistItems.taskId, [taskId, ...subtaskIds]),
            isNull(taskChecklistItems.archivedAt),
          ),
        )
        .orderBy(asc(taskChecklistItems.position)),
      this.runs.stagesOf(this.db, taskId),
    ]);
    const assigneeIds = rows.flatMap((row) => (row.assigneeId ? [row.assigneeId] : []));
    const [members, people] = await Promise.all([
      this.users.memberships(assigneeIds),
      this.users.summaries(assigneeIds),
    ]);
    const itemOf = (row: (typeof rows)[number]): TaskSnapshotItem => ({
      title: row.title,
      brief: row.brief,
      briefDoc:
        (row.briefDoc as TaskBriefDoc | null) ?? (row.brief ? richTextFromPlain(row.brief) : null),
      briefFields: (row.briefFields as TaskBriefFields | null) ?? null,
      department: row.department,
      priority: row.priority,
      estimateMinutes: row.estimateMinutes,
      dueDate: row.dueDate,
      assigneeId:
        row.assigneeId &&
        !people.get(row.assigneeId)?.archived &&
        members.get(row.assigneeId)?.has(row.department)
          ? row.assigneeId
          : null,
      checklist: items
        .filter((i) => i.taskId === row.id && i.kind === 'checklist')
        .map((i) => i.text),
      criteria: items
        .filter((i) => i.taskId === row.id && i.kind === 'criterion')
        .map((i) => i.text),
    });
    const root = rows.find((row) => row.id === taskId);
    if (!root) throw new Error('The task has no row');
    return {
      ...itemOf(root),
      id: taskId,
      createdAt: root.createdAt,
      needsClientApproval: root.needsClientApproval,
      revisionLimit: root.revisionLimit,
      runMode: task.runMode,
      stages: stages.map((stage) => ({ id: stage.id, name: stage.name })),
      subtasks: rows
        .filter((row) => row.id !== taskId)
        .map((row) => ({ ...itemOf(row), stageId: row.stageId })),
    };
  }

  /**
   * Rule D2: whether the actor may make `userId` the assignee of a task of `department` without a
   * client: assign scope over the department, or themself in their own department.
   */
  mayAssign(actor: CurrentUserInfo, department: DepartmentCode, userId: string): boolean {
    return (
      (userId === actor.id && belongsTo(actor, department)) ||
      hasAssignScope(actor, { department, client: null })
    );
  }

  /**
   * F06B Roles: the creator of a `task` template edits it while they keep assign scope in one of
   * its departments (`all`, or managing the department).
   */
  assignsIn(actor: CurrentUserInfo, departments: readonly DepartmentCode[]): boolean {
    const scopes = permissionScopes(actor.access, 'tasks.manage');
    return (
      scopes.includes('all') ||
      (scopes.includes('department') &&
        departments.some((department) => managesDepartment(actor, department)))
    );
  }
}
