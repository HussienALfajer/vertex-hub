import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  businessDate,
  contentCalendarSchema,
  cyclePageSchema,
  fileItemSchema,
  linkableTaskListSchema,
  POST_LIMITS,
  type PostDetail,
  postDetailSchema,
  postTaskDueDate,
  taskPageSchema,
} from '@vertex-hub/contracts';
import { createDatabase, taskRevisions, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostNotices } from '../src/modules/content/post-notices.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08 PR 2: tasks linked to posts: linking, unlinking and requesting a task, the F06 refusals on
 * a linked task, the media of linked tasks, sending a task back, counting once and publishing,
 * which delivers the linked tasks.
 */
describe('tasks linked to posts (F08 rules 5–10, 12, 16, 18, 19)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;

  const posts = '/api/content/posts';
  const link = (postId: string, taskId: string, cookie?: string) =>
    client.request('PUT', `${posts}/${postId}/tasks/${taskId}`, { cookie });
  const unlink = (postId: string, taskId: string, cookie?: string) =>
    client.request('DELETE', `${posts}/${postId}/tasks/${taskId}`, { cookie });
  const requestTask = (postId: string, cookie: string | undefined, body: unknown) =>
    client.post(`${posts}/${postId}/tasks`, cookie, body);
  const sendBack = (postId: string, taskId: string, cookie: string | undefined, body: unknown) =>
    client.post(`${posts}/${postId}/tasks/${taskId}/return`, cookie, body);
  const linkable = (postId: string, cookie?: string, query = '') =>
    client.get(`${posts}/${postId}/linkable-tasks${query}`, cookie);
  const patchTask = (id: string, cookie: string, body: unknown) =>
    client.request('PATCH', `/api/tasks/${id}`, { cookie, body });

  async function ok(response: Response): Promise<PostDetail> {
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return postDetailSchema.parse(await response.json());
  }

  const taskRow = async (id: string) => {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw new Error(`Task ${id} not found`);
    return row;
  };

  /** A Design task of the designer in progress, linked to the post by the writer. */
  async function linkedTask(postId: string, input: { clientId?: string } = {}) {
    const task = await cast.taskAt('in_progress', { clientId, ...input });
    await ok(await link(postId, task.id, cast.writer.cookie));
    return task;
  }

  /** The linked task approved by its department: no client step is offered. */
  async function approve(taskId: string) {
    await cast.task.moveOk(taskId, cast.designer.cookie, { status: 'internal_review' });
    return cast.task.moveOk(taskId, cast.designManager.cookie, { status: 'approved' });
  }

  /** A link deliverable on the task, added by the designer. */
  async function addDeliverable(taskId: string, name: string) {
    const response = await client.post('/api/files/items', cast.designer.cookie, {
      ownerType: 'task',
      ownerId: taskId,
      role: 'deliverable',
      name,
      source: { url: `https://drive.example.com/${randomUUID()}` },
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileItemSchema.parse(await response.json());
  }

  /** The reel line of the open cycle of a new retainer of the client. */
  async function reelLine(ofClientId = clientId) {
    const retainer = await cast.createRetainer(ofClientId);
    const read = async () => {
      const response = await client.get(`/api/retainers/${retainer.id}/cycles`, cast.gm.cookie);
      const [cycle] = cyclePageSchema.parse(await response.json()).items;
      const line = cycle?.lines.find((item) => item.kind === 'reel');
      if (!cycle || !line) throw new Error('The retainer has no open cycle');
      return { cycle, line };
    };
    return { ...(await read()), read };
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

  it('requires a session on every route', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      linkable(id),
      link(id, id),
      unlink(id, id),
      requestTask(id, undefined, { department: 'design' }),
      sendBack(id, id, undefined, { note: 'تعديل' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 401));
  });

  describe('linking (rules 6 and 7)', () => {
    it('links a task of the client: the post starts production and the client approves the post', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await cast.taskAt('in_progress', { clientId });
      expect(task.needsClientApproval).toBe(true);

      // A designer holds no `content.manage`; another client's account manager no edit scope.
      expect((await link(post.id, task.id, cast.designer.cookie)).status).toBe(403);
      expect((await link(post.id, task.id, cast.otherAm.cookie)).status).toBe(403);
      expect((await link(post.id, randomUUID(), cast.writer.cookie)).status).toBe(404);
      expect((await link(randomUUID(), task.id, cast.writer.cookie)).status).toBe(404);

      const linked = await ok(await link(post.id, task.id, cast.writer.cookie));
      expect(linked.status).toBe('in_production');
      expect(linked.linkedTaskCount).toBe(1);
      expect(linked.linkedTasks).toEqual([
        {
          id: task.id,
          title: task.title,
          department: 'design',
          assignee: { id: cast.designer.id, name: cast.designer.name, archived: false },
          status: 'in_progress',
          cycleLine: null,
        },
      ]);
      const read = await cast.task.detail(task.id, cast.gm.cookie);
      expect(read).toMatchObject({ postId: post.id, needsClientApproval: false });

      // Linking it again changes nothing.
      await ok(await link(post.id, task.id, cast.writer.cookie));
      const audit = await cast.auditOf(post.id);
      expect(audit.filter((entry) => entry.action === 'post.task_linked')).toHaveLength(1);
      expect(audit.at(-1)).toMatchObject({
        action: 'post.status_changed',
        before: { status: 'idea' },
        after: { status: 'in_production', reason: 'task_linked' },
      });
      expect((await cast.auditOf(task.id)).at(-1)).toMatchObject({
        action: 'task.updated',
        before: { postId: null, needsClientApproval: true },
        after: { postId: post.id, needsClientApproval: false },
      });

      // The calendar card counts it.
      const today = businessDate();
      const response = await client.get(
        `/api/content/calendar?from=${today}&to=${cast.inDays(10)}&clientId=${clientId}`,
        cast.employee.cookie,
      );
      const card = contentCalendarSchema
        .parse(await response.json())
        .posts.find((item) => item.id === post.id);
      expect(card?.linkedTaskCount).toBe(1);
    });

    it('refuses tasks linked elsewhere, of another client, closed or with the client', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const other = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await linkedTask(other.id);
      await expectError(
        await link(post.id, task.id, cast.writer.cookie),
        409,
        'TASK_ALREADY_LINKED',
      );

      const foreign = await cast.taskAt('in_progress');
      const delivered = await cast.taskAt('delivered', { clientId });
      const sent = await cast.taskAt('awaiting_client', { clientId });
      const cancelled = await cast.taskAt('in_progress', { clientId });
      await cast.task.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'أُلغيت',
      });
      for (const refused of [foreign, delivered, sent, cancelled]) {
        await expectError(
          await link(post.id, refused.id, cast.writer.cookie),
          409,
          'TASK_NOT_LINKABLE',
        );
      }
      expect((await cast.detail(post.id, cast.gm.cookie)).linkedTasks).toEqual([]);
    });

    it('links at most 5 tasks, and only while the content is unlocked', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const create = () => cast.createTask(cast.designManager.cookie, { clientId });
      for (let index = 0; index < POST_LIMITS.tasks; index++) {
        await ok(await link(post.id, (await create()).id, cast.writer.cookie));
      }
      const sixth = await create();
      await expectError(await link(post.id, sixth.id, cast.writer.cookie), 409, 'LIMIT_REACHED');
      await expectError(
        await requestTask(post.id, cast.writer.cookie, { department: 'design' }),
        409,
        'LIMIT_REACHED',
      );

      const reviewed = await cast.postAt('internal_review', { clientId });
      await expectError(await link(reviewed.id, sixth.id, cast.writer.cookie), 409, 'POST_LOCKED');
      await expectError(
        await requestTask(reviewed.id, cast.writer.cookie, { department: 'design' }),
        409,
        'POST_LOCKED',
      );
    });

    it('offers the open unlinked tasks of the client, the publish cycle first', async () => {
      const { id: ownClient } = await cast.createClient();
      const { cycle, line } = await reelLine(ownClient);
      const post = await cast.createPost(cast.writer.cookie, {
        clientId: ownClient,
        publishDate: businessDate(),
      });
      const plain = await cast.createTask(cast.designManager.cookie, {
        clientId: ownClient,
        title: `تصوير حر ${cast.run}`,
        department: 'photography',
        dueDate: cast.inDays(1),
      });
      const inCycle = await cast.createTask(cast.designManager.cookie, {
        clientId: ownClient,
        title: `ريل الشهر ${cast.run}`,
        dueDate: cast.inDays(4),
        retainerCycleId: cycle.id,
        cycleLineId: line.id,
      });
      const linked = await cast.createTask(cast.designManager.cookie, { clientId: ownClient });
      const elsewhere = await cast.createPost(cast.writer.cookie, { clientId: ownClient });
      await ok(await link(elsewhere.id, linked.id, cast.writer.cookie));
      await cast.taskAt('delivered', { clientId: ownClient });
      await cast.createTask(cast.designManager.cookie, { clientId });

      expect((await linkable(post.id, cast.designer.cookie)).status).toBe(403);
      expect((await linkable(post.id, cast.otherAm.cookie)).status).toBe(403);
      const offered = async (query = '') => {
        const response = await linkable(post.id, cast.writer.cookie, query);
        expect(response.status, await response.clone().text()).toBe(200);
        return linkableTaskListSchema.parse(await response.json()).items;
      };
      expect((await offered()).map(({ id, inPublishCycle }) => ({ id, inPublishCycle }))).toEqual([
        { id: inCycle.id, inPublishCycle: true },
        { id: plain.id, inPublishCycle: false },
      ]);
      expect((await offered('?department=photography')).map((item) => item.id)).toEqual([plain.id]);
      expect(
        (await offered(`?q=${encodeURIComponent('ريل الشهر')}`)).map((item) => item.id),
      ).toEqual([inCycle.id]);
    });
  });

  describe('a linked task in F06 (rule 7, edge cases 2 and 7)', () => {
    it('is approved by its department only, and delivered and answered through the post', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await linkedTask(post.id);
      const approved = await approve(task.id);
      expect(approved.status).toBe('approved');
      // The post's responsible person hears that the work is ready.
      expect(await cast.typesOf(cast.writer.id, post.id)).toContain('post_task_ready');

      const contactId = await cast.contactOf(clientId);
      await expectError(
        await cast.task.move(task.id, cast.designer.cookie, { status: 'delivered' }),
        409,
        'LINKED_TO_POST',
      );
      await expectError(
        await cast.task.move(task.id, cast.am.cookie, {
          status: 'revisions',
          note: 'العميل يريد تعديلاً',
          contactId,
        }),
        409,
        'LINKED_TO_POST',
      );
      await expectError(
        await patchTask(task.id, cast.designManager.cookie, { needsClientApproval: true }),
        409,
        'LINKED_TO_POST',
      );
      await expectError(
        await patchTask(task.id, cast.gm.cookie, {
          clientId: (await cast.createClient()).id,
        }),
        409,
        'LINKED_TO_POST',
      );
      // Other fields still change.
      expect(
        (await patchTask(task.id, cast.designManager.cookie, { priority: 'high' })).status,
      ).toBe(200);

      const read = await cast.task.detail(task.id, cast.am.cookie);
      expect(read.allowedTransitions).not.toContain('delivered');
      expect(read.allowedTransitions).not.toContain('revisions');
      expect(read.permissions.canRecordClientResponse).toBe(false);

      const listed = async (query: string) => {
        const response = await client.get(
          `/api/tasks?clientId=${clientId}&${query}`,
          cast.gm.cookie,
        );
        return taskPageSchema.parse(await response.json()).items.map((item) => item.id);
      };
      expect(await listed('linkedToPost=true')).toContain(task.id);
      expect(await listed('linkedToPost=false')).not.toContain(task.id);
    });
  });

  describe('unlinking (rule 8)', () => {
    it('frees the task, with its client approval back unless it is approved', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const open = await linkedTask(post.id);
      const done = await linkedTask(post.id);
      await approve(done.id);

      expect((await unlink(post.id, open.id, cast.designer.cookie)).status).toBe(403);
      expect((await unlink(post.id, open.id, cast.otherAm.cookie)).status).toBe(403);
      expect((await unlink(post.id, randomUUID(), cast.writer.cookie)).status).toBe(404);

      const after = await ok(await unlink(post.id, open.id, cast.writer.cookie));
      expect(after.linkedTasks.map((task) => task.id)).toEqual([done.id]);
      expect(await taskRow(open.id)).toMatchObject({
        postId: null,
        postLinkedAt: null,
        needsClientApproval: true,
      });
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.task_unlinked',
        after: { taskId: open.id },
      });
      // Not linked any more: 404.
      expect((await unlink(post.id, open.id, cast.writer.cookie)).status).toBe(404);

      await ok(await unlink(post.id, done.id, cast.writer.cookie));
      expect(await taskRow(done.id)).toMatchObject({ postId: null, needsClientApproval: false });
      // An approved task without a post is delivered by hand again.
      expect(
        (await cast.task.move(done.id, cast.designer.cookie, { status: 'delivered' })).status,
      ).toBe(200);
    });

    it('is refused once the post left production', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await linkedTask(post.id);
      await approve(task.id);
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await expectError(await unlink(post.id, task.id, cast.writer.cookie), 409, 'POST_LOCKED');
    });

    it('unlinks a cancelled or archived task and tells the responsible person', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const cancelled = await linkedTask(post.id);
      const archived = await linkedTask(post.id);

      await cast.task.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'لم تعد مطلوبة',
      });
      const archive = await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie);
      expect(archive.status, await archive.clone().text()).toBe(200);

      expect((await cast.detail(post.id, cast.gm.cookie)).linkedTasks).toEqual([]);
      expect(await taskRow(cancelled.id)).toMatchObject({ postId: null, status: 'cancelled' });
      expect((await taskRow(archived.id)).postId).toBeNull();
      const unlinked = (await cast.auditOf(post.id)).filter(
        (entry) => entry.action === 'post.task_unlinked',
      );
      expect(unlinked.map((entry) => entry.after)).toEqual([
        { taskId: cancelled.id, title: cancelled.title, reason: 'cancelled' },
        { taskId: archived.id, title: archived.title, reason: 'archived' },
      ]);
      expect(
        (await cast.typesOf(cast.writer.id, post.id)).filter(
          (type) => type === 'post_task_unlinked',
        ),
      ).toHaveLength(2);
    });
  });

  describe('requesting a task (rule 9)', () => {
    it('creates a request in the department queue from the post, linked to it', async () => {
      const publishDate = cast.inDays(9);
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        type: 'carousel',
        title: `عروض الخريف ${cast.run}`,
        notes: 'ثلاث شرائح',
        caption: 'خصومات الخريف بدأت',
        publishDate,
      });
      expect(
        (await requestTask(post.id, cast.designer.cookie, { department: 'design' })).status,
      ).toBe(403);
      expect(
        (await requestTask(post.id, cast.otherAm.cookie, { department: 'design' })).status,
      ).toBe(403);
      expect((await requestTask(post.id, cast.writer.cookie, {})).status).toBe(400);
      await expectError(
        await requestTask(post.id, cast.writer.cookie, {
          department: 'design',
          dueDate: cast.inDays(-1),
        }),
        400,
        'INVALID_DATES',
      );

      const response = await requestTask(post.id, cast.writer.cookie, { department: 'design' });
      expect(response.status, await response.clone().text()).toBe(201);
      const requested = postDetailSchema.parse(await response.json());
      expect(requested.status).toBe('in_production');
      const [linked] = requested.linkedTasks;
      expect(linked).toMatchObject({
        title: `كاروسيل: عروض الخريف ${cast.run}`,
        department: 'design',
        assignee: null,
        status: 'new',
      });
      const task = await cast.task.detail(linked?.id ?? '', cast.gm.cookie);
      expect(task).toMatchObject({
        postId: post.id,
        brief: 'ثلاث شرائح\n\nخصومات الخريف بدأت',
        dueDate: postTaskDueDate(publishDate),
        needsClientApproval: false,
        client: { id: clientId },
        createdBy: { id: cast.writer.id },
      });
      // F06: the department's manager hears about the request.
      expect(await cast.typesOf(cast.designManager.id, task.id)).toContain('task_requested');
      expect((await cast.auditOf(post.id)).map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['post.task_linked', 'post.status_changed']),
      );

      // The title, the brief and the due date may be given.
      const custom = await ok(
        await requestTask(post.id, cast.writer.cookie, {
          department: 'photography',
          title: 'تصوير المنتجات',
          brief: 'في الاستوديو',
          dueDate: cast.inDays(2),
        }),
      );
      expect(custom.linkedTasks[1]).toMatchObject({
        title: 'تصوير المنتجات',
        department: 'photography',
      });
    });

    it('takes a line of an open cycle of the client, unless the post counts itself', async () => {
      const { id: ownClient } = await cast.createClient();
      const { line } = await reelLine(ownClient);
      const post = await cast.createPost(cast.writer.cookie, { clientId: ownClient, type: 'reel' });
      await expectError(
        await requestTask(post.id, cast.writer.cookie, {
          department: 'photography',
          cycleLineId: randomUUID(),
        }),
        400,
        'INVALID_LINK',
      );
      const requested = await ok(
        await requestTask(post.id, cast.writer.cookie, {
          department: 'photography',
          cycleLineId: line.id,
        }),
      );
      expect(requested.linkedTasks[0]?.cycleLine).toMatchObject({ id: line.id, kind: 'reel' });

      const counted = await cast.createPost(cast.writer.cookie, {
        clientId: ownClient,
        type: 'reel',
        cycleLineId: line.id,
      });
      await expectError(
        await requestTask(counted.id, cast.writer.cookie, {
          department: 'photography',
          cycleLineId: line.id,
        }),
        409,
        'POST_COUNTED_BY_TASK',
      );
    });
  });

  describe('media and review (rules 5 and 10)', () => {
    it('shows the final files of approved linked tasks after the post’s own', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId, caption: null });
      const task = await linkedTask(post.id);
      const design = await addDeliverable(task.id, `تصميم ${cast.run}`);

      // Not approved yet: its deliverable is no media, and the post cannot be submitted.
      expect((await cast.detail(post.id, cast.gm.cookie)).media).toEqual([]);
      const refused = await cast.move(post.id, cast.writer.cookie, { to: 'internal_review' });
      await expectError(refused.clone(), 409, 'NOTHING_TO_APPROVE');

      const own = await cast.addFileOk(post.id, `صورة ${cast.run}`);
      const waiting = await cast.move(post.id, cast.writer.cookie, { to: 'internal_review' });
      const body = (await waiting.clone().json()) as { details: unknown };
      await expectError(waiting, 409, 'POST_TASKS_NOT_READY');
      expect(body.details).toEqual([{ id: task.id, title: task.title, status: 'in_progress' }]);

      await approve(task.id);
      const ready = await cast.detail(post.id, cast.gm.cookie);
      expect(ready.media.map(({ fileItemId, task: from }) => ({ fileItemId, from }))).toEqual([
        { fileItemId: own.id, from: null },
        { fileItemId: design.id, from: { id: task.id, title: task.title } },
      ]);

      const submitted = await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      const passed = await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'awaiting_client',
      });
      expect(submitted.contentToken).toBe(ready.contentToken);
      // The snapshot holds the media in display order.
      expect(passed.clearedReview?.versions.map((version) => version.fileItemId)).toEqual([
        own.id,
        design.id,
      ]);
    });
  });

  describe('sending a task back (rule 12)', () => {
    it('records a client revision once per client response, an internal one otherwise', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await linkedTask(post.id);
      await approve(task.id);

      expect(
        (await sendBack(post.id, task.id, cast.designer.cookie, { note: 'تعديل' })).status,
      ).toBe(403);
      expect(
        (await sendBack(post.id, task.id, cast.otherAm.cookie, { note: 'تعديل' })).status,
      ).toBe(403);
      expect((await sendBack(post.id, task.id, cast.writer.cookie, {})).status).toBe(400);
      expect(
        (await sendBack(post.id, randomUUID(), cast.writer.cookie, { note: 'تعديل' })).status,
      ).toBe(404);

      // Nobody answered yet: an internal revision, not counted.
      await ok(await sendBack(post.id, task.id, cast.writer.cookie, { note: 'الألوان باهتة' }));
      let read = await cast.task.detail(task.id, cast.gm.cookie);
      expect(read.status).toBe('revisions');
      expect(read.revisions.clientCount).toBe(0);
      expect(read.revisionHistory.at(-1)).toMatchObject({
        source: 'internal',
        number: null,
        note: 'الألوان باهتة',
        author: { id: cast.writer.id },
      });
      expect((await cast.auditOf(task.id)).at(-1)).toMatchObject({
        action: 'task.status_changed',
        before: { status: 'approved' },
        after: { status: 'revisions', reason: 'post_return', postId: post.id },
      });
      // Already in revisions: nothing to send back.
      await expectError(
        await sendBack(post.id, task.id, cast.writer.cookie, { note: 'مرة أخرى' }),
        409,
        'INVALID_TRANSITION',
      );

      // The task is fixed and approved again, the post reviewed, and the client asks for changes.
      const fix = async () => {
        await cast.task.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
        await cast.task.moveOk(task.id, cast.designManager.cookie, { status: 'approved' });
      };
      await fix();
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'awaiting_client' });
      const contactId = await cast.contactOf(clientId);
      const returned = await cast.moveOk(post.id, cast.am.cookie, {
        to: 'in_production',
        note: 'العميل يريد شعاراً أكبر',
        contactId,
      });
      const responseId = returned.clientResponses.at(-1)?.id;

      await ok(await sendBack(post.id, task.id, cast.writer.cookie, { note: 'كبّروا الشعار' }));
      read = await cast.task.detail(task.id, cast.gm.cookie);
      expect(read.revisions.clientCount).toBe(1);
      expect(read.revisionHistory.at(-1)).toMatchObject({
        source: 'client',
        number: 1,
        contact: { id: contactId },
        author: { id: cast.writer.id },
      });
      const [revision] = await db
        .select()
        .from(taskRevisions)
        .where(eq(taskRevisions.id, read.revisionHistory.at(-1)?.id ?? ''));
      expect(revision?.postResponseId).toBe(responseId);
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.task_returned',
        after: { taskId: task.id, note: 'كبّروا الشعار', source: 'client' },
      });
      expect(await cast.typesOf(cast.designer.id, task.id)).toContain('task_returned');

      // The same response sends the task back once.
      await fix();
      await expectError(
        await sendBack(post.id, task.id, cast.writer.cookie, { note: 'ومرة أخرى' }),
        409,
        'ALREADY_RETURNED',
      );
      expect((await cast.task.detail(task.id, cast.gm.cookie)).status).toBe('approved');
    });

    it('is for a post in production', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await linkedTask(post.id);
      await approve(task.id);
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await expectError(
        await sendBack(post.id, task.id, cast.writer.cookie, { note: 'تعديل' }),
        409,
        'INVALID_TRANSITION',
      );
    });
  });

  describe('counting once and publishing (rules 16 and 18)', () => {
    it('counts through a linked task or the post’s own line, never both', async () => {
      const { id: ownClient } = await cast.createClient();
      const { cycle, line } = await reelLine(ownClient);
      const onLine = () =>
        cast.createTask(cast.designManager.cookie, {
          clientId: ownClient,
          retainerCycleId: cycle.id,
          cycleLineId: line.id,
        });

      const counted = await cast.createPost(cast.writer.cookie, {
        clientId: ownClient,
        type: 'reel',
        cycleLineId: line.id,
      });
      await expectError(
        await link(counted.id, (await onLine()).id, cast.writer.cookie),
        409,
        'POST_COUNTED_BY_TASK',
      );
      // A task without a line does not count: it links.
      const free = await cast.createTask(cast.designManager.cookie, { clientId: ownClient });
      await ok(await link(counted.id, free.id, cast.writer.cookie));

      const plain = await cast.createPost(cast.writer.cookie, { clientId: ownClient });
      await ok(await link(plain.id, (await onLine()).id, cast.writer.cookie));
      await expectError(
        await client.request('PATCH', `${posts}/${plain.id}`, {
          cookie: cast.writer.cookie,
          body: { cycleLineId: line.id },
        }),
        409,
        'POST_COUNTED_BY_TASK',
      );
      // Nor does a linked task take a line afterwards: only linking checks the post's own.
      await expectError(
        await patchTask(free.id, cast.designManager.cookie, {
          retainerCycleId: cycle.id,
          cycleLineId: line.id,
        }),
        409,
        'LINKED_TO_POST',
      );
    });

    it('delivers the linked tasks when the post is published, in one transaction', async () => {
      const { id: ownClient } = await cast.createClient();
      const { cycle, line, read } = await reelLine(ownClient);
      const post = await cast.createPost(cast.writer.cookie, {
        clientId: ownClient,
        type: 'reel',
        publishTime: '18:00',
        needsClientApproval: false,
      });
      const task = await cast.createTask(cast.designManager.cookie, {
        clientId: ownClient,
        assigneeId: cast.designer.id,
        retainerCycleId: cycle.id,
        cycleLineId: line.id,
      });
      await ok(await link(post.id, task.id, cast.writer.cookie));
      await cast.task.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
      await approve(task.id);
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'approved' });
      expect((await read()).line.tasks).toEqual({ total: 1, delivered: 0, open: 1 });

      // A failure after the delivery rolls everything back.
      const notices = app.get(PostNotices);
      const send = vi.spyOn(notices, 'send').mockRejectedValueOnce(new Error('boom'));
      try {
        expect((await cast.move(post.id, cast.writer.cookie, { to: 'published' })).status).toBe(
          500,
        );
      } finally {
        send.mockRestore();
      }
      expect((await cast.detail(post.id, cast.gm.cookie)).status).toBe('approved');
      expect((await taskRow(task.id)).status).toBe('approved');

      const published = await cast.moveOk(post.id, cast.writer.cookie, { to: 'published' });
      expect(published.linkedTasks[0]).toMatchObject({ id: task.id, status: 'delivered' });
      const delivered = await taskRow(task.id);
      expect(delivered.status).toBe('delivered');
      expect(delivered.deliveredAt).toBeInstanceOf(Date);
      expect(delivered.postId).toBe(post.id);
      expect((await cast.auditOf(task.id)).at(-1)).toMatchObject({
        action: 'task.status_changed',
        actorId: cast.writer.id,
        before: { status: 'approved' },
        after: { status: 'delivered', reason: 'post_published', postId: post.id },
      });
      // The unit counts once, through the task.
      expect((await read()).line.tasks).toEqual({ total: 1, delivered: 1, open: 0 });

      // Edge case 9: work reopened after publishing leaves the post, and is delivered by hand.
      await cast.task.moveOk(task.id, cast.designManager.cookie, {
        status: 'in_progress',
        note: 'نُشر بالخطأ',
      });
      expect((await taskRow(task.id)).postId).toBeNull();
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.task_unlinked',
        after: { taskId: task.id, reason: 'reopened' },
      });
      await approve(task.id);
      expect(
        (await cast.task.move(task.id, cast.designer.cookie, { status: 'delivered' })).status,
      ).toBe(200);
    });
  });

  describe('cancelling (rule 19)', () => {
    it('gives the tasks back for another post, and reopens without them', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const task = await linkedTask(post.id);
      const cancelled = await cast.moveOk(post.id, cast.writer.cookie, {
        to: 'cancelled',
        reason: 'تغيّرت الخطة',
      });
      expect(cancelled.linkedTasks).toEqual([]);
      expect(await taskRow(task.id)).toMatchObject({
        postId: null,
        status: 'in_progress',
        needsClientApproval: true,
      });
      expect((await cast.auditOf(post.id)).map((entry) => entry.after)).toContainEqual({
        taskId: task.id,
        title: task.title,
        reason: 'post_cancelled',
      });

      const other = await cast.createPost(cast.writer.cookie, { clientId });
      await ok(await link(other.id, task.id, cast.writer.cookie));
      // Without tasks or media, the post reopens as an idea.
      expect(cancelled.allowedTransitions).toEqual(['idea']);
      expect((await cast.moveOk(post.id, cast.writer.cookie, { to: 'idea' })).status).toBe('idea');
    });
  });
});
