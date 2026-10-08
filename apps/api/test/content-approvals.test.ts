import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  APPROVAL_LIMITS,
  approvalReadySchema,
  approvalRequestDetailSchema,
  type CreateApprovalRequestInput,
  clientApprovalsSchema,
  fileItemSchema,
  fileUploadSchema,
  issuedApprovalRequestSchema,
  type PostDetail,
  postPageSchema,
  publicApprovalItemSchema,
  publicApprovalItemsSchema,
  publicApprovalSchema,
} from '@vertex-hub/contracts';
import {
  approvalItems,
  approvalRequests,
  createDatabase,
  notifications,
  postClientResponses,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08 PR 2: posts in approval requests: ready posts and the month filter, mixed requests, the
 * client page with post items and "Approve all", and the pending item that follows its post.
 */
describe('posts in approval requests (F08 rules 20–27)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;

  const createRequest = (cookie: string | undefined, input: CreateApprovalRequestInput) =>
    client.post('/api/approvals/requests', cookie, input);

  /** A request for the items, to the client's final-approval contact, by its account manager. */
  async function requestOk(clientId: string, items: CreateApprovalRequestInput['items']) {
    const response = await createRequest(cast.am.cookie, {
      clientId,
      contactId: await cast.contactOf(clientId),
      items,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const issued = issuedApprovalRequestSchema.parse(await response.json());
    return { ...issued, token: issued.link.split('/a/')[1] ?? '' };
  }

  async function requestDetail(id: string, cookie = cast.am.cookie) {
    const response = await client.get(`/api/approvals/requests/${id}`, cookie);
    expect(response.status).toBe(200);
    return approvalRequestDetailSchema.parse(await response.json());
  }

  async function ready(cookie: string, query = '') {
    const response = await client.get(`/api/approvals/ready${query}`, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return approvalReadySchema.parse(await response.json());
  }

  async function page(token: string) {
    const response = await client.get(`/api/public/approvals/${token}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return publicApprovalSchema.parse(await response.json());
  }

  const respond = (token: string, itemId: string, body: unknown) =>
    client.request('POST', `/api/public/approvals/${token}/items/${itemId}/response`, { body });
  const approveAll = (token: string, body: unknown = {}) =>
    client.request('POST', `/api/public/approvals/${token}/approve-all`, { body });

  const itemOf = async (requestId: string, postId: string) => {
    const [item] = await db
      .select()
      .from(approvalItems)
      .where(and(eq(approvalItems.requestId, requestId), eq(approvalItems.postId, postId)));
    if (!item) throw new Error('The request has no item for the post');
    return item;
  };

  const responsesOf = (postId: string) =>
    db
      .select()
      .from(postClientResponses)
      .where(eq(postClientResponses.postId, postId))
      .orderBy(postClientResponses.id);

  /** A post of the writer waiting for the client, ready to send. */
  const readyPost = (clientId: string, input: Partial<Parameters<typeof cast.postAt>[1]> = {}) =>
    cast.postAt('awaiting_client', { clientId, ...input });

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-content-approvals-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    await rm(filesRoot, { recursive: true, force: true });
  });

  describe('ready to send (rule 20)', () => {
    it('lists the ready posts of a client in publish order, by month', async () => {
      const { id: clientId } = await cast.createClient();
      const later = await readyPost(clientId, { publishDate: cast.inDays(40) });
      const sooner = await readyPost(clientId, { publishDate: cast.inDays(2) });
      await cast.postAt('internal_review', { clientId });

      const [group] = (await ready(cast.am.cookie, `?clientId=${clientId}`)).clients;
      expect(group?.tasks).toEqual([]);
      expect(group?.posts.map((post) => post.id)).toEqual([sooner.id, later.id]);
      expect(group?.posts[0]).toMatchObject({
        status: 'awaiting_client',
        snapshot: { files: 0, caption: sooner.caption, thumbnailVersionId: null },
      });
      expect(group?.contacts).toEqual([]);

      const month = later.publishDate.slice(0, 7);
      const inMonth = (await ready(cast.am.cookie, `?clientId=${clientId}&month=${month}`))
        .clients[0]?.posts;
      expect(inMonth?.map((post) => post.id)).toContain(later.id);
      expect(inMonth?.every((post) => post.publishDate.startsWith(month))).toBe(true);
      expect((await client.get('/api/approvals/ready?month=2026-13', cast.am.cookie)).status).toBe(
        400,
      );
      // Another account manager has no client scope here.
      expect((await ready(cast.otherAm.cookie, `?clientId=${clientId}`)).clients).toEqual([]);

      // The post page offers sending until an open link holds the post.
      expect((await cast.detail(sooner.id, cast.am.cookie)).permissions).toMatchObject({
        canSendForApproval: true,
        canRecordResponse: true,
      });
      expect((await cast.detail(sooner.id, cast.writer.cookie)).permissions).toMatchObject({
        canSendForApproval: false,
        canRecordResponse: false,
      });
      const request = await requestOk(clientId, [{ postId: sooner.id }]);
      const sent = await cast.detail(sooner.id, cast.am.cookie);
      expect(sent.pendingApproval).toMatchObject({ requestId: request.id, state: 'open' });
      expect(sent.permissions).toMatchObject({
        canSendForApproval: false,
        canRecordResponse: true,
      });
      expect(
        (await ready(cast.am.cookie, `?clientId=${clientId}`)).clients[0]?.posts.map(
          (post) => post.id,
        ),
      ).toEqual([later.id]);
    });

    it('keeps posts and tasks ready while an open link holds an item of the other kind', async () => {
      const { id: clientId } = await cast.createClient();
      const sentTask = await cast.taskAt('awaiting_client', { clientId });
      const sentPost = await readyPost(clientId);
      await requestOk(clientId, [{ taskId: sentTask.id }]);
      await requestOk(clientId, [{ postId: sentPost.id }]);
      // A pending item holds null in the column of the other kind, which `not in` must skip.
      const task = await cast.taskAt('awaiting_client', { clientId });
      const post = await readyPost(clientId);
      const [group] = (await ready(cast.am.cookie, `?clientId=${clientId}`)).clients;
      expect(group?.tasks.map((ready) => ready.id)).toEqual([task.id]);
      expect(group?.posts.map((ready) => ready.id)).toEqual([post.id]);
    });

    it('lists the medical queue of posts', async () => {
      const { id: healthcareId } = await cast.createClient({ isHealthcare: true });
      const waiting = await cast.postAt('internal_review', { clientId: healthcareId });
      await cast.moveOk(waiting.id, cast.contentManager.cookie, { to: 'awaiting_client' });
      const response = await client.get(
        `/api/content/posts?reviewStage=medical&clientId=${healthcareId}`,
        cast.medicalReviewer.cookie,
      );
      expect(postPageSchema.parse(await response.json()).items.map((post) => post.id)).toEqual([
        waiting.id,
      ]);
    });
  });

  describe('requests (rule 21)', () => {
    it('mixes tasks and posts in the order given', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.taskAt('awaiting_client', { clientId });
      const post = await readyPost(clientId, { type: 'carousel', hashtags: '#خريف' });
      const request = await requestOk(clientId, [
        { postId: post.id, title: 'منشور الافتتاح' },
        { taskId: task.id },
      ]);
      expect(request.counts).toMatchObject({ total: 2, pending: 2 });
      expect(request.items).toMatchObject([
        {
          position: 1,
          kind: 'post',
          title: 'منشور الافتتاح',
          task: null,
          post: {
            id: post.id,
            title: post.title,
            type: 'carousel',
            platforms: post.platforms,
            publishDate: post.publishDate,
            publishTime: post.publishTime,
            caption: post.caption,
            hashtags: '#خريف',
          },
          text: null,
          status: 'pending',
        },
        { position: 2, kind: 'task', title: task.title, task: { id: task.id }, post: null },
      ]);
      const stored = await itemOf(request.id, post.id);
      expect(stored).toMatchObject({
        taskId: null,
        reviewId: null,
        postReviewId: post.clearedReview?.id,
      });
      expect((await cast.auditOf(request.id)).at(0)).toMatchObject({
        action: 'approval_request.created',
        after: { taskIds: [task.id], postIds: [post.id] },
      });
      // Everyone reads the request.
      expect((await requestDetail(request.id, cast.employee.cookie)).items).toHaveLength(2);
    });

    it('refuses posts that are not ready, and more than 60 items', async () => {
      const { id: clientId } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const create = (items: CreateApprovalRequestInput['items'], cookie = cast.am.cookie) =>
        createRequest(cookie, { clientId, contactId, items });
      const sent = await readyPost(clientId);
      const inReview = await cast.postAt('internal_review', { clientId });
      const foreign = await readyPost((await cast.createClient()).id);

      expect((await create([{ postId: sent.id }], cast.writer.cookie)).status).toBe(403);
      expect((await create([{ postId: sent.id }], cast.otherAm.cookie)).status).toBe(403);
      for (const post of [inReview, foreign]) {
        const response = await create([{ postId: sent.id }, { postId: post.id }]);
        const body = (await response.clone().json()) as { details: unknown };
        await expectError(response, 409, 'POST_NOT_READY');
        expect(body.details).toEqual({ postId: post.id });
      }
      await expectError(await create([{ postId: randomUUID() }]), 409, 'POST_NOT_READY');
      expect((await create([{ postId: sent.id, taskId: randomUUID() }] as never)).status).toBe(400);
      const many = Array.from({ length: APPROVAL_LIMITS.items + 1 }, () => ({
        postId: randomUUID(),
      }));
      await expectError(await create(many), 409, 'LIMIT_REACHED');

      // A post waits on one open link at a time; an expired link lets it go again.
      const first = await requestOk(clientId, [{ postId: sent.id }]);
      await expectError(await create([{ postId: sent.id }]), 409, 'POST_NOT_READY');
      await db
        .update(approvalRequests)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(approvalRequests.id, first.id));
      const second = await requestOk(clientId, [{ postId: sent.id }]);
      expect(await itemOf(first.id, sent.id)).toMatchObject({
        status: 'withdrawn',
        withdrawnReason: 'resent',
      });
      expect((await itemOf(second.id, sent.id)).status).toBe('pending');
    });

    it('needs the medical pass of a healthcare client’s post (rules 20 and 26)', async () => {
      const { id: clientId } = await cast.createClient();
      const sent = await readyPost(clientId);
      const waiting = await readyPost(clientId);
      const request = await requestOk(clientId, [{ postId: sent.id }]);

      // The client becomes healthcare: the unsent post goes to the medical stage, the sent one
      // stays with the client.
      const flagged = await client.request('PATCH', `/api/clients/${clientId}`, {
        cookie: cast.gm.cookie,
        body: { isHealthcare: true },
      });
      expect(flagged.status, await flagged.clone().text()).toBe(200);
      expect(await cast.detail(waiting.id, cast.gm.cookie)).toMatchObject({
        status: 'internal_review',
        reviewStage: 'medical',
      });
      expect((await cast.detail(sent.id, cast.gm.cookie)).status).toBe('awaiting_client');

      // Once its link is revoked it is not ready without a medical pass.
      const revoked = await client.post(
        `/api/approvals/requests/${request.id}/revoke`,
        cast.am.cookie,
      );
      expect(revoked.status).toBe(200);
      expect((await cast.detail(sent.id, cast.am.cookie)).permissions.canSendForApproval).toBe(
        false,
      );
      await expectError(
        await createRequest(cast.am.cookie, {
          clientId,
          contactId: await cast.contactOf(clientId),
          items: [{ postId: sent.id }],
        }),
        409,
        'MEDICAL_REVIEW_REQUIRED',
      );
    });
  });

  describe('the client page (rules 22, 23 and 27)', () => {
    /** An uploaded text file on the post, by the writer. */
    async function addUpload(postId: string, name: string) {
      const form = new FormData();
      form.append('file', new Blob(['نص']), 'caption.txt');
      const uploaded = await fetch(`${url}/api/files/uploads`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie: cast.writer.cookie },
        body: form,
      });
      expect(uploaded.status, await uploaded.clone().text()).toBe(201);
      const response = await client.post('/api/files/items', cast.writer.cookie, {
        ownerType: 'post',
        ownerId: postId,
        role: 'deliverable',
        name,
        source: { uploadId: fileUploadSchema.parse(await uploaded.json()).uploadId },
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return fileItemSchema.parse(await response.json());
    }

    /** A post with an uploaded file, reviewed and waiting for the client. */
    async function readyPostWithFile(clientId: string, input: { publishDate: string }) {
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        notes: 'ملاحظة داخلية',
        publishTime: '09:00',
        ...input,
      });
      const file = await addUpload(post.id, `صورة ${cast.run}`);
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      const sent = await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'awaiting_client',
      });
      return { post: sent, versionId: file.versions[0]?.id ?? '' };
    }

    it('shows the content plan in publish order after the tasks, and serves its media', async () => {
      const { id: clientId } = await cast.createClient();
      const { post: later, versionId } = await readyPostWithFile(clientId, {
        publishDate: cast.inDays(6),
      });
      const sooner = await readyPost(clientId, { publishDate: cast.inDays(3) });
      const task = await cast.taskAt('awaiting_client', { clientId });
      const outside = await readyPostWithFile(clientId, { publishDate: cast.inDays(8) });
      const { token } = await requestOk(clientId, [
        { postId: later.id },
        { postId: sooner.id },
        { taskId: task.id },
      ]);

      const response = await client.get(`/api/public/approvals/${token}`);
      const raw = await response.clone().text();
      const shown = publicApprovalSchema.parse(await response.json());
      expect(shown.items.map(({ kind, title }) => ({ kind, title }))).toEqual([
        { kind: 'task', title: task.title },
        { kind: 'post', title: sooner.title },
        { kind: 'post', title: later.title },
      ]);
      expect(shown.items[2]).toMatchObject({
        text: null,
        post: {
          type: 'post',
          platforms: ['instagram'],
          publishDate: later.publishDate,
          publishTime: '09:00',
          caption: later.caption,
          hashtags: null,
        },
        files: [{ versionId, kind: 'upload', display: 'download' }],
        status: 'pending',
      });
      expect(shown.items[0]?.post).toBeNull();
      // Nothing internal: neither the notes nor the people.
      expect(raw).not.toContain('ملاحظة داخلية');
      expect(raw).not.toContain(cast.writer.name);
      expect(raw).not.toContain(`صورة ${cast.run}`);

      const file = (id: string) =>
        client.get(`/api/public/approvals/${token}/versions/${id}/content`);
      expect((await file(versionId)).status).toBe(200);
      // A version of a post the link does not hold is not served.
      expect((await file(outside.versionId)).status).toBe(404);
    });

    it('records one decision per post: approved, or back to production with the note', async () => {
      const { id: clientId } = await cast.createClient();
      const kept = await readyPost(clientId);
      const changed = await readyPost(clientId);
      const request = await requestOk(clientId, [{ postId: kept.id }, { postId: changed.id }]);
      const [a, b] = request.items;
      if (!a || !b) throw new Error('The request has no items');
      const contact = `جهة اتصال ${cast.run}`;

      expect((await respond(request.token, b.id, { decision: 'changes_requested' })).status).toBe(
        400,
      );
      const approved = await respond(request.token, a.id, { decision: 'approved' });
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(publicApprovalItemSchema.parse(await approved.json())).toMatchObject({
        id: a.id,
        kind: 'post',
        status: 'approved',
        recordedByAgency: false,
      });
      const post = await cast.detail(kept.id, cast.am.cookie);
      expect(post.status).toBe('approved');
      expect(post.pendingApproval).toBeNull();
      expect(post.clientResponses).toMatchObject([
        { decision: 'approved', channel: 'link', contact: { name: contact }, recordedBy: null },
      ]);
      const [stored] = await responsesOf(kept.id);
      expect(stored).toMatchObject({
        approvalItemId: a.id,
        reviewId: kept.clearedReview?.id,
        recordedById: null,
        userAgent: 'node',
      });
      expect(await itemOf(request.id, kept.id)).toMatchObject({
        status: 'approved',
        postResponseId: stored?.id,
        responseId: null,
      });
      expect((await cast.auditOf(kept.id)).slice(-2)).toMatchObject([
        {
          action: 'post.status_changed',
          actorId: null,
          actorName: contact,
          before: { status: 'awaiting_client' },
          after: { status: 'approved', via: 'approval_link' },
        },
        { action: 'post.client_response_recorded', actorId: null, actorName: contact },
      ]);
      expect((await cast.auditOf(request.id)).at(-1)).toMatchObject({
        action: 'approval_item.responded',
        after: { itemId: a.id, postId: kept.id, decision: 'approved', via: 'approval_link' },
      });
      expect(await cast.typesOf(cast.writer.id, kept.id)).toContain('post_approved');
      await expectError(
        await respond(request.token, a.id, { decision: 'approved' }),
        409,
        'ITEM_ALREADY_DECIDED',
      );

      const asked = await respond(request.token, b.id, {
        decision: 'changes_requested',
        note: 'غيّروا الصورة',
      });
      expect(asked.status, await asked.clone().text()).toBe(200);
      const returned = await cast.detail(changed.id, cast.writer.cookie);
      expect(returned.status).toBe('in_production');
      expect(returned.clientResponses.at(-1)).toMatchObject({
        decision: 'changes_requested',
        note: 'غيّروا الصورة',
      });
      expect(await cast.typesOf(cast.writer.id, changed.id)).toContain('post_returned');

      // The request is complete, and its two answers reached the account manager as one notice.
      expect((await requestDetail(request.id)).state).toBe('completed');
      const notices = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, cast.am.id), eq(notifications.subjectId, request.id)),
        );
      expect(notices).toMatchObject([{ type: 'approval_responded', count: 2 }]);

      // The client's history lists the answers on posts beside those on tasks.
      const history = await client.get(`/api/clients/${clientId}/approvals`, cast.am.cookie);
      expect(clientApprovalsSchema.parse(await history.json()).responses).toMatchObject({
        total: 2,
        items: [
          { kind: 'post', task: null, post: { id: changed.id }, decision: 'changes_requested' },
          { kind: 'post', task: null, post: { id: kept.id }, decision: 'approved' },
        ],
      });
    });

    it('approves every pending post at once, never the tasks (rule 23)', async () => {
      const { id: clientId } = await cast.createClient();
      const posts: PostDetail[] = [];
      for (let index = 0; index < 3; index++) posts.push(await readyPost(clientId));
      const task = await cast.taskAt('awaiting_client', { clientId });
      const request = await requestOk(clientId, [
        { taskId: task.id },
        ...posts.map((post) => ({ postId: post.id })),
      ]);
      // One was answered on its own first.
      const first = request.items[1];
      expect(
        (
          await respond(request.token, first?.id ?? '', {
            decision: 'changes_requested',
            note: 'عدّلوا النص',
          })
        ).status,
      ).toBe(200);

      expect((await approveAll('not-a-token')).status).toBe(404);
      const response = await approveAll(request.token, { note: 'ممتاز' });
      expect(response.status, await response.clone().text()).toBe(200);
      const { items } = publicApprovalItemsSchema.parse(await response.json());
      expect(items.map(({ id, status, note }) => ({ id, status, note }))).toEqual(
        request.items.slice(2).map((item) => ({ id: item.id, status: 'approved', note: 'ممتاز' })),
      );
      for (const post of posts.slice(1)) {
        expect((await cast.detail(post.id, cast.gm.cookie)).status).toBe('approved');
        expect(await responsesOf(post.id)).toMatchObject([
          { decision: 'approved', channel: 'link', note: 'ممتاز' },
        ]);
      }
      expect((await cast.detail(posts[0]?.id ?? '', cast.gm.cookie)).status).toBe('in_production');

      // The task still waits, so the request stays open; nothing is left to approve at once.
      const after = await page(request.token);
      expect(after.items.map((item) => item.status)).toEqual([
        'pending',
        'changes_requested',
        'approved',
        'approved',
      ]);
      expect(
        publicApprovalItemsSchema.parse(await (await approveAll(request.token)).json()).items,
      ).toEqual([]);

      await db
        .update(approvalRequests)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(approvalRequests.id, request.id));
      await expectError(await approveAll(request.token), 410, 'APPROVAL_LINK_EXPIRED');
    });
  });

  describe('the pending item follows its post (rules 24 and 25)', () => {
    it('closes the item with a response recorded by hand', async () => {
      const { id: clientId } = await cast.createClient();
      const post = await readyPost(clientId);
      const request = await requestOk(clientId, [{ postId: post.id }]);
      await cast.moveOk(post.id, cast.am.cookie, { to: 'approved' });

      const [response] = await responsesOf(post.id);
      const item = await itemOf(request.id, post.id);
      expect(response).toMatchObject({ channel: 'manual', approvalItemId: item.id });
      expect(item).toMatchObject({ status: 'approved', postResponseId: response?.id });
      expect((await requestDetail(request.id)).state).toBe('completed');
      const shown = await client.get(`/api/public/approvals/${request.token}`);
      expect(publicApprovalSchema.parse(await shown.json()).items[0]).toMatchObject({
        status: 'approved',
        recordedByAgency: true,
      });
    });

    it('withdraws the item when the post leaves the client otherwise', async () => {
      const { id: clientId } = await cast.createClient();
      const withdrawn = await readyPost(clientId);
      const cancelled = await readyPost(clientId);
      const archived = await readyPost(clientId);
      const request = await requestOk(
        clientId,
        [withdrawn, cancelled, archived].map((post) => ({ postId: post.id })),
      );

      await cast.moveOk(withdrawn.id, cast.contentManager.cookie, { to: 'internal_review' });
      await cast.moveOk(cancelled.id, cast.writer.cookie, { to: 'cancelled', reason: 'أُلغي' });
      const archive = await client.post(
        `/api/content/posts/${archived.id}/archive`,
        cast.contentManager.cookie,
      );
      expect(archive.status, await archive.clone().text()).toBe(204);

      for (const post of [withdrawn, cancelled, archived]) {
        expect(await itemOf(request.id, post.id)).toMatchObject({
          status: 'withdrawn',
          withdrawnReason: 'post_moved',
        });
      }
      expect((await cast.auditOf(request.id)).at(-1)).toMatchObject({
        action: 'approval_item.withdrawn',
        after: { postId: archived.id, reason: 'post_moved' },
      });
      // The client sees the items withdrawn, without their content.
      const shown = await page(request.token);
      expect(shown.items.map(({ status, post, files }) => ({ status, post, files }))).toEqual(
        shown.items.map(() => ({ status: 'withdrawn', post: null, files: [] })),
      );
      await expectError(
        await respond(request.token, shown.items[0]?.id ?? '', { decision: 'approved' }),
        409,
        'ITEM_WITHDRAWN',
      );
    });
  });
});
