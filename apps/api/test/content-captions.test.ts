import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import {
  type FileItem,
  fileItemSchema,
  fileUploadSchema,
  issuedApprovalRequestSchema,
  type PostDetail,
  postDetailSchema,
  publicApprovalSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  contentPosts,
  createDatabase,
  postCaptions,
  postReviews,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08B PR 1 (spec F08B part A, ADR 0042): captions per caption group, the media layout with slide
 * captions, the platform checks and `CAPTION_TOO_LONG`, snapshots and the client page over
 * captions and slides, video media info, Duplicate, the migration of existing captions and the
 * publishing pack.
 */

/** The files of a zip, by name, read through its central directory (CRCs checked). */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    const start =
      offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const data = archive.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    at += 46 + nameLength + extraLength;
  }
  return files;
}

describe('captions, slides, checks and the pack (F08B part A)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;

  const posts = '/api/content/posts';
  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `${posts}/${id}`, { cookie, body });
  const setLayout = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', `${posts}/${id}/layout`, { cookie, body });
  const pack = (id: string, cookie?: string) => client.get(`${posts}/${id}/pack`, cookie);

  async function ok(response: Response): Promise<PostDetail> {
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return postDetailSchema.parse(await response.json());
  }

  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();

  /** The start of an MP4 file: enough for its type to be recognized. */
  const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');

  /** An upload by the writer, with the media info a browser sends for a video. */
  async function upload(bytes: Buffer, fileName: string, query = '') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)]), fileName);
    const response = await fetch(`${url}/api/files/uploads${query}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie: cast.writer.cookie },
      body: form,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileUploadSchema.parse(await response.json()).uploadId;
  }

  /** A file of the post from an upload. */
  async function addMedia(postId: string, bytes: Buffer, fileName: string, query = '') {
    const response = await client.post('/api/files/items', cast.writer.cookie, {
      ownerType: 'post',
      ownerId: postId,
      role: 'deliverable',
      name: `${fileName} ${randomUUID().slice(0, 6)}`,
      source: { uploadId: await upload(bytes, fileName, query) },
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileItemSchema.parse(await response.json());
  }

  const layoutOf = (post: PostDetail) =>
    post.media.map((medium) => ({ fileItemId: medium.fileItemId, caption: medium.slideCaption }));

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-content-captions-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    await rm(filesRoot, { recursive: true, force: true });
  });

  describe('captions per group (rules A1 and A2)', () => {
    it('stores a caption per group of the platforms, the first one as the post caption', async () => {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        platforms: ['x', 'instagram', 'facebook', 'youtube'],
        captions: [
          { group: 'facebook_instagram', caption: 'نص إنستغرام', hashtags: '#وسم' },
          { group: 'x', caption: 'نص إكس' },
          { group: 'youtube', caption: 'وصف', title: 'عنوان الفيديو' },
        ],
      });
      expect(post.captions).toEqual([
        { group: 'x', caption: 'نص إكس', hashtags: null, title: null },
        { group: 'facebook_instagram', caption: 'نص إنستغرام', hashtags: '#وسم', title: null },
        { group: 'youtube', caption: 'وصف', hashtags: null, title: 'عنوان الفيديو' },
      ]);
      expect(post).toMatchObject({ caption: 'نص إكس', hashtags: null });
      expect(post.checks).toEqual([]);
    });

    it('refuses a group outside the platforms and a title outside YouTube', async () => {
      const body = (captions: unknown) => ({
        title: `منشور ${cast.run}`,
        clientId,
        type: 'post',
        platforms: ['instagram'],
        publishDate: cast.inDays(3),
        captions,
      });
      await expectError(
        await client.post(posts, cast.writer.cookie, body([{ group: 'tiktok', caption: 'x' }])),
        400,
        'INVALID_CAPTION_GROUP',
      );
      expect(
        (
          await client.post(
            posts,
            cast.writer.cookie,
            body([{ group: 'facebook_instagram', title: 'عنوان' }]),
          )
        ).status,
      ).toBe(400);
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      await expectError(
        await patch(post.id, cast.writer.cookie, { captions: [{ group: 'x', caption: 'x' }] }),
        400,
        'INVALID_CAPTION_GROUP',
      );
      // Unless the same change adds the platform.
      const both = await ok(
        await patch(post.id, cast.writer.cookie, {
          platforms: ['instagram', 'x'],
          captions: [{ group: 'x', caption: 'نص إكس' }],
        }),
      );
      expect(both.captions.map((caption) => caption.caption)).toEqual([post.caption, 'نص إكس']);
      expect((await patch(post.id, undefined, { captions: [] })).status).toBe(401);
      expect(
        (
          await patch(post.id, cast.designer.cookie, {
            captions: [{ group: 'x', caption: 'x' }],
          })
        ).status,
      ).toBe(403);
    });

    it('writes the groups given, and keeps a group whose platform leaves', async () => {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        platforms: ['instagram', 'linkedin'],
        captions: [
          { group: 'facebook_instagram', caption: 'أول' },
          { group: 'linkedin', caption: 'لينكدإن' },
        ],
      });
      const edited = await ok(
        await patch(post.id, cast.writer.cookie, {
          captions: [{ group: 'linkedin', caption: 'لينكدإن ٢', hashtags: '#عمل' }],
        }),
      );
      expect(edited.captions).toEqual([
        { group: 'facebook_instagram', caption: 'أول', hashtags: null, title: null },
        { group: 'linkedin', caption: 'لينكدإن ٢', hashtags: '#عمل', title: null },
      ]);
      const entry = (await cast.auditOf(post.id)).at(-1);
      expect(entry).toMatchObject({
        action: 'post.updated',
        before: { captions: [{ group: 'linkedin', caption: 7, hashtags: 0, title: 0 }] },
        after: { captions: [{ group: 'linkedin', caption: 9, hashtags: 4, title: 0 }] },
      });

      const without = await ok(
        await patch(post.id, cast.writer.cookie, { platforms: ['linkedin'] }),
      );
      expect(without.captions.map((caption) => caption.group)).toEqual(['linkedin']);
      // The extract follows the first group of the platforms.
      expect(without.caption).toBe('لينكدإن ٢');
      const back = await ok(
        await patch(post.id, cast.writer.cookie, { platforms: ['instagram', 'linkedin'] }),
      );
      expect(back.captions[0]).toMatchObject({ group: 'facebook_instagram', caption: 'أول' });
      expect(back.caption).toBe('أول');
    });

    it('copies the captions per group on Duplicate (rule A9)', async () => {
      const source = await cast.createPost(cast.writer.cookie, {
        clientId,
        platforms: ['instagram', 'tiktok'],
        captions: [
          { group: 'facebook_instagram', caption: 'أ' },
          { group: 'tiktok', caption: 'ب', hashtags: '#ت' },
        ],
      });
      const copy = await ok(
        await client.post(`${posts}/${source.id}/duplicate`, cast.am.cookie, {}),
      );
      expect(copy.captions).toEqual(source.captions);
    });
  });

  describe('limits and warnings (rules A3–A5)', () => {
    it('blocks the submission while a caption is over its limit, and an internal pass re-checks', async () => {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        platforms: ['instagram', 'x'],
        captions: [
          { group: 'facebook_instagram', caption: 'نص' },
          { group: 'x', caption: 'x'.repeat(300) },
        ],
      });
      expect(post.checks).toEqual([
        {
          code: 'caption_too_long',
          group: 'x',
          platform: 'x',
          limit: 280,
          actual: 300,
          blocking: true,
        },
      ]);
      const refused = await cast.move(post.id, cast.writer.cookie, { to: 'internal_review' });
      const body = await expectError(refused, 409, 'CAPTION_TOO_LONG');
      expect(body.details).toEqual({ checks: post.checks });

      await ok(
        await patch(post.id, cast.writer.cookie, { captions: [{ group: 'x', caption: 'قصير' }] }),
      );
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      // A caption over the limit by the time of the pass (as when X long posts are turned off).
      await db
        .update(postCaptions)
        .set({ caption: 'x'.repeat(281) })
        .where(and(eq(postCaptions.postId, post.id), eq(postCaptions.group, 'x')));
      const current = await cast.detail(post.id, cast.gm.cookie);
      await expectError(
        await cast.move(post.id, cast.contentManager.cookie, {
          to: 'awaiting_client',
          contentToken: current.contentToken,
        }),
        409,
        'CAPTION_TOO_LONG',
      );
    });

    it('warns on media against the platform rules, never blocking', async () => {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        type: 'reel',
        platforms: ['instagram', 'facebook'],
      });
      const video = await addMedia(
        post.id,
        MP4,
        'clip.mp4',
        '?width=1080&height=1920&durationMs=120000',
      );
      const tall = await addMedia(post.id, await png(400, 300), 'wide.png');
      const detail = await cast.detail(post.id, cast.writer.cookie);
      expect(
        detail.media.map(({ fileItemId, width, height, durationMs }) => ({
          fileItemId,
          width,
          height,
          durationMs,
        })),
      ).toEqual([
        { fileItemId: video.id, width: 1080, height: 1920, durationMs: 120000 },
        { fileItemId: tall.id, width: 400, height: 300, durationMs: null },
      ]);
      expect(detail.checks).toEqual([
        { code: 'aspect_ratio', platform: 'instagram', mediaIndex: 1, blocking: false },
        {
          code: 'video_too_long',
          platform: 'facebook',
          mediaIndex: 0,
          limit: 90,
          actual: 120,
          blocking: false,
        },
        { code: 'aspect_ratio', platform: 'facebook', mediaIndex: 1, blocking: false },
      ]);
      // A version keeps what the browser read.
      expect(video.versions[0]).toMatchObject({ width: 1080, height: 1920, durationMs: 120000 });
      // Warnings do not block the submission.
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
    });

    it('takes no media info for files other than videos', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const image = await addMedia(
        post.id,
        await png(20, 10),
        'image.png',
        '?width=5&height=5&durationMs=9',
      );
      expect(image.versions[0]).toMatchObject({ width: 20, height: 10, durationMs: null });
    });
  });

  describe('slides (rule A6)', () => {
    it('orders every medium with slide captions, audited, and changes the content token', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId, type: 'carousel' });
      const first = await addMedia(post.id, await png(100, 100), 'one.png');
      const second = await addMedia(post.id, await png(100, 100), 'two.png');
      const before = await cast.detail(post.id, cast.writer.cookie);
      expect(layoutOf(before)).toEqual([
        { fileItemId: first.id, caption: null },
        { fileItemId: second.id, caption: null },
      ]);
      const items = [
        { fileItemId: second.id, caption: 'الشريحة الأولى' },
        { fileItemId: first.id, caption: ' ' },
      ];
      expect((await setLayout(post.id, undefined, { items })).status).toBe(401);
      expect((await setLayout(post.id, cast.designer.cookie, { items })).status).toBe(403);
      expect((await setLayout(post.id, cast.otherAm.cookie, { items })).status).toBe(403);
      expect((await setLayout(randomUUID(), cast.gm.cookie, { items })).status).toBe(404);
      await expectError(
        await setLayout(post.id, cast.writer.cookie, { items: items.slice(0, 1) }),
        400,
        'INVALID_ORDER',
      );
      await expectError(
        await setLayout(post.id, cast.writer.cookie, {
          items: [...items.slice(0, 1), { fileItemId: randomUUID() }],
        }),
        400,
        'INVALID_ORDER',
      );

      const after = await ok(await setLayout(post.id, cast.writer.cookie, { items }));
      expect(layoutOf(after)).toEqual([
        { fileItemId: second.id, caption: 'الشريحة الأولى' },
        { fileItemId: first.id, caption: null },
      ]);
      expect(after.contentToken).not.toBe(before.contentToken);
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.layout_changed',
        before: {
          layout: [
            { fileItemId: first.id, captionLength: 0 },
            { fileItemId: second.id, captionLength: 0 },
          ],
        },
        after: {
          layout: [
            { fileItemId: second.id, captionLength: 14 },
            { fileItemId: first.id, captionLength: 0 },
          ],
        },
      });

      // A new medium joins at the end.
      const third = await addMedia(post.id, await png(100, 100), 'three.png');
      const joined = await cast.detail(post.id, cast.writer.cookie);
      expect(joined.media.map((medium) => medium.fileItemId)).toEqual([
        second.id,
        first.id,
        third.id,
      ]);

      // Content editing: locked once submitted.
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await expectError(
        await setLayout(post.id, cast.writer.cookie, { items: layoutOf(joined) }),
        409,
        'POST_LOCKED',
      );
    });

    it('drops the slides of an unlinked task (edge case 5)', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const own = await addMedia(post.id, await png(100, 100), 'own.png');
      const task = await cast.taskAt('in_progress', { clientId });
      const linked = await client.request('PUT', `${posts}/${post.id}/tasks/${task.id}`, {
        cookie: cast.writer.cookie,
      });
      expect(linked.status, await linked.clone().text()).toBe(200);
      const design = await client.post('/api/files/items', cast.designer.cookie, {
        ownerType: 'task',
        ownerId: task.id,
        role: 'deliverable',
        name: `تصميم ${cast.run}`,
        source: { url: `https://drive.example.com/${randomUUID()}` },
      });
      const designItem: FileItem = fileItemSchema.parse(await design.json());
      await cast.task.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.task.moveOk(task.id, cast.designManager.cookie, { status: 'approved' });
      await ok(
        await setLayout(post.id, cast.writer.cookie, {
          items: [{ fileItemId: designItem.id, caption: 'من المهمة' }, { fileItemId: own.id }],
        }),
      );
      const unlinked = await ok(
        await client.request('DELETE', `${posts}/${post.id}/tasks/${task.id}`, {
          cookie: cast.writer.cookie,
        }),
      );
      expect(layoutOf(unlinked)).toEqual([{ fileItemId: own.id, caption: null }]);
      const [row] = await db
        .select({ layout: contentPosts.mediaLayout })
        .from(contentPosts)
        .where(eq(contentPosts.id, post.id));
      expect(row?.layout).toEqual([{ fileItemId: own.id, caption: null }]);
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.layout_changed',
        after: { layout: [{ fileItemId: own.id, captionLength: 0 }] },
      });
    });
  });

  describe('snapshots and the client page (rules A7 and A8, edge case 1)', () => {
    it('snapshots the captions and slides, and shows them on the client page', async () => {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        platforms: ['instagram', 'tiktok'],
        captions: [
          { group: 'facebook_instagram', caption: 'إنستغرام', hashtags: '#أ' },
          { group: 'tiktok', caption: 'تيك توك' },
        ],
      });
      const image = await addMedia(post.id, await png(100, 100), 'slide.png');
      await ok(
        await setLayout(post.id, cast.writer.cookie, {
          items: [{ fileItemId: image.id, caption: 'شرح الشريحة' }],
        }),
      );
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      const passed = await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'awaiting_client',
      });
      expect(passed.clearedReview).toMatchObject({
        caption: 'إنستغرام',
        hashtags: '#أ',
        captions: post.captions,
        slideCaptions: ['شرح الشريحة'],
      });

      const response = await client.post('/api/approvals/requests', cast.am.cookie, {
        clientId,
        contactId: await cast.contactOf(clientId),
        items: [{ postId: post.id }],
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const token = issuedApprovalRequestSchema.parse(await response.json()).link.split('/a/')[1];
      const pageResponse = await client.get(`/api/public/approvals/${token}`);
      const page = publicApprovalSchema.parse(await pageResponse.json());
      expect(page.clientImage).toBe(false);
      expect(page.items[0]?.post?.captions).toEqual(post.captions);
      expect(page.items[0]?.files).toMatchObject([
        { versionId: image.versions[0]?.id, name: '', slideCaption: 'شرح الشريحة' },
      ]);
      // The client has no image yet.
      expect((await client.get(`/api/public/approvals/${token}/client-image`)).status).toBe(404);
      expect((await client.get(`/api/public/approvals/${randomUUID()}/client-image`)).status).toBe(
        404,
      );

      // A snapshot from before F08B shows its single caption under every group.
      await db
        .update(postReviews)
        .set({ captions: null, slideCaptions: null })
        .where(eq(postReviews.postId, post.id));
      const old = await cast.detail(post.id, cast.gm.cookie);
      expect(old.clearedReview).toMatchObject({
        captions: [
          { group: 'facebook_instagram', caption: 'إنستغرام', hashtags: '#أ', title: null },
          { group: 'tiktok', caption: 'إنستغرام', hashtags: '#أ', title: null },
        ],
        slideCaptions: [null],
      });
      const oldPage = publicApprovalSchema.parse(
        await (await client.get(`/api/public/approvals/${token}`)).json(),
      );
      expect(oldPage.items[0]?.post?.captions[1]).toMatchObject({
        group: 'tiktok',
        caption: 'إنستغرام',
      });
      expect(oldPage.items[0]?.files[0]?.slideCaption).toBeNull();
    });
  });

  it('the migration gives existing posts their caption on each group (ADR 0042)', async () => {
    const post = await cast.createPost(cast.writer.cookie, {
      clientId,
      platforms: ['facebook', 'instagram', 'x'],
    });
    await db.delete(postCaptions).where(eq(postCaptions.postId, post.id));
    await db
      .update(contentPosts)
      .set({ caption: 'نص قديم', hashtags: '#قديم' })
      .where(eq(contentPosts.id, post.id));
    const migration = readFileSync(
      new URL('../../../packages/db/migrations/0092_f08b_captions_backfill.sql', import.meta.url),
      'utf8',
    );
    await db.execute(sql.raw(migration));
    const rows = await db
      .select({
        group: postCaptions.group,
        caption: postCaptions.caption,
        hashtags: postCaptions.hashtags,
      })
      .from(postCaptions)
      .where(eq(postCaptions.postId, post.id))
      .orderBy(asc(postCaptions.group));
    expect(rows).toEqual([
      { group: 'facebook_instagram', caption: 'نص قديم', hashtags: '#قديم' },
      { group: 'x', caption: 'نص قديم', hashtags: '#قديم' },
    ]);
  });

  describe('the publishing pack (rule A11)', () => {
    it('zips the approved media in slide order with the captions per group, audited', async () => {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        needsClientApproval: false,
        platforms: ['instagram', 'youtube'],
        captions: [
          { group: 'facebook_instagram', caption: 'نص', hashtags: '#وسم' },
          { group: 'youtube', caption: 'وصف', title: 'العنوان' },
        ],
      });
      expect(post.permissions.canDownloadPack).toBe(false);
      await expectError(await pack(post.id, cast.writer.cookie), 409, 'INVALID_TRANSITION');

      const first = await addMedia(post.id, await png(100, 100), 'first.png');
      const second = await addMedia(post.id, await png(120, 120), 'second.png');
      const link = await cast.addFileOk(post.id, `رابط ${cast.run}`);
      await ok(
        await setLayout(post.id, cast.writer.cookie, {
          items: [{ fileItemId: second.id }, { fileItemId: link.id }, { fileItemId: first.id }],
        }),
      );
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      const approved = await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'approved' });
      expect(approved.permissions.canDownloadPack).toBe(true);
      // The pack reads the approved snapshot, not what changed since.
      await db
        .update(postCaptions)
        .set({ caption: 'نص بعد الاعتماد' })
        .where(and(eq(postCaptions.postId, post.id), eq(postCaptions.group, 'facebook_instagram')));

      expect((await pack(post.id)).status).toBe(401);
      expect((await pack(post.id, cast.designer.cookie)).status).toBe(403);
      expect((await pack(post.id, cast.otherAm.cookie)).status).toBe(403);
      const response = await pack(post.id, cast.writer.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/zip');
      expect(response.headers.get('content-disposition')).toContain('attachment');
      const files = unzip(Buffer.from(await response.arrayBuffer()));
      const base = `${post.client.name}-${post.publishDate}`;
      expect([...files.keys()]).toEqual([
        `${base}-01.png`,
        `${base}-03.png`,
        'captions-facebook_instagram.txt',
        'captions-youtube.txt',
        'links.txt',
      ]);
      const sizes = await Promise.all([png(120, 120), png(100, 100)]);
      expect(files.get(`${base}-01.png`)).toEqual(sizes[0]);
      expect(files.get(`${base}-03.png`)).toEqual(sizes[1]);
      expect(files.get('captions-facebook_instagram.txt')?.toString()).toBe('نص\n\n#وسم');
      expect(files.get('captions-youtube.txt')?.toString()).toBe('العنوان\n\nوصف');
      expect(files.get('links.txt')?.toString()).toMatch(/^02 https:\/\/drive\.example\.com\//);
      const [entry] = await db
        .select()
        .from(auditEntries)
        .where(
          and(eq(auditEntries.entityId, post.id), eq(auditEntries.action, 'post.pack_downloaded')),
        );
      expect(entry).toMatchObject({
        actorId: cast.writer.id,
        after: { media: 3, groups: ['facebook_instagram', 'youtube'] },
      });
    });
  });
});
