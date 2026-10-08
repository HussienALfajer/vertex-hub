import type { INestApplication } from '@nestjs/common';
import { auditPageSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase, newId } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAudit } from '../src/modules/audit/index.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('audit log', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let manager: Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;
  /** An entity id no other test touches, so filters see only this file's entries. */
  const entityId = newId();

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    manager = await client.signInWithTwoFactor(db, { roles: ['general_manager'] });
    seeded.push(manager.id);
    const actor = { id: manager.id, name: manager.name };
    await recordAudit(db, {
      actor,
      action: 'department.updated',
      entityType: 'department',
      entityId,
      before: { name: 'قديم' },
      after: { name: 'جديد' },
    });
    await recordAudit(db, { actor: null, action: 'user.created', entityType: 'user', entityId });
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(auditEntries).where(eq(auditEntries.entityId, entityId));
    await removeUsers(db, seeded);
    await connection.close();
  });

  const list = async (query: string, cookie = manager.cookie) => {
    const response = await client.get(`/api/audit?${query}`, cookie);
    expect(response.status).toBe(200);
    return auditPageSchema.parse(await response.json());
  };

  it('requires a session', async () => {
    expect((await client.get('/api/audit')).status).toBe(401);
  });

  it('is closed to users without audit.read', async () => {
    const employee = await seedUser(db, { departments: [{ code: 'internal_operations' }] });
    seeded.push(employee.id);
    expect((await client.get('/api/audit', await client.signIn(employee.email))).status).toBe(403);
  });

  it('is open to the General Manager and the Operations manager', async () => {
    const operations = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'internal_operations', manager: true }],
    });
    seeded.push(operations.id);
    const page = await list(`entityId=${entityId}`, operations.cookie);
    expect(page.total).toBe(2);
  });

  it('lists entries newest first with the actor name and the changed fields', async () => {
    const page = await list(`entityId=${entityId}`);
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 50 });
    expect(page.items.map((item) => item.action)).toEqual(['user.created', 'department.updated']);
    expect(page.items[0]).toMatchObject({ actorId: null, actorName: null });
    expect(page.items[1]).toMatchObject({
      actorId: manager.id,
      actorName: manager.name,
      entityType: 'department',
      before: { name: 'قديم' },
      after: { name: 'جديد' },
    });
  });

  it('filters by entity type, actor, action and time', async () => {
    expect((await list(`entityId=${entityId}&entityType=user`)).total).toBe(1);
    expect((await list(`entityId=${entityId}&actorId=${manager.id}`)).total).toBe(1);
    expect((await list(`entityId=${entityId}&action=department.updated`)).total).toBe(1);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await list(`entityId=${entityId}&from=${future}`)).total).toBe(0);
    expect((await list(`entityId=${entityId}&to=${future}`)).total).toBe(2);
  });

  it('pages the results', async () => {
    const page = await list(`entityId=${entityId}&pageSize=1&page=2`);
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.items.map((item) => item.action)).toEqual(['department.updated']);
  });

  it('rejects invalid filters', async () => {
    for (const query of [
      'action=user.deleted',
      'pageSize=101',
      'entityId=not-a-uuid',
      // Years outside CALENDAR_YEARS, which the time zone conversions cannot handle.
      'from=0000-01-01T00:00:00Z',
      'to=9999-12-31T23:59:59Z',
    ]) {
      expect((await client.get(`/api/audit?${query}`, manager.cookie)).status, query).toBe(400);
    }
  });

  it('rolls an entry back with the transaction that wrote it', async () => {
    const rolledBack = newId();
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          actor: null,
          action: 'user.updated',
          entityType: 'user',
          entityId: rolledBack,
        });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    const rows = await db.select().from(auditEntries).where(eq(auditEntries.entityId, rolledBack));
    expect(rows).toEqual([]);
  });
});
