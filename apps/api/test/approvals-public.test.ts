import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  approvalRequestDetailSchema,
  type FileItem,
  fileItemSchema,
  fileUploadSchema,
  type NotificationType,
  publicApprovalItemSchema,
  publicApprovalSchema,
} from '@vertex-hub/contracts';
import {
  approvalItems,
  approvalRequests,
  auditEntries,
  createDatabase,
  notifications,
  taskClientResponses,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApprovalNotices } from '../src/modules/approvals/approval-notices.js';
import { FileContentService } from '../src/modules/files/file-content.service.js';
import { seedApprovalCast } from './approval-cast.js';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { startApp } from './start-app.js';

/*
 * F09 PR 2: the client page of an approval link (rules 13–15 and 20–23): what the holder sees,
 * the decisions, the files of the snapshots, and when a link stops working.
 */
describe('approval links (F09 rules 13–15, 20–23)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedApprovalCast>>;

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  const typesOf = async (recipientId: string, subjectId: string): Promise<NotificationType[]> =>
    (
      await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, recipientId), eq(notifications.subjectId, subjectId)),
        )
        .orderBy(asc(notifications.createdAt))
    ).map((row) => row.type);

  /** The client opens the link: never a cookie. */
  const open = (token: string) => client.get(`/api/public/approvals/${token}`);

  async function page(token: string) {
    const response = await open(token);
    expect(response.status, await response.clone().text()).toBe(200);
    return publicApprovalSchema.parse(await response.json());
  }

  const respond = (token: string, itemId: string, body: unknown, ip?: string) =>
    client.request('POST', `/api/public/approvals/${token}/items/${itemId}/response`, { body, ip });

  const file = (token: string, versionId: string, part: string) =>
    client.get(`/api/public/approvals/${token}/versions/${versionId}/${part}`);

  async function requestDetail(id: string) {
    const response = await client.get(`/api/approvals/requests/${id}`, cast.am.cookie);
    expect(response.status).toBe(200);
    return approvalRequestDetailSchema.parse(await response.json());
  }

  const expectPublicHeaders = (response: Response) => {
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.getSetCookie()).toEqual([]);
  };

  /** Adds a deliverable to the task as the designer: an uploaded file, or a link. */
  async function addDeliverable(
    taskId: string,
    name: string,
    source: { upload: [string, Buffer | string] } | { url: string },
  ): Promise<FileItem> {
    let body: unknown = source;
    if ('upload' in source) {
      const form = new FormData();
      form.append('file', new Blob([source.upload[1]]), source.upload[0]);
      const uploaded = await fetch(`${url}/api/files/uploads`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie: cast.designer.cookie },
        body: form,
      });
      expect(uploaded.status, await uploaded.clone().text()).toBe(201);
      body = { uploadId: fileUploadSchema.parse(await uploaded.json()).uploadId };
    }
    const response = await client.post('/api/files/items', cast.designer.cookie, {
      ownerType: 'task',
      ownerId: taskId,
      role: 'deliverable',
      name,
      source: body,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileItemSchema.parse(await response.json());
  }

  const versionOf = (item: FileItem) => {
    const version = item.versions[0];
    if (!version) throw new Error('The item has no version');
    return version;
  };

  /** A link for two ready tasks of a new client. */
  async function sentPair() {
    const { id: clientId, tradeName } = await cast.createClient();
    const first = await cast.readyTask(clientId);
    const second = await cast.readyTask(clientId);
    const request = await cast.requestOk(clientId, [first.id, second.id]);
    const [a, b] = (await requestDetail(request.id)).items;
    if (!a || !b) throw new Error('The request has no items');
    return { clientId, tradeName, first, second, request, token: cast.tokenOf(request), a, b };
  }

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-approvals-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedApprovalCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    await rm(filesRoot, { recursive: true, force: true });
  });

  it('shows the holder of a link the work, and nothing internal', async () => {
    const { id: clientId, tradeName } = await cast.createClient();
    const task = await cast.readyTask(clientId);
    const response = await cast.createRequest(cast.gm.cookie, {
      clientId,
      contactId: await cast.contactOf(clientId),
      message: 'نرجو الاعتماد قبل الخميس',
      items: [{ taskId: task.id, title: 'منشور الافتتاح' }],
    });
    expect(response.status).toBe(201);
    const issued = (await response.json()) as { link: string; expiresAt: string };

    const opened = await open(cast.tokenOf(issued));
    expect(opened.status).toBe(200);
    expectPublicHeaders(opened);
    const body = await opened.text();
    expect(publicApprovalSchema.parse(JSON.parse(body))).toEqual({
      clientName: tradeName,
      contactName: `جهة اتصال ${cast.run}`,
      accountManagerName: cast.am.name,
      message: 'نرجو الاعتماد قبل الخميس',
      expiresAt: issued.expiresAt,
      items: [
        {
          id: expect.any(String),
          title: 'منشور الافتتاح',
          text: task.clientText,
          files: [],
          status: 'pending',
          note: null,
          decidedAt: null,
          recordedByAgency: false,
        },
      ],
    });
    // Rule 21: neither the task, its internal title, its people nor its department.
    for (const internal of [task.id, task.title, cast.designer.name, 'design', clientId]) {
      expect(body).not.toContain(internal);
    }

    // An unknown link, whatever it looks like, is "not valid" with the same headers.
    for (const token of [randomUUID(), 'x'.repeat(200), cast.tokenOf(issued).slice(0, -1)]) {
      const unknown = await open(token);
      expectPublicHeaders(unknown);
      await expectError(unknown, 404, 'APPROVAL_LINK_INVALID');
    }
  });

  describe('decisions (rules 13–15, A05)', () => {
    it('approves one task and asks for changes on another, each once', async () => {
      const { first, second, request, token, a, b } = await sentPair();
      const contact = `جهة اتصال ${cast.run}`;
      // Changes need a note, a decision is one of two, and the item belongs to the link.
      expect((await respond(token, a.id, { decision: 'changes_requested' })).status).toBe(400);
      expect((await respond(token, a.id, { decision: 'maybe' })).status).toBe(400);
      expect((await respond(token, randomUUID(), { decision: 'approved' })).status).toBe(404);

      const approved = await respond(token, a.id, { decision: 'approved' }, '10.9.8.7');
      expect(approved.status, await approved.clone().text()).toBe(200);
      expectPublicHeaders(approved);
      expect(publicApprovalItemSchema.parse(await approved.json())).toMatchObject({
        id: a.id,
        status: 'approved',
        note: null,
        recordedByAgency: false,
      });

      // The task moved, with a response that keeps who answered and from where.
      const task = await cast.detail(first.id, cast.am.cookie);
      expect(task.status).toBe('approved');
      expect(task.pendingApproval).toBeNull();
      expect(task.clientResponses).toMatchObject([
        { decision: 'approved', channel: 'link', contact: { name: contact }, recordedBy: null },
      ]);
      const [stored] = await db
        .select()
        .from(taskClientResponses)
        .where(eq(taskClientResponses.taskId, first.id));
      expect(stored).toMatchObject({
        approvalItemId: a.id,
        recordedById: null,
        ip: '10.9.8.7',
        userAgent: 'node',
        reviewId: task.clearedReview?.id,
      });
      // Audited under the contact's name, with no user.
      expect((await auditOf(first.id)).slice(-2)).toMatchObject([
        {
          action: 'task.status_changed',
          actorId: null,
          actorName: contact,
          before: { status: 'awaiting_client' },
          after: { status: 'approved', via: 'approval_link' },
        },
        {
          action: 'task.client_response_recorded',
          actorId: null,
          actorName: contact,
          after: { decision: 'approved', channel: 'link' },
        },
      ]);
      expect((await auditOf(request.id)).at(-1)).toMatchObject({
        action: 'approval_item.responded',
        actorId: null,
        actorName: contact,
        after: { itemId: a.id, taskId: first.id, decision: 'approved', via: 'approval_link' },
      });
      expect(await typesOf(cast.designer.id, first.id)).toContain('task_approved');
      expect(await typesOf(cast.am.id, request.id)).toEqual(['approval_responded']);

      // Rule 15: final, for this item only; the request waits for the other.
      await expectError(
        await respond(token, a.id, { decision: 'changes_requested', note: 'غيّرت رأيي' }),
        409,
        'ITEM_ALREADY_DECIDED',
      );
      expect((await requestDetail(request.id)).state).toBe('open');

      const changes = await respond(token, b.id, {
        decision: 'changes_requested',
        note: ' كبّروا الشعار ',
      });
      expect(changes.status, await changes.clone().text()).toBe(200);
      expect(publicApprovalItemSchema.parse(await changes.json())).toMatchObject({
        status: 'changes_requested',
        note: 'كبّروا الشعار',
      });
      const returned = await cast.detail(second.id, cast.am.cookie);
      expect(returned.status).toBe('revisions');
      expect(returned.revisions.clientCount).toBe(1);
      expect(returned.revisionHistory.at(-1)).toMatchObject({
        source: 'client',
        number: 1,
        note: 'كبّروا الشعار',
        contact: { name: contact },
        author: null,
      });
      expect(await typesOf(cast.designer.id, second.id)).toContain('task_returned');

      // Completed, and the account manager's notification counts both decisions.
      expect(await requestDetail(request.id)).toMatchObject({
        state: 'completed',
        counts: { approved: 1, changesRequested: 1, pending: 0 },
      });
      const [merged] = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, cast.am.id), eq(notifications.subjectId, request.id)),
        );
      expect(merged).toMatchObject({ count: 2, actorId: null });
      expect(merged?.data).toMatchObject({ decision: 'changes_requested', contact });
      // The page still opens and shows the decisions.
      expect((await page(token)).items).toMatchObject([
        { status: 'approved', decidedAt: expect.any(String) },
        { status: 'changes_requested', note: 'كبّروا الشعار' },
      ]);
    });

    it('records over-limit changes like a response by hand', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.taskAt('awaiting_client', { clientId, revisionLimit: 0 });
      const request = await cast.requestOk(clientId, [task.id]);
      const [item] = (await requestDetail(request.id)).items;
      expect(
        (
          await respond(cast.tokenOf(request), item?.id ?? '', {
            decision: 'changes_requested',
            note: 'تعديل إضافي',
          })
        ).status,
      ).toBe(200);
      const returned = await cast.detail(task.id, cast.am.cookie);
      expect(returned.overLimitPending).toBe(true);
      expect(await typesOf(cast.am.id, task.id)).toContain('task_over_limit');
    });

    it('leaves nothing behind when the response fails', async () => {
      const { first, request, token, a } = await sentPair();
      const failing = vi
        .spyOn(app.get(ApprovalNotices), 'send')
        .mockRejectedValueOnce(new Error('The notification failed'));
      try {
        expect((await respond(token, a.id, { decision: 'approved' })).status).toBe(500);
      } finally {
        failing.mockRestore();
      }
      const task = await cast.detail(first.id, cast.am.cookie);
      expect(task.status).toBe('awaiting_client');
      expect(task.clientResponses).toEqual([]);
      expect(task.pendingApproval).toMatchObject({ requestId: request.id });
      expect((await requestDetail(request.id)).counts.pending).toBe(2);
      expect((await respond(token, a.id, { decision: 'approved' })).status).toBe(200);
    });

    it('shows what the agency did with an item meanwhile', async () => {
      const { clientId, first, second, token, a, b } = await sentPair();
      // Edge case 2: withdrawn for re-review, and answered by phone.
      await cast.moveOk(first.id, cast.designManager.cookie, { status: 'internal_review' });
      await cast.moveOk(second.id, cast.am.cookie, {
        status: 'approved',
        contactId: await cast.contactOf(clientId),
      });
      const shown = await page(token);
      expect(shown.items).toMatchObject([
        { id: a.id, status: 'withdrawn', text: null, files: [], recordedByAgency: false },
        { id: b.id, status: 'approved', recordedByAgency: true },
      ]);
      await expectError(
        await respond(token, a.id, { decision: 'approved' }),
        409,
        'ITEM_WITHDRAWN',
      );
      await expectError(
        await respond(token, b.id, { decision: 'approved' }),
        409,
        'ITEM_ALREADY_DECIDED',
      );
      expect((await cast.detail(first.id, cast.am.cookie)).status).toBe('internal_review');
    });
  });

  describe('validity (rule 20)', () => {
    it('stops working when revoked, expired, or its contact or client no longer qualify', async () => {
      const expectStopped = async (
        link: Awaited<ReturnType<typeof sentPair>>,
        status: number,
        code: string,
      ) => {
        await expectError(await open(link.token), status, code);
        const answer = await respond(link.token, link.a.id, { decision: 'approved' });
        expectPublicHeaders(answer);
        await expectError(answer, status, code);
        expect((await cast.detail(link.first.id, cast.gm.cookie)).status).toBe('awaiting_client');
      };

      const revoked = await sentPair();
      expect(
        (await client.post(`/api/approvals/requests/${revoked.request.id}/revoke`, cast.am.cookie))
          .status,
      ).toBe(200);
      await expectStopped(revoked, 404, 'APPROVAL_LINK_INVALID');

      const expired = await sentPair();
      // Edge case 14: expired wins even when every item is decided.
      expect((await respond(expired.token, expired.b.id, { decision: 'approved' })).status).toBe(
        200,
      );
      await db
        .update(approvalRequests)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(approvalRequests.id, expired.request.id));
      await expectStopped(expired, 410, 'APPROVAL_LINK_EXPIRED');

      // Edge case 5: the contact loses final-approval authority.
      const demoted = await sentPair();
      const contactId = await cast.contactOf(demoted.clientId);
      const authority = (hasFinalApproval: boolean) =>
        client.request('PATCH', `/api/clients/${demoted.clientId}/contacts/${contactId}`, {
          cookie: cast.gm.cookie,
          body: { hasFinalApproval },
        });
      expect((await authority(false)).status).toBe(200);
      await expectStopped(demoted, 404, 'APPROVAL_LINK_INVALID');
      expect((await authority(true)).status).toBe(200);
      expect((await open(demoted.token)).status).toBe(200);

      // Edge case 7: the client is archived.
      expect(
        (await client.post(`/api/clients/${demoted.clientId}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(await open(demoted.token), 404, 'APPROVAL_LINK_INVALID');
    });
  });

  describe('files (rule 22)', () => {
    it('serves the versions of the link’s snapshots, and only those', async () => {
      const png = await sharp({
        create: { width: 32, height: 20, channels: 3, background: '#c00' },
      })
        .png()
        .toBuffer();
      const { id: clientId } = await cast.createClient();
      const task = await cast.taskAt('in_progress', { clientId });
      const image = versionOf(
        await addDeliverable(task.id, 'ملصق', { upload: ['poster.png', png] }),
      );
      const notes = versionOf(
        await addDeliverable(task.id, 'ملاحظات', { upload: ['notes.txt', 'نص الملاحظات'] }),
      );
      const linked = versionOf(
        await addDeliverable(task.id, 'فيديو', { url: 'https://drive.example.com/reel' }),
      );
      await app.get(FileContentService).renderPendingPreviews();
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'awaiting_client' });
      // Edge case 3: a version added after the review is not sent.
      const later = versionOf(
        await addDeliverable(task.id, 'ملصق ثانٍ', { upload: ['second.png', png] }),
      );
      const other = await cast.taskAt('in_progress', { clientId });
      const foreign = versionOf(
        await addDeliverable(other.id, 'ملف آخر', { upload: ['other.png', png] }),
      );
      const request = await cast.requestOk(clientId, [task.id]);
      const token = cast.tokenOf(request);

      const [item] = (await page(token)).items;
      const shown = Object.fromEntries(
        (item?.files ?? []).map((entry) => [entry.versionId, entry]),
      );
      expect(Object.keys(shown).sort()).toEqual([image.id, notes.id, linked.id].sort());
      expect(shown[image.id]).toMatchObject({
        name: 'ملصق',
        type: 'image',
        display: 'inline',
        previewAvailable: true,
        sizeBytes: png.length,
      });
      expect(shown[notes.id]).toMatchObject({ type: 'other', display: 'download' });
      expect(shown[linked.id]).toMatchObject({
        type: 'link',
        display: 'link',
        linkUrl: 'https://drive.example.com/reel',
        sizeBytes: null,
      });
      // The agency sees the same snapshot on the request.
      expect((await requestDetail(request.id)).items[0]?.versions.map((v) => v.id).sort()).toEqual(
        [image.id, notes.id, linked.id].sort(),
      );

      const content = await file(token, image.id, 'content');
      expect(content.status).toBe(200);
      expectPublicHeaders(content);
      expect(content.headers.get('content-type')).toBe('image/png');
      expect(content.headers.get('content-disposition')).toMatch(/^inline;/);
      expect(Buffer.from(await content.arrayBuffer()).equals(png)).toBe(true);
      for (const part of ['preview', 'thumbnail']) {
        const rendered = await file(token, image.id, part);
        expect(rendered.status).toBe(200);
        expect(rendered.headers.get('content-type')).toBe('image/webp');
        expect(rendered.headers.get('cache-control')).toBe('no-store');
      }
      // The only download: a type the browser cannot show.
      const download = await file(token, notes.id, 'content');
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('application/octet-stream');
      expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect((await file(token, notes.id, 'preview')).status).toBe(404);
      expect((await file(token, linked.id, 'content')).status).toBe(404);

      // Not in a snapshot of this request, or not through a working link.
      for (const versionId of [later.id, foreign.id, randomUUID()]) {
        expect((await file(token, versionId, 'content')).status).toBe(404);
      }
      await expectError(
        await file(randomUUID(), image.id, 'content'),
        404,
        'APPROVAL_LINK_INVALID',
      );

      // Rule 13: the approval marks exactly the versions sent as final.
      expect((await respond(token, item?.id ?? '', { decision: 'approved' })).status).toBe(200);
      const files = await client.get(
        `/api/files/items?ownerType=task&ownerId=${task.id}`,
        cast.am.cookie,
      );
      const finals = ((await files.json()) as { items: FileItem[] }).items.map((entry) => ({
        name: entry.name,
        final: entry.versions.find((version) => version.isFinal)?.finalSource ?? null,
      }));
      expect(finals).toEqual(
        expect.arrayContaining([
          { name: 'ملصق', final: 'client' },
          { name: 'ملاحظات', final: 'client' },
          { name: 'فيديو', final: 'client' },
          { name: 'ملصق ثانٍ', final: null },
        ]),
      );
      // Decided, the files stay viewable until the link expires.
      expect((await file(token, image.id, 'content')).status).toBe(200);
      await db
        .update(approvalRequests)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(approvalRequests.id, request.id));
      await expectError(await file(token, image.id, 'content'), 410, 'APPROVAL_LINK_EXPIRED');
      expect(
        await db.select().from(approvalItems).where(eq(approvalItems.requestId, request.id)),
      ).toMatchObject([{ status: 'approved' }]);
    });
  });
});
