import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreateProjectExpenseInput,
  type InvoiceDetail,
  invoiceDetailSchema,
  type ProjectBilling,
  type ProjectDetail,
  projectBillingSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, invoiceSettings, projects } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('project expenses and billing (F13 rules 26–27)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let clientId: string;
  let project: ProjectDetail;
  const today = businessDate();

  async function ok<T>(
    response: Response,
    schema: { parse: (value: unknown) => T },
    status = 200,
  ): Promise<T> {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return schema.parse(await response.json());
  }

  const billing = (projectId: string, cookie = finance.cookie) =>
    client.get(`/api/projects/${projectId}/billing`, cookie);

  const addExpense = (
    projectId: string,
    body: Partial<CreateProjectExpenseInput> = {},
    cookie = finance.cookie,
  ) =>
    client.post(`/api/projects/${projectId}/expenses`, cookie, {
      spentOn: today,
      description: 'إيجار استوديو',
      amountMinor: 5_000,
      ...body,
    });

  const patchExpense = (id: string, body: Record<string, unknown>, cookie = finance.cookie) =>
    client.request('PATCH', `/api/project-expenses/${id}`, { cookie, body });

  const archiveExpense = (id: string, cookie = finance.cookie) =>
    client.post(`/api/project-expenses/${id}/archive`, cookie);

  const milestone = (index: number) => {
    const found = project.milestones[index];
    if (!found) throw new Error('No milestone');
    return found;
  };

  /** Issues an invoice of the project, from a milestone or with one free line. */
  async function issued(source: { milestoneId?: string; amount?: number }): Promise<InvoiceDetail> {
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, {
        clientId,
        currency: 'USD',
        projectId: project.id,
        sources: source.milestoneId ? [{ type: 'milestone', id: source.milestoneId }] : [],
      }),
      invoiceDetailSchema,
      201,
    );
    let saved = draft;
    if (source.amount) {
      saved = await ok(
        await client.request('PUT', `/api/invoices/${draft.id}`, {
          cookie: finance.cookie,
          body: {
            updatedAt: draft.updatedAt,
            projectId: project.id,
            retainerId: null,
            paymentTermsDays: 7,
            notes: null,
            lines: [{ description: 'عمل إضافي', quantity: 1, unitPriceMinor: source.amount }],
          },
        }),
        invoiceDetailSchema,
      );
    }
    return ok(
      await client.post(`/api/invoices/${saved.id}/issue`, finance.cookie, {
        updatedAt: saved.updatedAt,
      }),
      invoiceDetailSchema,
    );
  }

  const expenseOf = (result: ProjectBilling, description: string) => {
    const found = result.expenses.find((expense) => expense.description === description);
    if (!found) throw new Error(`No expense ${description}`);
    return found;
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    [savedSettings] = (await db.select().from(invoiceSettings)) as [
      typeof invoiceSettings.$inferSelect,
    ];
    await db
      .update(invoiceSettings)
      .set({ sypPerUsd: '118.5000', paymentTermsDays: 7, rateUpdatedAt: new Date() });
    clientId = (await cast.createClient()).id;
    project = await cast.createProject(clientId, {
      currency: 'USD',
      milestones: [
        { name: 'الدفعة الأولى', installmentMinor: 50_000 },
        { name: 'التسليم', installmentMinor: 30_000 },
        { name: 'بلا دفعة' },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
    if (savedSettings) await db.update(invoiceSettings).set(savedSettings);
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get(`/api/projects/${id}/billing`)).status).toBe(401);
    expect((await client.post(`/api/projects/${id}/expenses`, undefined, {})).status).toBe(401);
    expect(
      (await client.request('PATCH', `/api/project-expenses/${id}`, { body: {} })).status,
    ).toBe(401);
    expect((await client.post(`/api/project-expenses/${id}/archive`)).status).toBe(401);
  });

  it('needs money access to read and expenses.manage covering the client to write', async () => {
    const own = await ok(
      await addExpense(project.id, {}, cast.am.cookie),
      projectBillingSchema,
      201,
    );
    const expense = own.expenses[0];
    if (!expense) throw new Error('No expense');
    expect(own.canManageExpenses).toBe(true);
    expect((await billing(project.id, cast.employee.cookie)).status).toBe(403);
    expect((await addExpense(project.id, {}, cast.employee.cookie)).status).toBe(403);
    // Another manager's account manager reads the project but holds no money access over it.
    expect((await billing(project.id, cast.otherAm.cookie)).status).toBe(403);
    expect((await addExpense(project.id, {}, cast.otherAm.cookie)).status).toBe(403);
    expect((await patchExpense(expense.id, { amountMinor: 1 }, cast.otherAm.cookie)).status).toBe(
      403,
    );
    expect((await archiveExpense(expense.id, cast.otherAm.cookie)).status).toBe(403);
    for (const cookie of [cast.operations.cookie, cast.gm.cookie, cast.am.cookie]) {
      expect((await billing(project.id, cookie)).status).toBe(200);
    }
    expect((await billing(randomUUID())).status).toBe(404);
    expect((await addExpense(randomUUID())).status).toBe(404);
    expect((await patchExpense(randomUUID(), { amountMinor: 1 })).status).toBe(404);
    expect((await archiveExpense(randomUUID())).status).toBe(404);
    await ok(await archiveExpense(expense.id, cast.am.cookie), projectBillingSchema);
  });

  it('defaults the currency and the rate, refuses a future date (rule 26)', async () => {
    const result = await ok(
      await addExpense(project.id, { description: 'طباعة' }),
      projectBillingSchema,
      201,
    );
    expect(expenseOf(result, 'طباعة')).toMatchObject({
      amountMinor: 5_000,
      currency: 'USD',
      sypPerUsd: '118.5000',
      usdMinor: 5_000,
      loggedBy: { id: finance.id },
    });
    const syp = await ok(
      await addExpense(project.id, {
        description: 'نقل',
        amountMinor: 1_185_000,
        currency: 'SYP',
        sypPerUsd: '118.5',
      }),
      projectBillingSchema,
      201,
    );
    expect(expenseOf(syp, 'نقل').usdMinor).toBe(10_000);
    await expectError(
      await addExpense(project.id, { spentOn: addDays(today, 1) }),
      400,
      'INVALID_DATES',
    );
    const created = expenseOf(syp, 'نقل');
    await expectError(
      await patchExpense(created.id, { spentOn: addDays(today, 1) }),
      400,
      'INVALID_DATES',
    );
    for (const id of [expenseOf(syp, 'طباعة').id, created.id]) {
      await ok(await archiveExpense(id), projectBillingSchema);
    }
  });

  it('asks for a rate when none is set', async () => {
    await db.update(invoiceSettings).set({ sypPerUsd: null });
    try {
      await expectError(await addExpense(project.id), 409, 'RATE_REQUIRED');
      const given = await ok(
        await addExpense(project.id, { description: 'بسعر', sypPerUsd: '120' }),
        projectBillingSchema,
        201,
      );
      await ok(await archiveExpense(expenseOf(given, 'بسعر').id), projectBillingSchema);
    } finally {
      await db.update(invoiceSettings).set({ sypPerUsd: '118.5000' });
    }
  });

  it('takes expenses in any project status, not on an archived project', async () => {
    const done = await cast.createProject(clientId, { currency: 'USD' });
    await db.update(projects).set({ status: 'completed' }).where(eq(projects.id, done.id));
    const added = await ok(await addExpense(done.id), projectBillingSchema, 201);
    const expense = added.expenses[0];
    if (!expense) throw new Error('No expense');
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, done.id));
    // An archived project is readable by `projects.manage` scope-all holders only (F05).
    const gm = cast.gm.cookie;
    await expectError(await addExpense(done.id, {}, gm), 409, 'PROJECT_ARCHIVED');
    await expectError(
      await patchExpense(expense.id, { amountMinor: 1 }, gm),
      409,
      'PROJECT_ARCHIVED',
    );
    await expectError(await archiveExpense(expense.id, gm), 409, 'PROJECT_ARCHIVED');
    expect((await addExpense(done.id)).status).toBe(404);
    const archived = await ok(await billing(done.id, gm), projectBillingSchema);
    expect(archived).toMatchObject({ project: { archived: true }, canManageExpenses: false });
  });

  it('edits and archives an expense with audit entries', async () => {
    const added = await ok(
      await addExpense(project.id, { description: 'تعديل' }),
      projectBillingSchema,
      201,
    );
    const expense = expenseOf(added, 'تعديل');
    const edited = await ok(
      await patchExpense(expense.id, { amountMinor: 7_000, note: 'فاتورة المورد' }),
      projectBillingSchema,
    );
    expect(expenseOf(edited, 'تعديل')).toMatchObject({ amountMinor: 7_000, note: 'فاتورة المورد' });
    const archived = await ok(await archiveExpense(expense.id), projectBillingSchema);
    expect(archived.expenses.map((item) => item.id)).not.toContain(expense.id);
    await expectError(
      await patchExpense(expense.id, { amountMinor: 1 }),
      409,
      'INVALID_TRANSITION',
    );
    await expectError(await archiveExpense(expense.id), 409, 'INVALID_TRANSITION');
    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, expense.id))
      .orderBy(auditEntries.id);
    expect(entries.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['project_expense.created', finance.id],
      ['project_expense.updated', finance.id],
      ['project_expense.archived', finance.id],
    ]);
    expect(entries[1]?.before).toMatchObject({ amountMinor: 5_000, note: null, clientId });
    expect(entries[1]?.after).toMatchObject({ amountMinor: 7_000, note: 'فاتورة المورد' });
  });

  it('shows milestones with their invoices and the margin in USD (rule 27)', async () => {
    const deposit = await issued({ milestoneId: milestone(0).id });
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, {
        clientId,
        currency: 'USD',
        sources: [{ type: 'milestone', id: milestone(1).id }],
      }),
      invoiceDetailSchema,
      201,
    );
    // $100 in USD and $100 paid in SYP at the payment's own rate.
    for (const payment of [
      { amountMinor: 10_000, currency: 'USD' },
      { amountMinor: 1_200_000, currency: 'SYP', sypPerUsd: '120' },
    ]) {
      const response = await client.post(`/api/invoices/${deposit.id}/payments`, finance.cookie, {
        paidOn: today,
        method: 'bank_transfer',
        ...payment,
      });
      expect(response.status).toBe(201);
    }
    // A voided invoice counts nowhere.
    const voided = await issued({ amount: 99_000 });
    expect(
      (await client.post(`/api/invoices/${voided.id}/void`, finance.cookie, { reason: 'خطأ' }))
        .status,
    ).toBe(200);
    await addExpense(project.id, { description: 'هامش 1', amountMinor: 5_000 });
    await addExpense(project.id, {
      description: 'هامش 2',
      amountMinor: 592_500,
      currency: 'SYP',
    });
    const result = await ok(await billing(project.id), projectBillingSchema);
    expect(result.project).toMatchObject({ id: project.id, currency: 'USD', archived: false });
    expect(result.milestones.map((item) => [item.name, item.invoice])).toEqual([
      [
        'الدفعة الأولى',
        { id: deposit.id, displayNumber: deposit.displayNumber, status: 'partially_paid' },
      ],
      ['التسليم', { id: draft.id, displayNumber: null, status: 'draft' }],
      ['بلا دفعة', null],
    ]);
    expect(result.invoices.map((invoice) => invoice.id)).toEqual(
      expect.arrayContaining([deposit.id, voided.id]),
    );
    expect(result.margin).toEqual({
      invoicedUsdMinor: 50_000,
      collectedUsdMinor: 20_000,
      expensesUsdMinor: 10_000,
      marginUsdMinor: 40_000,
      plannedInstallmentsMinor: 80_000,
    });
  });
});
