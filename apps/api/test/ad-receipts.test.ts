import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  type AdWallet,
  adWalletSchema,
  businessDate,
  CAMPAIGNS_PDF_JOB,
  type CampaignPdfJob,
  campaignPdfJobSchema,
  campaignPdfStorageKey,
  quotePdfRenderSchema,
  type RecordWalletEntryInput,
} from '@vertex-hub/contracts';
import {
  adWalletEntries,
  auditEntries,
  createDatabase,
  fileItems,
  invoiceSettings,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/core/jobs/index.js';
import { AdReceiptsService } from '../src/modules/campaigns/ad-receipts.service.js';
import { ok, seedCampaignCast } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

/*
 * F12 rules 18 and 19: the API side of ad budget deposit receipts. The worker's render is played
 * by writing the bytes where it would and calling the `campaigns.pdf-ready` handler directly.
 */
describe('ad deposit receipts (F12 rules 18 and 19)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedCampaignCast>>;
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let receipts: AdReceiptsService;
  /** Managed by `cast.am`. */
  let clientId: string;
  const queued: CampaignPdfJob[] = [];
  const today = businessDate();

  const record = async (body: Partial<RecordWalletEntryInput> = {}): Promise<AdWallet> =>
    ok(
      await client.post(`/api/clients/${clientId}/ad-wallet/entries`, cast.finance.cookie, {
        kind: 'deposit',
        occurredOn: today,
        amountMinor: 50_000,
        currency: 'USD',
        method: 'bank_transfer',
        ...body,
      }),
      adWalletSchema,
      201,
    );

  const newest = (wallet: AdWallet) => {
    const [entry] = wallet.entries;
    if (!entry) throw new Error('No entry');
    return entry;
  };

  const entryOf = async (id: string) => {
    const wallet = await ok(
      await client.get(`/api/clients/${clientId}/ad-wallet`, cast.finance.cookie),
      adWalletSchema,
    );
    return wallet.entries.find((entry) => entry.id === id);
  };

  const rowOf = async (id: string) => {
    const [row] = await db.select().from(adWalletEntries).where(eq(adWalletEntries.id, id));
    if (!row) throw new Error('No entry row');
    return row;
  };

  const lastJob = () => {
    const job = queued.at(-1);
    if (!job) throw new Error('No receipt render was queued');
    return job;
  };

  const download = (id: string, cookie = cast.finance.cookie) =>
    client.get(`/api/ad-wallet-entries/${id}/receipt`, cookie);

  const renderAgain = (id: string, cookie = cast.finance.cookie) =>
    client.post(`/api/ad-wallet-entries/${id}/receipt`, cookie, {});

  /** What the worker does for a queued render: writes the bytes, then reports them. */
  async function work(job: CampaignPdfJob, bytes = Buffer.from(`%PDF-1.7 ${job.hash}`)) {
    const storageKey = campaignPdfStorageKey(job);
    const path = join(filesRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const file = {
      storageKey,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    await receipts.ready({ kind: job.kind, id: job.id, hash: job.hash, file });
    return path;
  }

  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  const entryDocuments = (id: string) =>
    db.select().from(fileItems).where(eq(fileItems.adWalletEntryId, id));

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-ad-receipts-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    receipts = app.get(AdReceiptsService);
    vi.spyOn(app.get(JobQueue), 'send').mockImplementation(async (queue, data, options) => {
      if (queue !== CAMPAIGNS_PDF_JOB.queue) return;
      expect(options).toEqual({ retryLimit: CAMPAIGNS_PDF_JOB.retryLimit });
      queued.push(campaignPdfJobSchema.parse(data));
    });
    cast = await seedCampaignCast(db, client);
    [savedSettings] = (await db.select().from(invoiceSettings)) as [
      typeof invoiceSettings.$inferSelect,
    ];
    await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000', rateUpdatedAt: new Date() });
    clientId = (await cast.createClient()).id;
    const billing = await client.request('PATCH', `/api/clients/${clientId}`, {
      cookie: cast.gm.cookie,
      body: { billingName: 'شركة الإعلانات', billingAddress: 'دمشق' },
    });
    expect(billing.status).toBe(200);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    if (savedSettings) await db.update(invoiceSettings).set(savedSettings);
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.post(`/api/ad-wallet-entries/${id}/receipt`, undefined, {})).status).toBe(
      401,
    );
    expect((await client.get(`/api/ad-wallet-entries/${id}/receipt`)).status).toBe(401);
  });

  describe('a deposit in SYP', () => {
    let entryId: string;

    it('freezes and queues its receipt with the rate, USD amount and balance after it', async () => {
      await record({ amountMinor: 20_000 });
      const wallet = await record({
        amountMinor: 650_000_000,
        currency: 'SYP',
        reference: 'TR-77',
      });
      const entry = newest(wallet);
      entryId = entry.id;
      expect(entry.receiptPdf).toEqual({ state: 'pending' });
      const job = lastJob();
      expect(job).toMatchObject({ kind: 'ad_deposit_receipt', id: entry.id });
      expect(job.snapshot).toMatchObject({
        displayNumber: entry.receiptNumber,
        billingName: 'شركة الإعلانات',
        receivedOn: today,
        amountMinor: 650_000_000,
        currency: 'SYP',
        conversion: { sypPerUsd: '13000.0000', usdMinor: 50_000 },
        method: 'bank_transfer',
        reference: 'TR-77',
        balanceAfterMinor: 70_000,
      });
      expect(typeof job.snapshot.companyDetails).toBe('string');
    });

    it('is attached once as a document of the entry, without an entry audit', async () => {
      const auditBefore = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, entryId));
      const job = lastJob();
      await work(job);
      await work(job);
      expect((await entryOf(entryId))?.receiptPdf).toEqual({ state: 'ready' });
      const entry = await entryOf(entryId);
      const documents = await entryDocuments(entryId);
      expect(documents.map((item) => [item.name, item.role, item.clientId])).toEqual([
        [`${entry?.receiptNumber}.pdf`, 'document', clientId],
      ]);
      expect((await rowOf(entryId)).receiptFileItemId).toBe(documents[0]?.id);
      // Rule 24: the handler writes no entry audit.
      expect(
        await db.select().from(auditEntries).where(eq(auditEntries.entityId, entryId)),
      ).toHaveLength(auditBefore.length);
    });

    it('is served to campaign readers of the client only', async () => {
      const served = await download(entryId, cast.am.cookie);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toContain('application/pdf');
      expect(await served.text()).toContain('%PDF-1.7');
      expect((await download(entryId, cast.marketer.cookie)).status).toBe(200);
      expect((await download(entryId, cast.otherAm.cookie)).status).toBe(404);
      expect((await download(entryId, cast.employee.cookie)).status).toBe(403);
      expect((await download(randomUUID())).status).toBe(404);
    });

    it('"Render again" answers ready, and is for campaign readers in scope', async () => {
      const again = await renderAgain(entryId, cast.am.cookie);
      expect(again.status).toBe(200);
      expect(quotePdfRenderSchema.parse(await again.json())).toEqual({ state: 'ready' });
      expect((await renderAgain(entryId, cast.otherAm.cookie)).status).toBe(404);
      expect((await renderAgain(entryId, cast.employee.cookie)).status).toBe(403);
      expect((await renderAgain(randomUUID())).status).toBe(404);
    });

    it('is archived when the deposit is voided, by its actor (rule 18)', async () => {
      const voided = await client.post(
        `/api/ad-wallet-entries/${entryId}/void`,
        cast.finance.cookie,
        {
          reason: 'خطأ في المبلغ',
        },
      );
      expect(voided.status).toBe(200);
      const [item] = await entryDocuments(entryId);
      expect(item?.archivedAt).not.toBeNull();
      const [archived] = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, item?.id ?? ''))
        .orderBy(auditEntries.id)
        .then((rows) => rows.filter((row) => row.action === 'file_item.archived'));
      expect(archived?.actorId).toBe(cast.finance.id);
      expect((await download(entryId)).status).toBe(404);
      await expectError(await renderAgain(entryId), 409, 'INVALID_TRANSITION');
      // The number stays used.
      expect((await entryOf(entryId))?.receiptNumber).toMatch(/^AD-\d{4}-\d{4,}$/);
    });
  });

  it('a refund has no receipt', async () => {
    const jobs = queued.length;
    const wallet = await record({ kind: 'refund', amountMinor: 1_000 });
    const refund = newest(wallet);
    expect(refund.kind).toBe('refund');
    expect(refund.receiptPdf).toBeNull();
    expect(queued).toHaveLength(jobs);
    await expectError(await renderAgain(refund.id), 409, 'INVALID_TRANSITION');
    expect((await download(refund.id)).status).toBe(404);
  });

  it('a failed render is rendered again; one voided while it rendered is attached archived', async () => {
    const entry = newest(await record({ amountMinor: 3_000, method: 'cash' }));
    const job = lastJob();
    expect(job.id).toBe(entry.id);
    await receipts.ready({ kind: job.kind, id: job.id, hash: job.hash, file: null });
    expect((await entryOf(entry.id))?.receiptPdf).toEqual({ state: 'failed' });
    expect((await download(entry.id)).status).toBe(404);
    const again = await renderAgain(entry.id, cast.am.cookie);
    expect(quotePdfRenderSchema.parse(await again.json())).toEqual({ state: 'pending' });
    expect(lastJob()).toEqual(job);
    await client.post(`/api/ad-wallet-entries/${entry.id}/void`, cast.finance.cookie, {
      reason: 'خطأ',
    });
    await work(lastJob());
    const row = await rowOf(entry.id);
    expect(row.receiptPdfStatus).toBe('ready');
    const [item] = await entryDocuments(entry.id);
    expect(item?.id).toBe(row.receiptFileItemId);
    expect(item?.archivedAt).not.toBeNull();
  });

  it("drops a result that is not the deposit's current payload", async () => {
    const entry = newest(await record({ amountMinor: 4_000 }));
    const stale = { ...lastJob(), hash: 'f'.repeat(64) };
    const path = await work(stale);
    expect(await exists(path)).toBe(false);
    expect(await entryDocuments(entry.id)).toEqual([]);
    expect((await rowOf(entry.id)).receiptPdfStatus).toBe('pending');
  });

  it('a deposit recorded before receipts were rendered has none', async () => {
    const entry = newest(await record({ amountMinor: 5_000 }));
    await db
      .update(adWalletEntries)
      .set({ receiptSnapshot: null, receiptPdfStatus: null })
      .where(eq(adWalletEntries.id, entry.id));
    expect((await entryOf(entry.id))?.receiptPdf).toBeNull();
    expect((await renderAgain(entry.id)).status).toBe(404);
    expect((await download(entry.id)).status).toBe(404);
  });
});
