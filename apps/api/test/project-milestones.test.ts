import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  milestoneListResponseSchema,
  milestoneSchema,
  projectDetailSchema,
  type TaskCounts,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkProgress } from '../src/modules/projects/index.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('project milestones', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let clientId: string;
  /** Task counts the fake F06 source reports, by project or milestone id. */
  const tasks = new Map<string, TaskCounts>();

  const path = (projectId: string, rest = '') => `/api/projects/${projectId}/milestones${rest}`;
  const patch = (projectId: string, id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', path(projectId, `/${id}`), { cookie, body });
  const add = async (projectId: string, cookie: string, body: unknown) => {
    const response = await client.post(path(projectId), cookie, body);
    expect(response.status).toBe(201);
    return milestoneSchema.parse(await response.json());
  };
  const detail = async (id: string, cookie: string) => {
    const response = await client.get(`/api/projects/${id}`, cookie);
    expect(response.status).toBe(200);
    return projectDetailSchema.parse(await response.json());
  };
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);
  const pick = (ids: string[]) =>
    new Map(ids.flatMap((id) => (tasks.has(id) ? [[id, tasks.get(id) as TaskCounts]] : [])));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    clientId = (await cast.createClient()).id;
    app.get(WorkProgress).register({
      projects: async (ids) => pick(ids),
      milestones: async (ids) => pick(ids),
      cycleLines: async (ids) => pick(ids),
      openTasks: async () => [],
      cancelOpenTasks: async () => {},
    });
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.post(path(id), undefined, { name: 'x' })).status).toBe(401);
    expect((await patch(id, id, undefined, { name: 'x' })).status).toBe(401);
    expect((await client.request('PUT', path(id, '/order'), { body: { ids: [id] } })).status).toBe(
      401,
    );
    for (const action of ['complete', 'reopen', 'archive']) {
      expect((await client.post(path(id, `/${id}/${action}`))).status, action).toBe(401);
    }
  });

  it('lets the project manager add and edit milestones, without money (M1)', async () => {
    const project = await cast.createProject(clientId);
    const first = await add(project.id, cast.employee.cookie, { name: 'Discovery' });
    expect(first).toMatchObject({ position: 1, status: 'pending', dueDate: null });
    expect(first.money).toBeUndefined();
    expect(
      (
        await client.post(path(project.id), cast.employee.cookie, {
          name: 'Paid',
          installmentMinor: 100,
        })
      ).status,
    ).toBe(403);
    const priced = await add(project.id, cast.am.cookie, { name: 'Design', installmentMinor: 700 });
    expect(priced).toMatchObject({ position: 2, money: { installmentMinor: 700 } });

    // Edge case 11: an edit without money keeps the saved installment.
    const edited = await patch(project.id, priced.id, cast.employee.cookie, {
      name: 'Design phase',
      dueDate: '2026-11-15',
    });
    expect(edited.status).toBe(200);
    expect(milestoneSchema.parse(await edited.json()).money).toBeUndefined();
    expect((await detail(project.id, cast.am.cookie)).milestones[1]).toMatchObject({
      name: 'Design phase',
      money: { installmentMinor: 700 },
    });
    expect(
      (await patch(project.id, priced.id, cast.employee.cookie, { installmentMinor: 0 })).status,
    ).toBe(403);

    const stranger = await cast.signedIn();
    expect((await client.post(path(project.id), stranger.cookie, { name: 'x' })).status).toBe(403);
    expect((await patch(project.id, first.id, stranger.cookie, { name: 'x' })).status).toBe(403);
    expect((await patch(project.id, randomUUID(), cast.gm.cookie, { name: 'x' })).status).toBe(404);

    const [created] = await auditOf(priced.id);
    expect(created).toMatchObject({
      action: 'project_milestone.created',
      entityType: 'project_milestone',
    });
    expect(created?.after).toMatchObject({ projectId: project.id, installmentMinor: 700 });
  });

  it('refuses users without access to the project on every endpoint', async () => {
    const project = await cast.createProject(clientId, { milestones: [{ name: 'A' }] });
    const id = project.milestones[0]?.id ?? '';
    const stranger = await cast.signedIn();
    for (const user of [stranger, cast.otherAm]) {
      expect((await client.post(path(project.id), user.cookie, { name: 'x' })).status).toBe(403);
      expect((await patch(project.id, id, user.cookie, { name: 'x' })).status).toBe(403);
      expect(
        (
          await client.request('PUT', path(project.id, '/order'), {
            cookie: user.cookie,
            body: { ids: [id] },
          })
        ).status,
      ).toBe(403);
      for (const action of ['complete', 'reopen', 'archive']) {
        expect(
          (await client.post(path(project.id, `/${id}/${action}`), user.cookie)).status,
          action,
        ).toBe(403);
      }
    }
    expect((await client.post(path(randomUUID()), cast.gm.cookie, { name: 'x' })).status).toBe(404);
    // The body of complete may be left out.
    const done = await client.request('POST', path(project.id, `/${id}/complete`), {
      cookie: cast.employee.cookie,
    });
    expect(done.status).toBe(200);
  });

  it('holds at most thirty milestones', async () => {
    const project = await cast.createProject(clientId, {
      milestones: Array.from({ length: 30 }, (_, i) => ({ name: `M${i + 1}` })),
    });
    await expectError(
      await client.post(path(project.id), cast.gm.cookie, { name: 'One more' }),
      409,
      'LIMIT_REACHED',
    );
  });

  it('reorders every milestone once', async () => {
    const project = await cast.createProject(clientId, {
      milestones: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    const [a, b, c] = project.milestones.map((m) => m.id) as [string, string, string];
    const reorder = (ids: string[]) =>
      client.request('PUT', path(project.id, '/order'), {
        cookie: cast.employee.cookie,
        body: { ids },
      });
    await expectError(await reorder([a, b]), 409, 'INVALID_ORDER');
    await expectError(await reorder([a, a, b]), 409, 'INVALID_ORDER');
    await expectError(await reorder([a, b, randomUUID()]), 409, 'INVALID_ORDER');
    const response = await reorder([c, a, b]);
    expect(response.status).toBe(200);
    const { items } = milestoneListResponseSchema.parse(await response.json());
    expect(items.map((m) => [m.name, m.position])).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ]);
    // Only moved milestones are audited.
    expect((await auditOf(c)).map((e) => e.after)).toEqual([
      { position: 1, projectId: project.id },
    ]);
  });

  it('completes, reopens and removes milestones (rule 8)', async () => {
    const project = await cast.createProject(clientId, {
      milestones: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }],
    });
    const [one, two, three] = project.milestones.map((m) => m.id) as [string, string, string];
    const done = await client.post(path(project.id, `/${one}/complete`), cast.employee.cookie);
    expect(done.status).toBe(200);
    expect(milestoneSchema.parse(await done.json())).toMatchObject({
      status: 'done',
      doneBy: { id: cast.employee.id },
    });
    await expectError(
      await client.post(path(project.id, `/${one}/complete`), cast.employee.cookie),
      409,
      'MILESTONE_DONE',
    );
    await expectError(
      await client.post(path(project.id, `/${one}/archive`), cast.employee.cookie),
      409,
      'MILESTONE_DONE',
    );
    await expectError(
      await client.post(path(project.id, `/${two}/reopen`), cast.employee.cookie),
      409,
      'MILESTONE_NOT_DONE',
    );
    const reopened = await client.post(path(project.id, `/${one}/reopen`), cast.employee.cookie);
    expect(milestoneSchema.parse(await reopened.json())).toMatchObject({
      status: 'pending',
      doneAt: null,
      doneBy: null,
    });

    expect(
      (await client.post(path(project.id, `/${two}/archive`), cast.employee.cookie)).status,
    ).toBe(204);
    const after = await detail(project.id, cast.employee.cookie);
    expect(after.milestones.map((m) => [m.id, m.position])).toEqual([
      [one, 1],
      [three, 2],
    ]);
    expect((await patch(project.id, two, cast.employee.cookie, { name: 'x' })).status).toBe(404);
    expect((await auditOf(two)).map((e) => e.action)).toEqual(['project_milestone.archived']);
    expect((await auditOf(one)).map((e) => e.action)).toEqual([
      'project_milestone.completed',
      'project_milestone.reopened',
    ]);
  });

  it('asks before completing a milestone with open tasks, and reports progress (rules 8 and 9)', async () => {
    const project = await cast.createProject(clientId, { milestones: [{ name: 'Build' }] });
    const milestone = project.milestones[0]?.id ?? '';
    tasks.set(milestone, { total: 3, delivered: 1, open: 2, ready: 0 });
    tasks.set(project.id, { total: 3, delivered: 1, open: 2, ready: 0 });
    const seen = await detail(project.id, cast.employee.cookie);
    expect(seen.progress).toBe(33);
    expect(seen.milestones[0]?.tasks).toEqual({ total: 3, delivered: 1, open: 2, ready: 0 });

    const refused = await expectError(
      await client.post(path(project.id, `/${milestone}/complete`), cast.employee.cookie),
      409,
      'MILESTONE_HAS_OPEN_TASKS',
    );
    expect(refused.details).toEqual({ openTasks: 2 });
    const confirmed = await client.post(
      path(project.id, `/${milestone}/complete`),
      cast.employee.cookie,
      {
        confirmOpenTasks: true,
      },
    );
    expect(confirmed.status).toBe(200);
    const [entry] = await auditOf(milestone);
    expect(entry?.after).toEqual({ status: 'done', openTasks: 2, projectId: project.id });
  });

  it('keeps closed projects read-only (rule 7)', async () => {
    const project = await cast.createProject(clientId, { milestones: [{ name: 'Only' }] });
    const only = project.milestones[0]?.id ?? '';
    await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
      status: 'cancelled',
      reason: 'Stopped',
    });
    await expectError(
      await client.post(path(project.id), cast.gm.cookie, { name: 'x' }),
      409,
      'PROJECT_CLOSED',
    );
    await expectError(
      await client.post(path(project.id, `/${only}/complete`), cast.gm.cookie),
      409,
      'PROJECT_CLOSED',
    );
    // The project manager of a closed project still has access; the state refuses the change.
    await expectError(
      await patch(project.id, only, cast.employee.cookie, { name: 'x' }),
      409,
      'PROJECT_CLOSED',
    );
  });
});
