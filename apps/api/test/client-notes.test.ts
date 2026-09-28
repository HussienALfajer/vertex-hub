import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { contactSchema, notePageSchema, noteSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('client notes', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;

  const path = (clientId: string, noteId?: string) =>
    `/api/clients/${clientId}/notes${noteId ? `/${noteId}` : ''}`;
  const create = async (clientId: string, cookie: string, body: object = {}) => {
    const response = await client.post(path(clientId), cookie, {
      channel: 'call',
      summary: 'Agreed on the April plan',
      ...body,
    });
    expect(response.status).toBe(201);
    return noteSchema.parse(await response.json());
  };
  const patch = (clientId: string, noteId: string, cookie: string, body: unknown) =>
    client.request('PATCH', path(clientId, noteId), { cookie, body });
  const list = async (clientId: string, cookie: string, query = '') => {
    const response = await client.get(`${path(clientId)}${query}`, cookie);
    expect(response.status).toBe(200);
    return notePageSchema.parse(await response.json());
  };

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
    expect((await client.get(path(id))).status).toBe(401);
    expect((await client.post(path(id), undefined, { channel: 'call', summary: 'x' })).status).toBe(
      401,
    );
    expect((await client.request('PATCH', path(id, id), { body: {} })).status).toBe(401);
    expect((await client.post(`${path(id, id)}/archive`)).status).toBe(401);
  });

  it('lets every user write in the log, newest first, audited', async () => {
    const { id } = await cast.createClient();
    const older = await create(id, cast.employee.cookie, {
      occurredAt: '2025-01-05T10:00:00+03:00',
      channel: 'meeting',
    });
    const newer = await create(id, cast.otherAm.cookie);
    expect(older).toMatchObject({
      occurredAt: '2025-01-05T07:00:00.000Z',
      author: { id: cast.employee.id, name: cast.employee.name },
      contact: null,
      canEdit: true,
      canArchive: true,
    });
    const page = await list(id, cast.employee.cookie);
    expect(page.items.map((note) => note.id)).toEqual([newer.id, older.id]);
    expect(page.items[0]).toMatchObject({ canEdit: false, canArchive: false });
    expect((await list(id, cast.gm.cookie)).items[0]).toMatchObject({
      canEdit: false,
      canArchive: true,
    });
    expect(
      (await list(id, cast.employee.cookie, '?channel=meeting')).items.map((n) => n.id),
    ).toEqual([older.id]);
    expect(
      (await list(id, cast.employee.cookie, `?authorId=${cast.otherAm.id}`)).items.map((n) => n.id),
    ).toEqual([newer.id]);
    const [entry] = await db.select().from(auditEntries).where(eq(auditEntries.entityId, older.id));
    expect(entry).toMatchObject({
      action: 'client_note.created',
      entityType: 'client_note',
      after: { clientId: id, channel: 'meeting' },
    });
  });

  it('refuses a note dated in the future (edge case 9)', async () => {
    const { id } = await cast.createClient();
    const response = await client.post(path(id), cast.employee.cookie, {
      channel: 'call',
      summary: 'x',
      occurredAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    expect(response.status).toBe(400);
  });

  it('links a contact of the same client only, and keeps it once removed (rule 10)', async () => {
    const { id } = await cast.createClient();
    const other = await cast.createClient();
    const contact = contactSchema.parse(
      await (
        await client.post(`/api/clients/${id}/contacts`, cast.gm.cookie, { name: 'ليلى' })
      ).json(),
    );
    const foreign = contactSchema.parse(
      await (
        await client.post(`/api/clients/${other.id}/contacts`, cast.gm.cookie, { name: 'سامر' })
      ).json(),
    );
    await expectError(
      await client.post(path(id), cast.employee.cookie, {
        channel: 'call',
        summary: 'x',
        contactId: foreign.id,
      }),
      400,
      'UNKNOWN_CONTACT',
    );
    const note = await create(id, cast.employee.cookie, { contactId: contact.id });
    expect(note.contact).toEqual({ id: contact.id, name: 'ليلى', archived: false });
    expect((await list(id, cast.employee.cookie, `?contactId=${contact.id}`)).total).toBe(1);

    await client.post(`/api/clients/${id}/contacts/${contact.id}/archive`, cast.gm.cookie);
    expect((await list(id, cast.employee.cookie)).items[0]?.contact).toEqual({
      id: contact.id,
      name: 'ليلى',
      archived: true,
    });
    // Keeping the removed contact is fine; setting it anew is not.
    expect(
      (await patch(id, note.id, cast.employee.cookie, { contactId: contact.id, summary: 'y' }))
        .status,
    ).toBe(200);
    const plain = await create(id, cast.employee.cookie);
    await expectError(
      await patch(id, plain.id, cast.employee.cookie, { contactId: contact.id }),
      400,
      'UNKNOWN_CONTACT',
    );
  });

  it('lets only the author edit; the author or scope all archives (rule 11)', async () => {
    const { id } = await cast.createClient();
    const note = await create(id, cast.employee.cookie);
    await expectError(
      await patch(id, note.id, cast.am.cookie, { summary: 'changed' }),
      403,
      'NOT_NOTE_AUTHOR',
    );
    await expectError(
      await patch(id, note.id, cast.gm.cookie, { summary: 'changed' }),
      403,
      'NOT_NOTE_AUTHOR',
    );
    const edited = await patch(id, note.id, cast.employee.cookie, { summary: ' changed ' });
    expect(noteSchema.parse(await edited.json()).summary).toBe('changed');
    await expectError(
      await client.post(`${path(id, note.id)}/archive`, cast.am.cookie),
      403,
      'NOT_NOTE_AUTHOR',
    );
    expect((await client.post(`${path(id, note.id)}/archive`, cast.gm.cookie)).status).toBe(204);
    expect((await list(id, cast.employee.cookie)).items).toEqual([]);
    await expectError(
      await patch(id, note.id, cast.employee.cookie, { summary: 'again' }),
      409,
      'NOTE_ARCHIVED',
    );
    await expectError(
      await client.post(`${path(id, note.id)}/archive`, cast.employee.cookie),
      409,
      'NOTE_ARCHIVED',
    );
    const audit = await db
      .select({ action: auditEntries.action })
      .from(auditEntries)
      .where(eq(auditEntries.entityId, note.id))
      .orderBy(auditEntries.id);
    expect(audit.map((entry) => entry.action)).toEqual([
      'client_note.created',
      'client_note.updated',
      'client_note.archived',
    ]);
  });

  it('keeps notes to their client and refuses them on an archived client', async () => {
    const { id } = await cast.createClient();
    const other = await cast.createClient();
    const note = await create(id, cast.employee.cookie);
    expect((await patch(other.id, note.id, cast.employee.cookie, { summary: 'x' })).status).toBe(
      404,
    );
    expect((await client.get(path(randomUUID()), cast.employee.cookie)).status).toBe(404);

    await client.post(`/api/clients/${id}/archive`, cast.gm.cookie);
    expect((await client.get(path(id), cast.employee.cookie)).status).toBe(404);
    await expectError(
      await client.post(path(id), cast.gm.cookie, { channel: 'call', summary: 'x' }),
      409,
      'CLIENT_ARCHIVED',
    );
    const archivedLog = await list(id, cast.gm.cookie);
    expect(archivedLog.items[0]).toMatchObject({ canEdit: false, canArchive: false });
  });
});
