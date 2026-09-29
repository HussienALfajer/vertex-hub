import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  TASK_LIMITS,
  taskChecklistItemSchema,
  taskChecklistSchema,
  taskLinkSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, taskChecklistItems, taskLinks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task checklist and links (rule 15)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const addItem = (taskId: string, cookie: string | undefined, text: string) =>
    client.post(`/api/tasks/${taskId}/checklist`, cookie, { text });
  const patchItem = (taskId: string, itemId: string, cookie: string, body: unknown) =>
    client.request('PATCH', `/api/tasks/${taskId}/checklist/${itemId}`, { cookie, body });
  const reorder = (taskId: string, cookie: string, ids: string[]) =>
    client.request('PUT', `/api/tasks/${taskId}/checklist/order`, { cookie, body: { ids } });
  const addLink = (taskId: string, cookie: string | undefined, body: unknown) =>
    client.post(`/api/tasks/${taskId}/links`, cookie, body);

  async function itemOk(taskId: string, cookie: string, text: string) {
    const response = await addItem(taskId, cookie, text);
    expect(response.status).toBe(201);
    return taskChecklistItemSchema.parse(await response.json());
  }

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  /** A Design task assigned to the designer. */
  const designTask = () =>
    cast.createTask(cast.designManager.cookie, { assigneeId: cast.designer.id });

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
    const id = randomUUID();
    const item = randomUUID();
    expect((await addItem(id, undefined, 'x')).status).toBe(401);
    expect(
      (await client.request('PATCH', `/api/tasks/${id}/checklist/${item}`, { body: {} })).status,
    ).toBe(401);
    expect(
      (await client.request('PUT', `/api/tasks/${id}/checklist/order`, { body: { ids: [] } }))
        .status,
    ).toBe(401);
    expect((await client.post(`/api/tasks/${id}/checklist/${item}/archive`)).status).toBe(401);
    expect((await addLink(id, undefined, { url: 'https://example.com' })).status).toBe(401);
    expect((await client.post(`/api/tasks/${id}/links/${item}/archive`)).status).toBe(401);
  });

  it('lets the assignee add, tick, rename, order and remove items, audited with the task', async () => {
    const task = await designTask();
    const crop = await itemOk(task.id, cast.designer.cookie, ' Crop the photo ');
    const colours = await itemOk(task.id, cast.designer.cookie, 'Check colours');
    const export_ = await itemOk(task.id, cast.designer.cookie, 'Export');
    expect([crop, colours, export_].map((i) => [i.text, i.position])).toEqual([
      ['Crop the photo', 1],
      ['Check colours', 2],
      ['Export', 3],
    ]);

    const ticked = taskChecklistItemSchema.parse(
      await (await patchItem(task.id, crop.id, cast.designer.cookie, { done: true })).json(),
    );
    expect(ticked).toMatchObject({ done: true, doneBy: { id: cast.designer.id } });
    const renamed = taskChecklistItemSchema.parse(
      await (
        await patchItem(task.id, crop.id, cast.designer.cookie, { text: 'Crop', done: false })
      ).json(),
    );
    expect(renamed).toMatchObject({ text: 'Crop', done: false, doneBy: null, doneAt: null });

    const ordered = taskChecklistSchema.parse(
      await (
        await reorder(task.id, cast.designer.cookie, [export_.id, crop.id, colours.id])
      ).json(),
    );
    expect(ordered.items.map((i) => [i.id, i.position])).toEqual([
      [export_.id, 1],
      [crop.id, 2],
      [colours.id, 3],
    ]);
    await expectError(
      await reorder(task.id, cast.designer.cookie, [crop.id, colours.id]),
      409,
      'INVALID_ORDER',
    );

    expect(
      (
        await client.post(
          `/api/tasks/${task.id}/checklist/${crop.id}/archive`,
          cast.designer.cookie,
        )
      ).status,
    ).toBe(204);
    const detail = await cast.detail(task.id, cast.designer.cookie);
    expect(detail.checklistItems.map((i) => [i.id, i.position])).toEqual([
      [export_.id, 1],
      [colours.id, 2],
    ]);
    expect(detail.checklist).toEqual({ done: 0, total: 2 });
    expect((await patchItem(task.id, crop.id, cast.designer.cookie, { done: true })).status).toBe(
      404,
    );

    expect((await auditOf(crop.id)).map((e) => [e.action, e.after])).toEqual([
      ['task_checklist_item.created', { taskId: task.id, text: 'Crop the photo', position: 1 }],
      ['task_checklist_item.updated', { taskId: task.id, done: true }],
      ['task_checklist_item.updated', { taskId: task.id, text: 'Crop', done: false }],
      ['task_checklist_item.reordered', { taskId: task.id, position: 2 }],
      ['task_checklist_item.archived', { taskId: task.id, archived: true }],
    ]);
  });

  it('lets the department manager and the project manager change the checklist, nobody else', async () => {
    const task = await designTask();
    const item = await itemOk(task.id, cast.designManager.cookie, 'From the manager');
    const linkResponse = await addLink(task.id, cast.designManager.cookie, {
      url: 'https://a.example',
    });
    expect(linkResponse.status).toBe(201);
    const link = taskLinkSchema.parse(await linkResponse.json());
    for (const cookie of [cast.writer.cookie, cast.contentManager.cookie]) {
      expect((await addItem(task.id, cookie, 'x')).status).toBe(403);
      expect((await patchItem(task.id, item.id, cookie, { done: true })).status).toBe(403);
      expect((await reorder(task.id, cookie, [item.id])).status).toBe(403);
      expect(
        (await client.post(`/api/tasks/${task.id}/checklist/${item.id}/archive`, cookie)).status,
      ).toBe(403);
      expect((await addLink(task.id, cookie, { url: 'https://b.example' })).status).toBe(403);
      expect(
        (await client.post(`/api/tasks/${task.id}/links/${link.id}/archive`, cookie)).status,
      ).toBe(403);
    }

    // An item or link of another task is not found through this one.
    const other = await designTask();
    expect((await patchItem(other.id, item.id, cast.designer.cookie, { done: true })).status).toBe(
      404,
    );
    expect(
      (
        await client.post(
          `/api/tasks/${other.id}/checklist/${item.id}/archive`,
          cast.designer.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (await client.post(`/api/tasks/${other.id}/links/${link.id}/archive`, cast.designer.cookie))
        .status,
    ).toBe(404);
    const detail = await cast.detail(task.id, cast.designer.cookie);
    expect(detail.checklistItems.map((i) => [i.id, i.done])).toEqual([[item.id, false]]);
    expect(detail.links.map((l) => l.id)).toEqual([link.id]);

    const { id: clientId } = await cast.createClient();
    const project = await cast.createProject(clientId);
    const projectTask = await cast.createTask(cast.designManager.cookie, {
      clientId,
      projectId: project.id,
    });
    await itemOk(projectTask.id, cast.employee.cookie, 'From the project manager');
    expect((await addItem(projectTask.id, cast.writer.cookie, 'x')).status).toBe(403);
    expect((await addItem(randomUUID(), cast.designer.cookie, 'x')).status).toBe(404);
  });

  it('caps the checklist at 20 items', async () => {
    const task = await designTask();
    await db.insert(taskChecklistItems).values(
      Array.from({ length: TASK_LIMITS.checklist }, (_, index) => ({
        taskId: task.id,
        text: `Item ${index + 1}`,
        position: index + 1,
      })),
    );
    await expectError(
      await addItem(task.id, cast.designer.cookie, 'One more'),
      409,
      'LIMIT_REACHED',
    );
  });

  it('adds and removes links, keeping only the site in the audit', async () => {
    const task = await designTask();
    const response = await addLink(task.id, cast.designer.cookie, {
      url: 'https://drive.example.com/file/abc?token=secret',
      label: 'Drive',
    });
    expect(response.status).toBe(201);
    const link = taskLinkSchema.parse(await response.json());
    expect(link).toMatchObject({ label: 'Drive', addedBy: { id: cast.designer.id } });
    expect((await addLink(task.id, cast.designer.cookie, { url: 'ftp://x.example' })).status).toBe(
      400,
    );
    expect((await cast.detail(task.id, cast.designer.cookie)).links.map((l) => l.id)).toEqual([
      link.id,
    ]);

    expect(
      (
        await client.post(
          `/api/tasks/${task.id}/links/${link.id}/archive`,
          cast.designManager.cookie,
        )
      ).status,
    ).toBe(204);
    expect((await cast.detail(task.id, cast.designer.cookie)).links).toEqual([]);
    expect(
      (await client.post(`/api/tasks/${task.id}/links/${link.id}/archive`, cast.designer.cookie))
        .status,
    ).toBe(404);
    const audit = await auditOf(link.id);
    expect(audit.map((e) => [e.action, e.after])).toEqual([
      ['task_link.created', { taskId: task.id, label: 'Drive', site: 'drive.example.com' }],
      ['task_link.archived', { taskId: task.id, archived: true }],
    ]);
    expect(JSON.stringify(audit)).not.toContain('secret');
  });

  it('caps links at 30', async () => {
    const task = await designTask();
    await db.insert(taskLinks).values(
      Array.from({ length: TASK_LIMITS.links }, (_, index) => ({
        taskId: task.id,
        url: `https://example.com/${index}`,
        addedById: cast.designer.id,
      })),
    );
    await expectError(
      await addLink(task.id, cast.designer.cookie, { url: 'https://example.com/more' }),
      409,
      'LIMIT_REACHED',
    );
  });

  it('refuses changes on an archived task (rule 17)', async () => {
    const task = await designTask();
    const item = await itemOk(task.id, cast.designer.cookie, 'Before archive');
    expect((await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie)).status).toBe(200);
    await expectError(await addItem(task.id, cast.gm.cookie, 'x'), 409, 'TASK_ARCHIVED');
    await expectError(
      await patchItem(task.id, item.id, cast.gm.cookie, { done: true }),
      409,
      'TASK_ARCHIVED',
    );
    await expectError(
      await addLink(task.id, cast.gm.cookie, { url: 'https://example.com' }),
      409,
      'TASK_ARCHIVED',
    );
    // Hidden from everyone else.
    expect((await addItem(task.id, cast.designer.cookie, 'x')).status).toBe(404);
  });
});
