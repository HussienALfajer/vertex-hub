import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type NotificationType,
  projectDetailSchema,
  quoteDetailSchema,
} from '@vertex-hub/contracts';
import { createDatabase, notifications, quotes } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Notice, NotificationCenter } from '../src/modules/notifications/index.js';
import { QuoteNotices } from '../src/modules/quotes/quote-notices.js';
import { QuoteWorkflowService } from '../src/modules/quotes/quote-workflow.service.js';
import { api } from './helpers.js';
import { seedLeadCast } from './lead-cast.js';
import { startApp } from './start-app.js';

/** Spec F16 part C (PR C1b): the catalog of clients, leads, quotes and projects. */
describe('notification catalog of the sales and engagement modules (F16 part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const today = businessDate();
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedLeadCast>>;
  let finance: Awaited<ReturnType<typeof cast.signedIn>>;
  let medical: Awaited<ReturnType<typeof cast.signedIn>>;
  let contentManager: Awaited<ReturnType<typeof cast.signedIn>>;
  let salesManager: Awaited<ReturnType<typeof cast.signedIn>>;
  let designManager: Awaited<ReturnType<typeof cast.signedIn>>;

  const everyone = () =>
    [
      cast.gm,
      cast.operations,
      cast.am,
      cast.otherAm,
      cast.employee,
      cast.communicator,
      finance,
      medical,
      contentManager,
      salesManager,
      designManager,
    ].map((user) => user.id);

  const rowsOf = (recipientId: string, type: NotificationType, subjectId: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, type),
          eq(notifications.subjectId, subjectId),
        ),
      );

  const oneOf = async (recipientId: string, type: NotificationType, subjectId: string) => {
    const rows = await rowsOf(recipientId, type, subjectId);
    expect(rows, `${type} for ${recipientId}`).toHaveLength(1);
    return rows[0] as (typeof rows)[number];
  };

  /** Stores a notice as its module would, outside any change. */
  const plant = (notice: Notice) =>
    db.transaction((tx) => app.get(NotificationCenter).notify(tx, notice));

  const ok = async (response: Response, status = 200) => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json();
  };
  const patch = (path: string, cookie: string, body: unknown) =>
    client.request('PATCH', path, { cookie, body });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedLeadCast(db, client);
    finance = await cast.signedIn({ roles: ['finance'] });
    medical = await cast.signedIn({ departments: [{ code: 'medical_consultation' }] });
    contentManager = await cast.signedIn({
      departments: [{ code: 'content_management', manager: true }],
    });
    salesManager = await cast.signedIn({
      departments: [{ code: 'general_communication', manager: true }],
    });
    designManager = await cast.signedIn({ departments: [{ code: 'design', manager: true }] });
  });

  afterAll(async () => {
    if (cast) await db.delete(notifications).where(inArray(notifications.recipientId, everyone()));
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  beforeEach(async () => {
    await db.delete(notifications).where(inArray(notifications.recipientId, everyone()));
  });

  describe('clients', () => {
    it('tells the account manager, management and Finance of a new status', async () => {
      const { id } = await cast.createClient();
      await ok(await patch(`/api/clients/${id}`, cast.gm.cookie, { status: 'paused' }));
      for (const recipientId of [cast.am.id, cast.operations.id, finance.id]) {
        const row = await oneOf(recipientId, 'client_status_changed', id);
        expect(row).toMatchObject({ box: 'info', priority: 'normal' });
        expect(row.data).toMatchObject({ status: 'paused' });
      }
      expect(await rowsOf(cast.gm.id, 'client_status_changed', id)).toHaveLength(0);
    });

    it('tells Medical Consultation and the Content Management managers of the healthcare flag', async () => {
      const { id } = await cast.createClient();
      await ok(await patch(`/api/clients/${id}`, cast.gm.cookie, { isHealthcare: true }));
      for (const recipientId of [medical.id, contentManager.id]) {
        expect((await oneOf(recipientId, 'client_healthcare_changed', id)).data).toMatchObject({
          healthcare: true,
        });
      }
    });

    it('tells the previous account manager who holds the client now (rule 4)', async () => {
      const { id, tradeName } = await cast.createClient();
      await ok(
        await patch(`/api/clients/${id}`, cast.gm.cookie, { accountManagerId: cast.otherAm.id }),
      );
      const moved = await oneOf(cast.am.id, 'responsibility_moved', id);
      expect(moved).toMatchObject({ subjectType: 'client', box: 'info' });
      expect(moved.data).toEqual({
        role: 'account_manager',
        record: tradeName,
        holder: cast.otherAm.name,
      });
      await oneOf(cast.otherAm.id, 'client_account_manager_assigned', id);
      expect(await rowsOf(cast.otherAm.id, 'responsibility_moved', id)).toHaveLength(0);
    });
  });

  describe('leads', () => {
    const followUpDue = (leadId: string): Notice => ({
      type: 'lead_follow_up_due',
      data: { lead: 'عيادة', followUpOn: today },
      recipients: [cast.am.id],
      actorId: null,
      subjectId: leadId,
    });

    it('closes the follow-up reminder when a follow-up is recorded', async () => {
      const lead = await cast.createLead();
      await plant(followUpDue(lead.id));
      await ok(
        await client.post(`/api/leads/${lead.id}/notes`, cast.am.cookie, {
          channel: 'call',
          summary: 'اتصال',
          nextFollowUpOn: addDays(today, 3),
        }),
        201,
      );
      expect(await oneOf(cast.am.id, 'lead_follow_up_due', lead.id)).toMatchObject({
        resolution: 'done',
        resolvedById: cast.am.id,
      });
    });

    it('voids the follow-up reminder when its date moves', async () => {
      const lead = await cast.createLead();
      await plant(followUpDue(lead.id));
      await ok(
        await patch(`/api/leads/${lead.id}`, cast.am.cookie, {
          updatedAt: lead.updatedAt,
          nextFollowUpOn: addDays(today, 5),
        }),
      );
      expect((await oneOf(cast.am.id, 'lead_follow_up_due', lead.id)).resolution).toBe('void');
    });

    it('tells the owner, the General Managers and the sales managers of a loss', async () => {
      const lead = await cast.createLead();
      await plant(followUpDue(lead.id));
      await ok(
        await client.post(`/api/leads/${lead.id}/lose`, cast.gm.cookie, { reason: 'price' }),
      );
      for (const recipientId of [cast.am.id, salesManager.id]) {
        await oneOf(recipientId, 'lead_lost', lead.id);
      }
      expect((await oneOf(cast.am.id, 'lead_follow_up_due', lead.id)).resolution).toBe('done');
    });

    it('tells the previous owner who owns the lead now (rule 4)', async () => {
      const lead = await cast.createLead();
      await ok(
        await client.post(`/api/leads/${lead.id}/owner`, cast.gm.cookie, {
          ownerId: cast.otherAm.id,
        }),
      );
      expect((await oneOf(cast.am.id, 'responsibility_moved', lead.id)).data).toMatchObject({
        role: 'lead_owner',
        holder: cast.otherAm.name,
      });
      await oneOf(cast.otherAm.id, 'lead_assigned', lead.id);
    });
  });

  describe('quotes', () => {
    let clientId: string;
    let serviceId: string;

    beforeAll(async () => {
      clientId = (await cast.createClient()).id;
      serviceId = (await cast.createService({ billing: 'one_off', priceUsdMinor: 50000 })).id;
    });

    /** A one-line quote the account manager created and sent. */
    async function sentQuote() {
      const draft = quoteDetailSchema.parse(
        await ok(
          await client.post('/api/quotes', cast.am.cookie, { clientId, title: `عرض ${cast.run}` }),
          201,
        ),
      );
      await ok(
        await client.request('PUT', `/api/quotes/${draft.id}`, {
          cookie: cast.am.cookie,
          body: {
            updatedAt: draft.updatedAt,
            contactId: null,
            title: draft.title,
            currency: draft.currency,
            validityDays: draft.validityDays,
            oneOffDiscountMinor: 0,
            monthlyDiscountMinor: 0,
            monthlyTermMonths: draft.monthlyTermMonths,
            clientNotes: null,
            terms: null,
            lines: [
              {
                section: 'one_off',
                serviceId,
                quantity: 1,
                unitPriceMinor: 50000,
                revisionRounds: 2,
              },
            ],
            installments: [{ name: 'كامل', percent: 100 }],
          },
        }),
      );
      return quoteDetailSchema.parse(
        await ok(await client.post(`/api/quotes/${draft.id}/send`, cast.am.cookie, {})),
      );
    }

    const expiresOn = (quoteId: string, validUntil: string) =>
      db.update(quotes).set({ validUntil }).where(eq(quotes.id, quoteId));

    it('reminds the account manager once, three days before the last valid day (rule 3)', async () => {
      const quote = await sentQuote();
      await expiresOn(quote.id, addDays(today, 3));
      const notices = app.get(QuoteNotices);
      await notices.remindExpiring(today);
      await notices.remindExpiring(today);
      const row = await oneOf(cast.am.id, 'quote_expiring', quote.id);
      expect(row).toMatchObject({ box: 'action', priority: 'important', resolvedAt: null });
      expect(row.data).toMatchObject({ validUntil: addDays(today, 3) });
    });

    it('voids the reminder when the quote expires, and tells its creator', async () => {
      const quote = await sentQuote();
      await expiresOn(quote.id, today);
      await app.get(QuoteNotices).remindExpiring(today);
      await app.get(QuoteWorkflowService).runDaily(addDays(today, 1));
      expect((await oneOf(cast.am.id, 'quote_expiring', quote.id)).resolution).toBe('void');
      expect(await oneOf(cast.am.id, 'quote_expired', quote.id)).toMatchObject({ box: 'info' });
    });

    it('tells the creator and the General Managers of a rejection, closing the reminder', async () => {
      const quote = await sentQuote();
      await expiresOn(quote.id, addDays(today, 2));
      await app.get(QuoteNotices).remindExpiring(today);
      await ok(
        await client.post(`/api/quotes/${quote.id}/reject`, cast.gm.cookie, {
          respondedOn: today,
          reason: 'price',
        }),
      );
      await oneOf(cast.am.id, 'quote_rejected', quote.id);
      expect(await oneOf(cast.am.id, 'quote_expiring', quote.id)).toMatchObject({
        resolution: 'done',
        resolvedById: cast.gm.id,
      });
    });
  });

  describe('projects', () => {
    let clientId: string;

    beforeAll(async () => {
      clientId = (await cast.createClient()).id;
    });

    it('tells the account manager, the project manager and the department managers of a status', async () => {
      const project = await cast.createProject(clientId);
      await ok(
        await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
          status: 'active',
        }),
      );
      for (const recipientId of [cast.am.id, cast.employee.id, designManager.id]) {
        expect((await oneOf(recipientId, 'project_status_changed', project.id)).data).toMatchObject(
          { status: 'active' },
        );
      }
      expect(await rowsOf(finance.id, 'project_status_changed', project.id)).toHaveLength(0);
      await ok(
        await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
          status: 'cancelled',
          reason: 'أوقفه العميل',
        }),
      );
      await oneOf(finance.id, 'project_status_changed', project.id);
    });

    it('tells the previous project manager who manages it now (rule 4)', async () => {
      const project = await cast.createProject(clientId);
      await ok(
        await patch(`/api/projects/${project.id}`, cast.gm.cookie, {
          projectManagerId: cast.otherAm.id,
        }),
      );
      expect((await oneOf(cast.employee.id, 'responsibility_moved', project.id)).data).toEqual({
        role: 'project_manager',
        record: project.name,
        holder: cast.otherAm.name,
      });
    });

    it('tells the account manager and the project manager of a completed milestone', async () => {
      const project = projectDetailSchema.parse(await cast.createProject(clientId));
      const milestone = (await ok(
        await client.post(`/api/projects/${project.id}/milestones`, cast.gm.cookie, {
          name: 'التصميم',
        }),
        201,
      )) as { id: string };
      await ok(
        await client.post(
          `/api/projects/${project.id}/milestones/${milestone.id}/complete`,
          cast.gm.cookie,
          {},
        ),
      );
      for (const recipientId of [cast.am.id, cast.employee.id]) {
        expect((await oneOf(recipientId, 'milestone_completed', project.id)).data).toMatchObject({
          milestone: 'التصميم',
        });
      }
    });

    it('tells Finance and the account manager of extra work on a project', async () => {
      const project = await cast.createProject(clientId);
      await ok(
        await client.post(`/api/projects/${project.id}/extra-work`, cast.gm.cookie, {
          title: 'منشور إضافي',
        }),
        201,
      );
      for (const recipientId of [finance.id, cast.am.id]) {
        expect(await oneOf(recipientId, 'extra_work_created', project.id)).toMatchObject({
          subjectType: 'project',
          data: { title: 'منشور إضافي', engagement: project.name },
        });
      }
    });
  });

  describe('retainers', () => {
    let clientId: string;

    beforeAll(async () => {
      clientId = (await cast.createClient()).id;
    });

    it('tells the account manager, Finance and the department managers of a status', async () => {
      const retainer = await cast.createRetainer(clientId);
      await ok(
        await client.post(`/api/retainers/${retainer.id}/status`, cast.gm.cookie, {
          status: 'paused',
        }),
      );
      for (const recipientId of [cast.am.id, finance.id, designManager.id]) {
        expect(
          (await oneOf(recipientId, 'retainer_status_changed', retainer.id)).data,
        ).toMatchObject({ status: 'paused' });
      }
    });

    it('voids the renewal and behind reminders when it ends', async () => {
      const retainer = await cast.createRetainer(clientId);
      await plant({
        type: 'retainer_renewal_due',
        data: { retainer: retainer.name, client: 'عميل', renewalDate: today, daysLeft: 0 },
        recipients: [cast.am.id],
        actorId: null,
        subjectId: retainer.id,
      });
      await plant({
        type: 'retainer_behind',
        data: {
          retainer: retainer.name,
          client: 'عميل',
          periodEnd: addDays(today, 3),
          daysLeft: 3,
          final: false,
          lines: [{ kind: 'design', label: null, delivered: 0, committed: 12, ready: 0 }],
        },
        recipients: [cast.am.id],
        actorId: null,
        subjectId: retainer.id,
      });
      await ok(
        await client.post(`/api/retainers/${retainer.id}/status`, cast.gm.cookie, {
          status: 'ended',
        }),
      );
      expect((await oneOf(cast.am.id, 'retainer_renewal_due', retainer.id)).resolution).toBe(
        'void',
      );
      expect((await oneOf(cast.am.id, 'retainer_behind', retainer.id)).resolution).toBe('void');
      expect((await oneOf(finance.id, 'retainer_status_changed', retainer.id)).data).toMatchObject({
        status: 'ended',
      });
    });
  });
});
