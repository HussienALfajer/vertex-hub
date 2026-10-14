import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CLIENT_LIMITS, clientDetailResponseSchema, contactSchema } from '@vertex-hub/contracts';
import { auditEntries, clientContacts, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('client contacts', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;

  const path = (clientId: string, contactId?: string) =>
    `/api/clients/${clientId}/contacts${contactId ? `/${contactId}` : ''}`;
  const create = (clientId: string, cookie: string | undefined, body: unknown) =>
    client.post(path(clientId), cookie, body);
  const profile = async (clientId: string) =>
    clientDetailResponseSchema.parse(
      await (await client.get(`/api/clients/${clientId}`, cast.gm.cookie)).json(),
    );

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
    expect((await create(id, undefined, { name: 'x' })).status).toBe(401);
    expect((await client.request('PATCH', path(id, id), { body: {} })).status).toBe(401);
    expect((await client.post(`${path(id, id)}/archive`)).status).toBe(401);
  });

  it('adds normalized contacts, audited with the client id', async () => {
    const { id } = await cast.createClient();
    const response = await create(id, cast.am.cookie, {
      name: ' ليلى ',
      jobTitle: 'Marketing lead',
      phone: '00963 944 123 456',
      email: 'Laila@Client.Example',
      hasFinalApproval: true,
    });
    expect(response.status).toBe(201);
    const contact = contactSchema.parse(await response.json());
    expect(contact).toMatchObject({
      clientId: id,
      name: 'ليلى',
      phone: '+963944123456',
      email: 'laila@client.example',
      hasFinalApproval: true,
      notes: null,
    });
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, contact.id));
    expect(entry).toMatchObject({
      action: 'client_contact.created',
      entityType: 'client_contact',
      after: { clientId: id, name: 'ليلى' },
    });
    expect((await profile(id)).contacts.map((c) => c.id)).toEqual([contact.id]);
  });

  it('shows the approval warning while no contact has final approval (rule 9)', async () => {
    const { id } = await cast.createClient();
    const plain = contactSchema.parse(
      await (await create(id, cast.gm.cookie, { name: 'A' })).json(),
    );
    expect((await profile(id)).hasApprovalContact).toBe(false);
    const approver = contactSchema.parse(
      await (await create(id, cast.gm.cookie, { name: 'B', hasFinalApproval: true })).json(),
    );
    expect((await profile(id)).hasApprovalContact).toBe(true);
    const updated = await client.request('PATCH', path(id, plain.id), {
      cookie: cast.gm.cookie,
      body: { hasFinalApproval: true },
    });
    expect(contactSchema.parse(await updated.json()).hasFinalApproval).toBe(true);
    for (const contact of [plain, approver]) {
      expect((await client.post(`${path(id, contact.id)}/archive`, cast.gm.cookie)).status).toBe(
        204,
      );
    }
    const after = await profile(id);
    expect(after.hasApprovalContact).toBe(false);
    expect(after.contacts).toEqual([]);
    const audit = await db
      .select({ action: auditEntries.action, after: auditEntries.after })
      .from(auditEntries)
      .where(eq(auditEntries.entityId, plain.id))
      .orderBy(auditEntries.id);
    expect(audit).toEqual([
      { action: 'client_contact.created', after: expect.objectContaining({ clientId: id }) },
      {
        action: 'client_contact.updated',
        after: { clientId: id, hasFinalApproval: true },
      },
      { action: 'client_contact.archived', after: { clientId: id } },
    ]);
  });

  it('keeps contacts to those who manage the client', async () => {
    const { id } = await cast.createClient();
    const contact = contactSchema.parse(
      await (await create(id, cast.gm.cookie, { name: 'A' })).json(),
    );
    for (const cookie of [cast.employee.cookie, cast.otherAm.cookie]) {
      expect((await create(id, cookie, { name: 'B' })).status).toBe(403);
      expect(
        (await client.request('PATCH', path(id, contact.id), { cookie, body: { name: 'C' } }))
          .status,
      ).toBe(403);
      expect((await client.post(`${path(id, contact.id)}/archive`, cookie)).status).toBe(403);
    }
    expect((await create(randomUUID(), cast.gm.cookie, { name: 'B' })).status).toBe(404);
  });

  it('never moves a contact to another client (rule 12)', async () => {
    const first = await cast.createClient();
    const second = await cast.createClient();
    const contact = contactSchema.parse(
      await (await create(first.id, cast.gm.cookie, { name: 'A' })).json(),
    );
    expect(
      (
        await client.request('PATCH', path(second.id, contact.id), {
          cookie: cast.gm.cookie,
          body: { name: 'B' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await client.post(`${path(second.id, contact.id)}/archive`, cast.gm.cookie)).status,
    ).toBe(404);
  });

  it('refuses changes on an archived client and past the limit', async () => {
    const archived = await cast.createClient();
    await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
    await expectError(
      await create(archived.id, cast.gm.cookie, { name: 'A' }),
      409,
      'CLIENT_ARCHIVED',
    );

    const full = await cast.createClient();
    await db.insert(clientContacts).values(
      Array.from({ length: CLIENT_LIMITS.contacts }, (_, i) => ({
        clientId: full.id,
        name: `Contact ${i}`,
      })),
    );
    await expectError(
      await create(full.id, cast.gm.cookie, { name: 'One more' }),
      409,
      'LIMIT_REACHED',
    );
  });

  it('validates input', async () => {
    const { id } = await cast.createClient();
    expect((await create(id, cast.gm.cookie, { name: 'A', email: 'nope' })).status).toBe(400);
    expect((await create(id, cast.gm.cookie, { name: '' })).status).toBe(400);
  });

  describe('legal fields (F05C)', () => {
    let finance: { id: string; cookie: string };

    beforeAll(async () => {
      finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
      cast.trackUser(finance.id);
    });

    const detailAs = async (clientId: string, cookie: string) =>
      clientDetailResponseSchema.parse(
        await (await client.get(`/api/clients/${clientId}`, cookie)).json(),
      );

    it('keeps the father name for every reader and the national ID for its holders', async () => {
      const { id } = await cast.createClient();
      const response = await create(id, cast.am.cookie, {
        name: 'سارة',
        fatherName: ' أحمد ',
        nationalId: ' 01020304050 ',
      });
      expect(response.status).toBe(201);
      const contact = contactSchema.parse(await response.json());
      expect(contact).toMatchObject({ fatherName: 'أحمد', nationalId: '01020304050' });

      const manager = await detailAs(id, cast.am.cookie);
      expect(manager.canManageNationalId).toBe(true);
      expect(manager.contacts[0]).toMatchObject({ fatherName: 'أحمد', nationalId: '01020304050' });
      expect((await detailAs(id, cast.gm.cookie)).contacts[0]?.nationalId).toBe('01020304050');

      // An employee reads the client without managing it; Finance has money access only.
      for (const cookie of [cast.employee.cookie, finance.cookie, cast.otherAm.cookie]) {
        const detail = await detailAs(id, cookie);
        expect(detail.canManageNationalId).toBe(false);
        expect(detail.contacts[0]).toMatchObject({ fatherName: 'أحمد' });
        expect(detail.contacts[0]).not.toHaveProperty('nationalId');
      }
    });

    it('records that the national ID changed, never its value', async () => {
      const { id } = await cast.createClient();
      const contact = contactSchema.parse(
        await (await create(id, cast.gm.cookie, { name: 'ليلى', nationalId: '111' })).json(),
      );
      const updated = await client.request('PATCH', path(id, contact.id), {
        cookie: cast.am.cookie,
        body: { nationalId: '222', fatherName: 'خالد' },
      });
      expect(updated.status).toBe(200);
      expect(contactSchema.parse(await updated.json())).toMatchObject({
        nationalId: '222',
        fatherName: 'خالد',
      });
      const audit = await db
        .select({ before: auditEntries.before, after: auditEntries.after })
        .from(auditEntries)
        .where(eq(auditEntries.entityId, contact.id))
        .orderBy(auditEntries.id);
      expect(audit[0]?.after).toMatchObject({ nationalId: 'changed' });
      expect(audit[1]).toEqual({
        before: { nationalId: 'changed', fatherName: null },
        after: { clientId: id, nationalId: 'changed', fatherName: 'خالد' },
      });
      expect(JSON.stringify(audit)).not.toMatch(/111|222/);
    });

    it('keeps the stored national ID when a contact is edited without it (edge case 12)', async () => {
      const { id } = await cast.createClient();
      const contact = contactSchema.parse(
        await (await create(id, cast.gm.cookie, { name: 'ريم', nationalId: '333' })).json(),
      );
      const updated = await client.request('PATCH', path(id, contact.id), {
        cookie: cast.am.cookie,
        body: { jobTitle: 'المديرة' },
      });
      expect(updated.status).toBe(200);
      const [row] = await db
        .select({ nationalId: clientContacts.nationalId })
        .from(clientContacts)
        .where(eq(clientContacts.id, contact.id));
      expect(row?.nationalId).toBe('333');
    });

    it('refuses the national ID to callers without its access (403)', async () => {
      const { id } = await cast.createClient();
      const contact = contactSchema.parse(
        await (await create(id, cast.gm.cookie, { name: 'هند' })).json(),
      );
      for (const cookie of [finance.cookie, cast.otherAm.cookie, cast.employee.cookie]) {
        expect((await create(id, cookie, { name: 'x', nationalId: '1' })).status).toBe(403);
        const response = await client.request('PATCH', path(id, contact.id), {
          cookie,
          body: { nationalId: '1' },
        });
        expect(response.status).toBe(403);
      }
      expect(
        (await create(id, cast.gm.cookie, { name: 'x', nationalId: '1'.repeat(31) })).status,
      ).toBe(400);
    });
  });
});
