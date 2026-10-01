import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  cyclePageSchema,
  nextWorkDay,
  postDetailSchema,
  weekday,
} from '@vertex-hub/contracts';
import {
  contentPosts,
  createDatabase,
  notifications,
  postClientResponses,
  postReviews,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostReminders } from '../src/modules/content/post-reminders.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08 PR 1: the post workflow: review snapshots and the content token, the medical stage,
 * withdrawing, client responses recorded by hand, scheduling and publishing, cancelling and
 * reopening, healthcare flag changes and the publish reminders.
 */
describe('post workflow (F08 rules 1, 10–15, 17–19, 24, 26)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;
  let healthcareId: string;

  const medical = (id: string, cookie: string | undefined, body: unknown) =>
    client.post(`/api/content/posts/${id}/medical-review`, cookie, body);
  const reviewsOf = (postId: string) =>
    db.select().from(postReviews).where(eq(postReviews.postId, postId)).orderBy(postReviews.id);
  const responsesOf = (postId: string) =>
    db
      .select()
      .from(postClientResponses)
      .where(eq(postClientResponses.postId, postId))
      .orderBy(postClientResponses.id);

  /** The internal pass, with the token the reviewer sees. */
  async function pass(id: string, to: 'awaiting_client' | 'approved', cookie: string) {
    const { contentToken } = await cast.detail(id, cast.gm.cookie);
    return cast.move(id, cookie, { to, contentToken });
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
    healthcareId = (await cast.createClient({ isHealthcare: true })).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  describe('production and submitting (rules 1 and 10)', () => {
    it('moves by edit scope only, and refuses moves the workflow has not', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      expect((await cast.move(post.id, cast.designer.cookie, { to: 'in_production' })).status).toBe(
        403,
      );
      expect((await cast.move(post.id, cast.otherAm.cookie, { to: 'in_production' })).status).toBe(
        403,
      );
      await expectError(
        await cast.move(post.id, cast.writer.cookie, { to: 'approved' }),
        409,
        'INVALID_TRANSITION',
      );
      await expectError(
        await cast.move(post.id, cast.writer.cookie, { to: 'published' }),
        409,
        'INVALID_TRANSITION',
      );
      expect((await cast.move(randomUUID(), cast.gm.cookie, { to: 'in_production' })).status).toBe(
        404,
      );
      const started = await cast.moveOk(post.id, cast.am.cookie, { to: 'in_production' });
      expect(started.allowedTransitions).toEqual(['internal_review', 'cancelled']);
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.status_changed',
        actorId: cast.am.id,
        before: { status: 'idea' },
        after: { status: 'in_production' },
      });
    });

    it('submits a post that has a caption or media, and tells its reviewers', async () => {
      const empty = await cast.createPost(cast.writer.cookie, { clientId, caption: null });
      await expectError(
        await cast.move(empty.id, cast.writer.cookie, { to: 'internal_review' }),
        409,
        'NOTHING_TO_APPROVE',
      );
      await cast.addFileOk(empty.id, 'تصميم');
      const submitted = await cast.moveOk(empty.id, cast.writer.cookie, { to: 'internal_review' });
      expect(submitted).toMatchObject({ status: 'internal_review', reviewStage: 'internal' });
      expect(submitted.permissions.canEditContent).toBe(false);
      for (const reviewer of [cast.contentManager, cast.am, cast.operations]) {
        expect(await cast.typesOf(reviewer.id, empty.id)).toEqual(['post_review_requested']);
      }
      expect(await cast.typesOf(cast.otherAm.id, empty.id)).toEqual([]);
      expect(await cast.typesOf(cast.writer.id, empty.id)).toEqual([]);
    });
  });

  describe('internal review (rules 11 and 12)', () => {
    it('passes with the content token it reviewed and stores the snapshot', async () => {
      const post = await cast.postAt('internal_review', {
        clientId,
        hashtags: '#وسم',
        platforms: ['instagram', 'tiktok'],
      });
      // A Content member edits but does not review; other users neither.
      expect((await pass(post.id, 'awaiting_client', cast.writer.cookie)).status).toBe(403);
      expect((await pass(post.id, 'awaiting_client', cast.designManager.cookie)).status).toBe(403);
      expect((await pass(post.id, 'awaiting_client', cast.otherAm.cookie)).status).toBe(403);
      expect(
        (await cast.move(post.id, cast.contentManager.cookie, { to: 'awaiting_client' })).status,
      ).toBe(400);
      await expectError(
        await cast.move(post.id, cast.contentManager.cookie, {
          to: 'awaiting_client',
          contentToken: '0000000000000000',
        }),
        409,
        'REVIEW_CONTENT_CHANGED',
      );
      // The post needs the client: it cannot be approved without them.
      await expectError(
        await pass(post.id, 'approved', cast.contentManager.cookie),
        409,
        'INVALID_TRANSITION',
      );

      const response = await pass(post.id, 'awaiting_client', cast.contentManager.cookie);
      expect(response.status, await response.clone().text()).toBe(200);
      const passed = postDetailSchema.parse(await response.json());
      expect(passed).toMatchObject({ status: 'awaiting_client', reviewStage: null });
      expect(passed.clearedReview).toMatchObject({
        stage: 'internal',
        outcome: 'passed',
        reviewer: { id: cast.contentManager.id },
        caption: post.caption,
        hashtags: '#وسم',
        type: 'post',
        platforms: ['instagram', 'tiktok'],
        publishDate: post.publishDate,
        publishTime: '10:30',
      });
      expect(passed.reviewHistory).toHaveLength(1);
      expect(passed.permissions).toMatchObject({
        canSendForApproval: false,
        canRecordResponse: false,
      });
      expect((await cast.detail(post.id, cast.am.cookie)).permissions).toMatchObject({
        canSendForApproval: true,
        canRecordResponse: true,
      });
      expect(await cast.typesOf(cast.am.id, post.id)).toContain('post_awaiting_client');
      const audit = await cast.auditOf(post.id);
      expect(audit.at(-2)).toMatchObject({
        action: 'post.reviewed',
        after: { stage: 'internal', outcome: 'passed', hasCaption: true },
      });
      expect(audit.at(-1)).toMatchObject({
        action: 'post.status_changed',
        after: { status: 'awaiting_client' },
      });
    });

    it('snapshots the media in display order', async () => {
      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const first = await cast.addFileOk(post.id, 'ب الأول');
      const second = await cast.addFileOk(post.id, 'أ الثاني');
      await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      const passed = await cast.moveOk(post.id, cast.am.cookie, { to: 'awaiting_client' });
      expect(passed.clearedReview?.versions.map((version) => version.fileItemId)).toEqual([
        first.id,
        second.id,
      ]);
      const [review] = await reviewsOf(post.id);
      expect(review?.versionIds).toEqual(passed.media.map((version) => version.id));
    });

    it('approves a post that needs no client approval, and tells its responsible person', async () => {
      const post = await cast.postAt('internal_review', { clientId, needsClientApproval: false });
      await expectError(
        await pass(post.id, 'awaiting_client', cast.contentManager.cookie),
        409,
        'INVALID_TRANSITION',
      );
      const response = await pass(post.id, 'approved', cast.operations.cookie);
      expect(response.status, await response.clone().text()).toBe(200);
      const approved = postDetailSchema.parse(await response.json());
      expect(approved.status).toBe('approved');
      expect(approved.clearedReview?.stage).toBe('internal');
      expect(await cast.typesOf(cast.writer.id, post.id)).toContain('post_approved');
      expect(await cast.typesOf(cast.am.id, post.id)).not.toContain('post_awaiting_client');
    });

    it('returns with a note, which writes a returned review and unlocks the content', async () => {
      const post = await cast.postAt('internal_review', { clientId });
      const back = (cookie: string, note?: string) =>
        cast.move(post.id, cookie, { to: 'in_production', note });
      expect((await back(cast.contentManager.cookie)).status).toBe(400);
      expect((await back(cast.writer.cookie, 'ملاحظة')).status).toBe(403);
      const response = await back(cast.contentManager.cookie, 'اختصر النص');
      expect(response.status, await response.clone().text()).toBe(200);
      const returned = postDetailSchema.parse(await response.json());
      expect(returned).toMatchObject({ status: 'in_production', reviewStage: null });
      expect(returned.permissions.canEditContent).toBe(true);
      expect(returned.reviewHistory).toMatchObject([
        { stage: 'internal', outcome: 'returned', note: 'اختصر النص', versions: [], caption: null },
      ]);
      expect(await cast.typesOf(cast.writer.id, post.id)).toContain('post_returned');
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        action: 'post.status_changed',
        after: { status: 'in_production', note: 'اختصر النص' },
      });
    });
  });

  describe('the client (rules 14, 15 and 24)', () => {
    it('withdraws a post for re-review by review scope', async () => {
      const post = await cast.postAt('awaiting_client', { clientId });
      expect((await cast.move(post.id, cast.writer.cookie, { to: 'internal_review' })).status).toBe(
        403,
      );
      const withdrawn = await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'internal_review',
        note: 'نسخة أحدث',
      });
      expect(withdrawn).toMatchObject({ status: 'internal_review', reviewStage: 'internal' });
      // Not a return: no returned review is written.
      expect(withdrawn.reviewHistory.map((review) => review.outcome)).toEqual(['passed']);
    });

    it('records the client approval by hand, with the contact, against the snapshot', async () => {
      const post = await cast.postAt('awaiting_client', { clientId });
      const contactId = await cast.contactOf(clientId);
      const approve = (cookie: string, body: object = { contactId }) =>
        cast.move(post.id, cookie, { to: 'approved', ...body });
      // Client scope is the account manager's, not the Content team's.
      expect((await approve(cast.writer.cookie)).status).toBe(403);
      expect((await approve(cast.contentManager.cookie)).status).toBe(403);
      expect((await approve(cast.otherAm.cookie)).status).toBe(403);
      expect((await approve(cast.am.cookie, {})).status).toBe(400);
      const stranger = await cast.contactOf((await cast.createClient()).id);
      await expectError(
        await approve(cast.am.cookie, { contactId: stranger }),
        400,
        'UNKNOWN_CONTACT',
      );

      const response = await approve(cast.am.cookie, { contactId, note: 'وافق هاتفيًا' });
      expect(response.status, await response.clone().text()).toBe(200);
      const approved = postDetailSchema.parse(await response.json());
      expect(approved.status).toBe('approved');
      expect(approved.clientResponses).toMatchObject([
        {
          decision: 'approved',
          channel: 'manual',
          contact: { id: contactId },
          note: 'وافق هاتفيًا',
          recordedBy: { id: cast.am.id },
        },
      ]);
      const [row] = await responsesOf(post.id);
      expect(row).toMatchObject({ reviewId: approved.clearedReview?.id, approvalItemId: null });
      expect(await cast.typesOf(cast.writer.id, post.id)).toContain('post_approved');
      expect((await cast.auditOf(post.id)).map((entry) => entry.action).slice(-2)).toEqual([
        'post.client_response_recorded',
        'post.status_changed',
      ]);
      // A contact is named for client responses only.
      expect(
        (await cast.move(post.id, cast.writer.cookie, { to: 'scheduled', contactId })).status,
      ).toBe(400);
    });

    it('returns the post to production when the client asks for changes, with their note', async () => {
      const post = await cast.postAt('awaiting_client', { clientId });
      const contactId = await cast.contactOf(clientId);
      expect(
        (await cast.move(post.id, cast.am.cookie, { to: 'in_production', contactId })).status,
      ).toBe(400);
      const changed = await cast.moveOk(post.id, cast.am.cookie, {
        to: 'in_production',
        note: 'غيّروا الصورة',
      });
      expect(changed.status).toBe('in_production');
      expect(changed.clientResponses).toMatchObject([
        { decision: 'changes_requested', note: 'غيّروا الصورة' },
      ]);
      // Fixing the caption and resubmitting writes no revision anywhere: a new review only.
      expect(changed.permissions.canEditContent).toBe(true);
      expect(await cast.typesOf(cast.writer.id, post.id)).toContain('post_returned');
      const again = await cast.moveOk(post.id, cast.writer.cookie, { to: 'internal_review' });
      expect(again.clientResponses).toHaveLength(1);
    });

    it('reopens the content of an approved post with a reason, for a new review', async () => {
      const post = await cast.postAt('scheduled', { clientId });
      expect((await cast.move(post.id, cast.writer.cookie, { to: 'in_production' })).status).toBe(
        400,
      );
      expect(
        (await cast.move(post.id, cast.designer.cookie, { to: 'in_production', reason: 'x' }))
          .status,
      ).toBe(403);
      const reopened = await cast.moveOk(post.id, cast.writer.cookie, {
        to: 'in_production',
        reason: 'تغيّر العرض',
      });
      expect(reopened).toMatchObject({ status: 'in_production', scheduledAt: null });
      expect(reopened.permissions.canEditContent).toBe(true);
      // The earlier response stays in its history.
      expect(reopened.clientResponses).toHaveLength(1);
      expect((await cast.auditOf(post.id)).at(-1)).toMatchObject({
        before: { status: 'scheduled' },
        after: { status: 'in_production', reason: 'تغيّر العرض' },
      });
    });
  });

  describe('medical stage (rule 13)', () => {
    it('follows every internal pass of a healthcare client, also without client approval', async () => {
      const withClient = await cast.postAt('internal_review', { clientId: healthcareId });
      const without = await cast.postAt('internal_review', {
        clientId: healthcareId,
        needsClientApproval: false,
      });
      const staged = await cast.moveOk(withClient.id, cast.contentManager.cookie, {
        to: 'awaiting_client',
      });
      expect(staged).toMatchObject({
        status: 'internal_review',
        reviewStage: 'medical',
        clearedReview: null,
      });
      expect(staged.reviewHistory).toMatchObject([{ stage: 'internal', outcome: 'passed' }]);
      expect(await cast.typesOf(cast.medicalReviewer.id, withClient.id)).toEqual([
        'post_medical_review_requested',
      ]);
      expect(await cast.typesOf(cast.am.id, withClient.id)).not.toContain('post_awaiting_client');
      expect((await cast.auditOf(withClient.id)).at(-1)).toMatchObject({
        after: { status: 'internal_review', reviewStage: 'medical' },
      });
      const second = await cast.moveOk(without.id, cast.contentManager.cookie, { to: 'approved' });
      expect(second).toMatchObject({ status: 'internal_review', reviewStage: 'medical' });

      // In the medical stage the pass belongs to the medical reviewers.
      await expectError(
        await pass(withClient.id, 'awaiting_client', cast.contentManager.cookie),
        409,
        'INVALID_TRANSITION',
      );
      expect(staged.permissions.canMedicalReview).toBe(false);
      expect((await medical(withClient.id, undefined, { decision: 'approve' })).status).toBe(401);
      // Without `approvals.review_medical`: the Content manager and the account manager.
      expect(
        (await medical(withClient.id, cast.contentManager.cookie, { decision: 'approve' })).status,
      ).toBe(403);
      expect((await medical(withClient.id, cast.am.cookie, { decision: 'approve' })).status).toBe(
        403,
      );
      expect(
        (await medical(withClient.id, cast.medicalReviewer.cookie, { decision: 'return' })).status,
      ).toBe(400);
      expect(
        (await cast.detail(withClient.id, cast.medicalReviewer.cookie)).permissions
          .canMedicalReview,
      ).toBe(true);

      const approved = await medical(withClient.id, cast.medicalReviewer.cookie, {
        decision: 'approve',
        note: 'دقيق',
      });
      expect(approved.status, await approved.clone().text()).toBe(200);
      const cleared = postDetailSchema.parse(await approved.json());
      expect(cleared.status).toBe('awaiting_client');
      expect(cleared.clearedReview).toMatchObject({
        stage: 'medical',
        reviewer: { id: cast.medicalReviewer.id },
        caption: withClient.caption,
        note: 'دقيق',
      });
      expect(await cast.typesOf(cast.am.id, withClient.id)).toContain('post_awaiting_client');
      expect(
        (await cast.detail(withClient.id, cast.am.cookie)).permissions.canSendForApproval,
      ).toBe(true);

      const direct = await medical(without.id, cast.gm.cookie, { decision: 'approve' });
      expect(postDetailSchema.parse(await direct.json()).status).toBe('approved');
      expect(await cast.typesOf(cast.writer.id, without.id)).toContain('post_approved');
      await expectError(
        await medical(without.id, cast.medicalReviewer.cookie, { decision: 'approve' }),
        409,
        'INVALID_TRANSITION',
      );
      expect((await medical(randomUUID(), cast.gm.cookie, { decision: 'approve' })).status).toBe(
        404,
      );
    });

    it('is never done by the responsible person, and may return the post', async () => {
      const both = await cast.signedIn({
        name: `كاتب طبي ${cast.run}`,
        departments: [{ code: 'content_management' }, { code: 'medical_consultation' }],
      });
      const post = await cast.postAt('internal_review', {
        clientId: healthcareId,
        responsibleId: both.id,
      });
      await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'awaiting_client' });
      await expectError(
        await medical(post.id, both.cookie, { decision: 'approve' }),
        403,
        'SELF_REVIEW',
      );
      expect((await cast.detail(post.id, both.cookie)).permissions.canMedicalReview).toBe(false);
      // The responsible person is not asked to review their own post.
      expect(await cast.typesOf(both.id, post.id)).not.toContain('post_medical_review_requested');

      const response = await medical(post.id, cast.medicalReviewer.cookie, {
        decision: 'return',
        note: 'الجرعة غير صحيحة',
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const returned = postDetailSchema.parse(await response.json());
      expect(returned).toMatchObject({ status: 'in_production', reviewStage: null });
      expect(returned.reviewHistory.at(-1)).toMatchObject({
        stage: 'medical',
        outcome: 'returned',
        note: 'الجرعة غير صحيحة',
      });
      expect(await cast.typesOf(both.id, post.id)).toContain('post_returned');
    });

    it('lets review scope return a post from the medical stage', async () => {
      const post = await cast.postAt('internal_review', { clientId: healthcareId });
      await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'awaiting_client' });
      const returned = await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'in_production',
        note: 'أعد الصياغة',
      });
      expect(returned.reviewHistory.at(-1)).toMatchObject({
        stage: 'medical',
        outcome: 'returned',
      });
    });
  });

  describe('healthcare client without a medical pass', () => {
    it('refuses a client response on a post the flag change did not reach', async () => {
      const { id: late } = await cast.createClient();
      const post = await cast.postAt('awaiting_client', { clientId: late });
      const path = `/api/content/posts/${post.id}`;
      // Archived while the flag turns on, the post keeps its internal-only clearance.
      expect((await client.post(`${path}/archive`, cast.gm.cookie)).status).toBe(204);
      const flagged = await client.request('PATCH', `/api/clients/${late}`, {
        cookie: cast.operations.cookie,
        body: { isHealthcare: true },
      });
      expect(flagged.status).toBe(200);
      expect((await client.post(`${path}/restore`, cast.gm.cookie)).status).toBe(200);

      const restored = await cast.detail(post.id, cast.am.cookie);
      expect(restored.status).toBe('awaiting_client');
      expect(restored.permissions).toMatchObject({
        canSendForApproval: false,
        canRecordResponse: false,
      });
      const contactId = await cast.contactOf(late);
      await expectError(
        await cast.move(post.id, cast.am.cookie, { to: 'approved', contactId }),
        409,
        'MEDICAL_REVIEW_REQUIRED',
      );
      expect(await responsesOf(post.id)).toEqual([]);
      // Withdrawn and passed again, it goes through the medical stage.
      await cast.moveOk(post.id, cast.contentManager.cookie, { to: 'internal_review' });
      const again = await cast.moveOk(post.id, cast.contentManager.cookie, {
        to: 'awaiting_client',
      });
      expect(again.reviewStage).toBe('medical');
    });
  });

  describe('healthcare flag changes (rule 26)', () => {
    it('applies the flag to posts not yet answered, audited with its actor', async () => {
      const { id: flagged } = await cast.createClient({ isHealthcare: true });
      const flag = (isHealthcare: boolean) =>
        client.request('PATCH', `/api/clients/${flagged}`, {
          cookie: cast.operations.cookie,
          body: { isHealthcare },
        });
      const staged = await cast.postAt('internal_review', { clientId: flagged });
      await cast.moveOk(staged.id, cast.contentManager.cookie, { to: 'awaiting_client' });
      const direct = await cast.postAt('internal_review', {
        clientId: flagged,
        needsClientApproval: false,
      });
      await cast.moveOk(direct.id, cast.contentManager.cookie, { to: 'approved' });
      const approved = await cast.postAt('approved', { clientId: flagged });

      // Off: the medical stage is skipped, with the internal pass as what was cleared.
      expect((await flag(false)).status).toBe(200);
      const released = await cast.detail(staged.id, cast.am.cookie);
      expect(released).toMatchObject({ status: 'awaiting_client', reviewStage: null });
      expect(released.clearedReview).toMatchObject({ stage: 'internal', outcome: 'passed' });
      expect(released.permissions.canSendForApproval).toBe(true);
      expect((await cast.auditOf(staged.id)).at(-1)).toMatchObject({
        action: 'post.status_changed',
        actorId: cast.operations.id,
        before: { status: 'internal_review', reviewStage: 'medical' },
        after: { status: 'awaiting_client', reason: 'healthcare_off' },
      });
      expect(await cast.typesOf(cast.am.id, staged.id)).toContain('post_awaiting_client');
      expect((await cast.detail(direct.id, cast.gm.cookie)).status).toBe('approved');

      // On: posts waiting for the client go back to the medical stage; approved ones stay.
      expect((await flag(true)).status).toBe(200);
      const back = await cast.detail(staged.id, cast.am.cookie);
      expect(back).toMatchObject({ status: 'internal_review', reviewStage: 'medical' });
      expect(back.permissions.canSendForApproval).toBe(false);
      expect((await cast.auditOf(staged.id)).at(-1)).toMatchObject({
        actorId: cast.operations.id,
        before: { status: 'awaiting_client' },
        after: { status: 'internal_review', reviewStage: 'medical', reason: 'healthcare_on' },
      });
      expect(await cast.typesOf(cast.medicalReviewer.id, staged.id)).toContain(
        'post_medical_review_requested',
      );
      expect((await cast.detail(direct.id, cast.gm.cookie)).status).toBe('approved');
      expect((await cast.detail(approved.id, cast.gm.cookie)).status).toBe('approved');
    });
  });

  describe('scheduling and publishing (rules 17 and 18)', () => {
    it('marks a post scheduled when it has a publish time, and back', async () => {
      const post = await cast.postAt('approved', { clientId, publishTime: null });
      await expectError(
        await cast.move(post.id, cast.writer.cookie, { to: 'scheduled' }),
        409,
        'PUBLISH_TIME_REQUIRED',
      );
      await client.request('PATCH', `/api/content/posts/${post.id}`, {
        cookie: cast.writer.cookie,
        body: { publishTime: '19:00' },
      });
      expect((await cast.move(post.id, cast.employee.cookie, { to: 'scheduled' })).status).toBe(
        403,
      );
      const scheduled = await cast.moveOk(post.id, cast.writer.cookie, { to: 'scheduled' });
      expect(scheduled.status).toBe('scheduled');
      expect(scheduled.scheduledAt).not.toBeNull();
      const unscheduled = await cast.moveOk(post.id, cast.am.cookie, { to: 'approved' });
      expect(unscheduled).toMatchObject({ status: 'approved', scheduledAt: null });
    });

    it('publishes from approved or scheduled, with optional links, and counts on its line', async () => {
      const retainer = await cast.createRetainer(clientId);
      const line = async () => {
        const response = await client.get(`/api/retainers/${retainer.id}/cycles`, cast.gm.cookie);
        const found = cyclePageSchema
          .parse(await response.json())
          .items[0]?.lines.find((item) => item.kind === 'design');
        if (!found) throw new Error('The retainer has no design line');
        return found;
      };
      const before = await line();
      const post = await cast.postAt('approved', {
        clientId,
        platforms: ['instagram', 'facebook'],
        cycleLineId: before.id,
      });
      expect((await line()).tasks).toEqual({ total: 1, delivered: 0, open: 1 });

      const publish = (body: object, cookie = cast.writer.cookie) =>
        cast.move(post.id, cookie, { to: 'published', ...body });
      expect((await publish({}, cast.designer.cookie)).status).toBe(403);
      await expectError(
        await publish({ publishedAt: new Date(Date.now() + 3_600_000).toISOString() }),
        400,
        'INVALID_DATES',
      );
      expect(
        (await publish({ publishedLinks: [{ platform: 'tiktok', url: 'https://tiktok.com/v/1' }] }))
          .status,
      ).toBe(400);
      const links = [{ platform: 'instagram' as const, url: 'https://instagram.com/p/xyz' }];
      const response = await publish({ publishedLinks: links });
      expect(response.status, await response.clone().text()).toBe(200);
      const published = postDetailSchema.parse(await response.json());
      expect(published).toMatchObject({
        status: 'published',
        publishedBy: { id: cast.writer.id },
        publishedLinks: links,
        overdue: false,
      });
      expect(published.publishedAt).not.toBeNull();
      // The unit counts when the post is published (rule 16).
      const after = await line();
      expect(after.tasks).toEqual({ total: 1, delivered: 1, open: 0 });
      expect(after.delivered).toBe(before.delivered + 1);

      // Published is final in V1.
      expect(published.allowedTransitions).toEqual([]);
      for (const to of ['approved', 'in_production', 'cancelled'] as const) {
        await expectError(
          await cast.move(post.id, cast.gm.cookie, { to, reason: 'x' }),
          409,
          'INVALID_TRANSITION',
        );
      }
      // The publish time and links go with the move to published only.
      const other = await cast.postAt('approved', { clientId });
      expect(
        (await cast.move(other.id, cast.writer.cookie, { to: 'scheduled', publishedLinks: links }))
          .status,
      ).toBe(400);
    });
  });

  describe('cancel and reopen (rule 19)', () => {
    it('cancels an open post with a reason and reopens it where it stood', async () => {
      const idea = await cast.createPost(cast.writer.cookie, { clientId });
      expect((await cast.move(idea.id, cast.writer.cookie, { to: 'cancelled' })).status).toBe(400);
      expect(
        (await cast.move(idea.id, cast.designer.cookie, { to: 'cancelled', reason: 'x' })).status,
      ).toBe(403);
      const cancelled = await cast.moveOk(idea.id, cast.writer.cookie, {
        to: 'cancelled',
        reason: 'أُلغيت الحملة',
      });
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'أُلغيت الحملة',
        allowedTransitions: ['idea'],
      });
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.permissions.canEdit).toBe(false);
      await expectError(
        await cast.move(idea.id, cast.writer.cookie, { to: 'in_production' }),
        409,
        'INVALID_TRANSITION',
      );
      const reopened = await cast.moveOk(idea.id, cast.writer.cookie, { to: 'idea' });
      expect(reopened).toMatchObject({ status: 'idea', cancelledAt: null, cancelReason: null });

      // With media, a cancelled post reopens to production.
      const produced = await cast.postAt('awaiting_client', { clientId });
      await cast.moveOk(produced.id, cast.am.cookie, { to: 'in_production', note: 'تعديل' });
      await cast.addFileOk(produced.id, 'تصميم');
      const dropped = await cast.moveOk(produced.id, cast.am.cookie, {
        to: 'cancelled',
        reason: 'أُلغي',
      });
      expect(dropped.allowedTransitions).toEqual(['in_production']);
      await expectError(
        await cast.move(produced.id, cast.writer.cookie, { to: 'idea' }),
        409,
        'INVALID_TRANSITION',
      );
      expect(
        (await cast.moveOk(produced.id, cast.writer.cookie, { to: 'in_production' })).status,
      ).toBe('in_production');
    });
  });

  describe('transactions', () => {
    it('writes no review, audit entry or status when a pass is refused', async () => {
      const post = await cast.postAt('internal_review', { clientId });
      const before = (await cast.auditOf(post.id)).length;
      await expectError(
        await cast.move(post.id, cast.contentManager.cookie, {
          to: 'awaiting_client',
          contentToken: 'stale',
        }),
        409,
        'REVIEW_CONTENT_CHANGED',
      );
      expect(await reviewsOf(post.id)).toEqual([]);
      expect(await cast.auditOf(post.id)).toHaveLength(before);
      expect((await cast.detail(post.id, cast.gm.cookie)).status).toBe('internal_review');
    });
  });

  describe('publish reminders (daily job)', () => {
    let reminders: PostReminders;
    let responsible: Awaited<ReturnType<typeof cast.signedIn>>;
    let own: string;
    // A Thursday far enough ahead: Friday is the weekend, Saturday the next work day.
    const thursday = (() => {
      let date = addDays(businessDate(), 30);
      while (weekday(date) !== 4) date = addDays(date, 1);
      return date;
    })();
    const friday = addDays(thursday, 1);
    const saturday = addDays(thursday, 2);

    const dated = async (publishDate: string, status: 'approved' | 'scheduled' = 'approved') => {
      const post = await cast.postAt(status, { clientId: own, responsibleId: responsible.id });
      await db.update(contentPosts).set({ publishDate }).where(eq(contentPosts.id, post.id));
      await db.delete(notifications).where(eq(notifications.subjectId, post.id));
      return post;
    };

    beforeAll(async () => {
      reminders = app.get(PostReminders);
      responsible = await cast.signedIn({
        name: `مسؤول النشر ${cast.run}`,
        departments: [{ code: 'content_management' }],
      });
      own = (await cast.createClient()).id;
    });

    it('announces the posts of today and of the weekend before the next work day, once', async () => {
      expect(nextWorkDay(thursday)).toBe(saturday);
      const today = await dated(thursday);
      const onFriday = await dated(friday, 'scheduled');
      const onSaturday = await dated(saturday);

      expect(await reminders.remind(friday)).toBe(0);
      await reminders.remind(thursday);
      await reminders.remind(thursday);
      expect(await cast.typesOf(responsible.id, today.id)).toEqual(['post_publish_today']);
      expect(await cast.typesOf(responsible.id, onFriday.id)).toEqual(['post_publish_today']);
      expect(await cast.typesOf(responsible.id, onSaturday.id)).toEqual([]);
      expect(await cast.typesOf(cast.am.id, today.id)).toEqual([]);
    });

    it('tells the responsible person and the account manager once when the date passes', async () => {
      const late = await dated(thursday);
      const published = await dated(thursday);
      await cast.moveOk(published.id, cast.writer.cookie, { to: 'published' });
      const cancelled = await dated(thursday);
      await cast.moveOk(cancelled.id, cast.writer.cookie, { to: 'cancelled', reason: 'أُلغي' });
      const archived = await dated(thursday);
      await client.post(`/api/content/posts/${archived.id}/archive`, cast.gm.cookie);
      const inProduction = await cast.createPost(cast.writer.cookie, {
        clientId: own,
        responsibleId: responsible.id,
      });
      await db
        .update(contentPosts)
        .set({ publishDate: thursday })
        .where(eq(contentPosts.id, inProduction.id));
      for (const post of [published, cancelled, archived, inProduction]) {
        await db.delete(notifications).where(eq(notifications.subjectId, post.id));
      }

      await reminders.remind(saturday);
      await reminders.remind(saturday);
      expect(await cast.typesOf(responsible.id, late.id)).toEqual(['post_publish_overdue']);
      expect(await cast.typesOf(cast.am.id, late.id)).toEqual(['post_publish_overdue']);
      for (const post of [published, cancelled, archived, inProduction]) {
        expect(await cast.typesOf(responsible.id, post.id)).toEqual([]);
      }

      // A new publish date starts again.
      await db
        .update(contentPosts)
        .set({ publishDate: saturday })
        .where(eq(contentPosts.id, late.id));
      await db.delete(notifications).where(eq(notifications.subjectId, late.id));
      await reminders.remind(addDays(saturday, 1));
      expect(await cast.typesOf(responsible.id, late.id)).toEqual(['post_publish_overdue']);
    });
  });
});
