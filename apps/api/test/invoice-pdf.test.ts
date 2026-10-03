import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  INVOICES_PDF_JOB,
  type InvoiceDetail,
  type InvoiceDraftInput,
  type InvoicePdfJob,
  invoiceDetailSchema,
  invoicePdfJobSchema,
  invoicePdfStorageKey,
  quotePdfRenderSchema,
} from '@vertex-hub/contracts';
import {
  createDatabase,
  fileItems,
  fileVersions,
  invoiceSettings,
  invoices,
  payments,
  statementPdfs,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/core/jobs/index.js';
import { FilePurges } from '../src/modules/files/index.js';
import { InvoicePdfService } from '../src/modules/invoices/invoice-pdf.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

/*
 * F13 rules 13, 15, 20, 22 and 29: the API side of invoice, draft, receipt and statement PDFs.
 * The worker's render is played by writing the bytes where it would and calling the
 * `invoices.pdf-ready` handler directly.
 */
describe('invoice PDFs', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let filesRoot: string;
  let clientId: string;
  let pdf: InvoicePdfService;
  const queued: InvoicePdfJob[] = [];
  const today = businessDate();

  async function ok(response: Response, status = 200): Promise<InvoiceDetail> {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return invoiceDetailSchema.parse(await response.json());
  }

  async function draftInvoice(amount = 50_000): Promise<InvoiceDetail> {
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, { clientId, currency: 'USD' }),
      201,
    );
    return save(draft, amount);
  }

  async function save(draft: InvoiceDetail, amount: number): Promise<InvoiceDetail> {
    const body: InvoiceDraftInput = {
      updatedAt: draft.updatedAt,
      projectId: null,
      retainerId: null,
      paymentTermsDays: 7,
      notes: 'شكراً لكم',
      lines: [{ description: 'هوية بصرية', quantity: 1, unitPriceMinor: amount }],
    };
    return ok(
      await client.request('PUT', `/api/invoices/${draft.id}`, { cookie: finance.cookie, body }),
    );
  }

  async function issue(draft: InvoiceDetail): Promise<InvoiceDetail> {
    return ok(
      await client.post(`/api/invoices/${draft.id}/issue`, finance.cookie, {
        updatedAt: draft.updatedAt,
      }),
    );
  }

  async function detail(id: string, cookie = finance.cookie) {
    return ok(await client.get(`/api/invoices/${id}`, cookie));
  }

  const renderPdf = (id: string, cookie = finance.cookie) =>
    client.post(`/api/invoices/${id}/pdf`, cookie, {});

  /** What the worker does for a queued render: writes the bytes, then reports them. */
  async function work(job: InvoicePdfJob, bytes = Buffer.from(`%PDF-1.7 ${job.hash}`)) {
    const storageKey = invoicePdfStorageKey(job);
    const path = join(filesRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const file = {
      storageKey,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    await pdf.ready({ kind: job.kind, id: job.id, hash: job.hash, file });
    return path;
  }

  const lastJob = <K extends InvoicePdfJob['kind']>(kind: K) => {
    const job = queued
      .filter((item): item is Extract<InvoicePdfJob, { kind: K }> => item.kind === kind)
      .at(-1);
    if (!job) throw new Error(`No ${kind} render was queued`);
    return job;
  };

  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  const invoiceItems = (invoiceId: string) =>
    db.select().from(fileItems).where(eq(fileItems.invoiceId, invoiceId));

  const versionsOf = (itemId: string) =>
    db.select().from(fileVersions).where(eq(fileVersions.fileItemId, itemId));

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-invoice-pdf-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    pdf = app.get(InvoicePdfService);
    vi.spyOn(app.get(JobQueue), 'send').mockImplementation(async (queue, data, options) => {
      if (queue !== INVOICES_PDF_JOB.queue) return;
      expect(options).toEqual({ retryLimit: INVOICES_PDF_JOB.retryLimit });
      queued.push(invoicePdfJobSchema.parse(data));
    });
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    [savedSettings] = (await db.select().from(invoiceSettings)) as [
      typeof invoiceSettings.$inferSelect,
    ];
    await db.update(invoiceSettings).set({
      sypPerUsd: '118.5000',
      paymentTermsDays: 7,
      paymentDetails: 'حساب رقم 123',
      invoiceFooter: 'شكراً',
      rateUpdatedAt: new Date(),
    });
    clientId = (await cast.createClient()).id;
    const billing = await client.request('PATCH', `/api/clients/${clientId}`, {
      cookie: cast.gm.cookie,
      body: { billingName: 'شركة الاختبار', billingAddress: 'دمشق' },
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
    const query = '?currency=USD';
    expect((await client.post(`/api/invoices/${id}/pdf`, undefined, {})).status).toBe(401);
    expect((await client.get(`/api/invoices/${id}/pdf`)).status).toBe(401);
    expect((await client.post(`/api/payments/${id}/receipt`, undefined, {})).status).toBe(401);
    expect((await client.get(`/api/payments/${id}/receipt`)).status).toBe(401);
    expect(
      (await client.post(`/api/clients/${id}/statement/pdf${query}`, undefined, {})).status,
    ).toBe(401);
    expect((await client.get(`/api/clients/${id}/statement/pdf${query}`)).status).toBe(401);
  });

  describe('a draft preview', () => {
    let draft: InvoiceDetail;
    let path: string;

    it('is for managers only; readers get 403, others 404', async () => {
      draft = await draftInvoice();
      expect(draft.permissions.canRenderPdf).toBe(true);
      expect(draft.draftPdf).toBeNull();
      expect((await renderPdf(draft.id, cast.am.cookie)).status).toBe(403);
      expect((await renderPdf(draft.id, cast.employee.cookie)).status).toBe(403);
      expect((await renderPdf(draft.id, cast.otherAm.cookie)).status).toBe(404);
      expect((await renderPdf(randomUUID())).status).toBe(404);
      const read = await detail(draft.id, cast.am.cookie);
      expect(read.permissions.canRenderPdf).toBe(false);
    });

    it('renders without a number, then serves the preview', async () => {
      const response = await renderPdf(draft.id);
      expect(response.status).toBe(200);
      expect(quotePdfRenderSchema.parse(await response.json())).toEqual({ state: 'pending' });
      const job = lastJob('invoice_draft');
      expect(job).toMatchObject({ id: draft.id });
      expect(job.snapshot).toMatchObject({
        displayNumber: null,
        billingName: 'شركة الاختبار',
        billingAddress: 'دمشق',
        issuedOn: today,
        dueOn: addDays(today, 7),
        totalMinor: 50_000,
        paymentDetails: 'حساب رقم 123',
        footer: 'شكراً',
      });
      expect(
        (await client.get(`/api/invoices/${draft.id}/pdf?draft=true`, finance.cookie)).status,
      ).toBe(404);
      path = await work(job);
      const read = await detail(draft.id);
      expect(read.draftPdf).toMatchObject({ state: 'ready', outdated: false });
      // PDF state is not an edit: the draft is not stale.
      expect(read.updatedAt).toBe(draft.updatedAt);
      const served = await client.get(`/api/invoices/${draft.id}/pdf?draft=true`, cast.am.cookie);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('application/pdf');
      expect(await invoiceItems(draft.id)).toHaveLength(0);
    });

    it('is not rendered twice while the draft is unchanged, and outdated once it changes', async () => {
      const count = queued.length;
      const again = await renderPdf(draft.id);
      expect(quotePdfRenderSchema.parse(await again.json())).toEqual({ state: 'ready' });
      expect(queued).toHaveLength(count);
      draft = await save(await detail(draft.id), 60_000);
      expect(draft.draftPdf).toMatchObject({ state: 'ready', outdated: true });
    });

    it('goes when the draft is discarded; a discarded draft is not previewed', async () => {
      expect(await exists(path)).toBe(true);
      expect(
        (await client.post(`/api/invoices/${draft.id}/archive`, finance.cookie, {})).status,
      ).toBe(204);
      expect(await exists(path)).toBe(false);
      await expectError(await renderPdf(draft.id), 409, 'INVALID_TRANSITION');
      const [row] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
      expect(row?.draftPdfObjectKey).toBeNull();
    });
  });

  describe('an issued invoice', () => {
    let invoice: InvoiceDetail;
    let firstPath: string;

    it('queues its frozen snapshot on issue and drops the preview (rule 15)', async () => {
      const draft = await draftInvoice();
      await renderPdf(draft.id);
      const previewPath = await work(lastJob('invoice_draft'));
      invoice = await issue(await detail(draft.id));
      expect(invoice.pdf).toEqual({ state: 'pending' });
      expect(invoice.draftPdf).toBeNull();
      expect(await exists(previewPath)).toBe(false);
      const job = lastJob('invoice');
      const [row] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
      expect(job).toMatchObject({ id: invoice.id });
      expect(job.snapshot).toEqual(row?.snapshot);
      expect(job.snapshot.displayNumber).toBe(invoice.displayNumber);
    });

    it('attaches the PDF once as a document of the invoice', async () => {
      const job = lastJob('invoice');
      firstPath = await work(job);
      await work(job);
      const items = await invoiceItems(invoice.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ name: `${invoice.displayNumber}.pdf`, role: 'document' });
      expect(await versionsOf(items[0]?.id ?? '')).toHaveLength(1);
      const read = await detail(invoice.id);
      expect(read.pdf).toEqual({ state: 'ready' });
      expect(read.permissions.canRenderPdf).toBe(false);
    });

    it('serves the PDF to readers of the client only', async () => {
      const served = await client.get(`/api/invoices/${invoice.id}/pdf`, cast.am.cookie);
      expect(served.status).toBe(200);
      expect(decodeURIComponent(served.headers.get('content-disposition') ?? '')).toContain(
        `${invoice.displayNumber}.pdf`,
      );
      expect(
        (await client.get(`/api/invoices/${invoice.id}/pdf`, cast.otherAm.cookie)).status,
      ).toBe(404);
      expect(
        (await client.get(`/api/invoices/${invoice.id}/pdf`, cast.employee.cookie)).status,
      ).toBe(403);
      // An issued invoice has no preview.
      expect(
        (await client.get(`/api/invoices/${invoice.id}/pdf?draft=true`, finance.cookie)).status,
      ).toBe(404);
    });

    it('renders again as the next version when the due date changes (rule 13)', async () => {
      const first = lastJob('invoice');
      const changed = await ok(
        await client.post(`/api/invoices/${invoice.id}/due-date`, finance.cookie, {
          dueOn: addDays(today, 30),
          reason: 'طلب العميل',
        }),
      );
      expect(changed.pdf).toEqual({ state: 'pending' });
      const job = lastJob('invoice');
      expect(job.hash).not.toBe(first.hash);
      expect(job.snapshot.dueOn).toBe(addDays(today, 30));
      // The earlier render arriving late is not this invoice's PDF, and its object stays held.
      await work(first);
      expect(await exists(firstPath)).toBe(true);
      expect((await detail(invoice.id)).pdf).toEqual({ state: 'pending' });
      await work(job);
      await work(job);
      const [item] = await invoiceItems(invoice.id);
      const versions = await versionsOf(item?.id ?? '');
      expect(versions.map((version) => version.number).sort()).toEqual([1, 2]);
      expect((await detail(invoice.id)).pdf).toEqual({ state: 'ready' });
    });

    it('records a failure, renders again on request, and is queued again daily (edge case 12)', async () => {
      const other = await issue(await draftInvoice(20_000));
      const job = lastJob('invoice');
      await pdf.ready({ kind: 'invoice', id: other.id, hash: job.hash, file: null });
      const failed = await detail(other.id, cast.am.cookie);
      expect(failed.pdf).toEqual({ state: 'failed' });
      expect(failed.permissions.canRenderPdf).toBe(true);
      expect((await client.get(`/api/invoices/${other.id}/pdf`, finance.cookie)).status).toBe(404);
      // Any reader renders it again.
      const again = await renderPdf(other.id, cast.am.cookie);
      expect(quotePdfRenderSchema.parse(await again.json())).toEqual({ state: 'pending' });
      expect(lastJob('invoice').hash).toBe(job.hash);
      const count = queued.length;
      expect(await pdf.requeuePending()).toBeGreaterThanOrEqual(1);
      expect(queued.slice(count).some((item) => item.id === other.id)).toBe(true);
    });
  });

  describe('a receipt', () => {
    let invoice: InvoiceDetail;

    it('is queued when a payment is recorded, with the balance after it (rule 20)', async () => {
      invoice = await issue(await draftInvoice(10_000));
      await work(lastJob('invoice'));
      const paid = await ok(
        await client.post(`/api/invoices/${invoice.id}/payments`, finance.cookie, {
          paidOn: today,
          amountMinor: 4_000,
          currency: 'USD',
          method: 'bank_transfer',
          reference: 'TR-1',
        }),
        201,
      );
      const payment = paid.payments[0];
      expect(payment?.receiptPdf).toEqual({ state: 'pending' });
      const job = lastJob('receipt');
      expect(job).toMatchObject({ id: payment?.id });
      expect(job.snapshot).toMatchObject({
        displayNumber: payment?.receiptNumber,
        invoiceNumber: invoice.displayNumber,
        amountMinor: 4_000,
        currency: 'USD',
        method: 'bank_transfer',
        reference: 'TR-1',
        appliedMinor: 4_000,
        balanceAfterMinor: 6_000,
        billingName: 'شركة الاختبار',
      });
    });

    it('is attached once as a document of the invoice and served to readers', async () => {
      const job = lastJob('receipt');
      await work(job);
      await work(job);
      const read = await detail(invoice.id, cast.am.cookie);
      const payment = read.payments[0];
      expect(payment?.receiptPdf).toEqual({ state: 'ready' });
      const items = await invoiceItems(invoice.id);
      expect(items.map((item) => item.name).sort()).toEqual(
        [`${invoice.displayNumber}.pdf`, `${payment?.receiptNumber}.pdf`].sort(),
      );
      const served = await client.get(`/api/payments/${payment?.id}/receipt`, cast.am.cookie);
      expect(served.status).toBe(200);
      expect(
        (await client.get(`/api/payments/${payment?.id}/receipt`, cast.otherAm.cookie)).status,
      ).toBe(404);
      expect(
        (await client.get(`/api/payments/${payment?.id}/receipt`, cast.employee.cookie)).status,
      ).toBe(403);
      expect(
        (await client.get(`/api/payments/${randomUUID()}/receipt`, finance.cookie)).status,
      ).toBe(404);
      const receipt = (cookie: string, id = payment?.id) =>
        client.post(`/api/payments/${id}/receipt`, cookie, {});
      expect((await receipt(cast.employee.cookie)).status).toBe(403);
      expect((await receipt(cast.otherAm.cookie)).status).toBe(404);
      expect((await receipt(finance.cookie, randomUUID())).status).toBe(404);
      const ready = await client.post(`/api/payments/${payment?.id}/receipt`, cast.am.cookie, {});
      expect(quotePdfRenderSchema.parse(await ready.json())).toEqual({ state: 'ready' });
    });

    it('is archived with its payment (rule 22)', async () => {
      const payment = (await detail(invoice.id)).payments[0];
      expect(
        (await client.post(`/api/payments/${payment?.id}/void`, finance.cookie, { reason: 'خطأ' }))
          .status,
      ).toBe(200);
      const [row] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, payment?.id ?? ''));
      const [item] = await db
        .select()
        .from(fileItems)
        .where(eq(fileItems.id, row?.receiptFileItemId ?? ''));
      expect(item?.archivedAt).not.toBeNull();
      expect(
        (await client.get(`/api/payments/${payment?.id}/receipt`, finance.cookie)).status,
      ).toBe(404);
    });

    it('rendered after its payment was voided is attached archived; a failure renders again', async () => {
      const paid = await ok(
        await client.post(`/api/invoices/${invoice.id}/payments`, finance.cookie, {
          paidOn: today,
          amountMinor: 1_000,
          currency: 'USD',
          method: 'cash',
        }),
        201,
      );
      const payment = paid.payments.find((item) => !item.voided);
      const job = lastJob('receipt');
      await pdf.ready({ kind: 'receipt', id: job.id, hash: job.hash, file: null });
      expect(
        (await detail(invoice.id)).payments.find((item) => item.id === payment?.id)?.receiptPdf,
      ).toEqual({ state: 'failed' });
      const again = await client.post(`/api/payments/${payment?.id}/receipt`, cast.am.cookie, {});
      expect(quotePdfRenderSchema.parse(await again.json())).toEqual({ state: 'pending' });
      await client.post(`/api/payments/${payment?.id}/void`, finance.cookie, { reason: 'خطأ' });
      await work(lastJob('receipt'));
      const [row] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, payment?.id ?? ''));
      expect(row?.receiptPdfStatus).toBe('ready');
      const live = await db
        .select()
        .from(fileItems)
        .where(and(eq(fileItems.id, row?.receiptFileItemId ?? ''), isNull(fileItems.archivedAt)));
      expect(live).toHaveLength(0);
    });
  });

  describe('a statement', () => {
    const query = () => `?currency=USD&from=${today.slice(0, 4)}-01-01&to=${today}`;
    const statementPdf = (cookie = finance.cookie, id = clientId) =>
      client.post(`/api/clients/${id}/statement/pdf${query()}`, cookie, {});
    let path: string;

    it('renders the statement as it is now for readers of the client (rule 29)', async () => {
      expect((await statementPdf(cast.otherAm.cookie)).status).toBe(404);
      expect((await statementPdf(cast.employee.cookie)).status).toBe(403);
      expect((await statementPdf(finance.cookie, randomUUID())).status).toBe(404);
      await expectError(
        await client.post(
          `/api/clients/${clientId}/statement/pdf?currency=USD&from=${today}&to=${addDays(today, -1)}`,
          finance.cookie,
          {},
        ),
        400,
        'INVALID_DATES',
      );
      const response = await statementPdf(cast.am.cookie);
      expect(response.status).toBe(200);
      expect(quotePdfRenderSchema.parse(await response.json())).toEqual({ state: 'pending' });
      const job = lastJob('statement');
      expect(job.snapshot).toMatchObject({
        client: { id: clientId },
        billingName: 'شركة الاختبار',
        currency: 'USD',
      });
      expect(job.snapshot.rows.length).toBeGreaterThan(0);
      expect(
        (await client.get(`/api/clients/${clientId}/statement/pdf${query()}`, finance.cookie))
          .status,
      ).toBe(404);
      path = await work(job);
      const served = await client.get(
        `/api/clients/${clientId}/statement/pdf${query()}`,
        cast.am.cookie,
      );
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('application/pdf');
      // The statement section asks with `HEAD` whether the render is ready.
      const checked = await client.request(
        'HEAD',
        `/api/clients/${clientId}/statement/pdf${query()}`,
        { cookie: cast.am.cookie },
      );
      expect(checked.status).toBe(200);
      expect(
        (await client.get(`/api/clients/${clientId}/statement/pdf${query()}`, cast.otherAm.cookie))
          .status,
      ).toBe(404);
      expect(
        (await client.get(`/api/clients/${clientId}/statement/pdf${query()}`, cast.employee.cookie))
          .status,
      ).toBe(403);
      // Not a document of anything.
      expect(
        await db
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.storageKey, invoicePdfStorageKey(job))),
      ).toHaveLength(0);
    });

    it('reuses a ready render of the same statement and renders a changed one anew', async () => {
      const count = queued.length;
      const again = await statementPdf();
      expect(quotePdfRenderSchema.parse(await again.json())).toEqual({ state: 'ready' });
      expect(queued).toHaveLength(count);
      // A new invoice changes the statement: the ready PDF is no longer the statement as it is.
      await issue(await draftInvoice(1_000));
      expect(
        (await client.get(`/api/clients/${clientId}/statement/pdf${query()}`, finance.cookie))
          .status,
      ).toBe(404);
      const changed = await statementPdf();
      expect(quotePdfRenderSchema.parse(await changed.json())).toEqual({ state: 'pending' });
      await work(lastJob('statement'));
    });

    it('is downloadable for 24 hours, then purged with its object by the files purge', async () => {
      await db
        .update(statementPdfs)
        .set({ requestedAt: new Date(Date.now() - 25 * 3600 * 1000) })
        .where(eq(statementPdfs.clientId, clientId));
      expect(
        (await client.get(`/api/clients/${clientId}/statement/pdf${query()}`, finance.cookie))
          .status,
      ).toBe(404);
      const purged = await app.get(FilePurges).run();
      expect(purged.get('statement PDFs')).toBeGreaterThanOrEqual(2);
      expect(
        await db.select().from(statementPdfs).where(eq(statementPdfs.clientId, clientId)),
      ).toHaveLength(0);
      expect(await exists(path)).toBe(false);
    });
  });
});
