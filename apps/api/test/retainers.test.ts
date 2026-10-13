import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  addMonths,
  businessDate,
  clientMonthlyReportSchema,
  cycleAt,
  cyclePageSchema,
  cyclePeriod,
  deliverableLineListSchema,
  retainerDetailSchema,
  retainerPageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  invoiceLines,
  invoices,
  retainerCharges,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetainerCyclesService } from '../src/modules/projects/retainer-cycles.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('retainers', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  const today = businessDate();

  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/retainers/${id}`, { cookie, body });
  const putLines = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', `/api/retainers/${id}/deliverables`, { cookie, body });
  const status = (id: string, cookie: string, value: string) =>
    client.post(`/api/retainers/${id}/status`, cookie, { status: value });
  const detail = async (id: string, cookie: string) => {
    const response = await client.get(`/api/retainers/${id}`, cookie);
    expect(response.status).toBe(200);
    return retainerDetailSchema.parse(await response.json());
  };
  const list = async (query: string, cookie: string) => {
    const response = await client.get(`/api/retainers?${query}`, cookie);
    expect(response.status).toBe(200);
    return retainerPageSchema.parse(await response.json());
  };
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);
  const body = (clientId: string, extra: object = {}) => ({
    clientId,
    name: `عقد ${cast.run} ${randomUUID().slice(0, 6)}`,
    departments: ['design'],
    startDate: today,
    ...extra,
  });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    const signedIn = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(signedIn.id);
    finance = signedIn;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/retainers')).status).toBe(401);
    expect((await client.get(`/api/retainers/${id}`)).status).toBe(401);
    expect((await client.post('/api/retainers', undefined, {})).status).toBe(401);
    expect((await patch(id, undefined, { name: 'x' })).status).toBe(401);
    expect((await putLines(id, undefined, { lines: [] })).status).toBe(401);
    for (const action of ['status', 'archive', 'restore']) {
      expect((await client.post(`/api/retainers/${id}/${action}`)).status, action).toBe(401);
    }
  });

  describe('create', () => {
    it('creates a started retainer with its first full cycle at full quantities, audited', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, {
        departments: ['design', 'content_management', 'design'],
        currency: 'USD',
        monthlyFeeMinor: 150000,
        deliverables: [
          { kind: 'design', monthlyQuantity: 12 },
          { kind: 'reel', monthlyQuantity: 4 },
          { kind: 'monthly_report', monthlyQuantity: 1 },
        ],
      });
      expect(created).toMatchObject({
        status: 'active',
        departments: ['design', 'content_management'],
        accountManager: { id: cast.am.id },
        startDate: today,
        endedOn: null,
        renewalDate: null,
        renewal: null,
        nextCycleStart: null,
        money: { currency: 'USD', monthlyFeeMinor: 150000 },
        permissions: {
          canManage: true,
          canArchive: true,
          canSeeMoney: true,
          canEditMoney: true,
          canBill: true,
        },
      });
      expect(created.deliverables.map((line) => [line.kind, line.monthlyQuantity])).toEqual([
        ['design', 12],
        ['reel', 4],
        ['monthly_report', 1],
      ]);
      // F05C Y1, Y3: one full month from the start date, never a partial first cycle.
      expect(created.currentCycle).toMatchObject({
        number: 1,
        periodStart: today,
        periodEnd: addDays(addMonths(today, 1), -1),
        status: 'open',
        deliveryRate: 0,
        termPosition: null,
      });
      expect(
        created.currentCycle?.lines.map((line) => [line.kind, line.committed, line.delivered]),
      ).toEqual([
        ['design', 12, 0],
        ['reel', 4, 0],
        ['monthly_report', 1, 0],
      ]);
      const [entry] = await auditOf(created.id);
      expect(entry).toMatchObject({ action: 'retainer.created', actorId: cast.gm.id });
      expect(entry?.after).toMatchObject({ monthlyFeeMinor: 150000, currency: 'USD' });
      const cycleId = created.currentCycle?.id ?? '';
      expect((await auditOf(cycleId)).map((e) => [e.action, e.actorId])).toEqual([
        ['retainer_cycle.created', cast.gm.id],
      ]);
    });

    it('opens no cycle before the start date', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, { startDate: addDays(today, 40) });
      expect(created.currentCycle).toBeNull();
    });

    it('lets account managers create on their own clients only (client scope)', async () => {
      const own = await cast.createClient();
      const other = await cast.createClient({ accountManagerId: cast.otherAm.id });
      expect((await client.post('/api/retainers', cast.am.cookie, body(own.id))).status).toBe(201);
      expect((await client.post('/api/retainers', cast.am.cookie, body(other.id))).status).toBe(
        403,
      );
      expect(
        (await client.post('/api/retainers', cast.operations.cookie, body(other.id))).status,
      ).toBe(201);
      expect((await client.post('/api/retainers', cast.employee.cookie, body(own.id))).status).toBe(
        403,
      );
      expect((await client.post('/api/retainers', finance.cookie, body(own.id))).status).toBe(403);
    });

    it('refuses archived and ended clients (rule 1)', async () => {
      const ended = await cast.createClient({ status: 'ended' });
      await expectError(
        await client.post('/api/retainers', cast.gm.cookie, body(ended.id)),
        409,
        'CLIENT_ENDED',
      );
      const archived = await cast.createClient();
      await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
      await expectError(
        await client.post('/api/retainers', cast.gm.cookie, body(archived.id)),
        409,
        'CLIENT_ARCHIVED',
      );
    });

    it('checks dates, names, duplicate lines and the line limit', async () => {
      const { id: clientId } = await cast.createClient();
      // F05C B1: at most 12 months back.
      await expectError(
        await client.post(
          '/api/retainers',
          cast.gm.cookie,
          body(clientId, { startDate: addDays(addMonths(today, -12), -1) }),
        ),
        400,
        'INVALID_DATES',
      );
      // F05C T3': the renewal date is derived from the term, never sent.
      expect(
        (
          await client.post(
            '/api/retainers',
            cast.gm.cookie,
            body(clientId, { renewalDate: addDays(today, 200) }),
          )
        ).status,
      ).toBe(400);
      const first = await cast.createRetainer(clientId);
      await expectError(
        await client.post('/api/retainers', cast.gm.cookie, {
          ...body(clientId),
          name: first.name.toUpperCase(),
        }),
        409,
        'RETAINER_NAME_TAKEN',
      );
      await expectError(
        await client.post(
          '/api/retainers',
          cast.gm.cookie,
          body(clientId, {
            deliverables: [
              { kind: 'other', label: 'Podcast', monthlyQuantity: 1 },
              { kind: 'other', label: 'podcast', monthlyQuantity: 2 },
            ],
          }),
        ),
        409,
        'DUPLICATE_DELIVERABLE',
      );
      const many = Array.from({ length: 21 }, (_, index) => ({
        kind: 'other',
        label: `Line ${index}`,
        monthlyQuantity: 1,
      }));
      await expectError(
        await client.post('/api/retainers', cast.gm.cookie, body(clientId, { deliverables: many })),
        409,
        'LIMIT_REACHED',
      );
    });
  });

  describe('backdated start (F05C B1–B7)', () => {
    /** Two past cycles: the start date is two months ago, so today is in cycle 3. */
    const start = addMonths(today, -2);
    const lines = [
      { kind: 'design', monthlyQuantity: 12 },
      { kind: 'reel', monthlyQuantity: 4 },
    ];
    const create = (cookie: string, clientId: string, extra: object = {}) =>
      client.post(
        '/api/retainers',
        cookie,
        body(clientId, {
          startDate: start,
          currency: 'USD',
          monthlyFeeMinor: 50000,
          deliverables: lines,
          ...extra,
        }),
      );
    const cyclesOf = async (id: string) => {
      const response = await client.get(`/api/retainers/${id}/cycles?pageSize=50`, cast.gm.cookie);
      expect(response.status).toBe(200);
      return cyclePageSchema.parse(await response.json()).items.sort((a, b) => a.number - b.number);
    };
    const chargesOf = (retainerId: string) =>
      db
        .select()
        .from(retainerCharges)
        .where(eq(retainerCharges.retainerId, retainerId))
        .orderBy(asc(retainerCharges.cycleNumber));
    const draftLines = (retainerId: string) =>
      db
        .select({ description: invoiceLines.description, totalMinor: invoices.totalMinor })
        .from(invoices)
        .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
        .where(eq(invoices.retainerId, retainerId))
        .orderBy(asc(invoiceLines.description));

    it('refuses a backdated start without a complete catch-up (B2)', async () => {
      const { id: clientId } = await cast.createClient();
      for (const catchUp of [
        undefined,
        [{ cycle: 1 }],
        [{ cycle: 1 }, { cycle: 3 }],
        [{ cycle: 1 }, { cycle: 2, delivery: 'entered', delivered: [3] }],
      ]) {
        await expectError(
          await create(cast.gm.cookie, clientId, catchUp ? { catchUp } : {}),
          400,
          'CATCH_UP_REQUIRED',
        );
      }
      // A retainer starting in the current cycle takes no catch-up.
      await expectError(
        await create(cast.gm.cookie, clientId, {
          startDate: addDays(addMonths(today, -1), 1),
          catchUp: [{ cycle: 1 }],
        }),
        400,
        'CATCH_UP_REQUIRED',
      );
    });

    it('needs money access and client scope', async () => {
      const own = await cast.createClient();
      const other = await cast.createClient({ accountManagerId: cast.otherAm.id });
      const catchUp = [{ cycle: 1 }, { cycle: 2 }];
      expect((await create(cast.am.cookie, other.id, { catchUp })).status).toBe(403);
      expect((await create(cast.employee.cookie, own.id, { catchUp })).status).toBe(403);
      expect((await create(finance.cookie, own.id, { catchUp })).status).toBe(403);
      expect((await create(cast.am.cookie, own.id, { catchUp })).status).toBe(201);
    });

    it('records past cycles closed, billed by choice, and opens the current one (B3, B4, Y3)', async () => {
      const { id: clientId } = await cast.createClient();
      const response = await create(cast.am.cookie, clientId, {
        catchUp: [
          { cycle: 2, billing: 'draft_now', delivery: 'entered', delivered: [10, 4] },
          { cycle: 1 },
        ],
      });
      expect(response.status).toBe(201);
      const created = retainerDetailSchema.parse(await response.json());
      expect(created.currentCycle).toMatchObject({
        number: 3,
        ...cyclePeriod(start, 3),
        status: 'open',
        backdated: false,
      });

      const cycles = await cyclesOf(created.id);
      expect(
        cycles.map((cycle) => [
          cycle.number,
          cycle.periodStart,
          cycle.status,
          cycle.backdated,
          cycle.untracked,
          cycle.deliveryRate,
        ]),
      ).toEqual([
        [1, start, 'closed', true, true, null],
        [2, cyclePeriod(start, 2).periodStart, 'closed', true, false, 87],
        [3, cyclePeriod(start, 3).periodStart, 'open', false, false, 0],
      ]);
      expect(cycles[0]?.lines.map((line) => [line.committed, line.delivered])).toEqual([
        [12, 0],
        [4, 0],
      ]);
      expect(cycles[1]?.lines.map((line) => [line.committed, line.delivered])).toEqual([
        [12, 10],
        [4, 4],
      ]);
      // B4: no tasks for a backdated cycle.
      expect(cycles[0]?.lines.every((line) => line.tasks.total === 0)).toBe(true);
      // B4, R4: the client report gives an untracked cycle no delivered count and no percent.
      const report = await client.get(
        `/api/clients/${clientId}/monthly-report?month=${start.slice(0, 7)}`,
        cast.gm.cookie,
      );
      expect(report.status).toBe(200);
      const shown = clientMonthlyReportSchema
        .parse(await report.json())
        .retainers.find((row) => row.retainer.id === created.id && row.cycle === 1);
      expect(shown?.lines.map((line) => [line.committed, line.delivered, line.percent])).toEqual([
        [12, null, null],
        [4, null, null],
      ]);
      expect(shown?.completion).toBeNull();

      const charges = await chargesOf(created.id);
      expect(
        charges.map((row) => [row.cycleNumber, row.amountMinor, row.status, !!row.dueAt]),
      ).toEqual([
        [1, 50000, 'settled_outside', false],
        [2, 50000, 'pending', true],
        [3, 50000, 'pending', true],
      ]);
      expect(charges[0]?.settleNote).toBeTruthy();
      // J3: one draft per drafted cycle, each named by its cycle; none for cycle 1.
      const drafts = await draftLines(created.id);
      expect(drafts.map((row) => row.totalMinor)).toEqual([50000, 50000]);
      expect(drafts.map((row) => row.description.match(/الدورة (\d+)/)?.[1]).sort()).toEqual([
        '2',
        '3',
      ]);

      // B7: the creation and one entry for the past cycles.
      const actions = (await auditOf(created.id)).map((entry) => entry.action);
      expect(actions.slice(0, 2)).toEqual(['retainer.created', 'retainer.backdated']);
      const backdated = (await auditOf(created.id)).find(
        (entry) => entry.action === 'retainer.backdated',
      );
      expect(backdated?.actorId).toBe(cast.am.id);
      expect(backdated?.after).toMatchObject({
        startDate: start,
        pastCycles: [
          { cycle: 1, billing: 'billed_externally', delivery: 'untracked', amountMinor: 50000 },
          {
            cycle: 2,
            billing: 'draft_now',
            delivery: 'entered',
            delivered: [10, 4],
            amountMinor: 50000,
          },
        ],
      });
    });

    it('starts a term at cycle 1 that includes the current cycle (B5, edge case 7)', async () => {
      const { id: clientId } = await cast.createClient();
      const catchUp = [
        { cycle: 1, billing: 'draft_now' },
        { cycle: 2, billing: 'draft_now' },
      ];
      await expectError(
        await create(cast.gm.cookie, clientId, {
          catchUp,
          term: { cycles: 2, agreedTotalMinor: 80000, schedule: [40000, 40000] },
        }),
        400,
        'INVALID_DATES',
      );
      const response = await create(cast.gm.cookie, clientId, {
        catchUp,
        term: { cycles: 4, agreedTotalMinor: 120000, schedule: [0, 40000, 40000, 40000] },
      });
      expect(response.status).toBe(201);
      const created = retainerDetailSchema.parse(await response.json());
      expect(created.currentCycle).toMatchObject({ number: 3, termPosition: 3, termCycles: 4 });
      expect(created.renewalDate).toBe(addDays(cyclePeriod(start, 4).periodEnd, 1));
      const charges = await chargesOf(created.id);
      expect(
        charges.map((row) => [row.cycleNumber, row.amountMinor, row.status, !!row.dueAt]),
      ).toEqual([
        [1, 0, 'pending', true],
        [2, 40000, 'pending', true],
        [3, 40000, 'pending', true],
        [4, 40000, 'pending', false],
      ]);
      // Edge case 7: the cycle of 0 is never drafted.
      const drafts = await draftLines(created.id);
      expect(drafts.map((row) => row.description.match(/الدورة (\d+)/)?.[1]).sort()).toEqual([
        '2',
        '3',
      ]);
    });

    it('drafts every past cycle in one request (edge case 6)', async () => {
      const { id: clientId } = await cast.createClient();
      const longAgo = addMonths(today, -12);
      const past = (cycleAt(longAgo, today) ?? 1) - 1;
      const response = await create(cast.gm.cookie, clientId, {
        startDate: longAgo,
        catchUp: Array.from({ length: past }, (_, index) => ({
          cycle: index + 1,
          billing: 'draft_now',
        })),
      });
      expect(response.status).toBe(201);
      const created = retainerDetailSchema.parse(await response.json());
      expect(created.currentCycle?.number).toBe(past + 1);
      expect(await draftLines(created.id)).toHaveLength(past + 1);
    });
  });

  describe('read', () => {
    it('shows every user the retainer, money only with money access (M1)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, { monthlyFeeMinor: 90000 });
      const asEmployee = await detail(created.id, cast.employee.cookie);
      expect(asEmployee.money).toBeUndefined();
      expect(asEmployee.permissions).toMatchObject({ canManage: false, canSeeMoney: false });
      const asFinance = await detail(created.id, finance.cookie);
      expect(asFinance.money).toEqual({
        currency: 'USD',
        monthlyFeeMinor: 90000,
        creditPendingMinor: 0,
      });
      expect(asFinance.permissions).toMatchObject({
        canManage: false,
        canEditMoney: false,
        canBill: false,
      });
      expect((await detail(created.id, cast.otherAm.cookie)).money).toBeUndefined();
      expect((await client.get(`/api/retainers/${randomUUID()}`, cast.gm.cookie)).status).toBe(404);
    });

    it('filters by client, account manager, status, search and renewal', async () => {
      const own = await cast.createClient();
      const other = await cast.createClient({ accountManagerId: cast.otherAm.id });
      // F05C T3': the renewal date follows the term. A one-cycle term that started 20 days ago
      // renews in about ten days; a six-cycle term much later.
      const term = (cycles: number) => ({
        cycles,
        agreedTotalMinor: 0,
        schedule: Array.from({ length: cycles }, () => 0),
      });
      const soon = await cast.createRetainer(own.id, {
        startDate: addDays(today, -20),
        term: term(1),
      });
      const later = await cast.createRetainer(own.id, { term: term(6) });
      expect(soon.renewalDate).toBe(addMonths(addDays(today, -20), 1));
      expect(later.renewalDate).toBe(addMonths(today, 6));
      const theirs = await cast.createRetainer(other.id);
      const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id).sort();

      expect(ids(await list(`clientId=${own.id}`, cast.employee.cookie))).toEqual(
        [soon.id, later.id].sort(),
      );
      const managed = await list(`accountManagerId=${cast.otherAm.id}`, cast.gm.cookie);
      expect(managed.items.map((item) => item.id)).toContain(theirs.id);
      expect(managed.items.every((item) => item.accountManager.id === cast.otherAm.id)).toBe(true);
      expect(ids(await list(`clientId=${own.id}&renewalDue=true`, cast.gm.cookie))).toEqual([
        soon.id,
      ]);
      expect(ids(await list(`clientId=${own.id}&renewalDue=false`, cast.gm.cookie))).toEqual([
        later.id,
      ]);
      const searched = await list(`search=${encodeURIComponent(soon.name)}`, cast.gm.cookie);
      expect(searched.items.map((item) => item.id)).toEqual([soon.id]);
      expect(searched.items[0]).toMatchObject({ renewal: 'due', currentCycle: { status: 'open' } });

      await status(later.id, cast.gm.cookie, 'paused');
      expect(ids(await list(`clientId=${own.id}&status=paused`, cast.gm.cookie))).toEqual([
        later.id,
      ]);
    });

    it('filters on the behind rule (R11) and pages the result', async () => {
      const { id: clientId } = await cast.createClient();
      await cast.createRetainer(clientId);
      await cast.createRetainer(clientId);
      const all = await list(`clientId=${clientId}`, cast.gm.cookie);
      const behind = all.items.filter((item) => item.currentCycle?.behind).length;
      expect((await list(`clientId=${clientId}&behind=true`, cast.gm.cookie)).total).toBe(behind);
      const notBehind = await list(`clientId=${clientId}&behind=false&pageSize=1`, cast.gm.cookie);
      expect(notBehind.total).toBe(2 - behind);
      expect(notBehind.items.length).toBe(Math.min(1, 2 - behind));
    });

    it('lists archived retainers to scope all only', async () => {
      expect((await client.get('/api/retainers?archived=true', cast.am.cookie)).status).toBe(403);
      expect((await client.get('/api/retainers?archived=true', cast.gm.cookie)).status).toBe(200);
    });
  });

  describe('update', () => {
    it('edits basics and money as separate audit entries', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, { startDate: addDays(today, 40) });
      const response = await patch(created.id, cast.am.cookie, {
        name: `${created.name} 2`,
        currency: 'SYP',
        monthlyFeeMinor: 5000000,
      });
      expect(response.status).toBe(200);
      expect(retainerDetailSchema.parse(await response.json())).toMatchObject({
        name: `${created.name} 2`,
        money: { currency: 'SYP', monthlyFeeMinor: 5000000 },
      });
      const actions = (await auditOf(created.id)).map((entry) => entry.action);
      expect(actions).toEqual(['retainer.created', 'retainer.updated', 'retainer.money_updated']);
    });

    it('takes the same departments in another order as no change (no audit entry)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, {
        departments: ['design', 'content_management'],
      });
      const response = await patch(created.id, cast.am.cookie, {
        departments: ['content_management', 'design'],
      });
      expect(response.status).toBe(200);
      expect(retainerDetailSchema.parse(await response.json()).departments).toEqual([
        'design',
        'content_management',
      ]);
      const actions = (await auditOf(created.id)).map((entry) => entry.action);
      expect(actions).toEqual(['retainer.created']);
    });

    it('locks the currency once a fee is set (M2), an invoice or a charge exists (F13, F05B)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, { monthlyFeeMinor: 1000 });
      await expectError(
        await patch(created.id, cast.gm.cookie, { currency: 'SYP' }),
        409,
        'CURRENCY_LOCKED',
      );
      // Once charged, the fee changes only by amendment (F05B A9).
      await expectError(
        await patch(created.id, cast.gm.cookie, { monthlyFeeMinor: null }),
        409,
        'FEE_CHANGE_NEEDS_AMENDMENT',
      );
      // The first cycle's month was drafted when the retainer started.
      await expectError(
        await patch(created.id, cast.gm.cookie, { currency: 'SYP' }),
        409,
        'CURRENCY_LOCKED',
      );
      const [draft] = await db.select().from(invoices).where(eq(invoices.retainerId, created.id));
      expect((await client.post(`/api/invoices/${draft?.id}/archive`, cast.gm.cookie)).status).toBe(
        204,
      );
      // The month's charge keeps the currency it was created in (F05B edge case 12).
      await expectError(
        await patch(created.id, cast.gm.cookie, { currency: 'SYP' }),
        409,
        'CURRENCY_LOCKED',
      );
      // Without a fee, invoice or charge it changes.
      const free = await cast.createRetainer(clientId);
      expect((await patch(free.id, cast.gm.cookie, { currency: 'SYP' })).status).toBe(200);
    });

    it('fixes the start date once a cycle or a charge exists; an earlier start opens the cycle', async () => {
      const { id: clientId } = await cast.createClient();
      const started = await cast.createRetainer(clientId);
      await expectError(
        await patch(started.id, cast.gm.cookie, { startDate: addDays(today, -1) }),
        409,
        'RETAINER_STARTED',
      );
      // F05C edge case 8: a future retainer with a term has charges, so its start date is fixed.
      const termed = await cast.createRetainer(clientId, {
        startDate: addDays(today, 40),
        term: { cycles: 2, agreedTotalMinor: 0, schedule: [0, 0] },
      });
      await expectError(
        await patch(termed.id, cast.gm.cookie, { startDate: addDays(today, 41) }),
        409,
        'RETAINER_STARTED',
      );
      const later = await cast.createRetainer(clientId, { startDate: addDays(today, 40) });
      await expectError(
        await patch(later.id, cast.gm.cookie, { startDate: addMonths(today, -1) }),
        400,
        'INVALID_DATES',
      );
      const moved = await patch(later.id, cast.gm.cookie, { startDate: today });
      expect(retainerDetailSchema.parse(await moved.json()).currentCycle?.status).toBe('open');
      expect((await patch(later.id, cast.gm.cookie, { renewalDate: null })).status).toBe(400);
    });

    it('refuses callers outside client scope and money writes without money access', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      expect((await patch(created.id, cast.otherAm.cookie, { name: 'x' })).status).toBe(403);
      expect((await patch(created.id, cast.employee.cookie, { name: 'x' })).status).toBe(403);
      expect((await patch(created.id, finance.cookie, { monthlyFeeMinor: 1 })).status).toBe(403);
    });
  });

  describe('deliverable lines', () => {
    it('applies from the next cycle; the open cycle keeps its lines (R10)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      const [design, reel] = created.deliverables;
      const response = await putLines(created.id, cast.am.cookie, {
        lines: [
          { id: reel?.id, kind: 'reel', monthlyQuantity: 6 },
          { kind: 'other', label: 'Newsletter', monthlyQuantity: 2 },
        ],
      });
      expect(response.status).toBe(200);
      const lines = deliverableLineListSchema.parse(await response.json()).items;
      expect(lines.map((line) => [line.kind, line.label, line.monthlyQuantity])).toEqual([
        ['reel', null, 6],
        ['other', 'Newsletter', 2],
      ]);
      expect(lines[0]?.id).toBe(reel?.id);
      const after = await detail(created.id, cast.gm.cookie);
      expect(after.deliverables.map((line) => line.id)).not.toContain(design?.id);
      expect(after.currentCycle?.lines.map((line) => [line.kind, line.committed])).toEqual([
        ['design', 12],
        ['reel', 4],
      ]);
      const [entry] = (await auditOf(created.id)).filter(
        (e) => e.action === 'retainer.deliverables_updated',
      );
      expect(entry?.after).toMatchObject({ deliverables: expect.any(Array) });
    });

    it('saves a reorder that swaps kinds and moves a kind to a new line', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      const [design, reel] = created.deliverables;
      const response = await putLines(created.id, cast.gm.cookie, {
        lines: [
          { kind: 'design', monthlyQuantity: 8 },
          { id: design?.id, kind: 'reel', monthlyQuantity: 3 },
          { id: reel?.id, kind: 'story', monthlyQuantity: 10 },
        ],
      });
      expect(response.status).toBe(200);
      const lines = deliverableLineListSchema.parse(await response.json()).items;
      expect(
        lines.map((line) => [line.id === design?.id, line.id === reel?.id, line.kind]),
      ).toEqual([
        [false, false, 'design'],
        [true, false, 'reel'],
        [false, true, 'story'],
      ]);
      expect(
        (
          await putLines(created.id, cast.gm.cookie, {
            lines: [
              { id: design?.id, kind: 'design', monthlyQuantity: 1 },
              { id: design?.id, kind: 'video', monthlyQuantity: 1 },
            ],
          })
        ).status,
      ).toBe(400);
    });

    it('refuses duplicates, foreign line ids and callers outside client scope', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      await expectError(
        await putLines(created.id, cast.gm.cookie, {
          lines: [
            { kind: 'design', monthlyQuantity: 1 },
            { kind: 'design', monthlyQuantity: 2 },
          ],
        }),
        409,
        'DUPLICATE_DELIVERABLE',
      );
      expect(
        (
          await putLines(created.id, cast.gm.cookie, {
            lines: [{ id: randomUUID(), kind: 'design', monthlyQuantity: 1 }],
          })
        ).status,
      ).toBe(404);
      expect((await putLines(created.id, cast.employee.cookie, { lines: [] })).status).toBe(403);
    });
  });

  describe('status', () => {
    it('keeps the same cycle through pause and resume in one cycle (edge case 5, F05C P2)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      const cycleId = created.currentCycle?.id;
      const paused = retainerDetailSchema.parse(
        await (await status(created.id, cast.am.cookie, 'paused')).json(),
      );
      expect(paused).toMatchObject({ status: 'paused', currentCycle: { id: cycleId } });
      expect(paused.currentCycle?.lines.every((line) => !line.behind)).toBe(true);
      const resumed = retainerDetailSchema.parse(
        await (await status(created.id, cast.am.cookie, 'active')).json(),
      );
      expect(resumed).toMatchObject({
        status: 'active',
        currentCycle: { id: cycleId },
        nextCycleStart: null,
      });
    });

    it('ends by closing the open cycle, is then read-only, and reactivates with scope all', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      const ended = retainerDetailSchema.parse(
        await (await status(created.id, cast.am.cookie, 'ended')).json(),
      );
      expect(ended).toMatchObject({ status: 'ended', endedOn: today, currentCycle: null });
      expect(ended.permissions).toMatchObject({ canManage: false, canReactivate: false });
      const cycles = await client.get(`/api/retainers/${created.id}/cycles`, cast.gm.cookie);
      const [closed] = ((await cycles.json()) as { items: { status: string; periodEnd: string }[] })
        .items;
      expect(closed).toMatchObject({ status: 'closed', periodEnd: today });

      await expectError(
        await patch(created.id, cast.am.cookie, { name: 'x' }),
        409,
        'RETAINER_ENDED',
      );
      await expectError(
        await status(created.id, cast.gm.cookie, 'paused'),
        409,
        'INVALID_TRANSITION',
      );
      expect((await status(created.id, cast.am.cookie, 'active')).status).toBe(403);
      const reactivated = await status(created.id, cast.operations.cookie, 'active');
      expect(reactivated.status).toBe(200);
      // F05C P4: the cycle that closed on ending stays closed; it starts at the next cycle.
      const nextStart = addMonths(today, 1);
      expect(retainerDetailSchema.parse(await reactivated.json())).toMatchObject({
        status: 'active',
        endedOn: null,
        currentCycle: null,
        nextCycleStart: nextStart,
      });
      const actions = (await auditOf(created.id)).map((entry) => [entry.action, entry.after]);
      expect(actions.slice(1)).toEqual([
        ['retainer.status_changed', { status: 'ended' }],
        ['retainer.status_changed', { status: 'active', cyclesFrom: nextStart }],
      ]);
    });

    it('refuses "start now" in the cycle that closed on ending (F05C P4)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      await status(created.id, cast.gm.cookie, 'ended');
      await expectError(
        await client.post(`/api/retainers/${created.id}/status`, cast.gm.cookie, {
          status: 'active',
          startNow: true,
        }),
        409,
        'CYCLE_CLOSED',
      );
      expect(
        (
          await client.post(`/api/retainers/${created.id}/status`, cast.gm.cookie, {
            status: 'paused',
            startNow: true,
          })
        ).status,
      ).toBe(400);
    });

    describe('resuming in a later cycle (F05C P2, P3)', () => {
      const on = <T>(day: string, body: (cookie: string) => Promise<T>) => cast.onDay(day, body);
      const chargesOf = (retainerId: string) =>
        db
          .select({
            cycle: retainerCharges.cycleNumber,
            amountMinor: retainerCharges.amountMinor,
            status: retainerCharges.status,
            due: retainerCharges.dueAt,
          })
          .from(retainerCharges)
          .where(eq(retainerCharges.retainerId, retainerId))
          .orderBy(retainerCharges.cycleNumber);
      /** A retainer paused in cycle 1, on the third day of cycle 2 after the job ran. */
      const pausedIntoCycleTwo = async (extra: object = {}) => {
        const { id: clientId } = await cast.createClient();
        const created = await cast.createRetainer(clientId, { monthlyFeeMinor: 50000, ...extra });
        await status(created.id, cast.gm.cookie, 'paused');
        const day = addDays(cyclePeriod(today, 2).periodStart, 2);
        await app.get(RetainerCyclesService).runDaily(day);
        return { created, day };
      };

      it('starts an open-ended retainer at the next cycle by default (P2)', async () => {
        const { created, day } = await pausedIntoCycleTwo();
        const third = cyclePeriod(today, 3).periodStart;
        const resumed = await on(day, async (cookie) =>
          retainerDetailSchema.parse(await (await status(created.id, cookie, 'active')).json()),
        );
        expect(resumed).toMatchObject({ currentCycle: null, nextCycleStart: third });
        // No charge for the rest of cycle 2 (P1, P2).
        expect((await chargesOf(created.id)).map((row) => row.cycle)).toEqual([1]);
        await app.get(RetainerCyclesService).runDaily(addDays(third, -1));
        expect((await detail(created.id, cast.gm.cookie)).currentCycle).toBeNull();
        await app.get(RetainerCyclesService).runDaily(third);
        const opened = await detail(created.id, cast.gm.cookie);
        expect(opened).toMatchObject({
          currentCycle: { number: 3, ...cyclePeriod(today, 3) },
          nextCycleStart: null,
        });
        expect((await chargesOf(created.id)).map((row) => [row.cycle, row.amountMinor])).toEqual([
          [1, 50000],
          [3, 50000],
        ]);
      });

      it('starts a full cycle now on request, with the full fee due at once (P2)', async () => {
        const { created, day } = await pausedIntoCycleTwo();
        const resumed = await on(day, async (cookie) =>
          retainerDetailSchema.parse(
            await (
              await client.post(`/api/retainers/${created.id}/status`, cookie, {
                status: 'active',
                startNow: true,
              })
            ).json(),
          ),
        );
        expect(resumed.currentCycle).toMatchObject({
          number: 2,
          periodStart: day,
          periodEnd: cyclePeriod(today, 2).periodEnd,
        });
        expect(resumed.currentCycle?.lines.map((line) => line.committed)).toEqual([12, 4]);
        const charges = await chargesOf(created.id);
        expect(charges.map((row) => [row.cycle, row.amountMinor, row.due !== null])).toEqual([
          [1, 50000, true],
          [2, 50000, true],
        ]);
        const [entry] = (await auditOf(created.id)).filter(
          (row) => row.action === 'retainer.status_changed' && row.before?.status === 'paused',
        );
        expect(entry?.after).toEqual({ status: 'active', startNow: true });
      });

      it("opens a term cycle at once, its charge already due while paused (P3, T5')", async () => {
        const { created, day } = await pausedIntoCycleTwo({
          term: { cycles: 3, agreedTotalMinor: 120000, schedule: [40000, 40000, 40000] },
        });
        // T5': the term's cycle 2 charge became due while paused.
        expect(
          (await chargesOf(created.id)).map((row) => [row.cycle, row.status, row.due !== null]),
        ).toEqual([
          [1, 'pending', true],
          [2, 'pending', true],
          [3, 'pending', false],
        ]);
        const resumed = await on(day, async (cookie) =>
          retainerDetailSchema.parse(await (await status(created.id, cookie, 'active')).json()),
        );
        expect(resumed.currentCycle).toMatchObject({
          number: 2,
          periodStart: day,
          termPosition: 2,
          termCycles: 3,
        });
        expect(resumed.nextCycleStart).toBeNull();
      });
    });

    it('refuses callers outside client scope and unknown transitions', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      expect((await status(created.id, cast.otherAm.cookie, 'paused')).status).toBe(403);
      expect((await status(created.id, cast.employee.cookie, 'paused')).status).toBe(403);
      await expectError(
        await status(created.id, cast.gm.cookie, 'active'),
        409,
        'INVALID_TRANSITION',
      );
    });
  });

  describe('archive and restore', () => {
    it('archives for scope all only; archived is hidden, read-only and restorable', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      expect(
        (await client.post(`/api/retainers/${created.id}/archive`, cast.am.cookie)).status,
      ).toBe(403);
      const archived = await client.post(`/api/retainers/${created.id}/archive`, cast.gm.cookie);
      expect(retainerDetailSchema.parse(await archived.json()).archivedAt).not.toBeNull();
      expect((await client.get(`/api/retainers/${created.id}`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect((await list(`clientId=${clientId}`, cast.gm.cookie)).total).toBe(0);
      await expectError(
        await patch(created.id, cast.gm.cookie, { name: 'x' }),
        409,
        'RETAINER_ARCHIVED',
      );
      await expectError(
        await client.post(`/api/retainers/${created.id}/archive`, cast.gm.cookie),
        409,
        'RETAINER_ARCHIVED',
      );
      const again = await cast.createRetainer(clientId, { name: created.name });
      await expectError(
        await client.post(`/api/retainers/${created.id}/restore`, cast.gm.cookie),
        409,
        'RETAINER_NAME_TAKEN',
      );
      await client.post(`/api/retainers/${again.id}/archive`, cast.gm.cookie);
      expect(
        (await client.post(`/api/retainers/${created.id}/restore`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post(`/api/retainers/${created.id}/restore`, cast.gm.cookie),
        409,
        'RETAINER_NOT_ARCHIVED',
      );
    });

    it('hides the work of an archived client with it (G2)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId);
      await client.post(`/api/clients/${clientId}/archive`, cast.gm.cookie);
      expect((await client.get(`/api/retainers/${created.id}`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect((await list(`clientId=${clientId}`, cast.gm.cookie)).total).toBe(0);
      await expectError(
        await patch(created.id, cast.gm.cookie, { name: 'x' }),
        409,
        'CLIENT_ARCHIVED',
      );
    });
  });
});
