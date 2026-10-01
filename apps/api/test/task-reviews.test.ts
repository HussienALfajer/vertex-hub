import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type FileItem,
  fileItemSchema,
  myTaskSummarySchema,
  type NotificationType,
  taskPageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  notifications,
  taskClientResponses,
  taskReviews,
  taskRevisions,
  tasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClientReviewExit,
  ClientReviewHooks,
  type PendingApproval,
} from '../src/modules/tasks/index.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

/*
 * F09 PR 1: review snapshots, the content token, the text for the client, the medical stage,
 * withdrawing for re-review, client responses recorded by hand, and healthcare flag changes.
 */
describe('task reviews (F09 rules 1–7, 13–19)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;
  let reviewer: Awaited<ReturnType<typeof cast.signedIn>>;
  /** A designer who is also a member of Medical Consultation. */
  let medicalDesigner: Awaited<ReturnType<typeof cast.signedIn>>;

  /** Stands in for the `approvals` module: the pending items it holds and the exits it hears. */
  const pending = new Map<string, PendingApproval>();
  const exits: ClientReviewExit[] = [];
  let failExits = false;

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

  const put = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', path, { cookie, body });

  const patch = (path: string, cookie: string, body: unknown) =>
    client.request('PATCH', path, { cookie, body });

  const medical = (id: string, cookie: string | undefined, body: unknown) =>
    client.post(`/api/tasks/${id}/medical-review`, cookie, body);

  /** A link deliverable on the task, added by the designer. */
  async function addDeliverable(taskId: string, name: string): Promise<FileItem> {
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

  async function addVersion(itemId: string): Promise<FileItem> {
    const response = await client.post(
      `/api/files/items/${itemId}/versions`,
      cast.designer.cookie,
      { source: { url: `https://drive.example.com/${randomUUID()}` } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return fileItemSchema.parse(await response.json());
  }

  const versionOf = (item: FileItem, number: number) => {
    const version = item.versions.find((v) => v.number === number);
    if (!version) throw new Error(`No version ${number}`);
    return version;
  };

  /** A Design task of the client in internal review, assigned to the designer unless told. */
  async function inReview(
    clientId: string,
    assignee: { id: string; cookie: string } = cast.designer,
  ) {
    const task = await cast.createTask(cast.designManager.cookie, {
      clientId,
      assigneeId: assignee.id,
    });
    await cast.moveOk(task.id, assignee.cookie, { status: 'in_progress' });
    return cast.moveOk(task.id, assignee.cookie, { status: 'internal_review' });
  }

  /** The internal pass, with the token the reviewer sees. */
  async function pass(id: string, cookie = cast.designManager.cookie) {
    const { contentToken } = await cast.detail(id, cookie);
    return cast.move(id, cookie, { status: 'awaiting_client', contentToken });
  }

  /** A task of a healthcare client in the medical stage, with a caption. */
  async function inMedicalStage(clientId: string) {
    const task = await inReview(clientId);
    await cast.setClientText(task.id, cast.designer.cookie, 'نص طبي');
    expect((await pass(task.id)).status).toBe(200);
    return cast.detail(task.id, cast.gm.cookie);
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
    reviewer = await cast.signedIn({
      name: `مراجع طبي ${cast.run}`,
      departments: [{ code: 'medical_consultation' }],
    });
    medicalDesigner = await cast.signedIn({
      name: `مصمم طبي ${cast.run}`,
      departments: [{ code: 'design' }, { code: 'medical_consultation' }],
    });
    app.get(ClientReviewHooks).register({
      pending: async (taskIds) =>
        new Map(taskIds.flatMap((id) => (pending.has(id) ? [[id, pending.get(id)]] : []))) as Map<
          string,
          PendingApproval
        >,
      waitingSql: () => sql`false`,
      left: async (_tx, exit) => {
        if (failExits) throw new Error('The approvals hook failed');
        exits.push(exit);
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await medical(id, undefined, { decision: 'approve' })).status).toBe(401);
    expect((await put(`/api/tasks/${id}/client-text`, undefined, { clientText: 'x' })).status).toBe(
      401,
    );
  });

  describe('text for the client (rule 7)', () => {
    it('is edited by the assignee and manage scope, audited by length only', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.taskAt('in_progress', { clientId });
      const path = `/api/tasks/${task.id}/client-text`;
      expect(task.clientText).toBeNull();
      expect((await cast.detail(task.id, cast.employee.cookie)).permissions.canEditClientText).toBe(
        false,
      );
      expect((await cast.detail(task.id, cast.designer.cookie)).permissions.canEditClientText).toBe(
        true,
      );

      const written = await cast.setClientText(task.id, cast.designer.cookie, ' سطر أول\nسطر ثانٍ ');
      expect(written.clientText).toBe('سطر أول\nسطر ثانٍ');
      expect(written.contentToken).not.toBe(task.contentToken);
      const edited = await cast.setClientText(task.id, cast.designManager.cookie, 'نص المدير');
      expect(edited.clientText).toBe('نص المدير');

      // Another employee, and an account manager of another client, may not.
      expect((await put(path, cast.employee.cookie, { clientText: 'x' })).status).toBe(403);
      expect((await put(path, cast.otherAm.cookie, { clientText: 'x' })).status).toBe(403);
      expect(
        (await put(path, cast.designer.cookie, { clientText: 'x'.repeat(10_001) })).status,
      ).toBe(400);
      expect((await put(`/api/tasks/${randomUUID()}/client-text`, cast.gm.cookie, {})).status).toBe(
        400,
      );
      expect(
        (await put(`/api/tasks/${randomUUID()}/client-text`, cast.gm.cookie, { clientText: 'x' }))
          .status,
      ).toBe(404);

      const cleared = await cast.setClientText(task.id, cast.designer.cookie, '  ');
      expect(cleared.clientText).toBeNull();
      expect(cleared.contentToken).toBe(task.contentToken);

      const audit = (await auditOf(task.id)).filter(
        (entry) => entry.action === 'task.client_text_updated',
      );
      expect(audit.map((entry) => [entry.before, entry.after])).toEqual([
        [{ length: 0 }, { length: 16 }],
        [{ length: 16 }, { length: 9 }],
        [{ length: 9 }, { length: 0 }],
      ]);
      expect(JSON.stringify(audit)).not.toContain('نص المدير');
    });

    it('is closed with the task', async () => {
      const { id: clientId } = await cast.createClient();
      const delivered = await cast.taskAt('delivered', { clientId, needsClientApproval: false });
      await expectError(
        await put(`/api/tasks/${delivered.id}/client-text`, cast.designer.cookie, {
          clientText: 'x',
        }),
        409,
        'TASK_CLOSED',
      );
      const archived = await cast.taskAt('in_progress', { clientId });
      expect((await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      await expectError(
        await put(`/api/tasks/${archived.id}/client-text`, cast.gm.cookie, { clientText: 'x' }),
        409,
        'TASK_ARCHIVED',
      );
    });
  });

  describe('internal pass (rules 1–3)', () => {
    it('needs the content token it was shown and something to approve', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await inReview(clientId);
      const move = (body: Record<string, unknown>) =>
        cast.move(task.id, cast.designManager.cookie, { status: 'awaiting_client', ...body });

      expect((await move({})).status).toBe(400);
      await expectError(await move({ contentToken: task.contentToken }), 409, 'NOTHING_TO_APPROVE');

      // The reviewer loads the page; the designer changes the text; the pass is refused.
      const shown = await cast.setClientText(task.id, cast.designer.cookie, 'النص الأول');
      await cast.setClientText(task.id, cast.designer.cookie, 'النص الثاني');
      await expectError(
        await move({ contentToken: shown.contentToken }),
        409,
        'REVIEW_CONTENT_CHANGED',
      );
      // A new deliverable changes it too.
      const beforeFile = await cast.detail(task.id, cast.designManager.cookie);
      await addDeliverable(task.id, 'منشور');
      await expectError(
        await move({ contentToken: beforeFile.contentToken }),
        409,
        'REVIEW_CONTENT_CHANGED',
      );
      expect((await cast.detail(task.id, cast.gm.cookie)).reviewHistory).toEqual([]);
      expect((await pass(task.id)).status).toBe(200);
    });

    it('records the snapshot: the latest version of each deliverable and the text', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await inReview(clientId);
      expect(task.reviewStage).toBe('internal');
      const file = await addDeliverable(task.id, 'تصميم');
      await cast.setClientText(task.id, cast.designer.cookie, 'تعليق المنشور');

      const response = await pass(task.id);
      expect(response.status).toBe(200);
      const sent = await cast.detail(task.id, cast.gm.cookie);
      expect(sent.status).toBe('awaiting_client');
      expect(sent.reviewStage).toBeNull();
      expect(sent.reviewHistory).toHaveLength(1);
      expect(sent.clearedReview).toMatchObject({
        stage: 'internal',
        outcome: 'passed',
        reviewer: { id: cast.designManager.id },
        clientText: 'تعليق المنشور',
        versions: [{ id: versionOf(file, 1).id, fileItemId: file.id, name: 'تصميم', number: 1 }],
      });
      expect(sent.clearedReview?.id).toBe(sent.reviewHistory[0]?.id);

      const audit = await auditOf(task.id);
      expect(audit.find((entry) => entry.action === 'task.reviewed')?.after).toEqual({
        stage: 'internal',
        outcome: 'passed',
        versions: [{ name: 'تصميم', number: 1 }],
        hasText: true,
      });

      // Edge cases 3 and 4: newer work is allowed but not sent; what was sent stays.
      const versioned = await addVersion(file.id);
      await cast.setClientText(task.id, cast.designer.cookie, 'تعليق جديد');
      const after = await cast.detail(task.id, cast.gm.cookie);
      expect(after.clearedReview?.versions.map((v) => v.number)).toEqual([1]);
      expect(after.clearedReview?.clientText).toBe('تعليق المنشور');
      expect(after.clientText).toBe('تعليق جديد');
      await expectError(
        await client.post(
          `/api/files/versions/${versionOf(versioned, 1).id}/archive`,
          cast.designManager.cookie,
        ),
        409,
        'VERSION_SENT',
      );
      await expectError(
        await client.post(`/api/files/items/${file.id}/archive`, cast.designManager.cookie),
        409,
        'VERSION_SENT',
      );

      // Rule 6: withdrawn for re-review by manage scope, the new version is reviewed and sent.
      expect(
        (await cast.move(task.id, cast.designer.cookie, { status: 'internal_review' })).status,
      ).toBe(403);
      expect(after.permissions.canWithdrawFromClient).toBe(true);
      const withdrawn = await cast.moveOk(task.id, cast.designManager.cookie, {
        status: 'internal_review',
        note: 'نسخة أحدث',
      });
      expect(withdrawn.reviewStage).toBe('internal');
      expect(withdrawn.revisionHistory).toEqual([]);
      expect(exits.at(-1)).toMatchObject({ taskId: task.id, response: null });
      expect(
        (
          await client.post(
            `/api/files/versions/${versionOf(versioned, 1).id}/archive`,
            cast.designManager.cookie,
          )
        ).status,
      ).toBe(200);
      expect((await pass(task.id)).status).toBe(200);
      const resent = await cast.detail(task.id, cast.gm.cookie);
      expect(resent.clearedReview?.versions.map((v) => v.number)).toEqual([2]);
      expect(resent.clearedReview?.clientText).toBe('تعليق جديد');
      expect(resent.reviewHistory).toHaveLength(2);
    });

    it('records a return with its revision, and a pass without the client', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await inReview(clientId);
      await cast.moveOk(task.id, cast.designManager.cookie, {
        status: 'revisions',
        note: 'الخط صغير',
      });
      const returned = await cast.detail(task.id, cast.gm.cookie);
      expect(returned.reviewHistory).toMatchObject([
        { stage: 'internal', outcome: 'returned', note: 'الخط صغير', versions: [] },
      ]);
      const [review] = await db.select().from(taskReviews).where(eq(taskReviews.taskId, task.id));
      const [revision] = await db
        .select()
        .from(taskRevisions)
        .where(eq(taskRevisions.taskId, task.id));
      expect(review?.revisionId).toBe(revision?.id);

      // Without client approval the pass approves, with a snapshot and the automatic final.
      const direct = await cast.taskAt('internal_review', { clientId, needsClientApproval: false });
      const file = await addDeliverable(direct.id, 'شعار');
      expect(
        (await cast.move(direct.id, cast.designManager.cookie, { status: 'approved' })).status,
      ).toBe(400);
      const approved = await cast.moveOk(direct.id, cast.designManager.cookie, {
        status: 'approved',
      });
      expect(approved.clearedReview?.versions).toMatchObject([{ id: versionOf(file, 1).id }]);
      expect(approved.clientResponses).toEqual([]);
    });
  });

  describe('client responses by hand (rules 13–16)', () => {
    it('answers the snapshot with a contact, and an approval marks its versions final', async () => {
      const { id: clientId } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const task = await inReview(clientId);
      const file = await addDeliverable(task.id, 'إعلان');
      expect((await pass(task.id)).status).toBe(200);
      // Added after the review: not part of what the client approves.
      const versioned = await addVersion(file.id);

      const approve = (body: Record<string, unknown>) =>
        cast.move(task.id, cast.am.cookie, { status: 'approved', ...body });
      expect((await approve({})).status).toBe(400);
      await expectError(await approve({ contactId: randomUUID() }), 400, 'UNKNOWN_CONTACT');
      expect((await approve({ contactId })).status).toBe(200);

      const approved = await cast.detail(task.id, cast.gm.cookie);
      expect(approved.status).toBe('approved');
      expect(approved.clientResponses).toMatchObject([
        {
          decision: 'approved',
          channel: 'manual',
          contact: { id: contactId },
          note: null,
          versions: [{ id: versionOf(versioned, 1).id, number: 1 }],
          recordedBy: { id: cast.am.id },
        },
      ]);
      expect(exits.at(-1)).toMatchObject({
        taskId: task.id,
        response: { id: approved.clientResponses[0]?.id, decision: 'approved' },
      });
      const items = await client.get(
        `/api/files/items?ownerType=task&ownerId=${task.id}`,
        cast.gm.cookie,
      );
      const [item] = ((await items.json()) as { items: FileItem[] }).items;
      expect(item?.versions.map((v) => [v.number, v.isFinal, v.finalSource])).toEqual([
        [2, false, null],
        [1, true, 'client'],
      ]);
      const audit = await auditOf(task.id);
      expect(audit.find((e) => e.action === 'task.client_response_recorded')?.after).toEqual({
        decision: 'approved',
        channel: 'manual',
        contactId,
        versions: [{ name: 'إعلان', number: 1 }],
      });

      // Changes asked after the approval answer the same snapshot (rule 16).
      const exitsBefore = exits.length;
      await cast.moveOk(task.id, cast.am.cookie, {
        status: 'revisions',
        note: 'غيّروا العنوان',
        contactId,
      });
      const changed = await cast.detail(task.id, cast.gm.cookie);
      expect(changed.clientResponses).toHaveLength(2);
      expect(changed.clientResponses[1]).toMatchObject({
        decision: 'changes_requested',
        note: 'غيّروا العنوان',
        versions: [{ number: 1 }],
      });
      expect(changed.revisions.clientCount).toBe(1);
      const [response] = await db
        .select()
        .from(taskClientResponses)
        .where(
          and(
            eq(taskClientResponses.taskId, task.id),
            eq(taskClientResponses.decision, 'changes_requested'),
          ),
        );
      expect(response?.revisionId).toBe(changed.revisionHistory[0]?.id);
      expect(response?.reviewId).toBe(approved.clearedReview?.id);
      // The task was not with the client any more: nothing to tell the approvals module.
      expect(exits).toHaveLength(exitsBefore);
    });

    it('leaves nothing behind when the transaction fails', async () => {
      const { id: clientId } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const task = await inReview(clientId);
      const file = await addDeliverable(task.id, 'ملصق');
      expect((await pass(task.id)).status).toBe(200);
      failExits = true;
      try {
        const failed = await cast.move(task.id, cast.am.cookie, { status: 'approved', contactId });
        expect(failed.status).toBe(500);
      } finally {
        failExits = false;
      }
      const after = await cast.detail(task.id, cast.gm.cookie);
      expect(after.status).toBe('awaiting_client');
      expect(after.clientResponses).toEqual([]);
      const items = await client.get(
        `/api/files/items?ownerType=task&ownerId=${task.id}`,
        cast.gm.cookie,
      );
      const [item] = ((await items.json()) as { items: FileItem[] }).items;
      expect(item?.id).toBe(file.id);
      expect(item?.versions[0]?.isFinal).toBe(false);
      const audit = await auditOf(task.id);
      expect(audit.some((e) => e.action === 'task.client_response_recorded')).toBe(false);
    });

    it('tells the approvals module when a sent task is cancelled or archived (rule 17)', async () => {
      const { id: clientId } = await cast.createClient();
      const cancelled = await cast.taskAt('awaiting_client', { clientId });
      await cast.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'أُلغيت الحملة',
      });
      expect(exits.at(-1)).toMatchObject({ taskId: cancelled.id, response: null });
      const archived = await cast.taskAt('awaiting_client', { clientId });
      expect((await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      expect(exits.at(-1)).toMatchObject({ taskId: archived.id, response: null });
    });

    it('keeps a task in an approval link with its client (SENT_TO_CLIENT)', async () => {
      const { id: clientId } = await cast.createClient();
      const other = await cast.createClient();
      const task = await cast.taskAt('awaiting_client', { clientId });
      const now = new Date();
      pending.set(task.id, {
        itemId: randomUUID(),
        requestId: randomUUID(),
        state: 'open',
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      try {
        await expectError(
          await patch(`/api/tasks/${task.id}`, cast.gm.cookie, { clientId: other.id }),
          409,
          'SENT_TO_CLIENT',
        );
        const detail = await cast.detail(task.id, cast.am.cookie);
        expect(detail.pendingApproval).toMatchObject({ state: 'open' });
        expect(detail.permissions.canSendForApproval).toBe(false);
      } finally {
        pending.delete(task.id);
      }
      const free = await cast.detail(task.id, cast.am.cookie);
      expect(free.pendingApproval).toBeNull();
      expect(free.permissions.canSendForApproval).toBe(true);
      // Client scope only: the Design manager reviews but does not send.
      expect(
        (await cast.detail(task.id, cast.designManager.cookie)).permissions.canSendForApproval,
      ).toBe(false);
    });
  });

  describe('medical review (rules 4 and 5, A13)', () => {
    it('sends a healthcare pass to the medical stage, for medical reviewers only', async () => {
      const { id: clientId } = await cast.createClient({ isHealthcare: true });
      const task = await inReview(clientId);
      const file = await addDeliverable(task.id, 'منشور طبي');
      await cast.setClientText(task.id, cast.designer.cookie, 'نصيحة طبية');

      const response = await pass(task.id);
      expect(response.status).toBe(200);
      const staged = await cast.detail(task.id, cast.gm.cookie);
      expect(staged.status).toBe('internal_review');
      expect(staged.reviewStage).toBe('medical');
      expect(staged.clearedReview).toBeNull();
      expect(staged.reviewHistory).toMatchObject([{ stage: 'internal', outcome: 'passed' }]);
      expect(await typesOf(reviewer.id, task.id)).toEqual(['task_medical_review_requested']);
      expect(await typesOf(cast.am.id, task.id)).not.toContain('task_awaiting_client');

      // Manage scope may return or cancel there, never pass; the approval flag stays on.
      const manager = await cast.detail(task.id, cast.designManager.cookie);
      expect(manager.allowedTransitions).toEqual(['revisions', 'cancelled']);
      expect(manager.permissions.canMedicalReview).toBe(false);
      await expectError(
        await cast.move(task.id, cast.designManager.cookie, {
          status: 'awaiting_client',
          contentToken: manager.contentToken,
        }),
        409,
        'INVALID_TRANSITION',
      );
      await expectError(
        await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, {
          needsClientApproval: false,
        }),
        409,
        'INVALID_TRANSITION',
      );
      // The snapshot under medical review is locked like a sent one.
      const versioned = await addVersion(file.id);
      await expectError(
        await client.post(
          `/api/files/versions/${versionOf(versioned, 1).id}/archive`,
          cast.designManager.cookie,
        ),
        409,
        'VERSION_SENT',
      );

      // Who may review: not a non-member, not without a note to return.
      expect(
        (await medical(task.id, cast.designManager.cookie, { decision: 'approve' })).status,
      ).toBe(403);
      expect((await medical(task.id, cast.am.cookie, { decision: 'approve' })).status).toBe(403);
      expect((await medical(task.id, reviewer.cookie, { decision: 'return' })).status).toBe(400);
      expect((await medical(randomUUID(), reviewer.cookie, { decision: 'approve' })).status).toBe(
        404,
      );
      expect((await cast.detail(task.id, reviewer.cookie)).permissions.canMedicalReview).toBe(true);

      // Rule 5: a medical return is a revision that never counts against the limit.
      const returned = await medical(task.id, reviewer.cookie, {
        decision: 'return',
        note: 'الجرعة غير دقيقة',
      });
      expect(returned.status).toBe(200);
      const inRevisions = await cast.detail(task.id, cast.gm.cookie);
      expect(inRevisions.status).toBe('revisions');
      expect(inRevisions.reviewStage).toBeNull();
      expect(inRevisions.revisionHistory).toMatchObject([
        { source: 'medical', number: null, note: 'الجرعة غير دقيقة', overLimit: false },
      ]);
      expect(inRevisions.revisions.clientCount).toBe(0);
      expect(inRevisions.reviewHistory.at(-1)).toMatchObject({
        stage: 'medical',
        outcome: 'returned',
        reviewer: { id: reviewer.id },
      });
      expect(await typesOf(cast.designer.id, task.id)).toContain('task_returned');
      await expectError(
        await medical(task.id, reviewer.cookie, { decision: 'approve' }),
        409,
        'INVALID_TRANSITION',
      );

      // Resubmitted, it passes internal review again, then medical review.
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
      expect((await pass(task.id)).status).toBe(200);
      const later = await addVersion(file.id);
      const approvedResponse = await medical(task.id, reviewer.cookie, { decision: 'approve' });
      expect(approvedResponse.status).toBe(200);
      const sent = await cast.detail(task.id, cast.am.cookie);
      expect(sent.status).toBe('awaiting_client');
      // The medical pass approves exactly what the internal pass approved: v2, not v3.
      expect(sent.clearedReview).toMatchObject({
        stage: 'medical',
        outcome: 'passed',
        reviewer: { id: reviewer.id },
        clientText: 'نصيحة طبية',
        versions: [{ id: versionOf(later, 2).id, number: 2 }],
      });
      expect(sent.permissions.canSendForApproval).toBe(true);
      expect(await typesOf(cast.am.id, task.id)).toContain('task_awaiting_client');
      const audit = await auditOf(task.id);
      expect(audit.at(-1)).toMatchObject({
        action: 'task.status_changed',
        actorId: reviewer.id,
        before: { status: 'internal_review', reviewStage: 'medical' },
        after: { status: 'awaiting_client' },
      });
    });

    it('never lets the assignee review their own task, and lets the General Manager', async () => {
      const { id: clientId } = await cast.createClient({ isHealthcare: true });
      const task = await inReview(clientId, medicalDesigner);
      await cast.setClientText(task.id, medicalDesigner.cookie, 'نص');
      expect((await pass(task.id)).status).toBe(200);
      // The assignee is not told to review their own work.
      expect(await typesOf(medicalDesigner.id, task.id)).not.toContain(
        'task_medical_review_requested',
      );
      expect(
        (await cast.detail(task.id, medicalDesigner.cookie)).permissions.canMedicalReview,
      ).toBe(false);
      await expectError(
        await medical(task.id, medicalDesigner.cookie, { decision: 'approve' }),
        403,
        'SELF_REVIEW',
      );

      const summaryOf = async (cookie: string) =>
        myTaskSummarySchema.parse(await (await client.get('/api/me/tasks/summary', cookie)).json());
      expect((await summaryOf(cast.designer.cookie)).medicalReview).toBeNull();
      const mine = (await summaryOf(medicalDesigner.cookie)).medicalReview ?? 0;
      const theirs = (await summaryOf(reviewer.cookie)).medicalReview ?? 0;
      expect(theirs).toBe(mine + 1);
      const listed = taskPageSchema.parse(
        await (
          await client.get(`/api/tasks?reviewStage=medical&clientId=${clientId}`, reviewer.cookie)
        ).json(),
      );
      expect(listed.items.map((item) => [item.id, item.reviewStage])).toEqual([
        [task.id, 'medical'],
      ]);

      // A return by manage scope from the medical stage is an internal one.
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'revisions', note: 'إملاء' });
      const returned = await cast.detail(task.id, cast.gm.cookie);
      expect(returned.revisionHistory.at(-1)).toMatchObject({ source: 'internal' });
      expect(returned.reviewHistory.at(-1)).toMatchObject({
        stage: 'medical',
        outcome: 'returned',
      });
      await cast.moveOk(task.id, medicalDesigner.cookie, { status: 'internal_review' });
      expect((await pass(task.id)).status).toBe(200);
      expect((await medical(task.id, cast.gm.cookie, { decision: 'approve' })).status).toBe(200);
      expect((await cast.detail(task.id, cast.gm.cookie)).status).toBe('awaiting_client');
    });

    it('refuses an archived task', async () => {
      const { id: clientId } = await cast.createClient({ isHealthcare: true });
      const task = await inMedicalStage(clientId);
      expect((await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie)).status).toBe(200);
      // Read-only tasks are for scope-all holders: the reviewer no longer sees it.
      expect((await medical(task.id, reviewer.cookie, { decision: 'approve' })).status).toBe(404);
      await expectError(
        await medical(task.id, cast.gm.cookie, { decision: 'approve' }),
        409,
        'TASK_ARCHIVED',
      );
    });
  });

  describe('healthcare flag changes (rules 18 and 19)', () => {
    it('applies the flag to work not yet sent, audited with its actor', async () => {
      const { id: clientId } = await cast.createClient({ isHealthcare: true });
      const flag = (isHealthcare: boolean) =>
        patch(`/api/clients/${clientId}`, cast.operations.cookie, { isHealthcare });
      const staged = await inMedicalStage(clientId);
      const earlier = await inReview(clientId);

      // Off: the medical stage is skipped, with the internal pass as what was cleared.
      expect((await flag(false)).status).toBe(200);
      const released = await cast.detail(staged.id, cast.am.cookie);
      expect(released.status).toBe('awaiting_client');
      expect(released.reviewStage).toBeNull();
      expect(released.clearedReview).toMatchObject({ stage: 'internal', outcome: 'passed' });
      expect(released.reviewHistory).toHaveLength(1);
      expect(released.permissions.canSendForApproval).toBe(true);
      expect((await auditOf(staged.id)).at(-1)).toMatchObject({
        action: 'task.status_changed',
        actorId: cast.operations.id,
        before: { status: 'internal_review', reviewStage: 'medical' },
        after: { status: 'awaiting_client', reason: 'healthcare_off' },
      });
      expect(await typesOf(cast.am.id, staged.id)).toContain('task_awaiting_client');
      expect((await cast.detail(earlier.id, cast.gm.cookie)).reviewStage).toBe('internal');

      // On: a ready, unsent task goes back to the medical stage; a sent one stays sent.
      const sentTask = await cast.taskAt('awaiting_client', { clientId });
      const now = new Date();
      pending.set(sentTask.id, {
        itemId: randomUUID(),
        requestId: randomUUID(),
        state: 'open',
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 1000),
      });
      const exitsBefore = exits.length;
      try {
        expect((await flag(true)).status).toBe(200);
      } finally {
        pending.delete(sentTask.id);
      }
      const back = await cast.detail(staged.id, cast.am.cookie);
      expect(back.status).toBe('internal_review');
      expect(back.reviewStage).toBe('medical');
      expect(back.permissions.canSendForApproval).toBe(false);
      expect((await auditOf(staged.id)).at(-1)).toMatchObject({
        actorId: cast.operations.id,
        before: { status: 'awaiting_client' },
        after: { status: 'internal_review', reviewStage: 'medical', reason: 'healthcare_on' },
      });
      expect(await typesOf(reviewer.id, staged.id)).toContain('task_medical_review_requested');
      expect(exits).toHaveLength(exitsBefore);
      const kept = await cast.detail(sentTask.id, cast.am.cookie);
      expect(kept.status).toBe('awaiting_client');
      // Sent before the flag: resending it needs the medical review (rule 8).
      expect(kept.permissions.canSendForApproval).toBe(false);

      // The medical approval then clears the task that went back.
      expect((await medical(staged.id, reviewer.cookie, { decision: 'approve' })).status).toBe(200);
      const cleared = await cast.detail(staged.id, cast.am.cookie);
      expect(cleared.clearedReview?.stage).toBe('medical');
      expect(cleared.permissions.canSendForApproval).toBe(true);

      // Tasks in earlier statuses meet the medical stage at their next pass.
      await cast.setClientText(earlier.id, cast.designer.cookie, 'نص');
      expect((await pass(earlier.id)).status).toBe(200);
      expect((await cast.detail(earlier.id, cast.gm.cookie)).reviewStage).toBe('medical');
    });

    it('counts what is ready to send for client scope only', async () => {
      const summaryOf = async (cookie: string) =>
        myTaskSummarySchema.parse(await (await client.get('/api/me/tasks/summary', cookie)).json());
      const before = (await summaryOf(cast.am.cookie)).readyToSend ?? 0;
      const { id: clientId } = await cast.createClient();
      const healthcare = await cast.createClient({ isHealthcare: true });
      await cast.taskAt('awaiting_client', { clientId });
      // In the medical stage: not ready until the medical pass.
      const staged = await inMedicalStage(healthcare.id);
      expect((await summaryOf(cast.am.cookie)).readyToSend).toBe(before + 1);
      expect((await medical(staged.id, reviewer.cookie, { decision: 'approve' })).status).toBe(200);
      expect((await summaryOf(cast.am.cookie)).readyToSend).toBe(before + 2);
      expect((await summaryOf(cast.designManager.cookie)).readyToSend).toBeNull();
      expect((await summaryOf(cast.designer.cookie)).readyToSend).toBeNull();
      // Another account manager's clients are out of scope.
      expect((await summaryOf(cast.otherAm.cookie)).readyToSend).toBe(0);
    });
  });

  it('keeps the review stage in step with the status', async () => {
    const { id: clientId } = await cast.createClient();
    const task = await cast.taskAt('in_progress', { clientId });
    expect(task.reviewStage).toBeNull();
    await expect(
      db.update(tasks).set({ reviewStage: 'internal' }).where(eq(tasks.id, task.id)),
    ).rejects.toThrow();
    const reviewed = await cast.moveOk(task.id, cast.designer.cookie, {
      status: 'internal_review',
    });
    expect(reviewed.reviewStage).toBe('internal');
    const cancelled = await cast.moveOk(task.id, cast.designManager.cookie, {
      status: 'cancelled',
      note: 'لا حاجة',
    });
    expect(cancelled.reviewStage).toBeNull();
  });
});
