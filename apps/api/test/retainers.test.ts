import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  deliverableLineListSchema,
  firstOfMonth,
  lastOfMonth,
  retainerDetailSchema,
  retainerPageSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, invoices } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    it('creates a started retainer with this month’s cycle at full quantities, audited', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, {
        departments: ['design', 'content_management', 'design'],
        renewalDate: addDays(today, 200),
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
        renewal: null,
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
      expect(created.currentCycle).toMatchObject({
        month: firstOfMonth(today),
        periodStart: today,
        periodEnd: lastOfMonth(today),
        status: 'open',
        deliveryRate: 0,
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
      await expectError(
        await client.post('/api/retainers', cast.gm.cookie, body(clientId, { renewalDate: today })),
        400,
        'INVALID_DATES',
      );
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

  describe('read', () => {
    it('shows every user the retainer, money only with money access (M1)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, { monthlyFeeMinor: 90000 });
      const asEmployee = await detail(created.id, cast.employee.cookie);
      expect(asEmployee.money).toBeUndefined();
      expect(asEmployee.permissions).toMatchObject({ canManage: false, canSeeMoney: false });
      const asFinance = await detail(created.id, finance.cookie);
      expect(asFinance.money).toEqual({ currency: 'USD', monthlyFeeMinor: 90000 });
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
      const soon = await cast.createRetainer(own.id, { renewalDate: addDays(today, 10) });
      const later = await cast.createRetainer(own.id, { renewalDate: addDays(today, 90) });
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
        renewalDate: addDays(today, 400),
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

    it('locks the currency once a fee is set (M2) or an invoice exists (F13 rule 24)', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createRetainer(clientId, { monthlyFeeMinor: 1000 });
      await expectError(
        await patch(created.id, cast.gm.cookie, { currency: 'SYP' }),
        409,
        'CURRENCY_LOCKED',
      );
      expect((await patch(created.id, cast.gm.cookie, { monthlyFeeMinor: null })).status).toBe(200);
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
      expect((await patch(created.id, cast.gm.cookie, { currency: 'SYP' })).status).toBe(200);
    });

    it('fixes the start date once a cycle exists; an earlier start opens the cycle', async () => {
      const { id: clientId } = await cast.createClient();
      const started = await cast.createRetainer(clientId);
      await expectError(
        await patch(started.id, cast.gm.cookie, { startDate: addDays(today, -1) }),
        409,
        'RETAINER_STARTED',
      );
      const later = await cast.createRetainer(clientId, { startDate: addDays(today, 40) });
      const moved = await patch(later.id, cast.gm.cookie, { startDate: today });
      expect(retainerDetailSchema.parse(await moved.json()).currentCycle?.status).toBe('open');
      await expectError(
        await patch(later.id, cast.gm.cookie, { renewalDate: addDays(today, -5) }),
        400,
        'INVALID_DATES',
      );
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
    it('keeps the same cycle through pause and resume in one month (edge case 5)', async () => {
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
      expect(resumed).toMatchObject({ status: 'active', currentCycle: { id: cycleId } });
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
      expect(retainerDetailSchema.parse(await reactivated.json())).toMatchObject({
        status: 'active',
        endedOn: null,
      });
      const actions = (await auditOf(created.id)).map((entry) => [entry.action, entry.after]);
      expect(actions.slice(1)).toEqual([
        ['retainer.status_changed', { status: 'ended' }],
        ['retainer.status_changed', { status: 'active' }],
      ]);
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
