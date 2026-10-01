import type { INestApplication } from '@nestjs/common';
import {
  businessDate,
  editingTaskDueDate,
  type ShootDetail,
  shootDetailSchema,
} from '@vertex-hub/contracts';
import { createDatabase, taskDependencies, taskLinks, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedShootCast } from './shoot-cast.js';
import { startApp } from './start-app.js';

/*
 * F11 PR 1: closing a shoot (rules 10–12: the task delivered, the editing task), cancelling and
 * reopening it (rule 13).
 */
describe('closing, cancelling and reopening shoots (F11 rules 10–13)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedShootCast>>;
  let clientId: string;

  const action = (id: string, name: string, cookie: string | undefined, body: unknown = {}) =>
    client.post(`/api/shoots/${id}/${name}`, cookie, body);

  async function ok(response: Response): Promise<ShootDetail> {
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return shootDetailSchema.parse(await response.json());
  }

  const taskRow = async (id: string) => {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw new Error(`Task ${id} not found`);
    return row;
  };

  /** A shoot that started yesterday, on a new task of the client, led by `leadId`. */
  async function startedShoot(
    leadId: string,
    input: Parameters<typeof cast.bookOk>[1] = {},
  ): Promise<ShootDetail> {
    return cast.bookOk(cast.gm.cookie, {
      taskId: (await cast.photoTask(clientId)).id,
      startsAt: cast.at(-1, '10:00'),
      endsAt: cast.at(-1, '12:00'),
      crew: [{ userId: leadId, role: 'photographer', isLead: true }],
      ...input,
    });
  }

  const editing = (input: Record<string, unknown> = {}) => ({
    title: 'مونتاج',
    department: 'photography',
    assigneeId: null,
    dueDate: editingTaskDueDate(businessDate()),
    needsClientApproval: true,
    ...input,
  });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedShootCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  describe('closing (rules 10–12)', () => {
    it('delivers the shoot task and creates the editing task after it', async () => {
      const { cycle, line, read } = await cast.shootRetainer(clientId);
      const shoot = await cast.bookOk(cast.am.cookie, {
        newTask: { retainerCycleId: cycle.id, cycleLineId: line.id },
        clientId,
        startsAt: cast.at(0, '00:00'),
        endsAt: cast.at(0, '00:30'),
      });
      const [first] = shoot.shots;
      if (!first) throw new Error('No shot');
      await client.post(
        `/api/shoots/${shoot.id}/shots/${first.id}/done`,
        cast.photographer.cookie,
        { done: true },
      );
      const closed = await ok(
        await action(shoot.id, 'close', cast.photographer.cookie, {
          note: 'تم التصوير بالكامل',
          rawFilesUrl: 'https://drive.example.com/raw?token=secret',
          editingTask: editing({ assigneeId: cast.photographer.id }),
        }),
      );
      expect(closed).toMatchObject({
        status: 'completed',
        completedBy: { id: cast.photographer.id },
        closeNote: 'تم التصوير بالكامل',
        task: { id: shoot.task.id, status: 'delivered' },
        editingTask: { status: 'new', department: 'photography' },
        permissions: { canEdit: false, canClose: false, canTick: false },
      });
      // The unit counts once, through the shoot task (ADR 0015).
      expect((await read()).line.delivered).toBe(1);
      const editingId = closed.editingTask?.id ?? '';
      const editingTask = await taskRow(editingId);
      expect(editingTask).toMatchObject({
        assigneeId: cast.photographer.id,
        clientId,
        retainerCycleId: cycle.id,
        cycleLineId: null,
        brief: 'تم التصوير بالكامل',
        needsClientApproval: true,
      });
      const dependencies = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, editingId));
      expect(dependencies.map((row) => row.dependsOnId)).toEqual([shoot.task.id]);
      const links = await db.select().from(taskLinks).where(eq(taskLinks.taskId, editingId));
      expect(links.map((row) => row.url)).toEqual(['https://drive.example.com/raw?token=secret']);
      const taskAudit = await cast.auditOf(shoot.task.id);
      expect(taskAudit.at(-1)).toMatchObject({
        action: 'task.status_changed',
        after: { status: 'delivered', reason: 'shoot_closed', shootId: shoot.id },
      });
      const completed = (await cast.auditOf(shoot.id)).at(-1);
      expect(completed).toMatchObject({ action: 'shoot.completed' });
      // Links may carry share tokens: the audit keeps the site only.
      expect(completed?.after).toMatchObject({
        rawFilesSite: 'drive.example.com',
        editingTaskId: editingId,
        untickedShots: 1,
      });
      expect(JSON.stringify(completed?.after)).not.toContain('secret');
      await expectError(
        await action(shoot.id, 'close', cast.gm.cookie, { editingTask: null }),
        409,
        'SHOOT_NOT_SCHEDULED',
      );
    });

    it('closes without an editing task and leaves a task delivered by hand as it is', async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId, { assigneeId: cast.photographer.id })).id,
        startsAt: cast.at(-1, '10:00'),
        endsAt: cast.at(-1, '12:00'),
      });
      // Rule 9: delivering the task by hand stays allowed.
      for (const [status, cookie] of [
        ['in_progress', cast.photographer.cookie],
        ['internal_review', cast.photographer.cookie],
        ['approved', cast.photographyManager.cookie],
        ['delivered', cast.photographer.cookie],
      ] as const) {
        await cast.moveOk(shoot.task.id, cookie, { status });
      }
      const before = await cast.auditOf(shoot.task.id);
      const closed = await ok(
        await action(shoot.id, 'close', cast.gm.cookie, { editingTask: null }),
      );
      expect(closed).toMatchObject({ editingTask: null, task: { status: 'delivered' } });
      expect(await cast.auditOf(shoot.task.id)).toHaveLength(before.length);
    });

    it('needs the shoot started, and shoot scope or the lead', async () => {
      const future = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
      });
      await expectError(
        await action(future.id, 'close', cast.gm.cookie, { editingTask: null }),
        409,
        'SHOOT_NOT_STARTED',
      );
      // The designer leads; the employee is neither crew nor shoot scope.
      const shoot = await startedShoot(cast.designer.id);
      expect(shoot.permissions).toMatchObject({ canClose: true });
      expect(
        (await action(shoot.id, 'close', cast.employee.cookie, { editingTask: null })).status,
      ).toBe(403);
      const asLead = await client.get(`/api/shoots/${shoot.id}`, cast.designer.cookie);
      expect(shootDetailSchema.parse(await asLead.json()).permissions).toMatchObject({
        canClose: true,
        canEdit: false,
        canTick: true,
      });
      await ok(await action(shoot.id, 'close', cast.designer.cookie, { editingTask: null }));
    });

    it("checks the editing task: its due date, assignee and the closer's scope", async () => {
      const shoot = await startedShoot(cast.designer.id, {
        crew: [
          { userId: cast.designer.id, role: 'assistant', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
      });
      expect(
        (
          await action(shoot.id, 'close', cast.designer.cookie, {
            editingTask: editing({ dueDate: cast.inDays(-1) }),
          })
        ).status,
      ).toBe(400);
      // Team crew outside the department.
      await expectError(
        await action(shoot.id, 'close', cast.designer.cookie, {
          editingTask: editing({ assigneeId: cast.designer.id }),
        }),
        400,
        'INVALID_ASSIGNEE',
      );
      // Not crew: the lead needs assign scope over the new task.
      expect(
        (
          await action(shoot.id, 'close', cast.designer.cookie, {
            editingTask: editing({ assigneeId: cast.photographyManager.id }),
          })
        ).status,
      ).toBe(403);
      // Team crew in the department needs no scope.
      const closed = await ok(
        await action(shoot.id, 'close', cast.designer.cookie, {
          editingTask: editing({ assigneeId: cast.videographer.id }),
        }),
      );
      expect((await taskRow(closed.editingTask?.id ?? '')).assigneeId).toBe(cast.videographer.id);
      expect(await cast.typesOf(cast.videographer.id, closed.editingTask?.id ?? '')).toEqual([
        'task_assigned',
      ]);
    });
  });

  describe('cancel and reopen (rule 13)', () => {
    it('keeps the task open and bookable, and reopens while it stays free', async () => {
      const shoot = await cast.bookOk(cast.am.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        crew: [
          { userId: cast.photographer.id, role: 'photographer', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
      });
      expect((await action(shoot.id, 'cancel', cast.designer.cookie, { reason: 'x' })).status).toBe(
        403,
      );
      const cancelled = await ok(
        await action(shoot.id, 'cancel', cast.am.cookie, { reason: 'طلب العميل التأجيل' }),
      );
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'طلب العميل التأجيل',
        conflict: false,
        task: { status: shoot.task.status },
        permissions: { canReopen: true, canCancel: false },
      });
      expect(await cast.typesOf(cast.videographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_dropped',
      ]);
      await expectError(
        await action(shoot.id, 'cancel', cast.am.cookie, { reason: 'x' }),
        409,
        'SHOOT_NOT_SCHEDULED',
      );
      // Other tests book the photographer at the same time.
      const reopened = await ok(
        await action(shoot.id, 'reopen', cast.am.cookie, { acceptConflicts: true }),
      );
      expect(reopened).toMatchObject({ status: 'scheduled', cancelReason: null });
      await expectError(
        await action(shoot.id, 'reopen', cast.am.cookie),
        409,
        'SHOOT_NOT_CANCELLED',
      );
      expect((await cast.auditOf(shoot.id)).map((entry) => entry.action)).toEqual([
        'shoot.created',
        'shoot.cancelled',
        'shoot.reopened',
      ]);

      // Rebooked meanwhile, the task belongs to the new shoot.
      await ok(await action(shoot.id, 'cancel', cast.am.cookie, { reason: 'تأجيل' }));
      await cast.bookOk(cast.am.cookie, { taskId: shoot.task.id });
      await expectError(await action(shoot.id, 'reopen', cast.am.cookie), 409, 'TASK_NOT_BOOKABLE');
    });

    it('cancels the shoot task too when asked, with the same reason', async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
      });
      await ok(
        await action(shoot.id, 'cancel', cast.gm.cookie, {
          reason: 'ألغي المشروع',
          cancelTask: true,
        }),
      );
      expect(await taskRow(shoot.task.id)).toMatchObject({
        status: 'cancelled',
        cancelReason: 'ألغي المشروع',
      });
      expect((await cast.auditOf(shoot.task.id)).at(-1)).toMatchObject({
        action: 'task.status_changed',
        after: { status: 'cancelled', shootId: shoot.id },
      });
      await expectError(await action(shoot.id, 'reopen', cast.gm.cookie), 409, 'TASK_NOT_BOOKABLE');
    });

    it('warns about conflicts when reopening', async () => {
      const day = 40;
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(day, '10:00'),
        endsAt: cast.at(day, '11:00'),
        acceptConflicts: false,
      });
      await ok(await action(shoot.id, 'cancel', cast.gm.cookie, { reason: 'تأجيل' }));
      await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(day, '10:30'),
        endsAt: cast.at(day, '11:30'),
        acceptConflicts: false,
      });
      await expectError(await action(shoot.id, 'reopen', cast.gm.cookie), 409, 'SCHEDULE_CONFLICT');
      const reopened = await ok(
        await action(shoot.id, 'reopen', cast.gm.cookie, { acceptConflicts: true }),
      );
      expect(reopened.conflict).toBe(true);
    });
  });
});
