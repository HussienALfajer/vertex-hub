import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  fileItemPageSchema,
  fileUploadSchema,
  type InvoiceDetail,
  type InvoiceDraftInput,
  invoiceDetailSchema,
  type ProjectDetail,
  type RecordPaymentInput,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  invoiceSettings,
  invoices,
  notifications,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceOverdueService } from '../src/modules/invoices/index.js';
import { DailyReminders } from '../src/modules/notifications/index.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { startApp } from './start-app.js';

describe('payments (F13 rules 16–23, A10)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let clientId: string;
  let project: ProjectDetail;
  const today = businessDate();
  const year = Number(today.slice(0, 4));

  async function ok(response: Response, status = 200): Promise<InvoiceDetail> {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return invoiceDetailSchema.parse(await response.json());
  }

  /** A sent USD invoice of `amount` on the project. */
  async function sentInvoice(amount = 10_000): Promise<InvoiceDetail> {
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, {
        clientId,
        currency: 'USD',
        projectId: project.id,
      }),
      201,
    );
    const body: InvoiceDraftInput = {
      updatedAt: draft.updatedAt,
      projectId: project.id,
      retainerId: null,
      paymentTermsDays: 7,
      notes: null,
      lines: [{ description: 'تصميم', quantity: 1, unitPriceMinor: amount }],
    };
    const saved = await ok(
      await client.request('PUT', `/api/invoices/${draft.id}`, { cookie: finance.cookie, body }),
    );
    return ok(
      await client.post(`/api/invoices/${saved.id}/issue`, finance.cookie, {
        updatedAt: saved.updatedAt,
      }),
    );
  }

  const pay = (
    invoice: InvoiceDetail,
    body: Partial<RecordPaymentInput>,
    cookie = finance.cookie,
  ) =>
    client.post(`/api/invoices/${invoice.id}/payments`, cookie, {
      paidOn: today,
      amountMinor: 1_000,
      currency: 'USD',
      method: 'cash',
      ...body,
    });

  const voidPayment = (paymentId: string, cookie = finance.cookie) =>
    client.post(`/api/payments/${paymentId}/void`, cookie, { reason: 'سُجّلت مرتين' });

  /** Moves an issued invoice's dates into the past, as if issued `daysAgo` days ago. */
  async function backdate(invoice: InvoiceDetail, issuedOn: string, dueOn: string) {
    await db.update(invoices).set({ issuedOn, dueOn }).where(eq(invoices.id, invoice.id));
  }

  const notificationsOf = (subjectId: string, type: 'invoice_paid' | 'invoice_overdue') =>
    db
      .select({ recipientId: notifications.recipientId })
      .from(notifications)
      .where(and(eq(notifications.subjectId, subjectId), eq(notifications.type, type)));

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
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-payments-'));
    process.env.FILES_ROOT = filesRoot;
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
    project = await cast.createProject(clientId, { currency: 'USD' });
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
    expect((await client.post(`/api/invoices/${id}/payments`, undefined, {})).status).toBe(401);
    expect((await client.post(`/api/payments/${id}/void`, undefined, {})).status).toBe(401);
  });

  it('keeps payments to payments.manage holders; unknown records are 404', async () => {
    const invoice = await sentInvoice();
    for (const cookie of [cast.am.cookie, cast.employee.cookie]) {
      expect((await pay(invoice, {}, cookie)).status).toBe(403);
    }
    const paid = await ok(await pay(invoice, {}, cast.operations.cookie), 201);
    const payment = paid.payments[0];
    if (!payment) throw new Error('No payment');
    expect((await voidPayment(payment.id, cast.am.cookie)).status).toBe(403);
    // Another manager's account manager holds no payments.manage (every holder has scope all),
    // and does not see the invoice at all.
    expect((await pay(invoice, {}, cast.otherAm.cookie)).status).toBe(403);
    expect((await voidPayment(payment.id, cast.otherAm.cookie)).status).toBe(403);
    expect((await client.get(`/api/invoices/${invoice.id}`, cast.otherAm.cookie)).status).toBe(404);
    expect((await pay({ ...invoice, id: randomUUID() }, {})).status).toBe(404);
    expect((await voidPayment(randomUUID())).status).toBe(404);
    // Account managers read the payments of their clients' invoices, without the actions.
    const read = await ok(await client.get(`/api/invoices/${invoice.id}`, cast.am.cookie));
    expect(read.payments).toHaveLength(1);
    expect(read.permissions).toMatchObject({ canRecordPayment: false, canVoidPayments: false });
    expect(paid.permissions).toMatchObject({ canRecordPayment: true, canVoidPayments: true });
  });

  it('takes payments on open invoices only (rule 16)', async () => {
    const draft = await ok(
      await client.post('/api/invoices', finance.cookie, { clientId, currency: 'USD' }),
      201,
    );
    await expectError(await pay(draft, {}), 409, 'INVALID_TRANSITION');
    const voided = await sentInvoice();
    await ok(
      await client.post(`/api/invoices/${voided.id}/void`, finance.cookie, { reason: 'خطأ' }),
    );
    await expectError(await pay(voided, {}), 409, 'INVALID_TRANSITION');
  });

  it('refuses a future date and accepts one before the issue date (rule 17)', async () => {
    const invoice = await sentInvoice();
    await expectError(await pay(invoice, { paidOn: addDays(today, 1) }), 400, 'INVALID_DATES');
    const early = await ok(await pay(invoice, { paidOn: addDays(today, -10) }), 201);
    expect(early.payments[0]?.paidOn).toBe(addDays(today, -10));
  });

  it('records a partial payment, then settles the rest in SYP exactly (rules 19–21, 23)', async () => {
    const invoice = await sentInvoice(10_000);
    const partial = await ok(
      await pay(invoice, {
        amountMinor: 4_000,
        method: 'bank_transfer',
        reference: 'بنك البركة 7781',
      }),
      201,
    );
    expect(partial).toMatchObject({
      status: 'partially_paid',
      paidMinor: 4_000,
      balanceMinor: 6_000,
    });
    const first = partial.payments[0];
    expect(first).toMatchObject({
      amountMinor: 4_000,
      appliedMinor: 4_000,
      currency: 'USD',
      sypPerUsd: '118.5000',
      method: 'bank_transfer',
      reference: 'بنك البركة 7781',
      recordedBy: { id: finance.id },
      voided: null,
    });
    expect(first?.receiptNumber).toMatch(new RegExp(`^RC-${year}-\\d{4,}$`));
    // "Pay the rest": $60.00 at 118.5 = 7 110.00 SYP, at an edited rate.
    const rest = await ok(
      await pay(invoice, {
        amountMinor: 711_000,
        currency: 'SYP',
        sypPerUsd: '118.5',
        method: 'e_wallet',
      }),
      201,
    );
    expect(rest).toMatchObject({ status: 'paid', paidMinor: 10_000, balanceMinor: 0 });
    expect(rest.payments[1]).toMatchObject({
      currency: 'SYP',
      amountMinor: 711_000,
      appliedMinor: 6_000,
    });
    // Receipt numbers are consecutive.
    const number = (receipt: string | undefined) => Number(receipt?.split('-')[2]);
    expect(number(rest.payments[1]?.receiptNumber)).toBe(number(first?.receiptNumber) + 1);
    // The account manager is told once; the recorder is not.
    expect(await notificationsOf(invoice.id, 'invoice_paid')).toEqual([
      { recipientId: cast.am.id },
    ]);
    const recorded = (await auditOf(rest.payments[1]?.id ?? '')).map((entry) => ({
      action: entry.action,
      before: entry.before,
      after: entry.after,
    }));
    expect(recorded).toEqual([
      {
        action: 'payment.recorded',
        before: expect.objectContaining({
          clientId,
          number: rest.payments[1]?.receiptNumber,
          invoice: invoice.displayNumber,
          status: 'partially_paid',
        }),
        after: expect.objectContaining({ appliedMinor: 6_000, currency: 'SYP', status: 'paid' }),
      },
    ]);
    // A paid invoice takes no more payments.
    await expectError(await pay(rest, { amountMinor: 1 }), 409, 'INVALID_TRANSITION');
  });

  it('refuses an overpayment, also beyond the settle tolerance in the other currency', async () => {
    const invoice = await sentInvoice(10_000);
    await expectError(await pay(invoice, { amountMinor: 10_001 }), 409, 'OVERPAYMENT');
    // 1 185.00 SYP at 118.5 = $10.00 more than the rest after $95.00.
    await ok(await pay(invoice, { amountMinor: 9_500 }), 201);
    await expectError(
      await pay(invoice, { amountMinor: 118_500, currency: 'SYP' }),
      409,
      'OVERPAYMENT',
    );
  });

  it('orders two payments at once under the invoice lock (edge case 2)', async () => {
    const invoice = await sentInvoice(10_000);
    const responses = await Promise.all([
      pay(invoice, { amountMinor: 10_000 }),
      pay(invoice, { amountMinor: 10_000 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const detail = await ok(await client.get(`/api/invoices/${invoice.id}`, finance.cookie));
    expect(detail).toMatchObject({ status: 'paid', paidMinor: 10_000 });
    expect(detail.payments).toHaveLength(1);
  });

  it('asks for a rate when none is set (edge case 8)', async () => {
    const invoice = await sentInvoice();
    await db.update(invoiceSettings).set({ sypPerUsd: null });
    try {
      await expectError(await pay(invoice, {}), 409, 'RATE_REQUIRED');
      await ok(await pay(invoice, { sypPerUsd: '120' }), 201);
    } finally {
      await db.update(invoiceSettings).set({ sypPerUsd: '118.5000' });
    }
  });

  it('keeps the proof as a document of the invoice, for invoice readers', async () => {
    const invoice = await sentInvoice();
    await expectError(await pay(invoice, { proofUploadId: randomUUID() }), 400, 'UPLOAD_NOT_FOUND');
    const upload = await uploaded(finance.cookie, 'تحويل.pdf');
    const paid = await ok(await pay(invoice, { proofUploadId: upload.uploadId }), 201);
    const payment = paid.payments[0];
    expect(payment?.proof?.name).toBe(`${payment?.receiptNumber} تحويل.pdf`);
    const documents = async (cookie: string) => {
      const response = await client.get(`/api/files/documents?clientId=${clientId}`, cookie);
      expect(response.status).toBe(200);
      return fileItemPageSchema.parse(await response.json()).items.map((item) => item.id);
    };
    expect(await documents(cast.am.cookie)).toContain(payment?.proof?.id);
    expect(await documents(finance.cookie)).toContain(payment?.proof?.id);
    // Without invoice access the proof is not listed, nor the invoice found.
    for (const cookie of [cast.employee.cookie, cast.otherAm.cookie]) {
      const response = await client.get(`/api/files/documents?clientId=${clientId}`, cookie);
      if (response.status === 200) {
        const ids = fileItemPageSchema.parse(await response.json()).items.map((item) => item.id);
        expect(ids).not.toContain(payment?.proof?.id);
      } else {
        expect([403, 404]).toContain(response.status);
      }
      expect([403, 404]).toContain(
        (await client.get(`/api/invoices/${invoice.id}`, cookie)).status,
      );
    }
  });

  it('voids a payment and recomputes the invoice (rule 22)', async () => {
    const invoice = await sentInvoice(10_000);
    await ok(await pay(invoice, { amountMinor: 3_000 }), 201);
    const paid = await ok(await pay(invoice, { amountMinor: 7_000 }), 201);
    expect(paid.status).toBe('paid');
    const [first, second] = paid.payments;
    if (!first || !second) throw new Error('No payments');
    const back = await ok(await voidPayment(second.id));
    expect(back).toMatchObject({ status: 'partially_paid', paidMinor: 3_000 });
    expect(back.payments[1]).toMatchObject({
      receiptNumber: second.receiptNumber,
      voided: { by: { id: finance.id }, reason: 'سُجّلت مرتين' },
    });
    await expectError(await voidPayment(second.id), 409, 'INVALID_TRANSITION');
    // The invoice cannot be voided while a payment stands; once none does, it can.
    await expectError(
      await client.post(`/api/invoices/${invoice.id}/void`, finance.cookie, { reason: 'خطأ' }),
      409,
      'INVOICE_HAS_PAYMENTS',
    );
    expect((await ok(await voidPayment(first.id))).status).toBe('sent');
    expect(
      (
        await ok(
          await client.post(`/api/invoices/${invoice.id}/void`, finance.cookie, { reason: 'خطأ' }),
        )
      ).status,
    ).toBe('void');
    const voided = await auditOf(second.id);
    expect(voided.map((entry) => entry.action)).toEqual(['payment.recorded', 'payment.voided']);
    expect(voided[1]?.before).toMatchObject({ status: 'paid' });
    expect(voided[1]?.after).toMatchObject({ status: 'partially_paid', reason: 'سُجّلت مرتين' });
  });

  it('returns a voided payment past its due date to overdue (rule 21)', async () => {
    const invoice = await sentInvoice(10_000);
    const paid = await ok(await pay(invoice, { amountMinor: 10_000 }), 201);
    await backdate(invoice, addDays(today, -20), addDays(today, -5));
    const back = await ok(await voidPayment(paid.payments[0]?.id ?? ''));
    expect(back).toMatchObject({ status: 'overdue', daysOverdue: 5 });
    // It became overdue: its readers get the first alert, as from the daily job.
    const recipients = (await notificationsOf(invoice.id, 'invoice_overdue')).map(
      (row) => row.recipientId,
    );
    expect(recipients).toEqual(
      expect.arrayContaining([finance.id, cast.operations.id, cast.am.id]),
    );
  });

  it('marks invoices overdue once a day and alerts their readers (A10)', async () => {
    const overdue = app.get(InvoiceOverdueService);
    const invoice = await sentInvoice(10_000);
    const partly = await sentInvoice(10_000);
    await ok(await pay(partly, { amountMinor: 1_000 }), 201);
    const current = await sentInvoice(10_000);
    const dueOn = addDays(today, -3);
    await backdate(invoice, addDays(today, -10), dueOn);
    await backdate(partly, addDays(today, -10), dueOn);
    await backdate(current, today, today);

    expect(await overdue.runDaily(today)).toBeGreaterThanOrEqual(2);
    for (const id of [invoice.id, partly.id]) {
      const detail = await ok(await client.get(`/api/invoices/${id}`, finance.cookie));
      expect(detail).toMatchObject({ status: 'overdue', daysOverdue: 3 });
      const recipients = (await notificationsOf(id, 'invoice_overdue')).map(
        (row) => row.recipientId,
      );
      expect(recipients).toEqual(
        expect.arrayContaining([finance.id, cast.operations.id, cast.am.id]),
      );
      expect(recipients).not.toContain(cast.employee.id);
      const entries = await auditOf(id);
      const marked = entries.filter((entry) => entry.action === 'invoice.overdue');
      expect(marked).toHaveLength(1);
      expect(marked[0]).toMatchObject({ actorId: null, after: { status: 'overdue', dueOn } });
    }
    expect((await ok(await client.get(`/api/invoices/${current.id}`, finance.cookie))).status).toBe(
      'sent',
    );

    // A second run changes nothing and alerts nobody again.
    const alerted = (await notificationsOf(invoice.id, 'invoice_overdue')).length;
    await overdue.runDaily(today);
    expect(await notificationsOf(invoice.id, 'invoice_overdue')).toHaveLength(alerted);
    expect(
      (await auditOf(invoice.id)).filter((entry) => entry.action === 'invoice.overdue'),
    ).toHaveLength(1);

    // A partial payment keeps it overdue; the rest makes it paid.
    const still = await ok(await pay(invoice, { amountMinor: 4_000 }), 201);
    expect(still.status).toBe('overdue');
    expect((await ok(await pay(invoice, { amountMinor: 6_000 }), 201)).status).toBe('paid');
  });

  it('repeats the overdue alert every 7 days, once per week mark (A10)', async () => {
    const overdue = app.get(InvoiceOverdueService);
    const reminders = app.get(DailyReminders);
    const invoice = await sentInvoice(10_000);
    const dueOn = addDays(today, -30);
    await backdate(invoice, addDays(today, -40), dueOn);
    await overdue.runDaily(today);
    const count = async () => (await notificationsOf(invoice.id, 'invoice_overdue')).length;
    // Every Finance user, the Operations manager and the account manager: one alert each.
    const alerted = await count();
    expect(alerted).toBeGreaterThanOrEqual(3);

    // Day 7 overdue: no reminder yet; day 8: the first one, once.
    await overdue.remind(addDays(dueOn, 7));
    expect(await count()).toBe(alerted);
    await overdue.remind(addDays(dueOn, 8));
    await overdue.remind(addDays(dueOn, 8));
    expect(await count()).toBe(alerted * 2);
    // Later days of the same week send nothing; day 15 is the next mark.
    await overdue.remind(addDays(dueOn, 12));
    expect(await count()).toBe(alerted * 2);
    await reminders.runDaily(addDays(dueOn, 15));
    expect(await count()).toBe(alerted * 3);
    // Missed weeks are not sent late: on day 30 only the day-29 mark goes out.
    await overdue.remind(addDays(dueOn, 30));
    expect(await count()).toBe(alerted * 4);
  });
});
