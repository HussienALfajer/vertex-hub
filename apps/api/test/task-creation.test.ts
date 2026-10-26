import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreateTaskInput,
  fileUploadSchema,
  isWorkDay,
  type NotificationType,
  nextWorkDay,
  type TaskReadinessInputValue,
  taskDetailSchema,
  taskReadinessSchema,
  taskWorkloadSchema,
  weekOf,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  employeeFiles,
  hrRequests,
  notifications,
  taskComments,
  taskDependencies,
  tasks,
  workScheduleDays,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN, textDoc } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('task creation, readiness and estimates (F06B part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;
  const leaves: string[] = [];

  const create = (cookie: string | undefined, input: Partial<CreateTaskInput>) =>
    client.request('POST', '/api/tasks', {
      cookie,
      body: {
        title: `حملة ${cast.run} ${randomUUID().slice(0, 6)}`,
        department: 'content_management',
        dueDate: cast.inDays(14),
        ...input,
      },
    });

  async function createOk(cookie: string, input: Partial<CreateTaskInput>) {
    const response = await create(cookie, input);
    expect(response.status, await response.clone().text()).toBe(201);
    return taskDetailSchema.parse(await response.json());
  }

  const readiness = (cookie: string | undefined, input: TaskReadinessInputValue) =>
    client.request('POST', '/api/tasks/readiness', { cookie, body: input });

  async function warningsOf(cookie: string, input: TaskReadinessInputValue) {
    const response = await readiness(cookie, input);
    expect(response.status, await response.clone().text()).toBe(200);
    return taskReadinessSchema.parse(await response.json()).warnings;
  }

  async function upload(cookie: string, name: string) {
    const form = new FormData();
    form.append('file', new Blob([PDF]), name);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileUploadSchema.parse(await response.json());
  }

  const typesOf = async (recipientId: string, subjectId: string): Promise<NotificationType[]> =>
    (
      await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, recipientId), eq(notifications.subjectId, subjectId)),
        )
    ).map((row) => row.type);

  const byTitle = (title: string) =>
    db.select({ id: tasks.id }).from(tasks).where(eq(tasks.title, title));

  /** A work day at least `days` from today. */
  const workDayIn = (days: number) => {
    const date = cast.inDays(days);
    return isWorkDay(date) ? date : nextWorkDay(date);
  };

  /** An approved leave of `userId` on `date`, as F17 records one. */
  async function approvedLeave(userId: string, date: string) {
    const [row] = await db
      .insert(hrRequests)
      .values({
        userId,
        kind: 'leave',
        leaveType: 'annual',
        startsOn: date,
        endsOn: date,
        days: 1,
        status: 'approved',
        createdById: userId,
      })
      .returning({ id: hrRequests.id });
    leaves.push(row?.id as string);
  }

  /** The person's employee file with its (default) schedule, made by opening it as Ops. */
  async function withEmployeeFile(userId: string) {
    expect((await client.get(`/api/hr/employees/${userId}`, cast.operations.cookie)).status).toBe(
      200,
    );
  }

  beforeAll(async () => {
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    if (leaves.length) await db.delete(hrRequests).where(inArray(hrRequests.id, leaves));
    await cast?.cleanup();
    await connection.close();
  });

  it('creates the task with its stages, subtasks, criteria, files and questions at once (rule C2)', async () => {
    const moodboard = await upload(cast.gm.cookie, 'moodboard.pdf');
    const sizes = await upload(cast.gm.cookie, 'sizes.pdf');
    const draft = await upload(cast.gm.cookie, 'draft.pdf');
    const asked = await upload(cast.gm.cookie, 'question.pdf');
    const title = `حملة كاملة ${cast.run}`;
    const task = await createOk(cast.gm.cookie, {
      title,
      department: 'marketing',
      briefDoc: textDoc('A campaign'),
      briefFields: { goal: 'Reach', audience: 'Families' },
      estimateMinutes: 240,
      criteria: ['Approved tone'],
      runMode: 'stages',
      stages: [{ name: 'Copy' }, { name: 'Design' }],
      subtasks: [
        {
          title: `نص ${cast.run}`,
          department: 'content_management',
          assigneeId: cast.writer.id,
          dueDate: cast.inDays(5),
          stageIndex: 0,
          criteria: ['Two options'],
        },
        {
          title: `تصميم ${cast.run}`,
          department: 'design',
          assigneeId: cast.designer.id,
          dueDate: cast.inDays(10),
          stageIndex: 1,
          estimateMinutes: 90,
          briefFields: { sizes: ['1080 × 1350'] },
          files: [
            { uploadId: sizes.uploadId },
            { uploadId: draft.uploadId, role: 'deliverable', name: 'Draft' },
          ],
        },
        {
          title: `تصميم آخر ${cast.run}`,
          department: 'design',
          dueDate: cast.inDays(10),
          stageIndex: 1,
        },
      ],
      files: [{ uploadId: moodboard.uploadId }],
      questions: [
        {
          bodyDoc: textDoc('Which sizes?'),
          addressedDepartment: 'design',
          files: [{ uploadId: asked.uploadId }],
        },
      ],
    });

    expect(task).toMatchObject({
      runMode: 'stages',
      estimateMinutes: 240,
      briefFields: { goal: 'Reach', audience: 'Families' },
      criteria: [{ text: 'Approved tone', done: false }],
      fileCounts: { references: 1, deliverables: 0 },
      openQuestions: { total: 1, inSubtasks: 0 },
      progress: { delivered: 0, total: 3 },
      permissions: { canSaveTemplate: true },
    });
    expect(task.stages.map((stage) => stage.name)).toEqual(['Copy', 'Design']);
    const [copy, design, queued] = task.subtasks;
    expect([copy?.position, design?.position, queued?.position]).toEqual([1, 2, 3]);
    expect(design?.stageId).toBe(task.stages[1]?.id);
    expect(design).toMatchObject({ estimateMinutes: 90, blocked: true });
    expect(copy?.blocked).toBe(false);

    const designDetail = await cast.detail(design?.id as string, cast.gm.cookie);
    expect(designDetail).toMatchObject({
      briefFields: { sizes: ['1080 × 1350'] },
      fileCounts: { references: 1, deliverables: 1 },
      parent: { id: task.id },
    });
    expect((await cast.detail(copy?.id as string, cast.gm.cookie)).criteria).toHaveLength(1);
    // The run waits stage on stage, written by the system.
    const run = await db
      .select({ taskId: taskDependencies.taskId, source: taskDependencies.source })
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnId, copy?.id as string));
    expect(run.map((edge) => edge.source)).toEqual(['run', 'run']);

    // Assigned subtasks heard of their assignment only: no "waits again" at creation.
    expect(await typesOf(cast.designer.id, design?.id as string)).toEqual(['task_assigned']);
    expect(await typesOf(cast.designManager.id, queued?.id as string)).toContain('task_requested');
    expect(await typesOf(cast.designManager.id, task.id)).toContain('task_question_asked');

    const stageAudit = await db
      .select({ action: auditEntries.action })
      .from(auditEntries)
      .where(eq(auditEntries.entityId, task.stages[0]?.id as string));
    expect(stageAudit.map((entry) => entry.action)).toEqual(['task_stage.created']);
    const [question] = await db
      .select({ id: taskComments.id })
      .from(taskComments)
      .where(eq(taskComments.taskId, task.id));
    expect(question).toBeDefined();
  });

  it('saves nothing when one part fails, and names the part (rule C2)', async () => {
    const title = `حملة فاشلة ${cast.run}`;
    const kept = await upload(cast.gm.cookie, 'kept.pdf');
    const late = await expectError(
      await create(cast.gm.cookie, {
        title,
        dueDate: cast.inDays(7),
        files: [{ uploadId: kept.uploadId }],
        subtasks: [
          { title: 'On time', department: 'design', dueDate: cast.inDays(6) },
          { title: 'Too late', department: 'design', dueDate: cast.inDays(8) },
        ],
      }),
      400,
      'INVALID_DATES',
    );
    expect(late.details).toEqual({ part: 'subtasks', index: 1 });
    expect(await byTitle(title)).toEqual([]);

    // The upload rolled back with the rest: it can be used again.
    const missing = await expectError(
      await create(cast.gm.cookie, {
        title,
        files: [{ uploadId: kept.uploadId }],
        questions: [
          {
            bodyDoc: textDoc('Sizes?'),
            addressedDepartment: 'design',
            files: [{ uploadId: randomUUID() }],
          },
        ],
      }),
      400,
      'UPLOAD_NOT_FOUND',
    );
    expect(missing.details).toEqual({ part: 'questions', index: 0 });
    expect(await byTitle(title)).toEqual([]);

    // Each subtask is checked as its own create: the content manager may not assign a designer.
    expect(
      (
        await create(cast.contentManager.cookie, {
          title,
          assigneeId: cast.writer.id,
          subtasks: [
            {
              title: 'Design',
              department: 'design',
              assigneeId: cast.designer.id,
              dueDate: cast.inDays(5),
            },
          ],
        })
      ).status,
    ).toBe(403);
    expect(await byTitle(title)).toEqual([]);

    const created = await createOk(cast.gm.cookie, {
      title,
      files: [{ uploadId: kept.uploadId, role: 'deliverable' }],
    });
    expect(created.fileCounts.deliverables).toBe(1);
  });

  it('refuses two deliverables of one name, brief fields of another department and unknown parts', async () => {
    const [a, b] = [await upload(cast.gm.cookie, 'a.pdf'), await upload(cast.gm.cookie, 'b.pdf')];
    await expectError(
      await create(cast.gm.cookie, {
        files: [
          { uploadId: a.uploadId, role: 'deliverable', name: 'Final' },
          { uploadId: b.uploadId, role: 'deliverable', name: 'final' },
        ],
      }),
      409,
      'FILE_NAME_TAKEN',
    );
    expect((await create(cast.gm.cookie, { briefFields: { sizes: ['1:1'] } })).status).toBe(400);
    expect((await create(undefined, {})).status).toBe(401);
  });

  it('asks to accept a subtask assignee on leave, then saves (rule C5, F17 rule B17)', async () => {
    const due = workDayIn(4);
    await approvedLeave(cast.designer.id, due);
    const input: Partial<CreateTaskInput> = {
      subtasks: [
        { title: 'Design', department: 'design', assigneeId: cast.designer.id, dueDate: due },
      ],
    };
    const refused = await expectError(
      await create(cast.gm.cookie, input),
      409,
      'ASSIGNEE_ON_LEAVE',
    );
    // The leave error keeps its own details: the leaves to confirm.
    expect(refused.details).toEqual([{ startsOn: due, endsOn: due }]);
    const task = await createOk(cast.gm.cookie, { ...input, acceptLeave: true });
    const [accepted] = await db
      .select({ action: auditEntries.action })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, task.subtasks[0]?.id as string),
          eq(auditEntries.action, 'task.leave_accepted'),
        ),
      );
    expect(accepted).toBeDefined();
  });

  it('warns of leave, a day off, a missing brief and missing criteria, never blocking (rule C5)', async () => {
    const due = workDayIn(20);
    await approvedLeave(cast.writer.id, due);
    let friday = cast.inDays(1);
    while (new Date(`${friday}T00:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1);

    expect((await readiness(undefined, { department: 'design', dueDate: due })).status).toBe(401);
    const warnings = await warningsOf(cast.contentManager.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: due,
      needsClientApproval: true,
      hasBrief: true,
      subtasks: [
        { department: 'design', dueDate: friday, hasReferences: true },
        { department: 'design', dueDate: due },
      ],
    });
    expect(warnings).toEqual([
      { subtaskIndex: null, code: 'assignee_on_leave', leaves: [{ startsOn: due, endsOn: due }] },
      { subtaskIndex: 0, code: 'due_on_day_off', suggestedDate: nextWorkDay(friday) },
      { subtaskIndex: 1, code: 'brief_missing' },
      { subtaskIndex: null, code: 'no_criteria' },
    ]);
    expect(
      await warningsOf(cast.employee.cookie, {
        department: 'design',
        dueDate: workDayIn(3),
        hasBriefFields: true,
      }),
    ).toEqual([]);
  });

  it('warns of an overloaded assignee against the hours left in their schedule (rule C5)', async () => {
    await withEmployeeFile(cast.writer.id);
    const due = workDayIn(15);
    const week = weekOf(due);
    const [file] = await db
      .select({ scheduleId: employeeFiles.scheduleId })
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, cast.writer.id));
    const days = await db
      .select()
      .from(workScheduleDays)
      .where(eq(workScheduleDays.scheduleId, file?.scheduleId as string));
    expect(days.length).toBeGreaterThan(0);

    const light = await warningsOf(cast.contentManager.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: due,
      estimateMinutes: 30,
      hasBrief: true,
    });
    expect(light.map((warning) => warning.code)).not.toContain('assignee_overloaded');

    // 200 hours on one task is more than any week of a schedule.
    await createOk(cast.contentManager.cookie, {
      assigneeId: cast.writer.id,
      dueDate: week.to > due ? due : week.to,
      estimateMinutes: 12_000,
    });
    const heavy = await warningsOf(cast.contentManager.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: due,
      estimateMinutes: 60,
      hasBrief: true,
    });
    const overloaded = heavy.find((warning) => warning.code === 'assignee_overloaded');
    expect(overloaded?.estimatedMinutes).toBe(12_060);
    expect(overloaded?.capacityMinutes).toBeGreaterThan(0);
    expect(overloaded?.capacityMinutes).toBeLessThan(12_060);

    // Without an employee file there is no capacity, so no warning (edge case 21).
    await db.delete(employeeFiles).where(eq(employeeFiles.userId, cast.designer.id));
    await createOk(cast.gm.cookie, {
      department: 'design',
      assigneeId: cast.designer.id,
      dueDate: due,
      estimateMinutes: 12_000,
    });
    const free = await warningsOf(cast.gm.cookie, {
      department: 'design',
      assigneeId: cast.designer.id,
      dueDate: due,
      hasBrief: true,
    });
    expect(free.map((warning) => warning.code)).not.toContain('assignee_overloaded');
  });

  it('shows estimated hours against capacity on Workload (rule C8)', async () => {
    await withEmployeeFile(cast.writer.id);
    const week = weekOf(workDayIn(30));
    const due = isWorkDay(week.from) ? week.from : nextWorkDay(week.from);
    await createOk(cast.contentManager.cookie, {
      assigneeId: cast.writer.id,
      dueDate: due,
      estimateMinutes: 90,
    });
    await createOk(cast.contentManager.cookie, { assigneeId: cast.writer.id, dueDate: due });
    const response = await client.get(
      `/api/tasks/workload?department=content_management&week=${due}`,
      cast.contentManager.cookie,
    );
    expect(response.status).toBe(200);
    const writer = taskWorkloadSchema
      .parse(await response.json())
      .people.find((person) => person.user.id === cast.writer.id);
    // 90 minutes, plus 2 hours for the task without an estimate.
    expect(writer).toMatchObject({ estimatedMinutes: 210, unestimatedCount: 1 });
    expect(writer?.capacityMinutes).toBeGreaterThan(0);
  });

  it('edits brief fields and the estimate, and clears the fields with another department (rules C7, C8)', async () => {
    const task = await createOk(cast.gm.cookie, {
      department: 'design',
      briefFields: { sizes: ['1:1'], colors: ['#112233'] },
    });
    const patch = (body: unknown) =>
      client.request('PATCH', `/api/tasks/${task.id}`, { cookie: cast.gm.cookie, body });

    const estimated = await patch({ estimateMinutes: 150, briefFields: { sizes: ['4:5'] } });
    expect(estimated.status).toBe(200);
    expect(taskDetailSchema.parse(await estimated.json())).toMatchObject({
      estimateMinutes: 150,
      briefFields: { sizes: ['4:5'] },
    });
    expect((await patch({ estimateMinutes: 45 })).status).toBe(400);
    expect((await patch({ briefFields: { goal: 'Reach' } })).status).toBe(400);

    const moved = await patch({ department: 'marketing', assigneeId: null });
    expect(moved.status).toBe(200);
    expect(taskDetailSchema.parse(await moved.json()).briefFields).toBeNull();
    const audit = await db
      .select({ after: auditEntries.after })
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, task.id), eq(auditEntries.action, 'task.updated')))
      .orderBy(asc(auditEntries.id));
    expect(audit.at(-1)?.after).toMatchObject({ briefFields: null });
  });

  it('adds a subtask with its estimate, criteria, brief fields and files', async () => {
    const parent = await createOk(cast.contentManager.cookie, { assigneeId: cast.writer.id });
    const reference = await upload(cast.writer.cookie, 'ref.pdf');
    const response = await client.post(`/api/tasks/${parent.id}/subtasks`, cast.writer.cookie, {
      title: `فرعية ${cast.run}`,
      department: 'content_management',
      dueDate: cast.inDays(5),
      estimateMinutes: 60,
      criteria: ['Proofread'],
      briefFields: { tone: 'Warm' },
      files: [{ uploadId: reference.uploadId }],
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const subtask = taskDetailSchema.parse(await response.json());
    expect(subtask).toMatchObject({
      estimateMinutes: 60,
      briefFields: { tone: 'Warm' },
      criteria: [{ text: 'Proofread' }],
      fileCounts: { references: 1 },
    });
    expect(subtask.criteria).toHaveLength(1);
    expect(businessDate() <= subtask.dueDate).toBe(true);
  });
});
