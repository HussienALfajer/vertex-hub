import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  calendarSchema,
  clientBillingSchema,
  clientStatementSchema,
  type InvoiceDetail,
  invoiceDetailSchema,
  type RetainerDetail,
  retainerBillingSchema,
  retainerChargePageSchema,
} from '@vertex-hub/contracts';
import { createDatabase, invoiceSettings, invoices, payments } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('client balances, statements, retainer billing and invoice due dates (F13)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let clientId: string;
  let otherClientId: string;
  let retainer: RetainerDetail;
  const today = businessDate();
  const year = today.slice(0, 4);

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

  /** An issued free-line invoice of `amount` for `forClient` in `currency`. */
  async function issued(
    amount: number,
    currency: 'USD' | 'SYP' = 'USD',
    forClient = clientId,
  ): Promise<InvoiceDetail> {
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, { clientId: forClient, currency }),
      invoiceDetailSchema,
      201,
    );
    const saved = await ok(
      await client.request('PUT', `/api/invoices/${draft.id}`, {
        cookie: finance.cookie,
        body: {
          updatedAt: draft.updatedAt,
          projectId: null,
          retainerId: null,
          paymentTermsDays: 7,
          notes: null,
          lines: [{ description: 'خدمة', quantity: 1, unitPriceMinor: amount }],
        },
      }),
      invoiceDetailSchema,
    );
    return ok(
      await client.post(`/api/invoices/${saved.id}/issue`, finance.cookie, {
        updatedAt: saved.updatedAt,
      }),
      invoiceDetailSchema,
    );
  }

  const pay = async (invoice: InvoiceDetail, body: Record<string, unknown>) =>
    ok(
      await client.post(`/api/invoices/${invoice.id}/payments`, finance.cookie, {
        paidOn: today,
        method: 'cash',
        currency: invoice.currency,
        ...body,
      }),
      invoiceDetailSchema,
      201,
    );

  const statement = (query: string, cookie = finance.cookie, id = clientId) =>
    client.get(`/api/clients/${id}/statement?${query}`, cookie);

  async function calendar(cookie: string, extra = '') {
    const response = await client.get(
      `/api/calendar?from=${today}&to=${addDays(today, 30)}${extra}`,
      cookie,
    );
    return ok(response, calendarSchema);
  }

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
      .set({ sypPerUsd: '100.0000', paymentTermsDays: 7, rateUpdatedAt: new Date() });
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
    retainer = await cast.createRetainer(clientId, { currency: 'USD', monthlyFeeMinor: 40_000 });
  });

  afterAll(async () => {
    await app?.close();
    if (savedSettings) await db.update(invoiceSettings).set(savedSettings);
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get(`/api/clients/${id}/billing`)).status).toBe(401);
    expect((await client.get(`/api/clients/${id}/statement?currency=USD`)).status).toBe(401);
    expect((await client.get(`/api/retainers/${id}/billing`)).status).toBe(401);
  });

  it("keeps a client's balances and statement to its invoice readers", async () => {
    for (const path of [`/api/clients/${clientId}/billing`, `/api/clients/${clientId}/statement`]) {
      expect((await client.get(`${path}?currency=USD`, cast.employee.cookie)).status).toBe(403);
      expect((await client.get(`${path}?currency=USD`, cast.otherAm.cookie)).status).toBe(404);
      expect((await client.get(`${path}?currency=USD`, cast.am.cookie)).status).toBe(200);
    }
    expect((await client.get(`/api/clients/${randomUUID()}/billing`, finance.cookie)).status).toBe(
      404,
    );
    expect((await statement('currency=USD', finance.cookie, randomUUID())).status).toBe(404);
    expect((await statement('', finance.cookie)).status).toBe(400);
  });

  it('sums balances per currency over issued, non-void invoices', async () => {
    const usd = await issued(10_000);
    await pay(usd, { amountMinor: 4_000 });
    const overdue = await issued(6_000);
    await db
      .update(invoices)
      .set({ status: 'overdue', issuedOn: addDays(today, -20), dueOn: addDays(today, -13) })
      .where(eq(invoices.id, overdue.id));
    const syp = await issued(500_000, 'SYP');
    const voided = await issued(1_000);
    await ok(
      await client.post(`/api/invoices/${voided.id}/void`, finance.cookie, { reason: 'خطأ' }),
      invoiceDetailSchema,
    );
    const result = await ok(
      await client.get(`/api/clients/${clientId}/billing`, finance.cookie),
      clientBillingSchema,
    );
    expect(result.byCurrency).toEqual([
      {
        currency: 'SYP',
        invoicedMinor: 500_000,
        paidMinor: 0,
        outstandingMinor: 500_000,
        overdueMinor: 0,
      },
      {
        currency: 'USD',
        invoicedMinor: 16_000,
        paidMinor: 4_000,
        outstandingMinor: 12_000,
        overdueMinor: 6_000,
      },
    ]);
    expect(result.latest).toHaveLength(5);
    expect(result.latest.map((invoice) => invoice.id)).toContain(syp.id);
    // Clean slate for the statement below.
    await db
      .update(invoices)
      .set({ status: 'void' })
      .where(and(eq(invoices.clientId, clientId), ne(invoices.origin, 'cycle_opened')));
  });

  it('builds a statement with an opening balance, debits and credits (rule 28)', async () => {
    const old = await issued(10_000);
    await db
      .update(invoices)
      .set({ issuedOn: `${Number(year) - 1}-12-01`, dueOn: `${Number(year) - 1}-12-08` })
      .where(eq(invoices.id, old.id));
    const early = await pay(old, { amountMinor: 3_000 });
    const earlyPayment = early.payments[0];
    if (!earlyPayment) throw new Error('No payment');
    await db
      .update(payments)
      .set({ paidOn: `${Number(year) - 1}-12-15` })
      .where(eq(payments.id, earlyPayment.id));
    const current = await issued(5_000);
    const bySyp = await pay(current, { amountMinor: 200_000, currency: 'SYP', sypPerUsd: '100' });
    const voidedPayment = await pay(old, { amountMinor: 1_000 });
    const mistake = voidedPayment.payments.at(-1);
    if (!mistake) throw new Error('No payment');
    await ok(
      await client.post(`/api/payments/${mistake.id}/void`, finance.cookie, { reason: 'خطأ' }),
      invoiceDetailSchema,
    );
    const result = await ok(await statement('currency=USD'), clientStatementSchema);
    expect(result).toMatchObject({
      client: { id: clientId },
      currency: 'USD',
      from: `${year}-01-01`,
      to: today,
      openingMinor: 7_000,
      closingMinor: 10_000,
      invoicedMinor: 5_000,
      paidMinor: 2_000,
      outstandingMinor: 10_000,
    });
    const payment = bySyp.payments[0];
    expect(result.rows.map((row) => [row.kind, row.id, row.balanceMinor])).toEqual([
      ['invoice', current.id, 12_000],
      ['payment', payment?.id, 10_000],
    ]);
    expect(result.rows[1]).toMatchObject({
      invoiceId: current.id,
      invoiceNumber: current.displayNumber,
      creditMinor: 2_000,
      original: { amountMinor: 200_000, currency: 'SYP' },
    });
    // Another currency is another statement; a period ending before it starts is refused.
    const syp = await ok(await statement('currency=SYP'), clientStatementSchema);
    expect(syp.rows).toEqual([]);
    await expectError(
      await statement(`currency=USD&from=${today}&to=${addDays(today, -1)}`),
      400,
      'INVALID_DATES',
    );
  });

  it('shows the charges and extra work of a retainer with their invoices', async () => {
    const work = await client.post(`/api/retainers/${retainer.id}/extra-work`, cast.gm.cookie, {
      title: 'تصميم إضافي',
      estimateMinor: 8_000,
    });
    expect(work.status).toBe(201);
    const extraWorkId = ((await work.json()) as { id: string }).id;
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, {
        clientId,
        currency: 'USD',
        sources: [{ type: 'extra_work', id: extraWorkId }],
      }),
      invoiceDetailSchema,
      201,
    );
    const sent = await ok(
      await client.post(`/api/invoices/${draft.id}/issue`, finance.cookie, {
        updatedAt: draft.updatedAt,
      }),
      invoiceDetailSchema,
    );
    const result = await ok(
      await client.get(`/api/retainers/${retainer.id}/billing`, cast.am.cookie),
      retainerBillingSchema,
    );
    expect(result.retainer).toMatchObject({ id: retainer.id, monthlyFeeMinor: 40_000 });
    // The month's charge, created when the retainer's first cycle opened, drafted its month (A02).
    expect(result.charges).toEqual([
      expect.objectContaining({
        kind: 'monthly',
        amountMinor: 40_000,
        status: 'pending',
        due: true,
        invoice: expect.objectContaining({ displayNumber: null, status: 'draft' }),
      }),
    ]);
    expect(result.extraWork).toEqual([
      {
        id: extraWorkId,
        title: 'تصميم إضافي',
        billingStatus: 'billed',
        estimateMinor: 8_000,
        invoice: { id: sent.id, displayNumber: sent.displayNumber, status: 'sent' },
      },
    ]);
    expect(result.invoices.map((invoice) => invoice.id)).toContain(sent.id);
    expect(
      (await client.get(`/api/retainers/${retainer.id}/billing`, cast.employee.cookie)).status,
    ).toBe(403);
    expect(
      (await client.get(`/api/retainers/${retainer.id}/billing`, cast.otherAm.cookie)).status,
    ).toBe(403);
    expect(
      (await client.get(`/api/retainers/${randomUUID()}/billing`, finance.cookie)).status,
    ).toBe(404);
  });

  it('pages the charges of a retainer with their invoices for money readers (F05B)', async () => {
    const charges = (query = '', cookie = finance.cookie) =>
      client.get(`/api/retainers/${retainer.id}/charges${query}`, cookie);
    const page = await ok(await charges(), retainerChargePageSchema);
    expect(page).toMatchObject({ total: 1, page: 1 });
    expect(page.items[0]).toMatchObject({
      kind: 'monthly',
      amountMinor: 40_000,
      invoice: expect.objectContaining({ status: 'draft' }),
    });
    expect((await ok(await charges('?kind=credit'), retainerChargePageSchema)).total).toBe(0);
    expect((await ok(await charges('?status=pending'), retainerChargePageSchema)).total).toBe(1);
    expect((await ok(await charges('', cast.am.cookie), retainerChargePageSchema)).total).toBe(1);
    expect((await charges('?kind=cycle')).status).toBe(400);
    expect((await charges('', cast.employee.cookie)).status).toBe(403);
    expect((await charges('', cast.otherAm.cookie)).status).toBe(403);
    expect((await client.get(`/api/retainers/${retainer.id}/charges`)).status).toBe(401);
    expect(
      (await client.get(`/api/retainers/${randomUUID()}/charges`, finance.cookie)).status,
    ).toBe(404);
  });

  it('puts open invoice due dates on the calendar for their readers only', async () => {
    const mine = await issued(2_000);
    const theirs = await issued(3_000, 'USD', otherClientId);
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, { clientId, currency: 'USD' }),
      invoiceDetailSchema,
      201,
    );
    const dueIds = async (cookie: string, extra = '') =>
      (await calendar(cookie, extra)).keyDates
        .filter((keyDate) => keyDate.kind === 'invoice_due')
        .map((keyDate) => keyDate.targetId);
    const forFinance = await calendar(finance.cookie);
    expect(forFinance.keyDates.find((keyDate) => keyDate.targetId === mine.id)).toEqual({
      kind: 'invoice_due',
      date: mine.dueOn,
      title: mine.displayNumber,
      targetId: mine.id,
      client: { id: clientId, name: mine.client.name, archived: false },
      invoiceStatus: 'sent',
    });
    expect(await dueIds(finance.cookie)).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect(await dueIds(finance.cookie)).not.toContain(draft.id);
    expect(await dueIds(cast.am.cookie)).toContain(mine.id);
    expect(await dueIds(cast.am.cookie)).not.toContain(theirs.id);
    expect(await dueIds(cast.employee.cookie)).toEqual([]);
    expect(await dueIds(finance.cookie, `&clientId=${otherClientId}`)).toEqual([theirs.id]);
    expect(await dueIds(finance.cookie, '&kinds=renewal')).toEqual([]);
    await ok(
      await client.post(`/api/invoices/${mine.id}/void`, finance.cookie, { reason: 'خطأ' }),
      invoiceDetailSchema,
    );
    expect(await dueIds(finance.cookie)).not.toContain(mine.id);
  });
});
