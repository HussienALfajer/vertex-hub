import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  businessDate,
  CONTRACTS_PDF_JOB,
  type ContractPdfJob,
  contractAnnexSchema,
  contractPdfJobSchema,
  contractPdfStorageKey,
  contractSettingsSchema,
  fileUploadSchema,
  quotePdfRenderSchema,
  type RetainerContractDetail,
  type RetainerDetail,
  retainerContractDetailSchema,
  retainerContractListSchema,
  retainerTermSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clientContacts,
  contractArticleTemplates,
  contractSettings,
  createDatabase,
  documentNumbers,
  fileItems,
  fileVersions,
  invoiceSettings,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { asc, eq, notInArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/core/jobs/index.js';
import { ContractPdfs } from '../src/modules/projects/index.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, clientIp, ORIGIN } from './helpers.js';
import { startApp } from './start-app.js';

/*
 * F05C K1–K12: retainer contracts and annexes. The worker's render is played by writing the bytes
 * where it would and calling the `contracts.pdf-ready` handler directly.
 */
describe('retainer contracts (F05C K1–K12)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let filesRoot: string;
  let pdfs: ContractPdfs;
  let clientId: string;
  let approverId: string;
  let savedSettings: typeof contractSettings.$inferSelect;
  let savedInvoiceSettings: typeof invoiceSettings.$inferSelect;
  let savedTemplate: (typeof contractArticleTemplates.$inferSelect)[];
  let savedCounter: (typeof documentNumbers.$inferSelect)[];
  const queued: ContractPdfJob[] = [];
  const today = businessDate();
  const year = Number(today.slice(0, 4));

  async function ok<T>(response: Response, parse: (body: unknown) => T, status = 200) {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return parse(await response.json());
  }
  const parseDetail = (body: unknown) => retainerContractDetailSchema.parse(body);

  const base = (retainerId: string) => `/api/retainers/${retainerId}/contracts`;
  const create = (retainerId: string, body: unknown, cookie = cast.am.cookie) =>
    client.post(base(retainerId), cookie, body);
  const patch = (retainerId: string, contractId: string, body: unknown, cookie = cast.am.cookie) =>
    client.request('PATCH', `${base(retainerId)}/${contractId}`, { cookie, body });
  const action = (
    retainerId: string,
    contractId: string,
    name: string,
    body: unknown = {},
    cookie = cast.am.cookie,
  ) => client.post(`${base(retainerId)}/${contractId}/${name}`, cookie, body);
  const detail = async (retainerId: string, contractId: string, cookie = cast.am.cookie) =>
    ok(await client.get(`${base(retainerId)}/${contractId}`, cookie), parseDetail);
  const list = async (retainerId: string, cookie = cast.am.cookie) =>
    (
      await ok(await client.get(base(retainerId), cookie), (body) =>
        retainerContractListSchema.parse(body),
      )
    ).items;
  const audits = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(asc(auditEntries.id));

  /** A retainer of the account manager's client starting today, with a fee. */
  async function retainer(): Promise<RetainerDetail> {
    return cast.createRetainer(clientId, { monthlyFeeMinor: 50_000 });
  }

  /** A scheduled 3-cycle term from cycle 2: 1,200 as 400 × 3, renewing. */
  async function term(retainerId: string) {
    return ok(
      await client.post(`/api/retainers/${retainerId}/terms`, cast.am.cookie, {
        startCycle: 2,
        cycles: 3,
        agreedTotalMinor: 120_000,
        schedule: [40_000, 40_000, 40_000],
        endAction: 'renew',
      }),
      (body) => retainerTermSchema.parse(body),
      201,
    );
  }

  async function draftFor(retainerId: string, body: unknown): Promise<RetainerContractDetail> {
    return ok(await create(retainerId, body), parseDetail, 201);
  }

  async function uploaded(cookie: string, fileName: string) {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4 signed']), fileName);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    expect(response.status).toBe(201);
    return fileUploadSchema.parse(await response.json());
  }

  /** What the worker does for a queued render: writes the bytes, then reports them. */
  async function work(job: ContractPdfJob) {
    const bytes = Buffer.from(`%PDF-1.7 ${job.hash}`);
    const storageKey = contractPdfStorageKey(job);
    const path = join(filesRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await pdfs.ready({
      kind: job.kind,
      id: job.id,
      hash: job.hash,
      file: {
        storageKey,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
  }

  const lastJob = (kind: ContractPdfJob['kind'], id: string) => {
    const job = queued.filter((item) => item.kind === kind && item.id === id).at(-1);
    if (!job) throw new Error(`No ${kind} render was queued for ${id}`);
    return job;
  };

  /** The agency details K4 requires. */
  const fillAgency = () =>
    db.update(contractSettings).set({
      legalName: 'شركة فيرتكس ميديا',
      tradeName: 'فيرتكس ميديا',
      representativeName: 'المدير العام',
      numberPrefix: 'VM-CCS',
    });

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-contracts-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    pdfs = app.get(ContractPdfs);
    vi.spyOn(app.get(JobQueue), 'send').mockImplementation(async (queue, data, options) => {
      if (queue !== CONTRACTS_PDF_JOB.queue) return;
      expect(options).toEqual({ retryLimit: CONTRACTS_PDF_JOB.retryLimit });
      queued.push(contractPdfJobSchema.parse(data));
    });
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    [savedSettings] = (await db.select().from(contractSettings)) as [
      typeof contractSettings.$inferSelect,
    ];
    [savedInvoiceSettings] = (await db.select().from(invoiceSettings)) as [
      typeof invoiceSettings.$inferSelect,
    ];
    savedTemplate = await db.select().from(contractArticleTemplates);
    savedCounter = await db
      .select()
      .from(documentNumbers)
      .where(eq(documentNumbers.kind, 'contract'));
    await db.update(invoiceSettings).set({ paymentTermsDays: 7 });
    await db.update(contractSettings).set({
      legalName: '',
      tradeName: '',
      representativeName: '',
      numberPrefix: 'VM-CCS',
    });
    clientId = (await cast.createClient()).id;
    const billing = await client.request('PATCH', `/api/clients/${clientId}`, {
      cookie: cast.gm.cookie,
      body: { billingAddress: 'دمشق، المزة', registrationNumber: 'CR-1234' },
    });
    expect(billing.status).toBe(200);
    approverId = (
      await cast.createContact(clientId, {
        name: 'سامر الأحمد',
        jobTitle: 'المدير التنفيذي',
        phone: '+963944000111',
        hasFinalApproval: true,
        fatherName: 'محمد',
        nationalId: '01020304050',
      })
    ).id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    if (savedSettings) await db.update(contractSettings).set(savedSettings);
    if (savedInvoiceSettings) await db.update(invoiceSettings).set(savedInvoiceSettings);
    if (savedTemplate) {
      // Test-only cleanup: the template returns to its seeded rows.
      const ids = savedTemplate.map(({ id }) => id);
      await db.delete(contractArticleTemplates).where(notInArray(contractArticleTemplates.id, ids));
    }
    if (savedCounter) {
      // Test-only cleanup: contract numbers start again where they were.
      await db.delete(documentNumbers).where(eq(documentNumbers.kind, 'contract'));
      if (savedCounter.length) await db.insert(documentNumbers).values(savedCounter);
    }
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session on every endpoint', async () => {
    const id = randomUUID();
    const contract = `${base(id)}/${id}`;
    expect((await client.get(base(id))).status).toBe(401);
    expect((await client.post(base(id), undefined, { kind: 'open_ended' })).status).toBe(401);
    expect((await client.get(contract)).status).toBe(401);
    expect((await client.request('PATCH', contract, { body: {} })).status).toBe(401);
    for (const name of ['discard', 'issue', 'void', 'signed', 'pdf']) {
      expect((await client.post(`${contract}/${name}`, undefined, {})).status).toBe(401);
    }
    expect((await client.get(`${contract}/pdf`)).status).toBe(401);
    const amendment = `/api/retainers/${id}/amendments/${id}/annex`;
    expect((await client.post(amendment, undefined, { annexDate: today })).status).toBe(401);
    for (const name of ['void', 'signed', 'pdf']) {
      expect((await client.post(`${contract}/annexes/${id}/${name}`, undefined, {})).status).toBe(
        401,
      );
    }
    expect((await client.get(`${contract}/annexes/${id}/pdf`)).status).toBe(401);
  });

  describe('a term contract', () => {
    let held: RetainerDetail;
    let termId: string;
    let draft: RetainerContractDetail;

    beforeAll(async () => {
      held = await retainer();
      termId = (await term(held.id)).id;
    });

    it('is prepared from the template with the approver as signatory (K1, K2)', async () => {
      draft = await draftFor(held.id, { kind: 'term', termId });
      expect(draft).toMatchObject({
        kind: 'term',
        status: 'draft',
        number: null,
        startCycle: 2,
        contractDate: today,
        signatoryContact: { id: approverId, name: 'سامر الأحمد' },
        term: { id: termId, startCycle: 2, cycles: 3 },
        canManage: true,
        changedSinceIssue: false,
      });
      expect(draft.articles).toHaveLength(savedTemplate.filter((row) => !row.archivedAt).length);
      expect(draft.articles[0]?.title).toBe('موضوع العقد');
      const [created] = await audits(draft.id);
      expect(created).toMatchObject({
        action: 'retainer_contract.created',
        after: { retainerId: held.id, kind: 'term', termId, startCycle: 2 },
      });
    });

    it('prints the parties, values and blocks live (K3, K6, K7)', async () => {
      const { content, missing, absentBlocks } = draft;
      expect(content.displayNumber).toBeNull();
      expect(content.client).toMatchObject({
        signatoryName: 'سامر الأحمد',
        fatherName: 'محمد',
        nationalId: '01020304050',
        registrationNumber: 'CR-1234',
        address: 'دمشق، المزة',
        title: 'المدير التنفيذي',
        phone: '+963944000111',
      });
      expect(content.articles[3]?.body).toContain('خلال 7 أيام');
      expect(content.services.deliverables).toEqual([
        { kind: 'design', label: null, quantity: 12, revisionLimit: null },
        { kind: 'reel', label: null, quantity: 4, revisionLimit: null },
      ]);
      expect(content.term).toMatchObject({ kind: 'term', cycles: 3, endAction: 'renew' });
      expect(content.fees.agreedTotalMinor).toBe(120_000);
      expect(content.fees.schedule.map((cycle) => [cycle.cycle, cycle.amountMinor])).toEqual([
        [2, 40_000],
        [3, 40_000],
        [4, 40_000],
      ]);
      expect(absentBlocks).toEqual([]);
      expect(missing).toContainEqual({ party: 'agency', field: 'legalName', required: true });
      expect(missing).toContainEqual({ party: 'agency', field: 'website', required: false });
      // Finance reads contracts without national ID access (edge case 12).
      const seen = await detail(held.id, draft.id, finance.cookie);
      expect(seen.content.client.nationalId).toBeUndefined();
      expect(seen.canManage).toBe(false);
    });

    it('refuses a second draft for the term (edge case 10)', async () => {
      const refused = await expectError(
        await create(held.id, { kind: 'term', termId }),
        409,
        'CONTRACT_EXISTS',
      );
      expect(refused.details).toEqual({ contractId: draft.id });
    });

    it('edits the draft: date, signatory and articles (K2)', async () => {
      const [first, second, ...rest] = draft.articles;
      if (!first || !second) throw new Error('No articles');
      const articles = [
        second,
        { ...first, title: 'موضوع العقد المعدل' },
        ...rest.slice(0, -1),
        { title: 'مادة جديدة', body: 'نص لـ{client_name}' },
      ];
      const edited = await ok(
        await patch(held.id, draft.id, { contractDate: '2026-10-01', articles }),
        parseDetail,
      );
      expect(edited.contractDate).toBe('2026-10-01');
      expect(edited.articles.map(({ title }) => title).slice(0, 2)).toEqual([
        second.title,
        'موضوع العقد المعدل',
      ]);
      expect(edited.articles).toHaveLength(draft.articles.length);
      expect(edited.articles.at(-1)?.title).toBe('مادة جديدة');
      expect(edited.content.articles.at(-1)?.body).toMatch(/^نص لـعميل/);
      const updated = (await audits(draft.id)).at(-1);
      expect(updated).toMatchObject({
        action: 'retainer_contract.updated',
        before: { contractDate: today },
        after: { retainerId: held.id, contractDate: '2026-10-01' },
      });
      draft = edited;
    });

    it('refuses unknown placeholders, too many articles and other clients’ contacts', async () => {
      await expectError(
        await patch(held.id, draft.id, { articles: [{ title: 'م', body: '{client}' }] }),
        400,
        'UNKNOWN_PLACEHOLDER',
      );
      const many = Array.from({ length: 41 }, (_, index) => ({ title: `م${index}`, body: '' }));
      await expectError(await patch(held.id, draft.id, { articles: many }), 409, 'LIMIT_REACHED');
      const otherClient = await cast.createClient();
      const stranger = await cast.createContact(otherClient.id);
      await expectError(
        await patch(held.id, draft.id, { signatoryContactId: stranger.id }),
        400,
        'UNKNOWN_CONTACT',
      );
    });

    it('lets only contract managers with money access change it', async () => {
      expect((await patch(held.id, draft.id, {}, finance.cookie)).status).toBe(403);
      expect((await patch(held.id, draft.id, {}, cast.otherAm.cookie)).status).toBe(403);
      expect((await patch(held.id, draft.id, {}, cast.employee.cookie)).status).toBe(403);
      expect((await create(held.id, { kind: 'open_ended' }, finance.cookie)).status).toBe(403);
      expect((await action(held.id, draft.id, 'issue', {}, finance.cookie)).status).toBe(403);
      // Reading needs money access covering the client.
      expect((await client.get(base(held.id), cast.employee.cookie)).status).toBe(403);
      expect((await client.get(base(held.id), cast.otherAm.cookie)).status).toBe(403);
      expect(await list(held.id, finance.cookie)).toHaveLength(1);
      expect((await client.get(`${base(held.id)}/${randomUUID()}`, cast.am.cookie)).status).toBe(
        404,
      );
      expect((await client.get(`${base(randomUUID())}`, cast.am.cookie)).status).toBe(404);
    });

    it('previews the draft for managers (K3)', async () => {
      const render = await ok(await action(held.id, draft.id, 'pdf'), (body) =>
        quotePdfRenderSchema.parse(body),
      );
      expect(render.state).toBe('pending');
      expect((await action(held.id, draft.id, 'pdf', {}, finance.cookie)).status).toBe(403);
      await work(lastJob('contract_draft', draft.id));
      const previewed = await detail(held.id, draft.id);
      expect(previewed.draftPdf).toMatchObject({ state: 'ready', outdated: false });
      const response = await client.get(
        `${base(held.id)}/${draft.id}/pdf?draft=true`,
        cast.am.cookie,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
    });

    it('needs the agency’s legal details and a signatory to issue (K4)', async () => {
      const refused = await expectError(
        await action(held.id, draft.id, 'issue'),
        409,
        'CONTRACT_INCOMPLETE',
      );
      expect(refused.details).toEqual({
        missing: [
          { party: 'agency', field: 'legalName', required: true },
          { party: 'agency', field: 'tradeName', required: true },
          { party: 'agency', field: 'representativeName', required: true },
        ],
      });
      await fillAgency();
      // Edge case 11: an archived signatory is refused.
      await db
        .update(clientContacts)
        .set({ archivedAt: new Date() })
        .where(eq(clientContacts.id, approverId));
      await expectError(await action(held.id, draft.id, 'issue'), 400, 'UNKNOWN_CONTACT');
      await db
        .update(clientContacts)
        .set({ archivedAt: null })
        .where(eq(clientContacts.id, approverId));
    });

    it('issues with the year’s next number, frozen, its PDF a contract document (K4)', async () => {
      const settings = await ok(
        await client.get('/api/contract-settings', cast.am.cookie),
        (body) => contractSettingsSchema.parse(body),
      );
      const issued = await ok(await action(held.id, draft.id, 'issue'), parseDetail);
      expect(issued.number).toBe(settings.nextNumber);
      expect(issued.number).toMatch(new RegExp(`^VM-CCS-${year}-\\d{3,}$`));
      expect(issued).toMatchObject({ status: 'issued', pdf: { state: 'pending' }, draftPdf: null });
      expect(issued.content.displayNumber).toBe(issued.number);
      expect(issued.issuedBy?.id).toBe(cast.am.id);
      const next = await ok(await client.get('/api/contract-settings', cast.am.cookie), (body) =>
        contractSettingsSchema.parse(body),
      );
      expect(next.nextNumber).not.toBe(settings.nextNumber);
      await expectError(
        await patch(held.id, draft.id, { contractDate: today }),
        409,
        'INVALID_TRANSITION',
      );
      // K3: later changes never change an issued contract.
      await db.update(contractSettings).set({ tradeName: 'اسم آخر' });
      expect((await detail(held.id, draft.id)).content.agency.tradeName).toBe('فيرتكس ميديا');
      await work(lastJob('contract', draft.id));
      expect((await detail(held.id, draft.id)).pdf).toEqual({ state: 'ready' });
      const [document] = await db
        .select()
        .from(fileItems)
        .where(eq(fileItems.retainerContractId, draft.id));
      expect(document).toMatchObject({
        ownerType: 'retainer_contract',
        clientId,
        role: 'document',
        name: `${issued.number}.pdf`,
      });
      const response = await client.get(`${base(held.id)}/${draft.id}/pdf`, finance.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain(
        encodeURIComponent(issued.number ?? ''),
      );
      // Safe to run twice: attached once.
      await work(lastJob('contract', draft.id));
      expect(
        await db.select().from(fileItems).where(eq(fileItems.retainerContractId, draft.id)),
      ).toHaveLength(1);
      const issuedAudit = (await audits(draft.id)).at(-1);
      expect(issuedAudit).toMatchObject({
        action: 'retainer_contract.issued',
        after: { retainerId: held.id, status: 'issued', contractNumber: issued.number },
      });
      draft = issued;
    });

    it('shows "changed since issue" when the term is edited (K9, edge case 9)', async () => {
      const edited = await client.request('PATCH', `/api/retainers/${held.id}/terms/${termId}`, {
        cookie: cast.am.cookie,
        body: { endAction: 'end' },
      });
      expect(edited.status).toBe(200);
      const [item] = await list(held.id);
      expect(item?.changedSinceIssue).toBe(true);
      expect((await detail(held.id, draft.id)).content.term.endAction).toBe('renew');
    });

    it('keeps the signed copy as a document, a new upload its next version (K5)', async () => {
      const first = await uploaded(cast.am.cookie, 'scan.pdf');
      const signed = await ok(
        await action(held.id, draft.id, 'signed', { signedOn: today, uploadId: first.uploadId }),
        parseDetail,
      );
      expect(signed.status).toBe('signed');
      expect(signed.signed?.signedOn).toBe(today);
      const itemId = signed.signed?.fileItemId ?? '';
      const second = await uploaded(cast.am.cookie, 'scan-2.pdf');
      const again = await ok(
        await action(held.id, draft.id, 'signed', { signedOn: today, uploadId: second.uploadId }),
        parseDetail,
      );
      expect(again.signed?.fileItemId).toBe(itemId);
      expect(
        await db.select().from(fileVersions).where(eq(fileVersions.fileItemId, itemId)),
      ).toHaveLength(2);
      await expectError(
        await action(held.id, draft.id, 'signed', { signedOn: today, uploadId: first.uploadId }),
        400,
        'UPLOAD_NOT_FOUND',
      );
      expect((await audits(draft.id)).at(-1)).toMatchObject({
        action: 'retainer_contract.signed',
        after: { status: 'signed', signedOn: today },
      });
    });

    it('is voided with a reason; then a new draft may be prepared (K8)', async () => {
      expect((await action(held.id, draft.id, 'void', { reason: ' ' })).status).toBe(400);
      const voided = await ok(
        await action(held.id, draft.id, 'void', { reason: 'تغيّرت المدة' }),
        parseDetail,
      );
      expect(voided).toMatchObject({
        status: 'void',
        number: draft.number,
        voided: { reason: 'تغيّرت المدة' },
      });
      await expectError(
        await action(held.id, draft.id, 'void', { reason: 'مرة أخرى' }),
        409,
        'INVALID_TRANSITION',
      );
      const fresh = await draftFor(held.id, { kind: 'term', termId });
      expect(fresh.status).toBe('draft');
    });

    it('discards a draft by archiving it (K8)', async () => {
      const [current] = await list(held.id);
      if (current?.status !== 'draft') throw new Error('No draft');
      const discarded = await ok(await action(held.id, current.id, 'discard'), parseDetail);
      expect(discarded.canManage).toBe(false);
      expect((await list(held.id)).map(({ id }) => id)).not.toContain(current.id);
      await expectError(await action(held.id, current.id, 'issue'), 409, 'INVALID_TRANSITION');
      expect((await audits(current.id)).at(-1)?.action).toBe('retainer_contract.discarded');
    });

    it('refuses a contract for a cancelled term', async () => {
      const cancelled = await client.post(
        `/api/retainers/${held.id}/terms/${termId}/cancel`,
        cast.am.cookie,
        { reason: 'لم يعد مطلوباً' },
      );
      expect(cancelled.status).toBe(200);
      await expectError(await create(held.id, { kind: 'term', termId }), 409, 'INVALID_TRANSITION');
      expect((await create(held.id, { kind: 'term', termId: randomUUID() })).status).toBe(404);
    });
  });

  describe('an open-ended contract and its annexes (K10)', () => {
    let held: RetainerDetail;
    let contract: RetainerContractDetail;

    /** An amendment by the General Manager, applied at once in the current cycle. */
    async function amendment(body: Record<string, unknown>) {
      const response = await client.post(`/api/retainers/${held.id}/amendments`, cast.gm.cookie, {
        scope: 'cycle',
        effectiveCycle: 1,
        reason: 'طلب العميل',
        ...body,
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: string; status: string };
      expect(created.status).toBe('applied');
      return created.id;
    }

    const annex = (amendmentId: string, cookie = cast.am.cookie) =>
      client.post(`/api/retainers/${held.id}/amendments/${amendmentId}/annex`, cookie, {
        annexDate: today,
      });

    beforeAll(async () => {
      await fillAgency();
      held = await retainer();
    });

    it('needs an issued contract covering the amendment’s cycle', async () => {
      const early = await amendment({ lines: [{ kind: 'reel', quantityDelta: 1 }] });
      await expectError(await annex(early), 409, 'NO_CONTRACT');
    });

    it('covers the open-ended retainer from its current cycle (K1)', async () => {
      contract = await draftFor(held.id, { kind: 'open_ended' });
      expect(contract).toMatchObject({ kind: 'open_ended', startCycle: 1, term: null });
      expect(contract.content.term).toMatchObject({ kind: 'open_ended', cycles: null });
      expect(contract.content.fees).toMatchObject({ agreedTotalMinor: null, feeMinor: 50_000 });
      await expectError(await create(held.id, { kind: 'open_ended' }), 409, 'CONTRACT_EXISTS');
      contract = await ok(await action(held.id, contract.id, 'issue'), parseDetail);
      expect(contract.status).toBe('issued');
    });

    it('issues numbered annexes for applied changes on demand (K9, K10)', async () => {
      const change = await amendment({
        lines: [{ kind: 'reel', quantityDelta: 2 }],
        amountDeltaMinor: 5_000,
      });
      expect((await list(held.id))[0]?.changedSinceIssue).toBe(true);
      expect((await annex(change, finance.cookie)).status).toBe(403);
      const first = await ok(await annex(change), (body) => contractAnnexSchema.parse(body), 201);
      expect(first).toMatchObject({
        contractId: contract.id,
        annexNumber: 1,
        status: 'issued',
        annexDate: today,
        pdf: { state: 'pending' },
      });
      const job = lastJob('annex', first.id);
      if (job.kind !== 'annex') throw new Error('Not an annex render');
      expect(job.snapshot).toMatchObject({
        annexNumber: 1,
        contractNumber: contract.number,
        amendment: {
          kind: 'change',
          scope: 'cycle',
          effectiveCycle: 1,
          amountDeltaMinor: 5_000,
          lines: [{ kind: 'reel', quantityDelta: 2 }],
        },
      });
      await expectError(await annex(change), 409, 'INVALID_TRANSITION');
      const [item] = await list(held.id);
      expect(item?.changedSinceIssue).toBe(false);
      expect(item?.annexes.map(({ annexNumber }) => annexNumber)).toEqual([1]);
      await work(job);
      const response = await client.get(
        `${base(held.id)}/${contract.id}/annexes/${first.id}/pdf`,
        finance.cookie,
      );
      expect(response.status).toBe(200);
      expect((await audits(first.id))[0]).toMatchObject({
        action: 'retainer_contract_annex.issued',
        after: { retainerId: held.id, annexNumber: 1, amendmentId: change },
      });

      const signedCopy = await uploaded(cast.am.cookie, 'annex.pdf');
      const annexPath = `${base(held.id)}/${contract.id}/annexes/${first.id}`;
      const signed = await ok(
        await client.post(`${annexPath}/signed`, cast.am.cookie, {
          signedOn: today,
          uploadId: signedCopy.uploadId,
        }),
        (body) => contractAnnexSchema.parse(body),
      );
      expect(signed.status).toBe('signed');
      const voided = await ok(
        await client.post(`${annexPath}/void`, cast.am.cookie, { reason: 'خطأ في التاريخ' }),
        (body) => contractAnnexSchema.parse(body),
      );
      expect(voided).toMatchObject({ status: 'void', voided: { reason: 'خطأ في التاريخ' } });
      // A void annex frees the amendment: the next annex takes number 2.
      const second = await ok(await annex(change), (body) => contractAnnexSchema.parse(body), 201);
      expect(second.annexNumber).toBe(2);
      // A rendered annex is not rendered again; one still pending is queued again by the daily run.
      const rendered = await client.post(`${annexPath}/pdf`, finance.cookie, {});
      expect(quotePdfRenderSchema.parse(await rendered.json())).toEqual({ state: 'ready' });
      const before = queued.length;
      expect(await pdfs.requeuePending()).toBeGreaterThanOrEqual(1);
      expect(queued.slice(before).some((job) => job.id === second.id)).toBe(true);
    });

    it('gives no annex to an amendment that is not applied', async () => {
      const pending = await client.post(`/api/retainers/${held.id}/amendments`, cast.am.cookie, {
        scope: 'onward',
        effectiveCycle: 3,
        amountDeltaMinor: 10_000,
        reason: 'زيادة',
      });
      expect(pending.status).toBe(201);
      const { id, status } = (await pending.json()) as { id: string; status: string };
      expect(status).toBe('scheduled');
      await expectError(await annex(id), 409, 'INVALID_TRANSITION');
    });
  });
});
