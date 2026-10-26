import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type CreateTaskInput,
  nthWorkDay,
  type TaskTemplateDraft,
  type TemplateDetail,
  taskDetailSchema,
  taskTemplateDraftSchema,
  templateDetailSchema,
  templateRunPageSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, templateRuns, workTemplates } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HolidayCalendar } from '../src/modules/hr/index.js';
import { expectError } from './client-cast.js';
import { api, removeTemplates } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task templates (F06B part D)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;
  const templates: string[] = [];

  const name = () => `قالب مهمة ${cast.run} ${randomUUID().slice(0, 6)}`;

  const fromTask = (taskId: string, cookie: string | undefined, body: object) =>
    client.request('POST', `/api/templates/from-task/${taskId}`, { cookie, body });

  async function saveOk(taskId: string, cookie: string, body: object = {}) {
    const response = await fromTask(taskId, cookie, { name: name(), ...body });
    expect(response.status, await response.clone().text()).toBe(201);
    const template = templateDetailSchema.parse(await response.json());
    templates.push(template.id);
    return template;
  }

  const draftOf = (id: string, cookie: string | undefined, body: object = {}) =>
    client.request('POST', `/api/templates/${id}/task-draft`, { cookie, body });

  async function draftOk(id: string, cookie: string, body: object = {}) {
    const response = await draftOf(id, cookie, body);
    expect(response.status, await response.clone().text()).toBe(200);
    return taskTemplateDraftSchema.parse(await response.json());
  }

  /** A Design task by the Design manager, by stages, with two subtasks (one cancelled). */
  async function campaign() {
    const task = await cast.createTask(cast.designManager.cookie, {
      title: `حملة ${cast.run}`,
      assigneeId: cast.designManager.id,
      dueDate: cast.inDays(12),
      estimateMinutes: 240,
      briefFields: { sizes: ['1080 × 1350'] },
      checklist: ['Export'],
      criteria: ['On brand'],
      runMode: 'stages',
      stages: [{ name: 'Sketch' }, { name: 'Final' }],
      subtasks: [
        {
          title: `رسم ${cast.run}`,
          department: 'design',
          assigneeId: cast.designer.id,
          dueDate: cast.inDays(5),
          stageIndex: 0,
          estimateMinutes: 120,
          criteria: ['Three options'],
        },
        {
          title: `ملغاة ${cast.run}`,
          department: 'design',
          dueDate: cast.inDays(6),
          stageIndex: 0,
        },
        {
          title: `نهائي ${cast.run}`,
          department: 'design',
          dueDate: cast.inDays(11),
          stageIndex: 1,
        },
      ],
    });
    const cancelled = task.subtasks[1]?.id as string;
    await cast.moveOk(cancelled, cast.designManager.cookie, {
      status: 'cancelled',
      note: 'Not needed',
    });
    return task;
  }

  /** A task created from a draft, as the wizard saves it. */
  async function createFrom(draft: TaskTemplateDraft, cookie: string) {
    const { subtasks, stages, runMode, ...task } = draft;
    const body: CreateTaskInput = {
      ...task,
      runMode: runMode ?? undefined,
      stages,
      subtasks: subtasks.map((subtask) => ({ ...subtask })),
    };
    const response = await client.post('/api/tasks', cookie, body);
    expect(response.status, await response.clone().text()).toBe(201);
    return taskDetailSchema.parse(await response.json());
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await removeTemplates(db, templates);
    await cast?.cleanup();
    await connection.close();
  });

  it('saves a task with its stages and live subtasks as a template (rule D1)', async () => {
    const task = await campaign();
    expect((await fromTask(task.id, undefined, { name: name() })).status).toBe(401);
    // No `tasks.manage` at all, and a writer without assign scope in Design.
    expect((await fromTask(task.id, cast.employee.cookie, { name: name() })).status).toBe(403);
    expect((await fromTask(task.id, cast.writer.cookie, { name: name() })).status).toBe(403);
    expect((await fromTask(randomUUID(), cast.gm.cookie, { name: name() })).status).toBe(404);
    await expectError(
      await fromTask(task.subtasks[0]?.id as string, cast.gm.cookie, { name: name() }),
      400,
      'INVALID_LINK',
    );

    const template = await saveOk(task.id, cast.designManager.cookie, { keepAssignees: true });
    expect(template).toMatchObject({
      kind: 'task',
      runMode: 'stages',
      // Screen 7: "Saved from …".
      savedFrom: { id: task.id, title: task.title },
      permissions: { canEdit: true, canArchive: true },
    });
    expect(template.stages.map((stage) => stage.name)).toEqual(['Sketch', 'Final']);
    const [root, sketch, final, ...rest] = template.steps;
    expect(rest).toEqual([]);
    expect(root).toMatchObject({
      parentStepId: null,
      estimateMinutes: 240,
      briefFields: { sizes: ['1080 × 1350'] },
      checklist: ['Export'],
      criteria: ['On brand'],
    });
    expect(sketch).toMatchObject({
      parentStepId: root?.id,
      stageId: template.stages[0]?.id,
      estimateMinutes: 120,
      criteria: ['Three options'],
    });
    expect(final?.stageId).toBe(template.stages[1]?.id);
    // Due days count work days from the task's creation; the root is the last.
    expect(root?.dueDay).toBeGreaterThanOrEqual(final?.dueDay ?? 0);
    expect(final?.dueDay).toBeGreaterThan(sketch?.dueDay ?? 0);
    expect(template.assignees.map((a) => a.user.id)).toEqual([cast.designManager.id]);

    const [created] = await db
      .select({ after: auditEntries.after })
      .from(auditEntries)
      .where(
        and(eq(auditEntries.entityId, template.id), eq(auditEntries.action, 'template.created')),
      );
    expect(created?.after).toMatchObject({ kind: 'task', fromTaskId: task.id });

    await expectError(
      await fromTask(task.id, cast.gm.cookie, { name: template.name }),
      409,
      'TEMPLATE_NAME_TAKEN',
    );
    const plain = await saveOk(task.id, cast.gm.cookie);
    expect(plain.assignees).toEqual([]);
  });

  it('lets a project manager alone not save a template (Roles)', async () => {
    const owner = await cast.createClient();
    const project = await cast.createProject(owner.id);
    const task = await cast.createTask(cast.gm.cookie, {
      clientId: owner.id,
      projectId: project.id,
    });
    // The employee manages the project (`tasks.manage` assigned) but holds no assign scope.
    const detail = await cast.detail(task.id, cast.employee.cookie);
    expect(detail.permissions.canSaveTemplate).toBe(false);
    expect((await fromTask(task.id, cast.employee.cookie, { name: name() })).status).toBe(403);
  });

  it('turns a template into a dated draft and records the run when it is saved (rule D2)', async () => {
    const task = await campaign();
    const template = await saveOk(task.id, cast.designManager.cookie, { keepAssignees: true });
    expect((await draftOf(template.id, undefined)).status).toBe(401);
    expect((await draftOf(randomUUID(), cast.designer.cookie)).status).toBe(404);

    const start = cast.inDays(3);
    const draft = await draftOk(template.id, cast.designManager.cookie, { startDate: start });
    const holidays = await app.get(HolidayCalendar).from(start);
    const [root, sketch, final] = template.steps;
    expect(draft).toMatchObject({
      templateId: template.id,
      runMode: 'stages',
      dueDate: nthWorkDay(start, root?.dueDay ?? 1, holidays),
      assigneeId: cast.designManager.id,
      estimateMinutes: 240,
      criteria: ['On brand'],
      stages: [{ name: 'Sketch' }, { name: 'Final' }],
    });
    expect(draft.subtasks).toMatchObject([
      {
        title: sketch?.title,
        stageIndex: 0,
        dueDate: nthWorkDay(start, sketch?.dueDay ?? 1, holidays),
      },
      { title: final?.title, stageIndex: 1 },
    ]);
    // The designer may not assign the Design manager: that task goes to the queue.
    expect((await draftOk(template.id, cast.designer.cookie)).assigneeId).toBeNull();

    const created = await createFrom(draft, cast.designManager.cookie);
    expect(created.subtasks).toHaveLength(2);
    const runs = await client.get(
      `/api/template-runs?taskId=${created.id}&include=tasks`,
      cast.gm.cookie,
    );
    expect(runs.status).toBe(200);
    const [run] = templateRunPageSchema.parse(await runs.json()).items;
    expect(run).toMatchObject({
      template: { id: template.id },
      trigger: 'manual',
      project: null,
      cycle: null,
      taskCount: 3,
    });
    expect(run?.tasks?.map((t) => t.id).sort()).toEqual(
      [created.id, ...created.subtasks.map((s) => s.id)].sort(),
    );

    // An unknown or archived template saves nothing.
    expect(
      (
        await client.post('/api/tasks', cast.designManager.cookie, {
          ...draft,
          subtasks: [],
          runMode: undefined,
          stages: [],
          templateId: randomUUID(),
        })
      ).status,
    ).toBe(404);
  });

  it('refuses a draft of another kind, and the project runs of a task template', async () => {
    const task = await cast.createTask(cast.gm.cookie);
    const template = await saveOk(task.id, cast.gm.cookie);
    const created = await client.post('/api/templates', cast.gm.cookie, {
      name: name(),
      kind: 'project',
      steps: [{ key: 'a', title: 'Brief', department: 'design', dueDay: 2 }],
    });
    expect(created.status).toBe(201);
    const project = templateDetailSchema.parse(await created.json());
    templates.push(project.id);
    await expectError(await draftOf(project.id, cast.gm.cookie), 400, 'TEMPLATE_KIND_MISMATCH');
    const owner = await cast.createClient();
    const target = await cast.createProject(owner.id);
    await expectError(
      await client.post(`/api/templates/${template.id}/runs`, cast.gm.cookie, {
        projectId: target.id,
      }),
      400,
      'TEMPLATE_KIND_MISMATCH',
    );
    expect(template.runMode).toBe('sequential');
    expect(template.steps).toHaveLength(1);
  });

  it('lets its creator edit and archive a task template while they keep assign scope (Roles)', async () => {
    const task = await campaign();
    const template: TemplateDetail = await saveOk(task.id, cast.designManager.cookie);
    const put = (cookie: string, body: object) =>
      client.request('PUT', `/api/templates/${template.id}`, { cookie, body });
    const document = {
      name: template.name,
      description: 'Edited',
      runMode: 'parallel',
      steps: template.steps.map((step) => ({
        key: step.id,
        parentKey: step.parentStepId,
        title: step.title,
        department: step.department,
        dueDay: step.dueDay,
        estimateMinutes: step.estimateMinutes,
        criteria: step.criteria,
        briefFields: step.briefFields,
      })),
    };
    expect((await put(cast.designer.cookie, document)).status).toBe(403);
    expect((await put(cast.contentManager.cookie, document)).status).toBe(403);
    const edited = await put(cast.designManager.cookie, document);
    expect(edited.status, await edited.clone().text()).toBe(200);
    const after = templateDetailSchema.parse(await edited.json());
    expect(after).toMatchObject({ description: 'Edited', runMode: 'parallel', stages: [] });
    expect(after.steps.slice(1).every((step) => step.parentStepId === after.steps[0]?.id)).toBe(
      true,
    );
    // Editing a template never changes the tasks made from it.
    expect((await cast.detail(task.id, cast.gm.cookie)).runMode).toBe('stages');

    expect(
      (await client.post(`/api/templates/${template.id}/archive`, cast.designer.cookie, {})).status,
    ).toBe(403);
    expect(
      (await client.post(`/api/templates/${template.id}/archive`, cast.designManager.cookie, {}))
        .status,
    ).toBe(200);
    expect(
      (await client.post(`/api/templates/${template.id}/restore`, cast.designManager.cookie, {}))
        .status,
    ).toBe(200);
    const [row] = await db
      .select({ runMode: workTemplates.runMode })
      .from(workTemplates)
      .where(eq(workTemplates.id, template.id));
    expect(row?.runMode).toBe('parallel');
    expect(
      await db.select().from(templateRuns).where(eq(templateRuns.templateId, template.id)),
    ).toEqual([]);
  });
});
