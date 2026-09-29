import type { INestApplication } from '@nestjs/common';
import {
  type NotificationType,
  type TemplateRunInputBody,
  templateDetailSchema,
  templateRunSchema,
} from '@vertex-hub/contracts';
import {
  createDatabase,
  notificationReminders,
  notifications,
  templateRunTasks,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetainerRenewals } from '../src/modules/projects/retainer-renewals.js';
import { TaskReminders } from '../src/modules/tasks/task-reminders.js';
import { api, removeTemplates } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

/*
 * F14 PR 2: the notifications each module sends for its changes ("Notification types"), and the
 * daily reminders of rules 9–12 with fixed dates. Recipients and subjects are this run's rows.
 */
describe('notification events', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const templates: string[] = [];
  const reminderSubjects: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  /** What `recipientId` received about `subjectId`, oldest first. */
  const inbox = (recipientId: string, subjectId: string) =>
    db
      .select({
        type: notifications.type,
        actorId: notifications.actorId,
        data: notifications.data,
        count: notifications.count,
      })
      .from(notifications)
      .where(
        and(eq(notifications.recipientId, recipientId), eq(notifications.subjectId, subjectId)),
      )
      .orderBy(asc(notifications.createdAt));

  const typesOf = async (recipientId: string, subjectId: string): Promise<NotificationType[]> =>
    (await inbox(recipientId, subjectId)).map((row) => row.type);

  const clear = (subjectId: string) =>
    db.delete(notifications).where(eq(notifications.subjectId, subjectId));

  const patch = (path: string, cookie: string, body: unknown) =>
    client.request('PATCH', path, { cookie, body });

  const comment = (taskId: string, cookie: string, body: string) =>
    client.post(`/api/tasks/${taskId}/comments`, cookie, { body });

  const mute = (cookie: string, mutedTypes: NotificationType[]) =>
    client.request('PUT', '/api/me/notification-settings', { cookie, body: { mutedTypes } });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await removeTemplates(db, templates);
    await cast?.cleanup();
    if (reminderSubjects.length > 0) {
      await db
        .delete(notificationReminders)
        .where(inArray(notificationReminders.subjectId, reminderSubjects));
    }
    await app?.close();
    await connection.close();
  });

  describe('clients and projects', () => {
    it('tells a new primary account manager about the client (F02)', async () => {
      const created = await cast.createClient();
      expect(await inbox(cast.am.id, created.id)).toMatchObject([
        {
          type: 'client_account_manager_assigned',
          actorId: cast.gm.id,
          data: { client: created.tradeName },
        },
      ]);

      const response = await patch(`/api/clients/${created.id}`, cast.gm.cookie, {
        accountManagerId: cast.otherAm.id,
      });
      expect(response.status).toBe(200);
      expect(await typesOf(cast.otherAm.id, created.id)).toEqual([
        'client_account_manager_assigned',
      ]);
      expect(await typesOf(cast.am.id, created.id)).toHaveLength(1);
    });

    it('tells a new project manager about the project (F05)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      expect(await inbox(cast.employee.id, project.id)).toMatchObject([
        { type: 'project_manager_assigned', data: { project: project.name } },
      ]);

      // The actor is never notified of their own change.
      const response = await patch(`/api/projects/${project.id}`, cast.gm.cookie, {
        projectManagerId: cast.gm.id,
      });
      expect(response.status).toBe(200);
      expect(await typesOf(cast.gm.id, project.id)).toEqual([]);
    });
  });

  describe('task changes', () => {
    it('sends a new task to its assignee, or to the managers of its department', async () => {
      const assigned = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      expect(await inbox(cast.designer.id, assigned.id)).toMatchObject([
        {
          type: 'task_assigned',
          actorId: cast.designManager.id,
          data: { task: { title: assigned.title, department: 'design', client: null } },
        },
      ]);

      const requested = await cast.createTask(cast.am.cookie);
      expect(await typesOf(cast.designManager.id, requested.id)).toEqual(['task_requested']);

      // The manager creating an unassigned task is its actor: nobody else manages Design.
      const own = await cast.createTask(cast.designManager.cookie);
      expect(await typesOf(cast.designManager.id, own.id)).toEqual([]);
    });

    it('tells the new and the previous assignee, and the assignee of a new due date', async () => {
      const other = await cast.signedIn({ departments: [{ code: 'design' }] });
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      await clear(task.id);

      // Reassigned with a new due date: the new assignee gets only `task_assigned` (first match).
      const dueDate = cast.inDays(5);
      const response = await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, {
        assigneeId: other.id,
        dueDate,
      });
      expect(response.status).toBe(200);
      expect(await typesOf(other.id, task.id)).toEqual(['task_assigned']);
      expect(await inbox(cast.designer.id, task.id)).toMatchObject([
        { type: 'task_changed', data: { change: 'taken_away' } },
      ]);

      await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, {
        dueDate: cast.inDays(6),
        dueTime: '14:00',
      });
      expect((await inbox(other.id, task.id)).at(-1)).toMatchObject({
        type: 'task_changed',
        data: {
          change: 'due',
          from: { dueDate, dueTime: null },
          to: { dueDate: cast.inDays(6), dueTime: '14:00' },
        },
      });

      // Moved to a department the assignee is not in: back to the queue of its managers.
      await patch(`/api/tasks/${task.id}`, cast.gm.cookie, { department: 'content_management' });
      expect(await typesOf(cast.contentManager.id, task.id)).toEqual(['task_requested']);
      expect((await typesOf(other.id, task.id)).at(-1)).toBe('task_changed');
    });

    it('follows the review workflow (F06)', async () => {
      const task = await cast.taskAt('in_progress', { revisionLimit: 0 });
      await clear(task.id);

      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      expect(await typesOf(cast.designManager.id, task.id)).toEqual(['task_review_requested']);
      expect(await typesOf(cast.am.id, task.id)).toEqual(['task_review_requested']);

      await cast.moveOk(task.id, cast.designManager.cookie, {
        status: 'revisions',
        note: 'أعد الألوان',
      });
      expect(await inbox(cast.designer.id, task.id)).toMatchObject([
        { type: 'task_returned', data: { source: 'internal' } },
      ]);

      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'awaiting_client' });
      expect((await inbox(cast.designer.id, task.id)).at(-1)).toMatchObject({
        type: 'task_approved',
        data: { source: 'internal' },
      });
      expect((await typesOf(cast.am.id, task.id)).at(-1)).toBe('task_awaiting_client');

      // A client revision over the limit, recorded by someone other than the account manager.
      await clear(task.id);
      await cast.moveOk(task.id, cast.gm.cookie, { status: 'revisions', note: 'تعديل ثالث' });
      expect(await inbox(cast.designer.id, task.id)).toMatchObject([
        { type: 'task_returned', data: { source: 'client' } },
      ]);
      expect(await typesOf(cast.am.id, task.id)).toEqual(['task_over_limit']);

      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'awaiting_client' });
      await clear(task.id);
      await cast.moveOk(task.id, cast.am.cookie, { status: 'approved' });
      expect(await inbox(cast.designer.id, task.id)).toMatchObject([
        { type: 'task_approved', data: { source: 'client' } },
      ]);
      // The account manager recorded it: no notice to themselves.
      expect(await typesOf(cast.am.id, task.id)).toEqual([]);
    });

    it('tells the requester when their request is delivered or cancelled', async () => {
      const { id: clientId } = await cast.createClient();
      const delivered = await cast.createTask(cast.am.cookie, {
        clientId,
        assigneeId: cast.designer.id,
        needsClientApproval: false,
      });
      await cast.moveOk(delivered.id, cast.designer.cookie, { status: 'in_progress' });
      await cast.moveOk(delivered.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(delivered.id, cast.designManager.cookie, { status: 'approved' });
      await cast.moveOk(delivered.id, cast.designer.cookie, { status: 'delivered' });
      expect(await inbox(cast.am.id, delivered.id)).toMatchObject([
        { type: 'task_review_requested' },
        { type: 'request_finished', data: { outcome: 'delivered' } },
      ]);

      const cancelled = await cast.createTask(cast.am.cookie, {
        clientId,
        assigneeId: cast.designer.id,
      });
      await cast.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'لم يعد مطلوباً',
      });
      expect(await typesOf(cast.am.id, cancelled.id)).toEqual(['request_finished']);
      expect(await inbox(cast.designer.id, cancelled.id)).toMatchObject([
        { type: 'task_assigned' },
        { type: 'task_changed', data: { change: 'cancelled' } },
      ]);
    });

    it('tells the assignee when the task is archived', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const response = await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie);
      expect(response.status).toBe(200);
      expect((await inbox(cast.designer.id, task.id)).at(-1)).toMatchObject({
        type: 'task_changed',
        data: { change: 'archived' },
      });
    });

    it('opens a task when its last open dependency is approved or removed (rule 7)', async () => {
      const first = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const second = await cast.createTask(cast.gm.cookie, {
        assigneeId: cast.writer.id,
        department: 'content_management',
        dependsOn: [first.id],
      });
      await cast.moveOk(first.id, cast.designer.cookie, { status: 'in_progress' });
      await cast.moveOk(first.id, cast.designer.cookie, { status: 'internal_review' });
      expect(await typesOf(cast.writer.id, second.id)).toEqual(['task_assigned']);
      await cast.moveOk(first.id, cast.designManager.cookie, { status: 'approved' });
      expect(await inbox(cast.writer.id, second.id)).toMatchObject([
        { type: 'task_assigned' },
        { type: 'task_opened', actorId: cast.designManager.id },
      ]);

      // Unassigned: the department's managers hear about it.
      const blocker = await cast.createTask(cast.designManager.cookie);
      const waiting = await cast.createTask(cast.gm.cookie, {
        department: 'content_management',
        dependsOn: [blocker.id],
      });
      await clear(waiting.id);
      const response = await client.request('PUT', `/api/tasks/${waiting.id}/dependencies`, {
        cookie: cast.gm.cookie,
        body: { dependsOn: [] },
      });
      expect(response.status).toBe(200);
      expect(await typesOf(cast.contentManager.id, waiting.id)).toEqual(['task_opened']);
    });

    it('opens a task when its last dependency is cancelled or archived, once (owner decision)', async () => {
      const waitingOn = async (...dependsOn: string[]) => {
        const task = await cast.createTask(cast.designManager.cookie, {
          assigneeId: cast.designer.id,
          dependsOn,
        });
        await clear(task.id);
        return task;
      };

      const cancelled = await cast.createTask(cast.designManager.cookie);
      const afterCancel = await waitingOn(cancelled.id);
      await cast.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'لم تعد لازمة',
      });
      expect(await typesOf(cast.designer.id, afterCancel.id)).toEqual(['task_opened']);

      const archived = await cast.createTask(cast.designManager.cookie);
      const afterArchive = await waitingOn(archived.id);
      expect((await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      expect(await typesOf(cast.designer.id, afterArchive.id)).toEqual(['task_opened']);

      // Cancelling a project cancels both dependencies in one transaction: one notice.
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const inProject = (title: string) =>
        cast.createTask(cast.designManager.cookie, { clientId, projectId: project.id, title });
      const [one, two] = [await inProject('أ'), await inProject('ب')];
      const afterProject = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId,
        dependsOn: [one.id, two.id],
      });
      await clear(afterProject.id);
      const response = await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
        status: 'cancelled',
        reason: 'أوقف العميل المشروع',
      });
      expect(response.status).toBe(200);
      expect(await typesOf(cast.designer.id, afterProject.id)).toEqual(['task_opened']);
    });

    it('does not open again when an already approved dependency is cancelled', async () => {
      const first = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      const second = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        dependsOn: [first.id],
      });
      await cast.moveOk(first.id, cast.designer.cookie, { status: 'in_progress' });
      await cast.moveOk(first.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.moveOk(first.id, cast.designManager.cookie, { status: 'approved' });
      await clear(second.id);
      await cast.moveOk(first.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'ألغيت بعد الاعتماد',
      });
      expect(await typesOf(cast.designer.id, second.id)).toEqual([]);
    });

    it('sends mentions and comments, keeps one per change and merges comments (rules 2, 5)', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      await clear(task.id);

      // A mention of the assignee is only a mention.
      expect(
        (await comment(task.id, cast.am.cookie, `@{${cast.designer.id}} راجع هذا`)).status,
      ).toBe(201);
      expect(await inbox(cast.designer.id, task.id)).toMatchObject([
        { type: 'task_mentioned', data: { excerpt: `@${cast.designer.name} راجع هذا` } },
      ]);

      await comment(task.id, cast.am.cookie, 'تعليق أول');
      await comment(task.id, cast.am.cookie, 'تعليق ثان');
      expect(await inbox(cast.designer.id, task.id)).toMatchObject([
        { type: 'task_mentioned' },
        { type: 'task_commented', count: 2, data: { excerpt: 'تعليق ثان' } },
      ]);

      // The assignee's own comment reaches nobody; an edit notifies only the mentions it adds.
      const own = await comment(task.id, cast.designer.cookie, 'تم');
      const { id: commentId } = (await own.json()) as { id: string };
      expect(await typesOf(cast.writer.id, task.id)).toEqual([]);
      await patch(`/api/tasks/${task.id}/comments/${commentId}`, cast.designer.cookie, {
        body: `تم @{${cast.writer.id}}`,
      });
      expect(await typesOf(cast.writer.id, task.id)).toEqual(['task_mentioned']);
      expect(await inbox(cast.designer.id, task.id)).toHaveLength(2);
    });

    it('drops muted types, and a muted mention gives way to the comment (rules 2, 3)', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      await clear(task.id);
      expect((await mute(cast.designer.cookie, ['task_mentioned'])).status).toBe(200);
      await comment(task.id, cast.am.cookie, `@{${cast.designer.id}} انظر`);
      expect(await typesOf(cast.designer.id, task.id)).toEqual(['task_commented']);

      expect((await mute(cast.designer.cookie, ['task_commented'])).status).toBe(200);
      await clear(task.id);
      await comment(task.id, cast.am.cookie, 'بدون إشارة');
      expect(await typesOf(cast.designer.id, task.id)).toEqual([]);
      await mute(cast.designer.cookie, []);
    });

    it('sends nothing to archived users', async () => {
      const leaving = await cast.signedIn({ departments: [{ code: 'design' }] });
      const task = await cast.createTask(cast.designManager.cookie, { assigneeId: leaving.id });
      await clear(task.id);
      await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, leaving.id));
      await comment(task.id, cast.am.cookie, 'هل من جديد؟');
      expect(await typesOf(leaving.id, task.id)).toEqual([]);
    });
  });

  describe('template runs (F07)', () => {
    it('sends one notice per assignee and per department queue, and no per-task notices', async () => {
      const marketingManager = await cast.signedIn({
        departments: [{ code: 'marketing', manager: true }],
      });
      const created = await client.post('/api/templates', cast.operations.cookie, {
        name: `قالب ${cast.run}`,
        kind: 'project',
        steps: [
          { key: 'brief', title: 'Brief', department: 'marketing', dueDay: 1 },
          { key: 'logo', title: 'Logo', department: 'design', dueDay: 3 },
          { key: 'cards', title: 'Cards', department: 'design', dueDay: 4 },
        ],
        assignees: [{ department: 'design', userId: cast.designer.id }],
      });
      expect(created.status).toBe(201);
      const template = templateDetailSchema.parse(await created.json());
      templates.push(template.id);
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);

      const body: TemplateRunInputBody = { projectId: project.id };
      const response = await client.post(
        `/api/templates/${template.id}/runs`,
        cast.am.cookie,
        body,
      );
      expect(response.status).toBe(201);
      const run = templateRunSchema.parse(await response.json());

      expect(await inbox(cast.designer.id, run.id)).toMatchObject([
        {
          type: 'tasks_generated',
          actorId: cast.am.id,
          data: {
            template: template.name,
            count: 2,
            department: 'design',
            unassigned: false,
            project: project.name,
          },
        },
      ]);
      expect(await inbox(marketingManager.id, run.id)).toMatchObject([
        { type: 'tasks_generated', data: { count: 1, department: 'marketing', unassigned: true } },
      ]);
      const runTaskIds = (
        await db
          .select({ id: templateRunTasks.taskId })
          .from(templateRunTasks)
          .where(eq(templateRunTasks.runId, run.id))
      ).map((row) => row.id);
      const perTask = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(inArray(notifications.subjectId, runTaskIds));
      expect(perTask).toEqual([]);
    });
  });

  describe('daily job (rules 9–12)', () => {
    // Thursday 2026-10-08, Friday 09 (weekend), Saturday 10, Sunday 11 (ADR 0015 work week).
    const thursday = '2026-10-08';
    const saturday = '2026-10-10';
    const sunday = '2026-10-11';
    let reminders: TaskReminders;
    let late: Awaited<ReturnType<typeof cast.signedIn>>;

    const assignedTo = async (dueDate: string, assigneeId: string | null = late.id) => {
      const task = await cast.createTask(cast.designManager.cookie, {
        dueDate,
        ...(assigneeId && { assigneeId }),
      });
      reminderSubjects.push(task.id);
      await clear(task.id);
      return task;
    };

    beforeAll(async () => {
      reminders = app.get(TaskReminders);
      late = await cast.signedIn({ departments: [{ code: 'design' }] });
    });

    it('reminds on Thursday about Friday and Saturday, once', async () => {
      const friday = await assignedTo('2026-10-09');
      const onSaturday = await assignedTo(saturday);
      const onSunday = await assignedTo(sunday);

      await reminders.remind(thursday);
      await reminders.remind(thursday);
      expect(await inbox(late.id, friday.id)).toMatchObject([
        { type: 'task_due_soon', actorId: null, data: { dueDate: '2026-10-09' } },
      ]);
      expect(await typesOf(late.id, onSaturday.id)).toEqual(['task_due_soon']);
      expect(await typesOf(late.id, onSunday.id)).toEqual([]);
    });

    it('sends overdue, then escalates a work day later, and restarts on a new due date', async () => {
      const task = await assignedTo(thursday);
      const queued = await assignedTo(thursday, null);

      await reminders.remind(saturday);
      await reminders.remind(saturday);
      expect(await typesOf(late.id, task.id)).toEqual(['task_overdue']);
      expect(await typesOf(cast.designManager.id, queued.id)).toEqual(['task_overdue']);
      expect(await typesOf(cast.designManager.id, task.id)).toEqual([]);

      await reminders.remind(sunday);
      await reminders.remind(sunday);
      expect(await inbox(cast.designManager.id, task.id)).toMatchObject([
        { type: 'task_overdue_escalated', data: { assignee: late.name, dueDate: thursday } },
      ]);
      // An unassigned task is not escalated: its managers already got the overdue notice.
      expect(await typesOf(cast.designManager.id, queued.id)).toEqual(['task_overdue']);

      // A new due date starts the cycle again.
      await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, { dueDate: '2026-10-12' });
      await clear(task.id);
      await reminders.remind('2026-10-13');
      expect(await typesOf(late.id, task.id)).toEqual(['task_overdue']);
      expect(await typesOf(cast.designManager.id, task.id)).toEqual([]);
    });

    it('sends nothing for finished tasks or on the weekend', async () => {
      const task = await assignedTo(thursday);
      await reminders.remind('2026-10-09');
      expect(await typesOf(late.id, task.id)).toEqual([]);
      await cast.moveOk(task.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'ألغيت',
      });
      await clear(task.id);
      await reminders.remind(saturday);
      expect(await typesOf(late.id, task.id)).toEqual([]);
    });

    it('reminds the account manager 30 days before a renewal and on the date (rule 12)', async () => {
      const { id: clientId } = await cast.createClient();
      const retainer = await cast.createRetainer(clientId, { renewalDate: '2026-11-07' });
      reminderSubjects.push(retainer.id);
      const renewals = app.get(RetainerRenewals);

      await renewals.remind('2026-10-07');
      expect(await typesOf(cast.am.id, retainer.id)).toEqual([]);
      await renewals.remind(thursday);
      await renewals.remind(saturday);
      expect(await inbox(cast.am.id, retainer.id)).toMatchObject([
        {
          type: 'retainer_renewal_due',
          actorId: null,
          data: { retainer: retainer.name, renewalDate: '2026-11-07', daysLeft: 30 },
        },
      ]);
      await renewals.remind('2026-11-07');
      await renewals.remind('2026-11-08');
      expect((await inbox(cast.am.id, retainer.id)).map((row) => row.data)).toMatchObject([
        { daysLeft: 30 },
        { daysLeft: 0 },
      ]);
    });
  });
});
