import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  leadDetailSchema,
  leadNoteSchema,
  loseLeadResultSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedLeadCast } from './lead-cast.js';
import { startApp } from './start-app.js';

describe('lead activity log (F03 rule 4)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedLeadCast>>;
  const today = businessDate();

  const log = (leadId: string, body: Record<string, unknown> = {}, cookie = cast.am.cookie) =>
    client.post(`/api/leads/${leadId}/notes`, cookie, {
      channel: 'whatsapp',
      summary: 'Sent the portfolio',
      nextFollowUpOn: addDays(today, 2),
      ...body,
    });

  const editNote = (leadId: string, noteId: string, body: unknown, cookie = cast.am.cookie) =>
    client.request('PATCH', `/api/leads/${leadId}/notes/${noteId}`, { cookie, body });

  const archiveNote = (leadId: string, noteId: string, cookie = cast.am.cookie) =>
    client.post(`/api/leads/${leadId}/notes/${noteId}/archive`, cookie);

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action as never)));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedLeadCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('answers 401 without a session and 403 without lead management', async () => {
    const lead = await cast.createLead();
    const noteId = randomUUID();
    expect((await client.post(`/api/leads/${lead.id}/notes`)).status).toBe(401);
    expect(
      (await client.request('PATCH', `/api/leads/${lead.id}/notes/${noteId}`, { body: {} })).status,
    ).toBe(401);
    expect((await client.post(`/api/leads/${lead.id}/notes/${noteId}/archive`)).status).toBe(401);
    for (const cookie of [cast.employee.cookie, cast.operations.cookie]) {
      expect((await log(lead.id, {}, cookie)).status).toBe(403);
    }
    const note = await ok(await log(lead.id), leadNoteSchema, 201);
    for (const cookie of [cast.employee.cookie, cast.operations.cookie]) {
      expect((await editNote(lead.id, note.id, { summary: 'x' }, cookie)).status).toBe(403);
      expect((await archiveNote(lead.id, note.id, cookie)).status).toBe(403);
    }
    // Another owner's lead is out of an account manager's scope.
    const theirs = await cast.createLead({ ownerId: cast.otherAm.id });
    expect((await log(theirs.id)).status).toBe(404);
    const theirNote = await ok(
      await log(theirs.id, {}, cast.communicator.cookie),
      leadNoteSchema,
      201,
    );
    expect((await editNote(theirs.id, theirNote.id, { summary: 'x' })).status).toBe(404);
    expect((await archiveNote(theirs.id, theirNote.id)).status).toBe(404);
  });

  it('logs an activity and sets the next follow-up date in the same request', async () => {
    const lead = await cast.createLead();
    const note = await ok(await log(lead.id), leadNoteSchema, 201);
    expect(note).toMatchObject({
      leadId: lead.id,
      channel: 'whatsapp',
      summary: 'Sent the portfolio',
      author: { id: cast.am.id, name: cast.am.name },
      canEdit: true,
      canArchive: true,
    });
    const read = await ok(
      await client.get(`/api/leads/${lead.id}`, cast.am.cookie),
      leadDetailSchema,
    );
    expect(read.nextFollowUpOn).toBe(addDays(today, 2));
    expect(read.notes.map((item) => item.id)).toEqual([note.id]);
    expect(await auditOf(note.id, 'lead_note.created')).toHaveLength(1);
    const [entry] = await auditOf(lead.id, 'lead.follow_up_changed');
    expect(entry?.after).toMatchObject({ nextFollowUpOn: addDays(today, 2) });
  });

  it('needs a valid date and a past or present time', async () => {
    const lead = await cast.createLead();
    expect((await log(lead.id, { nextFollowUpOn: undefined })).status).toBe(400);
    await expectError(
      await log(lead.id, { nextFollowUpOn: addDays(today, -1) }),
      400,
      'INVALID_DATES',
    );
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await log(lead.id, { occurredAt: future })).status).toBe(400);
  });

  it('refuses activities on closed and archived leads', async () => {
    const lead = await cast.createLead();
    const note = await ok(await log(lead.id), leadNoteSchema, 201);
    await ok(
      await client.post(`/api/leads/${lead.id}/lose`, cast.am.cookie, { reason: 'price' }),
      loseLeadResultSchema,
    );
    await expectError(await log(lead.id), 409, 'LEAD_CLOSED');
    await expectError(await editNote(lead.id, note.id, { summary: 'x' }), 409, 'LEAD_CLOSED');
    await expectError(await archiveNote(lead.id, note.id), 409, 'LEAD_CLOSED');
    const archived = await cast.createLead();
    await client.post(`/api/leads/${archived.id}/archive`, cast.communicator.cookie);
    await expectError(await log(archived.id, {}, cast.communicator.cookie), 409, 'LEAD_ARCHIVED');
  });

  it('lets only the author edit a note', async () => {
    const lead = await cast.createLead();
    const note = await ok(await log(lead.id), leadNoteSchema, 201);
    expect(
      (await editNote(lead.id, note.id, { summary: 'x' }, cast.communicator.cookie)).status,
    ).toBe(403);
    const edited = await ok(
      await editNote(lead.id, note.id, { summary: 'Called back', channel: 'call' }),
      leadNoteSchema,
    );
    expect(edited).toMatchObject({ summary: 'Called back', channel: 'call' });
    const [entry] = await auditOf(note.id, 'lead_note.updated');
    expect(entry?.before).toMatchObject({ summary: 'Sent the portfolio', channel: 'whatsapp' });
    expect((await editNote(lead.id, randomUUID(), { summary: 'x' })).status).toBe(404);
  });

  it('lets the author or a scope-all manager archive a note', async () => {
    const lead = await cast.createLead();
    const byCommunicator = await ok(
      await log(lead.id, {}, cast.communicator.cookie),
      leadNoteSchema,
      201,
    );
    // The owner without scope all cannot archive someone else's note.
    expect((await archiveNote(lead.id, byCommunicator.id)).status).toBe(403);
    const byOwner = await ok(await log(lead.id), leadNoteSchema, 201);
    expect((await archiveNote(lead.id, byOwner.id, cast.marketer.cookie)).status).toBe(204);
    expect((await archiveNote(lead.id, byCommunicator.id, cast.communicator.cookie)).status).toBe(
      204,
    );
    expect(await auditOf(byOwner.id, 'lead_note.archived')).toHaveLength(1);
    const read = await ok(
      await client.get(`/api/leads/${lead.id}`, cast.am.cookie),
      leadDetailSchema,
    );
    expect(read.notes).toEqual([]);
    expect((await archiveNote(lead.id, byOwner.id, cast.marketer.cookie)).status).toBe(404);
  });
});
