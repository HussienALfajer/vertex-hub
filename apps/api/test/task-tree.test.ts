import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { taskTreeSchema } from '@vertex-hub/contracts';
import { createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('the task tree (F06B rule D4)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const treeOf = (query: string, cookie: string | undefined) =>
    client.get(`/api/tasks/tree?${query}`, cookie);

  async function treeOk(query: string, cookie: string) {
    const response = await treeOf(query, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return taskTreeSchema.parse(await response.json());
  }

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

  it("draws a project's milestones, tasks and subtasks with the bottleneck", async () => {
    const owner = await cast.createClient();
    const project = await cast.createProject(owner.id, {
      milestones: [{ name: `مرحلة ${cast.run}`, dueDate: cast.inDays(20) }],
    });
    const [first] = project.milestones;
    const links = { clientId: owner.id, projectId: project.id };

    const parent = await cast.createTask(cast.gm.cookie, {
      ...links,
      milestoneId: first?.id,
      title: `حملة ${cast.run}`,
      dueDate: cast.inDays(12),
      runMode: 'sequential',
      subtasks: [
        { title: 'Copy', department: 'content_management', dueDate: cast.inDays(4) },
        { title: 'Design', department: 'design', dueDate: cast.inDays(8) },
        { title: 'Video', department: 'photography', dueDate: cast.inDays(10) },
      ],
    });
    const loose = await cast.createTask(cast.gm.cookie, { ...links, title: `منفردة ${cast.run}` });
    const outside = await cast.createTask(cast.gm.cookie, {
      clientId: owner.id,
      title: `خارجية ${cast.run}`,
    });
    const waiting = await cast.createTask(cast.gm.cookie, {
      ...links,
      title: `تنتظر ${cast.run}`,
      dependsOn: [outside.id],
    });

    expect((await treeOf(`projectId=${project.id}`, undefined)).status).toBe(401);
    expect((await treeOf(`projectId=${randomUUID()}`, cast.employee.cookie)).status).toBe(404);
    expect((await treeOf('', cast.employee.cookie)).status).toBe(400);

    const tree = await treeOk(`projectId=${project.id}`, cast.employee.cookie);
    const [inMilestone, rest] = tree.groups;
    expect(inMilestone?.milestone?.id).toBe(first?.id);
    expect(inMilestone?.tasks.map((task) => task.id)).toEqual([parent.id]);
    expect(inMilestone?.tasks[0]).toMatchObject({ runMode: 'sequential' });
    expect(inMilestone?.tasks[0]?.subtasks.map((subtask) => subtask.title)).toEqual([
      'Copy',
      'Design',
      'Video',
    ]);
    expect(rest?.milestone).toBeNull();
    expect(rest?.tasks.map((task) => task.id).sort()).toEqual([loose.id, waiting.id].sort());

    const [copy, design, video] = parent.subtasks;
    expect(tree.edges).toEqual(
      expect.arrayContaining([
        { taskId: design?.id, dependsOnId: copy?.id, source: 'run' },
        { taskId: video?.id, dependsOnId: design?.id, source: 'run' },
        { taskId: waiting.id, dependsOnId: outside.id, source: 'manual' },
      ]),
    );
    expect(tree.outside).toEqual([{ id: outside.id, title: outside.title, status: 'new' }]);
    // Two open subtasks wait on the copy, directly or through the design.
    expect(tree.bottleneckId).toBe(copy?.id);
  });

  it("draws a retainer cycle's tasks in one group", async () => {
    const owner = await cast.createClient();
    const retainer = await cast.createRetainer(owner.id);
    const cycleId = retainer.currentCycle?.id as string;
    const task = await cast.createTask(cast.gm.cookie, {
      clientId: owner.id,
      retainerCycleId: cycleId,
      title: `شهرية ${cast.run}`,
    });
    const tree = await treeOk(`retainerCycleId=${cycleId}`, cast.employee.cookie);
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0]?.milestone).toBeNull();
    expect(tree.groups[0]?.tasks.map((node) => node.id)).toEqual([task.id]);
    expect(tree.bottleneckId).toBeNull();
    expect((await treeOf(`retainerCycleId=${randomUUID()}`, cast.employee.cookie)).status).toBe(
      404,
    );
  });
});
