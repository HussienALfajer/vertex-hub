import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  type CatalogService,
  catalogServiceSchema,
  fileItemListSchema,
  fileItemPageSchema,
  QUOTES_PDF_JOB,
  type QuoteDetail,
  type QuotePdfJob,
  quoteDetailSchema,
  quotePdfJobSchema,
  quotePdfRenderSchema,
  quotePdfStorageKey,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, fileItems, quotes } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/core/jobs/index.js';
import { QuotePdfService } from '../src/modules/quotes/quote-pdf.service.js';
import { seedClientCast } from './client-cast.js';
import { api, clientIp, ORIGIN, removeCatalog } from './helpers.js';
import { startApp } from './start-app.js';

/*
 * F04 rules 12 and 13: the API side of quote PDFs. The worker's render is played by writing the
 * bytes where it would and calling the `quotes.pdf-ready` handler directly.
 */
describe('quote PDFs', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let designManager: { id: string; cookie: string };
  let filesRoot: string;
  let clientId: string;
  let brand: CatalogService;
  let pdf: QuotePdfService;
  const queued: QuotePdfJob[] = [];

  async function createQuote(cookie = cast.am.cookie) {
    const created = await client.post('/api/quotes', cookie, {
      clientId,
      title: `عرض ${cast.run} ${randomUUID().slice(0, 6)}`,
    });
    expect(created.status).toBe(201);
    const quote = quoteDetailSchema.parse(await created.json());
    return save(quote, 80000);
  }

  async function save(quote: QuoteDetail, unitPriceMinor: number) {
    const response = await client.request('PUT', `/api/quotes/${quote.id}`, {
      cookie: cast.am.cookie,
      body: {
        updatedAt: quote.updatedAt,
        contactId: null,
        title: quote.title,
        currency: quote.currency,
        validityDays: quote.validityDays,
        oneOffDiscountMinor: 0,
        monthlyDiscountMinor: 0,
        monthlyTermMonths: null,
        clientNotes: null,
        terms: quote.terms,
        lines: [
          {
            section: 'one_off',
            serviceId: brand.id,
            quantity: 1,
            unitPriceMinor,
            revisionRounds: 3,
          },
        ],
        installments: [{ name: 'كامل المبلغ', percent: 100 }],
      },
    });
    expect(response.status).toBe(200);
    return quoteDetailSchema.parse(await response.json());
  }

  async function detail(id: string, cookie = cast.am.cookie) {
    const response = await client.get(`/api/quotes/${id}`, cookie);
    expect(response.status).toBe(200);
    return quoteDetailSchema.parse(await response.json());
  }

  async function send(quote: QuoteDetail) {
    const response = await client.post(`/api/quotes/${quote.id}/send`, cast.am.cookie, {});
    expect(response.status).toBe(200);
    return quoteDetailSchema.parse(await response.json());
  }

  async function renderPdf(id: string, cookie = cast.am.cookie) {
    return client.post(`/api/quotes/${id}/pdf`, cookie, {});
  }

  /** What the worker does for a queued render: writes the bytes, then reports them. */
  async function work(job: QuotePdfJob, bytes = Buffer.from(`%PDF-1.7 ${job.hash}`)) {
    const storageKey = quotePdfStorageKey(job);
    const path = join(filesRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const file = {
      storageKey,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    await pdf.ready({ quoteId: job.quoteId, draft: job.draft, hash: job.hash, file });
    return path;
  }

  const lastJob = () => {
    const job = queued.at(-1);
    if (!job) throw new Error('No render was queued');
    return job;
  };

  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  const quoteItems = (quoteId: string) =>
    db.select().from(fileItems).where(eq(fileItems.quoteId, quoteId));

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-quote-pdf-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    pdf = app.get(QuotePdfService);
    vi.spyOn(app.get(JobQueue), 'send').mockImplementation(async (queue, data, options) => {
      expect(queue).toBe(QUOTES_PDF_JOB.queue);
      expect(options).toEqual({ retryLimit: QUOTES_PDF_JOB.retryLimit });
      queued.push(quotePdfJobSchema.parse(data));
    });
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    designManager = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'design', manager: true }],
    });
    cast.trackUser(designManager.id);
    clientId = (await cast.createClient()).id;
    const service = await client.post('/api/catalog/services', cast.gm.cookie, {
      name: `هوية ${cast.run}`,
      department: 'design',
      billing: 'one_off',
      priceUsdMinor: 80000,
    });
    expect(service.status).toBe(201);
    brand = catalogServiceSchema.parse(await service.json());
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    const items = clientId
      ? await db
          .select({ id: fileItems.id })
          .from(fileItems)
          .where(eq(fileItems.clientId, clientId))
      : [];
    for (const { id } of items) await db.delete(auditEntries).where(eq(auditEntries.entityId, id));
    await cast?.cleanup();
    if (brand) await removeCatalog(db, [brand.id], []);
    await connection.close();
    delete process.env.FILES_ROOT;
    await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.post(`/api/quotes/${id}/pdf`, undefined, {})).status).toBe(401);
    expect((await client.get(`/api/quotes/${id}/pdf`)).status).toBe(401);
  });

  describe('a sent version', () => {
    let quote: QuoteDetail;
    let path: string;

    it('queues its frozen snapshot when sent (rule 12)', async () => {
      quote = await send(await createQuote());
      expect(quote.pdf).toEqual({ state: 'pending' });
      expect(quote.draftPdf).toBeNull();
      const job = lastJob();
      expect(job).toMatchObject({ quoteId: quote.id, draft: false });
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(job.snapshot).toEqual(row?.snapshot);
      // Rule 14: the payload holds no list prices.
      expect(JSON.stringify(job.snapshot)).not.toContain('listUnitPrice');
    });

    it('is not served before it is ready', async () => {
      expect((await client.get(`/api/quotes/${quote.id}/pdf`, cast.am.cookie)).status).toBe(404);
    });

    it('is attached once as a document of the quote, however often the result comes', async () => {
      const job = lastJob();
      queued.length = 0;
      path = await work(job);
      await work(job);
      const items = await quoteItems(quote.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        ownerType: 'quote',
        role: 'document',
        clientId,
        name: `${quote.displayNumber} v1.pdf`,
      });
      const after = await detail(quote.id);
      expect(after.pdf).toEqual({ state: 'ready' });
      expect(after.permissions.canRenderPdf).toBe(false);
      const [audit] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, items[0]?.id ?? ''),
            eq(auditEntries.action, 'file_item.created'),
          ),
        );
      expect(audit).toMatchObject({ actorId: null });
    });

    it('is downloaded by quote readers only', async () => {
      for (const cookie of [cast.am.cookie, finance.cookie]) {
        const response = await client.get(`/api/quotes/${quote.id}/pdf`, cookie);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/pdf');
        expect(response.headers.get('content-disposition')).toContain('inline');
        expect((await response.arrayBuffer()).byteLength).toBe((await stat(path)).size);
      }
      expect((await client.get(`/api/quotes/${quote.id}/pdf`, cast.employee.cookie)).status).toBe(
        403,
      );
      expect((await client.get(`/api/quotes/${quote.id}/pdf`, cast.otherAm.cookie)).status).toBe(
        404,
      );
    });

    it('lists among the client documents for quote readers only (F10)', async () => {
      const documents = async (cookie: string) => {
        const response = await client.get(`/api/files/documents?clientId=${clientId}`, cookie);
        if (response.status !== 200) return [];
        return fileItemPageSchema.parse(await response.json()).items;
      };
      expect(await documents(cast.am.cookie)).toEqual([
        expect.objectContaining({
          name: `${quote.displayNumber} v1.pdf`,
          owner: { type: 'quote', id: quote.id, label: quote.displayNumber },
        }),
      ]);
      expect(await documents(designManager.cookie)).toEqual([]);
    });

    it('is read through the quote owner policy (F10)', async () => {
      const list = (cookie: string) =>
        client.get(`/api/files/items?ownerType=quote&ownerId=${quote.id}`, cookie);
      const response = await list(finance.cookie);
      expect(response.status).toBe(200);
      const { items } = fileItemListSchema.parse(await response.json());
      expect(items.map((item) => item.name)).toEqual([`${quote.displayNumber} v1.pdf`]);
      expect((await list(cast.otherAm.cookie)).status).toBe(404);
    });

    it('stays as sent: nobody changes quote documents through the file endpoints', async () => {
      const [item] = await quoteItems(quote.id);
      const id = item?.id ?? '';
      const upload = new FormData();
      upload.append('file', new Blob(['%PDF-1.7 other'], { type: 'application/pdf' }), 'x.pdf');
      const uploaded = await fetch(`${url}/api/files/uploads`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie: cast.am.cookie },
        body: upload,
      });
      expect(uploaded.status).toBe(201);
      const { uploadId } = (await uploaded.json()) as { uploadId: string };
      for (const cookie of [cast.am.cookie, cast.gm.cookie]) {
        const rename = await client.request('PATCH', `/api/files/items/${id}`, {
          cookie,
          body: { name: 'other.pdf' },
        });
        expect(rename.status).toBe(403);
        const version = await client.post(`/api/files/items/${id}/versions`, cookie, {
          source: { uploadId },
        });
        expect(version.status).toBe(403);
        expect((await client.post(`/api/files/items/${id}/archive`, cookie)).status).toBe(403);
        const added = await client.post('/api/files/items', cookie, {
          ownerType: 'quote',
          ownerId: quote.id,
          role: 'document',
          source: { uploadId },
        });
        expect(added.status).toBe(403);
      }
      expect(await quoteItems(quote.id)).toEqual([item]);
    });

    it('records a failure, and "Render again" queues it for any reader', async () => {
      const other = await send(await createQuote());
      const job = lastJob();
      await pdf.ready({ quoteId: other.id, draft: false, hash: job.hash, file: null });
      const failed = await detail(other.id, finance.cookie);
      expect(failed.pdf).toEqual({ state: 'failed' });
      expect(failed.permissions.canRenderPdf).toBe(true);
      queued.length = 0;
      const response = await renderPdf(other.id, finance.cookie);
      expect(response.status).toBe(200);
      expect(quotePdfRenderSchema.parse(await response.json())).toEqual({ state: 'pending' });
      expect(lastJob()).toEqual(job);
      expect((await renderPdf(other.id, cast.otherAm.cookie)).status).toBe(404);
      expect((await renderPdf(other.id, cast.employee.cookie)).status).toBe(403);
    });

    it('answers ready without rendering again once attached', async () => {
      queued.length = 0;
      const response = await renderPdf(quote.id, finance.cookie);
      expect(quotePdfRenderSchema.parse(await response.json())).toEqual({ state: 'ready' });
      expect(queued).toEqual([]);
    });

    it('ignores and deletes a result of another payload', async () => {
      const other = await send(await createQuote());
      const job = { ...lastJob(), hash: 'f'.repeat(64) };
      const stray = await work(job);
      expect(await quoteItems(other.id)).toEqual([]);
      expect(await exists(stray)).toBe(false);
      expect((await detail(other.id)).pdf).toEqual({ state: 'pending' });
    });

    it('is queued again by the daily run while pending (edge case 13)', async () => {
      const other = await send(await createQuote());
      queued.length = 0;
      expect(await pdf.requeuePending()).toBeGreaterThanOrEqual(1);
      expect(queued.map((job) => job.quoteId)).toContain(other.id);
    });
  });

  describe('a draft preview (rule 13)', () => {
    let draft: QuoteDetail;
    let firstPath: string;

    it('is asked for by client-scope holders only', async () => {
      draft = await createQuote();
      expect((await renderPdf(draft.id, finance.cookie)).status).toBe(403);
      expect((await renderPdf(draft.id, cast.otherAm.cookie)).status).toBe(404);
      const response = await renderPdf(draft.id);
      expect(quotePdfRenderSchema.parse(await response.json())).toEqual({ state: 'pending' });
      expect(lastJob()).toMatchObject({ quoteId: draft.id, draft: true });
      expect((await detail(draft.id)).draftPdf).toEqual({
        state: 'pending',
        renderedAt: null,
        outdated: false,
      });
    });

    it('is kept and served once rendered, without changing the draft', async () => {
      firstPath = await work(lastJob());
      const after = await detail(draft.id);
      expect(after.draftPdf).toMatchObject({ state: 'ready', outdated: false });
      expect(after.updatedAt).toBe(draft.updatedAt);
      const response = await client.get(`/api/quotes/${draft.id}/pdf?draft=true`, finance.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect((await client.get(`/api/quotes/${draft.id}/pdf`, cast.am.cookie)).status).toBe(404);
      queued.length = 0;
      expect(quotePdfRenderSchema.parse(await (await renderPdf(draft.id)).json())).toEqual({
        state: 'ready',
      });
      expect(queued).toEqual([]);
    });

    it('shows as outdated once the draft changes, and is replaced by the next one', async () => {
      draft = await save(await detail(draft.id), 85000);
      expect(draft.draftPdf).toMatchObject({ state: 'ready', outdated: true });
      await renderPdf(draft.id);
      const second = lastJob();
      const secondPath = await work(second);
      expect(await exists(firstPath)).toBe(false);
      expect((await detail(draft.id)).draftPdf).toMatchObject({ state: 'ready', outdated: false });
      firstPath = secondPath;
    });

    it('drops a result nobody waits for', async () => {
      const stale = await work({ ...lastJob(), hash: 'e'.repeat(64) });
      expect(await exists(stale)).toBe(false);
      expect(await exists(firstPath)).toBe(true);
    });

    it('is discarded when the draft is sent', async () => {
      const sent = await send(draft);
      expect(sent.draftPdf).toBeNull();
      expect(await exists(firstPath)).toBe(false);
      expect(
        (await client.get(`/api/quotes/${draft.id}/pdf?draft=true`, cast.am.cookie)).status,
      ).toBe(404);
    });

    it('is discarded when the draft is archived', async () => {
      const other = await createQuote();
      await renderPdf(other.id);
      const path = await work(lastJob());
      const response = await client.post(`/api/quotes/${other.id}/archive`, cast.am.cookie, {});
      expect(response.status).toBe(204);
      expect(await exists(path)).toBe(false);
      const [row] = await db.select().from(quotes).where(eq(quotes.id, other.id));
      expect(row).toMatchObject({ draftPdfStatus: null, draftPdfObjectKey: null });
      expect((await renderPdf(other.id, cast.gm.cookie)).status).toBe(409);
    });
  });
});
