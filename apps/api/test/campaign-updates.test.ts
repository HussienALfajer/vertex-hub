import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CampaignDetail,
  campaignDetailSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok, seedCampaignCast } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('ad campaign updates (F12 rules 9–11)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedCampaignCast>>;
  /** Managed by `cast.am`. */
  let clientId: string;
  /** Managed by `cast.otherAm`. */
  let otherClientId: string;
  const today = businessDate();

  const patch = (id: string, body: Record<string, unknown>, cookie = cast.marketer.cookie) =>
    client.request('PATCH', `/api/campaign-updates/${id}`, { cookie, body });

  const archive = (id: string, cookie = cast.marketer.cookie) =>
    client.post(`/api/campaign-updates/${id}/archive`, cookie);

  const added = async (campaignId: string, input = {}): Promise<CampaignDetail> =>
    ok(await cast.addUpdate(campaignId, input), campaignDetailSchema, 201);

  const onlyUpdate = (campaign: CampaignDetail) => {
    const [update] = campaign.updates;
    if (!update) throw new Error('No update');
    return update;
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedCampaignCast(db, client);
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('adds an update with cost per result, budget used and monthly totals, audited', async () => {
    const campaign = await cast.activeCampaign(clientId);
    const result = await added(campaign.id, { note: 'الأسبوع الأول' });
    const update = onlyUpdate(result);
    expect(update).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      spendMinor: 20_000,
      reach: 15_000,
      clicks: 900,
      results: 45,
      costPerResultMinor: 444,
      note: 'الأسبوع الأول',
      enteredBy: { id: cast.marketer.id },
    });
    expect(result.totals).toEqual({
      spendMinor: 20_000,
      reach: 15_000,
      clicks: 900,
      results: 45,
      costPerResultMinor: 444,
      budgetUsed: 33,
    });
    const second = await added(campaign.id, {
      periodStart: '2026-08-25',
      periodEnd: '2026-08-31',
      spendMinor: 10_000,
      results: 0,
    });
    expect(second.updates.map((row) => row.periodStart)).toEqual(['2026-09-01', '2026-08-25']);
    expect(second.months).toEqual([
      {
        month: '2026-08',
        spendMinor: 10_000,
        reach: 15_000,
        clicks: 900,
        results: 0,
        costPerResultMinor: null,
      },
      {
        month: '2026-09',
        spendMinor: 20_000,
        reach: 15_000,
        clicks: 900,
        results: 45,
        costPerResultMinor: 444,
      },
    ]);
    expect(second.totals).toMatchObject({ spendMinor: 30_000, results: 45, budgetUsed: 50 });
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, update.id),
          eq(auditEntries.action, 'ad_campaign_update.created'),
        ),
      );
    expect(entry?.after).toMatchObject({
      clientId,
      campaignId: campaign.id,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      spendMinor: 20_000,
      results: 45,
    });
  });

  it('lets spend exceed the budget (rule 13)', async () => {
    const campaign = await cast.activeCampaign(clientId, { budgetMinor: 10_000 });
    const result = await added(campaign.id, { spendMinor: 15_000 });
    expect(result.totals.budgetUsed).toBe(150);
  });

  it('takes updates on active, paused and completed campaigns only', async () => {
    const planned = await cast.createCampaign(clientId);
    expect(planned.permissions.canAddUpdate).toBe(false);
    await expectError(await cast.addUpdate(planned.id), 409, 'INVALID_TRANSITION');
    const paused = await cast.activeCampaign(clientId);
    await cast.changeStatus(paused.id, 'paused');
    await added(paused.id);
    const completed = await cast.activeCampaign(clientId);
    await cast.changeStatus(completed.id, 'completed');
    // The last update often arrives after the end.
    await added(completed.id);
    const cancelled = await cast.activeCampaign(clientId);
    await cast.changeStatus(cancelled.id, 'cancelled', 'x');
    await expectError(await cast.addUpdate(cancelled.id), 409, 'INVALID_TRANSITION');
  });

  it('refuses periods that end after today, run backwards or cross a month', async () => {
    const campaign = await cast.activeCampaign(clientId);
    await expectError(
      await cast.addUpdate(campaign.id, { periodStart: today, periodEnd: addDays(today, 1) }),
      400,
      'INVALID_DATES',
    );
    await expectError(
      await cast.addUpdate(campaign.id, { periodStart: '2026-09-07', periodEnd: '2026-09-01' }),
      400,
      'INVALID_DATES',
    );
    await expectError(
      await cast.addUpdate(campaign.id, { periodStart: '2026-08-28', periodEnd: '2026-09-04' }),
      400,
      'PERIOD_CROSSES_MONTH',
    );
    // An update that ends today is accepted.
    await added(campaign.id, { periodStart: today, periodEnd: today });
  });

  it('refuses overlapping periods, ignoring archived updates (rule 10)', async () => {
    const campaign = await cast.activeCampaign(clientId);
    const first = onlyUpdate(await added(campaign.id));
    for (const period of [
      { periodStart: '2026-09-07', periodEnd: '2026-09-10' },
      { periodStart: '2026-09-02', periodEnd: '2026-09-03' },
      { periodStart: '2026-09-01', periodEnd: '2026-09-30' },
    ]) {
      await expectError(await cast.addUpdate(campaign.id, period), 409, 'PERIOD_OVERLAP');
    }
    await added(campaign.id, { periodStart: '2026-09-08', periodEnd: '2026-09-14' });
    const afterArchive = await ok(await archive(first.id), campaignDetailSchema);
    expect(afterArchive.updates.map((row) => row.periodStart)).toEqual(['2026-09-08']);
    expect(afterArchive.totals.spendMinor).toBe(20_000);
    await added(campaign.id, { periodStart: '2026-09-01', periodEnd: '2026-09-07' });
  });

  it('orders concurrent overlapping updates: one is saved, the other refused', async () => {
    const campaign = await cast.activeCampaign(clientId);
    const responses = await Promise.all([
      cast.addUpdate(campaign.id),
      cast.addUpdate(campaign.id, { periodStart: '2026-09-05', periodEnd: '2026-09-10' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const read = await ok(
      await client.get(`/api/campaigns/${campaign.id}`, cast.marketer.cookie),
      campaignDetailSchema,
    );
    expect(read.updates).toHaveLength(1);
  });

  it('edits an update, re-checking its period, and audits the change', async () => {
    const campaign = await cast.activeCampaign(clientId);
    await added(campaign.id, { periodStart: '2026-09-08', periodEnd: '2026-09-14' });
    const update = (await added(campaign.id)).updates.find(
      (row) => row.periodStart === '2026-09-01',
    );
    if (!update) throw new Error('No update');
    const edited = await ok(await patch(update.id, { spendMinor: 3_000 }), campaignDetailSchema);
    expect(edited.updates.find((row) => row.id === update.id)).toMatchObject({
      spendMinor: 3_000,
      costPerResultMinor: 67,
    });
    expect(edited.totals.spendMinor).toBe(23_000);
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, update.id),
          eq(auditEntries.action, 'ad_campaign_update.updated'),
        ),
      );
    expect(entry?.before).toMatchObject({ campaignId: campaign.id, spendMinor: 20_000 });
    expect(entry?.after).toMatchObject({ campaignId: campaign.id, spendMinor: 3_000 });
    await expectError(await patch(update.id, { periodEnd: '2026-09-08' }), 409, 'PERIOD_OVERLAP');
    await expectError(
      await patch(update.id, { periodEnd: '2026-10-01' }),
      400,
      'PERIOD_CROSSES_MONTH',
    );
    await expectError(
      await patch(update.id, { periodStart: '2026-09-07', periodEnd: '2026-09-02' }),
      400,
      'INVALID_DATES',
    );
    // Its own period does not count as an overlap.
    await ok(await patch(update.id, { periodEnd: '2026-09-06' }), campaignDetailSchema);
  });

  it('still edits and archives updates of a cancelled campaign', async () => {
    const campaign = await cast.activeCampaign(clientId);
    const update = onlyUpdate(await added(campaign.id));
    const cancelled = await ok(
      await cast.changeStatus(campaign.id, 'cancelled', 'x'),
      campaignDetailSchema,
    );
    expect(cancelled.permissions).toMatchObject({ canAddUpdate: false, canEditUpdates: true });
    await ok(await patch(update.id, { spendMinor: 1_000 }), campaignDetailSchema);
    await ok(await archive(update.id), campaignDetailSchema);
  });

  it('refuses changes to an archived update', async () => {
    const campaign = await cast.activeCampaign(clientId);
    const update = onlyUpdate(await added(campaign.id));
    await ok(await archive(update.id), campaignDetailSchema);
    await expectError(await archive(update.id), 409, 'INVALID_TRANSITION');
    await expectError(await patch(update.id, { spendMinor: 1 }), 409, 'INVALID_TRANSITION');
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, update.id),
          eq(auditEntries.action, 'ad_campaign_update.archived'),
        ),
      );
    expect(entry?.after).toMatchObject({ campaignId: campaign.id, archived: true });
  });

  it('answers 401, 403 and 404 by access', async () => {
    const campaign = await cast.activeCampaign(otherClientId);
    const update = onlyUpdate(await added(campaign.id));
    expect((await client.post(`/api/campaigns/${campaign.id}/updates`, undefined, {})).status).toBe(
      401,
    );
    expect((await patch(update.id, { spendMinor: 1 }, '')).status).toBe(401);
    expect((await archive(update.id, '')).status).toBe(401);
    for (const cookie of [cast.finance.cookie, cast.employee.cookie]) {
      expect((await cast.addUpdate(campaign.id, {}, cookie)).status).toBe(403);
      expect((await patch(update.id, { spendMinor: 1 }, cookie)).status).toBe(403);
      expect((await archive(update.id, cookie)).status).toBe(403);
    }
    expect((await cast.addUpdate(campaign.id, {}, cast.am.cookie)).status).toBe(404);
    expect((await patch(update.id, { spendMinor: 1 }, cast.am.cookie)).status).toBe(404);
    expect((await archive(update.id, cast.am.cookie)).status).toBe(404);
    expect((await patch(randomUUID(), { spendMinor: 1 })).status).toBe(404);
    // The client's account manager manages its updates.
    expect((await patch(update.id, { spendMinor: 1 }, cast.otherAm.cookie)).status).toBe(200);
  });
});
