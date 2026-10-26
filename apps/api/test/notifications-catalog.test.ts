import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  businessInstant,
  issuedApprovalRequestSchema,
  meetingDetailSchema,
  type NotificationType,
} from '@vertex-hub/contracts';
import {
  approvalRequests,
  createDatabase,
  meetingAttendees,
  meetings,
  notifications,
  timedReminders,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationCenter, TimedNotifications } from '../src/modules/notifications/index.js';
import { api, textDoc } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

const MINUTE_MS = 60 * 1000;

/** Spec F16 part C (PR C1): the catalog of tasks, content, approvals, calendar and files. */
describe('notification catalog of the workflow modules (F16 part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const timedSubjects: string[] = [];
  const meetingIds: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;

  const everyone = () =>
    [
      cast.gm,
      cast.operations,
      cast.am,
      cast.otherAm,
      cast.employee,
      cast.designer,
      cast.designManager,
      cast.writer,
      cast.contentManager,
      cast.medicalReviewer,
    ].map((user) => user.id);

  const rowsOf = (recipientId: string, type: NotificationType, subjectId?: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, type),
          subjectId ? eq(notifications.subjectId, subjectId) : undefined,
        ),
      );

  const oneOf = async (recipientId: string, type: NotificationType, subjectId: string) => {
    const rows = await rowsOf(recipientId, type, subjectId);
    expect(rows, `${type} for ${recipientId}`).toHaveLength(1);
    return rows[0] as (typeof rows)[number];
  };

  const follow = async (path: string, cookie: string) => {
    const response = await client.request('PUT', `${path}/following`, {
      cookie,
      body: { following: true },
    });
    expect(response.status, await response.clone().text()).toBe(200);
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    if (cast) await db.delete(notifications).where(inArray(notifications.recipientId, everyone()));
    if (timedSubjects.length > 0) {
      await db.delete(timedReminders).where(inArray(timedReminders.subjectId, timedSubjects));
    }
    if (meetingIds.length > 0) {
      await db.delete(meetingAttendees).where(inArray(meetingAttendees.meetingId, meetingIds));
      await db.delete(meetings).where(inArray(meetings.id, meetingIds));
    }
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  beforeEach(async () => {
    await db.delete(notifications).where(inArray(notifications.recipientId, everyone()));
  });

  describe('task resolution (rule B5)', () => {
    it('closes the assignment when the assignee starts the task', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      expect(await oneOf(cast.designer.id, 'task_assigned', task.id)).toMatchObject({
        box: 'action',
        resolvedAt: null,
      });
      await cast.task.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
      const row = await oneOf(cast.designer.id, 'task_assigned', task.id);
      expect(row.resolution).toBe('done');
      expect(row.resolvedById).toBe(cast.designer.id);
      expect(row.readAt).not.toBeNull();
    });

    it('closes a review for the reviewer in Done and for the account manager as handled', async () => {
      const task = await cast.taskAt('internal_review', { clientId });
      const forAm = await oneOf(cast.am.id, 'task_review_requested', task.id);
      expect(forAm.resolvedAt).toBeNull();
      await cast.task.moveOk(task.id, cast.designManager.cookie, {
        status: task.needsClientApproval ? 'awaiting_client' : 'approved',
      });
      const handled = await oneOf(cast.am.id, 'task_review_requested', task.id);
      expect(handled).toMatchObject({
        resolution: 'done',
        resolvedById: cast.designManager.id,
        readAt: null,
      });
      const own = await oneOf(cast.designManager.id, 'task_review_requested', task.id);
      expect(own.readAt).not.toBeNull();
    });

    it('voids what a cancelled task still waited for', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      await cast.task.moveOk(task.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'لم يعد مطلوبًا',
      });
      const row = await oneOf(cast.designer.id, 'task_assigned', task.id);
      expect(row.resolution).toBe('void');
      expect(row.readAt).not.toBeNull();
    });

    it("voids the previous assignee's assignment and keeps the new one open", async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      const response = await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: cast.designManager.cookie,
        body: { assigneeId: cast.employee.id },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await oneOf(cast.designer.id, 'task_assigned', task.id)).resolution).toBe('void');
      expect(await oneOf(cast.employee.id, 'task_assigned', task.id)).toMatchObject({
        resolvedAt: null,
        readAt: null,
      });
    });

    it('voids the due reminders of a task that is re-dated', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      await db.transaction((tx) =>
        app.get(NotificationCenter).notify(tx, {
          type: 'task_overdue',
          recipients: [cast.designer.id],
          actorId: null,
          subjectId: task.id,
          data: {
            task: { title: task.title, department: 'design', client: null, project: null },
            dueDate: task.dueDate,
            dueTime: null,
          },
        }),
      );
      const response = await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: cast.designManager.cookie,
        body: { dueDate: cast.inDays(6) },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await oneOf(cast.designer.id, 'task_overdue', task.id)).resolution).toBe('void');
    });

    it('stores a row the same change resolves as resolved, never pushed (edge case 9)', async () => {
      const subjectId = randomUUID();
      await db.transaction((tx) =>
        app.get(NotificationCenter).notify(
          tx,
          {
            type: 'task_assigned',
            recipients: [cast.designer.id],
            actorId: cast.designManager.id,
            subjectId,
            data: {
              task: { title: 'مهمة', department: 'design', client: null, project: null },
            },
          },
          [
            {
              subject: { type: 'task', id: subjectId },
              types: ['task_assigned'],
              outcome: 'done',
              actorId: cast.designManager.id,
            },
          ],
        ),
      );
      const row = await oneOf(cast.designer.id, 'task_assigned', subjectId);
      expect(row).toMatchObject({ resolution: 'done', resolvedById: cast.designManager.id });
      expect(row.readAt).toBeNull();
    });
  });

  describe('new task types', () => {
    it('tells the account manager that a task was delivered', async () => {
      const task = await cast.taskAt('delivered', { clientId });
      expect(await rowsOf(cast.am.id, 'task_delivered', task.id)).toHaveLength(1);
    });

    it('tells the assignee and the creator that a cancelled task is reopened', async () => {
      const task = await cast.createTask(cast.gm.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      await cast.task.moveOk(task.id, cast.gm.cookie, { status: 'cancelled', note: 'مؤقتًا' });
      await cast.task.moveOk(task.id, cast.designManager.cookie, {
        status: 'in_progress',
        note: 'عاد مطلوبًا',
      });
      expect(await rowsOf(cast.designer.id, 'task_reopened', task.id)).toHaveLength(1);
      expect(await rowsOf(cast.gm.id, 'task_reopened', task.id)).toHaveLength(1);
    });
  });

  describe('followers (rule B12)', () => {
    it('tells the creator and a manual follower that the status moved, merged', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      await follow(`/api/tasks/${task.id}`, cast.employee.cookie);
      await cast.task.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
      await cast.task.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      const [merged] = await rowsOf(cast.employee.id, 'task_progressed', task.id);
      expect(merged).toMatchObject({ count: 2, data: { status: 'internal_review' } });
      // The design manager gets the review request instead, ranked earlier.
      expect(await rowsOf(cast.designManager.id, 'task_progressed', task.id)).toHaveLength(1);
    });

    it('tells followers of a comment, and makes the commenter and the mentioned follow', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      const comment = await client.post(`/api/tasks/${task.id}/comments`, cast.employee.cookie, {
        bodyDoc: textDoc(`راجع هذا @{${cast.writer.id}}`),
      });
      expect(comment.status, await comment.clone().text()).toBe(201);
      // The creator follows: they hear of the comment.
      expect(await rowsOf(cast.designManager.id, 'task_commented', task.id)).toHaveLength(1);
      await client.post(`/api/tasks/${task.id}/comments`, cast.designer.cookie, {
        bodyDoc: textDoc('تم'),
      });
      expect(await rowsOf(cast.employee.id, 'task_commented', task.id)).toHaveLength(1);
      expect(await rowsOf(cast.writer.id, 'task_commented', task.id)).toHaveLength(1);
    });

    it('closes the mention of whoever answers with a comment', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
      });
      await client.post(`/api/tasks/${task.id}/comments`, cast.designManager.cookie, {
        bodyDoc: textDoc(`@{${cast.employee.id}} ما رأيك؟`),
      });
      await client.post(`/api/tasks/${task.id}/comments`, cast.employee.cookie, {
        bodyDoc: textDoc('موافق'),
      });
      const row = await oneOf(cast.employee.id, 'task_mentioned', task.id);
      expect(row).toMatchObject({ resolution: 'done', resolvedById: cast.employee.id });
    });
  });

  describe('posts', () => {
    it('closes the assignment when the responsible submits the post', async () => {
      const post = await cast.createPost(cast.contentManager.cookie, {
        clientId,
        responsibleId: cast.writer.id,
      });
      expect((await oneOf(cast.writer.id, 'post_assigned', post.id)).resolvedAt).toBeNull();
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'in_production' });
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      expect((await oneOf(cast.writer.id, 'post_assigned', post.id)).resolution).toBe('done');
      // The creator follows the post and hears that it moved to production; the review request
      // of the next move is ranked earlier.
      expect(await rowsOf(cast.contentManager.id, 'post_progressed', post.id)).toHaveLength(1);
    });

    it('tells the previous responsible who holds the post now (part C rule 4)', async () => {
      const post = await cast.createPost(cast.contentManager.cookie, {
        clientId,
        responsibleId: cast.writer.id,
      });
      const response = await client.request('PATCH', `/api/content/posts/${post.id}`, {
        cookie: cast.contentManager.cookie,
        body: { responsibleId: cast.contentManager.id },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await oneOf(cast.writer.id, 'responsibility_moved', post.id)).toMatchObject({
        subjectType: 'post',
        data: { role: 'post_responsible', record: post.title, holder: cast.contentManager.name },
      });
      expect((await oneOf(cast.writer.id, 'post_assigned', post.id)).resolution).toBe('void');
    });

    it('tells the account manager that a post was published', async () => {
      const post = await cast.postAt('published', { clientId });
      expect(await rowsOf(cast.am.id, 'post_published', post.id)).toHaveLength(1);
    });

    it('tells the account manager and the responsible that a post was cancelled', async () => {
      const post = await cast.createPost(cast.contentManager.cookie, {
        clientId,
        responsibleId: cast.writer.id,
      });
      await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'cancelled',
        reason: 'ألغاه العميل',
      });
      expect(await rowsOf(cast.am.id, 'post_cancelled', post.id)).toHaveLength(1);
      expect(await rowsOf(cast.writer.id, 'post_cancelled', post.id)).toHaveLength(1);
      expect((await oneOf(cast.writer.id, 'post_assigned', post.id)).resolution).toBe('void');
    });

    it('tells the responsible and the followers of a file, and the adder follows', async () => {
      const post = await cast.createPost(cast.contentManager.cookie, {
        clientId,
        responsibleId: cast.writer.id,
      });
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'in_production' });
      await cast.addFileOk(post.id, 'cover.png');
      // The creator follows the post; the writer added the file and is not told.
      expect(await rowsOf(cast.contentManager.id, 'post_file_added', post.id)).toHaveLength(1);
      expect(await rowsOf(cast.writer.id, 'post_file_added', post.id)).toHaveLength(0);
    });
  });

  describe('approvals', () => {
    it('tells of the first opening only, and answers the task ready for the client', async () => {
      const task = await cast.taskAt('awaiting_client', { clientId });
      expect((await oneOf(cast.am.id, 'task_awaiting_client', task.id)).resolvedAt).toBeNull();
      const response = await client.post('/api/approvals/requests', cast.am.cookie, {
        clientId,
        contactId: await cast.contactOf(clientId),
        items: [{ taskId: task.id }],
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const issued = issuedApprovalRequestSchema.parse(await response.json());
      expect((await oneOf(cast.am.id, 'task_awaiting_client', task.id)).resolution).toBe('done');
      const token = issued.link.split('/a/')[1] ?? '';
      expect((await client.get(`/api/public/approvals/${token}`)).status).toBe(200);
      expect((await client.get(`/api/public/approvals/${token}`)).status).toBe(200);
      // The account manager created the request: it tells nobody else here.
      const [request] = await db
        .select({ firstOpenedAt: approvalRequests.firstOpenedAt })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, issued.id));
      expect(request?.firstOpenedAt).not.toBeNull();
    });
  });

  describe('approval completed by a response recorded by hand', () => {
    it('closes the expiry wait and tells of the completed request', async () => {
      const task = await cast.taskAt('awaiting_client', { clientId });
      const response = await client.post('/api/approvals/requests', cast.gm.cookie, {
        clientId,
        contactId: await cast.contactOf(clientId),
        items: [{ taskId: task.id }],
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const issued = issuedApprovalRequestSchema.parse(await response.json());
      await db.transaction((tx) =>
        app.get(NotificationCenter).notify(tx, {
          type: 'approval_expired',
          recipients: [cast.am.id],
          actorId: null,
          subjectId: issued.id,
          data: { client: 'عميل', contact: 'جهة' },
        }),
      );
      await cast.task.moveOk(task.id, cast.am.cookie, { status: 'approved' });
      expect((await oneOf(cast.am.id, 'approval_expired', issued.id)).resolution).toBe('done');
      expect(await rowsOf(cast.am.id, 'approval_completed', issued.id)).toHaveLength(1);
    });
  });

  describe('timed reminders (rule B13)', () => {
    it('reminds the assignee two hours before a due time, once, and skips a passed moment', async () => {
      const dueDate = cast.inDays(2);
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
        dueDate,
        dueTime: '10:00',
      });
      timedSubjects.push(task.id);
      const occursAt = businessInstant(dueDate, '10:00');
      const timed = app.get(TimedNotifications);
      // Ten minutes late: the moment passed.
      await timed.runTimed(new Date(occursAt.getTime() - 110 * MINUTE_MS));
      expect(await rowsOf(cast.designer.id, 'task_due_shortly', task.id)).toHaveLength(0);
      await timed.runTimed(new Date(occursAt.getTime() - 120 * MINUTE_MS));
      await timed.runTimed(new Date(occursAt.getTime() - 119 * MINUTE_MS));
      const rows = await rowsOf(cast.designer.id, 'task_due_shortly', task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ box: 'action', priority: 'important' });
    });

    it('reminds the organizer and the attendees 15 minutes before a meeting, with its link', async () => {
      const startsAt = businessInstant(cast.inDays(3), '12:00');
      const response = await client.post('/api/meetings', cast.gm.cookie, {
        title: `اجتماع ${cast.run}`,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 60 * MINUTE_MS).toISOString(),
        acceptConflicts: true,
        attendeeIds: [cast.employee.id],
        onlineUrl: 'https://meet.example.com/abc',
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const meeting = meetingDetailSchema.parse(await response.json());
      meetingIds.push(meeting.id);
      timedSubjects.push(meeting.id);
      await app.get(TimedNotifications).runTimed(new Date(startsAt.getTime() - 15 * MINUTE_MS));
      const [row] = await rowsOf(cast.employee.id, 'meeting_starting', meeting.id);
      expect(row?.data).toMatchObject({ joinUrl: 'https://meet.example.com/abc' });
      // The organizer created it at once, so they are told too.
      expect(await rowsOf(cast.gm.id, 'meeting_starting', meeting.id)).toHaveLength(1);
    });
  });
});
