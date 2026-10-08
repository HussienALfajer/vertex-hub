import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  addMonths,
  businessDate,
  dayAfterTerm,
  firstOfMonth,
  lastOfMonth,
  type RetainerDetail,
  retainerBillingSchema,
  retainerDetailSchema,
  retainerTermListSchema,
  retainerTermSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  invoiceLines,
  invoices,
  notifications,
  retainerCharges,
  retainers,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetainerCyclesService } from '../src/modules/projects/index.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('retainer terms (F05B T1–T12, E1–E3)', () => {
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

  async function ok<T>(response: Response, parse: (body: unknown) => T, status = 200) {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return parse(await response.json());
  }

  const terms = (retainerId: string) => `/api/retainers/${retainerId}/terms`;
  const listTerms = async (retainerId: string, cookie = cast.am.cookie) =>
    (
      await ok(await client.get(terms(retainerId), cookie), (body) =>
        retainerTermListSchema.parse(body),
      )
    ).items;
  const addTerm = (retainerId: string, body: Record<string, unknown>, cookie = cast.am.cookie) =>
    client.post(terms(retainerId), cookie, body);
  const patch = (path: string, body: unknown, cookie = cast.am.cookie) =>
    client.request('PATCH', path, { cookie, body });
  const detail = async (retainerId: string, cookie = cast.am.cookie) =>
    ok(await client.get(`/api/retainers/${retainerId}`, cookie), (body) =>
      retainerDetailSchema.parse(body),
    );

  /** A retainer of the account manager's client, created by them, starting today. */
  async function retainer(input: Record<string, unknown> = {}): Promise<RetainerDetail> {
    return ok(
      await client.post('/api/retainers', cast.am.cookie, {
        clientId,
        name: `عقد مدة ${randomUUID().slice(0, 6)}`,
        departments: ['design'],
        startDate: today,
        deliverables: [{ kind: 'design', monthlyQuantity: 12 }],
        ...input,
      }),
      (body) => retainerDetailSchema.parse(body),
      201,
    );
  }

  const term = (months: number, schedule: number[], endAction = 'renew') => ({
    months,
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

  const draftsOf = (retainerId: string) =>
    db
      .select({ invoice: invoices, line: invoiceLines })
      .from(invoices)
      .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
      .where(eq(invoices.retainerId, retainerId))
      .orderBy(asc(invoices.createdAt));

  const auditActions = async (entityIds: string[]) =>
    (
      await db
        .select({ action: auditEntries.action })
        .from(auditEntries)
        .where(inArray(auditEntries.entityId, entityIds))
        .orderBy(asc(auditEntries.id))
    ).map((row) => row.action);

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
    const [id, termId] = [randomUUID(), randomUUID()];
    expect((await client.get(terms(id))).status).toBe(401);
    expect((await client.post(terms(id))).status).toBe(401);
    expect((await client.request('PATCH', `${terms(id)}/${termId}`, {})).status).toBe(401);
    expect((await client.post(`${terms(id)}/${termId}/cancel`)).status).toBe(401);
  });

  describe('a new retainer with a term', () => {
    it('creates the term, its schedule and this month’s draft (T3, T4, C4, T11)', async () => {
      const created = await retainer({ term: term(3, [30000, 30000, 40000]) });
      const endMonth = addMonths(thisMonth, 2);
      expect(created.renewalDate).toBe(dayAfterTerm(endMonth));
      expect(created.term).toMatchObject({
        number: 1,
        status: 'active',
        startMonth: thisMonth,
        endMonth,
        months: 3,
        endAction: 'renew',
        money: { agreedTotalMinor: 100000, currentTotalMinor: 100000 },
      });

      const charges = await chargesOf(created.id);
      expect(charges.map((row) => [row.month, row.amountMinor, row.baseAmountMinor])).toEqual([
        [thisMonth, 30000, 30000],
        [nextMonth, 30000, 30000],
        [endMonth, 40000, 40000],
      ]);
      expect(charges.map((row) => !!row.dueAt)).toEqual([true, false, false]);
      const drafts = await draftsOf(created.id);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.invoice).toMatchObject({ origin: 'cycle_opened', totalMinor: 30000 });
      expect(drafts[0]?.line.description).toContain('(1 من 3)');

      const [shown] = await listTerms(created.id);
      expect(shown?.schedule.map((month) => [month.position, month.due, month.money])).toEqual([
        [1, true, { amountMinor: 30000, baseAmountMinor: 30000, totalMinor: 30000 }],
        [2, false, { amountMinor: 30000, baseAmountMinor: 30000, totalMinor: 30000 }],
        [3, false, { amountMinor: 40000, baseAmountMinor: 40000, totalMinor: 40000 }],
      ]);

      const billing = await ok(
        await client.get(`/api/retainers/${created.id}/billing`, finance.cookie),
        (body) => retainerBillingSchema.parse(body),
      );
      expect(billing.charges.map((charge) => charge.term)).toEqual([
        { number: 1, position: 3, months: 3 },
        { number: 1, position: 2, months: 3 },
        { number: 1, position: 1, months: 3 },
      ]);
      expect(await auditActions([shown?.id ?? ''])).toEqual(['retainer_term.created']);
    });

    it('shows months and end actions without amounts to callers without money access (G3)', async () => {
      const created = await retainer({ term: term(2, [5000, 5000], 'continue') });
      const [shown] = await listTerms(created.id, cast.employee.cookie);
      expect(shown?.money).toBeUndefined();
      expect(shown?.schedule.every((month) => month.money === undefined)).toBe(true);
      expect(shown?.endAction).toBe('continue');
      const seen = await detail(created.id, cast.employee.cookie);
      expect(seen.term).toMatchObject({ number: 1, endAction: 'continue' });
      expect(seen.term?.money).toBeUndefined();
    });

    it('refuses a schedule that does not add up, and a renewal date with a term', async () => {
      const base = {
        clientId,
        name: `عقد ${randomUUID().slice(0, 6)}`,
        departments: ['design'],
        startDate: today,
      };
      await expectError(
        await client.post('/api/retainers', cast.am.cookie, {
          ...base,
          term: { months: 2, agreedTotalMinor: 1000, schedule: [500, 400] },
        }),
        409,
        'SCHEDULE_TOTAL_MISMATCH',
      );
      await expectError(
        await client.post('/api/retainers', cast.am.cookie, {
          ...base,
          term: { months: 3, agreedTotalMinor: 1000, schedule: [500, 500] },
        }),
        409,
        'SCHEDULE_TOTAL_MISMATCH',
      );
      await expectError(
        await client.post('/api/retainers', cast.am.cookie, {
          ...base,
          renewalDate: addDays(today, 90),
          term: term(1, [1000]),
        }),
        409,
        'RENEWAL_DATE_FROM_TERM',
      );
      // Another account manager's client is out of scope.
      expect(
        (await client.post('/api/retainers', cast.otherAm.cookie, { ...base, term: term(1, [1]) }))
          .status,
      ).toBe(403);
    });
  });

  describe('adding a term', () => {
    it('checks access: client scope and money access (403, 404)', async () => {
      const created = await retainer();
      const body = { startMonth: nextMonth, ...term(1, [1000]) };
      expect((await addTerm(created.id, body, cast.employee.cookie)).status).toBe(403);
      expect((await addTerm(created.id, body, cast.otherAm.cookie)).status).toBe(403);
      expect((await addTerm(created.id, body, finance.cookie)).status).toBe(403);
      expect((await addTerm(randomUUID(), body)).status).toBe(404);
      expect((await client.get(terms(randomUUID()), cast.am.cookie)).status).toBe(404);
      expect(await listTerms(created.id)).toEqual([]);
    });

    it('starts no earlier than this month and after every other term (T2)', async () => {
      const created = await retainer({ term: term(2, [1000, 1000]) });
      await expectError(
        await addTerm(created.id, { startMonth: addMonths(thisMonth, -1), ...term(1, [1]) }),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await addTerm(created.id, { startMonth: nextMonth, ...term(1, [1]) }),
        409,
        'TERM_OVERLAP',
      );
      const after = addMonths(thisMonth, 2);
      await ok(
        await addTerm(created.id, { startMonth: after, ...term(1, [700]) }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      await expectError(
        await addTerm(created.id, { startMonth: addMonths(thisMonth, 4), ...term(1, [1]) }),
        409,
        'TERM_OVERLAP',
      );
      expect((await detail(created.id)).renewalDate).toBe(dayAfterTerm(after));
      const later = await retainer({ startDate: addDays(lastOfMonth(today), 1) });
      await expectError(
        await addTerm(later.id, { startMonth: thisMonth, ...term(1, [1]) }),
        400,
        'INVALID_DATES',
      );
    });

    it('refuses an ended or archived retainer and an archived client', async () => {
      const ended = await retainer();
      await ok(
        await client.post(`/api/retainers/${ended.id}/status`, cast.am.cookie, { status: 'ended' }),
        (body) => retainerDetailSchema.parse(body),
      );
      const body = { startMonth: nextMonth, ...term(1, [1000]) };
      await expectError(await addTerm(ended.id, body), 409, 'RETAINER_ENDED');

      const archived = await retainer();
      expect(
        (await client.post(`/api/retainers/${archived.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(await addTerm(archived.id, body, cast.gm.cookie), 409, 'RETAINER_ARCHIVED');

      const other = await cast.createClient();
      const ofArchivedClient = await cast.createRetainer(other.id);
      await client.post(`/api/clients/${other.id}/archive`, cast.gm.cookie);
      await expectError(
        await addTerm(ofArchivedClient.id, body, cast.gm.cookie),
        409,
        'CLIENT_ARCHIVED',
      );
    });

    it('replaces a term charge kept by an early end when the retainer is reactivated (T4, E1, E3)', async () => {
      const created = await retainer({ term: term(2, [1000, 2000]) });
      const [draft] = await draftsOf(created.id);
      const status = `/api/retainers/${created.id}/status`;
      expect((await client.post(status, cast.am.cookie, { status: 'ended' })).status).toBe(200);
      expect((await client.post(status, cast.gm.cookie, { status: 'active' })).status).toBe(200);
      // This month's charge stays on its draft: the new term waits for next month.
      await expectError(
        await addTerm(created.id, { startMonth: thisMonth, ...term(1, [500]) }),
        409,
        'MONTH_ALREADY_CHARGED',
      );
      expect(
        (await client.post(`/api/invoices/${draft?.invoice.id}/archive`, finance.cookie)).status,
      ).toBe(204);
      await ok(
        await addTerm(created.id, { startMonth: thisMonth, ...term(1, [500]) }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      const live = (await chargesOf(created.id)).filter(
        (row) => row.month === thisMonth && row.status === 'pending',
      );
      expect(live.map((row) => row.amountMinor)).toEqual([500]);
    });

    it('keeps the start date at or before the term’s month (T2)', async () => {
      const later = addMonths(thisMonth, 1);
      const created = await retainer({ startDate: later, term: term(2, [1000, 1000]) });
      expect(created.term?.status).toBe('scheduled');
      await expectError(
        await patch(`/api/retainers/${created.id}`, { startDate: addMonths(thisMonth, 2) }),
        400,
        'INVALID_DATES',
      );
      expect(
        (await patch(`/api/retainers/${created.id}`, { startDate: addDays(later, 14) })).status,
      ).toBe(200);
    });

    it('replaces an uninvoiced open-ended charge of this month, else refuses (T4)', async () => {
      const created = await retainer({ monthlyFeeMinor: 20000 });
      const [openEnded] = await chargesOf(created.id);
      await expectError(
        await addTerm(created.id, { startMonth: thisMonth, ...term(1, [50000]) }),
        409,
        'MONTH_ALREADY_CHARGED',
      );
      const [draft] = await draftsOf(created.id);
      expect(
        (await client.post(`/api/invoices/${draft?.invoice.id}/archive`, finance.cookie)).status,
      ).toBe(204);
      await ok(
        await addTerm(created.id, { startMonth: thisMonth, ...term(1, [50000]) }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      const charges = await chargesOf(created.id);
      expect(charges.map((row) => [row.id === openEnded?.id, row.status, row.amountMinor])).toEqual(
        [
          [true, 'cancelled', 20000],
          [false, 'pending', 50000],
        ],
      );
      const live = (await draftsOf(created.id)).filter((row) => !row.invoice.archivedAt);
      expect(live.map((row) => row.invoice.totalMinor)).toEqual([50000]);
    });
  });

  describe('changing a term', () => {
    it('edits and cancels a scheduled term, rebuilding its charges (T5)', async () => {
      const created = await retainer({ term: term(1, [1000]) });
      const scheduled = await ok(
        await addTerm(created.id, { startMonth: nextMonth, ...term(2, [2000, 2000]) }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      expect(scheduled.status).toBe('scheduled');
      const path = `${terms(created.id)}/${scheduled.id}`;
      await expectError(
        await patch(path, { agreedTotalMinor: 5000 }),
        409,
        'SCHEDULE_TOTAL_MISMATCH',
      );
      const edited = await ok(
        await patch(path, { months: 3, agreedTotalMinor: 6000, schedule: [1000, 2000, 3000] }),
        (body) => retainerTermSchema.parse(body),
      );
      expect(edited.schedule.map((month) => month.money?.amountMinor)).toEqual([1000, 2000, 3000]);
      expect(edited.endMonth).toBe(addMonths(nextMonth, 2));
      expect((await detail(created.id)).renewalDate).toBe(dayAfterTerm(addMonths(nextMonth, 2)));
      const moved = await ok(await patch(path, { startMonth: addMonths(nextMonth, 1) }), (body) =>
        retainerTermSchema.parse(body),
      );
      expect(moved.schedule.map((month) => month.month)).toEqual([
        addMonths(nextMonth, 1),
        addMonths(nextMonth, 2),
        addMonths(nextMonth, 3),
      ]);
      const pending = (await chargesOf(created.id)).filter(
        (row) => row.termId === scheduled.id && row.status === 'pending',
      );
      expect(pending.map((row) => row.month)).toEqual(moved.schedule.map((month) => month.month));

      expect((await client.post(`${path}/cancel`, cast.am.cookie, {})).status).toBe(400);
      const cancelled = await ok(
        await client.post(`${path}/cancel`, cast.am.cookie, { reason: 'العميل لم يوقّع' }),
        (body) => retainerTermSchema.parse(body),
      );
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'العميل لم يوقّع' });
      expect(
        (await chargesOf(created.id)).filter(
          (row) => row.termId === scheduled.id && row.status !== 'cancelled',
        ),
      ).toEqual([]);
      expect((await detail(created.id)).renewalDate).toBe(dayAfterTerm(thisMonth));
      await expectError(await patch(path, { endAction: 'end' }), 409, 'INVALID_TRANSITION');
      expect(await auditActions([scheduled.id])).toEqual([
        'retainer_term.created',
        'retainer_term.updated',
        'retainer_term.updated',
        'retainer_term.cancelled',
      ]);
    });

    it('changes only the end action of an active term (T5, TERM_STARTED)', async () => {
      const created = await retainer({ term: term(2, [1000, 1000]) });
      const [active] = await listTerms(created.id);
      const path = `${terms(created.id)}/${active?.id}`;
      await expectError(await patch(path, { agreedTotalMinor: 3000 }), 409, 'TERM_STARTED');
      await expectError(
        await client.post(`${path}/cancel`, cast.am.cookie, { reason: 'x' }),
        409,
        'TERM_STARTED',
      );
      const changed = await ok(await patch(path, { endAction: 'end', months: 2 }), (body) =>
        retainerTermSchema.parse(body),
      );
      expect(changed.endAction).toBe('end');
      expect((await patch(path, { endAction: 'end' }, cast.employee.cookie)).status).toBe(403);
      expect(await auditActions([active?.id ?? ''])).toEqual([
        'retainer_term.created',
        'retainer_term.end_action_changed',
      ]);
    });

    it('checks access and state on changes (403, out of scope, RETAINER_ENDED)', async () => {
      const created = await retainer({ term: term(1, [1000]) });
      const scheduled = await ok(
        await addTerm(created.id, { startMonth: nextMonth, ...term(1, [1000]) }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      const path = `${terms(created.id)}/${scheduled.id}`;
      const cancel = (cookie: string) => client.post(`${path}/cancel`, cookie, { reason: 'x' });
      for (const cookie of [cast.employee.cookie, finance.cookie, cast.otherAm.cookie]) {
        expect((await patch(path, { endAction: 'end' }, cookie)).status).toBe(403);
        expect((await cancel(cookie)).status).toBe(403);
      }
      expect(
        (await patch(`${terms(created.id)}/${randomUUID()}`, { endAction: 'end' })).status,
      ).toBe(404);
      expect(
        (
          await client.post(`/api/retainers/${created.id}/status`, cast.am.cookie, {
            status: 'ended',
          })
        ).status,
      ).toBe(200);
      await expectError(await patch(path, { endAction: 'end' }), 409, 'RETAINER_ENDED');
      await expectError(await cancel(cast.am.cookie), 409, 'RETAINER_ENDED');
    });

    it('derives the renewal date while a term is open (T11)', async () => {
      const created = await retainer({ term: term(1, [1000]) });
      await expectError(
        await patch(`/api/retainers/${created.id}`, { renewalDate: addDays(today, 200) }),
        409,
        'RENEWAL_DATE_FROM_TERM',
      );
      expect(
        (await patch(`/api/retainers/${created.id}`, { renewalDate: created.renewalDate })).status,
      ).toBe(200);
    });
  });

  describe('the daily job', () => {
    it('renews once, 30 days before the end, with the base schedule, and notifies (T7)', async () => {
      const created = await retainer({ term: term(2, [3000, 4000]) });
      const [active] = await listTerms(created.id);
      const endMonth = addMonths(thisMonth, 1);
      await runJob(addDays(dayAfterTerm(endMonth), -31));
      expect(await listTerms(created.id)).toHaveLength(1);
      const day = addDays(dayAfterTerm(endMonth), -30);
      await runJob(day);
      await runJob(day);
      const [renewal, first] = await listTerms(created.id);
      expect(first?.id).toBe(active?.id);
      expect(renewal).toMatchObject({
        number: 2,
        status: 'scheduled',
        startMonth: dayAfterTerm(endMonth),
        months: 2,
        endAction: 'renew',
        renewedFrom: { id: active?.id, number: 1 },
        money: { agreedTotalMinor: 7000 },
      });
      expect(renewal?.schedule.map((month) => month.money?.amountMinor)).toEqual([3000, 4000]);
      expect((await detail(created.id)).renewalDate).toBe(
        dayAfterTerm(addMonths(dayAfterTerm(endMonth), 1)),
      );
      const notices = await db
        .select({ recipientId: notifications.recipientId, data: notifications.data })
        .from(notifications)
        .where(
          and(
            eq(notifications.subjectId, created.id),
            eq(notifications.type, 'retainer_term_renewed'),
          ),
        );
      expect(notices).toEqual([
        {
          recipientId: cast.am.id,
          data: expect.objectContaining({ termNumber: 2, startMonth: dayAfterTerm(endMonth) }),
        },
      ]);
      expect(await auditActions([renewal?.id ?? ''])).toEqual(['retainer_term.renewed']);

      // T10: leaving `renew` cancels the scheduled renewal.
      await ok(
        await patch(`${terms(created.id)}/${active?.id}`, { endAction: 'continue' }),
        (body) => retainerTermSchema.parse(body),
      );
      const [cancelled] = await listTerms(created.id);
      expect(cancelled?.status).toBe('cancelled');
      expect((await detail(created.id)).renewalDate).toBe(dayAfterTerm(endMonth));
    });

    it('never recreates a renewal a manager cancelled (T5, edge case 10)', async () => {
      const created = await retainer({ term: term(1, [3000]) });
      await runJob(lastOfMonth(today));
      const [renewal] = await listTerms(created.id);
      expect(renewal?.status).toBe('scheduled');
      await ok(
        await client.post(`${terms(created.id)}/${renewal?.id}/cancel`, cast.am.cookie, {
          reason: 'العميل لا يجدد',
        }),
        (body) => retainerTermSchema.parse(body),
      );
      await runJob(lastOfMonth(today));
      expect((await listTerms(created.id)).map((row) => row.status)).toEqual([
        'cancelled',
        'active',
      ]);
    });

    it('starts the renewal and completes the old term when its month begins', async () => {
      const created = await retainer({ term: term(1, [3000]) });
      await runJob(lastOfMonth(today));
      await runJob(nextMonth);
      // The one-month renewal is within 30 days of its own end once it starts: it renews too.
      const [next, renewal, first] = await listTerms(created.id);
      expect([first?.status, renewal?.status, next?.status]).toEqual([
        'completed',
        'active',
        'scheduled',
      ]);
      const live = (await draftsOf(created.id)).map((row) => [
        row.invoice.totalMinor,
        row.line.description,
      ]);
      expect(live).toHaveLength(2);
      expect(live[1]?.[0]).toBe(3000);
      expect(await auditActions([first?.id ?? '', renewal?.id ?? '', next?.id ?? ''])).toEqual([
        'retainer_term.created',
        'retainer_term.renewed',
        'retainer_term.completed',
        'retainer_term.started',
        'retainer_term.renewed',
      ]);
    });

    it('ends the retainer on the last day of a term that ends it (T8)', async () => {
      const created = await retainer({ term: term(1, [3000], 'end') });
      await runJob(lastOfMonth(today));
      expect(await listTerms(created.id)).toHaveLength(1);
      await runJob(nextMonth);
      await runJob(nextMonth);
      const [row] = await db.select().from(retainers).where(eq(retainers.id, created.id));
      expect(row).toMatchObject({ status: 'ended', endedOn: lastOfMonth(today) });
      const [done] = await listTerms(created.id);
      expect(done?.status).toBe('completed');
      expect(await auditActions([created.id])).toContain('retainer.status_changed');
      expect((await chargesOf(created.id)).map((charge) => charge.month)).toEqual([thisMonth]);
    });

    it('continues open-ended at the monthly fee after a term (T9)', async () => {
      const created = await retainer({ monthlyFeeMinor: 15000 });
      const draft = (await draftsOf(created.id))[0];
      await client.post(`/api/invoices/${draft?.invoice.id}/archive`, finance.cookie);
      await ok(
        await addTerm(created.id, { startMonth: thisMonth, ...term(1, [9000], 'continue') }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      await runJob(nextMonth);
      const [row] = await db.select().from(retainers).where(eq(retainers.id, created.id));
      expect(row?.status).toBe('active');
      const charges = (await chargesOf(created.id)).filter((charge) => charge.status === 'pending');
      expect(charges.map((charge) => [charge.month, charge.amountMinor, !!charge.termId])).toEqual([
        [thisMonth, 9000, true],
        [nextMonth, 15000, false],
      ]);
    });

    it('bills a paused retainer’s term months (T12)', async () => {
      const created = await retainer({ term: term(2, [1000, 2000]) });
      expect(
        (
          await client.post(`/api/retainers/${created.id}/status`, cast.am.cookie, {
            status: 'paused',
          })
        ).status,
      ).toBe(200);
      await runJob(nextMonth);
      const totals = (await draftsOf(created.id)).map((row) => row.invoice.totalMinor);
      expect(totals).toEqual([1000, 2000]);
    });
  });

  describe('ending early (E1–E3)', () => {
    it('cancels later months and the terms, and drafts a termination fee', async () => {
      const created = await retainer({ term: term(3, [1000, 1000, 1000]) });
      await ok(
        await addTerm(created.id, { startMonth: addMonths(thisMonth, 3), ...term(1, [500]) }),
        (body) => retainerTermSchema.parse(body),
        201,
      );
      const status = `/api/retainers/${created.id}/status`;
      expect(
        (
          await client.post(status, cast.am.cookie, {
            status: 'paused',
            termination: { feeMinor: 100, reason: 'x' },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await client.post(status, cast.otherAm.cookie, {
            status: 'ended',
            termination: { feeMinor: 20000, reason: 'إنهاء مبكر' },
          })
        ).status,
      ).toBe(403);
      await ok(
        await client.post(status, cast.am.cookie, {
          status: 'ended',
          termination: { feeMinor: 20000, reason: 'إنهاء مبكر' },
        }),
        (body) => retainerDetailSchema.parse(body),
      );
      const ended = await detail(created.id);
      expect(ended.status).toBe('ended');
      expect(ended.term).toBeNull();
      const listed = await listTerms(created.id);
      expect(listed.map((row) => row.status)).toEqual(['cancelled', 'cancelled']);
      expect(listed[1]?.endMonth).toBe(addMonths(thisMonth, 2));
      const charges = await chargesOf(created.id);
      expect(
        charges.map((charge) => [charge.month, charge.kind, charge.status, charge.amountMinor]),
      ).toEqual([
        [thisMonth, 'monthly', 'pending', 1000],
        [thisMonth, 'termination_fee', 'pending', 20000],
        [nextMonth, 'monthly', 'cancelled', 1000],
        [addMonths(thisMonth, 2), 'monthly', 'cancelled', 1000],
        [addMonths(thisMonth, 3), 'monthly', 'cancelled', 500],
      ]);
      const fee = (await draftsOf(created.id)).find(
        (row) => row.invoice.origin === 'retainer_termination',
      );
      expect(fee?.invoice.totalMinor).toBe(20000);

      // E3: reactivating restores no term.
      expect((await client.post(status, cast.gm.cookie, { status: 'active' })).status).toBe(200);
      expect((await detail(created.id)).term).toBeNull();
    });

    it('counts the live month’s additions and credits in the current total, not a cancelled month’s (T6)', async () => {
      const created = await retainer({ term: term(3, [10000, 10000, 10000]) });
      await db.insert(retainerCharges).values([
        { retainerId: created.id, month: thisMonth, kind: 'addition', amountMinor: 3000 },
        { retainerId: created.id, month: thisMonth, kind: 'credit', amountMinor: -2000 },
        { retainerId: created.id, month: nextMonth, kind: 'addition', amountMinor: 4000 },
      ]);
      await ok(
        await client.post(`/api/retainers/${created.id}/status`, cast.am.cookie, {
          status: 'ended',
          termination: { feeMinor: 500, reason: 'إنهاء مبكر' },
        }),
        (body) => retainerDetailSchema.parse(body),
      );
      const [ended] = await listTerms(created.id);
      expect(ended?.status).toBe('cancelled');
      expect(ended?.schedule.map((month) => month.money?.totalMinor)).toEqual([11000, 0, 0]);
      // The termination fee is not a month's charge: it stays out of the term's total.
      expect(ended?.money).toEqual({ agreedTotalMinor: 30000, currentTotalMinor: 11000 });
    });
  });
});
