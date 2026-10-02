import type { INestApplication } from '@nestjs/common';
import { cyclePageSchema, retainerDetailSchema } from '@vertex-hub/contracts';
import {
  createDatabase,
  departments,
  notificationReminders,
  notifications,
  retainerCycles,
  taskRevisions,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetainerBehindAlerts } from '../src/modules/projects/retainer-behind.js';
import { OverLimitReminders } from '../src/modules/tasks/over-limit-reminders.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * Spec P2A: the retainer behind alert (A09, rules 1–7) and the follow-up on over-limit revision
 * decisions (A06, rules 8–11), run as the daily job would with fixed dates, and the ready count.
 */
describe('Phase 2 automations (spec P2A)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const reminderSubjects: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;

  /** What `recipientId` received about `subjectId`, oldest first. */
  const inbox = (recipientId: string, subjectId: string) =>
    db
      .select({
        type: notifications.type,
        actorId: notifications.actorId,
        data: notifications.data,
      })
      .from(notifications)
      .where(
        and(eq(notifications.recipientId, recipientId), eq(notifications.subjectId, subjectId)),
      )
      .orderBy(asc(notifications.createdAt));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
  });

  afterAll(async () => {
    if (reminderSubjects.length > 0) {
      await db
        .delete(notificationReminders)
        .where(inArray(notificationReminders.subjectId, reminderSubjects));
    }
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  describe('retainer behind (A09)', () => {
    // October 2026: Saturday 24 (8 days left), Sunday 25 (7), Wednesday 28 (4), Thursday 29 (3).
    const october = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };
    let alerts: RetainerBehindAlerts;

    /** A retainer (design 12, reel 4) whose open cycle runs over `period`. */
    async function retainerIn(period = october, ofClientId?: string) {
      const clientId = ofClientId ?? (await cast.createClient()).id;
      const retainer = await cast.createRetainer(clientId);
      const read = async () => {
        const response = await client.get(`/api/retainers/${retainer.id}/cycles`, cast.gm.cookie);
        const [cycle] = cyclePageSchema.parse(await response.json()).items;
        const design = cycle?.lines.find((line) => line.kind === 'design');
        const reel = cycle?.lines.find((line) => line.kind === 'reel');
        if (!cycle || !design || !reel) throw new Error('The retainer has no open cycle');
        return { cycle, design, reel };
      };
      const { cycle, design, reel } = await read();
      await db.update(retainerCycles).set(period).where(eq(retainerCycles.id, cycle.id));
      reminderSubjects.push(cycle.id);
      return { clientId, retainer, cycle, design, reel, read };
    }

    const adjust = async (retainerId: string, cycleId: string, lineId: string, delta: number) => {
      const response = await client.post(
        `/api/retainers/${retainerId}/cycles/${cycleId}/lines/${lineId}/adjustments`,
        cast.gm.cookie,
        { delta, reason: 'تسليم خارج النظام' },
      );
      expect(response.status, await response.clone().text()).toBe(201);
    };

    const post = async (path: string, body?: unknown) => {
      const response = await client.post(path, cast.gm.cookie, body);
      expect(response.status, await response.clone().text()).toBeLessThan(300);
    };

    const keys = (cycleId: string) =>
      db
        .select({ kind: notificationReminders.kind })
        .from(notificationReminders)
        .where(eq(notificationReminders.subjectId, cycleId))
        .orderBy(asc(notificationReminders.kind));

    /** Runs `run` while Internal Operations has `managerId` as its manager (a global row). */
    async function withOperationsManager(managerId: string | null, run: () => Promise<unknown>) {
      const [operations] = await db
        .select({ id: departments.id, managerId: departments.managerId })
        .from(departments)
        .where(eq(departments.code, 'internal_operations'));
      if (!operations) throw new Error('No Internal Operations department');
      await db.update(departments).set({ managerId }).where(eq(departments.id, operations.id));
      try {
        await run();
      } finally {
        await db
          .update(departments)
          .set({ managerId: operations.managerId })
          .where(eq(departments.id, operations.id));
      }
    }

    beforeAll(() => {
      alerts = app.get(RetainerBehindAlerts);
    });

    it('alerts once at 7 days and once more at 3, to the account manager and Operations', async () => {
      const { retainer, cycle } = await retainerIn();

      await alerts.remind('2026-10-24');
      expect(await inbox(cast.am.id, retainer.id)).toEqual([]);

      await alerts.remind('2026-10-25');
      await alerts.remind('2026-10-25');
      await alerts.remind('2026-10-28');
      const first = {
        type: 'retainer_behind',
        actorId: null,
        data: {
          retainer: retainer.name,
          periodEnd: '2026-10-31',
          daysLeft: 7,
          final: false,
          lines: [
            { kind: 'design', label: null, delivered: 0, committed: 12, ready: 0 },
            { kind: 'reel', label: null, delivered: 0, committed: 4, ready: 0 },
          ],
        },
      };
      expect(await inbox(cast.am.id, retainer.id)).toMatchObject([first]);
      expect(await inbox(cast.operations.id, retainer.id)).toMatchObject([first]);
      // The General Manager is not a recipient.
      expect(await inbox(cast.gm.id, retainer.id)).toEqual([]);

      await alerts.remind('2026-10-29');
      await alerts.remind('2026-10-31');
      for (const recipient of [cast.am, cast.operations]) {
        expect((await inbox(recipient.id, retainer.id)).map((row) => row.data)).toMatchObject([
          { final: false },
          { final: true, daysLeft: 3 },
        ]);
      }
      expect(await keys(cycle.id)).toEqual([
        { kind: 'cycle_behind' },
        { kind: 'cycle_behind_final' },
      ]);
    });

    it('sends only the final reminder to a cycle first seen at 3 days or fewer', async () => {
      const { retainer } = await retainerIn();
      await alerts.remind('2026-10-29');
      await alerts.remind('2026-10-31');
      expect((await inbox(cast.am.id, retainer.id)).map((row) => row.data)).toMatchObject([
        { final: true, daysLeft: 3 },
      ]);
    });

    it('lists only the lines that are behind, and skips a cycle that caught up', async () => {
      const { retainer, cycle, design, reel } = await retainerIn();
      await adjust(retainer.id, cycle.id, reel.id, 4);
      await adjust(retainer.id, cycle.id, design.id, 9);
      await alerts.remind('2026-10-25');
      expect((await inbox(cast.am.id, retainer.id)).map((row) => row.data)).toMatchObject([
        { lines: [{ kind: 'design', delivered: 9, committed: 12 }] },
      ]);

      // Caught up after the first alert: no final reminder (rule 5).
      await adjust(retainer.id, cycle.id, design.id, 3);
      await alerts.remind('2026-10-29');
      expect(await inbox(cast.am.id, retainer.id)).toHaveLength(1);
      // Short again later: the final reminder, never a second first alert.
      await adjust(retainer.id, cycle.id, design.id, -1);
      await alerts.remind('2026-10-31');
      expect((await inbox(cast.am.id, retainer.id)).map((row) => row.data)).toMatchObject([
        { final: false },
        { final: true, daysLeft: 1, lines: [{ delivered: 11, committed: 12 }] },
      ]);
    });

    it('skips a cycle of 7 days or shorter, and sends nothing on the weekend', async () => {
      const short = await retainerIn({ periodStart: '2026-10-25', periodEnd: '2026-10-31' });
      const full = await retainerIn();
      await alerts.remind('2026-10-30');
      expect(await inbox(cast.am.id, full.retainer.id)).toEqual([]);
      await alerts.remind('2026-10-25');
      await alerts.remind('2026-10-29');
      expect(await inbox(cast.am.id, short.retainer.id)).toEqual([]);
      expect(await keys(short.cycle.id)).toEqual([]);
      expect(await inbox(cast.am.id, full.retainer.id)).toHaveLength(2);
    });

    it('skips paused, ended and archived retainers and archived clients', async () => {
      const paused = await retainerIn();
      await post(`/api/retainers/${paused.retainer.id}/status`, { status: 'paused' });
      const ended = await retainerIn();
      await post(`/api/retainers/${ended.retainer.id}/status`, { status: 'ended' });
      const archived = await retainerIn();
      await post(`/api/retainers/${archived.retainer.id}/archive`);
      const gone = await retainerIn();
      await post(`/api/clients/${gone.clientId}/archive`);

      await alerts.remind('2026-10-25');
      for (const { retainer, cycle } of [paused, ended, archived, gone]) {
        expect(await inbox(cast.am.id, retainer.id)).toEqual([]);
        expect(await keys(cycle.id)).toEqual([]);
      }

      // Edge case 3: resumed before month end with the same open cycle, it is a candidate again.
      await post(`/api/retainers/${paused.retainer.id}/status`, { status: 'active' });
      await alerts.remind('2026-10-28');
      expect((await inbox(cast.am.id, paused.retainer.id)).map((row) => row.data)).toMatchObject([
        { final: false, daysLeft: 4 },
      ]);
    });

    it('still alerts the account manager when Internal Operations has no manager', async () => {
      const { retainer } = await retainerIn();
      await withOperationsManager(null, () => alerts.remind('2026-10-25'));
      expect(await inbox(cast.am.id, retainer.id)).toHaveLength(1);
      expect(await inbox(cast.operations.id, retainer.id)).toEqual([]);
    });

    it('notifies once a person who is both the account manager and the Operations manager', async () => {
      const { retainer } = await retainerIn();
      await withOperationsManager(cast.am.id, () => alerts.remind('2026-10-25'));
      expect(await inbox(cast.am.id, retainer.id)).toHaveLength(1);
    });

    it('records the reminder and sends nothing when nobody is left (rule 12)', async () => {
      const lone = await cast.signedIn({ roles: ['account_manager'] });
      const { id: clientId } = await cast.createClient({ accountManagerId: lone.id });
      const { retainer, cycle } = await retainerIn(october, clientId);
      await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, lone.id));
      await withOperationsManager(null, () => alerts.remind('2026-10-25'));
      const sent = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.subjectId, retainer.id));
      expect(sent).toEqual([]);
      expect(await keys(cycle.id)).toEqual([{ kind: 'cycle_behind' }]);
    });

    it('counts approved tasks and approved or scheduled posts as ready (rule 7)', async () => {
      const { clientId, retainer, cycle, design, reel, read } = await retainerIn();
      await cast.taskAt('approved', {
        clientId,
        retainerCycleId: cycle.id,
        cycleLineId: design.id,
        needsClientApproval: false,
      });
      await cast.taskAt('in_progress', {
        clientId,
        retainerCycleId: cycle.id,
        cycleLineId: design.id,
      });
      await cast.taskAt('delivered', {
        clientId,
        retainerCycleId: cycle.id,
        cycleLineId: design.id,
        needsClientApproval: false,
      });
      const onLine = { clientId, type: 'reel', cycleLineId: reel.id, needsClientApproval: false };
      await cast.postAt('approved', onLine as Parameters<typeof cast.postAt>[1]);
      await cast.postAt('scheduled', onLine as Parameters<typeof cast.postAt>[1]);
      await cast.postAt('internal_review', onLine as Parameters<typeof cast.postAt>[1]);

      const lines = await read();
      expect(lines.design.tasks).toEqual({ total: 3, delivered: 1, open: 2, ready: 1 });
      expect(lines.reel.tasks).toEqual({ total: 3, delivered: 0, open: 3, ready: 2 });
      const detail = await client.get(`/api/retainers/${retainer.id}`, cast.gm.cookie);
      const { currentCycle } = retainerDetailSchema.parse(await detail.json());
      expect(currentCycle?.lines.map((line) => line.tasks.ready)).toEqual([1, 2]);

      // A task linked to a post counts as a task, never twice: both approved, one unit ready.
      const post = await cast.createPost(cast.writer.cookie, {
        clientId,
        needsClientApproval: false,
      });
      const linked = await cast.taskAt('in_progress', {
        clientId,
        retainerCycleId: cycle.id,
        cycleLineId: design.id,
      });
      const link = await client.request('PUT', `/api/content/posts/${post.id}/tasks/${linked.id}`, {
        cookie: cast.writer.cookie,
      });
      expect(link.status, await link.clone().text()).toBe(200);
      await cast.task.moveOk(linked.id, cast.designer.cookie, { status: 'internal_review' });
      await cast.task.moveOk(linked.id, cast.designManager.cookie, { status: 'approved' });
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'approved' });
      const counted = await read();
      expect(counted.design.tasks).toEqual({ total: 4, delivered: 1, open: 3, ready: 2 });
      expect(counted.reel.tasks.ready).toBe(2);

      // Ready work is listed, and the line is still behind (rule 4).
      await alerts.remind('2026-10-25');
      expect((await inbox(cast.am.id, retainer.id)).map((row) => row.data)).toMatchObject([
        {
          lines: [
            { kind: 'design', delivered: 1, committed: 12, ready: 2 },
            { kind: 'reel', delivered: 0, committed: 4, ready: 2 },
          ],
        },
      ]);
    });
  });

  describe('over-limit decision pending (A06)', () => {
    // Thursday 2026-10-08, Friday 09 (weekend), Saturday 10, Sunday 11.
    const thursday = new Date('2026-10-08T10:00:00Z');
    let pending: OverLimitReminders;

    /** A client task past its limit of 0, sent back by the account manager on `recordedAt`. */
    async function overLimit(recordedAt = thursday) {
      const task = await cast.taskAt('awaiting_client', { revisionLimit: 0 });
      await cast.task.moveOk(task.id, cast.am.cookie, { status: 'revisions', note: 'تعديل' });
      const [revision] = await db
        .update(taskRevisions)
        .set({ createdAt: recordedAt })
        .where(and(eq(taskRevisions.taskId, task.id), taskRevisions.overLimit))
        .returning({ id: taskRevisions.id });
      if (!revision) throw new Error('No over-limit revision');
      reminderSubjects.push(revision.id);
      await db.delete(notifications).where(eq(notifications.subjectId, task.id));
      return { task, revisionId: revision.id };
    }

    const typesOf = async (recipientId: string, taskId: string) =>
      (await inbox(recipientId, taskId)).map((row) => row.type);

    beforeAll(() => {
      pending = app.get(OverLimitReminders);
    });

    it('reminds on the second work day, once, the account manager who recorded it too', async () => {
      const { task } = await overLimit();
      await pending.remind('2026-10-09');
      await pending.remind('2026-10-10');
      expect(await typesOf(cast.am.id, task.id)).toEqual([]);
      expect(await typesOf(cast.operations.id, task.id)).toEqual([]);

      await pending.remind('2026-10-11');
      await pending.remind('2026-10-11');
      await pending.remind('2026-10-12');
      const reminder = {
        type: 'task_over_limit_pending',
        actorId: null,
        data: { task: { title: task.title }, revisionNumber: 1, recordedOn: '2026-10-08' },
      };
      expect(await inbox(cast.am.id, task.id)).toMatchObject([reminder]);
      expect(await inbox(cast.operations.id, task.id)).toMatchObject([reminder]);
      expect(await typesOf(cast.gm.id, task.id)).toEqual([]);
    });

    it('counts work days from the day it was recorded (Sunday → Tuesday, Friday → Sunday)', async () => {
      const sunday = await overLimit(new Date('2026-10-04T10:00:00Z'));
      const friday = await overLimit(new Date('2026-10-09T10:00:00Z'));
      await pending.remind('2026-10-05');
      expect(await typesOf(cast.am.id, sunday.task.id)).toEqual([]);
      await pending.remind('2026-10-06');
      expect(await typesOf(cast.am.id, sunday.task.id)).toEqual(['task_over_limit_pending']);
      await pending.remind('2026-10-10');
      expect(await typesOf(cast.am.id, friday.task.id)).toEqual([]);
      await pending.remind('2026-10-11');
      expect(await typesOf(cast.am.id, friday.task.id)).toEqual(['task_over_limit_pending']);
    });

    it('skips decided revisions and cancelled or archived tasks, and still reminds a delivered one', async () => {
      const decided = await overLimit();
      const decision = await client.post(
        `/api/tasks/${decided.task.id}/revisions/${decided.revisionId}/decision`,
        cast.am.cookie,
        { decision: 'free', note: 'مجاملة للعميل' },
      );
      expect(decision.status, await decision.clone().text()).toBe(200);

      const cancelled = await overLimit();
      await cast.task.moveOk(cancelled.task.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'ألغيت',
      });

      const archived = await overLimit();
      const archive = await client.post(`/api/tasks/${archived.task.id}/archive`, cast.gm.cookie);
      expect(archive.status, await archive.clone().text()).toBe(200);

      // Edge case 11: the decision is a billing matter and outlives delivery.
      const delivered = await overLimit();
      for (const [status, cookie] of [
        ['in_progress', cast.designer.cookie],
        ['internal_review', cast.designer.cookie],
        ['awaiting_client', cast.designManager.cookie],
        ['approved', cast.am.cookie],
        ['delivered', cast.designer.cookie],
      ] as const) {
        await cast.task.moveOk(delivered.task.id, cookie, { status });
      }
      await db.delete(notifications).where(eq(notifications.subjectId, delivered.task.id));

      await pending.remind('2026-10-11');
      for (const { task } of [decided, cancelled, archived]) {
        expect(await typesOf(cast.am.id, task.id)).not.toContain('task_over_limit_pending');
        expect(await typesOf(cast.operations.id, task.id)).not.toContain('task_over_limit_pending');
      }
      expect(await typesOf(cast.am.id, delivered.task.id)).toEqual(['task_over_limit_pending']);
    });
  });
});
