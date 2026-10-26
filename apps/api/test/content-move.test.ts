import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  movedPostSchema,
  moveWorkDays,
  postMovePreviewSchema,
  shiftDueDate,
} from '@vertex-hub/contracts';
import { contentPosts, createDatabase, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08B PR 2, rules B6–B9: moving a post to another day, with the shift of its open linked tasks'
 * due dates by the same number of work days, clamped to today and never after a parent.
 */
describe('moving a post (F08B rules B6–B9)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;

  const posts = '/api/content/posts';
  const preview = (id: string, date: string, cookie = cast.writer.cookie) =>
    client.get(`${posts}/${id}/move-preview?publishDate=${date}`, cookie);
  const move = (id: string, cookie: string | undefined, body: object) =>
    client.post(`${posts}/${id}/move`, cookie, body);

  const dueOf = async (id: string) =>
    (await db.select({ dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, id)))[0]?.dueDate;

  /** A post due in `days` with a linked Design task (and its subtask) due a day before. */
  async function postWithTask(days: number) {
    const post = await cast.createPost(cast.writer.cookie, {
      clientId,
      publishDate: cast.inDays(days),
    });
    const parent = await cast.createTask(cast.designManager.cookie, {
      clientId,
      assigneeId: cast.designer.id,
      dueDate: cast.inDays(days - 1),
      runMode: 'parallel',
      subtasks: [
        {
          title: `فرعية ${cast.run}`,
          department: 'design',
          assigneeId: cast.designer.id,
          dueDate: cast.inDays(days - 2),
        },
      ],
    });
    const linked = await client.request('PUT', `${posts}/${post.id}/tasks/${parent.id}`, {
      cookie: cast.writer.cookie,
    });
    expect(linked.status, await linked.clone().text()).toBe(200);
    const [subtask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentId, parent.id));
    return { post, parent, subtaskId: subtask?.id ?? '' };
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('previews the shift, ticked when a task would be due after the new date', async () => {
    const { post, parent, subtaskId } = await postWithTask(10);
    const target = cast.inDays(6);
    const response = await preview(post.id, target);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = postMovePreviewSchema.parse(await response.json());
    const workDays = moveWorkDays(post.publishDate, target);
    expect(body.workDays).toBe(workDays);
    expect(body.suggestShift).toBe(true);
    expect(body.tasks.map((task) => [task.id, task.parentId, task.newDueDate])).toEqual([
      [parent.id, null, shiftDueDate(parent.dueDate, workDays, businessDate()).date],
      [subtaskId, parent.id, shiftDueDate(cast.inDays(8), workDays, businessDate()).date],
    ]);
    // Later: nothing would be due after the new date.
    const later = postMovePreviewSchema.parse(
      await (await preview(post.id, cast.inDays(14))).json(),
    );
    expect(later.suggestShift).toBe(false);
    expect((await preview(post.id, target, cast.designer.cookie)).status).toBe(403);
  });

  it('moves the post and shifts its open tasks, audited, telling the assignee once', async () => {
    const { post, parent, subtaskId } = await postWithTask(12);
    const target = cast.inDays(9);
    const workDays = moveWorkDays(post.publishDate, target);
    const response = await move(post.id, cast.contentManager.cookie, {
      publishDate: target,
      shiftTasks: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const moved = movedPostSchema.parse(await response.json());
    expect(moved).toMatchObject({ publishDate: target, status: 'in_production' });
    expect(moved.shiftedTaskIds.sort()).toEqual([parent.id, subtaskId].sort());
    expect(await dueOf(parent.id)).toBe(
      shiftDueDate(parent.dueDate, workDays, businessDate()).date,
    );
    expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
      action: 'post.moved',
      before: { publishDate: post.publishDate },
      after: { publishDate: target },
    });
    const taskEntries = await cast.auditOf(parent.id);
    expect(taskEntries.at(-1)).toMatchObject({
      action: 'task.updated',
      after: { reason: 'post_moved', postId: post.id },
    });
    // The responsible and the assignee hear of the move; nobody gets `task_changed`.
    expect(await cast.typesOf(cast.writer.id, post.id)).toContain('post_moved');
    expect(await cast.typesOf(cast.designer.id, post.id)).toContain('post_moved');
    expect(await cast.typesOf(cast.designer.id, parent.id)).not.toContain('task_changed');
  });

  it('keeps the tasks without the shift, and refuses past days and closed posts', async () => {
    const { post, parent } = await postWithTask(10);
    const before = await dueOf(parent.id);
    const kept = movedPostSchema.parse(
      await (await move(post.id, cast.writer.cookie, { publishDate: cast.inDays(4) })).json(),
    );
    expect(kept.shiftedTaskIds).toEqual([]);
    expect(await dueOf(parent.id)).toBe(before);

    await expectError(
      await move(post.id, cast.writer.cookie, { publishDate: addDays(businessDate(), -1) }),
      400,
      'INVALID_DATES',
    );
    expect((await move(post.id, undefined, { publishDate: cast.inDays(3) })).status).toBe(401);
    expect(
      (await move(post.id, cast.designer.cookie, { publishDate: cast.inDays(3) })).status,
    ).toBe(403);
    expect((await move(randomUUID(), cast.gm.cookie, { publishDate: cast.inDays(3) })).status).toBe(
      404,
    );
    const published = await cast.postAt('published', { clientId });
    await expectError(
      await move(published.id, cast.writer.cookie, { publishDate: cast.inDays(3) }),
      409,
      'POST_LOCKED',
    );
  });

  it('clamps a date before today and keeps a subtask not after its parent (edge case 7)', async () => {
    const { post, parent, subtaskId } = await postWithTask(6);
    // Due tomorrow and in two days, moved four work days earlier: both before today.
    await db
      .update(tasks)
      .set({ dueDate: cast.inDays(1) })
      .where(eq(tasks.id, parent.id));
    await db
      .update(tasks)
      .set({ dueDate: cast.inDays(1) })
      .where(eq(tasks.id, subtaskId));
    await db
      .update(contentPosts)
      .set({ publishDate: cast.inDays(6) })
      .where(eq(contentPosts.id, post.id));
    const target = businessDate();
    const body = postMovePreviewSchema.parse(await (await preview(post.id, target)).json());
    const workDays = moveWorkDays(cast.inDays(6), target);
    if (workDays <= -2) {
      expect(body.tasks.every((task) => task.newDueDate === businessDate() && task.clamped)).toBe(
        true,
      );
    }
    const moved = movedPostSchema.parse(
      await (
        await move(post.id, cast.writer.cookie, { publishDate: target, shiftTasks: true })
      ).json(),
    );
    expect(moved.publishDate).toBe(target);
    const parentDue = (await dueOf(parent.id)) ?? '';
    expect((await dueOf(subtaskId)) ?? '').toBe(
      parentDue <= businessDate() ? businessDate() : parentDue,
    );
  });

  it('leaves approved tasks where they are (edge case 8)', async () => {
    const post = await cast.createPost(cast.writer.cookie, {
      clientId,
      publishDate: cast.inDays(10),
    });
    const approved = await cast.taskAt('approved', {
      clientId,
      dueDate: cast.inDays(9),
      needsClientApproval: false,
    });
    const linked = await client.request('PUT', `${posts}/${post.id}/tasks/${approved.id}`, {
      cookie: cast.writer.cookie,
    });
    expect(linked.status).toBe(200);
    const body = postMovePreviewSchema.parse(await (await preview(post.id, cast.inDays(5))).json());
    expect(body.tasks).toEqual([]);
    const moved = movedPostSchema.parse(
      await (
        await move(post.id, cast.writer.cookie, { publishDate: cast.inDays(5), shiftTasks: true })
      ).json(),
    );
    expect(moved.shiftedTaskIds).toEqual([]);
    expect(await dueOf(approved.id)).toBe(cast.inDays(9));
  });

  it('tells the account manager of a post with the client', async () => {
    const waiting = await cast.postAt('awaiting_client', {
      clientId,
      publishDate: cast.inDays(10),
    });
    const moved = await move(waiting.id, cast.writer.cookie, { publishDate: cast.inDays(11) });
    expect(moved.status).toBe(200);
    expect(await cast.typesOf(cast.am.id, waiting.id)).toContain('post_moved');
  });
});
