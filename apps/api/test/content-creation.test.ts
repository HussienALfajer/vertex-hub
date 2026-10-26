import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  type ContentIdea,
  type CreatePostInput,
  contentIdeaSchema,
  errorResponseSchema,
  fileUploadSchema,
  postDetailSchema,
} from '@vertex-hub/contracts';
import { contentPillars, contentPosts, createDatabase, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08B PR 2, rules B1–B3 and C12: the wizard's save of a post with its captions, held files and
 * slide captions, existing and new linked tasks with subtasks, and the idea it comes from, in one
 * transaction.
 */
describe('creating a post in one save (F08B rules B1–B3)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;
  const pillars: string[] = [];

  const posts = '/api/content/posts';
  const create = (cookie: string | undefined, body: Partial<CreatePostInput>) =>
    client.post(posts, cookie, {
      clientId,
      title: `منشور المعالج ${cast.run}`,
      type: 'carousel',
      platforms: ['instagram'],
      publishDate: cast.inDays(8),
      ...body,
    });

  async function upload(name: string, cookie = cast.writer.cookie) {
    const form = new FormData();
    form.append('file', new Blob(['نص']), name);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileUploadSchema.parse(await response.json()).uploadId;
  }

  async function idea(cookie: string, body: object = {}): Promise<ContentIdea> {
    const response = await client.post('/api/content/ideas', cookie, {
      text: `فكرة ${cast.run} ${randomUUID().slice(0, 6)}`,
      clientId,
      ...body,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return contentIdeaSchema.parse(await response.json());
  }

  const byTitle = (title: string) =>
    db.select({ id: contentPosts.id }).from(contentPosts).where(eq(contentPosts.title, title));

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-content-creation-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    if (pillars.length > 0)
      await db.delete(contentPillars).where(inArray(contentPillars.id, pillars));
    await connection.close();
    delete process.env.FILES_ROOT;
    await rm(filesRoot, { recursive: true, force: true });
  });

  it('saves the post, captions, files with slide captions, linked and new tasks and the idea', async () => {
    const employee = await cast.signedIn({
      name: `موظف ${cast.run}`,
      departments: [{ code: 'development' }],
    });
    const fromIdea = await idea(employee.cookie);
    const existing = await cast.taskAt('in_progress', { clientId });
    const first = await upload('first.txt');
    const second = await upload('second.txt');
    const title = `منشور كامل ${cast.run}`;
    const response = await create(cast.writer.cookie, {
      title,
      platforms: ['instagram', 'x'],
      captions: [
        { group: 'facebook_instagram', caption: 'نص إنستغرام' },
        { group: 'x', caption: 'نص إكس' },
      ],
      files: [
        { uploadId: first, name: `أولى ${cast.run}` },
        { uploadId: second, name: `ثانية ${cast.run}`, slideCaption: 'شرح' },
      ],
      linkTaskIds: [existing.id],
      tasks: [
        {
          title: `تصميم الكاروسيل ${cast.run}`,
          department: 'design',
          dueDate: cast.inDays(6),
          runMode: 'sequential',
          subtasks: [
            { title: `مسودة ${cast.run}`, department: 'design', dueDate: cast.inDays(4) },
            { title: `إخراج ${cast.run}`, department: 'design', dueDate: cast.inDays(6) },
          ],
        },
      ],
      ideaId: fromIdea.id,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const post = postDetailSchema.parse(await response.json());
    expect(post).toMatchObject({ status: 'in_production', title });
    expect(post.captions.map((caption) => caption.caption)).toEqual(['نص إنستغرام', 'نص إكس']);
    expect(post.media.map((medium) => [medium.name, medium.slideCaption])).toEqual([
      [`أولى ${cast.run}`, null],
      [`ثانية ${cast.run}`, 'شرح'],
    ]);
    expect(post.linkedTasks.map((task) => task.id)).toContain(existing.id);
    expect(post.linkedTasks).toHaveLength(2);
    const created = post.linkedTasks.find((task) => task.id !== existing.id);
    const subtasks = await db
      .select({ title: tasks.title, clientId: tasks.clientId })
      .from(tasks)
      .where(eq(tasks.parentId, created?.id ?? ''));
    expect(subtasks.map((task) => task.title).sort()).toEqual(
      [`إخراج ${cast.run}`, `مسودة ${cast.run}`].sort(),
    );
    expect(subtasks.every((task) => task.clientId === clientId)).toBe(true);

    // The idea is used, and its author is told.
    const used = await client.get('/api/content/ideas?status=used', employee.cookie);
    const usedIdeas = (await used.json()) as { items: ContentIdea[] };
    expect(usedIdeas.items.find((item) => item.id === fromIdea.id)?.post).toEqual({
      id: post.id,
      title,
    });
    expect(await cast.typesOf(employee.id, post.id)).toContain('content_idea_used');

    const [entry] = await cast.auditOf(post.id);
    expect(entry).toMatchObject({
      action: 'post.created',
      after: { files: 2, ideaId: fromIdea.id, taskIds: [existing.id, created?.id] },
    });
  });

  it('saves nothing when one part fails, and names it', async () => {
    const title = `منشور فاشل ${cast.run}`;
    const kept = await upload('kept.txt');
    const missing = await expectError(
      await create(cast.writer.cookie, {
        title,
        files: [{ uploadId: kept }, { uploadId: randomUUID() }],
      }),
      400,
      'UPLOAD_NOT_FOUND',
    );
    expect(missing.details).toEqual({ part: 'files', index: 1 });
    expect(await byTitle(title)).toEqual([]);

    // The upload rolled back with the rest: the next save uses it.
    const other = (await cast.createClient()).id;
    const elsewhere = await cast.taskAt('in_progress', { clientId: other });
    const notLinkable = await expectError(
      await create(cast.writer.cookie, {
        title,
        files: [{ uploadId: kept }],
        linkTaskIds: [elsewhere.id],
      }),
      409,
      'TASK_NOT_LINKABLE',
    );
    expect(notLinkable.details).toEqual({ part: 'links', index: 0 });

    const late = await expectError(
      await create(cast.writer.cookie, {
        title,
        tasks: [
          {
            title: 'مهمة',
            department: 'design',
            dueDate: cast.inDays(3),
            subtasks: [{ title: 'متأخرة', department: 'design', dueDate: cast.inDays(4) }],
          },
        ],
      }),
      400,
      'INVALID_DATES',
    );
    expect(late.details).toMatchObject({
      part: 'tasks',
      index: 0,
      cause: { part: 'subtasks', index: 0 },
    });

    // An assignee the creator may not choose: a bare 403 still names its part (edge case 9).
    const forbidden = await create(cast.writer.cookie, {
      title,
      tasks: [
        { title: 'مهمة', department: 'design', dueDate: cast.inDays(3) },
        {
          title: 'مهمة لغيري',
          department: 'design',
          assigneeId: cast.designer.id,
          dueDate: cast.inDays(3),
        },
      ],
    });
    expect(forbidden.status, await forbidden.clone().text()).toBe(403);
    expect(errorResponseSchema.parse(await forbidden.json()).details).toEqual({
      part: 'tasks',
      index: 1,
    });

    await expectError(
      await create(cast.writer.cookie, {
        title,
        captions: [{ group: 'tiktok', caption: 'x' }],
      }),
      400,
      'INVALID_CAPTION_GROUP',
    );
    expect(await byTitle(title)).toEqual([]);
    const ok = await create(cast.writer.cookie, { title, files: [{ uploadId: kept }] });
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it('refuses a used idea, an archived pillar and more than five tasks', async () => {
    const used = await idea(cast.writer.cookie);
    expect((await create(cast.writer.cookie, { ideaId: used.id })).status).toBe(201);
    await expectError(await create(cast.writer.cookie, { ideaId: used.id }), 409, 'IDEA_USED');

    const [pillar] = await db
      .insert(contentPillars)
      .values({ name: `مؤرشف ${cast.run}`, color: 'chart_5', position: 99, archivedAt: new Date() })
      .returning();
    if (pillar) pillars.push(pillar.id);
    await expectError(
      await create(cast.writer.cookie, { pillarId: pillar?.id }),
      400,
      'INVALID_LINK',
    );

    const task = (n: number) => ({
      title: `مهمة ${n}`,
      department: 'design' as const,
      dueDate: cast.inDays(5),
    });
    expect(
      (
        await create(cast.writer.cookie, {
          tasks: [1, 2, 3, 4, 5].map(task),
          linkTaskIds: [randomUUID()],
        })
      ).status,
    ).toBe(409);
  });

  it('is for edit scope on the client', async () => {
    expect((await create(undefined, {})).status).toBe(401);
    expect((await create(cast.designer.cookie, {})).status).toBe(403);
    expect((await create(cast.otherAm.cookie, {})).status).toBe(403);
  });

  it('keeps an idea of another client out', async () => {
    const other = (await cast.createClient()).id;
    const theirs = await idea(cast.writer.cookie, { clientId: other });
    await expectError(await create(cast.writer.cookie, { ideaId: theirs.id }), 400, 'INVALID_LINK');
    const [row] = await db
      .select({ id: contentPosts.id })
      .from(contentPosts)
      .where(and(eq(contentPosts.clientId, clientId), eq(contentPosts.title, theirs.text)));
    expect(row).toBeUndefined();
  });
});
