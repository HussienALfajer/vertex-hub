import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { taskDependencyListSchema, taskPageSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task dependencies (rules 3, 4, 5)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const put = (id: string, cookie: string | undefined, dependsOn: string[]) =>
    client.request('PUT', `/api/tasks/${id}/dependencies`, { cookie, body: { dependsOn } });

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

  it('blocks a task until its dependency is approved, then opens it (A03)', async () => {
    const { id: clientId } = await cast.createClient();
    const banner = await cast.taskAt('in_progress', { clientId });
    const publish = await cast.createTask(cast.contentManager.cookie, {
      title: 'Publish banner',
      department: 'content_management',
      assigneeId: cast.writer.id,
      clientId,
      dependsOn: [banner.id],
    });
    expect(publish).toMatchObject({
      blocked: true,
      dependencies: [{ id: banner.id, finished: false }],
    });
    expect((await cast.detail(banner.id, cast.gm.cookie)).dependents).toMatchObject([
      { id: publish.id },
    ]);
    expect(publish.allowedTransitions).toEqual(['in_progress', 'cancelled']);
    expect((await cast.detail(publish.id, cast.writer.cookie)).allowedTransitions).toEqual([]);

    const body = await expectError(
      await cast.move(publish.id, cast.writer.cookie, { status: 'in_progress' }),
      409,
      'TASK_BLOCKED',
    );
    expect(body.details).toMatchObject([{ id: banner.id, status: 'in_progress' }]);
    const blocked = taskPageSchema.parse(
      await (
        await client.get(`/api/tasks?clientId=${clientId}&blocked=true`, cast.gm.cookie)
      ).json(),
    );
    expect(blocked.items.map((t) => t.id)).toEqual([publish.id]);

    await cast.moveOk(banner.id, cast.designer.cookie, { status: 'internal_review' });
    await cast.moveOk(banner.id, cast.designManager.cookie, { status: 'awaiting_client' });
    await cast.moveOk(banner.id, cast.am.cookie, { status: 'approved' });
    const opened = await cast.detail(publish.id, cast.writer.cookie);
    expect(opened).toMatchObject({ blocked: false, allowedTransitions: ['in_progress'] });
    await cast.moveOk(publish.id, cast.writer.cookie, { status: 'in_progress' });
  });

  it('lets assign scope start a blocked task with a reason, audited; not the assignee', async () => {
    const waitOn = await cast.createTask(cast.designManager.cookie);
    const task = await cast.createTask(cast.designManager.cookie, {
      assigneeId: cast.designer.id,
      dependsOn: [waitOn.id],
    });
    expect(
      (
        await cast.move(task.id, cast.designer.cookie, {
          status: 'in_progress',
          overrideDependencies: true,
          reason: 'Urgent',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await cast.move(task.id, cast.designManager.cookie, {
          status: 'in_progress',
          overrideDependencies: true,
        })
      ).status,
    ).toBe(400);
    await cast.moveOk(task.id, cast.designManager.cookie, {
      status: 'in_progress',
      overrideDependencies: true,
      reason: 'Client deadline',
    });
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(eq(auditEntries.entityId, task.id), eq(auditEntries.action, 'task.status_changed')),
      );
    expect(entry?.after).toMatchObject({
      status: 'in_progress',
      overrideReason: 'Client deadline',
    });
    // A started task stays started when it gets a new unfinished dependency (rule 3).
    const more = await cast.createTask(cast.designManager.cookie);
    const replaced = await put(task.id, cast.designManager.cookie, [waitOn.id, more.id]);
    expect(replaced.status).toBe(200);
    expect(taskDependencyListSchema.parse(await replaced.json()).items).toHaveLength(2);
    expect((await cast.detail(task.id, cast.gm.cookie)).status).toBe('in_progress');
  });

  it('lets an account manager override on their client, without working the task', async () => {
    const { id: clientId } = await cast.createClient();
    const waitOn = await cast.createTask(cast.am.cookie, { clientId });
    const task = await cast.createTask(cast.am.cookie, {
      clientId,
      assigneeId: cast.designer.id,
      dependsOn: [waitOn.id],
    });
    expect(task.allowedTransitions).toEqual(['in_progress', 'cancelled']);
    await cast.moveOk(task.id, cast.am.cookie, {
      status: 'in_progress',
      overrideDependencies: true,
      reason: 'Launch day',
    });
    // Without a block, starting is the assignee's.
    const free = await cast.createTask(cast.am.cookie, { clientId, assigneeId: cast.designer.id });
    expect((await cast.move(free.id, cast.am.cookie, { status: 'in_progress' })).status).toBe(403);
  });

  it('keeps an archived dependency when others are added, and checks client changes', async () => {
    const { id: clientId } = await cast.createClient();
    const { id: otherId } = await cast.createClient();
    const archived = await cast.createTask(cast.am.cookie, { clientId });
    const task = await cast.createTask(cast.am.cookie, { clientId, dependsOn: [archived.id] });
    await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie);
    const added = await cast.createTask(cast.am.cookie, { clientId });
    const response = await put(task.id, cast.am.cookie, [archived.id, added.id]);
    expect(response.status).toBe(200);
    expect(
      taskDependencyListSchema
        .parse(await response.json())
        .items.map((d) => [d.id, d.archived])
        .sort(),
    ).toEqual(
      [
        [archived.id, true],
        [added.id, false],
      ].sort(),
    );
    await expectError(
      await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: cast.gm.cookie,
        body: { clientId: otherId },
      }),
      400,
      'INVALID_DEPENDENCY',
    );
  });

  it('stops blocking when a dependency is cancelled (edge case 3)', async () => {
    const waitOn = await cast.createTask(cast.designManager.cookie);
    const task = await cast.createTask(cast.designManager.cookie, {
      assigneeId: cast.designer.id,
      dependsOn: [waitOn.id],
    });
    await cast.moveOk(waitOn.id, cast.designManager.cookie, {
      status: 'cancelled',
      note: 'Dropped',
    });
    const detail = await cast.detail(task.id, cast.designer.cookie);
    expect(detail).toMatchObject({ blocked: false, dependencies: [{ status: 'cancelled' }] });
  });

  it('blocks a new task again when its finished dependency is reopened (edge case 3)', async () => {
    const { id: clientId } = await cast.createClient();
    const dependency = await cast.taskAt('delivered', { clientId });
    const waiting = await cast.createTask(cast.am.cookie, { clientId, dependsOn: [dependency.id] });
    expect((await cast.detail(waiting.id, cast.gm.cookie)).blocked).toBe(false);
    await cast.moveOk(dependency.id, cast.designManager.cookie, {
      status: 'in_progress',
      note: 'One more change',
    });
    expect((await cast.detail(waiting.id, cast.gm.cookie)).blocked).toBe(true);
  });

  it('never lets two concurrent edits close a cycle between them (rule 4, edge case 2)', async () => {
    const { id: clientId } = await cast.createClient();
    const [a, b, c, d] = await Promise.all(
      [0, 1, 2, 3].map(() => cast.createTask(cast.am.cookie, { clientId })),
    );
    if (!a || !b || !c || !d) throw new Error('Tasks missing');
    // C waits on B and D waits on A: A→C and B→D together would close A→C→B→D→A.
    expect((await put(c.id, cast.am.cookie, [b.id])).status).toBe(200);
    expect((await put(d.id, cast.am.cookie, [a.id])).status).toBe(200);
    const [first, second] = await Promise.all([
      put(a.id, cast.am.cookie, [c.id]),
      put(b.id, cast.am.cookie, [d.id]),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = first.status === 409 ? first : second;
    expect(((await refused.json()) as { code: string }).code).toBe('DEPENDENCY_CYCLE');
  });

  it('keeps dependencies within one client, without cycles, at most 10 (rule 4)', async () => {
    const { id: clientId } = await cast.createClient();
    const { id: otherId } = await cast.createClient();
    const a = await cast.createTask(cast.am.cookie, { clientId });
    const b = await cast.createTask(cast.am.cookie, { clientId, dependsOn: [a.id] });
    const c = await cast.createTask(cast.am.cookie, { clientId, dependsOn: [b.id] });
    const foreign = await cast.createTask(cast.am.cookie, { clientId: otherId });
    const internal = await cast.createTask(cast.designManager.cookie);
    await expectError(await put(a.id, cast.am.cookie, [foreign.id]), 400, 'INVALID_DEPENDENCY');
    await expectError(await put(a.id, cast.am.cookie, [internal.id]), 400, 'INVALID_DEPENDENCY');
    await expectError(await put(a.id, cast.am.cookie, [randomUUID()]), 400, 'INVALID_DEPENDENCY');
    await expectError(await put(a.id, cast.am.cookie, [c.id]), 409, 'DEPENDENCY_CYCLE');
    await expectError(await put(a.id, cast.am.cookie, [a.id]), 409, 'DEPENDENCY_CYCLE');
    const many = await Promise.all(
      Array.from({ length: 11 }, () => cast.createTask(cast.am.cookie, { clientId })),
    );
    await expectError(
      await put(
        c.id,
        cast.am.cookie,
        many.map((t) => t.id),
      ),
      409,
      'LIMIT_REACHED',
    );
    // Only manage scope changes dependencies.
    expect((await put(c.id, cast.designer.cookie, [])).status).toBe(403);
    expect((await put(c.id, cast.otherAm.cookie, [])).status).toBe(403);
    const cleared = await put(c.id, cast.am.cookie, []);
    expect(taskDependencyListSchema.parse(await cleared.json()).items).toEqual([]);
    const actions = (
      await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, c.id))
        .orderBy(auditEntries.id)
    ).map((e) => [e.action, e.before, e.after]);
    expect(actions.at(-1)).toEqual([
      'task.dependencies_updated',
      { dependsOn: [{ id: b.id, title: b.title }] },
      { dependsOn: [] },
    ]);
    expect((await put(randomUUID(), cast.am.cookie, [])).status).toBe(404);
  });
});
