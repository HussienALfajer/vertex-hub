import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  billableItemsSchema,
  businessDate,
  catalogServiceSchema,
  clientDetailResponseSchema,
  type InvoiceDetail,
  type InvoiceDraftInput,
  invoiceDetailSchema,
  invoicePageSchema,
  invoiceSettingsSchema,
  invoiceSnapshotSchema,
  type ProjectDetail,
  type RetainerDetail,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  catalogServices,
  createDatabase,
  extraWorkItems,
  invoiceSettings,
  invoices,
  projects,
  retainerCharges,
  retainers,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api, removeCatalog } from './helpers.js';
import { startApp } from './start-app.js';

describe('invoices', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let clientId: string;
  let otherClientId: string;
  let project: ProjectDetail;
  let retainer: RetainerDetail;
  let extraWorkId: string;
  const serviceIds: string[] = [];
  const today = businessDate();
  const year = Number(today.slice(0, 4));

  const put = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', path, { cookie, body });
  const patch = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', path, { cookie, body });
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  async function ok(response: Response, status = 200): Promise<InvoiceDetail> {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return invoiceDetailSchema.parse(await response.json());
  }

  const create = (body: Record<string, unknown>, cookie = finance.cookie) =>
    client.post('/api/invoices', cookie, { clientId, currency: 'USD', ...body });

  const draftOf = (
    invoice: InvoiceDetail,
    input: Partial<InvoiceDraftInput> = {},
  ): InvoiceDraftInput => ({
    updatedAt: invoice.updatedAt,
    projectId: invoice.engagement?.type === 'project' ? invoice.engagement.id : null,
    retainerId: invoice.engagement?.type === 'retainer' ? invoice.engagement.id : null,
    paymentTermsDays: invoice.paymentTermsDays,
    notes: invoice.notes,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      source: line.source ? { type: line.source.type, id: line.source.id } : null,
    })),
    ...input,
  });

  /** A manual USD draft with one free line on the project. */
  async function freeDraft(amount = 25000) {
    const draft = await ok(await create({ projectId: project.id }), 201);
    return ok(
      await put(
        `/api/invoices/${draft.id}`,
        finance.cookie,
        draftOf(draft, {
          lines: [{ description: 'تصميم إضافي', quantity: 2, unitPriceMinor: amount / 2 }],
        }),
      ),
    );
  }

  const issue = (invoice: InvoiceDetail, body: Record<string, unknown> = {}) =>
    client.post(`/api/invoices/${invoice.id}/issue`, finance.cookie, {
      updatedAt: invoice.updatedAt,
      ...body,
    });

  const milestone = (index: number) => {
    const found = project.milestones[index];
    if (!found) throw new Error('No milestone');
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
      .set({ sypPerUsd: '13000.0000', paymentTermsDays: 7, rateUpdatedAt: new Date() });
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
    project = await cast.createProject(clientId, {
      currency: 'USD',
      milestones: [
        { name: 'الدفعة الأولى', installmentMinor: 50000 },
        { name: 'التسليم', installmentMinor: 50000 },
        { name: 'بلا دفعة' },
      ],
    });
    retainer = await cast.createRetainer(clientId, { currency: 'USD', monthlyFeeMinor: 40000 });
    const work = await client.post(`/api/projects/${project.id}/extra-work`, cast.gm.cookie, {
      title: 'فيديو إضافي',
      estimateMinor: 12000,
    });
    expect(work.status).toBe(201);
    extraWorkId = ((await work.json()) as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
    if (savedSettings) await db.update(invoiceSettings).set(savedSettings);
    await db.delete(auditEntries).where(eq(auditEntries.entityType, 'invoice_settings'));
    await cast?.cleanup();
    await removeCatalog(db, serviceIds, []);
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/invoice-settings')).status).toBe(401);
    expect((await patch('/api/invoice-settings', undefined, {})).status).toBe(401);
    expect((await client.get('/api/invoices')).status).toBe(401);
    expect((await client.get(`/api/invoices/${id}`)).status).toBe(401);
    expect((await client.get(`/api/invoices/billable?clientId=${id}&currency=USD`)).status).toBe(
      401,
    );
    expect((await client.post('/api/invoices', undefined, {})).status).toBe(401);
    expect((await put(`/api/invoices/${id}`, undefined, {})).status).toBe(401);
    for (const action of ['issue', 'due-date', 'void', 'archive']) {
      expect((await client.post(`/api/invoices/${id}/${action}`, undefined, {})).status).toBe(401);
    }
  });

  it('keeps employees out and account managers to reading', async () => {
    const draft = await freeDraft();
    for (const path of ['/api/invoices', '/api/invoice-settings', `/api/invoices/${draft.id}`]) {
      expect((await client.get(path, cast.employee.cookie)).status).toBe(403);
    }
    const am = cast.am.cookie;
    expect((await client.get(`/api/invoices/${draft.id}`, am)).status).toBe(200);
    expect((await patch('/api/invoice-settings', am, { paymentTermsDays: 3 })).status).toBe(403);
    expect((await create({}, am)).status).toBe(403);
    expect(
      (await client.get(`/api/invoices/billable?clientId=${clientId}&currency=USD`, am)).status,
    ).toBe(403);
    expect((await put(`/api/invoices/${draft.id}`, am, draftOf(draft))).status).toBe(403);
    expect((await client.post(`/api/invoices/${draft.id}/issue`, am, draftOf(draft))).status).toBe(
      403,
    );
    expect((await client.post(`/api/invoices/${draft.id}/archive`, am)).status).toBe(403);
    expect(
      (
        await client.post(`/api/invoices/${draft.id}/due-date`, am, {
          dueOn: addDays(today, 3),
          reason: 'مهلة',
        })
      ).status,
    ).toBe(403);
    expect(
      (await client.post(`/api/invoices/${draft.id}/void`, am, { reason: 'خطأ' })).status,
    ).toBe(403);
  });

  it("hides another manager's client's invoices (rule 32)", async () => {
    const draft = await freeDraft();
    const other = cast.otherAm.cookie;
    expect((await client.get(`/api/invoices/${draft.id}`, other)).status).toBe(404);
    const page = invoicePageSchema.parse(
      await (await client.get(`/api/invoices?clientId=${clientId}`, other)).json(),
    );
    expect(page.items).toEqual([]);
    const own = invoicePageSchema.parse(
      await (await client.get(`/api/invoices?clientId=${clientId}`, cast.am.cookie)).json(),
    );
    expect(own.items.map((item) => item.id)).toContain(draft.id);
  });

  describe('settings', () => {
    it('lets every invoice reader read them, invoice managers edit them', async () => {
      const read = invoiceSettingsSchema.parse(
        await (await client.get('/api/invoice-settings', cast.am.cookie)).json(),
      );
      expect(read.canEdit).toBe(false);
      expect(read.paymentTermsDays).toBe(7);
      const response = await patch('/api/invoice-settings', cast.operations.cookie, {
        sypPerUsd: '13500.5',
        paymentDetails: 'بنك سوريا الدولي',
      });
      expect(response.status).toBe(200);
      const updated = invoiceSettingsSchema.parse(await response.json());
      expect(updated).toMatchObject({
        sypPerUsd: '13500.5000',
        paymentDetails: 'بنك سوريا الدولي',
        rateStale: false,
        canEdit: true,
        rateUpdatedBy: { id: cast.operations.id },
      });
      const [entry] = (
        await db
          .select()
          .from(auditEntries)
          .where(eq(auditEntries.entityType, 'invoice_settings'))
          .orderBy(auditEntries.id)
      ).slice(-1);
      expect(entry).toMatchObject({
        action: 'invoice_settings.updated',
        before: { sypPerUsd: '13000.0000', paymentDetails: '' },
        // The rate as stored, so before and after read alike.
        after: { sypPerUsd: '13500.5000', paymentDetails: 'بنك سوريا الدولي' },
      });
      // The same rate written another way is no change.
      const again = await patch('/api/invoice-settings', finance.cookie, { sypPerUsd: '13500.50' });
      expect(invoiceSettingsSchema.parse(await again.json()).rateUpdatedBy?.id).toBe(
        cast.operations.id,
      );
      await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000' });
    });

    it('refuses a zero rate', async () => {
      expect(
        (await patch('/api/invoice-settings', finance.cookie, { sypPerUsd: '0' })).status,
      ).toBe(400);
    });
  });

  describe('drafting (rules 1, 4, 6–8)', () => {
    it('lists billable work of the client in the currency', async () => {
      // The month's charge was drafted automatically (rule 4); once discarded it is billable again.
      const [automatic] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.retainerId, retainer.id));
      expect(automatic).toMatchObject({ origin: 'cycle_opened', status: 'draft' });
      expect(
        (await client.post(`/api/invoices/${automatic?.id}/archive`, finance.cookie)).status,
      ).toBe(204);
      const response = await client.get(
        `/api/invoices/billable?clientId=${clientId}&currency=USD`,
        finance.cookie,
      );
      expect(response.status).toBe(200);
      const items = billableItemsSchema.parse(await response.json());
      expect(items.milestones.map((item) => item.name)).toEqual(['الدفعة الأولى', 'التسليم']);
      expect(items.charges).toEqual([
        expect.objectContaining({
          retainer: { id: retainer.id, name: retainer.name },
          kind: 'monthly',
          amountMinor: 40000,
        }),
      ]);
      expect(items.extraWork).toEqual([
        expect.objectContaining({ id: extraWorkId, title: 'فيديو إضافي', estimateMinor: 12000 }),
      ]);
      const syp = billableItemsSchema.parse(
        await (
          await client.get(
            `/api/invoices/billable?clientId=${clientId}&currency=SYP`,
            finance.cookie,
          )
        ).json(),
      );
      expect(syp).toEqual({ milestones: [], charges: [], extraWork: [] });
      expect(
        (
          await client.get(
            `/api/invoices/billable?clientId=${randomUUID()}&currency=USD`,
            finance.cookie,
          )
        ).status,
      ).toBe(404);
    });

    it('drafts lines from sources at their default amounts and holds them', async () => {
      const draft = await ok(
        await create({
          sources: [
            { type: 'milestone', id: milestone(0).id },
            { type: 'extra_work', id: extraWorkId },
          ],
        }),
        201,
      );
      expect(draft).toMatchObject({
        status: 'draft',
        origin: 'manual',
        displayNumber: null,
        engagement: { type: 'project', id: project.id },
        totalMinor: 62000,
        paymentTermsDays: 7,
        createdBy: { id: finance.id },
        permissions: { canEdit: true, canIssue: true, canVoid: false },
      });
      expect(draft.lines).toEqual([
        expect.objectContaining({
          description: `${project.name} — الدفعة الأولى`,
          quantity: 1,
          unitPriceMinor: 50000,
          source: expect.objectContaining({ type: 'milestone', id: milestone(0).id }),
        }),
        expect.objectContaining({ description: 'فيديو إضافي', unitPriceMinor: 12000 }),
      ]);
      const items = billableItemsSchema.parse(
        await (
          await client.get(
            `/api/invoices/billable?clientId=${clientId}&currency=USD`,
            finance.cookie,
          )
        ).json(),
      );
      expect(items.milestones.map((item) => item.id)).not.toContain(milestone(0).id);
      expect(items.extraWork).toEqual([]);
      await expectError(
        await create({ sources: [{ type: 'milestone', id: milestone(0).id }] }),
        409,
        'ALREADY_INVOICED',
      );
      const [entry] = await auditOf(draft.id);
      expect(entry).toMatchObject({
        action: 'invoice.created',
        actorId: finance.id,
        after: { clientId, number: null, origin: 'manual', totalMinor: 62000 },
      });
      // Rule 8: discarding releases the sources.
      expect((await client.post(`/api/invoices/${draft.id}/archive`, finance.cookie)).status).toBe(
        204,
      );
      expect((await create({ sources: [{ type: 'milestone', id: milestone(0).id }] })).status).toBe(
        201,
      );
      await expectError(
        await client.post(`/api/invoices/${draft.id}/archive`, finance.cookie),
        409,
        'INVALID_TRANSITION',
      );
    });

    it('refuses mixed engagements, other currencies and archived records', async () => {
      const [charge] = await db
        .select({ id: retainerCharges.id })
        .from(retainerCharges)
        .where(eq(retainerCharges.retainerId, retainer.id));
      const chargeId = charge?.id;
      if (!chargeId) throw new Error('The retainer has no charge');
      await expectError(
        await create({
          sources: [
            { type: 'milestone', id: milestone(1).id },
            { type: 'retainer_charge', id: chargeId },
          ],
        }),
        409,
        'MIXED_ENGAGEMENTS',
      );
      await expectError(
        await create({
          projectId: project.id,
          sources: [{ type: 'retainer_charge', id: chargeId }],
        }),
        409,
        'MIXED_ENGAGEMENTS',
      );
      await expectError(
        await create({ currency: 'SYP', sources: [{ type: 'milestone', id: milestone(1).id }] }),
        409,
        'CURRENCY_MISMATCH',
      );
      await expectError(
        await create({ currency: 'SYP', retainerId: retainer.id }),
        409,
        'CURRENCY_MISMATCH',
      );
      // A source of another client is unknown here.
      expect(
        (
          await create({
            clientId: otherClientId,
            sources: [{ type: 'milestone', id: milestone(1).id }],
          })
        ).status,
      ).toBe(400);
      const archived = await cast.createProject(clientId, { currency: 'USD' });
      await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, archived.id));
      await expectError(await create({ projectId: archived.id }), 409, 'PROJECT_ARCHIVED');
      const ended = await cast.createRetainer(clientId, { currency: 'USD' });
      await db.update(retainers).set({ archivedAt: new Date() }).where(eq(retainers.id, ended.id));
      await expectError(await create({ retainerId: ended.id }), 409, 'RETAINER_ARCHIVED');
      const gone = await cast.createClient();
      expect((await client.post(`/api/clients/${gone.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      await expectError(await create({ clientId: gone.id }), 409, 'CLIENT_ARCHIVED');
    });

    it('saves the whole draft with free lines and refuses a stale save (rule 7)', async () => {
      const draft = await ok(await create({}), 201);
      expect(draft.engagement).toBeNull();
      const saved = await ok(
        await put(
          `/api/invoices/${draft.id}`,
          finance.cookie,
          draftOf(draft, {
            retainerId: retainer.id,
            paymentTermsDays: 14,
            notes: 'يدفع نقدًا',
            lines: [
              { description: 'تصميم', quantity: 3, unitPriceMinor: 1000 },
              { description: 'طباعة', quantity: 1, unitPriceMinor: 2500 },
            ],
          }),
        ),
      );
      expect(saved).toMatchObject({
        engagement: { type: 'retainer', id: retainer.id },
        paymentTermsDays: 14,
        notes: 'يدفع نقدًا',
        totalMinor: 5500,
      });
      await expectError(
        await put(`/api/invoices/${draft.id}`, finance.cookie, draftOf(draft)),
        409,
        'STALE_INVOICE',
      );
      const line = { description: 'سطر', quantity: 1, unitPriceMinor: 1 };
      await expectError(
        await put(
          `/api/invoices/${draft.id}`,
          finance.cookie,
          draftOf(saved, { lines: Array.from({ length: 51 }, () => line) }),
        ),
        409,
        'LIMIT_REACHED',
      );
      await expectError(
        await put(
          `/api/invoices/${draft.id}`,
          finance.cookie,
          draftOf(saved, {
            lines: [{ ...line, source: { type: 'milestone', id: milestone(1).id } }],
          }),
        ),
        409,
        'MIXED_ENGAGEMENTS',
      );
      const entries = await auditOf(draft.id);
      expect(entries.at(-1)).toMatchObject({
        action: 'invoice.updated',
        before: { totalMinor: 0, lineCount: 0, retainerId: null },
        after: { totalMinor: 5500, lineCount: 2, retainerId: retainer.id },
      });
    });
  });

  describe('issuing (rules 9–12, 15)', () => {
    it('refuses an empty draft and a missing rate', async () => {
      const empty = await ok(await create({}), 201);
      await expectError(await issue(empty), 409, 'INVOICE_EMPTY');
      const draft = await freeDraft();
      await db.update(invoiceSettings).set({ sypPerUsd: null });
      try {
        await expectError(await issue(draft), 409, 'RATE_REQUIRED');
      } finally {
        await db.update(invoiceSettings).set({ sypPerUsd: '13000.0000' });
      }
      await expectError(await issue(draft, { dueOn: addDays(today, -1) }), 400, 'INVALID_DATES');
      await expectError(
        await issue({ ...draft, updatedAt: new Date(0).toISOString() }),
        409,
        'STALE_INVOICE',
      );
    });

    it('numbers the invoice, fixes rate and due date, freezes the snapshot', async () => {
      const patched = await patch(`/api/clients/${clientId}`, cast.gm.cookie, {
        billingName: 'شركة المثال المحدودة',
        billingAddress: 'دمشق، المزة',
      });
      expect(clientDetailResponseSchema.parse(await patched.json())).toMatchObject({
        billingName: 'شركة المثال المحدودة',
        billingAddress: 'دمشق، المزة',
      });
      const draft = await freeDraft(30000);
      const issued = await ok(await issue(draft));
      expect(issued).toMatchObject({
        status: 'sent',
        year,
        issuedOn: today,
        dueOn: addDays(today, 7),
        sypPerUsd: '13000.0000',
        billingName: 'شركة المثال المحدودة',
        issuedBy: { id: finance.id },
        usd: { totalMinor: 30000, paidMinor: 0, balanceMinor: 30000 },
        permissions: { canEdit: false, canIssue: false, canChangeDueDate: true, canVoid: true },
      });
      expect(issued.displayNumber).toBe(`INV-${year}-${String(issued.number).padStart(4, '0')}`);
      const [row] = await db.select().from(invoices).where(eq(invoices.id, issued.id));
      expect(invoiceSnapshotSchema.parse(row?.snapshot)).toMatchObject({
        displayNumber: issued.displayNumber,
        billingName: 'شركة المثال المحدودة',
        billingAddress: 'دمشق، المزة',
        dueOn: addDays(today, 7),
        totalMinor: 30000,
      });
      // Rule 12: issued invoices are not edited, nor issued again.
      await expectError(
        await put(`/api/invoices/${issued.id}`, finance.cookie, draftOf(issued)),
        409,
        'INVOICE_LOCKED',
      );
      await expectError(await issue(issued), 409, 'INVALID_TRANSITION');
      const entry = (await auditOf(issued.id)).at(-1);
      expect(entry).toMatchObject({
        action: 'invoice.issued',
        after: {
          number: issued.displayNumber,
          status: 'sent',
          totalMinor: 30000,
          sypPerUsd: '13000.0000',
          dueOn: addDays(today, 7),
        },
      });
    });

    it('takes an edited rate and due date', async () => {
      const draft = await freeDraft();
      const issued = await ok(
        await issue(draft, { sypPerUsd: '12500', dueOn: addDays(today, 30) }),
      );
      expect(issued).toMatchObject({ sypPerUsd: '12500.0000', dueOn: addDays(today, 30) });
    });

    it('gives concurrent issues consecutive numbers (edge case 3)', async () => {
      const drafts = await Promise.all([freeDraft(), freeDraft(), freeDraft()]);
      const issued = await Promise.all(drafts.map(async (draft) => ok(await issue(draft))));
      const numbers = issued.map((invoice) => invoice.number ?? 0).sort((a, b) => a - b);
      expect(numbers[1]).toBe((numbers[0] ?? 0) + 1);
      expect(numbers[2]).toBe((numbers[0] ?? 0) + 2);
    });

    it('bills its extra work and releases it when voided (rules 11 and 14)', async () => {
      const work = await client.post(`/api/projects/${project.id}/extra-work`, cast.gm.cookie, {
        title: 'جلسة تصوير إضافية',
        estimateMinor: 9000,
      });
      const workId = ((await work.json()) as { id: string }).id;
      const draft = await ok(await create({ sources: [{ type: 'extra_work', id: workId }] }), 201);
      const issued = await ok(await issue(draft));
      const [billed] = await db.select().from(extraWorkItems).where(eq(extraWorkItems.id, workId));
      expect(billed).toMatchObject({ billingStatus: 'billed', billingNote: issued.displayNumber });

      expect(
        (await client.post(`/api/invoices/${issued.id}/void`, finance.cookie, { reason: ' ' }))
          .status,
      ).toBe(400);
      const voided = await ok(
        await client.post(`/api/invoices/${issued.id}/void`, finance.cookie, {
          reason: 'السعر خاطئ',
        }),
      );
      expect(voided).toMatchObject({
        status: 'void',
        displayNumber: issued.displayNumber,
        balanceMinor: 0,
        usd: { balanceMinor: 0 },
        voided: { by: { id: finance.id }, reason: 'السعر خاطئ' },
        permissions: { canVoid: false, canChangeDueDate: false },
      });
      const [released] = await db
        .select()
        .from(extraWorkItems)
        .where(eq(extraWorkItems.id, workId));
      expect(released).toMatchObject({ billingStatus: 'unbilled', billingNote: null });
      expect((await create({ sources: [{ type: 'extra_work', id: workId }] })).status).toBe(201);
      await expectError(
        await client.post(`/api/invoices/${issued.id}/void`, finance.cookie, {
          reason: 'مرة ثانية',
        }),
        409,
        'INVALID_TRANSITION',
      );
      const actions = (await auditOf(workId)).map((entry) => entry.action);
      expect(actions.filter((action) => action === 'extra_work.billing_changed')).toHaveLength(2);
      expect((await auditOf(issued.id)).at(-1)).toMatchObject({
        action: 'invoice.voided',
        after: { status: 'void', reason: 'السعر خاطئ' },
      });
    });

    it('refuses voiding an invoice with payments', async () => {
      const issued = await ok(await issue(await freeDraft()));
      await db.update(invoices).set({ paidMinor: 100 }).where(eq(invoices.id, issued.id));
      await expectError(
        await client.post(`/api/invoices/${issued.id}/void`, finance.cookie, { reason: 'خطأ' }),
        409,
        'INVOICE_HAS_PAYMENTS',
      );
      await db.update(invoices).set({ paidMinor: 0 }).where(eq(invoices.id, issued.id));
    });
  });

  describe('due dates (rules 13 and 21)', () => {
    it('moves the due date and recomputes the status', async () => {
      const issued = await ok(await issue(await freeDraft()));
      await db
        .update(invoices)
        .set({ status: 'overdue', issuedOn: addDays(today, -20), dueOn: addDays(today, -5) })
        .where(eq(invoices.id, issued.id));
      const overdue = invoiceDetailSchema.parse(
        await (await client.get(`/api/invoices/${issued.id}`, finance.cookie)).json(),
      );
      expect(overdue.daysOverdue).toBe(5);
      const moved = await ok(
        await client.post(`/api/invoices/${issued.id}/due-date`, finance.cookie, {
          dueOn: addDays(today, 10),
          reason: 'طلب العميل مهلة',
        }),
      );
      expect(moved).toMatchObject({ status: 'sent', dueOn: addDays(today, 10), daysOverdue: null });
      const [row] = await db.select().from(invoices).where(eq(invoices.id, issued.id));
      expect(invoiceSnapshotSchema.parse(row?.snapshot).dueOn).toBe(addDays(today, 10));
      expect((await auditOf(issued.id)).at(-1)).toMatchObject({
        action: 'invoice.due_date_changed',
        before: { dueOn: addDays(today, -5), status: 'overdue' },
        after: { dueOn: addDays(today, 10), status: 'sent', reason: 'طلب العميل مهلة' },
      });
      await expectError(
        await client.post(`/api/invoices/${issued.id}/due-date`, finance.cookie, {
          dueOn: addDays(today, -1),
          reason: 'خطأ',
        }),
        400,
        'INVALID_DATES',
      );
      const draft = await freeDraft();
      await expectError(
        await client.post(`/api/invoices/${draft.id}/due-date`, finance.cookie, {
          dueOn: addDays(today, 3),
          reason: 'مسودة',
        }),
        409,
        'INVALID_TRANSITION',
      );
    });
  });

  describe('list', () => {
    it('filters by status and number and totals the open balances', async () => {
      const issued = await ok(await issue(await freeDraft(26000)));
      const byNumber = invoicePageSchema.parse(
        await (
          await client.get(
            `/api/invoices?search=${issued.displayNumber}&status=sent`,
            finance.cookie,
          )
        ).json(),
      );
      expect(byNumber.items.map((item) => item.id)).toEqual([issued.id]);
      const drafts = invoicePageSchema.parse(
        await (
          await client.get(`/api/invoices?clientId=${clientId}&status=draft`, finance.cookie)
        ).json(),
      );
      expect(drafts.items.every((item) => item.status === 'draft')).toBe(true);
      expect(drafts.items.map((item) => item.id)).not.toContain(issued.id);
      // Totals cover the open invoices whatever the status filter.
      const usd = drafts.totals.byCurrency.find((total) => total.currency === 'USD');
      expect(usd?.outstandingMinor).toBeGreaterThanOrEqual(26000);
      expect(drafts.totals.usd.outstandingMinor).toBe(usd?.outstandingMinor);
      const sorted = invoicePageSchema.parse(
        await (
          await client.get(
            `/api/invoices?clientId=${clientId}&status=sent&sort=number&order=asc`,
            finance.cookie,
          )
        ).json(),
      );
      const numbers = sorted.items.map((item) => item.displayNumber ?? '');
      expect(numbers).toEqual([...numbers].sort());
    });

    it('keeps invoices of an archived client readable (edge case 10)', async () => {
      const archivedClient = await cast.createClient();
      const draft = await ok(await create({ clientId: archivedClient.id }), 201);
      expect(
        (await client.post(`/api/clients/${archivedClient.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      const read = await ok(await client.get(`/api/invoices/${draft.id}`, finance.cookie));
      expect(read.permissions).toMatchObject({ canEdit: false, canIssue: false, canArchive: true });
      await expectError(
        await put(`/api/invoices/${draft.id}`, finance.cookie, draftOf(draft)),
        409,
        'CLIENT_ARCHIVED',
      );
      await expectError(await issue(draft), 409, 'CLIENT_ARCHIVED');
    });
  });

  describe('line services (F15 rules 21–22)', () => {
    async function service(archived = false) {
      const response = await client.post('/api/catalog/services', cast.gm.cookie, {
        name: `خدمة ${randomUUID().slice(0, 8)}`,
        department: 'design',
        billing: 'one_off',
        priceUsdMinor: 1000,
      });
      expect(response.status).toBe(201);
      const created = catalogServiceSchema.parse(await response.json());
      serviceIds.push(created.id);
      if (archived) {
        await db
          .update(catalogServices)
          .set({ archivedAt: new Date() })
          .where(eq(catalogServices.id, created.id));
      }
      return created;
    }

    const setServices = (invoice: InvoiceDetail, lines: unknown, cookie = finance.cookie) =>
      put(`/api/invoices/${invoice.id}/services`, cookie, { lines });

    it('keeps a service per draft line and refuses an archived one', async () => {
      const logo = await service();
      const old = await service(true);
      const draft = await ok(await create({ projectId: project.id }), 201);
      const line = { description: 'شعار', quantity: 1, unitPriceMinor: 1000 };
      const saved = await ok(
        await put(
          `/api/invoices/${draft.id}`,
          finance.cookie,
          draftOf(draft, { lines: [{ ...line, serviceId: logo.id }, line] }),
        ),
      );
      expect(saved.lines.map((row) => row.service)).toEqual([
        { id: logo.id, name: logo.name, archived: false },
        null,
      ]);
      expect(saved.permissions.canEditServices).toBe(false);
      await expectError(
        await put(
          `/api/invoices/${draft.id}`,
          finance.cookie,
          draftOf(saved, { lines: [{ ...line, serviceId: old.id }] }),
        ),
        409,
        'INVALID_SERVICE',
      );
      await expectError(
        await put(
          `/api/invoices/${draft.id}`,
          finance.cookie,
          draftOf(saved, { lines: [{ ...line, serviceId: randomUUID() }] }),
        ),
        409,
        'INVALID_SERVICE',
      );
    });

    it('lets invoice managers set and clear services on an issued invoice, audited', async () => {
      const logo = await service();
      const issued = await ok(await issue(await freeDraft(20000)));
      expect(issued.permissions.canEditServices).toBe(true);
      const [line] = issued.lines;
      if (!line) throw new Error('No line');
      const [before] = await db.select().from(invoices).where(eq(invoices.id, issued.id));
      const changed = await ok(
        await setServices(issued, [{ lineId: line.id, serviceId: logo.id }]),
      );
      expect(changed.lines[0]?.service).toEqual({ id: logo.id, name: logo.name, archived: false });
      expect(changed).toMatchObject({ status: 'sent', totalMinor: issued.totalMinor });
      const [after] = await db.select().from(invoices).where(eq(invoices.id, issued.id));
      expect(after?.snapshot).toEqual(before?.snapshot);
      expect(after?.pdfStatus).toBe(before?.pdfStatus);
      const entries = await auditOf(issued.id);
      expect(entries.at(-1)).toMatchObject({
        action: 'invoice.services_changed',
        actorId: finance.id,
        before: { lines: [{ lineId: line.id, serviceId: null }] },
        after: { lines: [{ lineId: line.id, serviceId: logo.id }] },
      });

      // A service archived later stays; it cannot be chosen anew.
      await db
        .update(catalogServices)
        .set({ archivedAt: new Date() })
        .where(eq(catalogServices.id, logo.id));
      const kept = await ok(await setServices(changed, [{ lineId: line.id, serviceId: logo.id }]));
      expect(kept.lines[0]?.service?.archived).toBe(true);
      const other = await ok(await issue(await freeDraft(10000)));
      await expectError(
        await setServices(other, [{ lineId: other.lines[0]?.id, serviceId: logo.id }]),
        409,
        'INVALID_SERVICE',
      );
      const cleared = await ok(await setServices(kept, [{ lineId: line.id, serviceId: null }]));
      expect(cleared.lines[0]?.service).toBeNull();
    });

    it('refuses drafts, void invoices, unknown lines and other roles', async () => {
      const draft = await freeDraft();
      await expectError(
        await setServices(draft, [{ lineId: draft.lines[0]?.id, serviceId: null }]),
        409,
        'INVALID_TRANSITION',
      );
      const issued = await ok(await issue(await freeDraft()));
      const lines = [{ lineId: issued.lines[0]?.id, serviceId: null }];
      expect((await setServices(issued, [{ lineId: randomUUID(), serviceId: null }])).status).toBe(
        400,
      );
      expect((await put(`/api/invoices/${issued.id}/services`, undefined, { lines })).status).toBe(
        401,
      );
      expect((await setServices(issued, lines, cast.am.cookie)).status).toBe(403);
      expect((await setServices(issued, lines, cast.employee.cookie)).status).toBe(403);
      const voided = await ok(
        await client.post(`/api/invoices/${issued.id}/void`, finance.cookie, { reason: 'خطأ' }),
      );
      expect(voided.permissions.canEditServices).toBe(false);
      await expectError(await setServices(voided, lines), 409, 'INVALID_TRANSITION');
    });
  });
});
