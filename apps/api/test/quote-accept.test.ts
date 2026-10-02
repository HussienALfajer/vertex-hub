import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  type AcceptPlan,
  type AcceptQuoteInput,
  acceptPlanSchema,
  addDays,
  addMonths,
  businessDate,
  type CatalogPackage,
  type CatalogService,
  catalogPackageSchema,
  catalogServiceSchema,
  deliverableLineListSchema,
  fileUploadSchema,
  firstOfMonth,
  projectDetailSchema,
  type QuoteDetail,
  type QuoteDraftInput,
  quoteDetailSchema,
  quotePageSchema,
  retainerDetailSchema,
  templateDetailSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clients,
  createDatabase,
  fileItems,
  notifications,
  projects,
  quotes,
  retainers,
  tasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuoteWorkflowService } from '../src/modules/quotes/quote-workflow.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, clientIp, ORIGIN, removeCatalog, removeClients, removeTemplates } from './helpers.js';
import { startApp } from './start-app.js';

describe('quote acceptance (F04 A01)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let filesRoot: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let designManager: { id: string; cookie: string };
  let clientId: string;
  let contactId: string;
  let brand: CatalogService;
  let design: CatalogService;
  let reel: CatalogService;
  let page: CatalogService;
  let gold: CatalogPackage;
  let projectTemplate: string;
  let monthlyTemplate: string;
  const services: string[] = [];
  const packages: string[] = [];
  const templates: string[] = [];
  const today = businessDate();

  const name = (label: string) => `${label} ${cast.run} ${randomUUID().slice(0, 6)}`;

  async function created<T>(response: Response, parse: (body: unknown) => T, status = 201) {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return parse(await response.json());
  }

  const createService = async (input: Record<string, unknown>) => {
    const service = await created(
      await client.post('/api/catalog/services', cast.gm.cookie, {
        name: name('خدمة'),
        department: 'design',
        billing: 'monthly',
        priceUsdMinor: 1500,
        ...input,
      }),
      (body) => catalogServiceSchema.parse(body),
    );
    services.push(service.id);
    return service;
  };

  const createTemplate = async (input: Record<string, unknown>) => {
    const template = await created(
      await client.post('/api/templates', cast.operations.cookie, input),
      (body) => templateDetailSchema.parse(body),
    );
    templates.push(template.id);
    return template.id;
  };

  const detail = async (id: string, cookie = cast.am.cookie) =>
    created(
      await client.get(`/api/quotes/${id}`, cookie),
      (body) => quoteDetailSchema.parse(body),
      200,
    );

  const brandLine = {
    section: 'one_off' as const,
    serviceId: '',
    quantity: 1,
    unitPriceMinor: 80000,
    revisionRounds: 3,
  };

  const goldLine = () => ({
    section: 'monthly' as const,
    packageId: gold.id,
    quantity: 1,
    unitPriceMinor: 45000,
    items: gold.items.map((item) => ({
      serviceId: item.serviceId,
      quantity: item.quantity,
      // Designs come with 1 round, the rest with 2 (A6 takes the highest per line).
      revisionRounds: item.serviceId === design.id ? 1 : 2,
    })),
  });

  /** A sent quote; the default holds "Brand identity" and "Gold social" with a 6-month term. */
  async function sentQuote(
    input: Partial<QuoteDraftInput> = {},
    currency = 'USD',
    forClient = clientId,
  ) {
    const quote = await created(
      await client.post('/api/quotes', cast.am.cookie, {
        clientId: forClient,
        title: name('عرض'),
        currency,
      }),
      (body) => quoteDetailSchema.parse(body),
    );
    const draft: QuoteDraftInput = {
      updatedAt: quote.updatedAt,
      contactId: null,
      title: quote.title,
      currency: quote.currency,
      validityDays: quote.validityDays,
      oneOffDiscountMinor: 0,
      monthlyDiscountMinor: 0,
      monthlyTermMonths: 6,
      clientNotes: null,
      terms: null,
      lines: [{ ...brandLine, serviceId: brand.id }, goldLine()],
      installments: [
        { name: 'البداية', percent: 50 },
        { name: 'التسليم', percent: 50 },
      ],
      ...input,
    };
    await created(
      await client.request('PUT', `/api/quotes/${quote.id}`, {
        cookie: cast.am.cookie,
        body: draft,
      }),
      (body) => quoteDetailSchema.parse(body),
      200,
    );
    return created(
      await client.post(`/api/quotes/${quote.id}/send`, cast.am.cookie, { confirmZeroPrice: true }),
      (body) => quoteDetailSchema.parse(body),
      200,
    );
  }

  const planOf = async (quote: QuoteDetail, query = '', cookie = cast.am.cookie) =>
    created(
      await client.get(`/api/quotes/${quote.id}/accept-plan${query}`, cookie),
      (body) => acceptPlanSchema.parse(body),
      200,
    );

  /** The dialog's defaults as the accept body. */
  const acceptBody = (
    plan: AcceptPlan,
    input: Partial<AcceptQuoteInput> = {},
  ): AcceptQuoteInput => ({
    respondedOn: today,
    project: plan.project && {
      name: plan.project.name,
      projectManagerId: plan.project.projectManager.id,
      departments: plan.project.departments,
      startDate: plan.project.startDate,
      dueDate: plan.project.dueDate,
      templateIds: plan.project.templates.filter((t) => t.selected).map((t) => t.id),
      installmentMilestones: plan.project.installments.map((i) => i.milestone),
    },
    retainer: plan.retainer && {
      mode: 'new',
      name: plan.retainer.name,
      departments: plan.retainer.departments,
      startDate: plan.retainer.startDate,
      renewalDate: plan.retainer.renewalDate,
      templateId: plan.retainer.template?.id ?? null,
    },
    ...input,
  });

  const accept = (quote: QuoteDetail, body: unknown, cookie = cast.am.cookie) =>
    client.post(`/api/quotes/${quote.id}/accept`, cookie, body);

  async function uploaded(cookie: string, fileName: string) {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4 proof']), fileName);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    return created(response, (body) => fileUploadSchema.parse(body));
  }

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-quote-accept-'));
    process.env.FILES_ROOT = filesRoot;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    designManager = await cast.signedIn({ departments: [{ code: 'design', manager: true }] });
    const designer = await cast.signedIn({ departments: [{ code: 'design' }] });
    clientId = (await cast.createClient()).id;
    const contact = await client.post(`/api/clients/${clientId}/contacts`, cast.gm.cookie, {
      name: 'سارة',
    });
    contactId = ((await contact.json()) as { id: string }).id;

    projectTemplate = await createTemplate({
      name: `هوية ${cast.run}`,
      kind: 'project',
      stages: [
        { key: 'discovery', name: 'الاستكشاف' },
        { key: 'design', name: 'التصميم' },
      ],
      steps: [
        { key: 'brief', stageKey: 'discovery', title: 'Brief', department: 'design', dueDay: 1 },
        {
          key: 'logo',
          stageKey: 'design',
          title: 'Logo',
          department: 'design',
          dueDay: 6,
          revisionLimit: 5,
          dependsOn: ['brief'],
        },
      ],
      assignees: [{ department: 'design', userId: designer.id }],
    });
    monthlyTemplate = await createTemplate({
      name: `شهري ${cast.run}`,
      kind: 'retainer_cycle',
      steps: [
        { key: 'plan', title: 'Plan', department: 'design', dueDay: 1 },
        {
          key: 'design',
          title: 'Design',
          department: 'design',
          repeatKind: 'design',
          spreadFromDay: 2,
          revisionLimit: 4,
        },
      ],
    });

    brand = await createService({
      billing: 'one_off',
      priceUsdMinor: 80000,
      revisionRounds: 3,
      templateId: projectTemplate,
    });
    design = await createService({ deliverableKind: 'design', priceSypMinor: 150000 });
    reel = await createService({
      department: 'photography',
      priceUsdMinor: 6000,
      deliverableKind: 'reel',
    });
    page = await createService({ department: 'content_management', priceUsdMinor: 10000 });
    gold = await created(
      await client.post('/api/catalog/packages', cast.gm.cookie, {
        name: name('باقة'),
        billing: 'monthly',
        priceUsdMinor: 45000,
        templateId: monthlyTemplate,
        items: [
          { serviceId: design.id, quantity: 12 },
          { serviceId: reel.id, quantity: 4 },
          { serviceId: page.id, quantity: 2 },
        ],
      }),
      (body) => catalogPackageSchema.parse(body),
    );
    packages.push(gold.id);
  });

  afterAll(async () => {
    await app?.close();
    // Quotes hold catalog items, which hold templates, which hold their creator.
    if (cast) {
      const ownClients = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.accountManagerId, cast.am.id));
      await removeClients(
        db,
        ownClients.map((row) => row.id),
      );
    }
    await removeCatalog(db, services, packages);
    await removeTemplates(db, templates);
    await cast?.cleanup();
    await connection.close();
    if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
    delete process.env.FILES_ROOT;
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get(`/api/quotes/${id}/accept-plan`)).status).toBe(401);
    expect((await client.post(`/api/quotes/${id}/accept`, undefined, {})).status).toBe(401);
  });

  it('is refused without quotes.manage and projects.manage, and outside the scope', async () => {
    const quote = await sentQuote();
    const plan = await planOf(quote);
    expect((await client.get(`/api/quotes/${quote.id}/accept-plan`, finance.cookie)).status).toBe(
      403,
    );
    expect((await accept(quote, acceptBody(plan), finance.cookie)).status).toBe(403);
    expect(
      (await client.get(`/api/quotes/${quote.id}/accept-plan`, cast.employee.cookie)).status,
    ).toBe(403);
    expect((await accept(quote, acceptBody(plan), cast.employee.cookie)).status).toBe(403);
    expect(
      (await client.get(`/api/quotes/${quote.id}/accept-plan`, cast.otherAm.cookie)).status,
    ).toBe(404);
    expect((await accept(quote, acceptBody(plan), cast.otherAm.cookie)).status).toBe(404);
    expect((await detail(quote.id, finance.cookie)).permissions.canAccept).toBe(false);
    expect((await detail(quote.id)).permissions.canAccept).toBe(true);
  });

  it('plans the defaults of both sections (A2–A6)', async () => {
    const existing = await cast.createRetainer(clientId);
    const quote = await sentQuote();
    const plan = await planOf(quote);
    expect(plan.sentOn).toBe(today);
    expect(plan.project).toMatchObject({
      name: quote.title,
      projectManager: { id: cast.am.id },
      departments: ['design'],
      startDate: today,
      templates: [{ id: projectTemplate, selected: true, revisionLimit: 3 }],
      milestones: [{ name: 'الاستكشاف' }, { name: 'التصميم' }],
      installments: [
        { name: 'البداية', amountMinor: 40000, milestone: 0 },
        { name: 'التسليم', amountMinor: 40000, milestone: 1 },
      ],
    });
    expect(plan.project?.dueDate).toBe(plan.project?.milestones[1]?.dueDate);
    expect(plan.retainer).toMatchObject({
      name: quote.title,
      departments: ['design', 'photography', 'content_management'],
      startDate: today,
      renewalDate: addMonths(today, 6),
      template: { id: monthlyTemplate },
      currency: 'USD',
      monthlyFeeMinor: 45000,
      // Page management is not counted (A6).
      lines: [
        { kind: 'design', label: null, monthlyQuantity: 12, revisionLimit: 1 },
        { kind: 'reel', label: null, monthlyQuantity: 4, revisionLimit: 2 },
      ],
    });
    expect(plan.retainer?.renewable.map((r) => r.id)).toContain(existing.id);
    expect(plan.archivedTemplates).toEqual([]);

    // Without templates: one milestone per installment, due in 30 days.
    const bare = await planOf(quote, '?chooseTemplates=true&projectStartDate=2030-01-10');
    expect(bare.project).toMatchObject({
      startDate: '2030-01-10',
      dueDate: '2030-02-09',
      templates: [{ id: projectTemplate, selected: false }],
      milestones: [
        { name: 'البداية', dueDate: null },
        { name: 'التسليم', dueDate: null },
      ],
      installments: [{ milestone: 0 }, { milestone: 1 }],
    });
  });

  it('accepts: project, template tasks, retainer, cycle tasks, proof, audit, notices (A1–A11)', async () => {
    const quote = await sentQuote();
    const plan = await planOf(quote);
    const proof = await uploaded(cast.am.cookie, `إثبات ${cast.run}.pdf`);
    const response = await accept(
      quote,
      acceptBody(plan, { contactId, note: 'وافق بالهاتف', proofUploadId: proof.uploadId }),
    );
    const accepted = await created(response, (body) => quoteDetailSchema.parse(body), 200);
    expect(accepted).toMatchObject({
      status: 'accepted',
      response: { respondedOn: today, contact: { id: contactId }, note: 'وافق بالهاتف' },
      project: { name: quote.title },
      retainer: { name: quote.title },
      permissions: { canAccept: false, canReject: false, canCreateVersion: false },
    });
    const projectId = accepted.project?.id as string;
    const retainerId = accepted.retainer?.id as string;

    // A3: the stages as milestones, each with its installment.
    const project = await created(
      await client.get(`/api/projects/${projectId}`, cast.gm.cookie),
      (body) => projectDetailSchema.parse(body),
      200,
    );
    expect(project.milestones.map((m) => [m.name, m.money?.installmentMinor])).toEqual([
      ['الاستكشاف', 40000],
      ['التصميم', 40000],
    ]);
    expect(project.projectManager.id).toBe(cast.am.id);
    // A4: the template's tasks with the line's rounds, on the matching milestones.
    const projectTasks = await db
      .select({
        title: tasks.title,
        revisionLimit: tasks.revisionLimit,
        milestoneId: tasks.milestoneId,
        createdById: tasks.createdById,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.title));
    expect(projectTasks.map((t) => [t.title, t.revisionLimit])).toEqual([
      ['Brief', 3],
      ['Logo', 3],
    ]);
    expect(projectTasks.map((t) => t.milestoneId)).toEqual(project.milestones.map((m) => m.id));
    expect(projectTasks.every((t) => t.createdById === null)).toBe(true);

    // A5–A8: the retainer with its lines, fee, renewal date and this month's cycle.
    const retainer = await created(
      await client.get(`/api/retainers/${retainerId}`, cast.gm.cookie),
      (body) => retainerDetailSchema.parse(body),
      200,
    );
    expect(retainer).toMatchObject({
      renewalDate: addMonths(today, 6),
      money: { currency: 'USD', monthlyFeeMinor: 45000 },
    });
    expect(retainer.deliverables.map((l) => [l.kind, l.monthlyQuantity, l.revisionLimit])).toEqual([
      ['design', 12, 1],
      ['reel', 4, 2],
    ]);
    const cycle = retainer.currentCycle;
    expect(cycle?.lines.map((l) => [l.kind, l.committed, l.revisionLimit])).toEqual([
      ['design', 12, 1],
      ['reel', 4, 2],
    ]);
    // F07 rule 16 ran on the new cycle; a line's rounds replace the step's (4).
    const cycleTasks = await db
      .select({ title: tasks.title, revisionLimit: tasks.revisionLimit })
      .from(tasks)
      .where(and(eq(tasks.retainerCycleId, cycle?.id as string), isNotNull(tasks.cycleLineId)));
    expect(cycleTasks).toHaveLength(12);
    expect(cycleTasks.every((t) => t.revisionLimit === 1)).toBe(true);

    // The proof is a document of the quote.
    const [document] = await db
      .select({ name: fileItems.name, role: fileItems.role })
      .from(fileItems)
      .where(and(eq(fileItems.quoteId, quote.id), eq(fileItems.name, `إثبات ${cast.run}.pdf`)));
    expect(document).toEqual({ name: `إثبات ${cast.run}.pdf`, role: 'document' });

    // Audit in the same transaction, and A11's notices.
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, quote.id), eq(auditEntries.action, 'quote.accepted')));
    expect(entry?.after).toMatchObject({
      status: 'accepted',
      projectId,
      retainerId,
      proofFile: `إثبات ${cast.run}.pdf`,
    });
    const notices = await db
      .select({ recipientId: notifications.recipientId })
      .from(notifications)
      .where(and(eq(notifications.subjectId, quote.id), eq(notifications.type, 'quote_accepted')));
    const recipients = notices.map((n) => n.recipientId);
    expect(recipients).toContain(designManager.id);
    expect(recipients).not.toContain(cast.am.id);

    // The list finds it by its engagements.
    const listed = await created(
      await client.get(
        `/api/quotes?status=accepted&projectId=${projectId}&retainerId=${retainerId}`,
        cast.am.cookie,
      ),
      (body) => quotePageSchema.parse(body),
      200,
    );
    expect(listed.items.map((item) => item.id)).toEqual([quote.id]);

    // Edge case 5: a second accept finds it accepted.
    await expectError(await accept(quote, acceptBody(plan)), 409, 'INVALID_TRANSITION');
  });

  it('rolls everything back when a rule refuses (A9)', async () => {
    const quote = await sentQuote();
    const plan = await planOf(quote);
    const taken = await cast.createProject(clientId, { name: `مأخوذ ${cast.run}` });
    const retainerName = name('عقد');
    const body = acceptBody(plan);
    const proof = await uploaded(cast.am.cookie, `rollback ${cast.run}.pdf`);
    await expectError(
      await accept(quote, {
        ...body,
        proofUploadId: proof.uploadId,
        project: { ...body.project, name: taken.name },
        retainer: { ...body.retainer, name: retainerName },
      }),
      409,
      'PROJECT_NAME_TAKEN',
    );
    expect((await detail(quote.id)).status).toBe('sent');
    expect(await db.select().from(retainers).where(eq(retainers.name, retainerName))).toHaveLength(
      0,
    );
    expect(await db.select().from(projects).where(eq(projects.name, quote.title))).toHaveLength(0);
    // The upload was not used up.
    const retried = await accept(quote, { ...body, proofUploadId: proof.uploadId });
    expect(retried.status).toBe(200);
  });

  it('checks the response, the sections and the milestones', async () => {
    const quote = await sentQuote();
    const plan = await planOf(quote);
    const body = acceptBody(plan);
    await expectError(
      await accept(quote, { ...body, respondedOn: addDays(today, 1) }),
      400,
      'INVALID_DATES',
    );
    await expectError(
      await accept(quote, { ...body, respondedOn: addDays(today, -1) }),
      400,
      'INVALID_DATES',
    );
    await expectError(
      await accept(quote, { ...body, contactId: randomUUID() }),
      400,
      'UNKNOWN_CONTACT',
    );
    await expectError(
      await accept(quote, { ...body, proofUploadId: randomUUID() }),
      400,
      'UPLOAD_NOT_FOUND',
    );
    expect((await accept(quote, { ...body, retainer: null })).status).toBe(400);
    await expectError(
      await accept(quote, {
        ...body,
        project: { ...body.project, projectManagerId: randomUUID() },
      }),
      400,
      'INVALID_PROJECT_MANAGER',
    );
    // A proof named like a document the quote already has.
    await db.insert(fileItems).values({
      ownerType: 'quote',
      quoteId: quote.id,
      clientId,
      role: 'document',
      name: `taken ${cast.run}.pdf`,
      createdById: cast.am.id,
    });
    const twin = await uploaded(cast.am.cookie, `taken ${cast.run}.pdf`);
    await expectError(
      await accept(quote, { ...body, proofUploadId: twin.uploadId }),
      409,
      'FILE_NAME_TAKEN',
    );
    await expectError(
      await accept(quote, {
        ...body,
        project: { ...body.project, installmentMilestones: [0, 5] },
      }),
      400,
      'INVALID_INSTALLMENTS',
    );
    await expectError(
      await accept(quote, {
        ...body,
        retainer: {
          mode: 'new',
          name: name('عقد'),
          departments: ['design'],
          startDate: today,
          renewalDate: null,
          templateId: projectTemplate,
        },
      }),
      400,
      'TEMPLATE_KIND_MISMATCH',
    );
  });

  it('accepts only a sent version: drafts are refused and expired ones need extending', async () => {
    const quote = await sentQuote();
    const plan = await planOf(quote);
    const version = await created(
      await client.post(`/api/quotes/${quote.id}/versions`, cast.am.cookie, {}),
      (body) => quoteDetailSchema.parse(body),
    );
    await expectError(
      await client.get(`/api/quotes/${version.id}/accept-plan`, cast.am.cookie),
      409,
      'INVALID_TRANSITION',
    );
    await app.get(QuoteWorkflowService).runDaily(addDays(today, 30));
    await expectError(
      await client.get(`/api/quotes/${quote.id}/accept-plan`, cast.am.cookie),
      409,
      'QUOTE_EXPIRED',
    );
    await expectError(await accept(quote, acceptBody(plan)), 409, 'QUOTE_EXPIRED');
  });

  it('cuts a long proof name to the item name limit, keeping its extension', async () => {
    const quote = await sentQuote();
    const proof = await uploaded(cast.am.cookie, `${'ب'.repeat(200)}.pdf`);
    const response = await accept(
      quote,
      acceptBody(await planOf(quote), { proofUploadId: proof.uploadId }),
    );
    expect(response.status).toBe(200);
    const [document] = await db
      .select({ name: fileItems.name })
      .from(fileItems)
      .where(eq(fileItems.quoteId, quote.id));
    expect(document?.name).toBe(`${'ب'.repeat(116)}.pdf`);
  });

  it('plans template dates from today when the project starts in the past (F07 rule 6)', async () => {
    const quote = await sentQuote();
    const plan = await planOf(quote, '?projectStartDate=2020-01-06');
    expect(plan.project?.startDate).toBe('2020-01-06');
    expect(plan.project?.milestones.every((m) => (m.dueDate ?? '') >= today)).toBe(true);
    expect(plan.project?.dueDate && plan.project.dueDate >= today).toBe(true);
  });

  it('rolls back on a template archived since sending (A9, C3)', async () => {
    const archivedTemplate = await createTemplate({
      name: `مؤرشف ${cast.run}`,
      kind: 'project',
      stages: [{ key: 'only', name: 'المرحلة' }],
      steps: [{ key: 'one', stageKey: 'only', title: 'Step', department: 'design', dueDay: 1 }],
    });
    const logo = await createService({
      billing: 'one_off',
      priceUsdMinor: 30000,
      templateId: archivedTemplate,
    });
    const quote = await sentQuote({
      lines: [{ ...brandLine, serviceId: logo.id }],
      monthlyTermMonths: null,
    });
    const plan = await planOf(quote);
    expect(
      (await client.post(`/api/templates/${archivedTemplate}/archive`, cast.operations.cookie, {}))
        .status,
    ).toBe(200);
    const after = await planOf(quote);
    expect(after.project?.templates).toEqual([]);
    expect(after.archivedTemplates.map((t) => t.id)).toEqual([archivedTemplate]);
    await expectError(await accept(quote, acceptBody(plan)), 409, 'TEMPLATE_ARCHIVED');
    expect((await detail(quote.id)).status).toBe('sent');
  });

  it('refuses more than 999 a month on a merged line (A6)', async () => {
    const quote = await sentQuote({
      lines: [
        goldLine(),
        {
          section: 'monthly',
          serviceId: design.id,
          quantity: 999,
          unitPriceMinor: 1500,
          revisionRounds: 2,
        },
      ],
      installments: [],
    });
    await expectError(await accept(quote, acceptBody(await planOf(quote))), 409, 'LIMIT_REACHED');
  });

  it('refuses an archived client', async () => {
    const archiving = await cast.createClient();
    const quote = await sentQuote({}, 'USD', archiving.id);
    const plan = await planOf(quote);
    expect(
      (await client.post(`/api/clients/${archiving.id}/archive`, cast.gm.cookie, {})).status,
    ).toBe(200);
    await expectError(
      await accept(quote, acceptBody(plan), cast.gm.cookie),
      409,
      'CLIENT_ARCHIVED',
    );
  });

  it('repeats rule 1: an ended client accepts nothing', async () => {
    const ending = await cast.createClient();
    const quote = await sentQuote({}, 'USD', ending.id);
    const plan = await planOf(quote);
    const ended = await client.request('PATCH', `/api/clients/${ending.id}`, {
      cookie: cast.gm.cookie,
      body: { status: 'ended' },
    });
    expect(ended.status).toBe(200);
    await expectError(
      await client.get(`/api/quotes/${quote.id}/accept-plan`, cast.am.cookie),
      409,
      'CLIENT_ENDED',
    );
    await expectError(await accept(quote, acceptBody(plan)), 409, 'CLIENT_ENDED');
  });

  it('archives a newer draft of the accepted version (A10)', async () => {
    const quote = await sentQuote();
    const version = await created(
      await client.post(`/api/quotes/${quote.id}/versions`, cast.am.cookie, {}),
      (body) => quoteDetailSchema.parse(body),
    );
    const plan = await planOf(quote);
    expect((await accept(quote, acceptBody(plan))).status).toBe(200);
    const [draft] = await db.select().from(quotes).where(eq(quotes.id, version.id));
    expect(draft?.archivedAt).not.toBeNull();
    expect((await detail(version.id, cast.gm.cookie)).archivedAt).not.toBeNull();
  });

  it('renews a retainer from the next cycle (A7) and refuses another currency', async () => {
    const existing = await cast.createRetainer(clientId, { monthlyFeeMinor: 30000 });
    const quote = await sentQuote({
      lines: [goldLine()],
      installments: [],
      monthlyTermMonths: 3,
    });
    const plan = await planOf(quote);
    expect(plan.project).toBeNull();
    const response = await accept(
      quote,
      acceptBody(plan, {
        retainer: { mode: 'renew', retainerId: existing.id, templateId: monthlyTemplate },
      }),
    );
    const accepted = await created(response, (body) => quoteDetailSchema.parse(body), 200);
    expect(accepted.retainer).toEqual({ id: existing.id, name: existing.name });
    expect(accepted.project).toBeNull();
    const retainer = await created(
      await client.get(`/api/retainers/${existing.id}`, cast.gm.cookie),
      (body) => retainerDetailSchema.parse(body),
      200,
    );
    expect(retainer).toMatchObject({
      renewalDate: addMonths(firstOfMonth(today), 4),
      money: { monthlyFeeMinor: 45000 },
    });
    expect(retainer.deliverables.map((l) => [l.kind, l.monthlyQuantity, l.revisionLimit])).toEqual([
      ['design', 12, 1],
      ['reel', 4, 2],
    ]);
    // R10: the open cycle keeps its lines.
    expect(retainer.currentCycle?.lines.map((l) => [l.kind, l.revisionLimit])).toEqual([
      ['design', null],
      ['reel', null],
    ]);

    // An ended retainer, or another client's, is not renewed.
    const monthlyOnly = await sentQuote({ lines: [goldLine()], installments: [] });
    const monthlyPlan = await planOf(monthlyOnly);
    const ending = await cast.createRetainer(clientId);
    expect(
      (await client.post(`/api/retainers/${ending.id}/status`, cast.gm.cookie, { status: 'ended' }))
        .status,
    ).toBe(200);
    await expectError(
      await accept(
        monthlyOnly,
        acceptBody(monthlyPlan, {
          retainer: { mode: 'renew', retainerId: ending.id, templateId: null },
        }),
      ),
      409,
      'RETAINER_ENDED',
    );
    const elsewhere = await cast.createRetainer((await cast.createClient()).id);
    expect(
      (
        await accept(
          monthlyOnly,
          acceptBody(monthlyPlan, {
            retainer: { mode: 'renew', retainerId: elsewhere.id, templateId: null },
          }),
        )
      ).status,
    ).toBe(404);

    // Edge case 9: a quote in SYP does not renew a USD retainer.
    const syp = await sentQuote(
      {
        lines: [
          {
            section: 'monthly',
            serviceId: design.id,
            quantity: 10,
            unitPriceMinor: 150000,
            revisionRounds: 2,
          },
        ],
        installments: [],
        monthlyTermMonths: null,
      },
      'SYP',
    );
    const sypPlan = await planOf(syp);
    expect(sypPlan.retainer?.renewable.map((r) => r.id)).not.toContain(existing.id);
    await expectError(
      await accept(
        syp,
        acceptBody(sypPlan, {
          retainer: { mode: 'renew', retainerId: existing.id, templateId: null },
        }),
      ),
      409,
      'CURRENCY_MISMATCH',
    );
  });

  it('keeps a revision limit on the retainer deliverable lines editor (F05 change)', async () => {
    const retainer = await cast.createRetainer(clientId);
    const response = await client.request('PUT', `/api/retainers/${retainer.id}/deliverables`, {
      cookie: cast.am.cookie,
      body: {
        lines: retainer.deliverables.map((line, index) => ({
          id: line.id,
          kind: line.kind,
          monthlyQuantity: line.monthlyQuantity,
          revisionLimit: index === 0 ? 3 : null,
        })),
      },
    });
    const lines = await created(response, (body) => deliverableLineListSchema.parse(body), 200);
    expect(lines.items.map((line) => line.revisionLimit)).toEqual([3, null]);
  });
});
