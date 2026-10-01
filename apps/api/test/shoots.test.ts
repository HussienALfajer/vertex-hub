import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  conflictListSchema,
  type ErrorResponse,
  postDetailSchema,
  type ScheduleConflict,
  shootDetailSchema,
  shootPageSchema,
  shotSchema,
  taskDetailSchema,
} from '@vertex-hub/contracts';
import { createDatabase, shoots, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, seedUser } from './helpers.js';
import { seedShootCast } from './shoot-cast.js';
import { startApp } from './start-app.js';

/*
 * F11 PR 1: booking shoots (rules 1–9), conflicts, edits, the shot list, archive and restore, and
 * the guards on the shoot task.
 */
describe('shoots (F11 rules 1–9)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedShootCast>>;
  let clientId: string;
  let otherClientId: string;

  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/shoots/${id}`, { cookie, body });
  const putShots = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', `/api/shoots/${id}/shots`, { cookie, body });
  const tick = (id: string, shotId: string, cookie: string | undefined, done = true) =>
    client.post(`/api/shoots/${id}/shots/${shotId}/done`, cookie, { done });
  const action = (id: string, name: string, cookie: string | undefined, body: unknown = {}) =>
    client.post(`/api/shoots/${id}/${name}`, cookie, body);

  async function ok(response: Response) {
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return shootDetailSchema.parse(await response.json());
  }

  const taskRow = async (id: string) => {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw new Error(`Task ${id} not found`);
    return row;
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedShootCast(db, client);
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session on every route', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      client.get('/api/shoots'),
      client.get(`/api/shoots/${id}`),
      client.post('/api/shoots', undefined, cast.booking({ taskId: id })),
      patch(id, undefined, { title: 'x' }),
      putShots(id, undefined, { shots: [] }),
      tick(id, id, undefined),
      action(id, 'close', undefined, { editingTask: null }),
      action(id, 'cancel', undefined, { reason: 'x' }),
      action(id, 'reopen', undefined),
      action(id, 'archive', undefined),
      action(id, 'restore', undefined),
      client.get(
        `/api/calendar/conflicts?userIds=${id}&startsAt=${cast.at(1, '10:00')}&endsAt=${cast.at(1, '11:00')}`,
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 401));
  });

  describe('booking (rules 1–4, 6)', () => {
    it('books an existing task: the shoot takes its client and the task is due on its day', async () => {
      const task = await cast.photoTask(clientId);
      const shoot = await cast.bookOk(cast.am.cookie, {
        taskId: task.id,
        crew: [
          { userId: cast.photographer.id, role: 'photographer', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
        externalCrew: [{ name: 'سامي', role: 'assistant', phone: '00963 944 123 456' }],
      });
      expect(shoot).toMatchObject({
        status: 'scheduled',
        client: { id: clientId },
        lead: { id: cast.photographer.id },
        crewCount: 3,
        task: { id: task.id, status: task.status },
        permissions: { canEdit: true, canClose: false, canCancel: true, canArchive: false },
      });
      expect(shoot.crew.map((member) => member.user.id)).toEqual([
        cast.photographer.id,
        cast.videographer.id,
      ]);
      expect(shoot.shots.map((shot) => [shot.position, shot.text])).toEqual([
        [1, 'لقطة أمامية'],
        [2, 'لقطة جانبية'],
      ]);
      expect((await taskRow(task.id)).dueDate).toBe(cast.inDays(1));
      expect(await cast.typesOf(cast.photographer.id, shoot.id)).toEqual(['shoot_booked']);
      expect(await cast.typesOf(cast.videographer.id, shoot.id)).toEqual(['shoot_booked']);
      expect(await cast.typesOf(cast.am.id, shoot.id)).toEqual([]);
      const [created] = await cast.auditOf(shoot.id);
      expect(created).toMatchObject({ action: 'shoot.created', actorId: cast.am.id });
      expect(created?.after).toMatchObject({ taskId: task.id, crew: expect.any(Array) });
      const taskAudit = await cast.auditOf(task.id);
      expect(taskAudit.at(-1)).toMatchObject({
        action: 'task.updated',
        after: { dueDate: cast.inDays(1) },
      });
    });

    it('creates a Photography shoot task assigned to a lead from Photography (rule 3)', async () => {
      const shoot = await cast.bookOk(cast.photographer.cookie, {
        newTask: {},
        clientId: null,
      });
      const task = await taskRow(shoot.task.id);
      expect(task).toMatchObject({
        department: 'photography',
        assigneeId: cast.photographer.id,
        clientId: null,
        dueDate: cast.inDays(1),
        needsClientApproval: false,
        createdById: cast.photographer.id,
      });
      expect(task.title).toContain(shoot.title);
      expect(await cast.typesOf(cast.photographer.id, task.id)).toEqual([]);
    });

    it('leaves the new shoot task in the queue when the lead is not in Photography', async () => {
      const { cycle, line } = await cast.shootRetainer(clientId);
      const shoot = await cast.bookOk(cast.am.cookie, {
        newTask: { retainerCycleId: cycle.id, cycleLineId: line.id },
        clientId,
        crew: [{ userId: cast.designer.id, role: 'other', isLead: true }],
      });
      const task = await taskRow(shoot.task.id);
      expect(task).toMatchObject({
        assigneeId: null,
        retainerCycleId: cycle.id,
        cycleLineId: line.id,
      });
      // The department queue hears about it (F06 `task_requested`).
      expect(await cast.typesOf(cast.photographyManager.id, task.id)).toEqual(['task_requested']);
    });

    it('checks the links of a new shoot task like F06', async () => {
      const project = await cast.createProject(otherClientId);
      await expectError(
        await cast.book(cast.gm.cookie, { newTask: { projectId: project.id }, clientId }),
        400,
        'INVALID_LINK',
      );
    });

    it('refuses tasks that are not bookable (rule 2, edge case 1)', async () => {
      const design = await cast.createTask(cast.gm.cookie, { clientId });
      await expectError(
        await cast.book(cast.gm.cookie, { taskId: design.id }),
        409,
        'TASK_NOT_BOOKABLE',
      );
      const cancelled = await cast.photoTask(clientId);
      await cast.moveOk(cancelled.id, cast.gm.cookie, { status: 'cancelled', note: 'لا حاجة' });
      await expectError(
        await cast.book(cast.gm.cookie, { taskId: cancelled.id }),
        409,
        'TASK_NOT_BOOKABLE',
      );
      const booked = await cast.photoTask(clientId);
      await cast.bookOk(cast.gm.cookie, { taskId: booked.id });
      await expectError(
        await cast.book(cast.gm.cookie, { taskId: booked.id }),
        409,
        'TASK_NOT_BOOKABLE',
      );
      expect(
        (await client.post('/api/shoots', cast.gm.cookie, cast.booking({ taskId: randomUUID() })))
          .status,
      ).toBe(404);
    });

    it('refuses a task linked to a post: publishing the post delivers it (F08 rule 18)', async () => {
      const created = await client.post('/api/content/posts', cast.writer.cookie, {
        clientId,
        title: `ريل ${cast.run}`,
        type: 'reel',
        platforms: ['instagram'],
        publishDate: cast.inDays(5),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const post = postDetailSchema.parse(await created.json());
      const task = await cast.photoTask(clientId);
      const linked = await client.request('PUT', `/api/content/posts/${post.id}/tasks/${task.id}`, {
        cookie: cast.writer.cookie,
      });
      expect(linked.status, await linked.clone().text()).toBe(200);
      await expectError(
        await cast.book(cast.gm.cookie, { taskId: task.id }),
        409,
        'TASK_NOT_BOOKABLE',
      );
    });

    it('needs exactly one lead and active crew (rule 6)', async () => {
      const task = await cast.photoTask(clientId);
      await expectError(
        await cast.book(cast.gm.cookie, {
          taskId: task.id,
          crew: [{ userId: cast.photographer.id, role: 'photographer', isLead: false }],
        }),
        400,
        'LEAD_REQUIRED',
      );
      await expectError(
        await cast.book(cast.gm.cookie, {
          taskId: task.id,
          crew: [
            { userId: cast.photographer.id, role: 'photographer', isLead: true },
            { userId: cast.videographer.id, role: 'videographer', isLead: true },
          ],
        }),
        400,
        'LEAD_REQUIRED',
      );
      const archived = await seedUser(db, {
        archived: true,
        departments: [{ code: 'photography' }],
      });
      cast.trackUser(archived.id);
      await expectError(
        await cast.book(cast.gm.cookie, {
          taskId: task.id,
          crew: [
            { userId: cast.photographer.id, role: 'photographer', isLead: true },
            { userId: archived.id, role: 'assistant', isLead: false },
          ],
        }),
        400,
        'INVALID_CREW',
      );
    });

    it('lets only shoot scope book (Roles and access)', async () => {
      const task = await cast.photoTask(clientId);
      // No `shoots.manage`.
      expect((await cast.book(cast.designer.cookie, { taskId: task.id })).status).toBe(403);
      expect((await cast.book(cast.photographyManager.cookie, { taskId: task.id })).status).toBe(
        201,
      );
      // An account manager books for their own clients only, and never an internal shoot.
      const other = await cast.photoTask(otherClientId);
      expect((await cast.book(cast.am.cookie, { taskId: other.id })).status).toBe(403);
      expect(
        (await cast.book(cast.am.cookie, { taskId: undefined, newTask: {}, clientId: null }))
          .status,
      ).toBe(403);
      const internal = await cast.photoTask(null);
      expect((await cast.book(cast.am.cookie, { taskId: internal.id })).status).toBe(403);
      expect((await cast.book(cast.operations.cookie, { taskId: internal.id })).status).toBe(201);
    });
  });

  describe('conflicts (rule 5)', () => {
    /** A day of its own per test, so other bookings never overlap. */
    let day = 20;
    const nextDay = () => {
      day += 1;
      return day;
    };

    it('warns about overlapping bookings until they are accepted', async () => {
      const d = nextDay();
      const first = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '10:00'),
        endsAt: cast.at(d, '13:00'),
        acceptConflicts: false,
      });
      expect(first.conflict).toBe(false);
      const second = {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '12:00'),
        endsAt: cast.at(d, '14:00'),
        crew: [
          { userId: cast.videographer.id, role: 'videographer' as const, isLead: true },
          { userId: cast.photographer.id, role: 'photographer' as const, isLead: false },
        ],
        acceptConflicts: false,
      };
      const refused = await cast.book(cast.gm.cookie, second);
      const body = (await expectError(refused, 409, 'SCHEDULE_CONFLICT')) as ErrorResponse;
      expect(body.details).toEqual([
        expect.objectContaining({
          user: { id: cast.photographer.id, name: cast.photographer.name },
          kind: 'shoot',
          id: first.id,
          title: first.title,
        }),
      ] satisfies Partial<ScheduleConflict>[]);
      const accepted = await cast.bookOk(cast.gm.cookie, { ...second, acceptConflicts: true });
      expect(accepted.conflict).toBe(true);
      expect(accepted.conflicts.map((conflict) => conflict.id)).toEqual([first.id]);
      expect((await cast.detail(first.id)).conflict).toBe(true);
      const [created] = await cast.auditOf(accepted.id);
      expect(created?.after).toMatchObject({
        acceptedConflicts: [expect.objectContaining({ id: first.id })],
      });

      // The live check of the form, without the shoot being edited.
      const query = new URLSearchParams({
        startsAt: cast.at(d, '12:30'),
        endsAt: cast.at(d, '12:45'),
        excludeShootId: accepted.id,
      });
      query.append('userIds', cast.photographer.id);
      query.append('userIds', cast.designer.id);
      const response = await client.get(`/api/calendar/conflicts?${query}`, cast.designer.cookie);
      expect(response.status).toBe(200);
      expect(conflictListSchema.parse(await response.json()).items.map((c) => c.id)).toEqual([
        first.id,
      ]);
    });

    it('treats touching bookings as free, and ignores cancelled ones and external crew', async () => {
      const d = nextDay();
      const first = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '10:00'),
        endsAt: cast.at(d, '12:00'),
        acceptConflicts: false,
      });
      await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '12:00'),
        endsAt: cast.at(d, '13:00'),
        acceptConflicts: false,
      });
      await ok(await action(first.id, 'cancel', cast.gm.cookie, { reason: 'تأجيل' }));
      const again = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '10:30'),
        endsAt: cast.at(d, '11:30'),
        externalCrew: [{ name: cast.photographer.name, role: 'assistant' }],
        acceptConflicts: false,
      });
      expect(again.conflict).toBe(false);
    });

    it('re-checks on edits of the time or crew, and never against the shoot itself', async () => {
      const d = nextDay();
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '10:00'),
        endsAt: cast.at(d, '11:00'),
        acceptConflicts: false,
      });
      const other = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(d, '14:00'),
        endsAt: cast.at(d, '15:00'),
        crew: [{ userId: cast.videographer.id, role: 'videographer', isLead: true }],
        acceptConflicts: false,
      });
      await ok(
        await patch(shoot.id, cast.gm.cookie, {
          startsAt: cast.at(d, '10:30'),
          endsAt: cast.at(d, '11:30'),
        }),
      );
      await expectError(
        await patch(shoot.id, cast.gm.cookie, {
          crew: [
            { userId: cast.photographer.id, role: 'photographer', isLead: true },
            { userId: cast.videographer.id, role: 'videographer', isLead: false },
          ],
          startsAt: cast.at(d, '14:30'),
          endsAt: cast.at(d, '15:30'),
        }),
        409,
        'SCHEDULE_CONFLICT',
      );
      // Editing only the title checks nothing.
      await ok(await patch(other.id, cast.gm.cookie, { title: 'عنوان جديد' }));
    });
  });

  describe('edits (rules 4, 6, 8)', () => {
    it('moves the shoot task with the shoot and tells the crew what changed', async () => {
      const task = await cast.photoTask(clientId);
      const shoot = await cast.bookOk(cast.am.cookie, {
        taskId: task.id,
        crew: [
          { userId: cast.photographer.id, role: 'photographer', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
      });
      const edited = await ok(
        await patch(shoot.id, cast.am.cookie, {
          startsAt: cast.at(2, '09:00'),
          endsAt: cast.at(2, '11:00'),
          crew: [
            { userId: cast.photographer.id, role: 'photographer', isLead: true },
            { userId: cast.photographyManager.id, role: 'director', isLead: false },
          ],
        }),
      );
      expect(edited.crew.map((member) => [member.user.id, member.role])).toEqual([
        [cast.photographer.id, 'photographer'],
        [cast.photographyManager.id, 'director'],
      ]);
      expect((await taskRow(task.id)).dueDate).toBe(cast.inDays(2));
      expect(await cast.typesOf(cast.photographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_changed',
      ]);
      expect(await cast.typesOf(cast.videographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_dropped',
      ]);
      expect(await cast.typesOf(cast.photographyManager.id, shoot.id)).toEqual(['shoot_booked']);
      const updated = (await cast.auditOf(shoot.id)).at(-1);
      expect(updated).toMatchObject({ action: 'shoot.updated' });
      expect(updated?.before).toHaveProperty('crew');
      expect(updated?.after).toMatchObject({ startsAt: cast.at(2, '09:00') });

      // A new lead is a change for the whole crew.
      await ok(
        await patch(shoot.id, cast.am.cookie, {
          crew: [
            { userId: cast.photographer.id, role: 'photographer', isLead: false },
            { userId: cast.photographyManager.id, role: 'director', isLead: true },
          ],
        }),
      );
      expect((await cast.detail(shoot.id)).lead.id).toBe(cast.photographyManager.id);
      expect(await cast.typesOf(cast.photographer.id, shoot.id)).toHaveLength(3);
    });

    it('lets only shoot scope edit, while the shoot is scheduled', async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(otherClientId)).id,
      });
      expect((await patch(shoot.id, cast.am.cookie, { title: 'x' })).status).toBe(403);
      expect((await patch(shoot.id, cast.designer.cookie, { title: 'x' })).status).toBe(403);
      await ok(await action(shoot.id, 'cancel', cast.gm.cookie, { reason: 'ألغاها العميل' }));
      await expectError(
        await patch(shoot.id, cast.otherAm.cookie, { title: 'x' }),
        409,
        'SHOOT_NOT_SCHEDULED',
      );
    });
  });

  describe('the shot list (rule 7)', () => {
    it('keeps the ids and ticks of the items it keeps', async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        shots: [{ text: 'أ' }, { text: 'ب' }, { text: 'ج' }],
      });
      const [a, b, c] = shoot.shots;
      if (!a || !b || !c) throw new Error('The shot list was not saved');
      const ticked = shotSchema.parse(
        await (await tick(shoot.id, b.id, cast.photographer.cookie)).json(),
      );
      expect(ticked).toMatchObject({ id: b.id, doneBy: { id: cast.photographer.id } });
      const saved = await ok(
        await putShots(shoot.id, cast.gm.cookie, {
          shots: [
            { id: b.id, text: 'ب', note: 'من الأعلى' },
            { text: 'د' },
            { id: a.id, text: 'أ' },
          ],
        }),
      );
      expect(saved.shots.map((shot) => [shot.position, shot.text, !!shot.doneAt])).toEqual([
        [1, 'ب', true],
        [2, 'د', false],
        [3, 'أ', false],
      ]);
      expect(saved.shots[0]).toMatchObject({ id: b.id, note: 'من الأعلى' });
      expect(saved.shots.some((shot) => shot.id === c.id)).toBe(false);
      expect((await cast.auditOf(shoot.id)).map((entry) => entry.action)).toEqual([
        'shoot.created',
        'shoot.shot_ticked',
        'shoot.shots_changed',
      ]);
      expect(
        (await putShots(shoot.id, cast.gm.cookie, { shots: [{ id: randomUUID(), text: 'x' }] }))
          .status,
      ).toBe(400);
    });

    it('lets team crew and shoot scope tick, nobody else, while scheduled', async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        crew: [{ userId: cast.designer.id, role: 'assistant', isLead: true }],
      });
      const [shot] = shoot.shots;
      if (!shot) throw new Error('No shot');
      expect((await tick(shoot.id, shot.id, cast.designer.cookie)).status).toBe(200);
      expect((await tick(shoot.id, shot.id, cast.designer.cookie, false)).status).toBe(200);
      expect((await tick(shoot.id, shot.id, cast.employee.cookie)).status).toBe(403);
      expect((await tick(shoot.id, shot.id, cast.am.cookie)).status).toBe(200);
      expect((await tick(shoot.id, randomUUID(), cast.am.cookie)).status).toBe(404);
      expect((await putShots(shoot.id, cast.designer.cookie, { shots: [] })).status).toBe(403);
      await ok(await action(shoot.id, 'cancel', cast.gm.cookie, { reason: 'ألغيت' }));
      await expectError(
        await tick(shoot.id, shot.id, cast.designer.cookie),
        409,
        'SHOOT_NOT_SCHEDULED',
      );
      await expectError(
        await putShots(shoot.id, cast.gm.cookie, { shots: [] }),
        409,
        'SHOOT_NOT_SCHEDULED',
      );
    });
  });

  describe('scope on every change (Roles and access)', () => {
    it("refuses an account manager on another manager's client", async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(otherClientId)).id,
        startsAt: cast.at(-1, '10:00'),
        endsAt: cast.at(-1, '11:00'),
      });
      expect((await putShots(shoot.id, cast.am.cookie, { shots: [] })).status).toBe(403);
      expect((await action(shoot.id, 'close', cast.am.cookie, { editingTask: null })).status).toBe(
        403,
      );
      expect((await action(shoot.id, 'cancel', cast.am.cookie, { reason: 'x' })).status).toBe(403);
      await ok(await action(shoot.id, 'cancel', cast.gm.cookie, { reason: 'تأجيل' }));
      expect((await action(shoot.id, 'reopen', cast.am.cookie)).status).toBe(403);
      expect((await action(shoot.id, 'reopen', cast.designer.cookie)).status).toBe(403);
      // The other client's account manager holds the scope.
      await ok(await action(shoot.id, 'reopen', cast.otherAm.cookie, { acceptConflicts: true }));
      await ok(await action(shoot.id, 'archive', cast.gm.cookie));
      expect((await action(shoot.id, 'restore', cast.otherAm.cookie)).status).toBe(403);
      expect((await action(shoot.id, 'restore', cast.designer.cookie)).status).toBe(403);
      await ok(await action(shoot.id, 'restore', cast.operations.cookie));
    });
  });

  describe('lists, archive and restore', () => {
    it('lists by crew member and task, and archived shoots for scope all only', async () => {
      const task = await cast.photoTask(clientId);
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: task.id,
        crew: [{ userId: cast.videographer.id, role: 'videographer', isLead: true }],
      });
      const byTask = await client.get(`/api/shoots?taskId=${task.id}`, cast.designer.cookie);
      expect(shootPageSchema.parse(await byTask.json()).items.map((item) => item.id)).toEqual([
        shoot.id,
      ]);
      const mine = await client.get(`/api/shoots?userId=me&pageSize=100`, cast.videographer.cookie);
      expect(shootPageSchema.parse(await mine.json()).items.map((item) => item.id)).toContain(
        shoot.id,
      );
      expect((await client.get('/api/shoots?archived=true', cast.am.cookie)).status).toBe(403);

      expect((await action(shoot.id, 'archive', cast.am.cookie)).status).toBe(403);
      const archived = await ok(await action(shoot.id, 'archive', cast.photographer.cookie));
      expect(archived.archivedAt).not.toBeNull();
      expect((await client.get(`/api/shoots/${shoot.id}`, cast.designer.cookie)).status).toBe(404);
      await expectError(await action(shoot.id, 'archive', cast.gm.cookie), 409, 'SHOOT_ARCHIVED');
      const list = await client.get(`/api/shoots?archived=true&taskId=${task.id}`, cast.gm.cookie);
      expect(shootPageSchema.parse(await list.json()).items.map((item) => item.id)).toEqual([
        shoot.id,
      ]);
      // Archived, the shoot no longer holds the task: booked again, the old one cannot return.
      const again = await cast.bookOk(cast.gm.cookie, { taskId: task.id });
      await expectError(
        await action(shoot.id, 'restore', cast.gm.cookie),
        409,
        'TASK_NOT_BOOKABLE',
      );
      await ok(await action(again.id, 'cancel', cast.gm.cookie, { reason: 'مكرر' }));
      const restored = await ok(await action(shoot.id, 'restore', cast.gm.cookie));
      expect(restored).toMatchObject({ archivedAt: null, status: 'scheduled' });
      await expectError(
        await action(shoot.id, 'restore', cast.gm.cookie),
        409,
        'SHOOT_NOT_ARCHIVED',
      );
      expect((await cast.auditOf(shoot.id)).map((entry) => entry.action)).toEqual([
        'shoot.created',
        'shoot.archived',
        'shoot.restored',
      ]);
    });
  });

  describe('the shoot task (rule 9, edge case 7)', () => {
    it('refuses to cancel, archive or move a task a scheduled shoot holds', async () => {
      const task = await cast.photoTask(clientId);
      const shoot = await cast.bookOk(cast.gm.cookie, { taskId: task.id });
      await expectError(
        await cast.move(task.id, cast.gm.cookie, { status: 'cancelled', note: 'لا حاجة' }),
        409,
        'TASK_HAS_SHOOT',
      );
      await expectError(
        await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie, {}),
        409,
        'TASK_HAS_SHOOT',
      );
      await expectError(
        await client.request('PATCH', `/api/tasks/${task.id}`, {
          cookie: cast.gm.cookie,
          body: { department: 'design' },
        }),
        409,
        'TASK_HAS_SHOOT',
      );
      // Other edits stay open on the task page.
      const renamed = await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: cast.gm.cookie,
        body: { priority: 'high' },
      });
      expect(renamed.status).toBe(200);
      await ok(await action(shoot.id, 'cancel', cast.gm.cookie, { reason: 'تأجيل' }));
      const cancelled = await cast.move(task.id, cast.gm.cookie, {
        status: 'cancelled',
        note: 'لا حاجة',
      });
      expect(taskDetailSchema.parse(await cancelled.json()).status).toBe('cancelled');
    });

    it('keeps a project with a scheduled shoot from being cancelled', async () => {
      const project = await cast.createProject(clientId);
      const shoot = await cast.bookOk(cast.gm.cookie, {
        newTask: { projectId: project.id },
        clientId,
      });
      const body = await expectError(
        await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
          status: 'cancelled',
          reason: 'أوقفه العميل',
        }),
        409,
        'TASK_HAS_SHOOT',
      );
      expect(body.details).toEqual([{ taskId: shoot.task.id, title: shoot.title }]);
      const [row] = await db.select().from(shoots).where(eq(shoots.id, shoot.id));
      expect(row?.status).toBe('scheduled');
    });
  });
});
