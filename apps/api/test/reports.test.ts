import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  catalogPackageSchema,
  catalogServiceSchema,
  type InvoiceDetail,
  invoiceDetailSchema,
  overdueInvoicesReportSchema,
  type ProductivityReport,
  productivityReportSchema,
  type RevenueReport,
  revenueReportSchema,
  toUsdMinor,
} from '@vertex-hub/contracts';
import {
  createDatabase,
  departmentMembers,
  invoiceLines,
  invoiceSettings,
  invoices,
  payments,
  quoteLines,
  quotes,
  retainerCharges,
  taskRevisions,
  tasks,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api, removeCatalog } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

/** Every endpoint answers well within this on seeded data (edge case 14). */
const TIME_BUDGET_MS = 2000;

/** A period long past, so only this file's rows fall in it. */
const PRODUCTIVITY = { from: '2001-02-01', to: '2001-02-28' };
const REVENUE = { from: '2001-03-01', to: '2001-03-31' };

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbookOf(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain(XLSX);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
}

/** A sheet's rows as plain values, the header first. */
const rowsOf = (sheet: ExcelJS.Worksheet | undefined) => {
  const rows: unknown[][] = [];
  sheet?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
};

describe('reports (F15 rules 8–16)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;
  let finance: { id: string; cookie: string };
  let savedRate: string | null = null;
  const serviceIds: string[] = [];
  const packageIds: string[] = [];
  const quoteIds: string[] = [];
  const today = businessDate();

  async function getOk<T>(path: string, cookie: string, schema: { parse: (v: unknown) => T }) {
    const started = performance.now();
    const response = await client.get(path, cookie);
    const elapsed = performance.now() - started;
    if (response.status !== 200) {
      throw new Error(`${path}: ${response.status} ${await response.text()}`);
    }
    expect(elapsed, path).toBeLessThan(TIME_BUDGET_MS);
    return schema.parse(await response.json());
  }

  const query = (period: { from: string; to: string }, extra = '') =>
    `?from=${period.from}&to=${period.to}${extra}`;

  async function invoiceOk(response: Response, status = 200): Promise<InvoiceDetail> {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return invoiceDetailSchema.parse(await response.json());
  }

  /** An issued invoice of `clientId` with its lines, dated `issuedOn`. */
  async function issuedInvoice(
    clientId: string,
    currency: 'USD' | 'SYP',
    lines: { unitPriceMinor: number; serviceId?: string | null }[],
    issuedOn: string,
  ) {
    const draft = await invoiceOk(
      await client.post('/api/invoices', finance.cookie, { clientId, currency }),
      201,
    );
    const saved = await invoiceOk(
      await client.request('PUT', `/api/invoices/${draft.id}`, {
        cookie: finance.cookie,
        body: {
          updatedAt: draft.updatedAt,
          projectId: null,
          retainerId: null,
          paymentTermsDays: 7,
          notes: null,
          lines: lines.map((line) => ({ description: 'خدمة', quantity: 1, ...line })),
        },
      }),
    );
    const issued = await invoiceOk(
      await client.post(`/api/invoices/${saved.id}/issue`, finance.cookie, {
        updatedAt: saved.updatedAt,
      }),
    );
    await db
      .update(invoices)
      .set({ issuedOn, dueOn: addDays(issuedOn, 7) })
      .where(eq(invoices.id, issued.id));
    return issued;
  }

  async function pay(invoiceId: string, paidOn: string, amountMinor: number) {
    const response = await client.post(`/api/invoices/${invoiceId}/payments`, finance.cookie, {
      paidOn: today,
      amountMinor,
      currency: 'USD',
      sypPerUsd: '13000',
      method: 'cash',
    });
    expect(response.status).toBe(201);
    const [row] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId))
      .orderBy(payments.createdAt);
    await db.update(payments).set({ paidOn }).where(eq(payments.invoiceId, invoiceId));
    return row?.id ?? '';
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    const [settings] = await db.select().from(invoiceSettings);
    savedRate = settings?.sypPerUsd ?? null;
    await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000', rateUpdatedAt: new Date() });
  });

  afterAll(async () => {
    await app?.close();
    await db.update(invoiceSettings).set({ sypPerUsd: savedRate });
    if (quoteIds.length) {
      await db.delete(quoteLines).where(inArray(quoteLines.quoteId, quoteIds));
      await db.delete(quotes).where(inArray(quotes.id, quoteIds));
    }
    await cast?.cleanup();
    await removeCatalog(db, serviceIds, packageIds);
    await connection.close();
  });

  it('requires a session', async () => {
    for (const path of [
      'productivity',
      'productivity/export',
      'revenue',
      'revenue/export',
      'overdue-invoices',
      'overdue-invoices/export',
    ]) {
      expect((await client.get(`/api/reports/${path}`)).status, path).toBe(401);
    }
  });

  it('opens each report only to the roles that read it (rule 23)', async () => {
    const status = async (path: string, cookie: string) =>
      (await client.get(`/api/reports/${path}`, cookie)).status;
    const { gm, operations, am, employee, designManager } = cast;
    for (const cookie of [gm.cookie, operations.cookie, designManager.cookie]) {
      expect(await status('productivity', cookie)).toBe(200);
    }
    // Finance holds no `reports.read`; an account manager's scope has no department.
    for (const cookie of [finance.cookie, am.cookie, employee.cookie]) {
      expect(await status('productivity', cookie)).toBe(403);
      expect(await status('productivity/export', cookie)).toBe(403);
    }
    for (const path of ['revenue', 'overdue-invoices']) {
      for (const cookie of [gm.cookie, operations.cookie, finance.cookie]) {
        expect(await status(path, cookie), path).toBe(200);
      }
      for (const cookie of [designManager.cookie, am.cookie, employee.cookie]) {
        expect(await status(path, cookie), path).toBe(403);
        expect(await status(`${path}/export`, cookie), path).toBe(403);
      }
    }
  });

  it('refuses a period ending before it starts or longer than 366 days (rules 8 and 11)', async () => {
    for (const path of ['productivity', 'revenue']) {
      await expectError(
        await client.get(`/api/reports/${path}?from=2026-02-02&to=2026-02-01`, cast.gm.cookie),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await client.get(`/api/reports/${path}?from=2025-01-01&to=2026-01-02`, cast.gm.cookie),
        400,
        'INVALID_DATES',
      );
    }
    expect(
      (await client.get('/api/reports/revenue?from=2025-01-01&to=2026-01-01', cast.gm.cookie))
        .status,
    ).toBe(200);
  });

  describe('department productivity (rules 8–10)', () => {
    let report: ProductivityReport;
    let leaver: { id: string; name: string };

    beforeAll(async () => {
      const clientId = (await cast.createClient()).id;
      const at = (instant: string) => new Date(instant);
      // On time (end of the due date in Damascus), started on the 5th: 3 days.
      const onTime = await cast.taskAt('delivered', { clientId, needsClientApproval: false });
      await db
        .update(tasks)
        .set({
          createdAt: at('2001-02-03T10:00:00Z'),
          startedAt: at('2001-02-05T10:00:00Z'),
          deliveredAt: at('2001-02-08T10:00:00Z'),
          dueDate: '2001-02-08',
          dueTime: null,
        })
        .where(eq(tasks.id, onTime.id));
      // Late, never started: 9 days from creation.
      const late = await cast.taskAt('delivered', { clientId, needsClientApproval: false });
      await db
        .update(tasks)
        .set({
          createdAt: at('2001-02-03T10:00:00Z'),
          startedAt: null,
          deliveredAt: at('2001-02-12T10:00:00Z'),
          dueDate: '2001-02-10',
          dueTime: null,
        })
        .where(eq(tasks.id, late.id));
      await db.insert(taskRevisions).values([
        { taskId: onTime.id, source: 'client', number: 1, note: 'أ' },
        { taskId: onTime.id, source: 'client', number: 2, note: 'ب' },
        { taskId: onTime.id, source: 'internal', note: 'ج', authorId: cast.designManager.id },
        { taskId: late.id, source: 'medical', note: 'د', authorId: cast.designManager.id },
      ]);
      // Reopened after delivery (edge case 4): its old delivery does not count.
      const reopened = await cast.taskAt('in_progress', { clientId, needsClientApproval: false });
      await db
        .update(tasks)
        .set({ deliveredAt: at('2001-02-09T10:00:00Z') })
        .where(eq(tasks.id, reopened.id));
      // Overdue now, created today.
      const overdue = await cast.createTask(cast.designManager.cookie, {
        clientId,
        assigneeId: cast.designer.id,
      });
      await db
        .update(tasks)
        .set({ dueDate: addDays(today, -2) })
        .where(eq(tasks.id, overdue.id));
      // A member who delivered in the period and has left since (edge case 3).
      const gone = await cast.signedIn({
        name: `مغادر ${cast.run}`,
        departments: [{ code: 'design' }],
      });
      leaver = gone;
      const theirs = await cast.createTask(cast.designManager.cookie, {
        clientId,
        assigneeId: gone.id,
        needsClientApproval: false,
      });
      await db
        .update(tasks)
        .set({
          status: 'delivered',
          createdAt: at('2001-01-20T10:00:00Z'),
          startedAt: at('2001-02-01T10:00:00Z'),
          deliveredAt: at('2001-02-02T10:00:00Z'),
          dueDate: '2001-02-02',
        })
        .where(eq(tasks.id, theirs.id));
      await db.delete(departmentMembers).where(eq(departmentMembers.userId, gone.id));
      await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, gone.id));

      report = await getOk(
        `/api/reports/productivity${query(PRODUCTIVITY, '&department=design')}`,
        cast.gm.cookie,
        productivityReportSchema,
      );
    });

    it('measures each person by their current tasks of the department', () => {
      expect(report.period).toEqual(PRODUCTIVITY);
      expect(report.departments.map((row) => row.department)).toEqual(['design']);
      const designer = report.departments[0]?.people.find(
        (person) => person.user.id === cast.designer.id,
      );
      expect(designer?.measures).toEqual({
        new: 2,
        delivered: 2,
        onTimeRate: 50,
        averageClientRevisions: 1,
        averageInternalRevisions: 1,
        averageCycleDays: 6,
        openNow: 2,
        overdueNow: 1,
      });
    });

    it('lists members and archived people who delivered, and the department totals', () => {
      const design = report.departments[0];
      const ids = design?.people.map((person) => person.user.id) ?? [];
      expect(ids).toContain(cast.designManager.id);
      expect(design?.people.find((person) => person.user.id === leaver.id)).toMatchObject({
        user: { archived: true },
        measures: { delivered: 1, onTimeRate: 100, averageCycleDays: 1 },
      });
      expect(design?.measures.delivered).toBeGreaterThanOrEqual(3);
      expect(design?.unassigned.count).toBeGreaterThanOrEqual(0);
    });

    it('keeps a department manager to their departments and exports the report', async () => {
      const own = await getOk(
        `/api/reports/productivity${query(PRODUCTIVITY)}`,
        cast.designManager.cookie,
        productivityReportSchema,
      );
      expect(own.departments.map((row) => row.department)).toEqual(['design']);
      expect(
        (
          await client.get(
            '/api/reports/productivity?department=content_management',
            cast.designManager.cookie,
          )
        ).status,
      ).toBe(403);
      const response = await client.get(
        `/api/reports/productivity/export${query(PRODUCTIVITY, '&department=design')}`,
        cast.operations.cookie,
      );
      expect(response.headers.get('content-disposition')).toContain(
        `productivity-${PRODUCTIVITY.from}-${PRODUCTIVITY.to}.xlsx`,
      );
      const sheet = (await workbookOf(response)).worksheets[0];
      expect(sheet?.views[0]?.rightToLeft).toBe(true);
      const rows = rowsOf(sheet);
      expect(rows[0]?.[0]).toBe('القسم');
      expect(rows.some((row) => row[1] === cast.designer.name && row[3] === 2)).toBe(true);
    });
  });

  describe('revenue by client and service (rules 11–15)', () => {
    let report: RevenueReport;
    let clientId: string;
    let monthly: string;
    let pack: string;
    let oneOff: string;

    async function created<T>(path: string, body: object, schema: { parse: (v: unknown) => T }) {
      const response = await client.post(path, cast.gm.cookie, body);
      if (response.status !== 201) throw new Error(`${path}: ${await response.text()}`);
      return schema.parse(await response.json());
    }

    beforeAll(async () => {
      const name = () => `بند ${randomUUID().slice(0, 8)}`;
      oneOff = (
        await created(
          '/api/catalog/services',
          { name: name(), department: 'design', billing: 'one_off', priceUsdMinor: 1000 },
          catalogServiceSchema,
        )
      ).id;
      monthly = (
        await created(
          '/api/catalog/services',
          { name: name(), department: 'design', billing: 'monthly', priceUsdMinor: 1000 },
          catalogServiceSchema,
        )
      ).id;
      serviceIds.push(oneOff, monthly);
      pack = (
        await created(
          '/api/catalog/packages',
          {
            name: name(),
            billing: 'monthly',
            priceUsdMinor: 1000,
            items: [{ serviceId: monthly, quantity: 1 }],
          },
          catalogPackageSchema,
        )
      ).id;
      packageIds.push(pack);

      clientId = (await cast.createClient()).id;
      const retainer = await cast.createRetainer(clientId);
      const [charge] = await db
        .insert(retainerCharges)
        .values({
          retainerId: retainer.id,
          month: '2001-03-01',
          kind: 'monthly',
          amountMinor: 40_000,
        })
        .returning();
      // The retainer's accepted quote: the monthly service 3 parts, the package 1 part (rule 14).
      const [quote] = await db
        .insert(quotes)
        .values({
          year: 2001,
          number: Math.floor(Math.random() * 1_000_000),
          clientId,
          title: 'عرض الباقة',
          status: 'accepted',
          validityDays: 14,
          respondedOn: '2001-01-15',
          retainerId: retainer.id,
          createdById: cast.gm.id,
        })
        .returning();
      if (!quote) throw new Error('No quote');
      quoteIds.push(quote.id);
      await db.insert(quoteLines).values([
        {
          quoteId: quote.id,
          section: 'monthly',
          serviceId: monthly,
          name: 'خدمة شهرية',
          quantity: 3,
          unitPriceMinor: 10_000,
          position: 1,
        },
        {
          quoteId: quote.id,
          section: 'monthly',
          packageId: pack,
          name: 'باقة',
          quantity: 1,
          unitPriceMinor: 10_000,
          position: 2,
        },
        {
          quoteId: quote.id,
          section: 'one_off',
          serviceId: oneOff,
          name: 'خدمة مرة واحدة',
          quantity: 1,
          unitPriceMinor: 99_000,
          position: 3,
        },
      ]);

      // 20 000 to the one-off service, 40 000 by the quote, 10 000 Unclassified.
      const main = await issuedInvoice(
        clientId,
        'USD',
        [
          { unitPriceMinor: 20_000, serviceId: oneOff },
          { unitPriceMinor: 40_000 },
          { unitPriceMinor: 10_000 },
        ],
        '2001-03-05',
      );
      const chargeLine = main.lines[1];
      await db.update(invoices).set({ retainerId: retainer.id }).where(eq(invoices.id, main.id));
      await db
        .update(invoiceLines)
        .set({ retainerChargeId: charge?.id })
        .where(eq(invoiceLines.id, chargeLine?.id ?? ''));
      await pay(main.id, '2001-03-20', 35_000);

      // SYP at the invoice's own rate, Unclassified.
      await issuedInvoice(clientId, 'SYP', [{ unitPriceMinor: 13_000_000 }], '2001-03-10');
      // Voided, and a voided payment: they count nowhere (edge cases 6 and 7).
      const voided = await issuedInvoice(clientId, 'USD', [{ unitPriceMinor: 5000 }], '2001-03-11');
      await invoiceOk(
        await client.post(`/api/invoices/${voided.id}/void`, finance.cookie, { reason: 'خطأ' }),
      );
      const before = await issuedInvoice(clientId, 'USD', [{ unitPriceMinor: 8000 }], '2001-02-20');
      const voidedPayment = await pay(before.id, '2001-03-21', 3000);
      expect(
        (
          await client.post(`/api/payments/${voidedPayment}/void`, finance.cookie, {
            reason: 'خطأ',
          })
        ).status,
      ).toBe(200);
      // Paid in the period on an invoice issued before it: collected, not invoiced.
      await pay(before.id, '2001-03-25', 2000);
      // Issued after the period: neither.
      await issuedInvoice(clientId, 'USD', [{ unitPriceMinor: 7000 }], '2001-04-02');

      report = await getOk(
        `/api/reports/revenue${query(REVENUE)}`,
        finance.cookie,
        revenueReportSchema,
      );
    });

    const syp = toUsdMinor(13_000_000, 'SYP', '13000.0000');

    it('sums invoiced and collected per client at stored rates (rules 12 and 13)', () => {
      const row = report.byClient.find((entry) => entry.client.id === clientId);
      expect(row).toMatchObject({
        accountManager: { id: cast.am.id },
        invoicedUsdMinor: 70_000 + syp,
        collectedUsdMinor: 35_000 + 2000,
        // At the period's end: 35 000 + the SYP invoice + 8 000 − 2 000 still open.
        outstandingUsdMinor: 35_000 + syp + 6000,
      });
      expect(report.invoicedUsdMinor).toBeGreaterThanOrEqual(70_000 + syp);
    });

    it('splits by line, by the accepted quote and by payment shares (rule 14)', () => {
      const of = (id: string | null) =>
        report.byService.find((row) => (id ? row.id === id : row.kind === 'unclassified'));
      expect(of(oneOff)).toMatchObject({
        kind: 'service',
        invoicedUsdMinor: 20_000,
        collectedUsdMinor: 10_000,
      });
      expect(of(monthly)).toMatchObject({ invoicedUsdMinor: 30_000, collectedUsdMinor: 15_000 });
      expect(of(pack)).toMatchObject({
        kind: 'package',
        invoicedUsdMinor: 10_000,
        collectedUsdMinor: 5000,
      });
      expect(of(null)?.invoicedUsdMinor).toBeGreaterThanOrEqual(10_000 + syp);
      expect(report.byService.at(-1)?.kind).toBe('unclassified');
      const parts = report.byService.reduce((sum, row) => sum + row.invoicedUsdMinor, 0);
      expect(parts).toBe(report.invoicedUsdMinor);
    });

    it('moves a line out of Unclassified once it has a service', async () => {
      const unclassified = report.byService.find((row) => row.kind === 'unclassified');
      const [line] = await db
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(eq(invoices.issuedOn, '2001-03-10'));
      await db
        .update(invoiceLines)
        .set({ serviceId: oneOff })
        .where(eq(invoiceLines.id, line?.id ?? ''));
      const after = await getOk(
        `/api/reports/revenue${query(REVENUE)}`,
        finance.cookie,
        revenueReportSchema,
      );
      expect(after.byService.find((row) => row.kind === 'unclassified')?.invoicedUsdMinor).toBe(
        (unclassified?.invoicedUsdMinor ?? 0) - syp,
      );
      expect(after.byService.find((row) => row.id === oneOff)?.invoicedUsdMinor).toBe(20_000 + syp);
    });

    it('exports three sheets: By client, By service, Invoices (rule 15)', async () => {
      const response = await client.get(
        `/api/reports/revenue/export${query(REVENUE)}`,
        finance.cookie,
      );
      expect(response.headers.get('content-disposition')).toContain(
        `revenue-${REVENUE.from}-${REVENUE.to}.xlsx`,
      );
      const workbook = await workbookOf(response);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'حسب العميل',
        'حسب الخدمة',
        'الفواتير',
      ]);
      const invoicesSheet = rowsOf(workbook.worksheets[2]);
      const main = invoicesSheet.find((row) => row[4] === 700);
      expect(main?.[3]).toBe('USD');
      expect(main?.[2]).toEqual(new Date('2001-03-05T00:00:00Z'));
      expect(main?.[7]).toBe(350);
    });
  });

  describe('overdue invoices (rule 16)', () => {
    it('lists overdue invoices with aging and totals, filtered by manager and currency', async () => {
      const mine = await cast.createClient();
      const others = await cast.createClient({ accountManagerId: cast.otherAm.id });
      const old = await issuedInvoice(mine.id, 'SYP', [{ unitPriceMinor: 2_600_000 }], today);
      const recent = await issuedInvoice(others.id, 'USD', [{ unitPriceMinor: 9000 }], today);
      await db
        .update(invoices)
        .set({ status: 'overdue', issuedOn: addDays(today, -120), dueOn: addDays(today, -95) })
        .where(eq(invoices.id, old.id));
      await db
        .update(invoices)
        .set({ status: 'overdue', issuedOn: addDays(today, -20), dueOn: addDays(today, -10) })
        .where(eq(invoices.id, recent.id));

      const all = await getOk(
        '/api/reports/overdue-invoices',
        finance.cookie,
        overdueInvoicesReportSchema,
      );
      const row = (id: string) => all.invoices.find((entry) => entry.id === id);
      expect(row(old.id)).toMatchObject({
        client: { id: mine.id },
        accountManager: { id: cast.am.id },
        balanceMinor: 2_600_000,
        balanceUsdMinor: toUsdMinor(2_600_000, 'SYP', '13000.0000'),
        daysOverdue: 95,
        bucket: 'over_90',
      });
      expect(row(recent.id)).toMatchObject({ daysOverdue: 10, bucket: '1_30' });
      const ids = all.invoices.map((entry) => entry.id);
      expect(ids.indexOf(old.id)).toBeLessThan(ids.indexOf(recent.id));

      const managed = await getOk(
        `/api/reports/overdue-invoices?accountManagerId=${cast.am.id}`,
        finance.cookie,
        overdueInvoicesReportSchema,
      );
      expect(managed.invoices.map((entry) => entry.id)).toContain(old.id);
      expect(managed.invoices.map((entry) => entry.id)).not.toContain(recent.id);
      const usd = await getOk(
        '/api/reports/overdue-invoices?currency=USD',
        finance.cookie,
        overdueInvoicesReportSchema,
      );
      expect(usd.invoices.every((entry) => entry.currency === 'USD')).toBe(true);
      expect(usd.totals.count).toBe(usd.invoices.length);
      expect(usd.totals.usdMinor).toBe(
        usd.invoices.reduce((sum, entry) => sum + entry.balanceUsdMinor, 0),
      );

      const sheet = rowsOf(
        (
          await workbookOf(
            await client.get(
              `/api/reports/overdue-invoices/export?accountManagerId=${cast.am.id}`,
              finance.cookie,
            ),
          )
        ).worksheets[0],
      );
      expect(sheet[0]?.[0]).toBe('رقم الفاتورة');
      expect(
        sheet.some((line) => line[0] === old.displayNumber && line[10] === 'أكثر من 90 يومًا'),
      ).toBe(true);
    });
  });
});
