import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  type CreateTask,
  DEFAULT_REVISION_LIMIT,
  type ErrorCode,
  type ErrorResponse,
  type TaskDetail,
} from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { FileAttachments } from '../files/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { SubtaskRuns } from './subtask-runs.js';
import { actorOf, dueAfter, readableTask } from './task-access.js';
import { lockDependencyGraph } from './task-dependencies.js';
import { TaskQuestionsService } from './task-questions.service.js';
import { TaskTemplateHooks } from './task-template-hooks.js';
import { TasksService } from './tasks.service.js';

/** The part of a create an error belongs to, for the wizard (rule C2). */
type Part = { part: 'subtasks' | 'files' | 'questions'; index: number };

/**
 * Rule C2: a coded error thrown while saving one part of the create names that part in its
 * `details`, so the wizard leads back to it.
 */
async function inPart<T>(part: Part, save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    const body = error instanceof HttpException ? (error.getResponse() as ErrorResponse) : null;
    if (body?.code && body.details === undefined) {
      throw new CodedException(
        error instanceof HttpException
          ? (error.getStatus() as ConstructorParameters<typeof CodedException>[0])
          : 400,
        body.code as ErrorCode,
        body.message,
        part,
      );
    }
    throw error;
  }
}

/**
 * The creation wizard's save (spec F06B rule C2): the task, its stages and subtasks with their
 * run, criteria and checklists, the held files and the questions with their attachments, in one
 * transaction. Each subtask is checked as its own create (rule A2); one failing part saves
 * nothing. A draft from a task template records the template's run (rule D2).
 */
@Injectable()
export class TaskCreation {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly tasks: TasksService,
    private readonly runs: SubtaskRuns,
    private readonly questions: TaskQuestionsService,
    private readonly attachments: FileAttachments,
    private readonly templates: TaskTemplateHooks,
    private readonly users: UserDirectory,
  ) {}

  async create(actor: CurrentUserInfo, input: CreateTask): Promise<TaskDetail> {
    const { id, preview } = await this.db.transaction((tx) => this.createIn(tx, actor, input));
    if (preview) await this.attachments.queuePreviews();
    return this.tasks.detail(actor, id);
  }

  /**
   * The save in the caller's transaction; `postId` links the new task to a post from the start
   * (F08B rule B2, through `PostTasks`, which holds the post's lock). Call `queuePreviews` once
   * the transaction committed when `preview` is true.
   */
  async createIn(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: CreateTask,
    options: { postId?: string } = {},
  ): Promise<{ id: string; preview: boolean }> {
    const { stages, subtasks, files, questions, templateId, ...task } = input;
    // The access lock comes first, as in every create with an assignee (F01 change); the run of
    // new subtasks is written under the graph's lock, as every run change.
    if (input.assigneeId || subtasks.some((subtask) => subtask.assigneeId)) {
      await lockAccessChanges(tx);
    }
    if (subtasks.length > 0) await lockDependencyGraph(tx);
    await this.users.assertActiveDepartments(
      [input.department, ...subtasks.map((subtask) => subtask.department)],
      tx,
    );
    const id = await this.tasks.createIn(tx, actor, task, {
      checkLeave: true,
      postId: options.postId,
    });
    const stageIds: string[] = [];
    for (const [index, stage] of stages.entries()) {
      stageIds.push(await this.runs.insertStage(tx, actorOf(actor), id, stage.name, index + 1));
    }
    const due = { dueDate: input.dueDate, dueTime: input.dueTime ?? null };
    let preview = false;
    const deliverables = new Set<string>();
    for (const [index, file] of files.entries()) {
      const filePreview = await inPart({ part: 'files', index }, () =>
        this.attachments.attachToTask(
          tx,
          actor,
          { taskId: id, clientId: input.clientId },
          [file],
          deliverables,
        ),
      );
      preview ||= filePreview;
    }
    const created: { id: string; title: string; department: CreateTask['department'] }[] = [];
    for (const [index, subtask] of subtasks.entries()) {
      const subtaskId = await inPart({ part: 'subtasks', index }, async () => {
        if (dueAfter({ dueDate: subtask.dueDate, dueTime: subtask.dueTime ?? null }, due)) {
          throw new CodedException(
            400,
            'INVALID_DATES',
            'A subtask is due no later than its parent',
          );
        }
        const subtaskId = await this.tasks.createIn(
          tx,
          actor,
          {
            type: 'work',
            title: subtask.title,
            brief: subtask.brief ?? null,
            briefDoc: subtask.briefDoc,
            briefFields: subtask.briefFields,
            department: subtask.department,
            assigneeId: subtask.assigneeId,
            priority: subtask.priority,
            dueDate: subtask.dueDate,
            dueTime: subtask.dueTime ?? null,
            estimateMinutes: subtask.estimateMinutes,
            clientId: input.clientId,
            projectId: input.projectId,
            milestoneId: null,
            retainerCycleId: input.retainerCycleId,
            cycleLineId: null,
            needsClientApproval: false,
            revisionLimit: DEFAULT_REVISION_LIMIT,
            dependsOn: [],
            checklist: subtask.checklist,
            criteria: subtask.criteria,
            links: [],
            requestScope: undefined,
            acceptLeave: input.acceptLeave,
          },
          {
            checkLeave: true,
            // Rule A1: the parent's links, as just checked on the parent.
            inheritsLinks: true,
            parent: {
              id,
              position: index + 1,
              stageId: subtask.stageIndex !== null ? (stageIds[subtask.stageIndex] ?? null) : null,
              assigneeId: input.assigneeId,
            },
          },
        );
        const filesPreview = await this.attachments.attachToTask(
          tx,
          actor,
          { taskId: subtaskId, clientId: input.clientId },
          subtask.files,
        );
        preview ||= filesPreview;
        return subtaskId;
      });
      created.push({ id: subtaskId, title: subtask.title, department: subtask.department });
    }
    // Subtasks created with their parent heard of their assignment: the run is written quietly.
    if (created.length > 0) await this.runs.sync(tx, id, actor.id, undefined, { quiet: true });
    if (questions.length > 0) {
      const access = await readableTask(
        tx,
        { clients: this.clients, engagements: this.engagements },
        actor,
        id,
      );
      for (const [index, question] of questions.entries()) {
        const asked = await inPart({ part: 'questions', index }, () =>
          this.questions.askIn(tx, actor, access, question),
        );
        preview ||= asked.preview;
      }
    }
    if (templateId) {
      await this.templates.used(tx, {
        templateId,
        actor: actorOf(actor),
        taskId: id,
        subtasks: created,
      });
    }
    return { id, preview };
  }
}
