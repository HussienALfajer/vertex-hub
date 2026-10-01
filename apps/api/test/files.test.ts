import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  type CreateFileItemInput,
  FILE_LIMITS,
  FILE_MAX_BYTES,
  type FileItem,
  fileItemListSchema,
  fileItemPageSchema,
  fileItemSchema,
  fileLibraryPageSchema,
  fileUploadSchema,
  fileUsageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  fileItems,
  fileUploads,
  fileVersions,
  notifications,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileContentService } from '../src/modules/files/file-content.service.js';
import { FileUploadsService } from '../src/modules/files/file-uploads.service.js';
import { FileVersions } from '../src/modules/files/file-versions.js';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('files (F10)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;
  let finance: Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;
  let filesRoot: string;
  let png: Buffer;

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

  /** Every stored object and preview under the files root. */
  async function storedObjects(): Promise<number> {
    const entries = await readdir(join(filesRoot, 'objects'), {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    return entries.filter((entry) => entry.isFile()).length;
  }

  /** Sends a raw upload request; resolves with the status once the server answers. */
  function rawUpload(
    headers: Record<string, string>,
    send: (request: ReturnType<typeof httpRequest>) => void,
  ): Promise<number> {
    return new Promise<number>((resolvePromise, reject) => {
      const request = httpRequest(`${url}/api/files/uploads`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: cast.employee.cookie, ...headers },
      });
      request.on('response', (response) => {
        resolvePromise(response.statusCode ?? 0);
        response.resume();
        request.destroy();
      });
      request.on('error', reject);
      send(request);
    });
  }

  async function upload(cookie: string | undefined, name: string, content: Buffer | string) {
    const form = new FormData();
    form.append('file', new Blob([content]), name);
    return fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': clientIp(),
        ...(cookie && { cookie }),
      },
      body: form,
    });
  }

  async function uploadOk(cookie: string, name: string, content: Buffer | string) {
    const response = await upload(cookie, name, content);
    expect(response.status, await response.clone().text()).toBe(201);
    return fileUploadSchema.parse(await response.json());
  }

  const createItem = (cookie: string | undefined, input: CreateFileItemInput) =>
    client.post('/api/files/items', cookie, input);

  async function createOk(cookie: string, input: CreateFileItemInput): Promise<FileItem> {
    const response = await createItem(cookie, input);
    expect(response.status, await response.clone().text()).toBe(201);
    return fileItemSchema.parse(await response.json());
  }

  /** Uploads a file as `cookie` and attaches it as a new item. */
  async function addFile(
    cookie: string,
    input: Omit<CreateFileItemInput, 'source'>,
    name = 'poster.png',
    content: Buffer | string = png,
  ): Promise<FileItem> {
    const uploaded = await uploadOk(cookie, name, content);
    return createOk(cookie, { ...input, source: { uploadId: uploaded.uploadId } });
  }

  async function addVersion(cookie: string, itemId: string, note?: string) {
    const uploaded = await uploadOk(cookie, 'poster-v.png', png);
    return client.post(`/api/files/items/${itemId}/versions`, cookie, {
      note,
      source: { uploadId: uploaded.uploadId },
    });
  }

  async function listItems(cookie: string, ownerType: string, ownerId: string, extra = '') {
    const response = await client.get(
      `/api/files/items?ownerType=${ownerType}&ownerId=${ownerId}${extra}`,
      cookie,
    );
    expect(response.status).toBe(200);
    return fileItemListSchema.parse(await response.json());
  }

  const deliverableOf = (taskId: string) =>
    ({ ownerType: 'task', ownerId: taskId, role: 'deliverable' }) as const;
  const referenceOf = (taskId: string) =>
    ({ ownerType: 'task', ownerId: taskId, role: 'reference' }) as const;

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-files-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
    finance = await client.signInWithTwoFactor(db, {
      name: `مالية ${cast.run}`,
      roles: ['finance'],
    });
    cast.trackUser(finance.id);
    png = await sharp({
      create: { width: 32, height: 20, channels: 3, background: '#c00' },
    })
      .png()
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
    expect((await upload(undefined, 'a.png', png)).status).toBe(401);
    expect((await client.get(`/api/files/items?ownerType=task&ownerId=${id}`)).status).toBe(401);
    expect(
      (await createItem(undefined, { ...deliverableOf(id), source: { uploadId: id } })).status,
    ).toBe(401);
    expect(
      (await client.request('PATCH', `/api/files/items/${id}`, { body: { name: 'x' } })).status,
    ).toBe(401);
    for (const path of [
      `/api/files/items/${id}/versions`,
      `/api/files/items/${id}/archive`,
      `/api/files/items/${id}/restore`,
      `/api/files/versions/${id}/archive`,
      `/api/files/versions/${id}/restore`,
      `/api/files/versions/${id}/final`,
    ]) {
      expect((await client.post(path)).status, path).toBe(401);
    }
    for (const path of [
      `/api/files/versions/${id}/content`,
      `/api/files/versions/${id}/thumbnail`,
      `/api/files/versions/${id}/preview`,
      `/api/files/library?clientId=${id}`,
      `/api/files/documents?clientId=${id}`,
      '/api/files/usage',
    ]) {
      expect((await client.get(path)).status, path).toBe(401);
    }
  });

  describe('upload (rule 1)', () => {
    it('stores a file and detects its type from the content', async () => {
      const uploaded = await uploadOk(cast.employee.cookie, 'صورة الإطلاق.bin', png);
      expect(uploaded).toMatchObject({
        name: 'صورة الإطلاق.bin',
        sizeBytes: png.length,
        mimeType: 'image/png',
      });
      const [row] = await db
        .select()
        .from(fileUploads)
        .where(eq(fileUploads.id, uploaded.uploadId));
      expect(row).toMatchObject({ userId: cast.employee.id, width: 32, height: 20 });
      expect(row?.storageKey).toMatch(/^objects\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
      expect(row?.sha256).toHaveLength(64);
    });

    it('refuses empty files, blocked types and a missing field', async () => {
      await expectError(await upload(cast.employee.cookie, 'empty.txt', ''), 400, 'FILE_EMPTY');
      await expectError(
        await upload(cast.employee.cookie, 'setup.exe', 'hello'),
        400,
        'FILE_TYPE_BLOCKED',
      );
      const executable = Buffer.alloc(512);
      executable.write('MZ', 0);
      executable.writeUInt32LE(128, 0x3c);
      executable.write('PE\0\0', 128, 'binary');
      await expectError(
        await upload(cast.employee.cookie, 'photo.jpg', executable),
        400,
        'FILE_TYPE_BLOCKED',
      );
      const form = new FormData();
      form.append('other', new Blob(['x']), 'x.txt');
      const missing = await fetch(`${url}/api/files/uploads`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: cast.employee.cookie },
        body: form,
      });
      expect(missing.status).toBe(400);
    });

    it('refuses a declared size above 250 MB before reading it (FILE_TOO_LARGE)', async () => {
      const status = await new Promise<number>((resolvePromise, reject) => {
        const request = httpRequest(`${url}/api/files/uploads`, {
          method: 'POST',
          headers: {
            origin: ORIGIN,
            cookie: cast.employee.cookie,
            'content-type': 'multipart/form-data; boundary=x',
            'content-length': String(FILE_MAX_BYTES + 1024 * 1024),
          },
        });
        request.on('response', (response) => {
          resolvePromise(response.statusCode ?? 0);
          response.resume();
          request.destroy();
        });
        request.on('error', reject);
        request.write('--x\r\n');
      });
      expect(status).toBe(413);
    });

    it('refuses a body that grows past 250 MB while streaming, and keeps nothing', async () => {
      const before = await storedObjects();
      const chunk = Buffer.alloc(1024 * 1024);
      const status = await rawUpload(
        { 'content-type': 'multipart/form-data; boundary=x', 'transfer-encoding': 'chunked' },
        (request) => {
          request.write(
            '--x\r\nContent-Disposition: form-data; name="file"; filename="raw.mov"\r\n\r\n',
          );
          let sent = 0;
          const pump = () => {
            while (sent <= FILE_MAX_BYTES + chunk.length) {
              sent += chunk.length;
              if (!request.write(chunk)) {
                request.once('drain', pump);
                return;
              }
            }
            request.end('\r\n--x--\r\n');
          };
          pump();
        },
      );
      expect(status).toBe(413);
      expect(await storedObjects()).toBe(before);
    }, 60_000);

    it('answers a truncated multipart body with 400, keeps nothing and stays up', async () => {
      const before = await storedObjects();
      const body =
        '--x\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nABC';
      const status = await rawUpload(
        {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(Buffer.byteLength(body)),
        },
        (request) => request.end(body),
      );
      expect(status).toBe(400);
      expect(await storedObjects()).toBe(before);
      expect((await upload(cast.employee.cookie, 'after.png', png)).status).toBe(201);
    });
  });

  describe('references', () => {
    it('lets every user add them; the assignee gets one merged notification', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const first = await addFile(cast.employee.cookie, referenceOf(task.id), 'mood.png');
      await addFile(cast.am.cookie, referenceOf(task.id), 'brief.pdf', pdf);
      expect(first).toMatchObject({ role: 'reference', name: 'mood', versions: [{ number: 1 }] });

      const received = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientId, cast.designer.id),
            eq(notifications.subjectId, task.id),
            eq(notifications.type, 'task_file_added'),
          ),
        );
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ count: 2, actorId: cast.am.id });
      expect(received[0]?.data).toMatchObject({ file: 'brief', task: { title: task.title } });

      // The assignee's own files notify nobody.
      await addFile(cast.designer.cookie, referenceOf(task.id), 'own.png');
      const after = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.subjectId, task.id), eq(notifications.type, 'task_file_added')),
        );
      expect(after.filter((n) => n.recipientId === cast.designer.id)).toHaveLength(1);
      expect(after.every((n) => n.recipientId === cast.designer.id)).toBe(true);

      const list = await listItems(cast.writer.cookie, 'task', task.id, '&role=reference');
      expect(list.items.map((item) => item.name)).toEqual(['own', 'brief', 'mood']);
      expect(list.rights).toMatchObject({ canAddReference: true, canAddDeliverable: false });
      expect(list.items.find((item) => item.id === first.id)?.permissions.canRemove).toBe(false);
    });

    it('refuses links, a second version, and removal by others', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      await expectError(
        await createItem(cast.employee.cookie, {
          ...referenceOf(task.id),
          source: { url: 'https://drive.google.com/x' },
        }),
        400,
        'LINK_NOT_ALLOWED',
      );
      const reference = await addFile(cast.employee.cookie, referenceOf(task.id));
      await expectError(await addVersion(cast.employee.cookie, reference.id), 409, 'NOT_VERSIONED');
      expect(
        (await client.post(`/api/files/items/${reference.id}/archive`, cast.writer.cookie)).status,
      ).toBe(403);
      expect(
        (await client.post(`/api/files/items/${reference.id}/archive`, cast.employee.cookie))
          .status,
      ).toBe(204);
      const [entry] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, reference.id),
            eq(auditEntries.action, 'file_item.archived'),
          ),
        );
      expect(entry?.after).toMatchObject({
        ownerType: 'task',
        ownerId: task.id,
        role: 'reference',
      });
    });

    it('attaches an upload once, only by its uploader (UPLOAD_NOT_FOUND)', async () => {
      const task = await cast.createTask(cast.designManager.cookie);
      const uploaded = await uploadOk(cast.employee.cookie, 'a.png', png);
      await expectError(
        await createItem(cast.writer.cookie, {
          ...referenceOf(task.id),
          source: { uploadId: uploaded.uploadId },
        }),
        400,
        'UPLOAD_NOT_FOUND',
      );
      await createOk(cast.employee.cookie, {
        ...referenceOf(task.id),
        source: { uploadId: uploaded.uploadId },
      });
      await expectError(
        await createItem(cast.employee.cookie, {
          ...referenceOf(task.id),
          source: { uploadId: uploaded.uploadId },
        }),
        400,
        'UPLOAD_NOT_FOUND',
      );
    });
  });

  describe('deliverables and versions (rules 3, 7)', () => {
    it('lets task workers add them, audited, with unique names', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const poster = await addFile(cast.designer.cookie, {
        ...deliverableOf(task.id),
        name: 'Launch poster',
        note: 'first cut',
      });
      expect(poster).toMatchObject({
        name: 'Launch poster',
        createdBy: { id: cast.designer.id },
        permissions: { canAddVersion: true, canRename: true, canRemove: true, canSetFinal: false },
        versions: [{ number: 1, kind: 'upload', type: 'image', note: 'first cut', isFinal: false }],
      });
      const link = await createOk(cast.designer.cookie, {
        ...deliverableOf(task.id),
        source: { url: 'https://drive.google.com/file/d/secret-id/view' },
      });
      expect(link).toMatchObject({
        name: 'drive.google.com',
        versions: [{ kind: 'link', type: 'link' }],
      });
      const [linkAudit] = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, link.id));
      expect(linkAudit?.after).toMatchObject({ host: 'drive.google.com', number: 1 });
      expect(JSON.stringify(linkAudit?.after)).not.toContain('secret-id');

      await expectError(
        await createItem(cast.designer.cookie, {
          ...deliverableOf(task.id),
          name: 'LAUNCH POSTER',
          source: { url: 'https://a.com' },
        }),
        409,
        'FILE_NAME_TAKEN',
      );
      expect(
        (
          await createItem(cast.writer.cookie, {
            ...deliverableOf(task.id),
            source: { url: 'https://a.com' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.request('PATCH', `/api/files/items/${poster.id}`, {
            cookie: cast.writer.cookie,
            body: { name: 'Mine' },
          })
        ).status,
      ).toBe(403);
      const renamed = await client.request('PATCH', `/api/files/items/${poster.id}`, {
        cookie: cast.designer.cookie,
        body: { name: 'Poster' },
      });
      expect(fileItemSchema.parse(await renamed.json()).name).toBe('Poster');
      const flagged = await client.request('PATCH', `/api/files/items/${poster.id}`, {
        cookie: cast.designer.cookie,
        body: { confidential: true },
      });
      expect(flagged.status).toBe(400);
    });

    it('numbers concurrent versions consecutively and never reuses a number', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const poster = await addFile(cast.designer.cookie, deliverableOf(task.id));
      const [a, b] = await Promise.all([
        addVersion(cast.designer.cookie, poster.id),
        addVersion(cast.designManager.cookie, poster.id, 'brighter'),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const numbers = [
        fileItemSchema.parse(await a.json()).versions[0]?.number,
        fileItemSchema.parse(await b.json()).versions[0]?.number,
      ];
      expect(numbers.sort()).toEqual([2, 3]);
      const item = (await listItems(cast.designer.cookie, 'task', task.id)).items[0] as FileItem;
      expect(item.versions.map((v) => v.number)).toEqual([3, 2, 1]);

      const v3 = item.versions.find((v) => v.number === 3);
      const removed = await client.post(
        `/api/files/versions/${v3?.id}/archive`,
        cast.designManager.cookie,
      );
      expect(removed.status).toBe(200);
      const next = fileItemSchema.parse(
        await (await addVersion(cast.designer.cookie, poster.id)).json(),
      );
      expect(next.versions[0]?.number).toBe(4);
    });

    it('refuses removing the last version (LAST_VERSION) and others’ versions', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const poster = await addFile(cast.designManager.cookie, deliverableOf(task.id));
      const v1 = poster.versions[0]?.id;
      await expectError(
        await client.post(`/api/files/versions/${v1}/archive`, cast.designManager.cookie),
        409,
        'LAST_VERSION',
      );
      const withV2 = fileItemSchema.parse(
        await (await addVersion(cast.designManager.cookie, poster.id)).json(),
      );
      // The designer works the task but did not upload v1: only its uploader and manage scope remove it.
      expect(
        (await client.post(`/api/files/versions/${v1}/archive`, cast.designer.cookie)).status,
      ).toBe(403);
      expect(withV2.versions.map((v) => v.canRemove)).toEqual([true, true]);
    });

    it('enforces the per-task limit (LIMIT_REACHED)', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      await db.insert(fileItems).values(
        Array.from({ length: FILE_LIMITS.deliverable }, (_, index) => ({
          ownerType: 'task' as const,
          taskId: task.id,
          role: 'deliverable' as const,
          name: `seeded ${index}`,
          createdById: cast.designer.id,
        })),
      );
      await expectError(
        await createItem(cast.designer.cookie, {
          ...deliverableOf(task.id),
          source: { url: 'https://a.com' },
        }),
        409,
        'LIMIT_REACHED',
      );
    });
  });

  describe('final marker (rules 9–11)', () => {
    it('marks the latest versions on approval, by hand after, and keeps them on reopen', async () => {
      const clientId = (await cast.createClient()).id;
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
        needsClientApproval: false,
      });
      const poster = await addFile(cast.designer.cookie, {
        ...deliverableOf(task.id),
        name: 'Poster',
      });
      await addVersion(cast.designer.cookie, poster.id, 'v2');
      const video = await createOk(cast.designer.cookie, {
        ...deliverableOf(task.id),
        name: 'Video',
        source: { url: 'https://drive.google.com/v' },
      });
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
      const v1 = poster.versions[0]?.id as string;
      await expectError(
        await client.post(`/api/files/versions/${v1}/final`, cast.designManager.cookie, {
          final: true,
        }),
        409,
        'TASK_NOT_APPROVED',
      );
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'approved' });

      const list = await listItems(cast.designer.cookie, 'task', task.id, '&role=deliverable');
      const finals = list.items.map((item) => [
        item.name,
        item.versions.find((v) => v.isFinal)?.number,
      ]);
      expect(finals.sort()).toEqual([
        ['Poster', 2],
        ['Video', 1],
      ]);
      const posterV2 = list.items.find((i) => i.id === poster.id)?.versions[0];
      expect(posterV2).toMatchObject({ finalSource: 'auto', finalMarkedBy: null });
      const [auto] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, video.id),
            eq(auditEntries.action, 'file_version.final_set'),
          ),
        );
      expect(auto).toMatchObject({
        actorId: cast.designManager.id,
        after: { source: 'auto', number: 1 },
      });

      await expectError(
        await client.post(`/api/files/versions/${posterV2?.id}/archive`, cast.designer.cookie),
        409,
        'VERSION_FINAL',
      );
      expect(
        (
          await client.post(`/api/files/versions/${v1}/final`, cast.designer.cookie, {
            final: true,
          })
        ).status,
      ).toBe(403);
      const manual = fileItemSchema.parse(
        await (
          await client.post(`/api/files/versions/${v1}/final`, cast.designManager.cookie, {
            final: true,
          })
        ).json(),
      );
      expect(manual.versions.map((v) => [v.number, v.isFinal, v.finalSource])).toEqual([
        [2, false, null],
        [1, true, 'manual'],
      ]);
      expect(manual.versions[1]?.finalMarkedBy?.id).toBe(cast.designManager.id);

      // One final version per deliverable, enforced by the database.
      await expect(
        db
          .update(fileVersions)
          .set({ isFinal: true, finalSource: 'manual', finalMarkedAt: new Date() })
          .where(eq(fileVersions.id, posterV2?.id as string)),
      ).rejects.toThrow();

      // Delivered: read-only for files, but the marker can still move (rule 10).
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'delivered' });
      await expectError(await addVersion(cast.designer.cookie, poster.id), 409, 'TASK_CLOSED');
      // Restore is refused on a closed task (rule 5), so its flag is off even for scope all.
      const closed = await listItems(cast.gm.cookie, 'task', task.id, '&role=deliverable');
      expect(closed.items.find((i) => i.id === poster.id)?.permissions.canRestore).toBe(false);
      const reset = await client.post(
        `/api/files/versions/${posterV2?.id}/final`,
        cast.designManager.cookie,
        {
          final: true,
        },
      );
      expect(reset.status).toBe(200);

      // Reopening keeps the markers; the next approval moves them to the new latest version.
      await cast.moveOk(task.id, cast.designManager.cookie, {
        status: 'in_progress',
        note: 'Change the headline',
      });
      const kept = await listItems(cast.designer.cookie, 'task', task.id, '&role=deliverable');
      expect(kept.items.find((i) => i.id === poster.id)?.versions[0]?.isFinal).toBe(true);
      await addVersion(cast.designer.cookie, poster.id, 'v3');
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'approved' });
      const again = await listItems(cast.designer.cookie, 'task', task.id, '&role=deliverable');
      const posterAgain = again.items.find((i) => i.id === poster.id);
      expect(posterAgain?.versions.find((v) => v.isFinal)?.number).toBe(3);
      expect(posterAgain?.versions.filter((v) => v.isFinal)).toHaveLength(1);
    });

    it('marks the version the client approved, not one added after the review (F09 rule 13)', async () => {
      const task = await cast.taskAt('internal_review');
      const poster = await addFile(cast.designer.cookie, deliverableOf(task.id));
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'awaiting_client' });
      expect((await addVersion(cast.designer.cookie, poster.id, 'after the review')).status).toBe(
        200,
      );
      await cast.moveOk(task.id, cast.am.cookie, { status: 'approved' });
      const list = await listItems(cast.am.cookie, 'task', task.id);
      const versions = list.items.find((i) => i.id === poster.id)?.versions ?? [];
      expect(versions.map((v) => [v.number, v.isFinal, v.finalSource])).toEqual([
        [2, false, null],
        [1, true, 'client'],
      ]);
    });
  });

  describe('final marker in the approving transaction', () => {
    it('leaves no marker when the approval rolls back', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const poster = await addFile(cast.designer.cookie, deliverableOf(task.id));
      const files = app.get(FileVersions);
      await expect(
        db.transaction(async (tx) => {
          await files.markLatestFinal(tx, task.id, { id: cast.designManager.id, name: 'x' });
          throw new Error('approval failed');
        }),
      ).rejects.toThrow('approval failed');
      const [version] = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.id, poster.versions[0]?.id as string));
      expect(version?.isFinal).toBe(false);
      const audits = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, poster.id),
            eq(auditEntries.action, 'file_version.final_set'),
          ),
        );
      expect(audits).toHaveLength(0);
    });
  });

  describe('library and client moves (rules 4, 13)', () => {
    it('lists final deliverables of the client, filtered, and follows the task’s client', async () => {
      const first = await cast.createClient();
      const second = await cast.createClient();
      const task = await cast.taskAt('internal_review', {
        clientId: first.id,
        needsClientApproval: false,
        title: `حملة الإطلاق ${cast.run}`,
      });
      await addFile(cast.designer.cookie, { ...deliverableOf(task.id), name: 'Poster' });
      await createOk(cast.designer.cookie, {
        ...deliverableOf(task.id),
        name: 'Brief pdf',
        source: { url: 'https://docs.example.com/brief' },
      });
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'approved' });

      const library = async (clientId: string, query = '') => {
        const response = await client.get(
          `/api/files/library?clientId=${clientId}${query}`,
          cast.employee.cookie,
        );
        expect(response.status).toBe(200);
        return fileLibraryPageSchema.parse(await response.json());
      };
      const all = await library(first.id);
      expect(all.total).toBe(2);
      expect(all.items[0]?.task).toEqual({ id: task.id, title: task.title });
      expect((await library(first.id, '&type=image')).items.map((e) => e.itemName)).toEqual([
        'Poster',
      ]);
      expect((await library(first.id, '&type=link')).items.map((e) => e.itemName)).toEqual([
        'Brief pdf',
      ]);
      expect((await library(first.id, `&q=${encodeURIComponent('الإطلاق')}`)).total).toBe(2);
      expect((await library(first.id, '&q=poster')).total).toBe(1);
      expect((await library(first.id, '&month=2001-01')).total).toBe(0);

      const moved = await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: cast.gm.cookie,
        body: { clientId: second.id },
      });
      expect(moved.status).toBe(200);
      expect((await library(first.id)).total).toBe(0);
      expect((await library(second.id)).total).toBe(2);

      // Files of a task whose project is archived leave the library with the task (F06 rule 17).
      const project = await cast.createProject(second.id);
      const linked = await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: cast.gm.cookie,
        body: { projectId: project.id },
      });
      expect(linked.status).toBe(200);
      const archived = await client.post(`/api/projects/${project.id}/archive`, cast.gm.cookie);
      expect(archived.status).toBe(200);
      expect((await library(second.id)).total).toBe(0);
      expect(
        (await client.get(`/api/files/library?clientId=${randomUUID()}`, cast.employee.cookie))
          .status,
      ).toBe(404);
    });
  });

  describe('brand files and documents (rules 14, 15)', () => {
    it('lets client managers keep versioned brand files', async () => {
      const brandClient = await cast.createClient();
      const brand = { ownerType: 'client', ownerId: brandClient.id, role: 'brand' } as const;
      const logo = await addFile(cast.am.cookie, { ...brand, brandKind: 'logo', name: 'Logo' });
      const v2 = fileItemSchema.parse(await (await addVersion(cast.am.cookie, logo.id)).json());
      expect(v2.versions.map((v) => v.number)).toEqual([2, 1]);
      expect((await addVersion(cast.otherAm.cookie, logo.id)).status).toBe(403);
      const list = await listItems(cast.employee.cookie, 'client', brandClient.id, '&role=brand');
      expect(list.items).toHaveLength(1);
      expect(list.rights.canManageDocuments).toBe(false);
    });

    it('hides confidential documents from everyone but confidential readers', async () => {
      const docClient = await cast.createClient();
      const project = await cast.createProject(docClient.id);
      const contract = await addFile(
        cast.am.cookie,
        {
          ownerType: 'client',
          ownerId: docClient.id,
          role: 'document',
          confidential: true,
          name: 'Contract',
        },
        'contract.pdf',
        pdf,
      );
      // The employee manages the project: project documents yes, confidential no.
      const handover = await addFile(
        cast.employee.cookie,
        { ownerType: 'project', ownerId: project.id, role: 'document' },
        'handover.pdf',
        pdf,
      );
      await expectError(
        await client.request('PATCH', `/api/files/items/${handover.id}`, {
          cookie: cast.employee.cookie,
          body: { confidential: true },
        }),
        403,
        'NOT_CONFIDENTIAL_READER',
      );
      const secret = await uploadOk(cast.employee.cookie, 'secret.pdf', pdf);
      await expectError(
        await createItem(cast.employee.cookie, {
          ownerType: 'project',
          ownerId: project.id,
          role: 'document',
          confidential: true,
          source: { uploadId: secret.uploadId },
        }),
        403,
        'NOT_CONFIDENTIAL_READER',
      );

      const documents = async (cookie: string) => {
        const response = await client.get(`/api/files/documents?clientId=${docClient.id}`, cookie);
        expect(response.status).toBe(200);
        return fileItemPageSchema.parse(await response.json());
      };
      const seen = await documents(cast.employee.cookie);
      expect(seen.items.map((d) => [d.name, d.owner.type, d.owner.label])).toEqual([
        ['handover', 'project', project.name],
      ]);
      for (const reader of [cast.am, cast.operations, finance]) {
        expect((await documents(reader.cookie)).total).toBe(2);
      }
      const contentPath = `/api/files/versions/${contract.versions[0]?.id}/content`;
      expect((await client.get(contentPath, cast.employee.cookie)).status).toBe(404);
      const readerContent = await client.get(contentPath, finance.cookie);
      expect(readerContent.status).toBe(200);
      expect(readerContent.headers.get('cache-control')).toBe('private, no-store');
    });

    it('lets scope all see, remove and restore; others cannot restore', async () => {
      const docClient = await cast.createClient();
      const client_ = { ownerType: 'client', ownerId: docClient.id, role: 'document' } as const;
      const doc = await addFile(cast.am.cookie, { ...client_, name: 'Offer' }, 'offer.pdf', pdf);
      expect(
        (await client.post(`/api/files/items/${doc.id}/archive`, cast.operations.cookie)).status,
      ).toBe(204);
      expect(
        (await listItems(cast.am.cookie, 'client', docClient.id, '&includeArchived=true')).items,
      ).toHaveLength(0);
      const shown = await listItems(
        cast.operations.cookie,
        'client',
        docClient.id,
        '&includeArchived=true',
      );
      expect(shown.items.map((i) => i.archivedAt !== null)).toEqual([true]);
      expect(shown.rights.canSeeRemoved).toBe(true);
      expect((await client.post(`/api/files/items/${doc.id}/restore`, cast.am.cookie)).status).toBe(
        404,
      );

      await addFile(cast.am.cookie, { ...client_, name: 'offer' }, 'offer2.pdf', pdf);
      await expectError(
        await client.post(`/api/files/items/${doc.id}/restore`, cast.operations.cookie),
        409,
        'FILE_NAME_TAKEN',
      );
    });
  });

  describe('retainer documents and restores', () => {
    it('lets only client scope manage retainer documents; restores are scope all', async () => {
      const retainerClient = await cast.createClient();
      const retainer = await cast.createRetainer(retainerClient.id);
      const owner = { ownerType: 'retainer', ownerId: retainer.id, role: 'document' } as const;
      const offer = await addFile(
        cast.am.cookie,
        { ...owner, name: 'Renewal offer' },
        'offer.pdf',
        pdf,
      );
      // The employee manages projects but is not client scope: no retainer documents.
      const denied = await uploadOk(cast.employee.cookie, 'x.pdf', pdf);
      const refused = await createItem(cast.employee.cookie, {
        ...owner,
        source: { uploadId: denied.uploadId },
      });
      expect(refused.status).toBe(403);
      expect((await listItems(cast.employee.cookie, 'retainer', retainer.id)).items).toHaveLength(
        1,
      );

      const v2 = fileItemSchema.parse(await (await addVersion(cast.am.cookie, offer.id)).json());
      const v1 = v2.versions.find((v) => v.number === 1)?.id;
      expect((await client.post(`/api/files/versions/${v1}/archive`, cast.am.cookie)).status).toBe(
        200,
      );
      expect((await client.post(`/api/files/versions/${v1}/restore`, cast.am.cookie)).status).toBe(
        403,
      );
      const restored = await client.post(
        `/api/files/versions/${v1}/restore`,
        cast.operations.cookie,
      );
      expect(restored.status).toBe(200);
      const item = fileItemSchema.parse(await restored.json());
      expect(item.versions.every((v) => !v.archivedAt)).toBe(true);
    });
  });

  describe('closed and archived owners (rules 5, 6)', () => {
    it('hides files of an archived task from users without scope all', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const poster = await addFile(cast.designer.cookie, deliverableOf(task.id));
      expect((await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie)).status).toBe(200);
      expect(
        (
          await client.get(
            `/api/files/items?ownerType=task&ownerId=${task.id}`,
            cast.designer.cookie,
          )
        ).status,
      ).toBe(404);
      expect((await listItems(cast.gm.cookie, 'task', task.id)).rights.canAddDeliverable).toBe(
        false,
      );
      await expectError(await addVersion(cast.gm.cookie, poster.id), 409, 'TASK_ARCHIVED');
    });

    it('refuses changes on an archived client (CLIENT_ARCHIVED)', async () => {
      const archived = await cast.createClient();
      expect(
        (await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await createItem(cast.gm.cookie, {
          ownerType: 'client',
          ownerId: archived.id,
          role: 'document',
          source: { url: 'https://a.com' },
        }),
        409,
        'CLIENT_ARCHIVED',
      );
      expect(
        (await client.get(`/api/files/documents?clientId=${archived.id}`, cast.am.cookie)).status,
      ).toBe(404);
    });
  });

  describe('content (rules 16, 17)', () => {
    it('streams bytes with safe headers, ranges and download names', async () => {
      const namedClient = await cast.createClient({ tradeName: `مطعم ${cast.run}` });
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId: namedClient.id,
      });
      const poster = await addFile(cast.designer.cookie, {
        ...deliverableOf(task.id),
        name: 'Poster',
      });
      const path = `/api/files/versions/${poster.versions[0]?.id}/content`;
      const inline = await client.get(path, cast.writer.cookie);
      expect(inline.status).toBe(200);
      expect(inline.headers.get('content-type')).toBe('image/png');
      expect(inline.headers.get('x-content-type-options')).toBe('nosniff');
      expect(inline.headers.get('content-disposition')).toContain('inline;');
      expect(inline.headers.get('content-disposition')).toContain(
        `filename*=UTF-8''${encodeURIComponent(`مطعم ${cast.run} - Poster - v1.png`)}`,
      );
      expect(Buffer.from(await inline.arrayBuffer()).equals(png)).toBe(true);

      const download = await client.get(`${path}?download=1`, cast.writer.cookie);
      expect(download.headers.get('content-type')).toBe('application/octet-stream');
      expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
      await download.arrayBuffer();

      const ranged = await client.request('GET', path, { cookie: cast.writer.cookie });
      await ranged.arrayBuffer();
      const partial = await fetch(`${url}${path}`, {
        headers: { origin: ORIGIN, cookie: cast.writer.cookie, range: 'bytes=0-9' },
      });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe(`bytes 0-9/${png.length}`);
      expect((await partial.arrayBuffer()).byteLength).toBe(10);

      for (const [name, content] of [
        ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'],
        ['page.html', '<html><script>alert(1)</script></html>'],
      ] as const) {
        const item = await addFile(cast.designer.cookie, referenceOf(task.id), name, content);
        const response = await client.get(
          `/api/files/versions/${item.versions[0]?.id}/content`,
          cast.writer.cookie,
        );
        expect(response.headers.get('content-type'), name).toBe('application/octet-stream');
        expect(response.headers.get('content-disposition'), name).toMatch(/^attachment;/);
        await response.arrayBuffer();
      }

      const link = await createOk(cast.designer.cookie, {
        ...deliverableOf(task.id),
        source: { url: 'https://a.com/x' },
      });
      expect(
        (
          await client.get(
            `/api/files/versions/${link.versions[0]?.id}/content`,
            cast.writer.cookie,
          )
        ).status,
      ).toBe(404);
    });

    it('hands the bytes to nginx with X-Accel-Redirect when enabled', async () => {
      const task = await cast.createTask(cast.designManager.cookie);
      const poster = await addFile(cast.designManager.cookie, deliverableOf(task.id));
      process.env.FILES_X_ACCEL = 'true';
      const accel = await startApp();
      delete process.env.FILES_X_ACCEL;
      try {
        const response = await fetch(
          `${accel.url}/api/files/versions/${poster.versions[0]?.id}/content`,
          {
            headers: { origin: ORIGIN, cookie: cast.writer.cookie },
          },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('x-accel-redirect')).toMatch(
          /^\/_files\/objects\/\d{4}\/\d{2}\//,
        );
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect((await response.arrayBuffer()).byteLength).toBe(0);
      } finally {
        await accel.app.close();
      }
    });
  });

  describe('jobs', () => {
    it('renders previews (ready) and marks broken images failed', async () => {
      const task = await cast.createTask(cast.designManager.cookie);
      const good = await addFile(cast.designManager.cookie, deliverableOf(task.id), 'good.png');
      const broken = Buffer.concat([png.subarray(0, 40), Buffer.alloc(200)]);
      const bad = await addFile(cast.designManager.cookie, referenceOf(task.id), 'bad.png', broken);
      expect(good.versions[0]?.previewStatus).toBe('pending');
      const thumb = `/api/files/versions/${good.versions[0]?.id}/thumbnail`;
      expect((await client.get(thumb, cast.writer.cookie)).status).toBe(404);

      const content = app.get(FileContentService);
      while ((await content.renderPendingPreviews()).left) {
        // Earlier tests left pending previews: render them all.
      }
      const [goodRow] = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.id, good.versions[0]?.id as string));
      const [badRow] = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.id, bad.versions[0]?.id as string));
      expect(goodRow?.previewStatus).toBe('ready');
      expect(badRow?.previewStatus).toBe('failed');
      for (const size of ['thumbnail', 'preview']) {
        const response = await client.get(
          `/api/files/versions/${good.versions[0]?.id}/${size}`,
          cast.writer.cookie,
        );
        expect(response.status, size).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('cache-control')).toBe('private, max-age=86400');
        const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
        expect(meta.format).toBe('webp');
      }
    });

    it('purges only unattached uploads older than 24 hours, with their content', async () => {
      const keys = [`objects/2000/01/${randomUUID()}`, `objects/2000/01/${randomUUID()}`];
      await mkdir(join(filesRoot, 'objects/2000/01'), { recursive: true });
      for (const key of keys) await writeFile(join(filesRoot, key), 'x');
      const base = {
        userId: cast.employee.id,
        originalName: 'x.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      };
      const [old, fresh] = await db
        .insert(fileUploads)
        .values([
          {
            ...base,
            storageKey: keys[0] as string,
            createdAt: new Date(Date.now() - 25 * 3600 * 1000),
          },
          {
            ...base,
            storageKey: keys[1] as string,
            createdAt: new Date(Date.now() - 23 * 3600 * 1000),
          },
        ])
        .returning({ id: fileUploads.id });
      await app.get(FileUploadsService).purgeUploads();
      const left = await db.select({ id: fileUploads.id }).from(fileUploads);
      expect(left.map((row) => row.id)).toContain(fresh?.id);
      expect(left.map((row) => row.id)).not.toContain(old?.id);
      await expect(stat(join(filesRoot, keys[0] as string))).rejects.toThrow();
      await expect(stat(join(filesRoot, keys[1] as string))).resolves.toBeTruthy();
      await db.delete(fileUploads).where(eq(fileUploads.id, fresh?.id as string));
    });
  });

  it('shows storage usage to scope all only', async () => {
    const usageClient = await cast.createClient();
    await addFile(
      cast.am.cookie,
      { ownerType: 'client', ownerId: usageClient.id, role: 'document' },
      'a.pdf',
      pdf,
    );
    expect((await client.get('/api/files/usage', cast.am.cookie)).status).toBe(403);
    const response = await client.get(
      `/api/files/usage?clientId=${usageClient.id}`,
      cast.operations.cookie,
    );
    expect(response.status).toBe(200);
    const usage = fileUsageSchema.parse(await response.json());
    expect(usage.clientBytes).toBe(pdf.length);
    expect(usage.totalBytes).toBeGreaterThanOrEqual(pdf.length);
    expect(usage.freeBytes).toBeGreaterThan(0);
  });
});
