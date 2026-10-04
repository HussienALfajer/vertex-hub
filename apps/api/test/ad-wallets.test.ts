import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  type AdWallet,
  addDays,
  adWalletSchema,
  businessDate,
  campaignDetailSchema,
  fileItemPageSchema,
  fileUploadSchema,
  type RecordWalletEntryInput,
  walletPageSchema,
} from '@vertex-hub/contracts';
import {
  adWallets,
  auditEntries,
  clients,
  createDatabase,
  invoiceSettings,
  notifications,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyReminders } from '../src/modules/notifications/index.js';
import { ok, seedCampaignCast } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { startApp } from './start-app.js';

describe('ad wallets (F12 rules 15–22, A11)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedCampaignCast>>;
  let savedSettings: typeof invoiceSettings.$inferSelect;
  /** Managed by `cast.am`. */
  let clientId: string;
  /** Managed by `cast.otherAm`. */
  let otherClientId: string;
  const today = businessDate();
  const year = Number(today.slice(0, 4));

  const wallet = (id: string, cookie = cast.finance.cookie, query = '') =>
    client.get(`/api/clients/${id}/ad-wallet${query}`, cookie);

  const walletOf = async (id: string, cookie = cast.finance.cookie): Promise<AdWallet> =>
    ok(await wallet(id, cookie), adWalletSchema);

  const record = (
    id: string,
    body: Partial<RecordWalletEntryInput>,
    cookie = cast.finance.cookie,
  ) =>
    client.post(`/api/clients/${id}/ad-wallet/entries`, cookie, {
      kind: 'deposit',
      occurredOn: today,
      amountMinor: 50_000,
      currency: 'USD',
      method: 'bank_transfer',
      ...body,
    });

  const recorded = async (id: string, body: Partial<RecordWalletEntryInput> = {}) =>
    ok(await record(id, body), adWalletSchema, 201);

  const voidEntry = (entryId: string, cookie = cast.finance.cookie) =>
    client.post(`/api/ad-wallet-entries/${entryId}/void`, cookie, { reason: 'سُجّل مرتين' });

  const setThreshold = (id: string, value: number | null, cookie = cast.marketer.cookie) =>
    client.request('PATCH', `/api/clients/${id}/ad-wallet`, {
      cookie,
      body: { lowBalanceThresholdMinor: value },
    });

  const newestEntry = (result: AdWallet) => {
    const [entry] = result.entries;
    if (!entry) throw new Error('No entry');
    return entry;
  };

  const alertsOf = (subjectId: string) =>
    db
      .select({ recipientId: notifications.recipientId })
      .from(notifications)
      .where(and(eq(notifications.subjectId, subjectId), eq(notifications.type, 'ad_budget_low')));

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  async function uploaded(cookie: string, fileName: string) {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4 proof']), fileName);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    expect(response.status).toBe(201);
    return fileUploadSchema.parse(await response.json());
  }

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-ad-wallets-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedCampaignCast(db, client);
    [savedSettings] = (await db.select().from(invoiceSettings)) as [
      typeof invoiceSettings.$inferSelect,
    ];
    await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000', rateUpdatedAt: new Date() });
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
  });

  afterAll(async () => {
    await app?.close();
    if (savedSettings) await db.update(invoiceSettings).set(savedSettings);
    await cast?.cleanup();
    await connection.close();
    if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/ad-wallets')).status).toBe(401);
    expect((await client.get(`/api/clients/${id}/ad-wallet`)).status).toBe(401);
    expect(
      (
        await client.request('PATCH', `/api/clients/${id}/ad-wallet`, {
          body: { lowBalanceThresholdMinor: 1 },
        })
      ).status,
    ).toBe(401);
    expect((await client.post(`/api/clients/${id}/ad-wallet/entries`)).status).toBe(401);
    expect((await client.post(`/api/ad-wallet-entries/${id}/void`)).status).toBe(401);
  });

  it('shows a new wallet empty with the default threshold, to campaign readers in scope', async () => {
    const id = (await cast.createClient()).id;
    const empty = await walletOf(id);
    expect(empty).toMatchObject({
      client: { id, archived: false },
      depositedMinor: 0,
      refundedMinor: 0,
      spentMinor: 0,
      balanceMinor: 0,
      lowBalanceThresholdMinor: 10_000,
      low: false,
      usesWallet: false,
      openingMinor: 0,
      ledger: [],
      entries: [],
      permissions: { canFund: true, canDeposit: true, canEditThreshold: false },
    });
    // Reading creates no wallet row (rule 17: created on first use).
    expect(await db.select().from(adWallets).where(eq(adWallets.clientId, id))).toEqual([]);
    expect((await walletOf(id, cast.am.cookie)).permissions).toEqual({
      canFund: false,
      canDeposit: false,
      canEditThreshold: true,
    });
    expect((await walletOf(id, cast.marketer.cookie)).permissions.canEditThreshold).toBe(true);
    // Another manager's account manager does not see it; an employee holds no campaigns.read.
    expect((await wallet(id, cast.otherAm.cookie)).status).toBe(404);
    expect((await wallet(id, cast.employee.cookie)).status).toBe(403);
    expect((await wallet(randomUUID())).status).toBe(404);
  });

  it('records a USD deposit with the next receipt number and its proof, audited', async () => {
    const id = (await cast.createClient()).id;
    await expectError(await record(id, { proofUploadId: randomUUID() }), 400, 'UPLOAD_NOT_FOUND');
    const upload = await uploaded(cast.finance.cookie, 'تحويل.pdf');
    const first = await recorded(id, {
      amountMinor: 50_000,
      reference: 'بنك البركة 7781',
      proofUploadId: upload.uploadId,
    });
    const entry = newestEntry(first);
    expect(entry).toMatchObject({
      kind: 'deposit',
      occurredOn: today,
      amountMinor: 50_000,
      currency: 'USD',
      usdMinor: 50_000,
      method: 'bank_transfer',
      reference: 'بنك البركة 7781',
      recordedBy: { id: cast.finance.id },
      voided: null,
    });
    expect(entry.receiptNumber).toMatch(new RegExp(`^AD-${year}-\\d{4,}$`));
    expect(entry.proof?.name).toBe(`${entry.receiptNumber} تحويل.pdf`);
    expect(first).toMatchObject({ depositedMinor: 50_000, balanceMinor: 50_000, usesWallet: true });
    expect(first.ledger).toEqual([
      expect.objectContaining({
        kind: 'deposit',
        id: entry.id,
        usdMinor: 50_000,
        balanceMinor: 50_000,
        voided: false,
        entry: { receiptNumber: entry.receiptNumber, amountMinor: 50_000, currency: 'USD' },
        spend: null,
      }),
    ]);
    // Receipt numbers are consecutive within the year.
    const second = newestEntry(await recorded(id, { amountMinor: 1_000 }));
    const number = (receipt: string | null) => Number(receipt?.split('-')[2]);
    expect(number(second.receiptNumber)).toBe(number(entry.receiptNumber) + 1);
    const [audit] = await auditOf(entry.id);
    expect(audit).toMatchObject({
      action: 'ad_wallet_entry.recorded',
      actorId: cast.finance.id,
      after: {
        clientId: id,
        kind: 'deposit',
        receiptNumber: entry.receiptNumber,
        amountMinor: 50_000,
        currency: 'USD',
        usdMinor: 50_000,
        balanceAfterMinor: 50_000,
      },
    });
    // The proof is not in the client's documents (F10 rule 13 lists no entry files).
    const documents = fileItemPageSchema.parse(
      await (await client.get(`/api/files/documents?clientId=${id}`, cast.gm.cookie)).json(),
    );
    expect(documents.items.map((item) => item.id)).not.toContain(entry.proof?.id);
  });

  it('converts an SYP deposit at its own rate, and asks for a rate when none is set', async () => {
    const id = (await cast.createClient()).id;
    const syp = newestEntry(await recorded(id, { amountMinor: 650_000_00, currency: 'SYP' }));
    // The current rate by default: 650 000 SYP at 13 000 = 50 USD.
    expect(syp).toMatchObject({ sypPerUsd: '13000.0000', usdMinor: 5_000 });
    const own = newestEntry(
      await recorded(id, { amountMinor: 100_000_00, currency: 'SYP', sypPerUsd: '12500' }),
    );
    expect(own).toMatchObject({ sypPerUsd: '12500.0000', usdMinor: 800 });
    await db.update(invoiceSettings).set({ sypPerUsd: null });
    try {
      await expectError(await record(id, {}), 409, 'RATE_REQUIRED');
      await recorded(id, { sypPerUsd: '13000' });
    } finally {
      await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000' });
    }
    await expectError(await record(id, { occurredOn: addDays(today, 1) }), 400, 'INVALID_DATES');
  });

  it('keeps money to campaigns.fund holders', async () => {
    const id = (await cast.createClient()).id;
    for (const cookie of [cast.am.cookie, cast.marketer.cookie, cast.employee.cookie]) {
      expect((await record(id, {}, cookie)).status).toBe(403);
    }
    // The General Manager and the Operations manager fund too.
    await ok(await record(id, {}, cast.gm.cookie), adWalletSchema, 201);
    const funded = await ok(await record(id, {}, cast.operations.cookie), adWalletSchema, 201);
    const entry = newestEntry(funded);
    for (const cookie of [cast.am.cookie, cast.marketer.cookie, cast.otherAm.cookie]) {
      expect((await voidEntry(entry.id, cookie)).status).toBe(403);
    }
    expect((await voidEntry(randomUUID())).status).toBe(404);
    expect((await record(randomUUID(), {})).status).toBe(404);
    // Finance reads and funds but does not edit thresholds.
    expect((await setThreshold(id, 5_000, cast.finance.cookie)).status).toBe(403);
  });

  it('refunds up to the balance, without a receipt number (rule 16)', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 30_000 });
    await expectError(
      await record(id, { kind: 'refund', amountMinor: 30_001 }),
      409,
      'REFUND_EXCEEDS_BALANCE',
    );
    const refunded = await recorded(id, { kind: 'refund', amountMinor: 10_000, method: 'cash' });
    expect(newestEntry(refunded)).toMatchObject({ kind: 'refund', receiptNumber: null });
    expect(refunded).toMatchObject({ refundedMinor: 10_000, balanceMinor: 20_000 });
    expect(refunded.ledger.map((row) => [row.kind, row.balanceMinor])).toEqual([
      ['deposit', 30_000],
      ['refund', 20_000],
    ]);
  });

  it('orders concurrent refunds by the wallet lock (edge case 2)', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 10_000 });
    const responses = await Promise.all([
      record(id, { kind: 'refund', amountMinor: 6_000 }),
      record(id, { kind: 'refund', amountMinor: 6_000 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await walletOf(id)).balanceMinor).toBe(4_000);
  });

  it('orders a refund and a wallet campaign update by the wallet lock (rule 17)', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 10_000 });
    const campaign = await cast.activeCampaign(id);
    const [update, refund] = await Promise.all([
      cast.addUpdate(campaign.id, { spendMinor: 6_000 }),
      record(id, { kind: 'refund', amountMinor: 6_000 }),
    ]);
    // Spend is never refused (rule 13); the refund sees the spend when it comes second.
    expect(update.status).toBe(201);
    const { balanceMinor } = await walletOf(id);
    if (refund.status === 201) {
      expect(balanceMinor).toBe(-2_000);
    } else {
      await expectError(refund, 409, 'REFUND_EXCEEDS_BALANCE');
      expect(balanceMinor).toBe(4_000);
    }
  });

  it('voids an entry with a reason; it stays listed and its number stays used (rule 18)', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 30_000 });
    const second = newestEntry(await recorded(id, { amountMinor: 20_000 }));
    const voided = await ok(await voidEntry(second.id), adWalletSchema);
    expect(voided.balanceMinor).toBe(30_000);
    expect(newestEntry(voided)).toMatchObject({
      id: second.id,
      receiptNumber: second.receiptNumber,
      voided: { by: { id: cast.finance.id }, reason: 'سُجّل مرتين' },
    });
    expect(voided.ledger.find((row) => row.id === second.id)).toMatchObject({
      voided: true,
      balanceMinor: 30_000,
    });
    await expectError(await voidEntry(second.id), 409, 'INVALID_TRANSITION');
    const audit = (await auditOf(second.id)).find(
      (entry) => entry.action === 'ad_wallet_entry.voided',
    );
    expect(audit?.after).toMatchObject({
      clientId: id,
      voided: true,
      reason: 'سُجّل مرتين',
      balanceAfterMinor: 30_000,
    });
  });

  it('takes wallet spend off the balance, never direct spend (rules 12 and 15)', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 50_000 });
    const campaign = await cast.activeCampaign(id);
    const updated = await ok(await cast.addUpdate(campaign.id), campaignDetailSchema, 201);
    expect(updated.walletBalanceMinor).toBe(30_000);
    const direct = await cast.activeCampaign(id, { funding: 'client_direct' });
    expect(direct.walletBalanceMinor).toBeNull();
    await ok(await cast.addUpdate(direct.id, { spendMinor: 99_000 }), campaignDetailSchema, 201);
    const after = await walletOf(id);
    expect(after).toMatchObject({ spentMinor: 20_000, balanceMinor: 30_000 });
    // The spend ends on 7 September, before today's deposit.
    expect(after.ledger[0]).toMatchObject({
      kind: 'spend',
      id: updated.updates[0]?.id,
      date: '2026-09-07',
      usdMinor: 20_000,
      entry: null,
      spend: {
        campaign: { id: campaign.id, name: campaign.name },
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
      },
    });
    // Editing the spend moves the balance (edge case 4); archiving the update gives it back.
    const updateId = updated.updates[0]?.id ?? '';
    await ok(
      await client.request('PATCH', `/api/campaign-updates/${updateId}`, {
        cookie: cast.marketer.cookie,
        body: { spendMinor: 3_000 },
      }),
      campaignDetailSchema,
    );
    expect((await walletOf(id)).balanceMinor).toBe(47_000);
    await ok(
      await client.post(`/api/campaign-updates/${updateId}/archive`, cast.marketer.cookie),
      campaignDetailSchema,
    );
    expect((await walletOf(id)).balanceMinor).toBe(50_000);
  });

  it('goes negative when spend passes the balance, and filters the ledger by period', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 10_000, occurredOn: '2026-08-20' });
    const campaign = await cast.activeCampaign(id);
    await ok(await cast.addUpdate(campaign.id, { spendMinor: 25_000 }), campaignDetailSchema, 201);
    const negative = await walletOf(id);
    expect(negative.balanceMinor).toBe(-15_000);
    const september = await ok(
      await wallet(id, cast.finance.cookie, '?from=2026-09-01&to=2026-09-30'),
      adWalletSchema,
    );
    expect(september).toMatchObject({ from: '2026-09-01', to: '2026-09-30', openingMinor: 10_000 });
    expect(september.ledger.map((row) => [row.kind, row.balanceMinor])).toEqual([
      ['spend', -15_000],
    ]);
    await expectError(
      await wallet(id, cast.finance.cookie, '?from=2026-09-30&to=2026-09-01'),
      400,
      'INVALID_DATES',
    );
  });

  it('refuses deposits on an archived client and allows refunds (edge case 9)', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 10_000 });
    await db.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, id));
    await expectError(await record(id, {}), 409, 'CLIENT_ARCHIVED');
    const refunded = await recorded(id, { kind: 'refund', amountMinor: 10_000 });
    expect(refunded).toMatchObject({
      client: { archived: true },
      balanceMinor: 0,
      permissions: { canFund: true, canDeposit: false },
    });
  });

  it('alerts the account manager and active wallet campaign owners once per crossing (A11)', async () => {
    const id = (await cast.createClient()).id;
    // No deposit yet: spend makes the balance negative but never alerts (rule 20).
    const campaign = await cast.activeCampaign(id);
    await ok(
      await cast.addUpdate(campaign.id, {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-07',
        spendMinor: 1_000,
      }),
      campaignDetailSchema,
      201,
    );
    expect(await alertsOf(id)).toEqual([]);
    // An Operations-owned active wallet campaign and a direct one of the employee.
    await cast.activeCampaign(id, { ownerId: cast.operations.id });
    await cast.activeCampaign(id, { ownerId: cast.employee.id, funding: 'client_direct' });

    await recorded(id, { amountMinor: 16_000 });
    expect(await alertsOf(id)).toEqual([]);
    // 15 000 − 6 000 = 9 000 < 10 000: low.
    await ok(await cast.addUpdate(campaign.id, { spendMinor: 6_000 }), campaignDetailSchema, 201);
    const recipients = (await alertsOf(id)).map((row) => row.recipientId).sort();
    // The owner who entered the spend is alerted too (acceptance step 5).
    expect(recipients).toEqual([cast.am.id, cast.marketer.id, cast.operations.id].sort());
    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.subjectId, id),
          eq(notifications.recipientId, cast.am.id),
          eq(notifications.type, 'ad_budget_low'),
        ),
      );
    expect(notification).toMatchObject({
      type: 'ad_budget_low',
      actorId: null,
      data: { balanceMinor: 9_000, thresholdMinor: 10_000 },
    });
    const low = (await auditOf(id)).filter((entry) => entry.action === 'ad_wallet.low_balance');
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({
      actorId: cast.marketer.id,
      after: { clientId: id, low: true, balanceMinor: 9_000, thresholdMinor: 10_000 },
    });
    expect(await walletOf(id)).toMatchObject({ low: true, balanceMinor: 9_000 });

    // Still low: no second alert.
    await ok(
      await cast.addUpdate(campaign.id, {
        periodStart: '2026-09-08',
        periodEnd: '2026-09-14',
        spendMinor: 1_000,
      }),
      campaignDetailSchema,
      201,
    );
    expect(await alertsOf(id)).toHaveLength(3);

    // Topping up clears it, audited; falling below again starts a new alert.
    await recorded(id, { amountMinor: 5_000 });
    expect(await walletOf(id)).toMatchObject({ low: false, balanceMinor: 13_000 });
    const cleared = (await auditOf(id)).filter(
      (entry) => entry.action === 'ad_wallet.low_balance_cleared',
    );
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ actorId: cast.finance.id });
    await recorded(id, { kind: 'refund', amountMinor: 4_000 });
    expect(await alertsOf(id)).toHaveLength(6);
  });

  it('follows threshold edits: null turns A11 off, a higher one alerts', async () => {
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 15_000 });
    const raised = await ok(await setThreshold(id, 20_000, cast.am.cookie), adWalletSchema);
    expect(raised).toMatchObject({ lowBalanceThresholdMinor: 20_000, low: true });
    expect((await alertsOf(id)).map((row) => row.recipientId)).toEqual([cast.am.id]);
    const off = await ok(await setThreshold(id, null), adWalletSchema);
    expect(off).toMatchObject({ lowBalanceThresholdMinor: null, low: false });
    const [row] = await db.select().from(adWallets).where(eq(adWallets.clientId, id));
    expect(row).toMatchObject({ lowBalanceThresholdMinor: null, lowSince: null });
    const changes = (await auditOf(id)).filter(
      (entry) => entry.action === 'ad_wallet.threshold_changed',
    );
    expect(changes.map((entry) => entry.after)).toEqual([
      { clientId: id, lowBalanceThresholdMinor: 20_000 },
      { clientId: id, lowBalanceThresholdMinor: null },
    ]);
    expect((await setThreshold(otherClientId, 1, cast.am.cookie)).status).toBe(404);
  });

  it('repeats the alert every 7 days while low, once per week mark (rule 21)', async () => {
    const reminders = app.get(DailyReminders);
    const id = (await cast.createClient()).id;
    await recorded(id, { amountMinor: 5_000 });
    expect(await alertsOf(id)).toHaveLength(1);
    const since = addDays(today, -20);
    await db
      .update(adWallets)
      .set({ lowSince: new Date(`${since}T09:00:00Z`) })
      .where(eq(adWallets.clientId, id));
    const runFor = async (day: string) => {
      await reminders.runDaily(day);
      return (await alertsOf(id)).length;
    };
    expect(await runFor(addDays(since, 6))).toBe(1);
    expect(await runFor(addDays(since, 7))).toBe(2);
    expect(await runFor(addDays(since, 7))).toBe(2);
    expect(await runFor(addDays(since, 10))).toBe(2);
    expect(await runFor(addDays(since, 14))).toBe(3);
    // Topped up: no more reminders.
    await recorded(id, { amountMinor: 20_000 });
    expect(await runFor(addDays(since, 21))).toBe(3);
  });

  it('lists the wallets of clients in scope, lowest balance first (Ad budgets)', async () => {
    const low = (await cast.createClient()).id;
    const high = (await cast.createClient()).id;
    const directOnly = (await cast.createClient()).id;
    await recorded(low, { amountMinor: 2_000 });
    await recorded(high, { amountMinor: 900_000 });
    await cast.createCampaign(directOnly, { funding: 'client_direct' });
    await recorded(otherClientId, { amountMinor: 1_000 });
    const list = async (query: string, cookie = cast.finance.cookie) =>
      (await ok(await client.get(`/api/ad-wallets${query}`, cookie), walletPageSchema)).items;
    const all = await list('?pageSize=100');
    const ids = all.map((item) => item.client.id);
    expect(ids.indexOf(low)).toBeLessThan(ids.indexOf(high));
    expect(ids).not.toContain(directOnly);
    expect(all.find((item) => item.client.id === low)).toMatchObject({
      accountManager: { id: cast.am.id },
      depositedMinor: 2_000,
      balanceMinor: 2_000,
      lowBalanceThresholdMinor: 10_000,
      low: true,
      lastDepositOn: today,
    });
    const lowOnly = (await list('?low=true&pageSize=100')).map((item) => item.client.id);
    expect(lowOnly).toContain(low);
    expect(lowOnly).not.toContain(high);
    // An account manager sees their own clients only; an employee none.
    const mine = (await list('?pageSize=100', cast.am.cookie)).map((item) => item.client.id);
    expect(mine).toEqual(expect.arrayContaining([low, high]));
    expect(mine).not.toContain(otherClientId);
    expect((await client.get('/api/ad-wallets', cast.employee.cookie)).status).toBe(403);
  });

  it('reads the client wallet of a wallet campaign out of scope as a 404', async () => {
    expect((await wallet(clientId, cast.otherAm.cookie)).status).toBe(404);
    expect((await wallet(otherClientId, cast.am.cookie)).status).toBe(404);
    expect((await wallet(clientId, cast.am.cookie)).status).toBe(200);
  });
});
