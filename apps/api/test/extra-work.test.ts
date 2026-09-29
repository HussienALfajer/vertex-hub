import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { addDays, businessDate, extraWorkPageSchema, extraWorkSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('extra work', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  const today = businessDate();

  type Owner = 'projects' | 'retainers';
  const base = (owner: Owner, id: string) => `/api/${owner}/${id}/extra-work`;
  const log = (owner: Owner, id: string, cookie: string | undefined, body: unknown) =>
    client.post(base(owner, id), cookie, body);
  const edit = (
    owner: Owner,
    id: string,
    itemId: string,
    cookie: string | undefined,
    body: unknown,
  ) => client.request('PATCH', `${base(owner, id)}/${itemId}`, { cookie, body });
  const bill = (
    owner: Owner,
    id: string,
    itemId: string,
    cookie: string | undefined,
    body: unknown,
  ) => client.post(`${base(owner, id)}/${itemId}/billing`, cookie, body);
  const list = async (owner: Owner, id: string, cookie: string, query = '') => {
    const response = await client.get(`${base(owner, id)}${query}`, cookie);
    expect(response.status).toBe(200);
    return extraWorkPageSchema.parse(await response.json());
  };
  const logged = async (owner: Owner, id: string, cookie: string, body: object = {}) => {
    const response = await log(owner, id, cookie, { title: 'Extra reel', ...body });
    expect(response.status).toBe(201);
    return extraWorkSchema.parse(await response.json());
  };
  const contactOf = async (clientId: string) => {
    const response = await client.post(`/api/clients/${clientId}/contacts`, cast.gm.cookie, {
      name: `جهة ${cast.run}`,
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };

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
    const [id, itemId] = [randomUUID(), randomUUID()];
    for (const owner of ['projects', 'retainers'] as const) {
      expect((await client.get(base(owner, id))).status).toBe(401);
      expect((await log(owner, id, undefined, {})).status).toBe(401);
      expect((await edit(owner, id, itemId, undefined, {})).status).toBe(401);
      expect((await bill(owner, id, itemId, undefined, {})).status).toBe(401);
      expect((await client.post(`${base(owner, id)}/${itemId}/archive`)).status).toBe(401);
    }
  });

  describe('on a project', () => {
    it('lets the project manager log work without money; estimates need money access', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const contactId = await contactOf(clientId);
      const item = await logged('projects', project.id, cast.employee.cookie, {
        description: 'A fifth reel for the launch',
        requestedByContactId: contactId,
      });
      expect(item).toMatchObject({
        projectId: project.id,
        retainerId: null,
        requestedOn: today,
        contact: { id: contactId, archived: false },
        loggedBy: { id: cast.employee.id },
        billingStatus: 'unbilled',
      });
      expect(item.money).toBeUndefined();
      expect(
        (await log('projects', project.id, cast.employee.cookie, { title: 'x', estimateMinor: 1 }))
          .status,
      ).toBe(403);
      const other = await cast.signedIn();
      expect((await log('projects', project.id, other.cookie, { title: 'x' })).status).toBe(403);
      expect((await log('projects', project.id, finance.cookie, { title: 'x' })).status).toBe(403);

      const priced = await logged('projects', project.id, cast.gm.cookie, { estimateMinor: 25000 });
      expect(priced.money).toEqual({ estimateMinor: 25000, currency: 'USD' });
      expect((await list('projects', project.id, cast.employee.cookie)).items).toHaveLength(2);
      const forFinance = await list('projects', project.id, finance.cookie);
      expect(forFinance.items.map((entry) => entry.money?.estimateMinor)).toEqual([25000, null]);
      const [entry] = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, item.id));
      expect(entry).toMatchObject({ action: 'extra_work.created', actorId: cast.employee.id });
      expect(entry?.after).toMatchObject({ projectId: project.id, title: 'Extra reel' });
    });

    it('checks the contact and the request date', async () => {
      const { id: clientId } = await cast.createClient();
      const { id: otherClientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      await expectError(
        await log('projects', project.id, cast.gm.cookie, {
          title: 'x',
          requestedByContactId: await contactOf(otherClientId),
        }),
        400,
        'UNKNOWN_CONTACT',
      );
      await expectError(
        await log('projects', project.id, cast.gm.cookie, {
          title: 'x',
          requestedOn: addDays(today, 1),
        }),
        400,
        'INVALID_DATES',
      );
      const item = await logged('projects', project.id, cast.gm.cookie);
      await expectError(
        await edit('projects', project.id, item.id, cast.gm.cookie, {
          requestedOn: addDays(today, 3),
        }),
        400,
        'INVALID_DATES',
      );
      const edited = await edit('projects', project.id, item.id, cast.employee.cookie, {
        title: 'Two extra reels',
      });
      expect(edited.status).toBe(200);
      expect(extraWorkSchema.parse(await edited.json()).title).toBe('Two extra reels');
    });

    it('locks the project currency once an estimate is set (M2)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      await logged('projects', project.id, cast.gm.cookie, { estimateMinor: 100 });
      await expectError(
        await client.request('PATCH', `/api/projects/${project.id}`, {
          cookie: cast.gm.cookie,
          body: { currency: 'SYP' },
        }),
        409,
        'CURRENCY_LOCKED',
      );
    });

    it('bills with client scope and money access; waived and billed need a note', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const item = await logged('projects', project.id, cast.employee.cookie);
      expect(
        (
          await bill('projects', project.id, item.id, cast.employee.cookie, {
            billingStatus: 'waived',
            billingNote: 'x',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await bill('projects', project.id, item.id, finance.cookie, {
            billingStatus: 'waived',
            billingNote: 'x',
          })
        ).status,
      ).toBe(403);
      await expectError(
        await bill('projects', project.id, item.id, cast.am.cookie, { billingStatus: 'waived' }),
        400,
        'BILLING_NOTE_REQUIRED',
      );
      const waived = await bill('projects', project.id, item.id, cast.am.cookie, {
        billingStatus: 'waived',
        billingNote: 'Goodwill for the launch',
      });
      expect(waived.status).toBe(200);
      expect(extraWorkSchema.parse(await waived.json())).toMatchObject({
        billingStatus: 'waived',
        billingNote: 'Goodwill for the launch',
      });
      const actions = (
        await db
          .select()
          .from(auditEntries)
          .where(eq(auditEntries.entityId, item.id))
          .orderBy(auditEntries.id)
      ).map((entry) => entry.action);
      expect(actions).toEqual(['extra_work.created', 'extra_work.billing_changed']);
      expect(
        (await list('projects', project.id, cast.gm.cookie, '?billingStatus=unbilled')).total,
      ).toBe(0);
    });

    it('is read-only on a closed project except billing (rule 7, M3)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, { status: 'active' });
      const item = await logged('projects', project.id, cast.gm.cookie);
      await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
        status: 'completed',
      });
      await expectError(
        await log('projects', project.id, cast.gm.cookie, { title: 'x' }),
        409,
        'PROJECT_CLOSED',
      );
      await expectError(
        await edit('projects', project.id, item.id, cast.gm.cookie, { title: 'y' }),
        409,
        'PROJECT_CLOSED',
      );
      const closed = await client.get(`/api/projects/${project.id}`, cast.gm.cookie);
      expect((await closed.json()).permissions).toMatchObject({
        canManage: false,
        canEditMoney: false,
        canBill: true,
      });
      expect(
        (
          await bill('projects', project.id, item.id, cast.gm.cookie, {
            billingStatus: 'billed',
            billingNote: 'INV-2026-014',
          })
        ).status,
      ).toBe(200);
    });

    it('archives an item: hidden from the list and 404 afterwards', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const item = await logged('projects', project.id, cast.employee.cookie);
      const archive = (cookie: string) =>
        client.post(`${base('projects', project.id)}/${item.id}/archive`, cookie);
      expect((await archive(cast.otherAm.cookie)).status).toBe(403);
      expect((await archive(cast.employee.cookie)).status).toBe(204);
      expect((await list('projects', project.id, cast.gm.cookie)).total).toBe(0);
      expect((await archive(cast.gm.cookie)).status).toBe(404);
      expect((await client.get(base('projects', randomUUID()), cast.gm.cookie)).status).toBe(404);
    });
  });

  describe('on a retainer', () => {
    it('is logged with client scope only, in the retainer’s currency', async () => {
      const { id: clientId } = await cast.createClient();
      const retainer = await cast.createRetainer(clientId, { currency: 'SYP' });
      const item = await logged('retainers', retainer.id, cast.am.cookie, {
        estimateMinor: 700000,
      });
      expect(item).toMatchObject({
        retainerId: retainer.id,
        projectId: null,
        money: { estimateMinor: 700000, currency: 'SYP' },
      });
      expect(
        (await log('retainers', retainer.id, cast.employee.cookie, { title: 'x' })).status,
      ).toBe(403);
      expect(
        (await log('retainers', retainer.id, cast.otherAm.cookie, { title: 'x' })).status,
      ).toBe(403);
      expect((await list('retainers', retainer.id, cast.employee.cookie)).items[0]?.money).toBe(
        undefined,
      );
      await expectError(
        await client.request('PATCH', `/api/retainers/${retainer.id}`, {
          cookie: cast.gm.cookie,
          body: { currency: 'USD' },
        }),
        409,
        'CURRENCY_LOCKED',
      );
    });

    it('refuses new work on an ended retainer but still bills it (R12, M3)', async () => {
      const { id: clientId } = await cast.createClient();
      const retainer = await cast.createRetainer(clientId);
      const item = await logged('retainers', retainer.id, cast.am.cookie);
      await client.post(`/api/retainers/${retainer.id}/status`, cast.am.cookie, {
        status: 'ended',
      });
      await expectError(
        await log('retainers', retainer.id, cast.am.cookie, { title: 'x' }),
        409,
        'RETAINER_ENDED',
      );
      expect(
        (
          await bill('retainers', retainer.id, item.id, cast.am.cookie, {
            billingStatus: 'billed',
            billingNote: 'INV-2026-015',
          })
        ).status,
      ).toBe(200);
      await client.post(`/api/retainers/${retainer.id}/archive`, cast.gm.cookie);
      await expectError(
        await bill('retainers', retainer.id, item.id, cast.gm.cookie, {
          billingStatus: 'unbilled',
        }),
        409,
        'RETAINER_ARCHIVED',
      );
    });
  });
});
