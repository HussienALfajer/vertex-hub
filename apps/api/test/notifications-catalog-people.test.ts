import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type InvoiceDetail,
  invoiceDetailSchema,
  type NotificationType,
} from '@vertex-hub/contracts';
import {
  adCampaigns,
  createDatabase,
  departments,
  invoiceSettings,
  invoices,
  notifications,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CampaignNotices } from '../src/modules/campaigns/campaign-notices.js';
import { InvoiceNotices } from '../src/modules/invoices/invoice-notices.js';
import { EmailFailureNotices } from '../src/modules/notifications/email-failure-notices.js';
import { type Notice, NotificationCenter } from '../src/modules/notifications/index.js';
import { MemberNotices } from '../src/modules/notifications/member-notices.js';
import { seedCampaignCast } from './campaign-cast.js';
import { api, departmentId } from './helpers.js';
import { startApp } from './start-app.js';

/** Spec F16 part C (PR C1c): the catalog of invoices, campaigns and people. */
describe('notification catalog of the finance, campaigns and people modules (F16 part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const today = businessDate();
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedCampaignCast>>;
  let marketingManager: Awaited<ReturnType<typeof cast.signedIn>>;
  let otherMarketer: Awaited<ReturnType<typeof cast.signedIn>>;
  let savedSettings: typeof invoiceSettings.$inferSelect;
  let savedManagers: { id: string; managerId: string | null }[];

  const everyone = () =>
    [
      cast.gm,
      cast.operations,
      cast.am,
      cast.otherAm,
      cast.employee,
      cast.marketer,
      cast.finance,
      marketingManager,
      otherMarketer,
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
    savedManagers = await db
      .select({ id: departments.id, managerId: departments.managerId })
      .from(departments);
    cast = await seedCampaignCast(db, client);
    marketingManager = await cast.signedIn({
      departments: [{ code: 'marketing', manager: true }],
    });
    otherMarketer = await cast.signedIn({ departments: [{ code: 'marketing' }] });
    [savedSettings] = (await db.select().from(invoiceSettings)) as [
      typeof invoiceSettings.$inferSelect,
    ];
    await db
      .update(invoiceSettings)
      .set({ sypPerUsd: '118.5000', paymentTermsDays: 7, rateUpdatedAt: new Date() });
  });

  afterAll(async () => {
    if (cast) await db.delete(notifications).where(inArray(notifications.recipientId, everyone()));
    if (savedSettings) await db.update(invoiceSettings).set(savedSettings);
    for (const { id, managerId } of savedManagers ?? []) {
      await db.update(departments).set({ managerId }).where(eq(departments.id, id));
    }
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  beforeEach(async () => {
    await db.delete(notifications).where(inArray(notifications.recipientId, everyone()));
  });

  describe('invoices', () => {
    const invoice = (response: Response, status = 200): Promise<InvoiceDetail> =>
      ok(response, status).then((body) => invoiceDetailSchema.parse(body));

    const issue = async (draft: InvoiceDetail) =>
      invoice(
        await client.post(`/api/invoices/${draft.id}/issue`, cast.finance.cookie, {
          updatedAt: draft.updatedAt,
        }),
      );

    /** A milestone's automatic draft (F13 rule 3). */
    async function automaticDraft(installmentMinor = 10_000) {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, {
        currency: 'USD',
        milestones: [{ name: 'التصميم', installmentMinor }],
      });
      const milestone = project.milestones[0];
      if (!milestone) throw new Error('No milestone');
      await ok(
        await client.post(
          `/api/projects/${project.id}/milestones/${milestone.id}/complete`,
          cast.gm.cookie,
          { confirmOpenTasks: true },
        ),
      );
      const [row] = await db.select().from(invoices).where(eq(invoices.projectId, project.id));
      if (!row) throw new Error('No draft');
      return invoice(await client.get(`/api/invoices/${row.id}`, cast.finance.cookie));
    }

    const pay = (id: string, amountMinor: number) =>
      client.post(`/api/invoices/${id}/payments`, cast.finance.cookie, {
        paidOn: today,
        amountMinor,
        currency: 'USD',
        method: 'cash',
      });

    it('tells Finance and Internal Operations of an automatic draft until it is issued', async () => {
      const draft = await automaticDraft();
      for (const recipientId of [cast.finance.id, cast.operations.id]) {
        const row = await oneOf(recipientId, 'invoice_draft_created', draft.id);
        expect(row).toMatchObject({ box: 'action', priority: 'important', resolvedAt: null });
        expect(row.data).toMatchObject({ origin: 'milestone_done' });
      }
      await issue(draft);
      expect(await oneOf(cast.finance.id, 'invoice_draft_created', draft.id)).toMatchObject({
        resolution: 'done',
        resolvedById: cast.finance.id,
      });
      expect(await oneOf(cast.operations.id, 'invoice_draft_created', draft.id)).toMatchObject({
        resolution: 'done',
        readAt: null,
      });
    });

    it('voids the draft notice when the draft is discarded', async () => {
      const draft = await automaticDraft();
      const archived = await client.post(`/api/invoices/${draft.id}/archive`, cast.finance.cookie);
      expect(archived.status).toBe(204);
      expect(await oneOf(cast.operations.id, 'invoice_draft_created', draft.id)).toMatchObject({
        resolution: 'void',
      });
    });

    it('tells the account manager of a partial payment, and closes the overdue alert when paid', async () => {
      const sent = await issue(await automaticDraft(10_000));
      await plant({
        type: 'invoice_overdue',
        recipients: [cast.am.id, cast.finance.id],
        actorId: null,
        subjectId: sent.id,
        data: { invoice: { displayNumber: 'INV', client: 'c' }, daysOverdue: 1 },
      });
      await invoice(await pay(sent.id, 4_000), 201);
      const partial = await oneOf(cast.am.id, 'payment_recorded', sent.id);
      expect(partial.data).toMatchObject({ amountMinor: 4_000, currency: 'USD' });
      expect(await rowsOf(cast.am.id, 'invoice_paid', sent.id)).toHaveLength(0);
      await invoice(await pay(sent.id, 6_000), 201);
      await oneOf(cast.am.id, 'invoice_paid', sent.id);
      expect(await rowsOf(cast.am.id, 'payment_recorded', sent.id)).toHaveLength(1);
      expect(await oneOf(cast.am.id, 'invoice_overdue', sent.id)).toMatchObject({
        resolution: 'done',
        resolvedById: cast.finance.id,
      });
    });

    it('tells the account manager and Finance of voided payments and invoices', async () => {
      const sent = await issue(await automaticDraft(10_000));
      const paid = await invoice(await pay(sent.id, 4_000), 201);
      const paymentId = paid.payments[0]?.id;
      await ok(
        await client.post(`/api/payments/${paymentId}/void`, cast.gm.cookie, { reason: 'خطأ' }),
      );
      for (const recipientId of [cast.am.id, cast.finance.id]) {
        await oneOf(recipientId, 'payment_voided', sent.id);
      }
      await plant({
        type: 'invoice_overdue',
        recipients: [cast.am.id],
        actorId: null,
        subjectId: sent.id,
        data: { invoice: { displayNumber: 'INV', client: 'c' }, daysOverdue: 1 },
      });
      await ok(
        await client.post(`/api/invoices/${sent.id}/void`, cast.gm.cookie, { reason: 'خطأ' }),
      );
      for (const recipientId of [cast.am.id, cast.finance.id]) {
        await oneOf(recipientId, 'invoice_voided', sent.id);
      }
      expect(await oneOf(cast.am.id, 'invoice_overdue', sent.id)).toMatchObject({
        resolution: 'void',
      });
    });

    it('reminds the account manager and Finance once of an invoice due within three days', async () => {
      const sent = await issue(await automaticDraft());
      await db
        .update(invoices)
        .set({ dueOn: addDays(today, 2) })
        .where(eq(invoices.id, sent.id));
      const notices = app.get(InvoiceNotices);
      expect(await notices.remindDueSoon(today)).toBeGreaterThanOrEqual(1);
      expect(await notices.remindDueSoon(today)).toBe(0);
      for (const recipientId of [cast.am.id, cast.finance.id]) {
        expect((await oneOf(recipientId, 'invoice_due_soon', sent.id)).data).toMatchObject({
          dueOn: addDays(today, 2),
        });
      }
    });
  });

  describe('campaigns', () => {
    it('tells the new owner, and the previous one who holds the campaign now', async () => {
      const { id: clientId } = await cast.createClient();
      const campaign = await cast.createCampaign(clientId, {}, cast.gm.cookie);
      expect(await oneOf(cast.marketer.id, 'campaign_assigned', campaign.id)).toMatchObject({
        box: 'action',
        subjectType: 'campaign',
      });
      await ok(
        await client.request('PUT', `/api/campaigns/${campaign.id}`, {
          cookie: cast.gm.cookie,
          body: {
            name: campaign.name,
            platform: campaign.platform,
            objective: campaign.objective,
            funding: campaign.funding,
            budgetMinor: campaign.budgetMinor,
            startsOn: campaign.startsOn,
            endsOn: campaign.endsOn,
            ownerId: otherMarketer.id,
            projectId: null,
            retainerId: null,
            taskId: null,
            notes: campaign.notes,
            updatedAt: campaign.updatedAt,
          },
        }),
      );
      await oneOf(otherMarketer.id, 'campaign_assigned', campaign.id);
      expect((await oneOf(cast.marketer.id, 'responsibility_moved', campaign.id)).data).toEqual({
        role: 'campaign_owner',
        record: campaign.name,
        holder: otherMarketer.name,
      });
    });

    it('tells the account manager and the owner of status changes', async () => {
      const { id: clientId } = await cast.createClient();
      const campaign = await cast.activeCampaign(clientId);
      expect((await oneOf(cast.am.id, 'campaign_status_changed', campaign.id)).data).toMatchObject({
        status: 'active',
      });
      // The owner made the change.
      expect(await rowsOf(cast.marketer.id, 'campaign_status_changed', campaign.id)).toHaveLength(
        0,
      );
    });

    it('reminds of an active campaign past its end date until it is completed', async () => {
      const { id: clientId } = await cast.createClient();
      const campaign = await cast.activeCampaign(clientId, { endsOn: '2026-08-31' });
      const notices = app.get(CampaignNotices);
      expect(await notices.remindEndPassed(today)).toBeGreaterThanOrEqual(1);
      for (const recipientId of [cast.marketer.id, cast.am.id]) {
        expect(await oneOf(recipientId, 'campaign_end_passed', campaign.id)).toMatchObject({
          box: 'action',
          resolvedAt: null,
        });
      }
      expect(await notices.remindEndPassed(today)).toBe(0);
      await ok(await cast.changeStatus(campaign.id, 'completed'));
      expect(await oneOf(cast.am.id, 'campaign_end_passed', campaign.id)).toMatchObject({
        resolution: 'done',
        resolvedById: cast.marketer.id,
      });
    });

    it('tells of a deposit, and closes the low-balance alert once the balance is back', async () => {
      const { id: clientId } = await cast.createClient();
      await ok(
        await patch(`/api/clients/${clientId}/ad-wallet`, cast.marketer.cookie, {
          lowBalanceThresholdMinor: 10_000,
        }),
      );
      const deposit = (amountMinor: number) =>
        client.post(`/api/clients/${clientId}/ad-wallet/entries`, cast.finance.cookie, {
          kind: 'deposit',
          occurredOn: today,
          amountMinor,
          currency: 'USD',
          method: 'bank_transfer',
        });
      await ok(await deposit(5_000), 201);
      expect(await oneOf(cast.am.id, 'ad_deposit_recorded', clientId)).toMatchObject({
        box: 'info',
        priority: 'informational',
      });
      expect((await oneOf(cast.am.id, 'ad_budget_low', clientId)).resolvedAt).toBeNull();
      await ok(await deposit(10_000), 201);
      expect(await oneOf(cast.am.id, 'ad_budget_low', clientId)).toMatchObject({
        resolution: 'done',
        resolvedById: cast.finance.id,
      });
    });
  });

  describe('people', () => {
    it('tells a new department manager, and the previous one who manages it now', async () => {
      const marketing = await departmentId(db, 'marketing');
      await ok(
        await patch(`/api/departments/${marketing}`, cast.gm.cookie, {
          managerId: cast.marketer.id,
        }),
      );
      expect(await oneOf(cast.marketer.id, 'department_manager_assigned', marketing)).toMatchObject(
        {
          subjectType: 'department',
          box: 'action',
          data: { department: 'marketing' },
        },
      );
      expect(
        (await oneOf(marketingManager.id, 'responsibility_moved', marketing)).data,
      ).toMatchObject({ role: 'department_manager', holder: cast.marketer.name });
      await ok(
        await patch(`/api/departments/${marketing}`, cast.gm.cookie, {
          managerId: marketingManager.id,
        }),
      );
    });

    it('tells the member and the managers of the departments they left and joined', async () => {
      const member = await cast.signedIn({ departments: [{ code: 'design' }] });
      const marketing = await departmentId(db, 'marketing');
      await ok(
        await patch(`/api/users/${member.id}`, cast.gm.cookie, {
          secondaryDepartmentIds: [marketing],
        }),
      );
      for (const recipientId of [member.id, marketingManager.id]) {
        expect((await oneOf(recipientId, 'member_moved', member.id)).data).toEqual({
          member: member.name,
          left: [],
          joined: ['marketing'],
        });
      }
      await db.delete(notifications).where(eq(notifications.recipientId, member.id));
    });

    it('tells the managers of an archived member’s open campaigns until none is left', async () => {
      const member = await cast.signedIn({ departments: [{ code: 'marketing' }] });
      const { id: clientId } = await cast.createClient();
      const campaign = await cast.createCampaign(clientId, { ownerId: member.id }, cast.gm.cookie);
      await ok(await client.post(`/api/users/${member.id}/archive`, cast.gm.cookie));
      const row = await oneOf(marketingManager.id, 'member_archived_open_work', member.id);
      expect(row).toMatchObject({ box: 'action', subjectType: 'user', data: { count: 1 } });
      const notices = app.get(MemberNotices);
      expect(await notices.resolveOpenWork()).toBe(0);
      await db
        .update(adCampaigns)
        .set({ status: 'cancelled', cancelReason: 'أُلغيت' })
        .where(eq(adCampaigns.id, campaign.id));
      expect(await notices.resolveOpenWork()).toBe(1);
      expect(
        await oneOf(marketingManager.id, 'member_archived_open_work', member.id),
      ).toMatchObject({ resolution: 'done', resolvedById: null });
    });

    it('copies a security email into the app without emailing it twice (rule 5)', async () => {
      await ok(
        await patch(`/api/users/${cast.employee.id}`, cast.gm.cookie, { roles: ['finance'] }),
      );
      const row = await oneOf(cast.employee.id, 'security_notice', cast.employee.id);
      expect(row).toMatchObject({ subjectType: 'user', emailState: null, box: 'info' });
      expect(row.data).toEqual({ change: 'roles_changed', by: cast.gm.name });
      await ok(await patch(`/api/users/${cast.employee.id}`, cast.gm.cookie, { roles: [] }));
    });

    it('closes a failed email notice when the sender emails that kind for the record again', async () => {
      const { id: clientId } = await cast.createClient();
      const failed = (kind: 'client_statement' | 'client_ad_budget_low') =>
        plant({
          type: 'email_failed',
          recipients: [cast.am.id],
          actorId: null,
          subjectType: 'client',
          subjectId: clientId,
          data: { kind, client: 'c', document: null, recipients: ['x'] },
        });
      await failed('client_statement');
      await failed('client_ad_budget_low');
      const [statement] = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.subjectId, clientId), eq(notifications.type, 'email_failed')));
      expect(statement).toBeDefined();
      const data = {
        client: 'c',
        signature: { name: 'a', title: null, phone: null, email: 'a@vertexhub.test' },
        statement: { currency: 'USD', from: today, to: today, outstandingMinor: 0 },
      };
      await db.transaction((tx) =>
        app.get(EmailFailureNotices).resolve(tx, {
          id: clientId,
          kind: 'client_statement',
          to: [{ name: 'x', email: 'x@vertexhub.test' }],
          senderId: cast.am.id,
          clientId,
          record: null,
          data,
        }),
      );
      const rows = await rowsOf(cast.am.id, 'email_failed', clientId);
      const byKind = new Map(
        rows.map((one) => [(one.data as { kind: string }).kind, one.resolution]),
      );
      expect(byKind.get('client_statement')).toBe('done');
      expect(byKind.get('client_ad_budget_low')).toBeNull();
    });
  });
});
