import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  BOARD_LIMITS,
  BOARD_STATUSES,
  businessDate,
  myTaskSummarySchema,
  taskBoardSchema,
  taskPageSchema,
  taskWorkloadSchema,
  weekOf,
} from '@vertex-hub/contracts';
import { createDatabase, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task views: board, workload, My tasks', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  async function getOk<T>(path: string, cookie: string, schema: { parse: (v: unknown) => T }) {
    const response = await client.get(path, cookie);
    expect(response.status, path).toBe(200);
    return schema.parse(await response.json());
  }

  const board = (cookie: string, query = '') =>
    getOk(`/api/tasks/board${query}`, cookie, taskBoardSchema);
  const workload = (cookie: string, query = '') =>
    getOk(`/api/tasks/workload${query}`, cookie, taskWorkloadSchema);
  const summary = (cookie: string) => getOk('/api/me/tasks/summary', cookie, myTaskSummarySchema);

  /** Moves a task's due date, which the API refuses to set in the past. */
  const dueOn = (id: string, dueDate: string) =>
    db.update(tasks).set({ dueDate }).where(eq(tasks.id, id));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    for (const path of ['/api/tasks/board', '/api/tasks/workload', '/api/me/tasks/summary']) {
      expect((await client.get(path)).status, path).toBe(401);
    }
  });

  it('shows the board by status for the managed departments, delivered for 14 days', async () => {
    const { id: clientId } = await cast.createClient();
    const fresh = await cast.createTask(cast.designManager.cookie, { clientId });
    const working = await cast.taskAt('in_progress', { clientId });
    const delivered = await cast.taskAt('delivered', { clientId });
    const old = await cast.taskAt('delivered', { clientId });
    await db
      .update(tasks)
      .set({ deliveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) })
      .where(eq(tasks.id, old.id));
    const cancelled = await cast.createTask(cast.designManager.cookie, { clientId });
    await cast.moveOk(cancelled.id, cast.designManager.cookie, { status: 'cancelled', note: 'x' });
    const content = await cast.createTask(cast.contentManager.cookie, {
      clientId,
      department: 'content_management',
    });
    const archived = await cast.createTask(cast.designManager.cookie, { clientId });
    await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie);

    const shown = await board(cast.designManager.cookie, `?clientId=${clientId}`);
    expect(shown.departments).toEqual(['design']);
    expect(shown.columns.map((c) => c.status)).toEqual([...BOARD_STATUSES]);
    const column = (status: string) => shown.columns.find((c) => c.status === status);
    expect(column('new')?.items.map((t) => t.id)).toEqual([fresh.id]);
    expect(column('in_progress')?.items.map((t) => t.id)).toEqual([working.id]);
    expect(column('delivered')).toMatchObject({ total: 1, items: [{ id: delivered.id }] });
    expect(shown.columns.reduce((sum, c) => sum + c.total, 0)).toBe(3);

    const contentBoard = await board(
      cast.designManager.cookie,
      `?clientId=${clientId}&department=content_management`,
    );
    expect(contentBoard.columns.flatMap((c) => c.items.map((t) => t.id))).toEqual([content.id]);
    expect((await board(cast.contentManager.cookie, `?clientId=${clientId}`)).departments).toEqual([
      'content_management',
    ]);
    expect((await board(cast.writer.cookie)).departments).toEqual(['content_management']);
    const mine = await board(cast.designer.cookie, `?clientId=${clientId}&assigneeId=me`);
    expect(mine.columns.flatMap((c) => c.items.map((t) => t.id)).sort()).toEqual(
      [working.id, delivered.id].sort(),
    );
    expect(
      (await client.get('/api/tasks/board?department=nope', cast.designer.cookie)).status,
    ).toBe(400);
  });

  it('counts the workload per person for the week, and unassigned per department', async () => {
    const person = await cast.signedIn({ name: `عضو التصميم ${cast.run}` });
    const today = businessDate();
    const week = weekOf(today);
    const assign = (dueDate: string) =>
      cast.createTask(cast.designManager.cookie, { assigneeId: person.id, dueDate });
    const late = await assign(week.to);
    await dueOn(late.id, addDays(today, -1));
    await assign(week.to);
    await assign(addDays(week.to, 1));
    const dropped = await assign(week.to);
    await cast.moveOk(dropped.id, cast.designManager.cookie, { status: 'cancelled', note: 'x' });

    const before = await workload(cast.designManager.cookie);
    await cast.createTask(cast.designer.cookie);
    const after = await workload(cast.designManager.cookie, `?week=${week.to}`);
    expect(after.week).toEqual(week);
    expect(after.departments).toEqual(['design']);
    const row = after.people.find((p) => p.user.id === person.id);
    expect(row).toEqual({
      user: { id: person.id, name: person.name },
      departments: ['design'],
      overdue: 1,
      // The overdue task is due before this week only when today is not the week's first day.
      dueThisWeek: addDays(today, -1) < week.from ? 1 : 2,
      open: 3,
    });
    const unassigned = (w: typeof after) =>
      w.unassigned.find((u) => u.department === 'design')?.count ?? 0;
    expect(unassigned(after)).toBe(unassigned(before) + 1);

    const nextWeek = await workload(cast.designManager.cookie, `?week=${addDays(week.to, 1)}`);
    expect(nextWeek.people.find((p) => p.user.id === person.id)).toMatchObject({
      dueThisWeek: 1,
      open: 3,
    });
    const content = await workload(cast.designer.cookie, '?department=content_management');
    expect(content.people.map((p) => p.user.id)).toEqual(
      expect.arrayContaining([cast.writer.id, cast.contentManager.id]),
    );
    expect(content.people.some((p) => p.user.id === person.id)).toBe(false);
    expect(
      (await client.get('/api/tasks/workload?week=someday', cast.designer.cookie)).status,
    ).toBe(400);
  });

  it('counts the sections of My tasks', async () => {
    const me = await cast.signedIn({ name: `موظف ${cast.run}` });
    const today = businessDate();
    const weekEnd = weekOf(today).to;
    const assign = (dueDate: string) =>
      cast.createTask(cast.designManager.cookie, { assigneeId: me.id, dueDate });
    const late = await assign(today);
    await dueOn(late.id, addDays(today, -2));
    await assign(today);
    if (weekEnd > today) await assign(weekEnd);
    const later = await assign(addDays(weekEnd, 3));
    const first = await cast.createTask(cast.designManager.cookie, {
      assigneeId: cast.designer.id,
    });
    expect(
      (
        await client.request('PUT', `/api/tasks/${later.id}/dependencies`, {
          cookie: cast.designManager.cookie,
          body: { dependsOn: [first.id] },
        })
      ).status,
    ).toBe(200);
    await cast.createTask(me.cookie, { department: 'content_management' });
    await cast.createTask(me.cookie, { assigneeId: me.id, dueDate: addDays(weekEnd, 5) });

    expect(await summary(me.cookie)).toEqual({
      overdue: 1,
      today: 1,
      thisWeek: weekEnd > today ? 1 : 0,
      later: 2,
      waiting: 1,
      toReview: 0,
      requestedByMe: 1,
      unassignedInMyDepartments: null,
    });

    const reviewBefore = (await summary(cast.designManager.cookie)).toReview;
    const reviewed = await cast.taskAt('internal_review');
    const managerSummary = await summary(cast.designManager.cookie);
    expect(managerSummary.toReview).toBe(reviewBefore + 1);
    expect(managerSummary.unassignedInMyDepartments).toEqual(expect.any(Number));

    // The same scope filters the list: "to review" on My tasks.
    const clientId = reviewed.client?.id ?? '';
    const toReview = async (cookie: string) =>
      (
        await getOk(
          `/api/tasks?reviewer=me&status=internal_review&clientId=${clientId}`,
          cookie,
          taskPageSchema,
        )
      ).items.map((t) => t.id);
    expect(await toReview(cast.designManager.cookie)).toEqual([reviewed.id]);
    expect(await toReview(cast.am.cookie)).toEqual([reviewed.id]);
    expect(await toReview(cast.otherAm.cookie)).toEqual([]);
    expect(await toReview(cast.contentManager.cookie)).toEqual([]);
    expect(await toReview(cast.designer.cookie)).toEqual([]);
    expect(await toReview(cast.gm.cookie)).toEqual([reviewed.id]);
  });

  it('caps each board column at 200 cards, with the column total (edge case 16)', async () => {
    const { id: clientId } = await cast.createClient();
    await db.insert(tasks).values(
      Array.from({ length: BOARD_LIMITS.cards + 1 }, (_, index) => ({
        title: `بطاقة ${index}`,
        department: 'design' as const,
        dueDate: cast.inDays(3),
        clientId,
        needsClientApproval: false,
        createdById: cast.gm.id,
      })),
    );
    const shown = await board(cast.gm.cookie, `?department=design&clientId=${clientId}`);
    const column = shown.columns.find((one) => one.status === 'new');
    expect(column?.items).toHaveLength(BOARD_LIMITS.cards);
    expect(column?.total).toBe(BOARD_LIMITS.cards + 1);
  });

  it('leaves out the tasks of an archived client (rule 17)', async () => {
    const person = await cast.signedIn({ name: `عضو مؤرشف ${cast.run}` });
    const { id: clientId } = await cast.createClient();
    await cast.createTask(cast.designManager.cookie, {
      clientId,
      assigneeId: person.id,
      dueDate: businessDate(),
    });
    await cast.createTask(person.cookie, { clientId, department: 'content_management' });
    const counts = async () => ({
      workload: (await workload(cast.designManager.cookie)).people.find(
        (p) => p.user.id === person.id,
      )?.open,
      summary: await summary(person.cookie),
      board: (await board(cast.designManager.cookie, `?clientId=${clientId}`)).columns.reduce(
        (sum, c) => sum + c.total,
        0,
      ),
    });
    expect(await counts()).toMatchObject({
      workload: 1,
      summary: { today: 1, requestedByMe: 1 },
      board: 1,
    });
    expect((await client.post(`/api/clients/${clientId}/archive`, cast.gm.cookie)).status).toBe(
      200,
    );
    expect(await counts()).toMatchObject({
      workload: 0,
      summary: { today: 0, requestedByMe: 0 },
      board: 0,
    });
  });

  it('lets the project manager review their project tasks only', async () => {
    const { id: clientId } = await cast.createClient();
    const project = await cast.createProject(clientId);
    const inProject = await cast.taskAt('internal_review', { clientId, projectId: project.id });
    await cast.taskAt('internal_review', { clientId });
    const page = await getOk(
      `/api/tasks?reviewer=me&status=internal_review&clientId=${clientId}`,
      cast.employee.cookie,
      taskPageSchema,
    );
    expect(page.items.map((t) => t.id)).toEqual([inProject.id]);
  });
});
