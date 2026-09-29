import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { taskCommentPageSchema, taskCommentSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase, users } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task comments (rule 16)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const post = (taskId: string, cookie: string | undefined, body: string) =>
    client.post(`/api/tasks/${taskId}/comments`, cookie, { body });
  const edit = (taskId: string, commentId: string, cookie: string | undefined, body: string) =>
    client.request('PATCH', `/api/tasks/${taskId}/comments/${commentId}`, {
      cookie,
      body: { body },
    });
  const remove = (taskId: string, commentId: string, cookie?: string) =>
    client.post(`/api/tasks/${taskId}/comments/${commentId}/archive`, cookie);

  async function comment(taskId: string, cookie: string, body: string) {
    const response = await post(taskId, cookie, body);
    expect(response.status).toBe(201);
    return taskCommentSchema.parse(await response.json());
  }

  async function list(taskId: string, cookie: string, query = '') {
    const response = await client.get(`/api/tasks/${taskId}/comments${query}`, cookie);
    expect(response.status).toBe(200);
    return taskCommentPageSchema.parse(await response.json());
  }

  const mention = (userId: string) => `@{${userId}}`;

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
    expect((await client.get(`/api/tasks/${id}/comments`)).status).toBe(401);
    expect((await post(id, undefined, 'x')).status).toBe(401);
    expect((await edit(id, randomUUID(), undefined, 'x')).status).toBe(401);
    expect((await remove(id, randomUUID())).status).toBe(401);
  });

  it('lets every user comment with mentions, oldest first, audited', async () => {
    const task = await cast.createTask(cast.designManager.cookie, { assigneeId: cast.designer.id });
    const first = await comment(
      task.id,
      cast.writer.cookie,
      ` Ready?\n${mention(cast.designer.id)} ${mention(cast.designManager.id)} `,
    );
    expect(first).toMatchObject({
      author: { id: cast.writer.id, archived: false },
      body: `Ready?\n${mention(cast.designer.id)} ${mention(cast.designManager.id)}`,
      mentions: [
        { id: cast.designer.id, name: cast.designer.name, archived: false },
        { id: cast.designManager.id, name: cast.designManager.name, archived: false },
      ],
      editedAt: null,
      removed: false,
      canEdit: true,
      canRemove: true,
    });
    const second = await comment(task.id, cast.designer.cookie, 'Almost');

    const page = await list(task.id, cast.employee.cookie);
    expect(page.total).toBe(2);
    expect(page.items.map((c) => [c.id, c.canEdit, c.canRemove])).toEqual([
      [first.id, false, false],
      [second.id, false, false],
    ]);
    expect((await list(task.id, cast.employee.cookie, '?pageSize=1&page=2')).items[0]?.id).toBe(
      second.id,
    );

    const [entry] = await db.select().from(auditEntries).where(eq(auditEntries.entityId, first.id));
    expect(entry).toMatchObject({
      action: 'task_comment.created',
      entityType: 'task_comment',
      actorId: cast.writer.id,
      after: { taskId: task.id, mentionedUserIds: [cast.designer.id, cast.designManager.id] },
    });
    expect(
      (await client.get(`/api/tasks/${randomUUID()}/comments`, cast.writer.cookie)).status,
    ).toBe(404);
  });

  it('refuses mentions of unknown or archived users (INVALID_MENTION)', async () => {
    const task = await cast.createTask(cast.designer.cookie);
    await expectError(
      await post(task.id, cast.designer.cookie, `Hi ${mention(randomUUID())}`),
      400,
      'INVALID_MENTION',
    );
    const leaver = await cast.signedIn({ name: `مغادر ${cast.run}` });
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, leaver.id));
    await expectError(
      await post(task.id, cast.designer.cookie, `Hi ${mention(leaver.id)}`),
      400,
      'INVALID_MENTION',
    );
  });

  it('lets only the author edit; mentions archived since stay (edge case 14)', async () => {
    const task = await cast.createTask(cast.designer.cookie);
    const colleague = await cast.signedIn({ name: `زميل ${cast.run}` });
    const written = await comment(task.id, cast.designer.cookie, `Ask ${mention(colleague.id)}`);
    await expectError(
      await edit(task.id, written.id, cast.gm.cookie, 'Not mine'),
      403,
      'NOT_COMMENT_AUTHOR',
    );

    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, colleague.id));
    const shown = (await list(task.id, cast.writer.cookie)).items[0];
    expect(shown?.mentions).toEqual([{ id: colleague.id, name: colleague.name, archived: true }]);

    const response = await edit(
      task.id,
      written.id,
      cast.designer.cookie,
      `Ask ${mention(colleague.id)} today`,
    );
    expect(response.status).toBe(200);
    const edited = taskCommentSchema.parse(await response.json());
    expect(edited.body).toBe(`Ask ${mention(colleague.id)} today`);
    expect(edited.editedAt).not.toBeNull();

    const other = await cast.signedIn({ name: `آخر ${cast.run}` });
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, other.id));
    await expectError(
      await edit(task.id, written.id, cast.designer.cookie, `Ask ${mention(other.id)}`),
      400,
      'INVALID_MENTION',
    );
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(eq(auditEntries.action, 'task_comment.updated'), eq(auditEntries.entityId, written.id)),
      );
    expect(entry?.before).toMatchObject({ body: `Ask ${mention(colleague.id)}` });
  });

  it('lets the author or scope all remove a comment, shown as removed in place', async () => {
    const task = await cast.createTask(cast.designer.cookie);
    const mine = await comment(
      task.id,
      cast.designer.cookie,
      `Draft for ${mention(cast.writer.id)}`,
    );
    const theirs = await comment(task.id, cast.writer.cookie, 'Noted');

    const asGm = (await list(task.id, cast.gm.cookie)).items;
    expect(asGm.map((c) => [c.canEdit, c.canRemove])).toEqual([
      [false, true],
      [false, true],
    ]);
    await expectError(
      await remove(task.id, theirs.id, cast.designer.cookie),
      403,
      'NOT_COMMENT_AUTHOR',
    );
    await expectError(
      await remove(task.id, theirs.id, cast.designManager.cookie),
      403,
      'NOT_COMMENT_AUTHOR',
    );
    expect((await remove(task.id, mine.id, cast.designer.cookie)).status).toBe(204);
    expect((await remove(task.id, theirs.id, cast.operations.cookie)).status).toBe(204);

    const page = await list(task.id, cast.designer.cookie);
    expect(page.items).toMatchObject([
      { id: mine.id, removed: true, body: null, mentions: [], canEdit: false, canRemove: false },
      { id: theirs.id, removed: true, body: null },
    ]);
    expect((await edit(task.id, mine.id, cast.designer.cookie, 'Back')).status).toBe(404);
    expect((await remove(task.id, mine.id, cast.designer.cookie)).status).toBe(404);
  });

  it('allows comments in any status, never on an archived task (rule 17)', async () => {
    const task = await cast.createTask(cast.designer.cookie);
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'cancelled', note: 'Not needed' });
    const written = await comment(task.id, cast.writer.cookie, 'Why cancelled?');

    expect((await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie)).status).toBe(200);
    await expectError(await post(task.id, cast.gm.cookie, 'x'), 409, 'TASK_ARCHIVED');
    const asGm = await list(task.id, cast.gm.cookie);
    expect(asGm.items[0]).toMatchObject({ id: written.id, canEdit: false, canRemove: false });
    await expectError(await remove(task.id, written.id, cast.gm.cookie), 409, 'TASK_ARCHIVED');
    expect((await list(task.id, cast.gm.cookie)).total).toBe(1);
    expect((await client.get(`/api/tasks/${task.id}/comments`, cast.writer.cookie)).status).toBe(
      404,
    );
  });
});
