import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  fileItemSchema,
  fileUploadSchema,
  imageSchema,
  meResponseSchema,
  userPageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clients,
  createDatabase,
  images,
  notifications,
  projects,
  retainers,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileContentService } from '../src/modules/files/file-content.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, clientIp, ORIGIN, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('images (F01C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let filesRoot: string;
  let square: Buffer;
  let wideLogo: Buffer;
  let tiny: Buffer;
  let gif: Buffer;

  async function upload(cookie: string, content: Buffer, name = 'photo.png'): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([content]), name);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileUploadSchema.parse(await response.json()).uploadId;
  }

  const put = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', `${path}/image`, { cookie, body });
  const remove = (path: string, cookie: string | undefined) =>
    client.request('DELETE', `${path}/image`, { cookie });

  /** Uploads `content` as `cookie` and sets it on `path`; expects success. */
  async function setOk(path: string, cookie: string, content = square, extra = {}) {
    const uploadId = await upload(cookie, content);
    const response = await put(path, cookie, { source: { uploadId, ...extra } });
    expect(response.status, await response.clone().text()).toBe(200);
    return imageSchema.parse(await response.json());
  }

  const serve = (id: string, size: string, cookie?: string) =>
    client.get(`/api/images/${id}/${size}`, cookie);

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action)))
      .orderBy(auditEntries.id);

  const noticesOf = (recipientId: string, type: string, subjectId: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, type as never),
          eq(notifications.subjectId, subjectId),
        ),
      );

  const currentImages = (column: typeof images.userId, id: string) =>
    db
      .select()
      .from(images)
      .where(and(eq(column, id), isNull(images.archivedAt)));

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-images-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    square = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#0a6' },
    })
      .png()
      .toBuffer();
    wideLogo = await sharp({
      create: { width: 600, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    gif = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session on every route', async () => {
    const id = randomUUID();
    for (const path of [
      `/api/users/${id}`,
      `/api/clients/${id}`,
      `/api/projects/${id}`,
      `/api/retainers/${id}`,
    ]) {
      expect((await put(path, undefined, { source: { uploadId: id } })).status, path).toBe(401);
      expect((await remove(path, undefined)).status, path).toBe(401);
    }
    expect((await serve(id, 'sm')).status).toBe(401);
  });

  describe('user photos', () => {
    it('lets a user set their own photo, shown at once from the upload (rules 1 and 11)', async () => {
      const me = await cast.signedIn();
      const image = await setOk(`/api/users/${me.id}`, me.cookie);
      expect(image.status).toBe('pending');

      const served = await serve(image.id, 'md', me.cookie);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/png');
      expect(served.headers.get('cache-control')).toBe('no-store');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      // Any signed-in user sees it.
      expect((await serve(image.id, 'sm', cast.employee.cookie)).status).toBe(200);

      const meResponse = meResponseSchema.parse(
        await (await client.get('/api/me', me.cookie)).json(),
      );
      expect(meResponse.user.imageId).toBe(image.id);
      const [audit] = await auditOf(me.id, 'user.image_set');
      expect(audit?.after).toEqual({ imageId: image.id, source: 'upload' });
      expect(audit?.before).toBeNull();
      // Nobody is told of their own change.
      expect(await noticesOf(me.id, 'profile_changed', me.id)).toHaveLength(0);
    });

    it("needs users.manage for another user's photo, and a General Manager for one", async () => {
      const target = await cast.signedIn();
      const uploadId = await upload(cast.employee.cookie, square);
      const path = `/api/users/${target.id}`;
      expect((await put(path, cast.employee.cookie, { source: { uploadId } })).status).toBe(403);
      expect((await remove(path, cast.employee.cookie)).status).toBe(403);
      expect(
        (await put(`/api/users/${randomUUID()}`, cast.gm.cookie, { source: { uploadId } })).status,
      ).toBe(404);

      // Edge case 9: the Operations manager never changes a General Manager's photo.
      const opsUpload = await upload(cast.operations.cookie, square);
      await expectError(
        await put(`/api/users/${cast.gm.id}`, cast.operations.cookie, {
          source: { uploadId: opsUpload },
        }),
        403,
        'GENERAL_MANAGER_ONLY',
      );
      await setOk(path, cast.operations.cookie);
    });

    it('tells the user of photo and profile changes by someone else, merged per day (rules 18–19)', async () => {
      const target = await cast.signedIn();
      await setOk(`/api/users/${target.id}`, cast.gm.cookie);
      const [first] = await noticesOf(target.id, 'profile_changed', target.id);
      expect(first?.data).toEqual({ changes: ['photo'] });
      expect(first?.actorId).toBe(cast.gm.id);
      expect(first?.box).toBe('info');

      const edited = await client.request('PATCH', `/api/users/${target.id}`, {
        cookie: cast.gm.cookie,
        body: { title: 'مصمم أول', email: `${randomUUID().slice(0, 8)}@test.vertex.local` },
      });
      expect(edited.status).toBe(200);
      const rows = await noticesOf(target.id, 'profile_changed', target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ changes: ['photo', 'title'] });
      expect(rows[0]?.count).toBe(2);

      // A change on a later day starts a new notice: the unread one is from yesterday.
      await db
        .update(notifications)
        .set({ createdAt: new Date(Date.now() - 36 * 3600 * 1000) })
        .where(eq(notifications.id, rows[0]?.id ?? ''));
      expect((await remove(`/api/users/${target.id}`, cast.gm.cookie)).status).toBe(204);
      const later = await noticesOf(target.id, 'profile_changed', target.id);
      expect(later).toHaveLength(2);
      expect(later.find((row) => row.id !== rows[0]?.id)?.data).toEqual({ changes: ['photo'] });
    });

    it('takes an upload once and only from its uploader (rule 1)', async () => {
      const me = await cast.signedIn();
      const others = await upload(cast.employee.cookie, square);
      await expectError(
        await put(`/api/users/${me.id}`, me.cookie, { source: { uploadId: others } }),
        400,
        'UPLOAD_NOT_FOUND',
      );
      const uploadId = await upload(me.cookie, square);
      expect((await put(`/api/users/${me.id}`, me.cookie, { source: { uploadId } })).status).toBe(
        200,
      );
      await expectError(
        await put(`/api/users/${me.id}`, me.cookie, { source: { uploadId } }),
        400,
        'UPLOAD_NOT_FOUND',
      );
    });

    it('accepts PNG, JPEG or WebP of at least 128 px and at most 10 MB (rule 2)', async () => {
      const me = await cast.signedIn();
      const path = `/api/users/${me.id}`;
      const attempt = async (content: Buffer, name: string) =>
        put(path, me.cookie, { source: { uploadId: await upload(me.cookie, content, name) } });
      await expectError(await attempt(gif, 'a.gif'), 400, 'IMAGE_TYPE_NOT_ALLOWED');
      await expectError(
        await attempt(Buffer.from('not an image'), 'a.txt'),
        400,
        'IMAGE_TYPE_NOT_ALLOWED',
      );
      await expectError(await attempt(tiny, 'tiny.png'), 400, 'IMAGE_TOO_SMALL');
      const large = await sharp(randomBytes(2048 * 2048 * 3), {
        raw: { width: 2048, height: 2048, channels: 3 },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(large.length).toBeGreaterThan(10_485_760);
      await expectError(await attempt(large, 'large.png'), 413, 'IMAGE_TOO_LARGE');
      const jpeg = await sharp(square).jpeg().toBuffer();
      expect((await attempt(jpeg, 'a.jpg')).status).toBe(200);
      const brand = await put(path, me.cookie, {
        source: { uploadId: await upload(me.cookie, square), brandVersionId: randomUUID() },
      });
      await expectError(brand, 400, 'BRAND_FILE_NOT_FOUND');
    });

    it('replaces and removes by archiving; removing nothing is a no-op (rules 1 and 4)', async () => {
      const me = await cast.signedIn();
      const path = `/api/users/${me.id}`;
      expect((await remove(path, me.cookie)).status).toBe(204);
      expect(await auditOf(me.id, 'user.image_removed')).toHaveLength(0);

      const first = await setOk(path, me.cookie);
      const second = await setOk(path, me.cookie);
      expect((await serve(first.id, 'sm', me.cookie)).status).toBe(404);
      const [replaced] = await auditOf(me.id, 'user.image_set').then((rows) => rows.slice(-1));
      expect(replaced?.before).toEqual({ imageId: first.id });
      const rows = await db.select().from(images).where(eq(images.userId, me.id));
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === first.id)?.archivedById).toBe(me.id);

      expect((await remove(path, me.cookie)).status).toBe(204);
      expect((await serve(second.id, 'sm', me.cookie)).status).toBe(404);
      const [user] = await db
        .select({ imageId: users.imageId })
        .from(users)
        .where(eq(users.id, me.id));
      expect(user?.imageId).toBeNull();
      const [removed] = await auditOf(me.id, 'user.image_removed');
      expect(removed?.before).toEqual({ imageId: second.id });
    });

    it('keeps one current image under concurrent changes (edge case 1)', async () => {
      const me = await cast.signedIn();
      const [a, b] = await Promise.all([upload(me.cookie, square), upload(me.cookie, square)]);
      const responses = await Promise.all(
        [a, b].map((uploadId) => put(`/api/users/${me.id}`, me.cookie, { source: { uploadId } })),
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const current = await currentImages(images.userId, me.id);
      expect(current).toHaveLength(1);
      const [user] = await db
        .select({ imageId: users.imageId })
        .from(users)
        .where(eq(users.id, me.id));
      expect(user?.imageId).toBe(current[0]?.id);
    });

    it('refuses changes to an archived user (rule 5)', async () => {
      const archived = await seedUser(db, { archived: true });
      cast.trackUser(archived.id);
      const uploadId = await upload(cast.gm.cookie, square);
      await expectError(
        await put(`/api/users/${archived.id}`, cast.gm.cookie, { source: { uploadId } }),
        409,
        'USER_ARCHIVED',
      );
    });

    it('filters the team by photo for users.manage holders (rule 17)', async () => {
      const without = await cast.signedIn({ name: `بلا صورة ${cast.run}` });
      const withPhoto = await cast.signedIn({ name: `بصورة ${cast.run}` });
      await setOk(`/api/users/${withPhoto.id}`, withPhoto.cookie);
      const search = encodeURIComponent(cast.run);
      expect(
        (await client.get(`/api/users?hasImage=false&search=${search}`, cast.employee.cookie))
          .status,
      ).toBe(403);
      const page = userPageSchema.parse(
        await (
          await client.get(
            `/api/users?hasImage=false&search=${search}&pageSize=100`,
            cast.gm.cookie,
          )
        ).json(),
      );
      const ids = page.items.map((user) => user.id);
      expect(ids).toContain(without.id);
      expect(ids).not.toContain(withPhoto.id);
      const all = userPageSchema.parse(
        await (
          await client.get(`/api/users?search=${search}&pageSize=100`, cast.employee.cookie)
        ).json(),
      );
      expect(all.items.find((user) => user.id === withPhoto.id)?.imageId).toEqual(
        expect.any(String),
      );
      expect(all.items.find((user) => user.id === without.id)?.imageId).toBeNull();
    });
  });

  describe('renditions (rule 10) and serving (rule 11)', () => {
    it('renders sm and md squares, centre-cropped with transparency kept, then serves them for good', async () => {
      const owned = await cast.createClient();
      const image = await setOk(`/api/clients/${owned.id}`, cast.am.cookie, wideLogo);
      const content = app.get(FileContentService);
      while ((await content.renderPendingImages()).left) {
        // Renders every batch, so this test's image is among them.
      }
      const [row] = await db.select().from(images).where(eq(images.id, image.id));
      expect(row).toMatchObject({ status: 'ready', width: 600, height: 200, attempts: 1 });

      for (const [size, px] of [
        ['sm', 128],
        ['md', 320],
      ] as const) {
        const served = await serve(image.id, size, cast.employee.cookie);
        expect(served.status).toBe(200);
        expect(served.headers.get('content-type')).toBe('image/webp');
        expect(served.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
        const metadata = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
        expect(metadata).toMatchObject({ format: 'webp', width: px, height: px, hasAlpha: true });
      }
      expect((await serve(image.id, 'lg', cast.employee.cookie)).status).toBe(404);
      expect((await serve(randomUUID(), 'sm', cast.employee.cookie)).status).toBe(404);
    });

    it('marks an undecodable image failed after three attempts and stops serving it (edge case 4)', async () => {
      const me = await cast.signedIn();
      // PNG magic bytes and a header, then garbage: accepted on upload, never decodable.
      const broken = Buffer.concat([square.subarray(0, 33), Buffer.alloc(2000, 0x41)]);
      const image = await setOk(`/api/users/${me.id}`, me.cookie, broken);
      const content = app.get(FileContentService);
      while ((await content.renderPendingImages()).left) {
        // Every batch.
      }
      const [row] = await db.select().from(images).where(eq(images.id, image.id));
      expect(row).toMatchObject({ status: 'failed', attempts: 3, archivedAt: null });
      expect((await serve(image.id, 'sm', me.cookie)).status).toBe(404);
    });
  });

  describe('client logos', () => {
    it('is for clients.manage in scope; the account manager hears of changes by others (rule 18)', async () => {
      const owned = await cast.createClient();
      const path = `/api/clients/${owned.id}`;
      const outsider = await upload(cast.otherAm.cookie, square);
      expect(
        (await put(path, cast.otherAm.cookie, { source: { uploadId: outsider } })).status,
      ).toBe(403);
      expect((await remove(path, cast.employee.cookie)).status).toBe(403);
      expect(
        (
          await put(`/api/clients/${randomUUID()}`, cast.gm.cookie, {
            source: { uploadId: outsider },
          })
        ).status,
      ).toBe(404);

      await setOk(path, cast.am.cookie);
      expect(await noticesOf(cast.am.id, 'client_logo_changed', owned.id)).toHaveLength(0);
      const image = await setOk(path, cast.gm.cookie);
      const [notice] = await noticesOf(cast.am.id, 'client_logo_changed', owned.id);
      expect(notice?.data).toEqual({ client: owned.tradeName, removed: false });
      const [row] = await db
        .select({ imageId: clients.imageId })
        .from(clients)
        .where(eq(clients.id, owned.id));
      expect(row?.imageId).toBe(image.id);

      expect((await remove(path, cast.gm.cookie)).status).toBe(204);
      const merged = await noticesOf(cast.am.id, 'client_logo_changed', owned.id);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.data).toEqual({ client: owned.tradeName, removed: true });
      expect(await auditOf(owned.id, 'client.image_removed')).toHaveLength(1);
    });

    it("takes a crop of the client's own logo brand file (rule 6)", async () => {
      const owned = await cast.createClient();
      const other = await cast.createClient();
      const brandFile = async (clientId: string, brandKind: string) => {
        const uploadId = await upload(cast.gm.cookie, square, 'logo.png');
        const response = await client.post('/api/files/items', cast.gm.cookie, {
          ownerType: 'client',
          ownerId: clientId,
          role: 'brand',
          brandKind,
          name: `${brandKind} ${randomUUID().slice(0, 6)}`,
          source: { uploadId },
        });
        expect(response.status, await response.clone().text()).toBe(201);
        const item = fileItemSchema.parse(await response.json());
        return item.versions[0]?.id ?? '';
      };
      const logo = await brandFile(owned.id, 'logo');
      const otherLogo = await brandFile(other.id, 'logo');
      const font = await brandFile(owned.id, 'font');
      const path = `/api/clients/${owned.id}`;
      for (const brandVersionId of [otherLogo, font]) {
        const uploadId = await upload(cast.am.cookie, square);
        await expectError(
          await put(path, cast.am.cookie, { source: { uploadId, brandVersionId } }),
          400,
          'BRAND_FILE_NOT_FOUND',
        );
      }
      const image = await setOk(path, cast.am.cookie, square, { brandVersionId: logo });
      const [row] = await db.select().from(images).where(eq(images.id, image.id));
      expect(row).toMatchObject({ source: 'brand_file', sourceVersionId: logo });
      const [audit] = await auditOf(owned.id, 'client.image_set');
      expect(audit?.after).toEqual({
        imageId: image.id,
        source: 'brand_file',
        brandVersionId: logo,
      });
    });

    it('refuses changes to an archived client (rule 5)', async () => {
      const archived = await cast.createClient();
      expect(
        (await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      const uploadId = await upload(cast.gm.cookie, square);
      await expectError(
        await put(`/api/clients/${archived.id}`, cast.gm.cookie, { source: { uploadId } }),
        409,
        'CLIENT_ARCHIVED',
      );
      await expectError(
        await remove(`/api/clients/${archived.id}`, cast.gm.cookie),
        409,
        'CLIENT_ARCHIVED',
      );
    });
  });

  describe('project and retainer images', () => {
    it('lets client scope and the project manager set a project image; the manager hears of others (rule 18)', async () => {
      const owned = await cast.createClient();
      const project = await cast.createProject(owned.id);
      const path = `/api/projects/${project.id}`;
      const outsider = await upload(cast.otherAm.cookie, square);
      expect(
        (await put(path, cast.otherAm.cookie, { source: { uploadId: outsider } })).status,
      ).toBe(403);
      expect((await remove(path, cast.otherAm.cookie)).status).toBe(403);
      const unknown = `/api/projects/${randomUUID()}`;
      expect((await put(unknown, cast.gm.cookie, { source: { uploadId: outsider } })).status).toBe(
        404,
      );
      expect((await remove(unknown, cast.gm.cookie)).status).toBe(404);
      // The employee manages the project (the `assigned` scope).
      await setOk(path, cast.employee.cookie);
      expect(await noticesOf(cast.employee.id, 'project_image_changed', project.id)).toHaveLength(
        0,
      );
      const image = await setOk(path, cast.am.cookie);
      const [notice] = await noticesOf(cast.employee.id, 'project_image_changed', project.id);
      expect(notice?.data).toEqual({
        project: project.name,
        client: owned.tradeName,
        removed: false,
      });
      const [row] = await db
        .select({ imageId: projects.imageId })
        .from(projects)
        .where(eq(projects.id, project.id));
      expect(row?.imageId).toBe(image.id);

      expect((await remove(path, cast.employee.cookie)).status).toBe(204);
      const [audit] = await auditOf(project.id, 'project.image_removed');
      expect(audit?.before).toEqual({ imageId: image.id });
      const brand = await put(path, cast.gm.cookie, {
        source: { uploadId: await upload(cast.gm.cookie, square), brandVersionId: randomUUID() },
      });
      await expectError(brand, 400, 'BRAND_FILE_NOT_FOUND');
    });

    it('refuses an archived project (rule 5)', async () => {
      const owned = await cast.createClient();
      const project = await cast.createProject(owned.id);
      expect(
        (await client.post(`/api/projects/${project.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      const uploadId = await upload(cast.gm.cookie, square);
      await expectError(
        await put(`/api/projects/${project.id}`, cast.gm.cookie, { source: { uploadId } }),
        409,
        'PROJECT_ARCHIVED',
      );
    });

    it("is for client scope on retainers; the client's account manager hears of others (rule 18)", async () => {
      const owned = await cast.createClient();
      const retainer = await cast.createRetainer(owned.id);
      const path = `/api/retainers/${retainer.id}`;
      const employeeUpload = await upload(cast.employee.cookie, square);
      expect(
        (await put(path, cast.employee.cookie, { source: { uploadId: employeeUpload } })).status,
      ).toBe(403);
      await setOk(path, cast.am.cookie);
      expect(await noticesOf(cast.am.id, 'retainer_image_changed', retainer.id)).toHaveLength(0);
      const image = await setOk(path, cast.gm.cookie);
      const [notice] = await noticesOf(cast.am.id, 'retainer_image_changed', retainer.id);
      expect(notice?.data).toEqual({
        retainer: retainer.name,
        client: owned.tradeName,
        removed: false,
      });
      const [row] = await db
        .select({ imageId: retainers.imageId })
        .from(retainers)
        .where(eq(retainers.id, retainer.id));
      expect(row?.imageId).toBe(image.id);
      const [audit] = await auditOf(retainer.id, 'retainer.image_set').then((rows) =>
        rows.slice(-1),
      );
      expect(audit?.after).toEqual({ imageId: image.id, source: 'upload' });
      expect(audit?.before).toEqual({ imageId: expect.any(String) });

      expect((await remove(path, cast.employee.cookie)).status).toBe(403);
      expect((await remove(path, cast.gm.cookie)).status).toBe(204);
      const [cleared] = await db
        .select({ imageId: retainers.imageId })
        .from(retainers)
        .where(eq(retainers.id, retainer.id));
      expect(cleared?.imageId).toBeNull();
      expect(await currentImages(images.retainerId, retainer.id)).toHaveLength(0);
      const [removed] = await auditOf(retainer.id, 'retainer.image_removed');
      expect(removed?.before).toEqual({ imageId: image.id });
      const merged = await noticesOf(cast.am.id, 'retainer_image_changed', retainer.id);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.data).toMatchObject({ removed: true });
      expect((await remove(`/api/retainers/${randomUUID()}`, cast.gm.cookie)).status).toBe(404);
    });

    it('refuses an archived retainer (rule 5)', async () => {
      const owned = await cast.createClient();
      const retainer = await cast.createRetainer(owned.id);
      expect(
        (await client.post(`/api/retainers/${retainer.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await remove(`/api/retainers/${retainer.id}`, cast.gm.cookie),
        409,
        'RETAINER_ARCHIVED',
      );
    });
  });
});
