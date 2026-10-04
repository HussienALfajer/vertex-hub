import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CampaignDetail,
  campaignDetailSchema,
  campaignPageSchema,
  taskDetailSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, users } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok, seedCampaignCast } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('ad campaigns (F12 rules 1–8, 25)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedCampaignCast>>;
  /** Managed by `cast.am`. */
  let clientId: string;
  /** Managed by `cast.otherAm`. */
  let otherClientId: string;
  const today = businessDate();

  const detail = (id: string, cookie = cast.marketer.cookie) =>
    client.get(`/api/campaigns/${id}`, cookie);

  const list = (query = '', cookie = cast.marketer.cookie) =>
    client.get(`/api/campaigns?clientId=${clientId}${query}`, cookie);

  /** The whole-campaign body of a save, from its detail. */
  const saveBody = (campaign: CampaignDetail, changes: Record<string, unknown> = {}) => ({
    updatedAt: campaign.updatedAt,
    name: campaign.name,
    platform: campaign.platform,
    objective: campaign.objective,
    funding: campaign.funding,
    budgetMinor: campaign.budgetMinor,
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn,
    ownerId: campaign.owner.id,
    projectId: campaign.engagement?.type === 'project' ? campaign.engagement.id : null,
    retainerId: campaign.engagement?.type === 'retainer' ? campaign.engagement.id : null,
    taskId: campaign.task?.id ?? null,
    notes: campaign.notes,
    ...changes,
  });

  const save = (campaign: CampaignDetail, changes = {}, cookie = cast.marketer.cookie) =>
    client.request('PUT', `/api/campaigns/${campaign.id}`, {
      cookie,
      body: saveBody(campaign, changes),
    });

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action as never)));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedCampaignCast(db, client);
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  describe('access', () => {
    it('answers 401 without a session', async () => {
      expect((await client.get('/api/campaigns')).status).toBe(401);
      expect((await client.post('/api/campaigns', undefined, {})).status).toBe(401);
      const id = randomUUID();
      expect((await client.get(`/api/campaigns/${id}`)).status).toBe(401);
      expect((await client.request('PUT', `/api/campaigns/${id}`, { body: {} })).status).toBe(401);
      for (const action of ['status', 'archive', 'restore']) {
        expect((await client.post(`/api/campaigns/${id}/${action}`)).status).toBe(401);
      }
    });

    it('answers 403 to users without campaign access', async () => {
      const campaign = await cast.createCampaign(clientId);
      const designManager = await cast.signedIn({
        roles: [],
        departments: [{ code: 'design', manager: true }],
      });
      for (const cookie of [cast.employee.cookie, designManager.cookie]) {
        expect((await client.get('/api/campaigns', cookie)).status).toBe(403);
        expect((await detail(campaign.id, cookie)).status).toBe(403);
        expect((await client.post('/api/campaigns', cookie, {})).status).toBe(403);
      }
    });

    it('lets Finance read but not manage campaigns', async () => {
      const campaign = await cast.createCampaign(clientId);
      const read = await ok(await detail(campaign.id, cast.finance.cookie), campaignDetailSchema);
      expect(read.permissions).toEqual({
        canEdit: false,
        canChangeFunding: false,
        transitions: [],
        canAddUpdate: false,
        canEditUpdates: false,
        canArchive: false,
        canRestore: false,
      });
      expect((await save(campaign, { name: 'تعديل' }, cast.finance.cookie)).status).toBe(403);
      expect(
        (await cast.changeStatus(campaign.id, 'active', undefined, cast.finance.cookie)).status,
      ).toBe(403);
      expect(
        (
          await client.post('/api/campaigns', cast.finance.cookie, {
            clientId,
            name: 'x',
            platform: 'meta',
            objective: 'leads',
            budgetMinor: 100,
            startsOn: today,
            ownerId: cast.finance.id,
          })
        ).status,
      ).toBe(403);
    });

    it('keeps account managers on their own clients (404 elsewhere)', async () => {
      const mine = await cast.createCampaign(clientId);
      const theirs = await cast.createCampaign(otherClientId);
      expect((await detail(mine.id, cast.am.cookie)).status).toBe(200);
      expect((await detail(theirs.id, cast.am.cookie)).status).toBe(404);
      expect((await save(theirs, { name: 'x' }, cast.am.cookie)).status).toBe(404);
      expect((await cast.changeStatus(theirs.id, 'active', undefined, cast.am.cookie)).status).toBe(
        404,
      );
      const created = await client.post('/api/campaigns', cast.am.cookie, {
        clientId: otherClientId,
        name: 'x',
        platform: 'meta',
        objective: 'leads',
        budgetMinor: 100,
        startsOn: today,
        ownerId: cast.am.id,
      });
      expect(created.status).toBe(404);
      const page = await ok(
        await client.get('/api/campaigns?status=planned&pageSize=100', cast.am.cookie),
        campaignPageSchema,
      );
      expect(page.items.some((item) => item.id === mine.id)).toBe(true);
      expect(page.items.some((item) => item.client.id === otherClientId)).toBe(false);
    });

    it('lets the account manager create campaigns for their client', async () => {
      const campaign = await cast.createCampaign(clientId, { ownerId: cast.am.id }, cast.am.cookie);
      expect(campaign.permissions.canEdit).toBe(true);
    });

    it('lets the Operations manager and the General Manager manage every campaign', async () => {
      const campaign = await cast.createCampaign(otherClientId);
      for (const cookie of [cast.operations.cookie, cast.gm.cookie]) {
        const read = await ok(await detail(campaign.id, cookie), campaignDetailSchema);
        expect(read.permissions.transitions).toEqual(['active', 'cancelled']);
      }
    });
  });

  describe('create (rules 1–4)', () => {
    it('creates a planned wallet campaign with its links and an audit entry', async () => {
      const project = await cast.createProject(clientId);
      const task = taskDetailSchema.parse(
        await (
          await client.post('/api/tasks', cast.gm.cookie, {
            title: `مهمة حملة ${cast.run}`,
            department: 'marketing',
            dueDate: addDays(today, 5),
            clientId,
          })
        ).json(),
      );
      const campaign = await cast.createCampaign(clientId, {
        name: '  عروض رمضان  ',
        endsOn: '2026-12-31',
        projectId: project.id,
        taskId: task.id,
        notes: 'ملاحظة',
      });
      expect(campaign).toMatchObject({
        name: 'عروض رمضان',
        status: 'planned',
        funding: 'wallet',
        budgetMinor: 60_000,
        spendMinor: 0,
        budgetUsed: 0,
        results: 0,
        costPerResultMinor: null,
        lastUpdateEnd: null,
        daysWithoutUpdate: null,
        endPassed: false,
        client: { id: clientId },
        owner: { id: cast.marketer.id, archived: false },
        engagement: { type: 'project', id: project.id, name: project.name, archived: false },
        task: { id: task.id, status: task.status, archived: false },
        notes: 'ملاحظة',
        cancelReason: null,
        months: [],
        updates: [],
        createdBy: { id: cast.marketer.id },
      });
      const [entry] = await auditOf(campaign.id, 'ad_campaign.created');
      expect(entry?.after).toMatchObject({ clientId, name: 'عروض رمضان', projectId: project.id });
    });

    it('refuses an archived client, but allows a paused or ended one', async () => {
      const archived = await cast.createClient();
      await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
      await expectError(
        await client.post('/api/campaigns', cast.marketer.cookie, {
          clientId: archived.id,
          name: 'x',
          platform: 'meta',
          objective: 'leads',
          budgetMinor: 100,
          startsOn: today,
          ownerId: cast.marketer.id,
        }),
        409,
        'CLIENT_ARCHIVED',
      );
      const paused = await cast.createClient({ status: 'paused' });
      await cast.createCampaign(paused.id);
    });

    it('refuses an owner who is not an active user', async () => {
      const gone = await seedUser(db, { archived: true });
      cast.trackUser(gone.id);
      await expectError(
        await client.post('/api/campaigns', cast.marketer.cookie, {
          clientId,
          name: 'x',
          platform: 'meta',
          objective: 'leads',
          budgetMinor: 100,
          startsOn: today,
          ownerId: gone.id,
        }),
        400,
        'INVALID_OWNER',
      );
      // Any active user may own a campaign (rule 2).
      await cast.createCampaign(clientId, { ownerId: cast.employee.id });
    });

    it('refuses links outside the client and archived ones', async () => {
      const otherProject = await cast.createProject(otherClientId);
      const retainer = await cast.createRetainer(otherClientId);
      const archivedProject = await cast.createProject(clientId);
      await client.post(`/api/projects/${archivedProject.id}/archive`, cast.gm.cookie);
      for (const links of [
        { projectId: otherProject.id },
        { retainerId: retainer.id },
        { projectId: archivedProject.id },
        { taskId: randomUUID() },
      ]) {
        const response = await client.post('/api/campaigns', cast.marketer.cookie, {
          clientId,
          name: 'x',
          platform: 'meta',
          objective: 'leads',
          budgetMinor: 100,
          startsOn: today,
          ownerId: cast.marketer.id,
          ...links,
        });
        await expectError(response, 400, 'INVALID_ENGAGEMENT');
      }
      const both = await client.post('/api/campaigns', cast.marketer.cookie, {
        clientId,
        name: 'x',
        platform: 'meta',
        objective: 'leads',
        budgetMinor: 100,
        startsOn: today,
        ownerId: cast.marketer.id,
        projectId: otherProject.id,
        retainerId: retainer.id,
      });
      expect(both.status).toBe(400);
    });

    it('refuses an end date before the start date', async () => {
      await expectError(
        await client.post('/api/campaigns', cast.marketer.cookie, {
          clientId,
          name: 'x',
          platform: 'meta',
          objective: 'leads',
          budgetMinor: 100,
          startsOn: '2026-09-10',
          endsOn: '2026-09-09',
          ownerId: cast.marketer.id,
        }),
        400,
        'INVALID_DATES',
      );
    });

    it('answers 404 for an unknown client', async () => {
      const response = await client.post('/api/campaigns', cast.marketer.cookie, {
        clientId: randomUUID(),
        name: 'x',
        platform: 'meta',
        objective: 'leads',
        budgetMinor: 100,
        startsOn: today,
        ownerId: cast.marketer.id,
      });
      expect(response.status).toBe(404);
    });
  });

  describe('edit (rules 5–6, edge cases 8 and 10)', () => {
    it('saves the whole campaign and audits the changed fields', async () => {
      const campaign = await cast.createCampaign(clientId);
      const saved = await ok(
        await save(campaign, { name: 'اسم جديد', budgetMinor: 90_000, platform: 'google' }),
        campaignDetailSchema,
      );
      expect(saved).toMatchObject({ name: 'اسم جديد', budgetMinor: 90_000, platform: 'google' });
      const [entry] = await auditOf(campaign.id, 'ad_campaign.updated');
      expect(entry?.before).toEqual({
        clientId,
        name: campaign.name,
        budgetMinor: 60_000,
        platform: 'meta',
      });
      expect(entry?.after).toEqual({
        clientId,
        name: 'اسم جديد',
        budgetMinor: 90_000,
        platform: 'google',
      });
    });

    it('refuses a save over a newer version', async () => {
      const campaign = await cast.createCampaign(clientId);
      await ok(await save(campaign, { name: 'أول' }), campaignDetailSchema);
      await expectError(await save(campaign, { name: 'ثان' }), 409, 'CONCURRENT_CHANGE');
    });

    it('changes funding before the first update only', async () => {
      const campaign = await cast.activeCampaign(clientId, { funding: 'client_direct' });
      const switched = await ok(await save(campaign, { funding: 'wallet' }), campaignDetailSchema);
      expect(switched.funding).toBe('wallet');
      const withUpdate = await ok(await cast.addUpdate(campaign.id), campaignDetailSchema, 201);
      expect(withUpdate.permissions.canChangeFunding).toBe(false);
      await expectError(
        await save(withUpdate, { funding: 'client_direct' }),
        409,
        'FUNDING_LOCKED',
      );
      // Other fields still save.
      await ok(await save(withUpdate, { notes: 'تعديل' }), campaignDetailSchema);
    });

    it('keeps an archived owner until the owner field changes', async () => {
      const owner = await cast.signedIn();
      const campaign = await cast.createCampaign(clientId, { ownerId: owner.id });
      await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, owner.id));
      const kept = await ok(await save(campaign, { notes: 'تعديل' }), campaignDetailSchema);
      expect(kept.owner).toMatchObject({ id: owner.id, archived: true });
      const other = await seedUser(db, { archived: true });
      cast.trackUser(other.id);
      await expectError(await save(kept, { ownerId: other.id }), 400, 'INVALID_OWNER');
      const moved = await ok(await save(kept, { ownerId: cast.marketer.id }), campaignDetailSchema);
      expect(moved.owner.id).toBe(cast.marketer.id);
    });

    it('keeps a link archived later and shows it as archived', async () => {
      const project = await cast.createProject(clientId);
      const campaign = await cast.createCampaign(clientId, { projectId: project.id });
      await client.post(`/api/projects/${project.id}/archive`, cast.gm.cookie);
      const read = await ok(await detail(campaign.id), campaignDetailSchema);
      expect(read.engagement).toMatchObject({ id: project.id, archived: true });
      await ok(await save(read, { notes: 'ما زال مرتبطًا' }), campaignDetailSchema);
    });

    it('refuses edits to a cancelled campaign', async () => {
      const campaign = await cast.createCampaign(clientId);
      const cancelled = await ok(
        await cast.changeStatus(campaign.id, 'cancelled', 'ألغى العميل'),
        campaignDetailSchema,
      );
      expect(cancelled.permissions.canEdit).toBe(false);
      await expectError(await save(cancelled, { name: 'x' }), 409, 'INVALID_TRANSITION');
    });
  });

  describe('status', () => {
    it('starts, pauses, resumes, completes and reopens, with audit entries', async () => {
      const campaign = await cast.createCampaign(clientId);
      let current = campaign;
      for (const to of [
        'active',
        'paused',
        'active',
        'completed',
        'active',
        'paused',
        'completed',
      ]) {
        current = await ok(await cast.changeStatus(campaign.id, to), campaignDetailSchema);
        expect(current.status).toBe(to);
      }
      expect(current.permissions.transitions).toEqual(['active']);
      const entries = await auditOf(campaign.id, 'ad_campaign.status_changed');
      expect(entries).toHaveLength(7);
      expect(entries.map((entry) => entry.after)).toContainEqual({
        clientId,
        name: campaign.name,
        status: 'paused',
      });
    });

    it('cancels with a reason only, and nothing leaves cancelled', async () => {
      const campaign = await cast.activeCampaign(clientId);
      await expectError(await cast.changeStatus(campaign.id, 'cancelled'), 400, 'NOTE_REQUIRED');
      await expectError(
        await cast.changeStatus(campaign.id, 'cancelled', '  '),
        400,
        'NOTE_REQUIRED',
      );
      const cancelled = await ok(
        await cast.changeStatus(campaign.id, 'cancelled', 'أوقف العميل الإعلانات'),
        campaignDetailSchema,
      );
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'أوقف العميل الإعلانات',
      });
      expect(cancelled.permissions.transitions).toEqual([]);
      const [entry] = await auditOf(campaign.id, 'ad_campaign.status_changed').then((rows) =>
        rows.filter((row) => (row.after as { status: string }).status === 'cancelled'),
      );
      expect(entry?.after).toMatchObject({ reason: 'أوقف العميل الإعلانات' });
      await expectError(await cast.changeStatus(campaign.id, 'active'), 409, 'INVALID_TRANSITION');
    });

    it('refuses moves outside the state machine', async () => {
      const campaign = await cast.createCampaign(clientId);
      await expectError(await cast.changeStatus(campaign.id, 'paused'), 409, 'INVALID_TRANSITION');
      await expectError(
        await cast.changeStatus(campaign.id, 'completed'),
        409,
        'INVALID_TRANSITION',
      );
      await cast.changeStatus(campaign.id, 'active');
      await cast.changeStatus(campaign.id, 'completed');
      await expectError(await cast.changeStatus(campaign.id, 'paused'), 409, 'INVALID_TRANSITION');
      await expectError(
        await cast.changeStatus(campaign.id, 'cancelled', 'x'),
        409,
        'INVALID_TRANSITION',
      );
    });
  });

  describe('archive (rule 7)', () => {
    it('archives a planned campaign, hides it, and restores it', async () => {
      const campaign = await cast.createCampaign(clientId);
      const archived = await ok(
        await client.post(`/api/campaigns/${campaign.id}/archive`, cast.marketer.cookie),
        campaignDetailSchema,
      );
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.permissions).toMatchObject({
        canEdit: false,
        transitions: [],
        canAddUpdate: false,
        canRestore: true,
      });
      const page = await ok(await list('&status=planned&pageSize=100'), campaignPageSchema);
      expect(page.items.some((item) => item.id === campaign.id)).toBe(false);
      // Readable by direct link to campaign managers only.
      expect((await detail(campaign.id, cast.finance.cookie)).status).toBe(404);
      await expectError(await save(archived, { name: 'x' }), 409, 'INVALID_TRANSITION');
      await expectError(await cast.changeStatus(campaign.id, 'active'), 409, 'INVALID_TRANSITION');
      await expectError(
        await client.post(`/api/campaigns/${campaign.id}/archive`, cast.marketer.cookie),
        409,
        'INVALID_TRANSITION',
      );
      const restored = await ok(
        await client.post(`/api/campaigns/${campaign.id}/restore`, cast.marketer.cookie),
        campaignDetailSchema,
      );
      expect(restored.archivedAt).toBeNull();
      expect(await auditOf(campaign.id, 'ad_campaign.archived')).toHaveLength(1);
      expect(await auditOf(campaign.id, 'ad_campaign.restored')).toHaveLength(1);
      await expectError(
        await client.post(`/api/campaigns/${campaign.id}/restore`, cast.marketer.cookie),
        409,
        'INVALID_TRANSITION',
      );
    });

    it('refuses running campaigns and campaigns with updates', async () => {
      const running = await cast.activeCampaign(clientId);
      await expectError(
        await client.post(`/api/campaigns/${running.id}/archive`, cast.marketer.cookie),
        409,
        'INVALID_TRANSITION',
      );
      await ok(await cast.addUpdate(running.id), campaignDetailSchema, 201);
      await cast.changeStatus(running.id, 'cancelled', 'x');
      await expectError(
        await client.post(`/api/campaigns/${running.id}/archive`, cast.marketer.cookie),
        409,
        'CAMPAIGN_HAS_UPDATES',
      );
    });

    it('answers 403 to readers and 404 out of scope', async () => {
      const campaign = await cast.createCampaign(otherClientId);
      expect(
        (await client.post(`/api/campaigns/${campaign.id}/archive`, cast.finance.cookie)).status,
      ).toBe(403);
      expect(
        (await client.post(`/api/campaigns/${campaign.id}/archive`, cast.am.cookie)).status,
      ).toBe(404);
      await ok(
        await client.post(`/api/campaigns/${campaign.id}/archive`, cast.marketer.cookie),
        campaignDetailSchema,
      );
      expect(
        (await client.post(`/api/campaigns/${campaign.id}/restore`, cast.finance.cookie)).status,
      ).toBe(403);
      expect(
        (await client.post(`/api/campaigns/${campaign.id}/restore`, cast.am.cookie)).status,
      ).toBe(404);
      expect(
        (await client.post(`/api/campaigns/${campaign.id}/restore`, cast.employee.cookie)).status,
      ).toBe(403);
    });
  });

  describe('list', () => {
    it('defaults to planned, active and paused, and filters', async () => {
      const listClient = (await cast.createClient()).id;
      const planned = await cast.createCampaign(listClient, { name: `ألف ${cast.run}` });
      const active = await cast.activeCampaign(listClient, {
        name: `باء ${cast.run}`,
        platform: 'tiktok',
        funding: 'client_direct',
        ownerId: cast.am.id,
      });
      const completed = await cast.activeCampaign(listClient, { name: `جيم ${cast.run}` });
      await cast.changeStatus(completed.id, 'completed');
      const ids = async (query: string, cookie = cast.marketer.cookie) =>
        (
          await ok(
            await client.get(`/api/campaigns?clientId=${listClient}${query}`, cookie),
            campaignPageSchema,
          )
        ).items.map((item) => item.id);
      expect((await ids('')).sort()).toEqual([planned.id, active.id].sort());
      expect(await ids('&status=completed')).toEqual([completed.id]);
      expect(await ids('&platform=tiktok')).toEqual([active.id]);
      expect(await ids('&funding=client_direct')).toEqual([active.id]);
      expect(await ids(`&ownerId=${cast.am.id}`)).toEqual([active.id]);
      expect(await ids('&mine=true', cast.am.cookie)).toEqual([active.id]);
      expect(await ids(`&accountManagerId=${cast.otherAm.id}`)).toEqual([]);
      expect(await ids(`&search=${encodeURIComponent('باء')}`)).toEqual([active.id]);
      expect(await ids('&sort=name&order=asc&status=planned&status=active')).toEqual([
        planned.id,
        active.id,
      ]);
    });

    it('shows totals and the end-passed and no-update badges', async () => {
      const badgeClient = (await cast.createClient()).id;
      const stale = await cast.activeCampaign(badgeClient, {
        startsOn: addDays(today, -10),
        endsOn: addDays(today, -1),
      });
      const fresh = await cast.activeCampaign(badgeClient, { startsOn: addDays(today, -3) });
      const updated = await cast.activeCampaign(badgeClient, { startsOn: '2026-08-01' });
      await ok(await cast.addUpdate(updated.id), campaignDetailSchema, 201);
      const page = await ok(
        await client.get(`/api/campaigns?clientId=${badgeClient}`, cast.marketer.cookie),
        campaignPageSchema,
      );
      const item = (id: string) => page.items.find((row) => row.id === id);
      expect(item(stale.id)).toMatchObject({ daysWithoutUpdate: 10, endPassed: true });
      expect(item(fresh.id)).toMatchObject({ daysWithoutUpdate: null, endPassed: false });
      expect(item(updated.id)).toMatchObject({
        spendMinor: 20_000,
        results: 45,
        costPerResultMinor: 444,
        budgetUsed: 33,
        lastUpdateEnd: '2026-09-07',
      });
    });
  });
});
