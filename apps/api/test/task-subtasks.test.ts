import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreateSubtaskInput,
  isWorkDay,
  myTaskSummarySchema,
  type NotificationType,
  projectDetailSchema,
  type TaskDetail,
  taskBoardSchema,
  taskDetailSchema,
  taskPageSchema,
  taskStageSchema,
  taskSubtasksSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, notifications, taskRevisions, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyReminders } from '../src/modules/notifications/index.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('subtasks (F06B part A)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const put = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', path, { cookie, body });
  const patch = (path: string, cookie: string, body: unknown) =>
    client.request('PATCH', path, { cookie, body });

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

  const noticeOf = async (recipientId: string, subjectId: string, type: NotificationType) => {
    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.subjectId, subjectId),
          eq(notifications.type, type),
        ),
      );
    return row;
  };

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action as never)))
      .orderBy(asc(auditEntries.id));

  /** A content task assigned to the writer, due in 10 days: a parent for most tests. */
  const parentTask = (input: Parameters<typeof cast.createTask>[1] = {}) =>
    cast.createTask(cast.contentManager.cookie, {
      title: `حملة ${cast.run}`,
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: cast.inDays(10),
      ...input,
    });

  const addRaw = (
    parentId: string,
    cookie: string | undefined,
    input: Partial<CreateSubtaskInput>,
  ) =>
    client.request('POST', `/api/tasks/${parentId}/subtasks`, {
      cookie,
      body: { title: `فرعية ${cast.run}`, department: 'design', dueDate: cast.inDays(5), ...input },
    });

  async function addSubtask(
    parentId: string,
    cookie: string,
    input: Partial<CreateSubtaskInput> = {},
  ): Promise<TaskDetail> {
    const response = await addRaw(parentId, cookie, input);
    if (response.status !== 201) {
      throw new Error(`Subtask creation failed: ${response.status} ${await response.text()}`);
    }
    return taskDetailSchema.parse(await response.json());
  }

  /** Works a subtask through review: its assignee starts and submits, `reviewer` approves. */
  async function deliver(id: string, assigneeCookie: string, reviewerCookie: string) {
    await cast.moveOk(id, assigneeCookie, { status: 'in_progress' });
    await cast.moveOk(id, assigneeCookie, { status: 'internal_review' });
    return cast.moveOk(id, reviewerCookie, { status: 'delivered' });
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it("lets the parent's assignee add subtasks, each checked as its own create (rules A1, A2)", async () => {
    const parent = await parentTask();
    expect(parent.permissions.canManageSubtasks).toBe(true);
    expect((await cast.detail(parent.id, cast.writer.cookie)).permissions.canManageSubtasks).toBe(
      true,
    );
    expect((await cast.detail(parent.id, cast.employee.cookie)).permissions.canManageSubtasks).toBe(
      false,
    );

    expect((await addRaw(parent.id, undefined, {})).status).toBe(401);
    expect((await addRaw(parent.id, cast.employee.cookie, {})).status).toBe(403);
    expect((await addRaw(randomUUID(), cast.writer.cookie, {})).status).toBe(404);
    // The writer has no assign scope in Design: a designer is not theirs to assign.
    expect(
      (await addRaw(parent.id, cast.writer.cookie, { assigneeId: cast.designer.id })).status,
    ).toBe(403);
    await expectError(
      await addRaw(parent.id, cast.writer.cookie, { dueDate: cast.inDays(11) }),
      400,
      'INVALID_DATES',
    );

    const copy = await addSubtask(parent.id, cast.writer.cookie, {
      title: `نص ${cast.run}`,
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: cast.inDays(3),
    });
    expect(copy).toMatchObject({
      parent: { id: parent.id, status: 'new' },
      needsClientApproval: false,
      runMode: null,
      subtasks: [],
    });
    const design = await addSubtask(parent.id, cast.writer.cookie);
    expect(design.assignee).toBeNull();
    // A queued subtask is a request to the department's managers, naming its parent.
    expect(await typesOf(cast.designManager.id, design.id)).toContain('task_requested');
    const [requested] = await db
      .select({ data: notifications.data })
      .from(notifications)
      .where(and(eq(notifications.subjectId, design.id), eq(notifications.type, 'task_requested')));
    expect(requested?.data).toMatchObject({ task: { parent: parent.title } });

    const after = await cast.detail(parent.id, cast.writer.cookie);
    expect(after).toMatchObject({
      runMode: 'sequential',
      progress: { delivered: 0, total: 2 },
      subtasks: [
        { id: copy.id, position: 1, waitingOn: [], blocked: false },
        { id: design.id, position: 2, waitingOn: [{ id: copy.id }], blocked: true },
      ],
    });
    expect(after.dependents).toEqual([]);
    expect((await cast.detail(design.id, cast.gm.cookie)).dependencies).toMatchObject([
      { id: copy.id, source: 'run' },
    ]);
    expect((await auditOf(parent.id, 'task.run_mode_changed'))[0]?.after).toEqual({
      runMode: 'sequential',
    });
    expect((await auditOf(design.id, 'task.created'))[0]?.after).toMatchObject({
      parentId: parent.id,
      position: 2,
    });
    // The parent's assignee follows each subtask.
    await expectError(await addRaw(copy.id, cast.writer.cookie, {}), 409, 'SUBTASK_DEPTH');

    // A subtask in front of the others moves them down and rewrites the run.
    const first = await addSubtask(parent.id, cast.contentManager.cookie, {
      department: 'content_management',
      position: 1,
      dueDate: cast.inDays(2),
    });
    expect(
      (await cast.detail(parent.id, cast.gm.cookie)).subtasks.map((s) => [s.id, s.position]),
    ).toEqual([
      [first.id, 1],
      [copy.id, 2],
      [design.id, 3],
    ]);
    expect((await cast.detail(copy.id, cast.gm.cookie)).dependencies).toMatchObject([
      { id: first.id, source: 'run' },
    ]);
  });

  it('runs a sequence: review by the parent, handover, the parent waits (rules A6–A9, A12)', async () => {
    const parent = await parentTask();
    const copy = await addSubtask(parent.id, cast.writer.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: cast.inDays(3),
    });
    const design = await addSubtask(parent.id, cast.writer.cookie);

    // Rule A12: the handover note is the subtask's, written by its assignee.
    expect(
      (await put(`/api/tasks/${copy.id}/handover-note`, cast.designer.cookie, { note: 'x' }))
        .status,
    ).toBe(403);
    await expectError(
      await put(`/api/tasks/${parent.id}/handover-note`, cast.writer.cookie, { note: 'x' }),
      400,
      'INVALID_LINK',
    );
    const noted = await put(`/api/tasks/${copy.id}/handover-note`, cast.writer.cookie, {
      note: 'النص النهائي في الملفات',
    });
    expect(noted.status).toBe(200);
    expect(taskDetailSchema.parse(await noted.json())).toMatchObject({
      handoverNote: 'النص النهائي في الملفات',
      permissions: { canWriteHandover: true },
    });
    expect((await auditOf(copy.id, 'task.handover_noted'))[0]?.after).toMatchObject({
      handoverNote: 'النص النهائي في الملفات',
    });

    await cast.moveOk(copy.id, cast.writer.cookie, { status: 'in_progress' });
    await cast.moveOk(copy.id, cast.writer.cookie, { status: 'internal_review' });
    // Rule A7: its reviewers are its department managers and the parent's assignee, not the AM.
    expect(await typesOf(cast.contentManager.id, copy.id)).toContain('task_review_requested');
    // The parent's assignee is the subtask's own assignee here: not their review.
    const own = await cast.detail(copy.id, cast.writer.cookie);
    expect(own).toMatchObject({ allowedTransitions: [], permissions: { canReview: false } });
    expect((await cast.move(copy.id, cast.writer.cookie, { status: 'delivered' })).status).toBe(
      403,
    );
    // Never the client's: no send, no approve.
    await expectError(
      await cast.move(copy.id, cast.contentManager.cookie, { status: 'awaiting_client' }),
      409,
      'INVALID_TRANSITION',
    );
    const delivered = await cast.moveOk(copy.id, cast.contentManager.cookie, {
      status: 'delivered',
    });
    expect(delivered.deliveredAt).not.toBeNull();

    // Rule A6: the queued design subtask opens to its department's managers, with the handover.
    const turn = await noticeOf(cast.designManager.id, design.id, 'subtask_turn');
    expect(turn?.data).toMatchObject({
      parent: parent.title,
      previous: { title: copy.title, note: 'النص النهائي في الملفات' },
    });

    // Rule A8: the parent waits for its subtasks.
    await cast.moveOk(parent.id, cast.writer.cookie, { status: 'in_progress' });
    const held = await expectError(
      await cast.move(parent.id, cast.writer.cookie, { status: 'internal_review' }),
      409,
      'SUBTASKS_OPEN',
    );
    expect(held.details).toMatchObject([{ id: design.id, status: 'new' }]);

    const assigned = await patch(`/api/tasks/${design.id}`, cast.designManager.cookie, {
      assigneeId: cast.designer.id,
    });
    expect(assigned.status).toBe(200);
    await cast.moveOk(design.id, cast.designer.cookie, { status: 'in_progress' });
    // Starting closes the turn.
    expect((await noticeOf(cast.designManager.id, design.id, 'subtask_turn'))?.resolution).toBe(
      'done',
    );
    await cast.moveOk(design.id, cast.designer.cookie, { status: 'internal_review' });
    expect(await typesOf(cast.writer.id, design.id)).toContain('task_review_requested');
    expect(await typesOf(cast.am.id, design.id)).not.toContain('task_review_requested');
    // The writer, the parent's assignee, may review it (as in the next test); its manager does.
    const review = await cast.detail(design.id, cast.writer.cookie);
    expect(review.allowedTransitions).toEqual(['revisions', 'delivered']);
    await cast.moveOk(design.id, cast.designManager.cookie, { status: 'delivered' });

    // Rule A9: the last one delivered tells the parent's assignee; the parent may go to review.
    const parentNow = await cast.detail(parent.id, cast.writer.cookie);
    expect(parentNow.progress).toEqual({ delivered: 2, total: 2 });
    expect(await typesOf(cast.writer.id, parent.id)).toContain('subtasks_all_finished');
    await cast.moveOk(parent.id, cast.writer.cookie, { status: 'internal_review' });
    expect((await noticeOf(cast.writer.id, parent.id, 'subtasks_all_finished'))?.resolution).toBe(
      'done',
    );
  });

  it('runs by stages with a handover summary, and rewrites the run on a mode change (rules A3, A4, A12)', async () => {
    const parent = await parentTask();
    const copy = await addSubtask(parent.id, cast.writer.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
    });
    const post = await addSubtask(parent.id, cast.gm.cookie, {
      assigneeId: cast.designer.id,
    });
    const reel = await addSubtask(parent.id, cast.writer.cookie);

    const toStages = await put(`/api/tasks/${parent.id}/run-mode`, cast.writer.cookie, {
      runMode: 'stages',
    });
    expect(toStages.status).toBe(200);
    const staged = taskSubtasksSchema.parse(await toStages.json());
    expect(staged.runMode).toBe('stages');
    expect(staged.stages).toMatchObject([{ name: 'المرحلة 1', position: 1, finished: false }]);
    const first = staged.stages[0]?.id as string;
    expect(staged.subtasks.every((s) => s.stageId === first && s.waitingOn.length === 0)).toBe(
      true,
    );

    const created = await client.post(`/api/tasks/${parent.id}/stages`, cast.writer.cookie, {
      name: 'التصميم',
    });
    expect(created.status).toBe(201);
    const design = taskStageSchema.parse(await created.json());
    expect(design.position).toBe(2);
    expect(
      (await client.post(`/api/tasks/${parent.id}/stages`, cast.employee.cookie, { name: 'x' }))
        .status,
    ).toBe(403);

    const orderPath = `/api/tasks/${parent.id}/subtasks/order`;
    await expectError(
      await put(orderPath, cast.writer.cookie, { items: [{ id: copy.id, stageId: first }] }),
      409,
      'INVALID_ORDER',
    );
    await expectError(
      await put(orderPath, cast.writer.cookie, {
        items: [
          { id: copy.id, stageId: null },
          { id: post.id, stageId: design.id },
          { id: reel.id, stageId: design.id },
        ],
      }),
      409,
      'INVALID_ORDER',
    );
    const ordered = await put(orderPath, cast.writer.cookie, {
      items: [
        { id: copy.id, stageId: first },
        { id: post.id, stageId: design.id },
        { id: reel.id, stageId: design.id },
      ],
    });
    expect(ordered.status).toBe(200);
    expect(taskSubtasksSchema.parse(await ordered.json()).subtasks).toMatchObject([
      { id: copy.id, waitingOn: [] },
      { id: post.id, waitingOn: [{ id: copy.id }] },
      { id: reel.id, waitingOn: [{ id: copy.id }] },
    ]);
    expect((await auditOf(parent.id, 'task.subtasks_reordered')).length).toBe(1);
    await expectError(
      await client.post(
        `/api/tasks/${parent.id}/stages/${design.id}/archive`,
        cast.writer.cookie,
        {},
      ),
      409,
      'STAGE_NOT_EMPTY',
    );

    await put(`/api/tasks/${copy.id}/handover-note`, cast.writer.cookie, { note: 'جاهز' });
    await deliver(copy.id, cast.writer.cookie, cast.contentManager.cookie);
    const [finished] = await auditOf(first, 'task_stage.finished');
    expect(finished?.after).toMatchObject({
      taskId: parent.id,
      handover: [{ title: copy.title, note: 'جاهز', finals: [] }],
    });
    expect((await noticeOf(cast.designer.id, post.id, 'subtask_handover'))?.data).toMatchObject({
      stage: 'المرحلة 1',
      handover: [{ title: copy.title, note: 'جاهز' }],
    });
    expect(await typesOf(cast.designManager.id, reel.id)).toContain('subtask_handover');
    expect(await typesOf(cast.writer.id, parent.id)).toContain('subtask_stage_finished');
    const page = await cast.detail(parent.id, cast.gm.cookie);
    expect(page.stages[0]).toMatchObject({
      finished: true,
      handover: [{ id: copy.id, note: 'جاهز', assignee: { id: cast.writer.id } }],
    });

    // Parallel frees everything; sequential chains again, and a free task that waits is told.
    await put(`/api/tasks/${parent.id}/run-mode`, cast.writer.cookie, { runMode: 'parallel' });
    await put(`/api/tasks/${parent.id}/run-mode`, cast.writer.cookie, { runMode: 'sequential' });
    const chained = await cast.detail(parent.id, cast.gm.cookie);
    expect(chained.subtasks.map((s) => s.stageId)).toEqual([null, null, null]);
    expect(chained.subtasks[2]).toMatchObject({ blocked: true, waitingOn: [{ id: post.id }] });
    // The post was free in the first stage and waited once it moved to the second (edge case 4).
    expect(await typesOf(cast.designer.id, post.id)).toContain('task_blocked');
    expect((await auditOf(parent.id, 'task.run_mode_changed')).map((e) => e.after)).toEqual([
      { runMode: 'sequential' },
      { runMode: 'stages' },
      { runMode: 'parallel' },
      { runMode: 'sequential' },
    ]);
    // Stages stay for later; an empty one is removed.
    const extra = taskStageSchema.parse(
      await (
        await client.post(`/api/tasks/${parent.id}/stages`, cast.writer.cookie, {
          name: 'إضافية',
          position: 1,
        })
      ).json(),
    );
    const removed = await client.post(
      `/api/tasks/${parent.id}/stages/${extra.id}/archive`,
      cast.writer.cookie,
      {},
    );
    expect(removed.status).toBe(204);
    expect((await cast.detail(parent.id, cast.gm.cookie)).stages.map((s) => s.name)).toEqual([
      'المرحلة 1',
      'التصميم',
    ]);
    const renamed = await patch(`/api/tasks/${parent.id}/stages/${design.id}`, cast.writer.cookie, {
      name: 'التصاميم',
      position: 1,
    });
    expect(taskStageSchema.parse(await renamed.json())).toMatchObject({
      name: 'التصاميم',
      position: 1,
    });
  });

  it('tells a started subtask that waits again after a mode change (rule A4)', async () => {
    const parent = await parentTask();
    await put(`/api/tasks/${parent.id}/run-mode`, cast.writer.cookie, { runMode: 'parallel' });
    const one = await addSubtask(parent.id, cast.gm.cookie, {
      assigneeId: cast.designer.id,
    });
    const two = await addSubtask(parent.id, cast.gm.cookie, {
      assigneeId: cast.designer.id,
    });
    expect(one.blocked || two.blocked).toBe(false);
    await cast.moveOk(two.id, cast.designer.cookie, { status: 'in_progress' });
    const forbidden = await put(`/api/tasks/${parent.id}/run-mode`, cast.designManager.cookie, {
      runMode: 'sequential',
    });
    expect(forbidden.status).toBe(403);
    await put(`/api/tasks/${parent.id}/run-mode`, cast.writer.cookie, { runMode: 'sequential' });
    const after = await cast.detail(two.id, cast.gm.cookie);
    // Started work stays started (F06 edge case 3), and is told it waits.
    expect(after).toMatchObject({ status: 'in_progress', blocked: true });
    expect(await typesOf(cast.designer.id, two.id)).toContain('task_blocked');
  });

  it('skips a cancelled subtask, and holds the next again when one is reopened (edge case 3)', async () => {
    const parent = await parentTask();
    const add = () => addSubtask(parent.id, cast.gm.cookie, { assigneeId: cast.designer.id });
    const first = await add();
    const middle = await add();
    const last = await add();
    await cast.moveOk(middle.id, cast.designManager.cookie, {
      status: 'cancelled',
      note: 'لا حاجة',
    });
    // The last now waits on the first, not on the cancelled one.
    expect((await cast.detail(last.id, cast.gm.cookie)).dependencies).toMatchObject([
      { id: first.id, source: 'run' },
    ]);
    await deliver(first.id, cast.designer.cookie, cast.designManager.cookie);
    expect((await noticeOf(cast.designer.id, last.id, 'subtask_turn'))?.data).toMatchObject({
      previous: { title: first.title },
    });
    // Reopened from delivered, the first holds the last again: its turn is void and it is told.
    await cast.moveOk(first.id, cast.designManager.cookie, {
      status: 'in_progress',
      note: 'تعديل داخلي',
    });
    expect((await cast.detail(last.id, cast.gm.cookie)).blocked).toBe(true);
    expect(await typesOf(cast.designer.id, last.id)).toContain('task_blocked');
    expect((await noticeOf(cast.designer.id, last.id, 'subtask_turn'))?.resolution).toBe('void');
    expect(await typesOf(cast.writer.id, first.id)).not.toContain('task_reopened');
  });

  it('reopens chosen subtasks while the parent is in revisions (rule A10)', async () => {
    const { id: clientId } = await cast.createClient();
    const parent = await cast.createTask(cast.am.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      clientId,
      dueDate: cast.inDays(10),
    });
    expect(parent.needsClientApproval).toBe(true);
    const copy = await addSubtask(parent.id, cast.writer.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
    });
    expect(copy).toMatchObject({ client: { id: clientId }, needsClientApproval: false });
    const other = await addSubtask(parent.id, cast.writer.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
    });
    await deliver(copy.id, cast.writer.cookie, cast.contentManager.cookie);

    const reopenPath = `/api/tasks/${parent.id}/subtasks/reopen`;
    const body = { items: [{ id: copy.id, note: 'العميل يريد نصًا أقصر' }] };
    await expectError(
      await client.post(reopenPath, cast.contentManager.cookie, body),
      409,
      'INVALID_TRANSITION',
    );
    await deliver(other.id, cast.writer.cookie, cast.contentManager.cookie);
    await cast.moveOk(parent.id, cast.writer.cookie, { status: 'in_progress' });
    await cast.moveOk(parent.id, cast.writer.cookie, { status: 'internal_review' });
    await cast.moveOk(parent.id, cast.contentManager.cookie, { status: 'awaiting_client' });
    const revisions = await cast.moveOk(parent.id, cast.am.cookie, {
      status: 'revisions',
      note: 'أقصر',
    });
    expect(revisions.permissions.canReopenSubtasks).toBe(true);
    expect((await client.post(reopenPath, cast.employee.cookie, body)).status).toBe(403);
    expect((await client.post(reopenPath, undefined, body)).status).toBe(401);

    const reopened = await client.post(reopenPath, cast.contentManager.cookie, body);
    expect(reopened.status).toBe(200);
    expect(taskDetailSchema.parse(await reopened.json()).subtasks).toMatchObject([
      { id: copy.id, status: 'in_progress' },
      { id: other.id, status: 'delivered' },
    ]);
    const [revision] = await db
      .select()
      .from(taskRevisions)
      .where(eq(taskRevisions.taskId, copy.id));
    expect(revision).toMatchObject({ source: 'internal', note: 'العميل يريد نصًا أقصر' });
    expect(await typesOf(cast.writer.id, copy.id)).toContain('task_reopened');
    expect((await auditOf(parent.id, 'task.subtasks_reopened'))[0]?.after).toMatchObject({
      subtasks: [{ id: copy.id, note: 'العميل يريد نصًا أقصر' }],
    });
    // Rule A8 holds the parent again.
    await expectError(
      await cast.move(parent.id, cast.writer.cookie, { status: 'internal_review' }),
      409,
      'SUBTASKS_OPEN',
    );
    // A subtask that is not delivered is not reopened.
    await expectError(
      await client.post(reopenPath, cast.contentManager.cookie, body),
      409,
      'INVALID_TRANSITION',
    );
  });

  it('cascades cancel, archive and restore from the parent (rule A11)', async () => {
    const parent = await parentTask();
    const one = await addSubtask(parent.id, cast.writer.cookie);
    const two = await addSubtask(parent.id, cast.writer.cookie);
    await cast.moveOk(parent.id, cast.contentManager.cookie, {
      status: 'cancelled',
      note: 'ألغى العميل الحملة',
    });
    for (const id of [one.id, two.id]) {
      expect((await cast.detail(id, cast.gm.cookie)).status).toBe('cancelled');
      expect((await auditOf(id, 'task.status_changed'))[0]?.after).toMatchObject({
        status: 'cancelled',
        note: 'ألغى العميل الحملة',
        parentId: parent.id,
      });
    }
    await expectError(await addRaw(parent.id, cast.writer.cookie, {}), 409, 'TASK_CLOSED');

    const kept = await parentTask();
    const alone = await addSubtask(kept.id, cast.writer.cookie);
    const withParent = await addSubtask(kept.id, cast.writer.cookie);
    expect(withParent.blocked).toBe(true);
    await client.post(`/api/tasks/${alone.id}/archive`, cast.gm.cookie, {});
    // The archived subtask no longer holds the next one (rule A3).
    expect((await cast.detail(withParent.id, cast.gm.cookie)).blocked).toBe(false);
    await client.post(`/api/tasks/${kept.id}/archive`, cast.gm.cookie, {});
    expect((await cast.detail(withParent.id, cast.gm.cookie)).archivedAt).not.toBeNull();
    await expectError(
      await client.post(`/api/tasks/${withParent.id}/restore`, cast.gm.cookie, {}),
      409,
      'TASK_ARCHIVED',
    );
    expect((await client.post(`/api/tasks/${kept.id}/restore`, cast.gm.cookie, {})).status).toBe(
      200,
    );
    expect((await cast.detail(withParent.id, cast.gm.cookie)).archivedAt).toBeNull();
    expect((await cast.detail(alone.id, cast.gm.cookie)).archivedAt).not.toBeNull();
  });

  it('moves the links and the due dates of subtasks with their parent (rules A1, A5)', async () => {
    const { id: firstClient } = await cast.createClient();
    const { id: secondClient } = await cast.createClient();
    const parent = await cast.createTask(cast.am.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      clientId: firstClient,
      dueDate: cast.inDays(10),
    });
    const subtask = await addSubtask(parent.id, cast.am.cookie, { dueDate: cast.inDays(8) });
    await expectError(
      await patch(`/api/tasks/${subtask.id}`, cast.gm.cookie, { clientId: secondClient }),
      400,
      'INVALID_LINK',
    );
    await expectError(
      await patch(`/api/tasks/${subtask.id}`, cast.gm.cookie, { dueDate: cast.inDays(11) }),
      400,
      'INVALID_DATES',
    );
    const moved = await patch(`/api/tasks/${parent.id}`, cast.gm.cookie, {
      clientId: secondClient,
    });
    expect(moved.status).toBe(200);
    expect((await cast.detail(subtask.id, cast.gm.cookie)).client?.id).toBe(secondClient);

    const earlier = await expectError(
      await patch(`/api/tasks/${parent.id}`, cast.gm.cookie, { dueDate: cast.inDays(6) }),
      409,
      'SUBTASK_DUE_AFTER_PARENT',
    );
    expect(earlier.details).toMatchObject([{ id: subtask.id, dueDate: cast.inDays(8) }]);
    const both = await patch(`/api/tasks/${parent.id}`, cast.gm.cookie, {
      dueDate: cast.inDays(6),
      moveSubtasks: true,
    });
    expect(both.status).toBe(200);
    expect((await cast.detail(subtask.id, cast.gm.cookie)).dueDate).toBe(cast.inDays(6));
    expect((await auditOf(subtask.id, 'task.updated')).map((e) => e.after)).toEqual([
      { clientId: secondClient, parentId: parent.id },
      { dueDate: cast.inDays(6), parentId: parent.id },
    ]);
  });

  it('counts the parent only on the project, and shows subtasks in lists and views (rules A9, A13)', async () => {
    const { id: clientId } = await cast.createClient();
    const project = await cast.createProject(clientId, { departments: ['content_management'] });
    const parent = await parentTask({ clientId, projectId: project.id });
    const subtask = await addSubtask(parent.id, cast.gm.cookie, {
      assigneeId: cast.designer.id,
    });
    expect(subtask.project?.id).toBe(project.id);
    const counted = projectDetailSchema.parse(
      await (await client.get(`/api/projects/${project.id}`, cast.gm.cookie)).json(),
    );
    expect(counted.tasks.total).toBe(1);

    const list = async (query: string) =>
      taskPageSchema.parse(
        await (await client.get(`/api/tasks?clientId=${clientId}&${query}`, cast.gm.cookie)).json(),
      ).items;
    expect((await list(`parentId=${parent.id}`)).map((t) => t.id)).toEqual([subtask.id]);
    expect((await list('topLevel=true')).map((t) => t.id)).toEqual([parent.id]);
    const all = await list('sort=createdAt');
    expect(all.find((t) => t.id === subtask.id)?.parent).toEqual({
      id: parent.id,
      title: parent.title,
    });
    expect(all.find((t) => t.id === parent.id)?.progress).toEqual({ delivered: 0, total: 1 });
    const board = taskBoardSchema.parse(
      await (
        await client.get(
          `/api/tasks/board?clientId=${clientId}&department=design&topLevel=true`,
          cast.gm.cookie,
        )
      ).json(),
    );
    expect(board.columns.flatMap((column) => column.items)).toEqual([]);

    // "To review" counts the subtasks of the parents the caller is assigned.
    const summary = async () =>
      myTaskSummarySchema.parse(
        await (await client.get('/api/me/tasks/summary', cast.writer.cookie)).json(),
      ).toReview;
    const before = await summary();
    await cast.moveOk(subtask.id, cast.designer.cookie, { status: 'in_progress' });
    await cast.moveOk(subtask.id, cast.designer.cookie, { status: 'internal_review' });
    expect(await summary()).toBe(before + 1);
    expect(
      (
        await (
          await client.get(`/api/tasks?reviewer=me&clientId=${clientId}`, cast.writer.cookie)
        ).json()
      ).items.map((t: { id: string }) => t.id),
    ).toEqual([subtask.id]);
    // Their approval delivers it (rule A7).
    expect(
      (await cast.moveOk(subtask.id, cast.writer.cookie, { status: 'delivered' })).status,
    ).toBe('delivered');
  });

  it('warns the parent when an overdue subtask holds the next one (rule A14)', async () => {
    const parent = await parentTask();
    const late = await addSubtask(parent.id, cast.gm.cookie, {
      assigneeId: cast.designer.id,
      dueDate: businessDate(),
    });
    const next = await addSubtask(parent.id, cast.contentManager.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
    });
    let day = addDays(businessDate(), 1);
    while (!isWorkDay(day)) day = addDays(day, 1);
    const reminders = app.get(DailyReminders);
    await reminders.runDaily(day);
    await reminders.runDaily(day);
    const parentNotices = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.subjectId, late.id), eq(notifications.type, 'subtask_holding_next')),
      );
    expect(parentNotices.map((n) => [n.recipientId, n.priority, n.box]).sort()).toEqual(
      [
        [cast.writer.id, 'important', 'action'],
        [cast.writer.id, 'normal', 'info'],
      ].sort(),
    );
    expect(parentNotices[0]?.data).toMatchObject({ parent: parent.title, waiting: next.title });
    // Delivered, it no longer holds anything.
    await deliver(late.id, cast.designer.cookie, cast.designManager.cookie);
    const [open] = await db
      .select({ resolution: notifications.resolution })
      .from(notifications)
      .where(
        and(
          eq(notifications.subjectId, late.id),
          eq(notifications.type, 'subtask_holding_next'),
          eq(notifications.box, 'action'),
        ),
      );
    expect(open?.resolution).toBe('done');
  });

  it('holds at most 30 live subtasks (LIMIT_REACHED)', async () => {
    const parent = await parentTask();
    await put(`/api/tasks/${parent.id}/run-mode`, cast.writer.cookie, { runMode: 'parallel' });
    for (let index = 0; index < 30; index++) {
      await addSubtask(parent.id, cast.writer.cookie);
    }
    await expectError(await addRaw(parent.id, cast.writer.cookie, {}), 409, 'LIMIT_REACHED');
    const [one] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentId, parent.id));
    // A cancelled one no longer counts.
    await cast.moveOk(one?.id as string, cast.designManager.cookie, {
      status: 'cancelled',
      note: 'لا حاجة',
    });
    expect((await addRaw(parent.id, cast.writer.cookie, {})).status).toBe(201);
  });
});
