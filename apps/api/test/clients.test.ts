import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  brandKitSchema,
  clientDetailResponseSchema,
  clientPageSchema,
  sectorListResponseSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('clients', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;

  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/clients/${id}`, { cookie, body });
  const detail = async (id: string, cookie: string) => {
    const response = await client.get(`/api/clients/${id}`, cookie);
    expect(response.status).toBe(200);
    return clientDetailResponseSchema.parse(await response.json());
  };
  const list = async (query: string, cookie: string) => {
    const response = await client.get(`/api/clients?${query}`, cookie);
    expect(response.status).toBe(200);
    return clientPageSchema.parse(await response.json());
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
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/clients')).status).toBe(401);
    expect((await client.get('/api/clients/sectors')).status).toBe(401);
    expect((await client.get(`/api/clients/${id}`)).status).toBe(401);
    expect((await client.post('/api/clients', undefined, { tradeName: 'x' })).status).toBe(401);
    expect((await patch(id, undefined, { tradeName: 'x' })).status).toBe(401);
    expect((await client.post(`/api/clients/${id}/archive`)).status).toBe(401);
    expect((await client.post(`/api/clients/${id}/restore`)).status).toBe(401);
    expect((await client.request('PUT', `/api/clients/${id}/brand-kit`, { body: {} })).status).toBe(
      401,
    );
  });

  describe('create', () => {
    it('is for scope-all holders only (rule 5)', async () => {
      const body = { tradeName: `x ${cast.run}`, accountManagerId: cast.am.id };
      expect((await client.post('/api/clients', cast.employee.cookie, body)).status).toBe(403);
      expect((await client.post('/api/clients', cast.am.cookie, body)).status).toBe(403);
    });

    it('creates an active client, audited, with the approval-contact warning', async () => {
      const created = await cast.createClient({ sector: ' Restaurants ', isHealthcare: true });
      expect(created).toMatchObject({
        sector: 'Restaurants',
        status: 'active',
        isHealthcare: true,
        accountManager: { id: cast.am.id, name: cast.am.name, archived: false },
        hasApprovalContact: false,
        contacts: [],
        platformAccounts: [],
        archivedAt: null,
        canManage: true,
      });
      expect(created.brandKit).toEqual({
        colors: [],
        fonts: [],
        toneOfVoice: null,
        forbiddenWords: [],
        files: [],
        references: [],
      });
      const [entry] = await auditOf(created.id);
      expect(entry).toMatchObject({
        action: 'client.created',
        entityType: 'client',
        actorId: cast.gm.id,
        after: {
          tradeName: created.tradeName,
          accountManager: { id: cast.am.id, name: cast.am.name },
          isHealthcare: true,
        },
      });
    });

    it('lets the Operations manager create clients', async () => {
      const response = await client.post('/api/clients', cast.operations.cookie, {
        tradeName: `عمليات ${cast.run}`,
        accountManagerId: cast.am.id,
      });
      expect(response.status).toBe(201);
      cast.trackClient(clientDetailResponseSchema.parse(await response.json()).id);
    });

    it('needs a non-archived account manager; an invited one qualifies (rule 2)', async () => {
      const post = (accountManagerId: string) =>
        client.post('/api/clients', cast.gm.cookie, {
          tradeName: `مدير ${randomUUID().slice(0, 6)}`,
          accountManagerId,
        });
      await expectError(await post(cast.employee.id), 400, 'INVALID_ACCOUNT_MANAGER');
      const archived = await cast.signedIn({ roles: ['account_manager'] });
      const invited = await seedUser(db, { roles: ['account_manager'], password: null });
      cast.trackUser(invited.id);
      await client.post(`/api/users/${archived.id}/archive`, cast.gm.cookie);
      await expectError(await post(archived.id), 400, 'INVALID_ACCOUNT_MANAGER');
      await expectError(await post(randomUUID()), 400, 'INVALID_ACCOUNT_MANAGER');
      await cast.createClient({ accountManagerId: invited.id });
    });

    it('keeps trade names unique regardless of case (rule 6)', async () => {
      const first = await cast.createClient({ tradeName: `Cafe ${cast.run}` });
      await expectError(
        await client.post('/api/clients', cast.gm.cookie, {
          tradeName: ` cafe ${cast.run.toUpperCase()} `,
          accountManagerId: cast.am.id,
        }),
        409,
        'CLIENT_NAME_TAKEN',
      );
      // The spaces inside a name count once, also in searches.
      await expectError(
        await client.post('/api/clients', cast.gm.cookie, {
          tradeName: `Cafe   ${cast.run}`,
          accountManagerId: cast.am.id,
        }),
        409,
        'CLIENT_NAME_TAKEN',
      );
      const spaced = await cast.createClient({ tradeName: `Spaced  \t name ${cast.run}` });
      expect(spaced.tradeName).toBe(`Spaced name ${cast.run}`);
      const found = await list(
        `search=${encodeURIComponent(`spaced    name ${cast.run}`)}`,
        cast.gm.cookie,
      );
      expect(found.items.map((item) => item.id)).toEqual([spaced.id]);
      const second = await cast.createClient();
      await expectError(
        await patch(second.id, cast.gm.cookie, { tradeName: first.tradeName.toUpperCase() }),
        409,
        'CLIENT_NAME_TAKEN',
      );
    });
  });

  describe('list and profile', () => {
    it('shows every client to every user, with the account manager', async () => {
      const created = await cast.createClient();
      const page = await list(
        `search=${encodeURIComponent(created.tradeName)}`,
        cast.employee.cookie,
      );
      expect(page.items).toEqual([
        {
          id: created.id,
          tradeName: created.tradeName,
          sector: null,
          status: 'active',
          isHealthcare: false,
          accountManager: { id: cast.am.id, name: cast.am.name, archived: false },
          hasApprovalContact: false,
        },
      ]);
      const profile = await detail(created.id, cast.employee.cookie);
      expect(profile.canManage).toBe(false);
      expect((await detail(created.id, cast.am.cookie)).canManage).toBe(true);
      expect((await detail(created.id, cast.otherAm.cookie)).canManage).toBe(false);
    });

    it('filters by status, account manager, sector and healthcare', async () => {
      const sector = `Clinics ${cast.run}`;
      const ended = await cast.createClient({ sector, status: 'ended' });
      const healthcare = await cast.createClient({
        sector: sector.toLowerCase(),
        isHealthcare: true,
        accountManagerId: cast.otherAm.id,
      });
      const cookie = cast.employee.cookie;
      const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id).sort();
      const bySector = `sector=${encodeURIComponent(sector.toUpperCase())}`;
      expect(ids(await list(bySector, cookie))).toEqual([healthcare.id]);
      expect(ids(await list(`${bySector}&status=ended&status=active`, cookie))).toEqual(
        [ended.id, healthcare.id].sort(),
      );
      expect(ids(await list(`${bySector}&status=ended`, cookie))).toEqual([ended.id]);
      expect(ids(await list(`${bySector}&status=ended&healthcare=true`, cookie))).toEqual([]);
      expect(ids(await list(`${bySector}&accountManagerId=${cast.otherAm.id}`, cookie))).toEqual([
        healthcare.id,
      ]);
      const sectors = sectorListResponseSchema.parse(
        await (await client.get('/api/clients/sectors', cookie)).json(),
      );
      expect(
        sectors.items.filter((item) => item.toLowerCase() === sector.toLowerCase()),
      ).toHaveLength(1);
    });

    it('sorts by trade name or creation time', async () => {
      const b = await cast.createClient({ tradeName: `sort ${cast.run} B` });
      const a = await cast.createClient({ tradeName: `Sort ${cast.run} a` });
      const search = `search=${encodeURIComponent(`sort ${cast.run}`)}`;
      const names = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);
      expect(names(await list(search, cast.employee.cookie))).toEqual([a.id, b.id]);
      expect(
        names(await list(`${search}&sort=createdAt&order=desc`, cast.employee.cookie)),
      ).toEqual([a.id, b.id]);
      expect(names(await list(`${search}&sort=createdAt`, cast.employee.cookie))).toEqual([
        b.id,
        a.id,
      ]);
    });

    it('answers 404 for an unknown client and 400 for a malformed id', async () => {
      expect((await client.get(`/api/clients/${randomUUID()}`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect((await client.get('/api/clients/nope', cast.employee.cookie)).status).toBe(400);
    });
  });

  describe('update', () => {
    it('lets the account manager edit basics and status of their own clients only', async () => {
      const own = await cast.createClient();
      const response = await patch(own.id, cast.am.cookie, {
        tradeName: `${own.tradeName} 2`,
        sector: 'Retail',
        status: 'paused',
      });
      expect(response.status).toBe(200);
      expect(clientDetailResponseSchema.parse(await response.json())).toMatchObject({
        tradeName: `${own.tradeName} 2`,
        sector: 'Retail',
        status: 'paused',
      });
      expect((await patch(own.id, cast.otherAm.cookie, { status: 'active' })).status).toBe(403);
      expect((await patch(own.id, cast.employee.cookie, { status: 'active' })).status).toBe(403);
    });

    it('keeps the account manager and healthcare flag to scope all (rule 5)', async () => {
      const own = await cast.createClient();
      expect(
        (await patch(own.id, cast.am.cookie, { accountManagerId: cast.otherAm.id })).status,
      ).toBe(403);
      expect((await patch(own.id, cast.am.cookie, { isHealthcare: true })).status).toBe(403);
      // Sending the current values is not a change.
      expect(
        (await patch(own.id, cast.am.cookie, { accountManagerId: cast.am.id, isHealthcare: false }))
          .status,
      ).toBe(200);
    });

    it('writes one audit entry per kind of change', async () => {
      const created = await cast.createClient();
      const response = await patch(created.id, cast.operations.cookie, {
        tradeName: `${created.tradeName} جديد`,
        status: 'ended',
        accountManagerId: cast.otherAm.id,
        isHealthcare: true,
      });
      expect(response.status).toBe(200);
      const entries = (await auditOf(created.id)).slice(1);
      expect(entries.map((entry) => entry.action)).toEqual([
        'client.updated',
        'client.status_changed',
        'client.account_manager_changed',
        'client.healthcare_changed',
      ]);
      expect(entries[0]).toMatchObject({
        before: { tradeName: created.tradeName },
        after: { tradeName: `${created.tradeName} جديد` },
      });
      expect(entries[2]).toMatchObject({
        before: { accountManager: { id: cast.am.id, name: cast.am.name } },
        after: { accountManager: { id: cast.otherAm.id, name: cast.otherAm.name } },
      });
    });

    it('moves management to the new account manager at once (rule 4)', async () => {
      const created = await cast.createClient();
      expect(
        (await patch(created.id, cast.gm.cookie, { accountManagerId: cast.otherAm.id })).status,
      ).toBe(200);
      expect((await patch(created.id, cast.am.cookie, { status: 'paused' })).status).toBe(403);
      expect((await patch(created.id, cast.otherAm.cookie, { status: 'paused' })).status).toBe(200);
    });

    it('needs a valid account manager to reactivate an ended client (rule 3)', async () => {
      const manager = await cast.signedIn({ roles: ['account_manager'] });
      const created = await cast.createClient({ accountManagerId: manager.id, status: 'ended' });
      // An ended client does not block removing the role (rule 8).
      expect(
        (
          await client.request('PATCH', `/api/users/${manager.id}`, {
            cookie: cast.gm.cookie,
            body: { roles: [] },
          })
        ).status,
      ).toBe(200);
      expect((await patch(created.id, cast.gm.cookie, { sector: 'Other' })).status).toBe(200);
      await expectError(
        await patch(created.id, cast.gm.cookie, { status: 'active' }),
        400,
        'INVALID_ACCOUNT_MANAGER',
      );
      const reactivated = await patch(created.id, cast.gm.cookie, {
        status: 'paused',
        accountManagerId: cast.am.id,
      });
      expect(reactivated.status).toBe(200);
    });
  });

  describe('archive and restore', () => {
    it('is for scope-all holders only', async () => {
      const created = await cast.createClient();
      expect((await client.post(`/api/clients/${created.id}/archive`, cast.am.cookie)).status).toBe(
        403,
      );
      expect(
        (await client.post(`/api/clients/${created.id}/archive`, cast.employee.cookie)).status,
      ).toBe(403);
      expect((await client.get('/api/clients?archived=true', cast.am.cookie)).status).toBe(403);
    });

    it('hides an archived client from everyone but scope all, and keeps it read-only', async () => {
      const created = await cast.createClient();
      const archived = await client.post(
        `/api/clients/${created.id}/archive`,
        cast.operations.cookie,
      );
      expect(archived.status).toBe(200);
      expect(clientDetailResponseSchema.parse(await archived.json())).toMatchObject({
        archivedAt: expect.any(String),
        canManage: false,
        status: 'active',
      });
      expect((await client.get(`/api/clients/${created.id}`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect((await client.get(`/api/clients/${created.id}`, cast.am.cookie)).status).toBe(404);
      const search = `search=${encodeURIComponent(created.tradeName)}`;
      expect((await list(search, cast.gm.cookie)).items).toEqual([]);
      expect(
        (await list(`${search}&archived=true`, cast.gm.cookie)).items.map((c) => c.id),
      ).toEqual([created.id]);
      await expectError(
        await client.post(`/api/clients/${created.id}/archive`, cast.gm.cookie),
        409,
        'CLIENT_ARCHIVED',
      );
      await expectError(
        await patch(created.id, cast.gm.cookie, { status: 'paused' }),
        409,
        'CLIENT_ARCHIVED',
      );
      await expectError(
        await client.request('PUT', `/api/clients/${created.id}/brand-kit`, {
          cookie: cast.gm.cookie,
          body: {},
        }),
        409,
        'CLIENT_ARCHIVED',
      );

      const restored = await client.post(`/api/clients/${created.id}/restore`, cast.gm.cookie);
      expect(restored.status).toBe(200);
      expect(clientDetailResponseSchema.parse(await restored.json()).archivedAt).toBeNull();
      await expectError(
        await client.post(`/api/clients/${created.id}/restore`, cast.gm.cookie),
        409,
        'CLIENT_NOT_ARCHIVED',
      );
      expect((await auditOf(created.id)).map((entry) => entry.action)).toEqual([
        'client.created',
        'client.archived',
        'client.restored',
      ]);
    });

    it('refuses to restore over a reused name or without a valid account manager', async () => {
      const created = await cast.createClient();
      await client.post(`/api/clients/${created.id}/archive`, cast.gm.cookie);
      const reused = await cast.createClient({ tradeName: created.tradeName });
      await expectError(
        await client.post(`/api/clients/${created.id}/restore`, cast.gm.cookie),
        409,
        'CLIENT_NAME_TAKEN',
      );
      await patch(reused.id, cast.gm.cookie, { tradeName: `${created.tradeName} (2)` });

      const manager = await cast.signedIn({ roles: ['account_manager'] });
      const managed = await cast.createClient({ accountManagerId: manager.id });
      await client.post(`/api/clients/${managed.id}/archive`, cast.gm.cookie);
      // An archived client does not block removing the role (rule 8).
      expect(
        (
          await client.request('PATCH', `/api/users/${manager.id}`, {
            cookie: cast.gm.cookie,
            body: { roles: [] },
          })
        ).status,
      ).toBe(200);
      await expectError(
        await client.post(`/api/clients/${managed.id}/restore`, cast.gm.cookie),
        400,
        'INVALID_ACCOUNT_MANAGER',
      );
      expect((await client.post(`/api/clients/${created.id}/restore`, cast.gm.cookie)).status).toBe(
        200,
      );
    });
  });

  describe('brand kit', () => {
    it('replaces the kit, normalized, and audits the changed keys only', async () => {
      const created = await cast.createClient();
      const put = (cookie: string, body: unknown) =>
        client.request('PUT', `/api/clients/${created.id}/brand-kit`, { cookie, body });
      const response = await put(cast.am.cookie, {
        colors: [{ name: 'Primary', hex: '#1a2b3c' }],
        fonts: ['Cairo', 'cairo'],
        forbiddenWords: ['رخيص'],
        files: [{ kind: 'logo', label: 'Logo', url: 'https://drive.example/logo' }],
      });
      expect(response.status).toBe(200);
      expect(brandKitSchema.parse(await response.json())).toMatchObject({
        colors: [{ name: 'Primary', hex: '#1A2B3C' }],
        fonts: ['Cairo'],
      });
      expect((await detail(created.id, cast.employee.cookie)).brandKit.forbiddenWords).toEqual([
        'رخيص',
      ]);
      const [, entry] = await auditOf(created.id);
      expect(entry?.action).toBe('client.brand_kit_updated');
      expect(Object.keys(entry?.after ?? {}).sort()).toEqual([
        'colors',
        'files',
        'fonts',
        'forbiddenWords',
      ]);

      // A second write on the stored kit logs only what changed, and nothing when nothing did.
      const { brandKit: kit } = await detail(created.id, cast.am.cookie);
      expect((await put(cast.am.cookie, { ...kit, toneOfVoice: 'Warm and direct' })).status).toBe(
        200,
      );
      expect((await put(cast.am.cookie, { ...kit, toneOfVoice: 'Warm and direct' })).status).toBe(
        200,
      );
      const entries = await auditOf(created.id);
      expect(entries).toHaveLength(3);
      expect(Object.keys(entries[2]?.after ?? {})).toEqual(['toneOfVoice']);

      expect((await put(cast.employee.cookie, {})).status).toBe(403);
      expect((await put(cast.otherAm.cookie, {})).status).toBe(403);
      const invalid = await put(cast.am.cookie, { colors: [{ hex: 'red' }] });
      expect(invalid.status).toBe(400);
    });
  });
});
