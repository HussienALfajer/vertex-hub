import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { projectDetailSchema, projectPageSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('projects', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };

  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/projects/${id}`, { cookie, body });
  const status = (id: string, cookie: string, body: unknown) =>
    client.post(`/api/projects/${id}/status`, cookie, body);
  const detail = async (id: string, cookie: string) => {
    const response = await client.get(`/api/projects/${id}`, cookie);
    expect(response.status).toBe(200);
    return projectDetailSchema.parse(await response.json());
  };
  const list = async (query: string, cookie: string) => {
    const response = await client.get(`/api/projects?${query}`, cookie);
    expect(response.status).toBe(200);
    return projectPageSchema.parse(await response.json());
  };
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    const signedIn = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(signedIn.id);
    finance = signedIn;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/projects')).status).toBe(401);
    expect((await client.get(`/api/projects/${id}`)).status).toBe(401);
    expect((await client.post('/api/projects', undefined, {})).status).toBe(401);
    expect((await patch(id, undefined, { name: 'x' })).status).toBe(401);
    for (const action of ['status', 'archive', 'restore']) {
      expect((await client.post(`/api/projects/${id}/${action}`)).status, action).toBe(401);
    }
  });

  describe('create', () => {
    it('creates a planned project with milestones and installments, audited', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createProject(clientId, {
        departments: ['design', 'development', 'design'],
        currency: 'USD',
        milestones: [
          { name: 'Discovery', installmentMinor: 50000 },
          { name: 'Design', dueDate: '2026-11-01', installmentMinor: 150000 },
          { name: 'Delivery' },
        ],
      });
      expect(created).toMatchObject({
        status: 'planned',
        departments: ['design', 'development'],
        projectManager: { id: cast.employee.id, archived: false },
        milestoneProgress: { done: 0, total: 3 },
        progress: null,
        money: { currency: 'USD', totalMinor: 200000 },
      });
      expect(
        created.milestones.map((m) => [m.name, m.position, m.money?.installmentMinor]),
      ).toEqual([
        ['Discovery', 1, 50000],
        ['Design', 2, 150000],
        ['Delivery', 3, null],
      ]);
      expect(created.permissions).toMatchObject({ canManage: true, canArchive: true });
      const [entry] = await auditOf(created.id);
      expect(entry).toMatchObject({ action: 'project.created', actorId: cast.gm.id });
      expect(entry?.after).toMatchObject({ currency: 'USD', status: 'planned' });
    });

    it('lets account managers create on their own clients only (client scope)', async () => {
      const own = await cast.createClient();
      const other = await cast.createClient({ accountManagerId: cast.otherAm.id });
      const body = (clientId: string) => ({
        clientId,
        name: `مشروع ${cast.run} ${randomUUID().slice(0, 6)}`,
        projectManagerId: cast.employee.id,
        departments: ['design'],
        startDate: '2026-10-01',
        dueDate: '2099-10-31',
        status: 'active',
        currency: 'SYP',
      });
      const created = await client.post('/api/projects', cast.am.cookie, body(own.id));
      expect(created.status).toBe(201);
      expect(projectDetailSchema.parse(await created.json())).toMatchObject({
        status: 'active',
        money: { currency: 'SYP' },
      });
      expect((await client.post('/api/projects', cast.am.cookie, body(other.id))).status).toBe(403);
      expect((await client.post('/api/projects', cast.employee.cookie, body(own.id))).status).toBe(
        403,
      );
      expect((await client.post('/api/projects', finance.cookie, body(own.id))).status).toBe(403);
      // The Operations manager manages every client.
      expect(
        (await client.post('/api/projects', cast.operations.cookie, body(other.id))).status,
      ).toBe(201);
    });

    it('refuses archived and ended clients (rule 1)', async () => {
      const ended = await cast.createClient({ status: 'ended' });
      await expectError(
        await client.post('/api/projects', cast.gm.cookie, {
          clientId: ended.id,
          name: 'x',
          projectManagerId: cast.employee.id,
          departments: ['design'],
          startDate: '2026-10-01',
          dueDate: '2099-10-31',
        }),
        409,
        'CLIENT_ENDED',
      );
      const archived = await cast.createClient();
      expect(
        (await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post('/api/projects', cast.gm.cookie, {
          clientId: archived.id,
          name: 'x',
          projectManagerId: cast.employee.id,
          departments: ['design'],
          startDate: '2026-10-01',
          dueDate: '2099-10-31',
        }),
        409,
        'CLIENT_ARCHIVED',
      );
    });

    it('checks the project manager, the dates and the name (rules 2 and 5)', async () => {
      const { id: clientId } = await cast.createClient();
      const archivedUser = await cast.signedIn();
      await client.post(`/api/users/${archivedUser.id}/archive`, cast.gm.cookie);
      const base = {
        clientId,
        name: `مشروع ${cast.run}`,
        projectManagerId: cast.employee.id,
        departments: ['design'],
        startDate: '2026-10-10',
        dueDate: '2099-10-31',
      };
      await expectError(
        await client.post('/api/projects', cast.gm.cookie, {
          ...base,
          projectManagerId: archivedUser.id,
        }),
        400,
        'INVALID_PROJECT_MANAGER',
      );
      await expectError(
        await client.post('/api/projects', cast.gm.cookie, { ...base, dueDate: '2026-10-09' }),
        400,
        'INVALID_DATES',
      );
      expect((await client.post('/api/projects', cast.gm.cookie, base)).status).toBe(201);
      await expectError(
        await client.post('/api/projects', cast.gm.cookie, {
          ...base,
          name: base.name.toUpperCase(),
        }),
        409,
        'PROJECT_NAME_TAKEN',
      );
      await expectError(
        await client.post('/api/projects', cast.gm.cookie, {
          ...base,
          name: `Big ${cast.run}`,
          milestones: Array.from({ length: 31 }, (_, i) => ({ name: `M${i}` })),
        }),
        409,
        'LIMIT_REACHED',
      );
      // Another client may use the same name.
      const other = await cast.createClient();
      expect(
        (await client.post('/api/projects', cast.gm.cookie, { ...base, clientId: other.id }))
          .status,
      ).toBe(201);
    });
  });

  describe('read', () => {
    it('shows every project to every user, with money only for money access (M1)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, {
        milestones: [{ name: 'Build', installmentMinor: 1000 }],
      });
      const plain = await cast.signedIn();
      const seen = await detail(project.id, plain.cookie);
      expect(seen.money).toBeUndefined();
      expect(seen.milestones[0]?.money).toBeUndefined();
      expect(seen.permissions).toEqual({
        canManage: false,
        canChangeManager: false,
        canCancel: false,
        canReopen: false,
        canArchive: false,
        canSeeMoney: false,
        canEditMoney: false,
        canBill: false,
      });
      const byFinance = await detail(project.id, finance.cookie);
      expect(byFinance.money).toEqual({ currency: 'USD', totalMinor: 1000 });
      expect(byFinance.permissions).toMatchObject({ canManage: false, canSeeMoney: true });
      const byAm = await detail(project.id, cast.am.cookie);
      expect(byAm.permissions).toMatchObject({
        canManage: true,
        canChangeManager: true,
        canCancel: true,
        canReopen: false,
        canEditMoney: true,
        canBill: true,
      });
      const byOtherAm = await detail(project.id, cast.otherAm.cookie);
      expect(byOtherAm.money).toBeUndefined();
      expect(byOtherAm.permissions.canManage).toBe(false);
      const byManager = await detail(project.id, cast.employee.cookie);
      expect(byManager.permissions).toMatchObject({
        canManage: true,
        canChangeManager: false,
        canCancel: false,
        canSeeMoney: false,
      });
      expect((await client.get(`/api/projects/${randomUUID()}`, plain.cookie)).status).toBe(404);
    });

    it('lists open projects by default and filters them', async () => {
      const first = await cast.createClient({
        tradeName: `مطعم ${cast.run} ${randomUUID().slice(0, 4)}`,
      });
      const second = await cast.createClient();
      const designer = await cast.signedIn();
      const late = await cast.createProject(first.id, {
        name: `Late ${cast.run}`,
        startDate: '2025-01-01',
        dueDate: '2025-02-01',
      });
      const web = await cast.createProject(second.id, {
        name: `Web ${cast.run}`,
        projectManagerId: designer.id,
        departments: ['development'],
      });
      const cancelled = await cast.createProject(second.id, { name: `Cancelled ${cast.run}` });
      expect(
        (await status(cancelled.id, cast.gm.cookie, { status: 'cancelled', reason: 'Dropped' }))
          .status,
      ).toBe(200);

      const mine = await list(`search=${cast.run}&pageSize=100`, cast.employee.cookie);
      const ids = mine.items.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([late.id, web.id]));
      expect(ids).not.toContain(cancelled.id);
      expect(mine.items.find((item) => item.id === late.id)).toMatchObject({
        overdue: true,
        client: { id: first.id, name: first.tradeName },
      });

      const byClientName = await list(
        `search=${encodeURIComponent(first.tradeName)}`,
        cast.employee.cookie,
      );
      expect(byClientName.items.map((item) => item.id)).toEqual([late.id]);
      expect((await list(`clientId=${second.id}`, cast.employee.cookie)).total).toBe(1);
      expect(
        (await list(`projectManagerId=${designer.id}`, cast.employee.cookie)).items.map(
          (i) => i.id,
        ),
      ).toEqual([web.id]);
      const development = await list(
        `department=development&clientId=${second.id}`,
        cast.employee.cookie,
      );
      expect(development.items.map((item) => item.id)).toEqual([web.id]);
      const overdue = await list(`overdue=true&clientId=${first.id}`, cast.employee.cookie);
      expect(overdue.items.map((item) => item.id)).toEqual([late.id]);
      expect((await list(`overdue=false&clientId=${first.id}`, cast.employee.cookie)).total).toBe(
        0,
      );
      const closed = await list(`status=cancelled&clientId=${second.id}`, cast.employee.cookie);
      expect(closed.items.map((item) => item.id)).toEqual([cancelled.id]);
      const byName = await list(
        `clientId=${second.id}&status=planned&status=cancelled&sort=name`,
        cast.employee.cookie,
      );
      expect(byName.items.map((item) => item.id)).toEqual([cancelled.id, web.id]);
    });

    it('lists archived projects for scope-all holders only', async () => {
      expect((await client.get('/api/projects?archived=true', cast.am.cookie)).status).toBe(403);
      expect((await client.get('/api/projects?archived=true', cast.operations.cookie)).status).toBe(
        200,
      );
    });
  });

  describe('update', () => {
    it('lets the project manager edit basics, never the manager or money', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const response = await patch(project.id, cast.employee.cookie, {
        name: ` Renamed ${cast.run} `,
        departments: ['photography'],
        dueDate: '2099-11-15',
      });
      expect(response.status).toBe(200);
      expect(projectDetailSchema.parse(await response.json())).toMatchObject({
        name: `Renamed ${cast.run}`,
        departments: ['photography'],
        dueDate: '2099-11-15',
      });
      const other = await cast.signedIn();
      expect(
        (await patch(project.id, cast.employee.cookie, { projectManagerId: other.id })).status,
      ).toBe(403);
      expect((await patch(project.id, cast.employee.cookie, { currency: 'SYP' })).status).toBe(403);
      expect((await patch(project.id, other.cookie, { name: 'x' })).status).toBe(403);
      // An account manager of another client is out of scope.
      expect((await patch(project.id, cast.otherAm.cookie, { name: 'x' })).status).toBe(403);
      expect((await status(project.id, cast.otherAm.cookie, { status: 'active' })).status).toBe(
        403,
      );
      expect((await status(project.id, other.cookie, { status: 'active' })).status).toBe(403);
      await expectError(
        await patch(project.id, cast.employee.cookie, { startDate: '2099-11-16' }),
        400,
        'INVALID_DATES',
      );
      const [entry] = (await auditOf(project.id)).filter((e) => e.action === 'project.updated');
      expect(entry?.before).toMatchObject({ departments: ['design'], dueDate: '2099-12-31' });
    });

    it('moves the assigned scope with the project manager (rule 3, edge case 10)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const next = await cast.signedIn();
      const response = await patch(project.id, cast.am.cookie, {
        projectManagerId: next.id,
        name: `Handed ${cast.run}`,
        currency: 'SYP',
      });
      expect(response.status).toBe(200);
      expect((await patch(project.id, cast.employee.cookie, { name: 'x' })).status).toBe(403);
      expect((await patch(project.id, next.cookie, { name: `Mine ${cast.run}` })).status).toBe(200);
      const actions = (await auditOf(project.id)).map((entry) => entry.action);
      // One PATCH changing several kinds of fields writes one entry per action.
      expect(actions).toEqual([
        'project.created',
        'project.updated',
        'project.project_manager_changed',
        'project.money_updated',
        'project.updated',
      ]);
    });

    it('locks the currency once amounts are set (M2)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, {
        milestones: [{ name: 'Build', installmentMinor: 500 }],
      });
      await expectError(
        await patch(project.id, cast.gm.cookie, { currency: 'SYP' }),
        409,
        'CURRENCY_LOCKED',
      );
      expect((await patch(project.id, cast.gm.cookie, { currency: 'USD' })).status).toBe(200);
    });
  });

  describe('status', () => {
    it('follows the diagram and completes only with every milestone done (rule 6)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, {
        milestones: [{ name: 'One' }, { name: 'Two' }],
      });
      await expectError(
        await status(project.id, cast.employee.cookie, { status: 'completed' }),
        409,
        'INVALID_TRANSITION',
      );
      for (const next of ['active', 'on_hold', 'active']) {
        expect((await status(project.id, cast.employee.cookie, { status: next })).status).toBe(200);
      }
      const [one, two] = project.milestones;
      await client.post(
        `/api/projects/${project.id}/milestones/${one?.id}/complete`,
        cast.employee.cookie,
      );
      const refused = await expectError(
        await status(project.id, cast.employee.cookie, { status: 'completed' }),
        409,
        'MILESTONES_OPEN',
      );
      expect(refused.details).toEqual([{ id: two?.id, name: 'Two' }]);
      await client.post(
        `/api/projects/${project.id}/milestones/${two?.id}/complete`,
        cast.employee.cookie,
      );
      const completed = await status(project.id, cast.employee.cookie, { status: 'completed' });
      expect(projectDetailSchema.parse(await completed.json())).toMatchObject({
        status: 'completed',
        permissions: { canManage: false },
      });
      expect((await detail(project.id, cast.employee.cookie)).completedAt).not.toBeNull();
      // Rule 7: closed projects are read-only.
      await expectError(
        await patch(project.id, cast.gm.cookie, { name: 'x' }),
        409,
        'PROJECT_CLOSED',
      );
      // Reopening needs scope all.
      expect((await status(project.id, cast.employee.cookie, { status: 'active' })).status).toBe(
        403,
      );
      expect((await status(project.id, cast.am.cookie, { status: 'active' })).status).toBe(403);
      const reopened = await status(project.id, cast.operations.cookie, { status: 'active' });
      expect(projectDetailSchema.parse(await reopened.json())).toMatchObject({
        status: 'active',
        completedAt: null,
      });
      const entries = (await auditOf(project.id)).filter(
        (e) => e.action === 'project.status_changed',
      );
      expect(entries.map((e) => e.after)).toEqual([
        { status: 'active' },
        { status: 'on_hold' },
        { status: 'active' },
        { status: 'completed' },
        { status: 'active' },
      ]);
    });

    it('cancels with a reason, by client scope only', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      expect(
        (await status(project.id, cast.employee.cookie, { status: 'cancelled', reason: 'No' }))
          .status,
      ).toBe(403);
      expect((await status(project.id, cast.am.cookie, { status: 'cancelled' })).status).toBe(400);
      const cancelled = await status(project.id, cast.am.cookie, {
        status: 'cancelled',
        reason: 'Client withdrew',
      });
      expect(projectDetailSchema.parse(await cancelled.json())).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Client withdrew',
      });
      const [entry] = (await auditOf(project.id)).filter(
        (e) => e.action === 'project.status_changed',
      );
      expect(entry?.after).toEqual({ status: 'cancelled', reason: 'Client withdrew' });
    });

    it('reopens only with a valid project manager (edge case 8)', async () => {
      const { id: clientId } = await cast.createClient();
      const manager = await cast.signedIn();
      const project = await cast.createProject(clientId, { projectManagerId: manager.id });
      await status(project.id, cast.gm.cookie, { status: 'cancelled', reason: 'Paused deal' });
      expect((await client.post(`/api/users/${manager.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      expect((await detail(project.id, cast.gm.cookie)).projectManager.archived).toBe(true);
      await expectError(
        await status(project.id, cast.gm.cookie, { status: 'active' }),
        400,
        'INVALID_PROJECT_MANAGER',
      );
      // The way out: reopen with a new project manager.
      expect(
        (
          await status(project.id, cast.gm.cookie, {
            status: 'on_hold',
            projectManagerId: cast.employee.id,
          })
        ).status,
      ).toBe(400);
      const reopened = await status(project.id, cast.gm.cookie, {
        status: 'active',
        projectManagerId: cast.employee.id,
      });
      expect(projectDetailSchema.parse(await reopened.json())).toMatchObject({
        status: 'active',
        projectManager: { id: cast.employee.id, archived: false },
      });
      const actions = (await auditOf(project.id)).map((entry) => entry.action);
      expect(actions.slice(-2)).toEqual([
        'project.project_manager_changed',
        'project.status_changed',
      ]);
    });
  });

  describe('archive and restore', () => {
    it('hides archived projects and keeps them read-only until restored', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      expect(
        (await client.post(`/api/projects/${project.id}/archive`, cast.am.cookie)).status,
      ).toBe(403);
      const archived = await client.post(`/api/projects/${project.id}/archive`, cast.gm.cookie);
      expect(projectDetailSchema.parse(await archived.json()).archivedAt).not.toBeNull();
      expect((await client.get(`/api/projects/${project.id}`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect((await list(`clientId=${clientId}`, cast.gm.cookie)).total).toBe(0);
      expect((await list(`clientId=${clientId}&archived=true`, cast.gm.cookie)).total).toBe(1);
      await expectError(
        await patch(project.id, cast.gm.cookie, { name: 'x' }),
        409,
        'PROJECT_ARCHIVED',
      );
      await expectError(
        await client.post(`/api/projects/${project.id}/archive`, cast.gm.cookie),
        409,
        'PROJECT_ARCHIVED',
      );
      // The name is free while archived; restoring checks it again.
      const twin = await cast.createProject(clientId, { name: project.name });
      await expectError(
        await client.post(`/api/projects/${project.id}/restore`, cast.gm.cookie),
        409,
        'PROJECT_NAME_TAKEN',
      );
      await patch(twin.id, cast.gm.cookie, { name: `Twin ${cast.run}` });
      for (const user of [cast.am, cast.employee]) {
        expect((await client.post(`/api/projects/${project.id}/restore`, user.cookie)).status).toBe(
          403,
        );
      }
      expect(
        (await client.post(`/api/projects/${project.id}/restore`, cast.operations.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post(`/api/projects/${project.id}/restore`, cast.gm.cookie),
        409,
        'PROJECT_NOT_ARCHIVED',
      );
      const actions = (await auditOf(project.id)).map((entry) => entry.action);
      expect(actions).toEqual(['project.created', 'project.archived', 'project.restored']);
    });

    it('hides the work of an archived client with it (G2)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      await client.post(`/api/clients/${clientId}/archive`, cast.gm.cookie);
      expect((await client.get(`/api/projects/${project.id}`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect((await list(`clientId=${clientId}`, cast.gm.cookie)).total).toBe(0);
      expect((await detail(project.id, cast.gm.cookie)).permissions.canManage).toBe(false);
      await expectError(
        await patch(project.id, cast.gm.cookie, { name: 'x' }),
        409,
        'CLIENT_ARCHIVED',
      );
      await client.post(`/api/clients/${clientId}/restore`, cast.gm.cookie);
      expect((await list(`clientId=${clientId}`, cast.employee.cookie)).total).toBe(1);
    });
  });
});
