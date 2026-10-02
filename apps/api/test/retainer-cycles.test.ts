import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  cycleDetailSchema,
  cycleLineSchema,
  cyclePageSchema,
  firstOfMonth,
  lastOfMonth,
  type TaskCounts,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, retainerCycles } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobItemsFailedError } from '../src/core/jobs/index.js';
import { CycleOpenedHooks, WorkProgress } from '../src/modules/projects/index.js';
import { RetainerCyclesService } from '../src/modules/projects/retainer-cycles.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('retainer cycles', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  const today = businessDate();
  const nextMonth = addDays(lastOfMonth(today), 1);
  /** Task counts the fake F06 source reports, by cycle line id. */
  const tasks = new Map<string, TaskCounts>();

  const base = (retainerId: string) => `/api/retainers/${retainerId}/cycles`;
  const adjust = (
    retainerId: string,
    cycleId: string,
    lineId: string,
    cookie: string,
    body: unknown,
  ) => client.post(`${base(retainerId)}/${cycleId}/lines/${lineId}/adjustments`, cookie, body);
  const setCommitted = (
    retainerId: string,
    cycleId: string,
    lineId: string,
    cookie: string | undefined,
    body: unknown,
  ) => client.request('PATCH', `${base(retainerId)}/${cycleId}/lines/${lineId}`, { cookie, body });
  const cycles = async (retainerId: string, cookie: string) => {
    const response = await client.get(base(retainerId), cookie);
    expect(response.status).toBe(200);
    return cyclePageSchema.parse(await response.json()).items;
  };
  const cycleDetail = async (retainerId: string, cycleId: string, cookie: string) => {
    const response = await client.get(`${base(retainerId)}/${cycleId}`, cookie);
    expect(response.status).toBe(200);
    return cycleDetailSchema.parse(await response.json());
  };
  /** A started retainer and its open cycle's design line (12 committed). */
  const started = async (accountManagerId?: string) => {
    const { id: clientId } = await cast.createClient(accountManagerId ? { accountManagerId } : {});
    const retainer = await cast.createRetainer(clientId);
    const cycle = retainer.currentCycle;
    const design = cycle?.lines.find((line) => line.kind === 'design');
    if (!cycle || !design) throw new Error('The retainer has no open cycle');
    return { clientId, retainer, cycle, design };
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    const pick = (ids: string[]) =>
      new Map(ids.flatMap((id) => (tasks.has(id) ? [[id, tasks.get(id) as TaskCounts]] : [])));
    app.get(WorkProgress).register({
      projects: async () => new Map(),
      milestones: async () => new Map(),
      cycleLines: async (ids) => pick(ids),
      openTasks: async () => [],
      cancelOpenTasks: async () => {},
    });
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const [id, cycleId, lineId] = [randomUUID(), randomUUID(), randomUUID()];
    expect((await client.get(base(id))).status).toBe(401);
    expect((await client.get(`${base(id)}/${cycleId}`)).status).toBe(401);
    expect((await setCommitted(id, cycleId, lineId, undefined, {})).status).toBe(401);
    expect((await client.post(`${base(id)}/${cycleId}/lines`)).status).toBe(401);
    expect((await client.post(`${base(id)}/${cycleId}/lines/${lineId}/adjustments`)).status).toBe(
      401,
    );
  });

  describe('the counter', () => {
    it('adds reasoned adjustments to delivered tasks and never goes negative (R7)', async () => {
      const { retainer, cycle, design } = await started();
      tasks.set(design.id, { total: 3, delivered: 2, open: 1, ready: 0 });
      const response = await adjust(retainer.id, cycle.id, design.id, cast.am.cookie, {
        delta: 3,
        reason: ' Posted from the client’s account ',
      });
      expect(response.status).toBe(201);
      expect(cycleLineSchema.parse(await response.json())).toMatchObject({
        committed: 12,
        delivered: 5,
        tasks: { total: 3, delivered: 2 },
      });
      await expectError(
        await adjust(retainer.id, cycle.id, design.id, cast.am.cookie, {
          delta: -6,
          reason: 'Mistake',
        }),
        409,
        'NEGATIVE_DELIVERED',
      );
      expect(
        (await adjust(retainer.id, cycle.id, design.id, cast.am.cookie, { delta: 0, reason: 'x' }))
          .status,
      ).toBe(400);
      expect(
        (await adjust(retainer.id, cycle.id, design.id, cast.am.cookie, { delta: 1 })).status,
      ).toBe(400);

      const shown = await cycleDetail(retainer.id, cycle.id, cast.employee.cookie);
      const line = shown.lines.find((candidate) => candidate.id === design.id);
      expect(line?.adjustments).toEqual([
        expect.objectContaining({
          delta: 3,
          reason: 'Posted from the client’s account',
          author: { id: cast.am.id, name: expect.any(String) },
        }),
      ]);
      // R11 on known dates, whatever day the suite runs: three days left with 5 of 12 is behind.
      await db
        .update(retainerCycles)
        .set({ periodStart: addDays(today, -27), periodEnd: addDays(today, 3) })
        .where(eq(retainerCycles.id, cycle.id));
      const late = await cycleDetail(retainer.id, cycle.id, cast.employee.cookie);
      expect(late.lines.find((candidate) => candidate.id === design.id)?.behind).toBe(true);
      expect(late.behind).toBe(true);
      // A month just begun, with most still to come, is not.
      await db
        .update(retainerCycles)
        .set({ periodStart: today, periodEnd: addDays(today, 29) })
        .where(eq(retainerCycles.id, cycle.id));
      const early = await cycleDetail(retainer.id, cycle.id, cast.employee.cookie);
      expect(early.lines.find((candidate) => candidate.id === design.id)?.behind).toBe(false);
      await db
        .update(retainerCycles)
        .set({ periodStart: cycle.periodStart, periodEnd: cycle.periodEnd })
        .where(eq(retainerCycles.id, cycle.id));
      const entries = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, cycle.id))
        .orderBy(auditEntries.id);
      expect(entries.map((entry) => entry.action)).toEqual([
        'retainer_cycle.created',
        'retainer_cycle.adjusted',
      ]);
      expect(entries[1]?.after).toMatchObject({
        lineId: design.id,
        delivered: 5,
        delta: 3,
        retainerId: retainer.id,
      });
    });

    it('applies two adjustments sent at the same time (edge case 1)', async () => {
      const { retainer, cycle, design } = await started();
      const responses = await Promise.all([
        adjust(retainer.id, cycle.id, design.id, cast.am.cookie, { delta: 2, reason: 'One' }),
        adjust(retainer.id, cycle.id, design.id, cast.gm.cookie, { delta: 3, reason: 'Two' }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      const line = (await cycleDetail(retainer.id, cycle.id, cast.gm.cookie)).lines.find(
        (one) => one.id === design.id,
      );
      expect(line?.delivered).toBe(5);
    });

    it('computes the delivery rate over capped lines (R13)', async () => {
      const { retainer, cycle, design } = await started();
      await adjust(retainer.id, cycle.id, design.id, cast.gm.cookie, {
        delta: 20,
        reason: 'Over-delivered',
      });
      const [current] = await cycles(retainer.id, cast.gm.cookie);
      // 12 of 12 designs and 0 of 4 reels: 12 / 16.
      expect(current?.deliveryRate).toBe(75);
      expect(current?.lines.find((line) => line.id === design.id)?.behind).toBe(false);
    });

    it('changes the committed quantity with a reason and adds lines for this cycle (R9)', async () => {
      const { retainer, cycle } = await started();
      const reel = cycle.lines.find((line) => line.kind === 'reel');
      const changed = await setCommitted(retainer.id, cycle.id, reel?.id ?? '', cast.am.cookie, {
        committedQuantity: 5,
        reason: 'Campaign month',
      });
      expect(changed.status).toBe(200);
      expect(cycleLineSchema.parse(await changed.json()).committed).toBe(5);
      expect(
        (
          await setCommitted(retainer.id, cycle.id, reel?.id ?? '', cast.am.cookie, {
            committedQuantity: 5,
          })
        ).status,
      ).toBe(400);

      const added = await client.post(`${base(retainer.id)}/${cycle.id}/lines`, cast.am.cookie, {
        kind: 'other',
        label: 'Launch video',
        committedQuantity: 1,
        reason: 'Agreed on the phone',
      });
      expect(added.status).toBe(201);
      expect(cycleLineSchema.parse(await added.json())).toMatchObject({
        deliverableId: null,
        position: 3,
        committed: 1,
      });
      await expectError(
        await client.post(`${base(retainer.id)}/${cycle.id}/lines`, cast.am.cookie, {
          kind: 'reel',
          committedQuantity: 1,
          reason: 'Again',
        }),
        409,
        'DUPLICATE_DELIVERABLE',
      );
      const actions = (
        await db.select().from(auditEntries).where(eq(auditEntries.entityId, cycle.id))
      ).map((entry) => entry.action);
      expect(actions).toEqual(
        expect.arrayContaining(['retainer_cycle.line_updated', 'retainer_cycle.line_added']),
      );
    });

    it('refuses callers outside client scope and unknown records', async () => {
      const { retainer, cycle, design } = await started();
      const body = { delta: 1, reason: 'x' };
      expect(
        (await adjust(retainer.id, cycle.id, design.id, cast.otherAm.cookie, body)).status,
      ).toBe(403);
      expect(
        (await adjust(retainer.id, cycle.id, design.id, cast.employee.cookie, body)).status,
      ).toBe(403);
      expect((await adjust(retainer.id, cycle.id, randomUUID(), cast.gm.cookie, body)).status).toBe(
        404,
      );
      expect(
        (await client.get(`${base(retainer.id)}/${randomUUID()}`, cast.gm.cookie)).status,
      ).toBe(404);
      const other = await started();
      expect(
        (await client.get(`${base(retainer.id)}/${other.cycle.id}`, cast.gm.cookie)).status,
      ).toBe(404);
    });
  });

  describe('the daily job (R2)', () => {
    it('closes the month with frozen counts and opens the next at full quantities', async () => {
      const { retainer, cycle, design } = await started();
      const reel = cycle.lines.find((line) => line.kind === 'reel');
      await adjust(retainer.id, cycle.id, design.id, cast.gm.cookie, { delta: 4, reason: 'Done' });
      await setCommitted(retainer.id, cycle.id, reel?.id ?? '', cast.gm.cookie, {
        committedQuantity: 6,
        reason: 'Extra reels this month',
      });

      const job = app.get(RetainerCyclesService);
      await job.runDaily(nextMonth);
      const [next, closed] = await cycles(retainer.id, cast.gm.cookie);
      expect(closed).toMatchObject({ id: cycle.id, status: 'closed', deliveryRate: 22 });
      expect(closed?.lines.map((line) => [line.kind, line.committed, line.delivered])).toEqual([
        ['design', 12, 4],
        ['reel', 6, 0],
      ]);
      expect(next).toMatchObject({
        month: nextMonth,
        periodStart: nextMonth,
        periodEnd: lastOfMonth(nextMonth),
        status: 'open',
      });
      // R4 and R9: the next month starts from the retainer's lines, not last month's changes.
      expect(next?.lines.map((line) => [line.kind, line.committed, line.delivered])).toEqual([
        ['design', 12, 0],
        ['reel', 4, 0],
      ]);
      const [closing] = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, cycle.id))
        .orderBy(auditEntries.id)
        .then((entries) => entries.filter((entry) => entry.action === 'retainer_cycle.closed'));
      expect(closing).toMatchObject({ actorId: null });

      // Idempotent: a repeated run changes nothing for this retainer.
      await job.runDaily(nextMonth);
      expect((await cycles(retainer.id, cast.gm.cookie)).map((c) => [c.id, c.status])).toEqual([
        [next?.id, 'open'],
        [cycle.id, 'closed'],
      ]);

      // R8: deliveries after close show separately and never change the closed month.
      tasks.set(design.id, { total: 2, delivered: 2, open: 0, ready: 0 });
      const frozen = await cycleDetail(retainer.id, cycle.id, cast.gm.cookie);
      expect(frozen.lines.find((line) => line.id === design.id)).toMatchObject({
        delivered: 4,
        deliveredAfterClose: 2,
        behind: false,
      });
      expect(frozen.deliveryRate).toBe(22);
      await expectError(
        await adjust(retainer.id, cycle.id, design.id, cast.gm.cookie, { delta: 1, reason: 'x' }),
        409,
        'CYCLE_CLOSED',
      );
      await expectError(
        await setCommitted(retainer.id, cycle.id, design.id, cast.gm.cookie, {
          committedQuantity: 1,
          reason: 'x',
        }),
        409,
        'CYCLE_CLOSED',
      );
    });

    it('freezes a delivered count never below zero (R7, R8)', async () => {
      const { retainer, cycle, design } = await started();
      tasks.set(design.id, { total: 1, delivered: 1, open: 0, ready: 0 });
      await adjust(retainer.id, cycle.id, design.id, cast.am.cookie, {
        delta: -1,
        reason: 'Counted twice',
      });
      // The delivered task is reopened (or archived) before the month closes.
      tasks.set(design.id, { total: 1, delivered: 0, open: 1, ready: 0 });
      await app.get(RetainerCyclesService).runDaily(nextMonth);
      const closed = await cycleDetail(retainer.id, cycle.id, cast.gm.cookie);
      expect(closed.status).toBe('closed');
      expect(closed.lines.find((line) => line.id === design.id)?.delivered).toBe(0);
      expect(closed.deliveryRate).toBeGreaterThanOrEqual(0);
      tasks.delete(design.id);
    });

    it('opens the new month at 00:30 in Damascus on the 1st, still the 31st in UTC (edge case 16)', async () => {
      const { retainer } = await started();
      // The API runs in this process: faking Date moves its clock too (timers stay real).
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const firstOfNext = addDays(lastOfMonth(nextMonth), 1);
        vi.setSystemTime(new Date(`${addDays(firstOfNext, -1)}T21:30:00.000Z`));
        expect(businessDate()).toBe(firstOfNext);
        await app.get(RetainerCyclesService).runDaily();
      } finally {
        vi.useRealTimers();
      }
      const months = (await cycles(retainer.id, cast.gm.cookie)).map((c) => [c.month, c.status]);
      expect(months[0]).toEqual([addDays(lastOfMonth(nextMonth), 1), 'open']);
    });

    it('opens one cycle when runs overlap (edge case 2)', async () => {
      const { retainer, cycle } = await started();
      const job = app.get(RetainerCyclesService);
      await Promise.all([job.runDaily(nextMonth), job.runDaily(nextMonth)]);
      expect((await cycles(retainer.id, cast.gm.cookie)).map((c) => [c.month, c.status])).toEqual([
        [nextMonth, 'open'],
        [cycle.month, 'closed'],
      ]);
    });

    it('creates no cycle while paused across a month (R5, edge case 5)', async () => {
      const { retainer, cycle } = await started();
      await client.post(`/api/retainers/${retainer.id}/status`, cast.gm.cookie, {
        status: 'paused',
      });
      await app.get(RetainerCyclesService).runDaily(nextMonth);
      expect((await cycles(retainer.id, cast.gm.cookie)).map((c) => [c.id, c.status])).toEqual([
        [cycle.id, 'closed'],
      ]);
    });

    it('skips retainers of archived clients until restored (G2, edge case 15)', async () => {
      const { clientId, retainer, cycle } = await started();
      await client.post(`/api/clients/${clientId}/archive`, cast.gm.cookie);
      const job = app.get(RetainerCyclesService);
      await job.runDaily(nextMonth);
      const [row] = await db
        .select({ status: retainerCycles.status })
        .from(retainerCycles)
        .where(eq(retainerCycles.id, cycle.id));
      expect(row?.status).toBe('open');
      await client.post(`/api/clients/${clientId}/restore`, cast.gm.cookie);
      await job.runDaily(nextMonth);
      expect((await cycles(retainer.id, cast.gm.cookie)).map((c) => c.status)).toEqual([
        'open',
        'closed',
      ]);
    });

    it('keeps going past a retainer that fails, then reports the failure (ADR 0015)', async () => {
      const broken = await started();
      const healthy = await started();
      app.get(CycleOpenedHooks).register(async (_tx, event) => {
        if (event.retainerId === broken.retainer.id) throw new Error('Broken template');
      });
      await expect(app.get(RetainerCyclesService).runDaily(nextMonth)).rejects.toBeInstanceOf(
        JobItemsFailedError,
      );
      expect((await cycles(healthy.retainer.id, cast.gm.cookie)).map((c) => c.status)).toEqual([
        'open',
        'closed',
      ]);
      // The broken retainer's month rolled back: still open, retried on the next run.
      expect((await cycles(broken.retainer.id, cast.gm.cookie)).map((c) => c.status)).toEqual([
        'open',
      ]);
      await client.post(`/api/retainers/${broken.retainer.id}/archive`, cast.gm.cookie);
    });

    it('starts a future retainer on its start date, from that day', async () => {
      const { id: clientId } = await cast.createClient();
      const start = addDays(nextMonth, 9);
      const retainer = await cast.createRetainer(clientId, { startDate: start });
      const job = app.get(RetainerCyclesService);
      await job.runDaily(addDays(start, -1));
      expect(await cycles(retainer.id, cast.gm.cookie)).toEqual([]);
      await job.runDaily(start);
      expect(await cycles(retainer.id, cast.gm.cookie)).toEqual([
        expect.objectContaining({ month: firstOfMonth(start), periodStart: start }),
      ]);
    });
  });
});
