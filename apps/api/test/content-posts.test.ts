import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  contentCalendarSchema,
  cyclePageSchema,
  type ErrorResponse,
  fileItemListSchema,
  myContentSummarySchema,
  postDetailSchema,
  postPageSchema,
} from '@vertex-hub/contracts';
import { contentPosts, createDatabase, retainerCycles } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, departmentId } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08 PR 1: posts (create, read, edit, duplicate, archive), the calendar, the lists and My posts,
 * the post's own files, counting on a retainer cycle line and the responsible person.
 */
describe('content posts (F08 rules 1–5, 16, 28)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;

  const posts = '/api/content/posts';
  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `${posts}/${id}`, { cookie, body });
  const calendar = async (query: string, cookie: string) => {
    const response = await client.get(`/api/content/calendar?${query}`, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return contentCalendarSchema.parse(await response.json());
  };
  const list = async (query: string, cookie: string) => {
    const response = await client.get(`${posts}?${query}`, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return postPageSchema.parse(await response.json());
  };
  const summary = async (cookie: string) => {
    const response = await client.get('/api/me/content/summary', cookie);
    expect(response.status).toBe(200);
    return myContentSummarySchema.parse(await response.json());
  };
  const base = () => ({
    clientId,
    title: `منشور ${cast.run}`,
    type: 'post',
    platforms: ['instagram', 'facebook'],
    publishDate: cast.inDays(5),
  });

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

  it('requires a session on every route', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      client.get('/api/content/calendar?from=2026-10-01&to=2026-10-31'),
      client.get(posts),
      client.get('/api/me/content/summary'),
      client.post(posts, undefined, {}),
      client.get(`${posts}/${id}`),
      patch(id, undefined, {}),
      client.post(`${posts}/${id}/status`, undefined, { to: 'in_production' }),
      client.post(`${posts}/${id}/medical-review`, undefined, { decision: 'approve' }),
      client.post(`${posts}/${id}/duplicate`, undefined, {}),
      client.post(`${posts}/${id}/archive`),
      client.post(`${posts}/${id}/restore`),
    ]);
    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 401));
  });

  describe('create (rules 2 and 16)', () => {
    it('creates an idea with the caller responsible, audited without the caption text', async () => {
      const response = await client.post(posts, cast.writer.cookie, {
        ...base(),
        title: `  عرض الخريف ${cast.run} `,
        caption: 'سطر أول\nسطر ثانٍ',
        hashtags: '#خريف',
        notes: 'ملاحظة داخلية',
        publishTime: '18:30',
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const post = postDetailSchema.parse(await response.json());
      expect(post).toMatchObject({
        title: `عرض الخريف ${cast.run}`,
        status: 'idea',
        reviewStage: null,
        platforms: ['instagram', 'facebook'],
        publishTime: '18:30',
        needsClientApproval: true,
        responsible: { id: cast.writer.id, archived: false, inScope: true },
        client: { id: clientId, healthcare: false },
        media: [],
        cycleLine: null,
        clearedReview: null,
        publishedLinks: [],
        readOnly: false,
        allowedTransitions: ['in_production', 'internal_review', 'cancelled'],
        permissions: { canEdit: true, canEditContent: true, canReview: false, canArchive: false },
      });
      const [entry] = await cast.auditOf(post.id);
      expect(entry).toMatchObject({
        action: 'post.created',
        entityType: 'post',
        actorId: cast.writer.id,
        after: { captionLength: 16, hashtagsLength: 5, publishDate: post.publishDate },
      });
      expect(JSON.stringify(entry?.after)).not.toContain('سطر أول');
      // The creator is not notified of their own post.
      expect(await cast.typesOf(cast.writer.id, post.id)).toEqual([]);
    });

    it('is for edit scope: Content members and managers of all, the account manager of theirs', async () => {
      for (const user of [cast.contentManager, cast.am, cast.operations, cast.gm]) {
        expect((await client.post(posts, user.cookie, base())).status).toBe(201);
      }
      // Without `content.manage`, and an account manager of another client.
      expect((await client.post(posts, cast.designer.cookie, base())).status).toBe(403);
      expect((await client.post(posts, cast.designManager.cookie, base())).status).toBe(403);
      expect((await client.post(posts, cast.otherAm.cookie, base())).status).toBe(403);
    });

    it('validates the input', async () => {
      const cookie = cast.writer.cookie;
      for (const bad of [
        { platforms: [] },
        { platforms: ['website'] },
        { title: ' ' },
        { type: 'video' },
        { publishTime: '9:00' },
        { caption: 'x'.repeat(5001) },
      ]) {
        expect((await client.post(posts, cookie, { ...base(), ...bad })).status).toBe(400);
      }
      await expectError(
        await client.post(posts, cookie, { ...base(), publishDate: addDays(businessDate(), -1) }),
        400,
        'INVALID_DATES',
      );
      expect((await client.post(posts, cookie, { ...base(), clientId: randomUUID() })).status).toBe(
        400,
      );
    });

    it('needs a live client that is not ended; a paused one qualifies', async () => {
      const paused = await cast.createClient({ status: 'paused' });
      const ended = await cast.createClient({ status: 'ended' });
      const archived = await cast.createClient();
      await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
      const create = (id: string) =>
        client.post(posts, cast.writer.cookie, { ...base(), clientId: id });
      expect((await create(paused.id)).status).toBe(201);
      await expectError(await create(ended.id), 409, 'CLIENT_ENDED');
      await expectError(await create(archived.id), 409, 'CLIENT_ARCHIVED');
    });

    it('takes a responsible person whose edit scope covers the client, and tells them', async () => {
      const create = (responsibleId: string) =>
        client.post(posts, cast.writer.cookie, { ...base(), responsibleId });
      const response = await create(cast.am.id);
      expect(response.status).toBe(201);
      const post = postDetailSchema.parse(await response.json());
      expect(post.responsible.id).toBe(cast.am.id);
      expect(await cast.typesOf(cast.am.id, post.id)).toEqual(['post_assigned']);

      await expectError(await create(cast.designer.id), 400, 'INVALID_RESPONSIBLE');
      await expectError(await create(cast.otherAm.id), 400, 'INVALID_RESPONSIBLE');
      const archived = await cast.signedIn({ departments: [{ code: 'content_management' }] });
      await client.post(`/api/users/${archived.id}/archive`, cast.gm.cookie);
      await expectError(await create(archived.id), 400, 'INVALID_RESPONSIBLE');
    });

    it('counts on a line of an open cycle of the client only', async () => {
      const retainer = await cast.createRetainer(clientId);
      const other = await cast.createRetainer((await cast.createClient()).id);
      const lineOf = async (retainerId: string) => {
        const response = await client.get(`/api/retainers/${retainerId}/cycles`, cast.gm.cookie);
        const [cycle] = cyclePageSchema.parse(await response.json()).items;
        const line = cycle?.lines.find((item) => item.kind === 'reel');
        if (!cycle || !line) throw new Error('The retainer has no open cycle');
        return { cycle, line };
      };
      const { cycle, line } = await lineOf(retainer.id);
      const create = (cycleLineId: string) =>
        client.post(posts, cast.writer.cookie, { ...base(), type: 'reel', cycleLineId });

      await expectError(await create(randomUUID()), 400, 'INVALID_LINK');
      await expectError(await create((await lineOf(other.id)).line.id), 400, 'INVALID_LINK');

      const response = await create(line.id);
      expect(response.status, await response.clone().text()).toBe(201);
      const post = postDetailSchema.parse(await response.json());
      expect(post.cycleLine).toMatchObject({
        id: line.id,
        kind: 'reel',
        retainer: { id: retainer.id, name: retainer.name },
      });
      // The post counts on the line beside its tasks: open until it is published.
      const counted = (await lineOf(retainer.id)).line;
      expect(counted.tasks).toEqual({ total: 1, delivered: 0, open: 1, ready: 0 });
      expect(counted.delivered).toBe(line.delivered);

      // A cancelled post leaves the count; a closed cycle takes no new post.
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'cancelled', reason: 'أُلغي' });
      expect((await lineOf(retainer.id)).line.tasks.total).toBe(0);
      await db
        .update(retainerCycles)
        .set({ status: 'closed' })
        .where(eq(retainerCycles.id, cycle.id));
      try {
        await expectError(await create(line.id), 409, 'CYCLE_CLOSED');
      } finally {
        await db
          .update(retainerCycles)
          .set({ status: 'open' })
          .where(eq(retainerCycles.id, cycle.id));
      }
    });
  });

  describe('read', () => {
    it('shows every post to every user, read-only without a scope', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      for (const user of [cast.employee, cast.designer, cast.otherAm]) {
        const seen = await cast.detail(post.id, user.cookie);
        expect(seen.allowedTransitions).toEqual([]);
        expect(Object.values(seen.permissions).some(Boolean)).toBe(false);
      }
      const own = await cast.detail(post.id, cast.am.cookie);
      expect(own.permissions).toMatchObject({ canEdit: true, canReview: true, canArchive: false });
      expect((await cast.detail(post.id, cast.contentManager.cookie)).permissions).toMatchObject({
        canEdit: true,
        canReview: true,
        canArchive: true,
      });
      expect((await client.get(`${posts}/${randomUUID()}`, cast.gm.cookie)).status).toBe(404);
    });
  });

  describe('edit (rule 3)', () => {
    it('changes the content in idea and in production, by edit scope, audited by changed field', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const response = await patch(post.id, cast.am.cookie, {
        title: 'عنوان جديد',
        caption: 'نص جديد',
        type: 'carousel',
        platforms: ['tiktok'],
        publishDate: addDays(businessDate(), -3),
        publishTime: '09:15',
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const updated = postDetailSchema.parse(await response.json());
      expect(updated).toMatchObject({
        title: 'عنوان جديد',
        caption: 'نص جديد',
        type: 'carousel',
        platforms: ['tiktok'],
        publishTime: '09:15',
      });
      expect(updated.contentToken).not.toBe(post.contentToken);
      const entry = (await cast.auditOf(post.id)).at(-1);
      expect(entry).toMatchObject({
        action: 'post.updated',
        actorId: cast.am.id,
        before: { title: post.title, type: 'post', captionLength: post.caption?.length },
        after: { title: 'عنوان جديد', type: 'carousel', captionLength: 7 },
      });
      expect(entry?.after).not.toHaveProperty('caption');
      expect(entry?.after).not.toHaveProperty('notes');

      // Nothing changed: no new entry.
      const count = (await cast.auditOf(post.id)).length;
      expect((await patch(post.id, cast.writer.cookie, { title: 'عنوان جديد' })).status).toBe(200);
      expect(await cast.auditOf(post.id)).toHaveLength(count);

      expect((await patch(post.id, cast.designer.cookie, { title: 'x' })).status).toBe(403);
      expect((await patch(post.id, cast.otherAm.cookie, { title: 'x' })).status).toBe(403);
      expect((await patch(randomUUID(), cast.gm.cookie, { title: 'x' })).status).toBe(404);
      expect((await patch(post.id, cast.writer.cookie, { platforms: [] })).status).toBe(400);
    });

    it('locks the content after production and keeps the schedule free', async () => {
      const post = await cast.postAt('approved', { clientId });
      for (const content of [{ caption: 'x' }, { hashtags: '#x' }, { type: 'reel' }]) {
        await expectError(await patch(post.id, cast.writer.cookie, content), 409, 'POST_LOCKED');
      }
      const response = await patch(post.id, cast.writer.cookie, {
        publishDate: cast.inDays(9),
        publishTime: null,
        platforms: ['instagram', 'x'],
        notes: 'تأجيل',
        title: 'عنوان بعد الاعتماد',
        responsibleId: cast.contentManager.id,
        needsClientApproval: false,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const moved = postDetailSchema.parse(await response.json());
      // No re-approval: still approved, with the snapshot the client answered.
      expect(moved).toMatchObject({
        status: 'approved',
        publishDate: cast.inDays(9),
        publishTime: null,
        platforms: ['instagram', 'x'],
        responsible: { id: cast.contentManager.id },
      });
      expect(moved.clearedReview?.publishDate).toBe(post.publishDate);
      expect(await cast.typesOf(cast.contentManager.id, post.id)).toContain('post_assigned');
      await expectError(
        await patch(post.id, cast.writer.cookie, { publishedAt: new Date().toISOString() }),
        409,
        'POST_LOCKED',
      );
    });

    it('keeps the client approval while the post is with the reviewer or the client', async () => {
      const waiting = await cast.postAt('awaiting_client', { clientId });
      await expectError(
        await patch(waiting.id, cast.writer.cookie, { needsClientApproval: false }),
        409,
        'INVALID_TRANSITION',
      );
      const inReview = await cast.postAt('internal_review', { clientId });
      expect(
        (await patch(inReview.id, cast.writer.cookie, { needsClientApproval: false })).status,
      ).toBe(200);
    });

    it('changes only the publish time and the links of a published post', async () => {
      const post = await cast.postAt('published', {
        clientId,
        platforms: ['instagram', 'facebook'],
      });
      await expectError(
        await patch(post.id, cast.writer.cookie, { title: 'x' }),
        409,
        'POST_LOCKED',
      );
      await expectError(
        await patch(post.id, cast.writer.cookie, { publishDate: cast.inDays(2) }),
        409,
        'POST_LOCKED',
      );
      const earlier = new Date(Date.now() - 3_600_000).toISOString();
      const links = [{ platform: 'instagram', url: 'https://instagram.com/p/abc' }];
      const response = await patch(post.id, cast.writer.cookie, {
        publishedAt: earlier,
        publishedLinks: links,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(postDetailSchema.parse(await response.json())).toMatchObject({
        publishedAt: earlier,
        publishedLinks: links,
        permissions: { canEdit: true, canEditContent: false },
      });
      await expectError(
        await patch(post.id, cast.writer.cookie, {
          publishedAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        400,
        'INVALID_DATES',
      );
      // A platform the post is not on, and two links for one platform.
      const link = (platform: string) => ({ platform, url: 'https://example.com/p' });
      expect(
        (await patch(post.id, cast.writer.cookie, { publishedLinks: [link('tiktok')] })).status,
      ).toBe(400);
      expect(
        (
          await patch(post.id, cast.writer.cookie, {
            publishedLinks: [link('facebook'), link('facebook')],
          })
        ).status,
      ).toBe(400);
    });

    it('refuses any change on a cancelled post', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'cancelled', reason: 'أُلغي' });
      await expectError(
        await patch(post.id, cast.writer.cookie, { title: 'x' }),
        409,
        'POST_LOCKED',
      );
    });
  });

  describe('duplicate (rule 4)', () => {
    it('copies the content into a new idea of the caller, without files or history', async () => {
      const source = await cast.postAt('approved', {
        clientId,
        hashtags: '#وسم',
        notes: 'ملاحظة',
        needsClientApproval: false,
      });
      const response = await client.post(`${posts}/${source.id}/duplicate`, cast.am.cookie, {
        publishDate: cast.inDays(12),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const copy = postDetailSchema.parse(await response.json());
      expect(copy.id).not.toBe(source.id);
      expect(copy).toMatchObject({
        status: 'idea',
        title: source.title,
        caption: source.caption,
        hashtags: '#وسم',
        notes: 'ملاحظة',
        publishDate: cast.inDays(12),
        publishTime: source.publishTime,
        needsClientApproval: false,
        responsible: { id: cast.am.id },
        reviewHistory: [],
        clearedReview: null,
      });
      expect((await cast.auditOf(copy.id))[0]).toMatchObject({
        action: 'post.duplicated',
        after: { fromPostId: source.id },
      });
      const same = await client.post(`${posts}/${source.id}/duplicate`, cast.writer.cookie, {});
      expect(postDetailSchema.parse(await same.json()).publishDate).toBe(source.publishDate);

      const duplicate = (cookie: string) =>
        client.post(`${posts}/${source.id}/duplicate`, cookie, {});
      expect((await duplicate(cast.designer.cookie)).status).toBe(403);
      expect((await duplicate(cast.otherAm.cookie)).status).toBe(403);
      expect(
        (await client.post(`${posts}/${randomUUID()}/duplicate`, cast.gm.cookie, {})).status,
      ).toBe(404);
    });

    it('refuses a copy dated in the past, given or kept from the source', async () => {
      const source = await cast.createPost(cast.writer.cookie, { clientId });
      const yesterday = addDays(businessDate(), -1);
      const duplicate = (body: object) =>
        client.post(`${posts}/${source.id}/duplicate`, cast.am.cookie, body);
      await expectError(await duplicate({ publishDate: yesterday }), 400, 'INVALID_DATES');

      expect((await patch(source.id, cast.am.cookie, { publishDate: yesterday })).status).toBe(200);
      await expectError(await duplicate({}), 400, 'INVALID_DATES');
      expect((await duplicate({ publishDate: cast.inDays(2) })).status).toBe(201);
    });
  });

  describe('archive and restore', () => {
    it('is for review scope over all posts; an archived post is hidden and read-only', async () => {
      const post = await cast.postAt('in_production', { clientId });
      const archive = (cookie: string) => client.post(`${posts}/${post.id}/archive`, cookie);
      const restore = (cookie: string) => client.post(`${posts}/${post.id}/restore`, cookie);
      // A Content member has no review scope; the account manager's covers their clients only.
      expect((await archive(cast.writer.cookie)).status).toBe(403);
      expect((await archive(cast.am.cookie)).status).toBe(403);
      expect((await archive(cast.contentManager.cookie)).status).toBe(204);
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.archived',
        actorId: cast.contentManager.id,
      });

      expect((await client.get(`${posts}/${post.id}`, cast.writer.cookie)).status).toBe(404);
      expect((await client.get(`${posts}/${post.id}`, cast.am.cookie)).status).toBe(404);
      const archived = await cast.detail(post.id, cast.operations.cookie);
      expect(archived).toMatchObject({ readOnly: true, allowedTransitions: [] });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.permissions).toMatchObject({ canEdit: false, canArchive: true });
      await expectError(await patch(post.id, cast.gm.cookie, { title: 'x' }), 409, 'POST_ARCHIVED');
      await expectError(
        await cast.move(post.id, cast.gm.cookie, { to: 'cancelled', reason: 'x' }),
        409,
        'POST_ARCHIVED',
      );
      await expectError(await cast.addFile(post.id, 'ملف', cast.gm.cookie), 409, 'POST_ARCHIVED');

      const range = `from=${post.publishDate}&to=${post.publishDate}&clientId=${clientId}`;
      const ids = async (items: Promise<{ id: string }[]>) => (await items).map((item) => item.id);
      expect(await ids(calendar(range, cast.gm.cookie).then((c) => c.posts))).not.toContain(
        post.id,
      );
      expect(
        await ids(list(`archived=true&clientId=${clientId}`, cast.gm.cookie).then((p) => p.items)),
      ).toContain(post.id);
      expect((await client.get(`${posts}?archived=true`, cast.writer.cookie)).status).toBe(403);
      expect((await client.get(`${posts}?archived=true`, cast.am.cookie)).status).toBe(403);

      expect((await restore(cast.writer.cookie)).status).toBe(403);
      const restored = await restore(cast.gm.cookie);
      expect(restored.status).toBe(200);
      expect(postDetailSchema.parse(await restored.json())).toMatchObject({
        status: 'in_production',
        archivedAt: null,
        readOnly: false,
      });
      expect(await ids(calendar(range, cast.gm.cookie).then((c) => c.posts))).toContain(post.id);
      expect((await client.post(`${posts}/${randomUUID()}/archive`, cast.gm.cookie)).status).toBe(
        404,
      );
    });

    it('does not restore an open post to an archived responsible person', async () => {
      const leaver = await cast.signedIn({
        name: `مغادر ${cast.run}`,
        departments: [{ code: 'content_management' }],
      });
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        responsibleId: leaver.id,
      });
      const archive = `${posts}/${post.id}/archive`;
      expect((await client.post(archive, cast.gm.cookie)).status).toBe(204);
      // An archived post is no responsibility, so the user can be archived.
      expect((await client.post(`/api/users/${leaver.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      await expectError(
        await client.post(`${posts}/${post.id}/restore`, cast.gm.cookie),
        400,
        'INVALID_RESPONSIBLE',
      );
      expect((await cast.detail(post.id, cast.gm.cookie)).archivedAt).not.toBeNull();
    });

    it('hides the posts of an archived client with it', async () => {
      const gone = await cast.createClient();
      const post = await cast.createPost(cast.writer.cookie, { clientId: gone.id });
      await client.post(`/api/clients/${gone.id}/archive`, cast.gm.cookie);
      expect((await client.get(`${posts}/${post.id}`, cast.writer.cookie)).status).toBe(404);
      expect((await cast.detail(post.id, cast.gm.cookie)).readOnly).toBe(true);
      await expectError(await patch(post.id, cast.gm.cookie, { title: 'x' }), 409, 'POST_ARCHIVED');
      const range = `from=${post.publishDate}&to=${post.publishDate}&clientId=${gone.id}`;
      expect((await calendar(range, cast.gm.cookie)).posts).toEqual([]);
    });
  });

  describe('calendar and lists', () => {
    it('lists the posts of a range by date and time with counts by status', async () => {
      const own = (await cast.createClient()).id;
      const day = cast.inDays(20);
      const late = await cast.createPost(cast.writer.cookie, {
        clientId: own,
        publishDate: day,
        publishTime: '20:00',
        platforms: ['tiktok'],
        type: 'reel',
      });
      const early = await cast.createPost(cast.am.cookie, {
        clientId: own,
        publishDate: day,
        publishTime: '08:00',
      });
      const untimed = await cast.createPost(cast.writer.cookie, {
        clientId: own,
        publishDate: day,
      });
      const before = await cast.createPost(cast.writer.cookie, {
        clientId: own,
        publishDate: addDays(day, -1),
      });
      const outside = await cast.createPost(cast.writer.cookie, {
        clientId: own,
        publishDate: addDays(day, 2),
      });
      await cast.moveOk(before.id, cast.writer.cookie, { to: 'cancelled', reason: 'أُلغي' });
      await cast.moveOk(late.id, cast.writer.cookie, { to: 'in_production' });

      const range = `from=${addDays(day, -1)}&to=${day}&clientId=${own}`;
      // Every user reads the calendar.
      const result = await calendar(range, cast.designer.cookie);
      expect(result.posts.map((post) => post.id)).toEqual([
        before.id,
        early.id,
        late.id,
        untimed.id,
      ]);
      expect(result.posts.map((post) => post.id)).not.toContain(outside.id);
      expect(result.counts).toMatchObject({ idea: 2, in_production: 1, cancelled: 1, approved: 0 });
      expect(result.posts[1]).toMatchObject({
        client: { id: own },
        status: 'idea',
        responsible: { id: cast.am.id },
        thumbnailVersionId: null,
        linkedTaskCount: 0,
        overdue: false,
      });

      const filtered = async (filter: string) =>
        (await calendar(`${range}&${filter}`, cast.gm.cookie)).posts.map((post) => post.id);
      expect(await filtered('status=idea')).toEqual([early.id, untimed.id]);
      expect(await filtered('status=idea&status=cancelled')).toHaveLength(3);
      expect(await filtered('platform=tiktok')).toEqual([late.id]);
      expect(await filtered('type=reel')).toEqual([late.id]);
      expect(await filtered(`responsible=${cast.am.id}`)).toEqual([early.id]);
      // The counts ignore the status filter, so every chip keeps its number.
      expect((await calendar(`${range}&status=idea`, cast.gm.cookie)).counts.cancelled).toBe(1);

      const paged = await list(`clientId=${own}&pageSize=2&page=2`, cast.employee.cookie);
      expect(paged).toMatchObject({ total: 5, page: 2, pageSize: 2 });
      expect(paged.items.map((post) => post.id)).toEqual([late.id, untimed.id]);
      expect((await list(`clientId=${own}&q=${cast.run}&type=reel`, cast.gm.cookie)).total).toBe(1);
      expect((await list(`clientId=${own}&from=${addDays(day, 1)}`, cast.gm.cookie)).total).toBe(1);

      const wide = `from=${day}&to=${addDays(day, 45)}`;
      expect((await client.get(`/api/content/calendar?${wide}`, cast.gm.cookie)).status).toBe(400);
      expect((await client.get('/api/content/calendar', cast.gm.cookie)).status).toBe(400);
    });

    it('fills the sections of My posts', async () => {
      const mine = await cast.signedIn({
        name: `كاتب ثانٍ ${cast.run}`,
        departments: [{ code: 'content_management' }],
      });
      const own = (await cast.createClient()).id;
      const at = (status: Parameters<typeof cast.postAt>[0]) =>
        cast.postAt(status, { clientId: own, responsibleId: mine.id });
      const today = await at('approved');
      const overdue = await at('scheduled');
      const returned = await at('internal_review');
      const waiting = await at('internal_review');
      const published = await at('published');
      const now = businessDate();
      const dated = (id: string, publishDate: string) =>
        db.update(contentPosts).set({ publishDate }).where(eq(contentPosts.id, id));
      await dated(today.id, now);
      await dated(overdue.id, addDays(now, -2));
      await dated(published.id, addDays(now, -2));
      await cast.moveOk(returned.id, cast.contentManager.cookie, {
        to: 'in_production',
        note: 'عدّل النص',
      });

      expect(await summary(mine.cookie)).toEqual({
        publishToday: 1,
        overdue: 1,
        returned: 1,
        toReview: null,
      });
      const view = async (name: string, cookie: string) =>
        (await list(`view=${name}&clientId=${own}`, cookie)).items.map((post) => post.id);
      expect(await view('publish_today', mine.cookie)).toEqual([today.id]);
      expect(await view('overdue', mine.cookie)).toEqual([overdue.id]);
      expect(await view('returned', mine.cookie)).toEqual([returned.id]);
      expect(await view('to_review', mine.cookie)).toEqual([]);
      expect((await list(`view=overdue&clientId=${own}`, mine.cookie)).items[0]?.overdue).toBe(
        true,
      );

      // To review: the Content manager over all clients, an account manager over their own.
      expect(await view('to_review', cast.contentManager.cookie)).toEqual([waiting.id]);
      expect(await view('to_review', cast.am.cookie)).toEqual([waiting.id]);
      expect(await view('to_review', cast.otherAm.cookie)).toEqual([]);
      expect((await summary(cast.otherAm.cookie)).toReview).toBe(0);
      expect((await summary(cast.am.cookie)).toReview).toBeGreaterThanOrEqual(1);

      // Resubmitted, the post is no longer "returned to me".
      await cast.moveOk(returned.id, cast.writer.cookie, { to: 'internal_review' });
      expect(await view('returned', mine.cookie)).toEqual([]);
    });
  });

  describe('files of the post (F10 owner `post`, rule 3, edge case 14)', () => {
    const files = (postId: string, cookie: string) =>
      client.get(`/api/files/items?ownerType=post&ownerId=${postId}`, cookie);

    it('adds media by edit scope while the content is unlocked', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId, caption: null });
      const first = await cast.addFileOk(post.id, 'التصميم الأول');
      const second = await cast.addFileOk(post.id, 'التصميم الثاني');
      expect(first).toMatchObject({ ownerType: 'post', ownerId: post.id, clientId });
      const withMedia = await cast.detail(post.id, cast.employee.cookie);
      expect(withMedia.media.map((version) => version.fileItemId)).toEqual([first.id, second.id]);
      expect(withMedia.media[0]).toMatchObject({ name: 'التصميم الأول', number: 1, kind: 'link' });
      expect(withMedia.contentToken).not.toBe(post.contentToken);

      // A new version replaces the earlier one in the media; a removed file leaves it.
      const versioned = await client.post(`/api/files/items/${first.id}/versions`, cast.am.cookie, {
        source: { url: 'https://drive.example.com/v2' },
      });
      expect(versioned.status, await versioned.clone().text()).toBe(200);
      expect(
        (await client.post(`/api/files/items/${second.id}/archive`, cast.am.cookie)).status,
      ).toBe(204);
      const after = await cast.detail(post.id, cast.gm.cookie);
      expect(after.media.map((version) => [version.fileItemId, version.number])).toEqual([
        [first.id, 2],
      ]);

      // Every user sees the files; only edit scope changes them.
      const listed = await files(post.id, cast.designer.cookie);
      expect(listed.status).toBe(200);
      expect(fileItemListSchema.parse(await listed.json()).rights.canAddDeliverable).toBe(false);
      expect((await cast.addFile(post.id, 'ملف', cast.designer.cookie)).status).toBe(403);
      expect((await cast.addFile(post.id, 'ملف', cast.otherAm.cookie)).status).toBe(403);
      // Posts hold deliverables only, and no final marker.
      const reference = await client.post('/api/files/items', cast.writer.cookie, {
        ownerType: 'post',
        ownerId: post.id,
        role: 'reference',
        source: { url: 'https://drive.example.com/ref' },
      });
      expect(reference.status).toBe(400);
      const version = after.media[0];
      await expectError(
        await client.post(`/api/files/versions/${version?.id}/final`, cast.gm.cookie, {
          final: true,
        }),
        400,
        'NOT_DELIVERABLE',
      );
      // Post files are not part of the client's library.
      const library = await client.get(`/api/files/library?clientId=${clientId}`, cast.gm.cookie);
      expect(JSON.stringify(await library.json())).not.toContain(first.id);
    });

    it('locks the files once the post leaves production', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const item = await cast.addFileOk(post.id, 'تصميم');
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await expectError(await cast.addFile(post.id, 'آخر'), 409, 'POST_LOCKED');
      await expectError(
        await client.post(`/api/files/items/${item.id}/versions`, cast.writer.cookie, {
          source: { url: 'https://drive.example.com/v2' },
        }),
        409,
        'POST_LOCKED',
      );
      await expectError(
        await client.post(`/api/files/items/${item.id}/archive`, cast.writer.cookie),
        409,
        'POST_LOCKED',
      );
      const listed = fileItemListSchema.parse(
        await (await files(post.id, cast.writer.cookie)).json(),
      );
      expect(listed.rights.canAddDeliverable).toBe(false);
      expect(listed.items[0]?.permissions).toMatchObject({
        canAddVersion: false,
        canRemove: false,
      });
    });

    it('holds at most 10 files', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      for (let index = 1; index <= 10; index++) await cast.addFileOk(post.id, `ملف ${index}`);
      await expectError(await cast.addFile(post.id, 'ملف 11'), 409, 'LIMIT_REACHED');
    });
  });

  describe('the responsible person (rule 28)', () => {
    it('cannot be archived while responsible for open posts', async () => {
      const person = await cast.signedIn({
        name: `مسؤول ${cast.run}`,
        departments: [{ code: 'content_management' }],
      });
      const open = await cast.createPost(cast.writer.cookie, {
        clientId,
        responsibleId: person.id,
      });
      const done = await cast.postAt('published', { clientId, responsibleId: person.id });
      const archive = () => client.post(`/api/users/${person.id}/archive`, cast.gm.cookie);
      const body = (await expectError(
        await archive(),
        409,
        'USER_HAS_RESPONSIBILITIES',
      )) as ErrorResponse;
      expect(body.details).toEqual([
        { type: 'responsible_for_open_posts', id: open.id, name: open.title },
      ]);
      expect(JSON.stringify(body.details)).not.toContain(done.id);

      await patch(open.id, cast.writer.cookie, { responsibleId: cast.writer.id });
      expect((await archive()).status).toBe(200);
    });

    it('is kept, with a warning, after losing edit scope', async () => {
      const mover = await cast.signedIn({
        name: `منتقل ${cast.run}`,
        departments: [{ code: 'content_management' }],
      });
      const post = await cast.createPost(mover.cookie, { clientId });
      expect(post.responsible).toMatchObject({ id: mover.id, inScope: true });
      const moved = await client.request('PATCH', `/api/users/${mover.id}`, {
        cookie: cast.gm.cookie,
        body: { primaryDepartmentId: await departmentId(db, 'design') },
      });
      expect(moved.status, await moved.clone().text()).toBe(200);
      expect((await cast.detail(post.id, cast.gm.cookie)).responsible).toMatchObject({
        id: mover.id,
        inScope: false,
      });
    });
  });
});
