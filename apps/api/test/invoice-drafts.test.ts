import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  acceptPlanSchema,
  addDays,
  addMonths,
  businessDate,
  type CatalogService,
  catalogServiceSchema,
  firstOfMonth,
  invoiceDetailSchema,
  type ProjectDetail,
  quoteDetailSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clients,
  createDatabase,
  extraWorkItems,
  invoiceLines,
  invoices,
  tasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MilestoneDoneHooks } from '../src/modules/projects/index.js';
import { RetainerCyclesService } from '../src/modules/projects/retainer-cycles.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, removeCatalog, removeClients } from './helpers.js';
import { startApp } from './start-app.js';

describe('automatic invoice drafts and billing locks (F13 PR 2)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let clientId: string;
  let oneOff: CatalogService;
  let monthly: CatalogService;
  const services: string[] = [];
  const today = businessDate();

  async function ok<T>(response: Response, parse: (body: unknown) => T, status = 200) {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
    }
    return parse(await response.json());
  }

  const patch = (path: string, body: unknown, cookie = cast.gm.cookie) =>
    client.request('PATCH', path, { cookie, body });

  /** Invoices billing a source, oldest first. */
  async function invoicesOf(column: 'milestoneId' | 'retainerCycleId', id: string) {
    const rows = await db
      .select({ invoice: invoices, line: invoiceLines })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(eq(invoiceLines[column], id))
      .orderBy(asc(invoices.createdAt));
    return rows;
  }

  const discard = (invoiceId: string) =>
    client.post(`/api/invoices/${invoiceId}/archive`, finance.cookie);

  const complete = (projectId: string, milestoneId: string) =>
    client.post(`/api/projects/${projectId}/milestones/${milestoneId}/complete`, cast.gm.cookie, {
      confirmOpenTasks: true,
    });

  const milestoneOf = (project: ProjectDetail, index: number) => {
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
    clientId = (await cast.createClient()).id;
    const service = async (input: Record<string, unknown>) => {
      const created = await ok(
        await client.post('/api/catalog/services', cast.gm.cookie, {
          name: `خدمة ${cast.run} ${randomUUID().slice(0, 6)}`,
          department: 'design',
          ...input,
        }),
        (body) => catalogServiceSchema.parse(body),
        201,
      );
      services.push(created.id);
      return created;
    };
    oneOff = await service({ billing: 'one_off', priceUsdMinor: 80000 });
    monthly = await service({
      billing: 'monthly',
      priceUsdMinor: 30000,
      deliverableKind: 'design',
    });
  });

  afterAll(async () => {
    await app?.close();
    // Quotes hold catalog services.
    if (cast) {
      const own = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.accountManagerId, cast.am.id));
      await removeClients(
        db,
        own.map((row) => row.id),
      );
    }
    await removeCatalog(db, services, []);
    await cast?.cleanup();
    await connection.close();
  });

  describe('quote accepted (rule 2)', () => {
    async function accepted(lines: Record<string, unknown>[]) {
      const quote = await ok(
        await client.post('/api/quotes', cast.am.cookie, {
          clientId,
          title: `عرض ${cast.run} ${randomUUID().slice(0, 6)}`,
          currency: 'USD',
        }),
        (body) => quoteDetailSchema.parse(body),
        201,
      );
      await ok(
        await client.request('PUT', `/api/quotes/${quote.id}`, {
          cookie: cast.am.cookie,
          body: {
            updatedAt: quote.updatedAt,
            contactId: null,
            title: quote.title,
            currency: 'USD',
            validityDays: quote.validityDays,
            oneOffDiscountMinor: 0,
            monthlyDiscountMinor: 0,
            monthlyTermMonths: null,
            clientNotes: null,
            terms: null,
            lines,
            installments: lines.some((line) => line.section === 'one_off')
              ? [
                  { name: 'الدفعة المقدمة', percent: 30 },
                  { name: 'التسليم', percent: 70 },
                ]
              : [],
          },
        }),
        (body) => quoteDetailSchema.parse(body),
      );
      await ok(
        await client.post(`/api/quotes/${quote.id}/send`, cast.am.cookie, {
          confirmZeroPrice: true,
        }),
        (body) => quoteDetailSchema.parse(body),
      );
      const plan = await ok(
        await client.get(`/api/quotes/${quote.id}/accept-plan`, cast.am.cookie),
        (body) => acceptPlanSchema.parse(body),
      );
      return ok(
        await client.post(`/api/quotes/${quote.id}/accept`, cast.am.cookie, {
          respondedOn: today,
          project: plan.project && {
            name: plan.project.name,
            projectManagerId: plan.project.projectManager.id,
            departments: plan.project.departments,
            startDate: plan.project.startDate,
            dueDate: plan.project.dueDate,
            templateIds: [],
            installmentMilestones: plan.project.installments.map((i) => i.milestone),
          },
          retainer: plan.retainer && {
            mode: 'new',
            name: plan.retainer.name,
            departments: plan.retainer.departments,
            startDate: today,
            renewalDate: null,
            templateId: null,
          },
        }),
        (body) => quoteDetailSchema.parse(body),
      );
    }

    it('drafts the first installment’s milestone and the first retainer month', async () => {
      const quote = await accepted([
        {
          section: 'one_off',
          serviceId: oneOff.id,
          quantity: 1,
          unitPriceMinor: 80000,
          revisionRounds: 2,
        },
        {
          section: 'monthly',
          serviceId: monthly.id,
          quantity: 1,
          unitPriceMinor: 30000,
          revisionRounds: 1,
        },
      ]);
      const [deposit, ...others] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.quoteId, quote.id));
      expect(others).toHaveLength(0);
      expect(deposit).toMatchObject({
        origin: 'quote_accepted',
        status: 'draft',
        projectId: quote.project?.id,
        currency: 'USD',
        totalMinor: 24000,
        paymentTermsDays: 7,
        createdById: null,
        number: null,
      });
      const detail = await ok(
        await client.get(`/api/invoices/${deposit?.id}`, finance.cookie),
        (body) => invoiceDetailSchema.parse(body),
      );
      expect(detail.lines).toEqual([
        expect.objectContaining({
          description: `${quote.project?.name} — الدفعة المقدمة`,
          quantity: 1,
          unitPriceMinor: 24000,
          source: expect.objectContaining({ type: 'milestone' }),
        }),
      ]);
      const [month] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.retainerId, quote.retainer?.id ?? ''));
      expect(month).toMatchObject({ origin: 'cycle_opened', totalMinor: 30000, quoteId: null });
      const [created] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, deposit?.id ?? ''),
            eq(auditEntries.action, 'invoice.created'),
          ),
        );
      expect(created).toMatchObject({
        actorId: null,
        after: expect.objectContaining({ origin: 'quote_accepted', quoteId: quote.id }),
      });
    });

    it('drafts nothing at acceptance for a monthly-only quote but its month', async () => {
      const quote = await accepted([
        {
          section: 'monthly',
          serviceId: monthly.id,
          quantity: 1,
          unitPriceMinor: 30000,
          revisionRounds: 1,
        },
      ]);
      expect(await db.select().from(invoices).where(eq(invoices.quoteId, quote.id))).toEqual([]);
      const months = await db
        .select()
        .from(invoices)
        .where(eq(invoices.retainerId, quote.retainer?.id ?? ''));
      expect(months.map((row) => row.origin)).toEqual(['cycle_opened']);
    });
  });

  describe('milestone done (rule 3)', () => {
    let project: ProjectDetail;

    beforeAll(async () => {
      project = await cast.createProject(clientId, {
        currency: 'USD',
        milestones: [
          { name: 'التصميم', installmentMinor: 50000 },
          { name: 'بلا دفعة' },
          { name: 'التسليم', installmentMinor: 30000 },
          { name: 'الإطلاق', installmentMinor: 20000 },
        ],
      });
    });

    it('drafts the installment with a null actor, and locks the milestone (rule 25)', async () => {
      const done = milestoneOf(project, 0);
      expect((await complete(project.id, done.id)).status).toBe(200);
      const [held] = await invoicesOf('milestoneId', done.id);
      expect(held?.invoice).toMatchObject({
        origin: 'milestone_done',
        projectId: project.id,
        totalMinor: 50000,
        createdById: null,
      });
      expect(held?.line).toMatchObject({
        description: `${project.name} — التصميم`,
        unitPriceMinor: 50000,
        holdsSource: true,
      });
      const base = `/api/projects/${project.id}/milestones/${done.id}`;
      await expectError(
        await client.post(`${base}/reopen`, cast.gm.cookie),
        409,
        'MILESTONE_INVOICED',
      );
      await expectError(await patch(base, { installmentMinor: 60000 }), 409, 'MILESTONE_INVOICED');
      // Other fields stay editable, and the same amount is no change.
      expect((await patch(base, { name: 'التصميم النهائي', installmentMinor: 50000 })).status).toBe(
        200,
      );
    });

    it('skips a milestone without an installment', async () => {
      const none = milestoneOf(project, 1);
      expect((await complete(project.id, none.id)).status).toBe(200);
      expect(await invoicesOf('milestoneId', none.id)).toEqual([]);
    });

    it('skips a milestone a manual draft already holds, which locks its removal', async () => {
      const pending = milestoneOf(project, 2);
      const manual = await ok(
        await client.post('/api/invoices', finance.cookie, {
          clientId,
          currency: 'USD',
          sources: [{ type: 'milestone', id: pending.id }],
        }),
        (body) => invoiceDetailSchema.parse(body),
        201,
      );
      await expectError(
        await client.post(
          `/api/projects/${project.id}/milestones/${pending.id}/archive`,
          cast.gm.cookie,
        ),
        409,
        'MILESTONE_INVOICED',
      );
      expect((await complete(project.id, pending.id)).status).toBe(200);
      const held = await invoicesOf('milestoneId', pending.id);
      expect(held.map((row) => row.invoice.id)).toEqual([manual.id]);
    });

    it('does not draft again after its automatic draft was discarded (rule 8)', async () => {
      const done = milestoneOf(project, 0);
      const [held] = await invoicesOf('milestoneId', done.id);
      expect((await discard(held?.invoice.id ?? '')).status).toBe(204);
      const base = `/api/projects/${project.id}/milestones/${done.id}`;
      expect((await client.post(`${base}/reopen`, cast.gm.cookie)).status).toBe(200);
      expect((await complete(project.id, done.id)).status).toBe(200);
      const all = await invoicesOf('milestoneId', done.id);
      expect(all).toHaveLength(1);
      expect(all[0]?.line.holdsSource).toBe(false);
    });

    it('rolls the draft back with the completion when a hook fails (rule 5)', async () => {
      const failing = milestoneOf(project, 3);
      app.get(MilestoneDoneHooks).register(async (_tx, event) => {
        if (event.milestoneId === failing.id) throw new Error('A later hook failed');
      });
      expect((await complete(project.id, failing.id)).status).toBe(500);
      expect(await invoicesOf('milestoneId', failing.id)).toEqual([]);
      const milestones = await ok(
        await client.get(`/api/projects/${project.id}`, cast.gm.cookie),
        (body) => body as ProjectDetail,
      );
      expect(milestones.milestones.find((m) => m.id === failing.id)?.status).toBe('pending');
    });
  });

  describe('cycle opened (rule 4)', () => {
    const cycleDrafts = async (retainerId: string) =>
      db
        .select()
        .from(invoices)
        .where(and(eq(invoices.retainerId, retainerId), eq(invoices.origin, 'cycle_opened')))
        .orderBy(asc(invoices.createdAt));

    it('drafts the month in full for a new retainer, and none without a fee', async () => {
      const retainer = await cast.createRetainer(clientId, {
        currency: 'SYP',
        monthlyFeeMinor: 5000000,
      });
      const [month] = await cycleDrafts(retainer.id);
      expect(month).toMatchObject({ currency: 'SYP', totalMinor: 5000000, createdById: null });
      const [line] = await db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, month?.id ?? ''));
      expect(line).toMatchObject({
        retainerCycleId: retainer.currentCycle?.id,
        description: expect.stringContaining(`${retainer.name} — `),
      });
      const free = await cast.createRetainer(clientId);
      expect(await cycleDrafts(free.id)).toEqual([]);
    });

    it('drafts each month the daily job opens, at the fee of that moment (edge case 5)', async () => {
      const retainer = await cast.createRetainer(clientId, { monthlyFeeMinor: 40000 });
      expect(
        (await patch(`/api/retainers/${retainer.id}`, { monthlyFeeMinor: 45000 })).status,
      ).toBe(200);
      await app.get(RetainerCyclesService).runDaily(addMonths(firstOfMonth(today), 1));
      expect((await cycleDrafts(retainer.id)).map((row) => row.totalMinor)).toEqual([40000, 45000]);
    });

    it('drafts the month a resume or an earlier start opens', async () => {
      const later = addDays(today, 40);
      const resumed = await cast.createRetainer(clientId, {
        monthlyFeeMinor: 10000,
        startDate: later,
      });
      expect(await cycleDrafts(resumed.id)).toEqual([]);
      expect(
        (
          await client.post(`/api/retainers/${resumed.id}/status`, cast.gm.cookie, {
            status: 'paused',
          })
        ).status,
      ).toBe(200);
      expect((await patch(`/api/retainers/${resumed.id}`, { startDate: today })).status).toBe(200);
      expect(await cycleDrafts(resumed.id)).toEqual([]);
      expect(
        (
          await client.post(`/api/retainers/${resumed.id}/status`, cast.gm.cookie, {
            status: 'active',
          })
        ).status,
      ).toBe(200);
      expect(await cycleDrafts(resumed.id)).toHaveLength(1);

      const moved = await cast.createRetainer(clientId, {
        monthlyFeeMinor: 10000,
        startDate: later,
      });
      expect((await patch(`/api/retainers/${moved.id}`, { startDate: today })).status).toBe(200);
      expect(await cycleDrafts(moved.id)).toHaveLength(1);
    });
  });

  describe('billing locks (rules 24, 25)', () => {
    it('keeps invoiced extra work when its request is cancelled or put back in scope', async () => {
      const project = await cast.createProject(clientId, { currency: 'USD' });
      const created = await client.post('/api/tasks', cast.am.cookie, {
        title: 'طلب إضافي',
        type: 'client_request',
        department: 'design',
        dueDate: addDays(today, 5),
        clientId,
        projectId: project.id,
        requestScope: 'out_of_scope',
      });
      expect(created.status).toBe(201);
      const task = (await created.json()) as {
        id: string;
        clientRequest: { extraWork: { id: string } | null } | null;
      };
      const itemId = task.clientRequest?.extraWork?.id ?? '';
      await ok(
        await client.post('/api/invoices', finance.cookie, {
          clientId,
          currency: 'USD',
          sources: [{ type: 'extra_work', id: itemId }],
        }),
        (body) => invoiceDetailSchema.parse(body),
        201,
      );
      await expectError(
        await patch(`/api/tasks/${task.id}`, { requestScope: 'in_scope' }, cast.am.cookie),
        409,
        'ALREADY_INVOICED',
      );
      expect(
        (
          await client.post(`/api/tasks/${task.id}/status`, cast.am.cookie, {
            status: 'cancelled',
            note: 'لم يعد مطلوبًا',
          })
        ).status,
      ).toBe(200);
      const [item] = await db.select().from(extraWorkItems).where(eq(extraWorkItems.id, itemId));
      expect(item?.archivedAt).toBeNull();
      const [linked] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(linked).toMatchObject({ status: 'cancelled', extraWorkItemId: itemId });
    });

    it('fixes the currency of a project with invoices', async () => {
      const project = await cast.createProject(clientId, { currency: 'USD' });
      const draft = await ok(
        await client.post('/api/invoices', finance.cookie, {
          clientId,
          currency: 'USD',
          projectId: project.id,
        }),
        (body) => invoiceDetailSchema.parse(body),
        201,
      );
      await expectError(
        await patch(`/api/projects/${project.id}`, { currency: 'SYP' }),
        409,
        'CURRENCY_LOCKED',
      );
      expect((await discard(draft.id)).status).toBe(204);
      expect((await patch(`/api/projects/${project.id}`, { currency: 'SYP' })).status).toBe(200);
    });

    it('keeps invoiced extra work from being archived, waived or re-estimated', async () => {
      const project = await cast.createProject(clientId, { currency: 'USD' });
      const base = `/api/projects/${project.id}/extra-work`;
      const item = await ok(
        await client.post(base, cast.gm.cookie, { title: 'فيديو إضافي', estimateMinor: 9000 }),
        (body) => body as { id: string },
        201,
      );
      const draft = await ok(
        await client.post('/api/invoices', finance.cookie, {
          clientId,
          currency: 'USD',
          sources: [{ type: 'extra_work', id: item.id }],
        }),
        (body) => invoiceDetailSchema.parse(body),
        201,
      );
      await expectError(
        await client.post(`${base}/${item.id}/archive`, cast.gm.cookie),
        409,
        'ALREADY_INVOICED',
      );
      await expectError(
        await client.post(`${base}/${item.id}/billing`, cast.gm.cookie, {
          billingStatus: 'waived',
          billingNote: 'مجاني',
        }),
        409,
        'ALREADY_INVOICED',
      );
      await expectError(
        await patch(`${base}/${item.id}`, { estimateMinor: 10000 }),
        409,
        'ALREADY_INVOICED',
      );
      await expectError(
        await client.post(`${base}/${item.id}/billing`, cast.gm.cookie, {
          billingStatus: 'billed',
          billingNote: 'INV-2026-0001',
        }),
        409,
        'BILLED_BY_INVOICE',
      );
      expect((await patch(`${base}/${item.id}`, { title: 'فيديو إضافي قصير' })).status).toBe(200);
      expect((await discard(draft.id)).status).toBe(204);
      expect((await client.post(`${base}/${item.id}/archive`, cast.gm.cookie)).status).toBe(204);
      const audit = await db
        .select({ action: auditEntries.action })
        .from(auditEntries)
        .where(eq(auditEntries.entityId, item.id))
        .orderBy(auditEntries.id);
      expect(audit.map((row) => row.action)).toEqual([
        'extra_work.created',
        'extra_work.updated',
        'extra_work.archived',
      ]);
    });
  });
});
