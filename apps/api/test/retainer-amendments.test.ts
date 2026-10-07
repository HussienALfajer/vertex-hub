import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type Amendment,
  addDays,
  addMonths,
  amendmentPageSchema,
  amendmentPreviewSchema,
  amendmentSchema,
  businessDate,
  dayAfterTerm,
  firstOfMonth,
  invoiceDetailSchema,
  type RetainerDetail,
  retainerAmendmentPageSchema,
  retainerBillingSchema,
  retainerChargeSchema,
  retainerDetailSchema,
  retainerPageSchema,
  retainerTermListSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  invoiceLines,
  invoices,
  notifications,
  retainerCharges,
  retainerCycleLines,
  retainerCycles,
  retainerDeliverables,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetainerCyclesService } from '../src/modules/projects/index.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('retainer amendments (F05B A1–A9, C5, C6, C9)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let clientId: string;
  const today = businessDate();
  const thisMonth = firstOfMonth(today);
  const nextMonth = addMonths(thisMonth, 1);
  const lastMonth = addMonths(thisMonth, 2);

  async function ok<T>(response: Response, parse: (body: unknown) => T, status = 200) {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return parse(await response.json());
  }

  const path = (retainerId: string) => `/api/retainers/${retainerId}/amendments`;
  const amend = (retainerId: string, body: Record<string, unknown>, cookie = cast.am.cookie) =>
    client.post(path(retainerId), cookie, { reason: 'طلب العميل', ...body });
  const created = async (
    retainerId: string,
    body: Record<string, unknown>,
    cookie = cast.am.cookie,
  ): Promise<Amendment> =>
    ok(await amend(retainerId, body, cookie), (value) => amendmentSchema.parse(value), 201);
  const decide = (
    retainerId: string,
    amendmentId: string,
    action: 'approve' | 'reject' | 'withdraw',
    body: Record<string, unknown> = {},
    cookie = cast.gm.cookie,
  ) => client.post(`${path(retainerId)}/${amendmentId}/${action}`, cookie, body);
  const reschedule = (
    retainerId: string,
    termId: string,
    schedule: { month: string; amountMinor: number }[],
    cookie = cast.am.cookie,
  ) =>
    client.post(`/api/retainers/${retainerId}/terms/${termId}/reschedule`, cookie, {
      schedule,
      reason: 'إعادة توزيع',
    });
  const detail = async (retainerId: string, cookie = cast.am.cookie) =>
    ok(await client.get(`/api/retainers/${retainerId}`, cookie), (body) =>
      retainerDetailSchema.parse(body),
    );
  const termsOf = async (retainerId: string) =>
    (
      await ok(await client.get(`/api/retainers/${retainerId}/terms`, cast.am.cookie), (body) =>
        retainerTermListSchema.parse(body),
      )
    ).items;

  /** A retainer of the account manager's client, starting today. */
  async function retainer(input: Record<string, unknown> = {}): Promise<RetainerDetail> {
    return ok(
      await client.post('/api/retainers', cast.am.cookie, {
        clientId,
        name: `عقد تعديل ${randomUUID().slice(0, 6)}`,
        departments: ['design'],
        startDate: today,
        deliverables: [
          { kind: 'design', monthlyQuantity: 12 },
          { kind: 'reel', monthlyQuantity: 4 },
        ],
        ...input,
      }),
      (body) => retainerDetailSchema.parse(body),
      201,
    );
  }

  const term = (schedule: number[], endAction = 'renew') => ({
    months: schedule.length,
    agreedTotalMinor: schedule.reduce((sum, amount) => sum + amount, 0),
    schedule,
    endAction,
  });

  const chargesOf = (retainerId: string) =>
    db
      .select()
      .from(retainerCharges)
      .where(eq(retainerCharges.retainerId, retainerId))
      .orderBy(asc(retainerCharges.month), asc(retainerCharges.createdAt));

  const liveInvoicesOf = async (retainerId: string) => {
    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.retainerId, retainerId), isNull(invoices.archivedAt)))
      .orderBy(asc(invoices.createdAt));
    const lines = rows.length
      ? await db
          .select()
          .from(invoiceLines)
          .where(
            inArray(
              invoiceLines.invoiceId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(invoiceLines.position))
      : [];
    return rows.map((row) => ({
      ...row,
      lines: lines.filter((line) => line.invoiceId === row.id),
    }));
  };

  /** Finance issues the retainer's draft of `month` (its monthly line). */
  async function issueMonth(retainerId: string, month: string) {
    const charges = await chargesOf(retainerId);
    const charge = charges.find((row) => row.month === month && row.kind === 'monthly');
    const [line] = await db
      .select({ invoiceId: invoiceLines.invoiceId })
      .from(invoiceLines)
      .where(and(eq(invoiceLines.retainerChargeId, charge?.id ?? ''), invoiceLines.holdsSource));
    const draft = await ok(
      await client.get(`/api/invoices/${line?.invoiceId}`, finance.cookie),
      (body) => invoiceDetailSchema.parse(body),
    );
    return ok(
      await client.post(`/api/invoices/${draft.id}/issue`, finance.cookie, {
        updatedAt: draft.updatedAt,
        sypPerUsd: '13000',
      }),
      (body) => invoiceDetailSchema.parse(body),
    );
  }

  const cycleLines = async (retainerId: string, month: string) => {
    const [cycle] = await db
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainerId), eq(retainerCycles.month, month)));
    if (!cycle) return [];
    return db
      .select()
      .from(retainerCycleLines)
      .where(eq(retainerCycleLines.cycleId, cycle.id))
      .orderBy(asc(retainerCycleLines.position));
  };

  const runJob = (date: string) => app.get(RetainerCyclesService).runDaily(date);

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const [id, other] = [randomUUID(), randomUUID()];
    expect((await client.get(path(id))).status).toBe(401);
    expect((await client.post(path(id))).status).toBe(401);
    expect((await client.post(`${path(id)}/preview`)).status).toBe(401);
    for (const action of ['approve', 'reject', 'withdraw']) {
      expect((await client.post(`${path(id)}/${other}/${action}`)).status).toBe(401);
    }
    expect((await client.post(`/api/retainers/${id}/terms/${other}/reschedule`)).status).toBe(401);
    expect((await client.get('/api/retainer-amendments')).status).toBe(401);
    expect((await client.post(`/api/retainers/${id}/charges/${other}/settle`)).status).toBe(401);
  });

  describe('the acceptance flow on a 3-month term (spec "Acceptance" 1–8)', () => {
    let subject: RetainerDetail;
    let termId: string;
    let reduction: Amendment;

    it('adds reels and an amount to an issued month: a supplementary draft (A2, C6, C4)', async () => {
      subject = await retainer({ term: term([30000, 30000, 40000]) });
      termId = (await termsOf(subject.id))[0]?.id ?? '';
      await issueMonth(subject.id, thisMonth);

      const preview = await ok(
        await client.post(`${path(subject.id)}/preview`, cast.am.cookie, {
          scope: 'month',
          effectiveMonth: thisMonth,
          lines: [{ kind: 'reel', quantityDelta: 2 }],
          amountDeltaMinor: 10000,
          reason: 'x',
        }),
        (body) => amendmentPreviewSchema.parse(body),
      );
      expect(preview).toMatchObject({ moneyDeltaMinor: 10000, needsApproval: false });
      expect(preview.months).toEqual([
        expect.objectContaining({
          month: thisMonth,
          effect: 'addition',
          money: { beforeMinor: 30000, afterMinor: 40000 },
        }),
      ]);

      const amendment = await created(subject.id, {
        scope: 'month',
        effectiveMonth: thisMonth,
        lines: [{ kind: 'reel', quantityDelta: 2 }],
        amountDeltaMinor: 10000,
      });
      expect(amendment).toMatchObject({ number: 1, status: 'applied', kind: 'change' });
      expect(amendment.effects.map((effect) => effect.effect)).toEqual(['addition']);

      const reels = (await cycleLines(subject.id, thisMonth)).find((line) => line.kind === 'reel');
      expect(reels).toMatchObject({ committedQuantity: 6, amendmentId: amendment.id });
      const addition = (await chargesOf(subject.id)).find((row) => row.kind === 'addition');
      expect(addition).toMatchObject({ amountMinor: 10000, amendmentId: amendment.id });
      expect(addition?.dueAt).not.toBeNull();
      const supplementary = (await liveInvoicesOf(subject.id)).find(
        (invoice) => invoice.origin === 'retainer_amendment',
      );
      expect(supplementary).toMatchObject({ status: 'draft', totalMinor: 10000 });
      expect(supplementary?.lines[0]?.description).toContain('تعديل 1');
      expect((await detail(subject.id)).term?.money).toEqual({
        agreedTotalMinor: 100000,
        currentTotalMinor: 110000,
      });
      // The base is not moved by a one-month change (T7).
      const [current] = await termsOf(subject.id);
      expect(current?.schedule[0]?.money?.baseAmountMinor).toBe(30000);
    });

    it('schedules a new line and an amount onward from next month (A1–A3, A5)', async () => {
      const amendment = await created(subject.id, {
        scope: 'onward',
        effectiveMonth: nextMonth,
        lines: [{ kind: 'monthly_report', quantityDelta: 1 }],
        amountDeltaMinor: 5000,
      });
      expect(amendment.status).toBe('scheduled');
      expect(amendment.money?.moneyDeltaMinor).toBe(10000);
      expect(amendment.effects.map((effect) => [effect.month, effect.effect])).toEqual([
        [nextMonth, 'charge_changed'],
        [lastMonth, 'charge_changed'],
      ]);
      // Nothing changes before its month.
      const monthly = (await chargesOf(subject.id)).filter((row) => row.kind === 'monthly');
      expect(monthly.map((row) => row.amountMinor)).toEqual([30000, 30000, 40000]);
    });

    it('waits for the General Manager on a reduction, then credits the paid month (A4, C6)', async () => {
      reduction = await created(subject.id, {
        scope: 'month',
        effectiveMonth: thisMonth,
        amountDeltaMinor: -8000,
      });
      expect(reduction).toMatchObject({ status: 'pending_approval' });
      expect(reduction.money?.moneyDeltaMinor).toBe(-8000);
      expect((await chargesOf(subject.id)).some((row) => row.kind === 'credit')).toBe(false);
      const notified = await db
        .select({ recipientId: notifications.recipientId, data: notifications.data })
        .from(notifications)
        .where(
          and(
            eq(notifications.subjectId, subject.id),
            eq(notifications.type, 'retainer_amendment_pending'),
          ),
        );
      expect(notified.map((row) => row.recipientId)).toContain(cast.gm.id);
      expect((await detail(subject.id)).pendingAmendments).toBe(1);

      const pending = await ok(
        await client.get('/api/retainer-amendments', cast.gm.cookie),
        (body) => retainerAmendmentPageSchema.parse(body),
      );
      expect(pending.items.find((item) => item.id === reduction.id)).toMatchObject({
        retainer: { id: subject.id, currency: 'USD' },
        client: { id: clientId },
      });
      const filtered = await ok(
        await client.get('/api/retainers?pendingApproval=true', cast.gm.cookie),
        (body) => retainerPageSchema.parse(body),
      );
      expect(filtered.items.map((item) => item.id)).toContain(subject.id);

      expect((await decide(subject.id, reduction.id, 'approve', {}, cast.am.cookie)).status).toBe(
        403,
      );
      const approved = await ok(await decide(subject.id, reduction.id, 'approve'), (body) =>
        amendmentSchema.parse(body),
      );
      expect(approved).toMatchObject({
        status: 'applied',
        decision: { approved: true, by: { id: cast.gm.id } },
      });
      expect(approved.effects.map((effect) => effect.effect)).toEqual(['credit']);
      const credit = (await chargesOf(subject.id)).find((row) => row.kind === 'credit');
      expect(credit).toMatchObject({ amountMinor: -8000, status: 'pending' });
      expect((await detail(subject.id, finance.cookie)).money?.creditPendingMinor).toBe(8000);
      const decided = await db
        .select({ recipientId: notifications.recipientId })
        .from(notifications)
        .where(
          and(
            eq(notifications.subjectId, subject.id),
            eq(notifications.type, 'retainer_amendment_decided'),
          ),
        );
      expect(decided.map((row) => row.recipientId)).toEqual([cast.am.id]);
      await expectError(
        await decide(subject.id, reduction.id, 'approve'),
        409,
        'INVALID_TRANSITION',
      );
    });

    it('applies the scheduled amendment before next month’s draft, which takes the credit (A5, C5)', async () => {
      await runJob(nextMonth);
      const monthly = (await chargesOf(subject.id)).filter((row) => row.kind === 'monthly');
      expect(monthly.map((row) => [row.amountMinor, row.baseAmountMinor])).toEqual([
        [30000, 30000],
        [35000, 35000],
        [45000, 45000],
      ]);
      const standing = await db
        .select({ kind: retainerDeliverables.kind, quantity: retainerDeliverables.monthlyQuantity })
        .from(retainerDeliverables)
        .where(
          and(
            eq(retainerDeliverables.retainerId, subject.id),
            isNull(retainerDeliverables.archivedAt),
          ),
        );
      expect(standing).toContainEqual({ kind: 'monthly_report', quantity: 1 });
      expect((await cycleLines(subject.id, nextMonth)).map((line) => line.kind)).toContain(
        'monthly_report',
      );
      const draft = (await liveInvoicesOf(subject.id)).find(
        (invoice) =>
          invoice.origin === 'cycle_opened' &&
          invoice.status === 'draft' &&
          invoice.lines.some((line) => line.unitPriceMinor === 35000),
      );
      expect(draft?.totalMinor).toBe(27000);
      expect(draft?.lines.map((line) => line.unitPriceMinor)).toEqual([35000, -8000]);
      const amendments = await ok(await client.get(path(subject.id), cast.am.cookie), (body) =>
        amendmentPageSchema.parse(body),
      );
      expect(amendments.items.map((item) => [item.number, item.status])).toEqual([
        [3, 'applied'],
        [2, 'applied'],
        [1, 'applied'],
      ]);
    });

    it('reschedules unbilled months at the same total, syncing the draft (A6, C6)', async () => {
      await expectError(
        await reschedule(subject.id, termId, [
          { month: nextMonth, amountMinor: 40000 },
          { month: lastMonth, amountMinor: 30000 },
        ]),
        409,
        'SCHEDULE_TOTAL_MISMATCH',
      );
      await expectError(
        await reschedule(subject.id, termId, [{ month: thisMonth, amountMinor: 30000 }]),
        409,
        'MONTH_INVOICED',
      );
      const done = await ok(
        await reschedule(subject.id, termId, [
          { month: nextMonth, amountMinor: 40000 },
          { month: lastMonth, amountMinor: 40000 },
        ]),
        (body) => amendmentSchema.parse(body),
      );
      expect(done).toMatchObject({ kind: 'reschedule', scope: null, status: 'applied' });
      expect(done.effects.map((effect) => effect.effect)).toEqual([
        'draft_synced',
        'charge_changed',
      ]);
      const monthly = (await chargesOf(subject.id)).filter((row) => row.kind === 'monthly');
      expect(monthly.map((row) => [row.amountMinor, row.baseAmountMinor])).toEqual([
        [30000, 30000],
        [40000, 40000],
        [40000, 40000],
      ]);
      const draft = (await liveInvoicesOf(subject.id)).find((invoice) =>
        invoice.lines.some((line) => line.unitPriceMinor === 40000),
      );
      expect(draft?.totalMinor).toBe(32000);
    });

    it('renews with the onward amounts and the reschedule, not the one-month ones (T7)', async () => {
      await runJob(addDays(dayAfterTerm(lastMonth), -30));
      const [renewal] = await termsOf(subject.id);
      expect(renewal).toMatchObject({ number: 2, status: 'scheduled' });
      expect(renewal?.schedule.map((month) => month.money?.amountMinor)).toEqual([
        30000, 40000, 40000,
      ]);
    });

    it('cancels pending and scheduled amendments when the retainer ends (A8)', async () => {
      const pending = await created(subject.id, {
        scope: 'month',
        effectiveMonth: lastMonth,
        amountDeltaMinor: -1000,
      });
      const scheduled = await created(subject.id, {
        scope: 'month',
        effectiveMonth: lastMonth,
        amountDeltaMinor: 1000,
      });
      expect([pending.status, scheduled.status]).toEqual(['pending_approval', 'scheduled']);
      await ok(
        await client.post(`/api/retainers/${subject.id}/status`, cast.am.cookie, {
          status: 'ended',
        }),
        (body) => retainerDetailSchema.parse(body),
      );
      const page = await ok(await client.get(path(subject.id), cast.am.cookie), (body) =>
        amendmentPageSchema.parse(body),
      );
      const statuses = new Map(page.items.map((item) => [item.id, item.status]));
      expect([statuses.get(pending.id), statuses.get(scheduled.id)]).toEqual([
        'cancelled',
        'cancelled',
      ]);
      await expectError(
        await amend(subject.id, { scope: 'month', effectiveMonth: thisMonth, amountDeltaMinor: 1 }),
        409,
        'RETAINER_ENDED',
      );
      const actions = await db
        .select({ action: auditEntries.action })
        .from(auditEntries)
        .where(eq(auditEntries.entityId, pending.id))
        .orderBy(asc(auditEntries.id));
      expect(actions.map((row) => row.action)).toEqual([
        'retainer_amendment.created',
        'retainer_amendment.cancelled',
      ]);
    });

    it('settles a pending credit outside the system (C9)', async () => {
      const [owed] = await db
        .insert(retainerCharges)
        .values({
          retainerId: subject.id,
          month: thisMonth,
          kind: 'credit',
          amountMinor: -2500,
          dueAt: new Date(),
        })
        .returning();
      const settle = (cookie: string, note = 'أعيد نقدًا') =>
        client.post(`/api/retainers/${subject.id}/charges/${owed?.id}/settle`, cookie, { note });
      expect((await settle(cast.employee.cookie)).status).toBe(403);
      // Out of scope: another account manager's client.
      expect((await settle(cast.otherAm.cookie)).status).toBe(403);
      const settled = await ok(await settle(finance.cookie), (body) =>
        retainerChargeSchema.parse(body),
      );
      expect(settled).toMatchObject({ status: 'settled_outside', settleNote: 'أعيد نقدًا' });
      await expectError(await settle(finance.cookie), 409, 'INVALID_TRANSITION');
      const billing = await ok(
        await client.get(`/api/retainers/${subject.id}/billing`, finance.cookie),
        (body) => retainerBillingSchema.parse(body),
      );
      expect(billing.canSettleCredits).toBe(true);
    });
  });

  describe('rules and errors', () => {
    it('refuses empty, misplaced, negative and impossible changes (A1–A3)', async () => {
      const subject = await retainer({ term: term([30000, 30000], 'renew') });
      await expectError(
        await amend(subject.id, { scope: 'month', effectiveMonth: thisMonth }),
        400,
        'EMPTY_AMENDMENT',
      );
      await expectError(
        await amend(subject.id, {
          scope: 'month',
          effectiveMonth: addMonths(thisMonth, -1),
          amountDeltaMinor: 100,
        }),
        400,
        'INVALID_EFFECTIVE_MONTH',
      );
      // After a term that renews, a month is no open-ended month.
      await expectError(
        await amend(subject.id, {
          scope: 'month',
          effectiveMonth: addMonths(thisMonth, 2),
          amountDeltaMinor: 100,
        }),
        400,
        'INVALID_EFFECTIVE_MONTH',
      );
      await expectError(
        await amend(subject.id, {
          scope: 'month',
          effectiveMonth: thisMonth,
          lines: [{ kind: 'reel', quantityDelta: -5 }],
        }),
        400,
        'INVALID_QUANTITY',
      );
      await expectError(
        await amend(subject.id, {
          scope: 'onward',
          effectiveMonth: nextMonth,
          lines: [{ kind: 'video', quantityDelta: -1 }],
        }),
        400,
        'INVALID_QUANTITY',
      );
      await expectError(
        await amend(
          subject.id,
          { scope: 'month', effectiveMonth: nextMonth, amountDeltaMinor: -30001 },
          cast.gm.cookie,
        ),
        409,
        'NEGATIVE_AMOUNT',
      );
      await expectError(
        await amend(subject.id, {
          scope: 'month',
          effectiveMonth: thisMonth,
          lines: [
            { kind: 'reel', quantityDelta: 1 },
            { kind: 'reel', quantityDelta: 2 },
          ],
        }),
        409,
        'DUPLICATE_DELIVERABLE',
      );
    });

    it('applies a General Manager’s reduction at once, and archives a line reaching 0 (A2, A4)', async () => {
      const subject = await retainer({ term: term([30000, 30000]) });
      const amendment = await created(
        subject.id,
        {
          scope: 'onward',
          effectiveMonth: thisMonth,
          lines: [{ kind: 'reel', quantityDelta: -4 }],
          amountDeltaMinor: -5000,
        },
        cast.gm.cookie,
      );
      expect(amendment.status).toBe('applied');
      // This month's charge is on a draft: synced; next month's changes.
      expect(amendment.effects.map((effect) => effect.effect)).toEqual([
        'draft_synced',
        'charge_changed',
      ]);
      const drafts = await liveInvoicesOf(subject.id);
      expect(drafts[0]?.totalMinor).toBe(25000);
      const reel = await db
        .select({ archivedAt: retainerDeliverables.archivedAt })
        .from(retainerDeliverables)
        .where(
          and(
            eq(retainerDeliverables.retainerId, subject.id),
            eq(retainerDeliverables.kind, 'reel'),
          ),
        );
      expect(reel[0]?.archivedAt).not.toBeNull();
    });

    it('rejects with a note, withdraws, and refuses an approval the state moved past (A4)', async () => {
      const subject = await retainer({ term: term([30000, 30000]) });
      const first = await created(subject.id, {
        scope: 'month',
        effectiveMonth: nextMonth,
        amountDeltaMinor: -20000,
      });
      expect((await decide(subject.id, first.id, 'reject', {})).status).toBe(400);
      const rejected = await ok(
        await decide(subject.id, first.id, 'reject', { note: 'ليس الآن' }),
        (body) => amendmentSchema.parse(body),
      );
      expect(rejected).toMatchObject({
        status: 'rejected',
        decision: { approved: false, note: 'ليس الآن' },
      });

      const second = await created(subject.id, {
        scope: 'month',
        effectiveMonth: nextMonth,
        amountDeltaMinor: -1000,
      });
      expect(
        (await decide(subject.id, second.id, 'withdraw', {}, cast.otherAm.cookie)).status,
      ).toBe(403);
      const withdrawn = await ok(
        await decide(subject.id, second.id, 'withdraw', {}, cast.am.cookie),
        (body) => amendmentSchema.parse(body),
      );
      expect(withdrawn.status).toBe('withdrawn');

      const third = await created(subject.id, {
        scope: 'month',
        effectiveMonth: nextMonth,
        amountDeltaMinor: -25000,
      });
      // The month drops to 10000 meanwhile: the reduction would make it negative.
      const termId = (await termsOf(subject.id))[0]?.id ?? '';
      await ok(
        await reschedule(subject.id, termId, [
          { month: thisMonth, amountMinor: 50000 },
          { month: nextMonth, amountMinor: 10000 },
        ]),
        (body) => amendmentSchema.parse(body),
      );
      const refused = await expectError(
        await decide(subject.id, third.id, 'approve'),
        409,
        'AMENDMENT_INVALID',
      );
      expect(refused.details).toEqual(['NEGATIVE_AMOUNT']);
    });

    it('changes an open-ended fee only by amendment (A9, A3)', async () => {
      const subject = await retainer({ monthlyFeeMinor: 100000 });
      await expectError(
        await client.request('PATCH', `/api/retainers/${subject.id}`, {
          cookie: cast.am.cookie,
          body: { monthlyFeeMinor: 120000 },
        }),
        409,
        'FEE_CHANGE_NEEDS_AMENDMENT',
      );
      const raise = await created(subject.id, {
        scope: 'onward',
        effectiveMonth: thisMonth,
        amountDeltaMinor: 20000,
      });
      expect(raise.status).toBe('applied');
      expect(raise.money?.moneyDeltaMinor).toBe(20000);
      expect(raise.effects.map((effect) => effect.effect).sort()).toEqual([
        'draft_synced',
        'fee_changed',
      ]);
      expect((await detail(subject.id)).money?.monthlyFeeMinor).toBe(120000);
      expect((await liveInvoicesOf(subject.id))[0]?.totalMinor).toBe(120000);

      const cut = await created(subject.id, {
        scope: 'onward',
        effectiveMonth: nextMonth,
        amountDeltaMinor: -10000,
      });
      expect(cut).toMatchObject({ status: 'pending_approval', money: { moneyDeltaMinor: -10000 } });
    });

    it('takes line changes for a month whose cycle opens later (A2)', async () => {
      const subject = await retainer({ term: term([1000, 1000]) });
      const amendment = await created(subject.id, {
        scope: 'month',
        effectiveMonth: nextMonth,
        lines: [{ kind: 'design', quantityDelta: 3 }],
      });
      expect(amendment.status).toBe('scheduled');
      await runJob(nextMonth);
      const design = (await cycleLines(subject.id, nextMonth)).find(
        (line) => line.kind === 'design',
      );
      expect(design).toMatchObject({ committedQuantity: 15, amendmentId: amendment.id });
    });

    it('hides amounts from callers without money access, and refuses other managers (G3)', async () => {
      const subject = await retainer({ term: term([1000, 1000]) });
      await created(subject.id, {
        scope: 'month',
        effectiveMonth: nextMonth,
        amountDeltaMinor: 500,
      });
      const seen = await ok(await client.get(path(subject.id), cast.employee.cookie), (body) =>
        amendmentPageSchema.parse(body),
      );
      expect(seen.items[0]?.money).toBeUndefined();
      expect(seen.items[0]?.effects.every((effect) => effect.money === undefined)).toBe(true);
      expect(seen.items[0]?.effects.every((effect) => effect.invoice === null)).toBe(true);
      const body = { scope: 'month', effectiveMonth: nextMonth, amountDeltaMinor: 1 };
      for (const cookie of [cast.employee.cookie, cast.otherAm.cookie, finance.cookie]) {
        expect((await amend(subject.id, body, cookie)).status).toBe(403);
        expect(
          (await client.post(`${path(subject.id)}/preview`, cookie, { ...body, reason: 'x' }))
            .status,
        ).toBe(403);
        const termId = (await termsOf(subject.id))[0]?.id ?? '';
        expect(
          (await reschedule(subject.id, termId, [{ month: nextMonth, amountMinor: 1000 }], cookie))
            .status,
        ).toBe(403);
      }
      const reduction = await created(subject.id, {
        scope: 'month',
        effectiveMonth: nextMonth,
        amountDeltaMinor: -100,
      });
      for (const action of ['approve', 'reject'] as const) {
        const response = await decide(
          subject.id,
          reduction.id,
          action,
          { note: 'x' },
          cast.am.cookie,
        );
        expect(response.status).toBe(403);
      }
      expect(
        (await decide(subject.id, reduction.id, 'withdraw', {}, cast.employee.cookie)).status,
      ).toBe(403);
      expect((await client.get('/api/retainer-amendments', cast.am.cookie)).status).toBe(403);
      expect((await client.get(path(randomUUID()), cast.am.cookie)).status).toBe(404);
    });

    it('refuses a month before the start, or a month without a charge that is not billed (C2)', async () => {
      const later = await retainer({ startDate: addDays(lastMonth, 3) });
      await expectError(
        await amend(later.id, { scope: 'month', effectiveMonth: thisMonth, amountDeltaMinor: 100 }),
        400,
        'INVALID_EFFECTIVE_MONTH',
      );
      const paused = await retainer();
      await ok(
        await client.post(`/api/retainers/${paused.id}/status`, cast.am.cookie, {
          status: 'paused',
        }),
        (value) => retainerDetailSchema.parse(value),
      );
      await expectError(
        await amend(paused.id, {
          scope: 'month',
          effectiveMonth: thisMonth,
          amountDeltaMinor: 100,
        }),
        400,
        'INVALID_EFFECTIVE_MONTH',
      );
    });

    it('keeps the line limits and refuses a closed month (A2, LIMIT_REACHED, CYCLE_CLOSED)', async () => {
      const full = await retainer({
        deliverables: Array.from({ length: 20 }, (_, index) => ({
          kind: 'other',
          label: `بند ${index}`,
          monthlyQuantity: 1,
        })),
      });
      await expectError(
        await amend(full.id, {
          scope: 'onward',
          effectiveMonth: nextMonth,
          lines: [{ kind: 'video', quantityDelta: 1 }],
        }),
        409,
        'LIMIT_REACHED',
      );

      // Ended and reactivated in the same month: the month's cycle stays closed.
      const reopened = await retainer();
      for (const [status, cookie] of [
        ['ended', cast.am.cookie],
        ['active', cast.gm.cookie],
      ] as const) {
        await ok(
          await client.post(`/api/retainers/${reopened.id}/status`, cookie, { status }),
          (value) => retainerDetailSchema.parse(value),
        );
      }
      await expectError(
        await amend(
          reopened.id,
          {
            scope: 'month',
            effectiveMonth: thisMonth,
            lines: [{ kind: 'design', quantityDelta: 1 }],
          },
          cast.gm.cookie,
        ),
        409,
        'CYCLE_CLOSED',
      );
    });

    it('splits a credit larger than the next month, and a reduction gives a taken credit back (C5, C6)', async () => {
      const subject = await retainer({ term: term([10000, 10000]) });
      const [credit] = await db
        .insert(retainerCharges)
        .values({
          retainerId: subject.id,
          month: thisMonth,
          kind: 'credit',
          amountMinor: -15000,
          dueAt: new Date(),
        })
        .returning();
      await runJob(nextMonth);
      const draft = (await liveInvoicesOf(subject.id)).find((invoice) =>
        invoice.lines.some((line) => line.retainerChargeId === credit?.id),
      );
      expect(draft?.lines.map((line) => line.unitPriceMinor)).toEqual([10000, -10000]);
      expect(draft?.totalMinor).toBe(0);
      const remainder = (await chargesOf(subject.id)).find((row) => row.splitFromId === credit?.id);
      expect(remainder).toMatchObject({ kind: 'credit', amountMinor: -5000, status: 'pending' });

      const cut = await created(
        subject.id,
        { scope: 'month', effectiveMonth: nextMonth, amountDeltaMinor: -5000 },
        cast.gm.cookie,
      );
      expect(cut).toMatchObject({ status: 'scheduled' });
      expect(cut.effects.map((effect) => effect.effect)).toEqual(['draft_synced']);
      // The job applies it in its month (A5); the draft gives back the credit it cannot hold.
      await runJob(nextMonth);
      const synced = (await liveInvoicesOf(subject.id)).find((invoice) => invoice.id === draft?.id);
      expect(synced?.lines.map((line) => line.unitPriceMinor)).toEqual([5000]);
      expect(synced?.totalMinor).toBe(5000);
    });
  });

  describe('credits on invoices (C7)', () => {
    it('allows a negative price on a credit line only, and issues a total of 0 as paid', async () => {
      const subject = await retainer({ term: term([5000]) });
      const [credit] = await db
        .insert(retainerCharges)
        .values({
          retainerId: subject.id,
          month: thisMonth,
          kind: 'credit',
          amountMinor: -5000,
          dueAt: new Date(),
        })
        .returning();
      const [draft] = await liveInvoicesOf(subject.id);
      const loaded = await ok(
        await client.get(`/api/invoices/${draft?.id}`, finance.cookie),
        (body) => invoiceDetailSchema.parse(body),
      );
      const monthLine = loaded.lines[0];
      const save = (lines: Record<string, unknown>[]) =>
        client.request('PUT', `/api/invoices/${loaded.id}`, {
          cookie: finance.cookie,
          body: {
            updatedAt: loaded.updatedAt,
            projectId: null,
            retainerId: subject.id,
            paymentTermsDays: 7,
            notes: null,
            lines,
          },
        });
      const month = {
        id: monthLine?.id,
        description: monthLine?.description,
        quantity: 1,
        unitPriceMinor: 5000,
        source: monthLine?.source && { type: monthLine.source.type, id: monthLine.source.id },
      };
      expect(
        (await save([month, { description: 'خصم', quantity: 1, unitPriceMinor: -100 }])).status,
      ).toBe(400);
      const creditLine = {
        description: 'رصيد دائن',
        quantity: 1,
        unitPriceMinor: -6000,
        source: { type: 'retainer_charge', id: credit?.id },
      };
      await expectError(await save([month, creditLine]), 409, 'INVOICE_NEGATIVE');
      const saved = await ok(
        await save([month, { ...creditLine, unitPriceMinor: -5000 }]),
        (body) => invoiceDetailSchema.parse(body),
      );
      expect(saved.totalMinor).toBe(0);
      const issued = await ok(
        await client.post(`/api/invoices/${saved.id}/issue`, finance.cookie, {
          updatedAt: saved.updatedAt,
          sypPerUsd: '13000',
        }),
        (body) => invoiceDetailSchema.parse(body),
      );
      expect(issued.status).toBe('paid');
    });
  });
});
