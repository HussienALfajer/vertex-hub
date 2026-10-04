import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CompanyDashboard,
  companyDashboardSchema,
  conversionRate,
  departmentDashboardSchema,
  type FinanceDashboard,
  financeDashboardSchema,
  type InvoiceDetail,
  invoiceDetailSchema,
  myClientsDashboardSchema,
  reportMonths,
  toUsdMinor,
} from '@vertex-hub/contracts';
import {
  adWallets,
  approvalRequests,
  createDatabase,
  invoiceSettings,
  invoices,
  leads,
  retainerCycles,
  tasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedApprovalCast } from './approval-cast.js';
import { api, removeAdWallets, removeLeads } from './helpers.js';
import { startApp } from './start-app.js';

/** Every endpoint answers well within this on seeded data (edge case 14). */
const TIME_BUDGET_MS = 2000;

describe('dashboard (F15 rules 1–7)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedApprovalCast>>;
  let finance: { id: string; cookie: string };
  const leadIds: string[] = [];
  let savedRate: string | null = null;
  const today = businessDate();
  const months = reportMonths(today);

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

  const company = (cookie = cast.gm.cookie) =>
    getOk('/api/dashboard/company', cookie, companyDashboardSchema);
  const financeSection = (cookie = finance.cookie) =>
    getOk('/api/dashboard/finance', cookie, financeDashboardSchema);
  const departments = (cookie: string, query = '') =>
    getOk(`/api/dashboard/departments${query}`, cookie, departmentDashboardSchema);
  const myClients = (cookie = cast.am.cookie) =>
    getOk('/api/dashboard/clients', cookie, myClientsDashboardSchema);

  async function invoiceOk(response: Response, status = 200): Promise<InvoiceDetail> {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return invoiceDetailSchema.parse(await response.json());
  }

  /** An issued invoice of `clientId` with one free line. */
  async function issuedInvoice(clientId: string, currency: 'USD' | 'SYP', amountMinor: number) {
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
          lines: [{ description: 'خدمة', quantity: 1, unitPriceMinor: amountMinor }],
        },
      }),
    );
    return invoiceOk(
      await client.post(`/api/invoices/${saved.id}/issue`, finance.cookie, {
        updatedAt: saved.updatedAt,
      }),
    );
  }

  /** A lead row as the pipeline would leave it (F03 checks hold). */
  async function seedLead(fields: Partial<typeof leads.$inferInsert> = {}) {
    const [row] = await db
      .insert(leads)
      .values({
        contactName: `عميل محتمل ${cast.run}`,
        phone: '+963933123456',
        source: 'instagram',
        ownerId: cast.gm.id,
        createdById: cast.gm.id,
        nextFollowUpOn: today,
        ...fields,
      })
      .returning();
    if (!row) throw new Error('No lead');
    leadIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedApprovalCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    const [settings] = await db.select().from(invoiceSettings);
    savedRate = settings?.sypPerUsd ?? null;
    await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000', rateUpdatedAt: new Date() });
  });

  afterAll(async () => {
    await app?.close();
    await db.update(invoiceSettings).set({ sypPerUsd: savedRate });
    await removeLeads(db, leadIds);
    if (cast) await removeAdWallets(db, cast.clientIds());
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    for (const section of ['company', 'finance', 'departments', 'clients']) {
      expect((await client.get(`/api/dashboard/${section}`)).status, section).toBe(401);
    }
  });

  it('shows each section only to the roles that read it (rule 23)', async () => {
    const status = async (section: string, cookie: string) =>
      (await client.get(`/api/dashboard/${section}`, cookie)).status;
    const { gm, operations, am, employee, designManager } = cast;
    expect(await status('company', gm.cookie)).toBe(200);
    expect(await status('company', operations.cookie)).toBe(200);
    for (const cookie of [finance.cookie, am.cookie, employee.cookie, designManager.cookie]) {
      expect(await status('company', cookie)).toBe(403);
    }
    expect(await status('finance', gm.cookie)).toBe(200);
    expect(await status('finance', operations.cookie)).toBe(200);
    for (const cookie of [am.cookie, employee.cookie, designManager.cookie]) {
      expect(await status('finance', cookie)).toBe(403);
    }
    expect(await status('departments', gm.cookie)).toBe(200);
    expect(await status('departments', designManager.cookie)).toBe(200);
    for (const cookie of [finance.cookie, am.cookie, employee.cookie]) {
      expect(await status('departments', cookie)).toBe(403);
    }
    expect(await status('clients', am.cookie)).toBe(200);
    for (const cookie of [gm.cookie, finance.cookie, employee.cookie, designManager.cookie]) {
      expect(await status('clients', cookie)).toBe(403);
    }
  });

  describe('company (rule 1)', () => {
    let before: CompanyDashboard;
    let clientId: string;
    let retainerName: string;
    let cycleId: string;

    beforeAll(async () => {
      before = await company();
      clientId = (await cast.createClient()).id;
      await cast.createProject(clientId);
      const retainer = await cast.createRetainer(clientId);
      retainerName = retainer.name;
      cycleId = retainer.currentCycle?.id ?? '';
      // Three days left with nothing delivered: every line is behind (ADR 0015).
      await db
        .update(retainerCycles)
        .set({ periodStart: addDays(today, -20), periodEnd: addDays(today, 3) })
        .where(eq(retainerCycles.id, cycleId));
      const late = await cast.createTask(cast.designManager.cookie, { clientId });
      await db
        .update(tasks)
        .set({ dueDate: addDays(today, -2) })
        .where(eq(tasks.id, late.id));
      await db.insert(adWallets).values({ clientId, lowSince: new Date() });
      await seedLead();
      await seedLead({
        stage: 'won',
        nextFollowUpOn: null,
        closedAt: new Date(),
        clientId,
        convertedById: cast.gm.id,
      });
      await seedLead({
        stage: 'lost',
        nextFollowUpOn: null,
        closedAt: new Date(),
        lostReason: 'price',
      });
      // Created and lost last month: counts there, not this month.
      const lastMonth = new Date(`${months.lastMonth.from}T12:00:00Z`);
      await seedLead({
        stage: 'lost',
        nextFollowUpOn: null,
        closedAt: lastMonth,
        lostReason: 'timing',
        createdAt: lastMonth,
      });
      // An archived (mistaken) lead counts nowhere.
      await seedLead({ archivedAt: new Date() });
    });

    it('counts engagements, department workload and leads with the conversion rate', async () => {
      const after = await company();
      expect(after.months).toEqual(months);
      const planned = (dashboard: CompanyDashboard) =>
        dashboard.activeEngagements.projects.find((row) => row.status === 'planned')?.count ?? 0;
      expect(planned(after) - planned(before)).toBe(1);
      expect(after.activeEngagements.retainers - before.activeEngagements.retainers).toBe(1);
      const design = (dashboard: CompanyDashboard) =>
        dashboard.departments.find((row) => row.department === 'design');
      expect((design(after)?.overdue ?? 0) - (design(before)?.overdue ?? 0)).toBe(1);
      expect((design(after)?.open ?? 0) - (design(before)?.open ?? 0)).toBe(1);
      expect(after.departments).toHaveLength(before.departments.length);

      const { thisMonth, lastMonth } = after.leads;
      expect(thisMonth.new - before.leads.thisMonth.new).toBe(3);
      expect(thisMonth.won - before.leads.thisMonth.won).toBe(1);
      expect(thisMonth.lost - before.leads.thisMonth.lost).toBe(1);
      expect(thisMonth.conversionRate).toBe(conversionRate(thisMonth.won, thisMonth.lost));
      expect(lastMonth.lost - before.leads.lastMonth.lost).toBe(1);
      expect(lastMonth.new - before.leads.lastMonth.new).toBe(1);
    });

    it('lists retainers behind and low wallets with their client', async () => {
      const after = await company();
      expect(after.retainersBehind).toContainEqual({
        client: { id: clientId, name: expect.any(String) },
        retainer: { id: expect.any(String), name: retainerName },
        cycleId,
        linesBehind: 2,
        completion: 0,
      });
      expect(after.lowWallets).toContainEqual({
        client: { id: clientId, name: expect.any(String) },
        balanceUsdMinor: 0,
      });
    });

    it('counts approvals waiting more than 48 hours, expired links marked', async () => {
      const waitingBefore = (await company()).approvalsWaiting.count;
      const task = await cast.readyTask(clientId);
      const request = await cast.requestOk(clientId, [task.id]);
      const fresh = await company();
      expect(fresh.approvalsWaiting.count).toBe(waitingBefore);
      const longAgo = new Date('2000-01-01T00:00:00Z');
      await db
        .update(approvalRequests)
        .set({ linkIssuedAt: longAgo, expiresAt: new Date('2000-01-08T00:00:00Z') })
        .where(eq(approvalRequests.id, request.id));
      const after = await company();
      expect(after.approvalsWaiting.count).toBe(waitingBefore + 1);
      expect(after.approvalsWaiting.oldest).toMatchObject({
        client: { id: clientId },
        sentAt: longAgo.toISOString(),
        expired: true,
      });
      await db
        .update(approvalRequests)
        .set({ revokedAt: new Date(), revokedById: cast.am.id })
        .where(eq(approvalRequests.id, request.id));
      expect((await company()).approvalsWaiting.count).toBe(waitingBefore);
    });
  });

  describe('finance (rule 2)', () => {
    let before: FinanceDashboard;
    let clientId: string;

    beforeAll(async () => {
      before = await financeSection();
      clientId = (await cast.createClient()).id;
    });

    it('sums invoiced and collected in USD at stored rates, voids left out', async () => {
      const usd = await issuedInvoice(clientId, 'USD', 20000);
      const syp = await issuedInvoice(clientId, 'SYP', 26_000_000);
      const voided = await issuedInvoice(clientId, 'USD', 5000);
      await invoiceOk(
        await client.post(`/api/invoices/${voided.id}/void`, finance.cookie, { reason: 'خطأ' }),
      );
      const lastMonth = await issuedInvoice(clientId, 'USD', 7000);
      await db
        .update(invoices)
        .set({ issuedOn: months.lastMonth.from, dueOn: months.lastMonth.to })
        .where(eq(invoices.id, lastMonth.id));
      // A SYP payment on the USD invoice, converted at its own rate.
      const paid = await client.post(`/api/invoices/${usd.id}/payments`, finance.cookie, {
        paidOn: today,
        amountMinor: 65_000_000,
        currency: 'SYP',
        sypPerUsd: '13000',
        method: 'cash',
      });
      expect(paid.status).toBe(201);

      const after = await financeSection();
      expect(after.invoicedUsdMinor.thisMonth - before.invoicedUsdMinor.thisMonth).toBe(
        20000 + toUsdMinor(26_000_000, 'SYP', '13000.0000'),
      );
      expect(after.invoicedUsdMinor.lastMonth - before.invoicedUsdMinor.lastMonth).toBe(7000);
      expect(after.collectedUsdMinor.thisMonth - before.collectedUsdMinor.thisMonth).toBe(5000);
      expect(after.outstanding.usdMinor - before.outstanding.usdMinor).toBe(15000 + 2000 + 7000);
      const syps = (dashboard: FinanceDashboard) =>
        dashboard.outstanding.byCurrency.find((row) => row.currency === 'SYP')?.amountMinor ?? 0;
      expect(syps(after) - syps(before)).toBe(26_000_000);

      // The last-month invoice is past due: the daily run marks it overdue.
      await db.update(invoices).set({ status: 'overdue' }).where(eq(invoices.id, lastMonth.id));
      const overdue = await financeSection();
      expect(overdue.overdue.count - before.overdue.count).toBe(1);
      expect(overdue.overdue.usdMinor - before.overdue.usdMinor).toBe(7000);
      expect(syp.status).toBe('sent');
    });
  });

  describe('departments (rule 3)', () => {
    it("shows a manager their department's tasks, overdue first, and its people", async () => {
      const clientId = (await cast.createClient()).id;
      const late = await cast.createTask(cast.designManager.cookie, {
        clientId,
        assigneeId: cast.designer.id,
      });
      await db
        .update(tasks)
        .set({ dueDate: addDays(today, -30) })
        .where(eq(tasks.id, late.id));
      await cast.createTask(cast.designManager.cookie, { clientId });

      const shown = await departments(cast.designManager.cookie);
      expect(shown.departments).toEqual(['design']);
      expect(shown.department).toBe('design');
      expect(shown.overdue.oldest.map((task) => task.id)).toContain(late.id);
      expect(shown.overdue.oldest.every((task) => task.department === 'design')).toBe(true);
      expect(shown.overdue.count).toBeGreaterThanOrEqual(1);
      expect(shown.unassigned).toBeGreaterThanOrEqual(1);
      const designer = shown.people.find((person) => person.user.id === cast.designer.id);
      expect(designer?.overdue).toBeGreaterThanOrEqual(1);
      expect(shown.byStatus.find((row) => row.status === 'new')?.count).toBeGreaterThanOrEqual(2);

      const other = await client.get(
        '/api/dashboard/departments?department=content_management',
        cast.designManager.cookie,
      );
      expect(other.status).toBe(403);
    });

    it('lets `all` holders pick any department, defaulting to the one they manage', async () => {
      const operations = await departments(cast.operations.cookie);
      expect(operations.department).toBe('internal_operations');
      expect(operations.departments).toContain('design');
      expect((await departments(cast.gm.cookie, '?department=design')).department).toBe('design');
    });
  });

  describe('my clients (rule 4)', () => {
    it("lists the manager's clients, problems first, with money and wallet flags", async () => {
      const calm = await cast.createClient();
      const troubled = await cast.createClient();
      const others = await cast.createClient({ accountManagerId: cast.otherAm.id });
      const retainer = await cast.createRetainer(troubled.id);
      await db
        .update(retainerCycles)
        .set({ periodStart: addDays(today, -20), periodEnd: addDays(today, 3) })
        .where(eq(retainerCycles.id, retainer.currentCycle?.id ?? ''));
      await cast.createProject(calm.id);
      await db.insert(adWallets).values({ clientId: troubled.id, lowSince: new Date() });
      const invoice = await issuedInvoice(calm.id, 'USD', 9000);

      const shown = await myClients();
      const ids = shown.clients.map((row) => row.client.id);
      expect(ids).toContain(calm.id);
      expect(ids).not.toContain(others.id);
      expect(ids.indexOf(troubled.id)).toBeLessThan(ids.indexOf(calm.id));
      const row = (id: string) => shown.clients.find((entry) => entry.client.id === id);
      expect(row(troubled.id)).toMatchObject({
        retainers: [{ retainer: { id: retainer.id }, completion: 0, behind: true }],
        lowWallet: true,
        hasProblem: true,
      });
      expect(row(calm.id)).toMatchObject({
        openProjects: 1,
        invoices: { outstandingUsdMinor: invoice.totalMinor, overdue: 0 },
        lowWallet: false,
        hasProblem: false,
        approvals: { pending: 0, oldestSentAt: null, waiting: false },
      });
    });
  });
});
