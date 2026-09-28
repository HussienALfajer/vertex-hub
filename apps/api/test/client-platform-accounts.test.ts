import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  CLIENT_LIMITS,
  clientDetailResponseSchema,
  platformAccountSchema,
} from '@vertex-hub/contracts';
import { auditEntries, clientPlatformAccounts, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('client platform accounts', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;

  const path = (clientId: string, accountId?: string) =>
    `/api/clients/${clientId}/platform-accounts${accountId ? `/${accountId}` : ''}`;
  const create = (clientId: string, cookie: string | undefined, body: unknown) =>
    client.post(path(clientId), cookie, body);
  const instagram = { platform: 'instagram', url: 'https://instagram.com/client' };

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
    expect((await create(id, undefined, instagram)).status).toBe(401);
    expect((await client.request('PATCH', path(id, id), { body: {} })).status).toBe(401);
    expect((await client.post(`${path(id, id)}/archive`)).status).toBe(401);
  });

  it('adds, edits and removes accounts, several per platform, audited', async () => {
    const { id } = await cast.createClient();
    const response = await create(id, cast.am.cookie, {
      ...instagram,
      agencyAccess: 'pending',
      adminNote: 'The owner holds admin access',
    });
    expect(response.status).toBe(201);
    const account = platformAccountSchema.parse(await response.json());
    expect(account).toMatchObject({ clientId: id, agencyAccess: 'pending', label: null });
    expect((await create(id, cast.am.cookie, instagram)).status).toBe(201);

    const updated = await client.request('PATCH', path(id, account.id), {
      cookie: cast.am.cookie,
      body: { agencyAccess: 'granted' },
    });
    expect(platformAccountSchema.parse(await updated.json()).agencyAccess).toBe('granted');
    expect((await client.post(`${path(id, account.id)}/archive`, cast.am.cookie)).status).toBe(204);
    const profile = clientDetailResponseSchema.parse(
      await (await client.get(`/api/clients/${id}`, cast.employee.cookie)).json(),
    );
    expect(profile.platformAccounts).toHaveLength(1);
    const audit = await db
      .select({ action: auditEntries.action, after: auditEntries.after })
      .from(auditEntries)
      .where(eq(auditEntries.entityId, account.id))
      .orderBy(auditEntries.id);
    expect(audit).toEqual([
      {
        action: 'client_platform_account.created',
        after: expect.objectContaining({ clientId: id, agencyAccess: 'pending' }),
      },
      {
        action: 'client_platform_account.updated',
        after: { clientId: id, agencyAccess: 'granted' },
      },
      { action: 'client_platform_account.archived', after: { clientId: id } },
    ]);
  });

  it('needs a label for an other platform, also against the stored platform', async () => {
    const { id } = await cast.createClient();
    const other = { platform: 'other', url: 'https://t.me/client' };
    expect((await create(id, cast.gm.cookie, other)).status).toBe(400);
    const labelled = platformAccountSchema.parse(
      await (await create(id, cast.gm.cookie, { ...other, label: 'Telegram' })).json(),
    );
    const clear = await client.request('PATCH', path(id, labelled.id), {
      cookie: cast.gm.cookie,
      body: { label: null },
    });
    expect(clear.status).toBe(400);
    const plain = platformAccountSchema.parse(
      await (await create(id, cast.gm.cookie, instagram)).json(),
    );
    const toOther = await client.request('PATCH', path(id, plain.id), {
      cookie: cast.gm.cookie,
      body: { platform: 'other' },
    });
    expect(toOther.status).toBe(400);
  });

  it('refuses links that are not http or https', async () => {
    const { id } = await cast.createClient();
    expect(
      (await create(id, cast.gm.cookie, { ...instagram, url: 'javascript:alert(1)' })).status,
    ).toBe(400);
  });

  it('keeps accounts to those who manage the client, and to their own client', async () => {
    const { id } = await cast.createClient();
    const other = await cast.createClient();
    const account = platformAccountSchema.parse(
      await (await create(id, cast.gm.cookie, instagram)).json(),
    );
    for (const cookie of [cast.employee.cookie, cast.otherAm.cookie]) {
      expect((await create(id, cookie, instagram)).status).toBe(403);
      expect((await client.post(`${path(id, account.id)}/archive`, cookie)).status).toBe(403);
    }
    expect(
      (
        await client.request('PATCH', path(other.id, account.id), {
          cookie: cast.gm.cookie,
          body: { agencyAccess: 'none' },
        })
      ).status,
    ).toBe(404);
  });

  it('refuses changes on an archived client and past the limit', async () => {
    const archived = await cast.createClient();
    await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
    await expectError(await create(archived.id, cast.gm.cookie, instagram), 409, 'CLIENT_ARCHIVED');

    const full = await cast.createClient();
    await db.insert(clientPlatformAccounts).values(
      Array.from({ length: CLIENT_LIMITS.platformAccounts }, () => ({
        clientId: full.id,
        platform: 'website' as const,
        url: 'https://example.com',
      })),
    );
    await expectError(await create(full.id, cast.gm.cookie, instagram), 409, 'LIMIT_REACHED');
  });
});
