import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CatalogPackage,
  type CatalogService,
  catalogPackageSchema,
  catalogServiceSchema,
  type QuoteDetail,
  type QuoteDraftInput,
  quoteDetailSchema,
  quotePageSchema,
  quoteSettingsSchema,
  quoteSnapshotSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, notifications, quoteSettings, quotes } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuoteWorkflowService } from '../src/modules/quotes/quote-workflow.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, removeCatalog } from './helpers.js';
import { startApp } from './start-app.js';

describe('quotes', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let clientId: string;
  let contactId: string;
  let brand: CatalogService;
  let design: CatalogService;
  let reel: CatalogService;
  let page: CatalogService;
  let gold: CatalogPackage;
  let savedSettings: typeof quoteSettings.$inferSelect;
  const services: string[] = [];
  const packages: string[] = [];

  const name = (label: string) => `${label} ${cast.run} ${randomUUID().slice(0, 6)}`;
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

  async function createService(input: Record<string, unknown>) {
    const response = await client.post('/api/catalog/services', cast.gm.cookie, {
      name: name('خدمة'),
      department: 'design',
      billing: 'monthly',
      priceUsdMinor: 1500,
      ...input,
    });
    expect(response.status).toBe(201);
    const created = catalogServiceSchema.parse(await response.json());
    services.push(created.id);
    return created;
  }

  async function createQuote(cookie = cast.am.cookie, body: Record<string, unknown> = {}) {
    const response = await client.post('/api/quotes', cookie, {
      clientId,
      title: name('عرض'),
      ...body,
    });
    if (response.status !== 201) {
      throw new Error(`Quote creation failed: ${response.status} ${await response.text()}`);
    }
    return quoteDetailSchema.parse(await response.json());
  }

  /** The draft as the builder sends it, with `lines` and `installments` replaced. */
  const draftOf = (quote: QuoteDetail, input: Partial<QuoteDraftInput> = {}): QuoteDraftInput => ({
    updatedAt: quote.updatedAt,
    contactId: quote.contact?.id ?? null,
    title: quote.title,
    currency: quote.currency,
    validityDays: quote.validityDays,
    oneOffDiscountMinor: quote.oneOffDiscountMinor,
    monthlyDiscountMinor: quote.monthlyDiscountMinor,
    monthlyTermMonths: quote.monthlyTermMonths,
    clientNotes: quote.clientNotes,
    terms: quote.terms,
    lines: quote.lines.map((line) => ({
      id: line.id,
      section: line.section,
      serviceId: line.serviceId,
      packageId: line.packageId,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      revisionRounds: line.revisionRounds,
      items: line.items.map((item) => ({
        serviceId: item.serviceId,
        quantity: item.quantity,
        revisionRounds: item.revisionRounds,
      })),
    })),
    installments: quote.installments.map(({ name: installment, percent }) => ({
      name: installment,
      percent,
    })),
    ...input,
  });

  const brandLine = (unitPriceMinor = 80000) => ({
    section: 'one_off' as const,
    serviceId: brand.id,
    quantity: 1,
    unitPriceMinor,
    revisionRounds: 3,
  });

  const goldLine = (unitPriceMinor = 45000) => ({
    section: 'monthly' as const,
    packageId: gold.id,
    quantity: 1,
    unitPriceMinor,
    items: gold.items.map((item) => ({
      serviceId: item.serviceId,
      quantity: item.quantity,
      revisionRounds: 2,
    })),
  });

  const halves = [
    { name: 'البداية', percent: 50 },
    { name: 'التسليم', percent: 50 },
  ];

  async function save(
    quote: QuoteDetail,
    input: Partial<QuoteDraftInput>,
    cookie = cast.am.cookie,
  ) {
    const response = await put(`/api/quotes/${quote.id}`, cookie, draftOf(quote, input));
    if (response.status !== 200) {
      throw new Error(`Save failed: ${response.status} ${await response.text()}`);
    }
    return quoteDetailSchema.parse(await response.json());
  }

  /** A draft with "Brand identity" (one-off, two halves) and "Gold social" (monthly, 6 months). */
  async function builtQuote(oneOffPrice = 80000) {
    const quote = await createQuote();
    return save(quote, {
      lines: [brandLine(oneOffPrice), goldLine()],
      installments: halves,
      monthlyTermMonths: 6,
    });
  }

  async function action(path: string, cookie = cast.am.cookie, body: unknown = {}) {
    return client.post(path, cookie, body);
  }

  async function sent(quote: QuoteDetail, cookie = cast.am.cookie) {
    const response = await action(`/api/quotes/${quote.id}/send`, cookie);
    if (response.status !== 200) {
      throw new Error(`Send failed: ${response.status} ${await response.text()}`);
    }
    return quoteDetailSchema.parse(await response.json());
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    [savedSettings] = (await db.select().from(quoteSettings)) as [
      typeof quoteSettings.$inferSelect,
    ];
    await db.update(quoteSettings).set({ discountThresholdPercent: 10, defaultValidityDays: 14 });
    clientId = (await cast.createClient()).id;
    const contact = await client.post(`/api/clients/${clientId}/contacts`, cast.gm.cookie, {
      name: 'سارة',
    });
    expect(contact.status).toBe(201);
    contactId = ((await contact.json()) as { id: string }).id;
    brand = await createService({ billing: 'one_off', priceUsdMinor: 80000, revisionRounds: 3 });
    design = await createService({ deliverableKind: 'design', priceSypMinor: 150000 });
    reel = await createService({
      department: 'photography',
      priceUsdMinor: 6000,
      deliverableKind: 'reel',
    });
    page = await createService({ department: 'content_management', priceUsdMinor: 10000 });
    const response = await client.post('/api/catalog/packages', cast.gm.cookie, {
      name: name('باقة'),
      billing: 'monthly',
      priceUsdMinor: 45000,
      items: [
        { serviceId: design.id, quantity: 12 },
        { serviceId: reel.id, quantity: 4 },
        { serviceId: page.id, quantity: 2 },
      ],
    });
    expect(response.status).toBe(201);
    gold = catalogPackageSchema.parse(await response.json());
    packages.push(gold.id);
  });

  afterAll(async () => {
    await app?.close();
    if (savedSettings) await db.update(quoteSettings).set(savedSettings);
    await db.delete(auditEntries).where(eq(auditEntries.entityType, 'quote_settings'));
    await cast?.cleanup();
    await removeCatalog(db, services, packages);
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/quote-settings')).status).toBe(401);
    expect((await patch('/api/quote-settings', undefined, {})).status).toBe(401);
    expect((await client.get('/api/quotes')).status).toBe(401);
    expect((await client.get(`/api/quotes/${id}`)).status).toBe(401);
    expect((await client.post('/api/quotes', undefined, {})).status).toBe(401);
    expect((await put(`/api/quotes/${id}`, undefined, {})).status).toBe(401);
    for (const path of [
      'approval',
      'approval/decision',
      'send',
      'extend',
      'reject',
      'versions',
      'archive',
    ]) {
      expect((await client.post(`/api/quotes/${id}/${path}`, undefined, {})).status).toBe(401);
    }
  });

  describe('settings', () => {
    it('are read by quote readers only', async () => {
      const response = await client.get('/api/quote-settings', finance.cookie);
      expect(response.status).toBe(200);
      expect(quoteSettingsSchema.parse(await response.json())).toMatchObject({
        discountThresholdPercent: 10,
        canEdit: false,
        canEditThreshold: false,
      });
      expect((await client.get('/api/quote-settings', cast.employee.cookie)).status).toBe(403);
    });

    it('let the Operations manager edit the texts but not the threshold', async () => {
      const ops = cast.operations.cookie;
      const response = await patch('/api/quote-settings', ops, {
        companyDetails: 'فيرتكس ميديا · دمشق',
        defaultTerms: 'الدفع خلال 7 أيام',
      });
      expect(response.status).toBe(200);
      expect(quoteSettingsSchema.parse(await response.json())).toMatchObject({
        companyDetails: 'فيرتكس ميديا · دمشق',
        canEdit: true,
        canEditThreshold: false,
      });
      expect(
        (await patch('/api/quote-settings', ops, { discountThresholdPercent: 20 })).status,
      ).toBe(403);
      expect(
        (await patch('/api/quote-settings', finance.cookie, { defaultValidityDays: 5 })).status,
      ).toBe(403);
      expect((await patch('/api/quote-settings', cast.am.cookie, {})).status).toBe(403);
    });

    it('let the General Manager change the threshold, audited', async () => {
      const response = await patch('/api/quote-settings', cast.gm.cookie, {
        discountThresholdPercent: 12,
      });
      expect(response.status).toBe(200);
      const [entry] = (
        await db.select().from(auditEntries).where(eq(auditEntries.entityType, 'quote_settings'))
      ).filter(
        (row) =>
          row.action === 'quote_settings.updated' &&
          row.after &&
          'discountThresholdPercent' in row.after,
      );
      expect(entry).toMatchObject({
        before: { discountThresholdPercent: 10 },
        after: { discountThresholdPercent: 12 },
      });
      await patch('/api/quote-settings', cast.gm.cookie, { discountThresholdPercent: 10 });
    });
  });

  describe('create', () => {
    it('numbers drafts per year with the default validity and terms (rules 1, 2)', async () => {
      const first = await createQuote(cast.am.cookie, { contactId });
      const second = await createQuote();
      const year = Number(businessDate().slice(0, 4));
      expect(first).toMatchObject({
        year,
        version: 1,
        status: 'draft',
        currency: 'USD',
        validityDays: 14,
        terms: 'الدفع خلال 7 أيام',
        contact: { id: contactId },
        accountManager: { id: cast.am.id },
      });
      expect(second.number).toBe(first.number + 1);
      expect(first.displayNumber).toBe(`Q-${year}-${String(first.number).padStart(4, '0')}`);
      const [entry] = await auditOf(first.id);
      expect(entry).toMatchObject({
        action: 'quote.created',
        actorId: cast.am.id,
        after: { clientId, displayNumber: first.displayNumber },
      });
    });

    it('never gives one number twice, even at once', async () => {
      const created = await Promise.all(Array.from({ length: 5 }, () => createQuote()));
      const numbers = created.map((quote) => quote.number).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(5);
      expect((numbers.at(-1) ?? 0) - (numbers[0] ?? 0)).toBe(4);
    });

    it('is refused outside client scope and for ended or archived clients', async () => {
      const body = { clientId, title: 'x' };
      expect((await client.post('/api/quotes', cast.otherAm.cookie, body)).status).toBe(403);
      expect((await client.post('/api/quotes', finance.cookie, body)).status).toBe(403);
      expect((await client.post('/api/quotes', cast.employee.cookie, body)).status).toBe(403);
      await expectError(
        await client.post('/api/quotes', cast.am.cookie, { ...body, contactId: randomUUID() }),
        400,
        'UNKNOWN_CONTACT',
      );
      const ended = await cast.createClient({ status: 'ended' });
      await expectError(
        await client.post('/api/quotes', cast.am.cookie, { ...body, clientId: ended.id }),
        409,
        'CLIENT_ENDED',
      );
      const archived = await cast.createClient();
      await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
      await expectError(
        await client.post('/api/quotes', cast.gm.cookie, { ...body, clientId: archived.id }),
        409,
        'CLIENT_ARCHIVED',
      );
    });

    it('lets the Operations manager quote any client', async () => {
      await createQuote(cast.operations.cookie);
    });
  });

  describe('drafts', () => {
    it('copy catalog lines and compute the totals (rules 4, 5)', async () => {
      const quote = await builtQuote(68000);
      const [oneOff, monthly] = quote.lines;
      expect(oneOff).toMatchObject({
        name: brand.name,
        department: 'design',
        listUnitPriceMinor: 80000,
        unitPriceMinor: 68000,
        revisionRounds: 3,
        totalMinor: 68000,
      });
      expect(monthly).toMatchObject({
        name: gold.name,
        listUnitPriceMinor: 45000,
        department: null,
      });
      expect(
        monthly?.items.map((item) => [item.serviceId, item.quantity, item.deliverableKind]),
      ).toEqual([
        [design.id, 12, 'design'],
        [reel.id, 4, 'reel'],
        [page.id, 2, null],
      ]);
      expect(quote.totals.oneOff).toMatchObject({
        netMinor: 68000,
        effectiveDiscountBasisPoints: 1500,
      });
      expect(quote.totals.monthlyTermTotalMinor).toBe(270000);
      expect(quote.installments.map((i) => i.amountMinor)).toEqual([34000, 34000]);
      expect(quote.needsDiscountApproval).toBe(true);
      expect(quote.permissions).toMatchObject({
        canEdit: true,
        canRequestApproval: true,
        canSend: true,
      });
      const updated = (await auditOf(quote.id)).find((entry) => entry.action === 'quote.updated');
      expect(updated?.after).toMatchObject({
        oneOffNetMinor: 68000,
        oneOffEffectiveDiscount: 15,
        lineCount: 2,
      });
    });

    it('refuses a stale save (edge case 1)', async () => {
      const quote = await createQuote();
      await save(quote, { title: 'أول' });
      await expectError(
        await put(`/api/quotes/${quote.id}`, cast.am.cookie, draftOf(quote, { title: 'ثان' })),
        409,
        'STALE_QUOTE',
      );
    });

    it('checks discounts, installments, contacts, limits and catalog items', async () => {
      const quote = await createQuote();
      const attempt = (input: Partial<QuoteDraftInput>) =>
        put(`/api/quotes/${quote.id}`, cast.am.cookie, draftOf(quote, input));
      await expectError(
        await attempt({ lines: [brandLine()], installments: halves, oneOffDiscountMinor: 90000 }),
        400,
        'INVALID_DISCOUNT',
      );
      await expectError(
        await attempt({ lines: [brandLine()], installments: [{ name: 'كامل', percent: 90 }] }),
        400,
        'INVALID_INSTALLMENTS',
      );
      await expectError(
        await attempt({ lines: [goldLine()], installments: halves }),
        400,
        'INVALID_INSTALLMENTS',
      );
      await expectError(await attempt({ contactId: randomUUID() }), 400, 'UNKNOWN_CONTACT');
      await expectError(
        await attempt({ lines: Array.from({ length: 51 }, () => brandLine()) }),
        409,
        'LIMIT_REACHED',
      );
      const line = goldLine();
      await expectError(
        await attempt({ lines: [{ ...line, items: line.items.slice(0, 2) }] }),
        400,
        'INVALID_PACKAGE_ITEM',
      );
      const old = await createService({ billing: 'one_off', priceUsdMinor: 100 });
      await client.post(`/api/catalog/services/${old.id}/archive`, cast.gm.cookie);
      await expectError(
        await attempt({
          lines: [{ ...brandLine(), serviceId: old.id }],
          installments: [{ name: 'كامل', percent: 100 }],
        }),
        409,
        'CATALOG_ITEM_ARCHIVED',
      );
    });

    it('keeps copied prices and re-prices on a currency change (rule 3, edge case 3)', async () => {
      const quote = await createQuote();
      const designLine = {
        section: 'monthly' as const,
        serviceId: design.id,
        quantity: 12,
        unitPriceMinor: 1500,
        revisionRounds: 2,
      };
      const usd = await save(quote, { lines: [designLine, goldLine()] });
      await patch(`/api/catalog/services/${design.id}`, cast.gm.cookie, { priceUsdMinor: 2000 });
      const kept = await save(usd, { title: 'سعر محفوظ' });
      expect(kept.lines[0]?.listUnitPriceMinor).toBe(1500);
      const syp = await save(kept, { currency: 'SYP' });
      expect(syp.lines.map((line) => [line.unitPriceMinor, line.listUnitPriceMinor])).toEqual([
        [150000, 150000],
        [0, null],
      ]);
      await patch(`/api/catalog/services/${design.id}`, cast.gm.cookie, { priceUsdMinor: 1500 });
    });

    it('is read-only for others and absent outside scope', async () => {
      const quote = await createQuote();
      expect((await client.get(`/api/quotes/${quote.id}`, cast.otherAm.cookie)).status).toBe(404);
      expect((await client.get(`/api/quotes/${quote.id}`, cast.employee.cookie)).status).toBe(403);
      const read = await client.get(`/api/quotes/${quote.id}`, finance.cookie);
      expect(read.status).toBe(200);
      expect(quoteDetailSchema.parse(await read.json()).permissions.canEdit).toBe(false);
      expect((await put(`/api/quotes/${quote.id}`, finance.cookie, draftOf(quote))).status).toBe(
        403,
      );
      expect(
        (await put(`/api/quotes/${quote.id}`, cast.otherAm.cookie, draftOf(quote))).status,
      ).toBe(404);
    });

    it('keep the billing of quoted catalog items (SERVICE_IN_USE)', async () => {
      await builtQuote();
      await expectError(
        await patch(`/api/catalog/services/${brand.id}`, cast.gm.cookie, { billing: 'monthly' }),
        409,
        'SERVICE_IN_USE',
      );
      await expectError(
        await patch(`/api/catalog/packages/${gold.id}`, cast.gm.cookie, {
          billing: 'one_off',
          templateId: null,
        }),
        409,
        'SERVICE_IN_USE',
      );
    });
  });

  describe('discount approval (rule 7)', () => {
    it('is requested only when needed', async () => {
      const quote = await builtQuote(80000);
      await expectError(
        await action(`/api/quotes/${quote.id}/approval`, cast.am.cookie, { action: 'request' }),
        409,
        'APPROVAL_NOT_NEEDED',
      );
    });

    it('goes to the General Manager, blocks editing and resets on a change', async () => {
      const quote = await builtQuote(68000);
      const request = await action(`/api/quotes/${quote.id}/approval`, cast.am.cookie, {
        action: 'request',
      });
      expect(request.status).toBe(200);
      const pending = quoteDetailSchema.parse(await request.json());
      expect(pending.discountApproval).toBe('pending');
      expect(pending.permissions).toMatchObject({ canEdit: false, canWithdrawApproval: true });
      const asked = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.subjectId, quote.id), eq(notifications.recipientId, cast.gm.id)),
        );
      expect(asked.map((row) => row.type)).toEqual(['quote_approval_requested']);
      await expectError(
        await put(`/api/quotes/${quote.id}`, cast.am.cookie, draftOf(pending)),
        409,
        'APPROVAL_PENDING',
      );
      const listed = await client.get('/api/quotes?approval=pending', cast.gm.cookie);
      expect(quotePageSchema.parse(await listed.json()).items.map((q) => q.id)).toContain(quote.id);

      const decision = `/api/quotes/${quote.id}/approval/decision`;
      expect((await action(decision, cast.am.cookie, { decision: 'approve' })).status).toBe(403);
      expect((await action(decision, cast.gm.cookie, { decision: 'return' })).status).toBe(400);
      const returned = await action(decision, cast.gm.cookie, {
        decision: 'return',
        note: 'خصم كبير',
      });
      expect(returned.status).toBe(200);
      const back = quoteDetailSchema.parse(await returned.json());
      expect(back).toMatchObject({
        discountApproval: 'returned',
        discountDecision: { by: { id: cast.gm.id }, note: 'خصم كبير' },
      });
      const told = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.subjectId, quote.id), eq(notifications.recipientId, cast.am.id)),
        );
      expect(told.map((row) => [row.type, (row.data as { decision: string }).decision])).toEqual([
        ['quote_approval_decided', 'return'],
      ]);
      await expectError(
        await action(decision, cast.gm.cookie, { decision: 'approve' }),
        409,
        'INVALID_TRANSITION',
      );

      const lowered = await save(back, { lines: [brandLine(70400), goldLine()] });
      await action(`/api/quotes/${quote.id}/approval`, cast.am.cookie, { action: 'request' });
      const withdrawn = await action(`/api/quotes/${quote.id}/approval`, cast.am.cookie, {
        action: 'withdraw',
      });
      expect(quoteDetailSchema.parse(await withdrawn.json()).discountApproval).toBe('none');
      await action(`/api/quotes/${quote.id}/approval`, cast.am.cookie, { action: 'request' });
      const approved = quoteDetailSchema.parse(
        await (await action(decision, cast.gm.cookie, { decision: 'approve' })).json(),
      );
      expect(approved.discountApproval).toBe('approved');
      const unchanged = await save(approved, { clientNotes: 'ملاحظة' });
      expect(unchanged.discountApproval).toBe('approved');
      const repriced = await save(unchanged, { lines: [brandLine(70000), goldLine()] });
      expect(repriced.discountApproval).toBe('none');
      expect(lowered.totals.oneOff.effectiveDiscountBasisPoints).toBe(1200);
      const actions = (await auditOf(quote.id)).map((entry) => entry.action);
      for (const expected of [
        'quote.approval_requested',
        'quote.approval_returned',
        'quote.approval_withdrawn',
        'quote.approval_approved',
      ]) {
        expect(actions).toContain(expected);
      }
    });
  });

  describe('send (rule 6)', () => {
    it('needs lines, installments, prices and an approved discount', async () => {
      const empty = await createQuote();
      await expectError(await action(`/api/quotes/${empty.id}/send`), 409, 'QUOTE_EMPTY');
      const noInstallments = await save(await createQuote(), { lines: [brandLine()] });
      await expectError(
        await action(`/api/quotes/${noInstallments.id}/send`),
        409,
        'INVALID_INSTALLMENTS',
      );
      const free = await save(await createQuote(), { lines: [goldLine(0)] });
      await expectError(await action(`/api/quotes/${free.id}/send`), 409, 'ZERO_PRICE');
      const discounted = await builtQuote(68000);
      await expectError(
        await action(`/api/quotes/${discounted.id}/send`),
        409,
        'DISCOUNT_APPROVAL_REQUIRED',
      );
      expect((await action(`/api/quotes/${free.id}/send`, finance.cookie)).status).toBe(403);
      // A free package is a full discount: the General Manager sends it, confirming the price.
      await expectError(
        await action(`/api/quotes/${free.id}/send`, cast.gm.cookie),
        409,
        'ZERO_PRICE',
      );
      const confirmed = await action(`/api/quotes/${free.id}/send`, cast.gm.cookie, {
        confirmZeroPrice: true,
      });
      expect(confirmed.status).toBe(200);
    });

    it('freezes the quote with its validity and snapshot, without list prices', async () => {
      const quote = await save(await builtQuote(), { contactId });
      const result = await sent(quote);
      expect(result).toMatchObject({
        status: 'sent',
        validUntil: addDays(businessDate(), 14),
        sentBy: { id: cast.am.id },
        permissions: { canEdit: false, canReject: true, canCreateVersion: true },
      });
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
      const snapshot = quoteSnapshotSchema.parse(row?.snapshot);
      expect(snapshot).toMatchObject({
        companyDetails: 'فيرتكس ميديا · دمشق',
        addressee: 'سارة',
        oneOff: { netMinor: 80000 },
        monthly: { netMinor: 45000, termMonths: 6, termTotalMinor: 270000 },
      });
      expect(snapshot.installments.map((i) => i.amountMinor)).toEqual([40000, 40000]);
      expect(JSON.stringify(snapshot)).not.toContain('listUnitPriceMinor');
      await expectError(
        await put(`/api/quotes/${quote.id}`, cast.am.cookie, draftOf(result)),
        409,
        'QUOTE_LOCKED',
      );
      await expectError(await action(`/api/quotes/${quote.id}/send`), 409, 'INVALID_TRANSITION');
    });

    it('records the approval when the General Manager sends', async () => {
      const quote = await builtQuote(68000);
      const result = await sent(quote, cast.gm.cookie);
      expect(result.discountApproval).toBe('approved');
      expect((await auditOf(quote.id)).map((entry) => entry.action)).toContain(
        'quote.approval_approved',
      );
    });
  });

  describe('versions (rule 8)', () => {
    it('copies the latest version and supersedes it when sent', async () => {
      const v1 = await sent(await builtQuote());
      await patch(`/api/catalog/services/${brand.id}`, cast.gm.cookie, { priceUsdMinor: 90000 });
      const created = await action(`/api/quotes/${v1.id}/versions`);
      expect(created.status).toBe(201);
      const v2 = quoteDetailSchema.parse(await created.json());
      expect(v2).toMatchObject({
        number: v1.number,
        version: 2,
        status: 'draft',
        displayNumber: `${v1.displayNumber} v2`,
        discountApproval: 'none',
        validUntil: null,
      });
      expect(v2.lines[0]).toMatchObject({ unitPriceMinor: 80000, listUnitPriceMinor: 90000 });
      expect(v2.versions.map((v) => [v.version, v.status])).toEqual([
        [1, 'sent'],
        [2, 'draft'],
      ]);
      await expectError(await action(`/api/quotes/${v1.id}/versions`), 409, 'VERSION_EXISTS');
      await patch(`/api/catalog/services/${brand.id}`, cast.gm.cookie, { priceUsdMinor: 80000 });

      const latest = await client.get(`/api/quotes?search=${v1.displayNumber}`, cast.am.cookie);
      expect(quotePageSchema.parse(await latest.json()).items.map((q) => q.id)).toEqual([v2.id]);

      const sentV2 = await sent(v2, cast.gm.cookie);
      expect(sentV2.versions.map((v) => v.status)).toEqual(['superseded', 'sent']);
      await expectError(await action(`/api/quotes/${v1.id}/versions`), 409, 'INVALID_TRANSITION');
      expect((await auditOf(v1.id)).map((entry) => entry.action)).toContain('quote.superseded');
    });

    it('is not offered on a draft', async () => {
      const draft = await createQuote();
      await expectError(
        await action(`/api/quotes/${draft.id}/versions`),
        409,
        'INVALID_TRANSITION',
      );
    });
  });

  describe('expiry, extension and rejection (rules 9–11)', () => {
    it('expires sent quotes once, then extends and rejects them', async () => {
      const quote = await sent(await builtQuote());
      const job = app.get(QuoteWorkflowService);
      const later = addDays(businessDate(), 20);
      expect(await job.runDaily(later)).toBeGreaterThanOrEqual(1);
      expect(await job.runDaily(later)).toBe(0);
      const expired = quoteDetailSchema.parse(
        await (await client.get(`/api/quotes/${quote.id}`, cast.am.cookie)).json(),
      );
      expect(expired).toMatchObject({ status: 'expired', permissions: { canExtend: true } });
      const entry = (await auditOf(quote.id)).find((row) => row.action === 'quote.expired');
      expect(entry?.actorId).toBeNull();

      const extend = `/api/quotes/${quote.id}/extend`;
      await expectError(
        await action(extend, cast.am.cookie, { validUntil: addDays(businessDate(), -1) }),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await action(extend, cast.am.cookie, { validUntil: addDays(businessDate(), 91) }),
        400,
        'INVALID_DATES',
      );
      const extended = await action(extend, cast.am.cookie, {
        validUntil: addDays(businessDate(), 30),
      });
      expect(quoteDetailSchema.parse(await extended.json())).toMatchObject({
        status: 'sent',
        validUntil: addDays(businessDate(), 30),
      });
      await expectError(
        await action(extend, cast.am.cookie, { validUntil: businessDate() }),
        409,
        'INVALID_TRANSITION',
      );

      const reject = `/api/quotes/${quote.id}/reject`;
      const body = { respondedOn: businessDate(), reason: 'price' };
      await expectError(
        await action(reject, cast.am.cookie, { ...body, respondedOn: addDays(businessDate(), -1) }),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await action(reject, cast.am.cookie, { ...body, reason: 'other' }),
        400,
        'NOTE_REQUIRED',
      );
      await expectError(
        await action(reject, cast.am.cookie, { ...body, contactId: randomUUID() }),
        400,
        'UNKNOWN_CONTACT',
      );
      expect((await action(reject, cast.otherAm.cookie, body)).status).toBe(404);
      const rejected = await action(reject, cast.am.cookie, { ...body, contactId });
      expect(quoteDetailSchema.parse(await rejected.json())).toMatchObject({
        status: 'rejected',
        response: { rejectionReason: 'price', contact: { id: contactId }, by: { id: cast.am.id } },
        permissions: { canCreateVersion: true, canReject: false },
      });
      await expectError(await action(reject, cast.am.cookie, body), 409, 'INVALID_TRANSITION');
    });
  });

  describe('discard and lists', () => {
    it('archives drafts only, keeps their number and hides them', async () => {
      const draft = await createQuote();
      expect((await action(`/api/quotes/${draft.id}/archive`, finance.cookie)).status).toBe(403);
      expect((await action(`/api/quotes/${draft.id}/archive`)).status).toBe(204);
      await expectError(
        await action(`/api/quotes/${draft.id}/archive`, cast.operations.cookie),
        409,
        'INVALID_TRANSITION',
      );
      const next = await createQuote();
      expect(next.number).toBe(draft.number + 1);
      expect((await client.get(`/api/quotes/${draft.id}`, cast.am.cookie)).status).toBe(404);
      expect((await client.get('/api/quotes?archived=true', cast.am.cookie)).status).toBe(403);
      const archived = await client.get(
        `/api/quotes?archived=true&clientId=${clientId}`,
        cast.operations.cookie,
      );
      expect(quotePageSchema.parse(await archived.json()).items.map((q) => q.id)).toContain(
        draft.id,
      );
      const sentQuote = await sent(await builtQuote());
      await expectError(
        await action(`/api/quotes/${sentQuote.id}/archive`),
        409,
        'INVALID_TRANSITION',
      );
    });

    it('list the clients in scope and follow the account manager (G2, G3)', async () => {
      const other = await cast.createClient({ accountManagerId: cast.otherAm.id });
      const theirs = await createQuote(cast.otherAm.cookie, { clientId: other.id });
      const mine = await client.get(`/api/quotes?clientId=${other.id}`, cast.am.cookie);
      expect(quotePageSchema.parse(await mine.json()).items).toEqual([]);
      const financeList = await client.get(`/api/quotes?clientId=${other.id}`, finance.cookie);
      expect(quotePageSchema.parse(await financeList.json()).items.map((q) => q.id)).toEqual([
        theirs.id,
      ]);
      expect((await client.get('/api/quotes', cast.employee.cookie)).status).toBe(403);

      await patch(`/api/clients/${other.id}`, cast.gm.cookie, { accountManagerId: cast.am.id });
      expect((await client.get(`/api/quotes/${theirs.id}`, cast.am.cookie)).status).toBe(200);
      expect((await client.get(`/api/quotes/${theirs.id}`, cast.otherAm.cookie)).status).toBe(404);

      await client.post(`/api/clients/${other.id}/archive`, cast.gm.cookie);
      const hidden = await client.get(`/api/quotes?clientId=${other.id}`, cast.gm.cookie);
      expect(quotePageSchema.parse(await hidden.json()).items).toEqual([]);
      await expectError(
        await put(`/api/quotes/${theirs.id}`, cast.gm.cookie, draftOf(theirs)),
        409,
        'CLIENT_ARCHIVED',
      );
    });

    it('finds quotes by number and marks those expiring soon', async () => {
      const quote = await sent(await save(await builtQuote(), { validityDays: 2 }));
      const found = await client.get(
        `/api/quotes?search=${quote.number}&status=sent&clientId=${clientId}`,
        cast.am.cookie,
      );
      const items = quotePageSchema.parse(await found.json()).items;
      expect(items.find((item) => item.id === quote.id)?.expiresSoon).toBe(true);
    });
  });

  describe('access to actions and the remaining codes', () => {
    it('answers 403 without client scope and 404 outside read access', async () => {
      const draft = await builtQuote(68000);
      const expired = await sent(await builtQuote());
      await app.get(QuoteWorkflowService).runDaily(addDays(businessDate(), 20));
      const cases: [string, unknown][] = [
        [`/api/quotes/${draft.id}/approval`, { action: 'request' }],
        [`/api/quotes/${draft.id}/send`, {}],
        [`/api/quotes/${draft.id}/archive`, {}],
        [`/api/quotes/${expired.id}/extend`, { validUntil: addDays(businessDate(), 5) }],
        [`/api/quotes/${expired.id}/versions`, {}],
      ];
      for (const [path, body] of cases) {
        expect((await action(path, finance.cookie, body)).status, path).toBe(403);
        expect((await action(path, cast.otherAm.cookie, body)).status, path).toBe(404);
        expect((await action(path, cast.employee.cookie, body)).status, path).toBe(403);
      }
      expect(
        (
          await action(`/api/quotes/${randomUUID()}/approval/decision`, cast.gm.cookie, {
            decision: 'approve',
          })
        ).status,
      ).toBe(404);
    });

    it('refuses approval moves on locked or settled drafts', async () => {
      const quote = await builtQuote(68000);
      const approval = `/api/quotes/${quote.id}/approval`;
      await expectError(
        await action(approval, cast.am.cookie, { action: 'withdraw' }),
        409,
        'INVALID_TRANSITION',
      );
      await action(approval, cast.am.cookie, { action: 'request' });
      await expectError(await action(`/api/quotes/${quote.id}/send`), 409, 'APPROVAL_PENDING');
      await action(`/api/quotes/${quote.id}/approval/decision`, cast.gm.cookie, {
        decision: 'approve',
      });
      await sent(quote);
      await expectError(
        await action(approval, cast.am.cookie, { action: 'request' }),
        409,
        'QUOTE_LOCKED',
      );
    });

    it('copies the catalog description to a new line', async () => {
      await patch(`/api/catalog/services/${brand.id}`, cast.gm.cookie, {
        description: 'هوية كاملة',
      });
      const quote = await save(await createQuote(), {
        lines: [brandLine()],
        installments: [{ name: 'كامل', percent: 100 }],
      });
      expect(quote.lines[0]?.description).toBe('هوية كاملة');
      const cleared = await save(quote, {
        lines: [{ ...brandLine(), id: quote.lines[0]?.id, description: null }],
      });
      expect(cleared.lines[0]?.description).toBeNull();
    });

    it('keeps the quotes of an archived or ended client from moving (rule 1, G2)', async () => {
      const ending = await cast.createClient();
      const draft = await save(await createQuote(cast.am.cookie, { clientId: ending.id }), {
        lines: [goldLine()],
      });
      await patch(`/api/clients/${ending.id}`, cast.gm.cookie, { status: 'ended' });
      await expectError(await action(`/api/quotes/${draft.id}/send`), 409, 'CLIENT_ENDED');

      const archiving = await cast.createClient();
      const pending = await save(await createQuote(cast.am.cookie, { clientId: archiving.id }), {
        lines: [goldLine(30000)],
      });
      await action(`/api/quotes/${pending.id}/approval`, cast.am.cookie, { action: 'request' });
      const discarded = await createQuote(cast.am.cookie, { clientId: archiving.id });
      await action(`/api/quotes/${discarded.id}/archive`);
      expect(
        (await client.post(`/api/clients/${archiving.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await action(`/api/quotes/${pending.id}/approval/decision`, cast.gm.cookie, {
          decision: 'approve',
        }),
        409,
        'CLIENT_ARCHIVED',
      );
      await expectError(
        await action(`/api/quotes/${pending.id}/send`, cast.gm.cookie),
        409,
        'CLIENT_ARCHIVED',
      );
      const read = quoteDetailSchema.parse(
        await (await client.get(`/api/quotes/${pending.id}`, cast.gm.cookie)).json(),
      );
      expect(read.permissions.canDecideApproval).toBe(false);
      const archivedList = await client.get(
        `/api/quotes?archived=true&clientId=${archiving.id}`,
        cast.gm.cookie,
      );
      expect(quotePageSchema.parse(await archivedList.json()).items).toEqual([]);
    });
  });
});
