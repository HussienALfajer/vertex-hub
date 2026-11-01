import type { INestApplication } from '@nestjs/common';
import { taskDetailSchema, taskPageSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task reminders by hand (F06C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const remind = (taskId: string, cookie: string | undefined, body: unknown = {}) =>
    client.post(`/api/tasks/${taskId}/remind`, cookie, body);

  const remindersOf = (recipientId: string, taskId: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.subjectId, taskId),
          eq(notifications.type, 'task_reminder'),
        ),
      )
      .orderBy(asc(notifications.createdAt));

  async function detail(taskId: string, cookie: string) {
    const response = await client.get(`/api/tasks/${taskId}`, cookie);
    expect(response.status).toBe(200);
    return taskDetailSchema.parse(await response.json());
  }

  async function listItem(taskId: string, cookie: string, query = '') {
    const search = encodeURIComponent(cast.run);
    const response = await client.get(`/api/tasks?search=${search}${query}`, cookie);
    expect(response.status).toBe(200);
    return taskPageSchema.parse(await response.json()).items.find((item) => item.id === taskId);
  }

  /** A Design task assigned to the designer, created by the Design manager. */
  const designTask = () =>
    cast.createTask(cast.designManager.cookie, { assigneeId: cast.designer.id });

  beforeAll(async () => {
    const started = await startApp();
    app = started.app;
    client = api(started.url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('sends the assignee an important notification with the note, and audits it', async () => {
    const task = await designTask();
    const response = await remind(task.id, cast.designManager.cookie, { note: '  العميل ينتظر  ' });
    expect(response.status, await response.clone().text()).toBe(204);

    const [row] = await remindersOf(cast.designer.id, task.id);
    expect(row).toMatchObject({
      actorId: cast.designManager.id,
      priority: 'important',
      box: 'action',
      resolution: null,
      data: { task: { title: task.title }, note: 'العميل ينتظر' },
    });
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, task.id), eq(auditEntries.action, 'task.reminded')));
    expect(entry).toMatchObject({
      actorId: cast.designManager.id,
      after: { assigneeId: cast.designer.id, note: 'العميل ينتظر' },
    });

    // Rule 4: no limit; a blank note is no note.
    expect((await remind(task.id, cast.gm.cookie, { note: '  ' })).status).toBe(204);
    const rows = await remindersOf(cast.designer.id, task.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.data).toMatchObject({ note: null });
  });

  it('lets the creator and manage rights remind, and shows it through canRemind', async () => {
    // The writer asks Design for work; the Design manager assigns it.
    const request = await cast.createTask(cast.writer.cookie, {});
    const patched = await client.request('PATCH', `/api/tasks/${request.id}`, {
      cookie: cast.designManager.cookie,
      body: { assigneeId: cast.designer.id },
    });
    expect(patched.status, await patched.clone().text()).toBe(200);

    expect((await detail(request.id, cast.writer.cookie)).permissions.canRemind).toBe(true);
    expect((await detail(request.id, cast.gm.cookie)).permissions.canRemind).toBe(true);
    expect((await detail(request.id, cast.employee.cookie)).permissions.canRemind).toBe(false);
    expect((await detail(request.id, cast.designer.cookie)).permissions.canRemind).toBe(false);
    expect((await listItem(request.id, cast.writer.cookie))?.canRemind).toBe(true);
    expect((await listItem(request.id, cast.employee.cookie))?.canRemind).toBe(false);

    expect((await remind(request.id, cast.writer.cookie)).status).toBe(204);
    expect((await remind(request.id, cast.employee.cookie)).status).toBe(403);
    await expectError(await remind(request.id, cast.designer.cookie), 409, 'CANNOT_REMIND_SELF');
  });

  it('refuses without a session, an unknown task, an unassigned task and a long note', async () => {
    const task = await designTask();
    expect((await remind(task.id, undefined)).status).toBe(401);
    expect((await remind(crypto.randomUUID(), cast.gm.cookie)).status).toBe(404);
    expect((await remind(task.id, cast.gm.cookie, { note: 'ن'.repeat(301) })).status).toBe(400);

    const unassigned = await cast.createTask(cast.designManager.cookie, {});
    expect((await detail(unassigned.id, cast.designManager.cookie)).permissions.canRemind).toBe(
      false,
    );
    await expectError(
      await remind(unassigned.id, cast.designManager.cookie),
      409,
      'TASK_NOT_ASSIGNED',
    );
  });

  it('is done once the task is approved, then refused on it (rules 1 and 3)', async () => {
    const task = await designTask();
    expect((await remind(task.id, cast.designManager.cookie)).status).toBe(204);
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
    await cast.moveOk(task.id, cast.designManager.cookie, { status: 'approved' });

    const [row] = await remindersOf(cast.designer.id, task.id);
    expect(row?.resolution).toBe('done');
    expect((await detail(task.id, cast.designManager.cookie)).permissions.canRemind).toBe(false);
    await expectError(await remind(task.id, cast.designManager.cookie), 409, 'TASK_CLOSED');
  });

  it('voids the reminder and refuses a new one once the task is cancelled (rules 1 and 3)', async () => {
    const task = await designTask();
    expect((await remind(task.id, cast.designManager.cookie)).status).toBe(204);
    await cast.moveOk(task.id, cast.designManager.cookie, {
      status: 'cancelled',
      note: 'لم يعد مطلوبًا',
    });
    const [row] = await remindersOf(cast.designer.id, task.id);
    expect(row?.resolution).toBe('void');
    expect((await detail(task.id, cast.designManager.cookie)).permissions.canRemind).toBe(false);
    expect(
      (await listItem(task.id, cast.designManager.cookie, '&status=cancelled'))?.canRemind,
    ).toBe(false);
    await expectError(await remind(task.id, cast.designManager.cookie), 409, 'TASK_CLOSED');
  });

  it('voids the reminder and refuses a new one on an archived task (rules 1 and 3)', async () => {
    const task = await designTask();
    expect((await remind(task.id, cast.gm.cookie)).status).toBe(204);
    const archived = await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie);
    expect(archived.status, await archived.clone().text()).toBe(200);
    const [row] = await remindersOf(cast.designer.id, task.id);
    expect(row?.resolution).toBe('void');
    // Only scope-all managers read it now; the reminder is refused for them too.
    expect((await detail(task.id, cast.gm.cookie)).permissions.canRemind).toBe(false);
    await expectError(await remind(task.id, cast.gm.cookie), 409, 'TASK_ARCHIVED');
  });

  it('voids the previous assignee’s reminder on a reassignment', async () => {
    const task = await designTask();
    expect((await remind(task.id, cast.designManager.cookie)).status).toBe(204);
    const patched = await client.request('PATCH', `/api/tasks/${task.id}`, {
      cookie: cast.designManager.cookie,
      body: { assigneeId: cast.designManager.id },
    });
    expect(patched.status, await patched.clone().text()).toBe(200);
    const [row] = await remindersOf(cast.designer.id, task.id);
    expect(row?.resolution).toBe('void');
  });
});
