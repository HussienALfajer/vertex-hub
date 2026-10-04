import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type ErrorResponse,
  type LeadDetail,
  leadBoardSchema,
  leadDetailSchema,
  leadDuplicatesSchema,
  leadOwnerOptionsSchema,
  leadPageSchema,
  loseLeadResultSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedLeadCast } from './lead-cast.js';
import { startApp } from './start-app.js';

describe('leads (F03 rules 1–3, 5–9, 12)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedLeadCast>>;
  const today = businessDate();

  const detail = (id: string, cookie = cast.communicator.cookie) =>
    client.get(`/api/leads/${id}`, cookie);

  const patch = (
    lead: LeadDetail,
    changes: Record<string, unknown>,
    cookie = cast.communicator.cookie,
  ) =>
    client.request('PATCH', `/api/leads/${lead.id}`, {
      cookie,
      body: { updatedAt: lead.updatedAt, ...changes },
    });

  const action = (
    id: string,
    name: string,
    body: unknown = {},
    cookie = cast.communicator.cookie,
  ) => client.post(`/api/leads/${id}/${name}`, cookie, body);

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action as never)));

  const notificationsOf = (subjectId: string, type: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.subjectId, subjectId), eq(notifications.type, type as never)));

  const lose = (
    id: string,
    body: unknown = { reason: 'price' },
    cookie = cast.communicator.cookie,
  ) => action(id, 'lose', body, cookie);

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

  describe('access', () => {
    it('answers 401 without a session', async () => {
      const id = randomUUID();
      for (const path of [
        '/api/leads',
        '/api/leads/board',
        '/api/leads/owners',
        `/api/leads/${id}`,
      ]) {
        expect((await client.get(path)).status).toBe(401);
      }
      expect((await client.request('PATCH', `/api/leads/${id}`, { body: {} })).status).toBe(401);
      for (const path of [
        '/api/leads',
        '/api/leads/duplicates',
        ...['stage', 'owner', 'lose', 'reopen', 'archive', 'restore'].map(
          (a) => `/api/leads/${id}/${a}`,
        ),
      ]) {
        expect((await client.post(path)).status).toBe(401);
      }
    });

    it('answers 403 to users without lead access', async () => {
      const lead = await cast.createLead();
      for (const cookie of [cast.employee.cookie]) {
        expect((await client.get('/api/leads', cookie)).status).toBe(403);
        expect((await client.get('/api/leads/board', cookie)).status).toBe(403);
        expect((await client.get('/api/leads/owners', cookie)).status).toBe(403);
        expect((await detail(lead.id, cookie)).status).toBe(403);
        expect((await client.post('/api/leads', cookie, {})).status).toBe(403);
        expect((await client.post('/api/leads/duplicates', cookie, {})).status).toBe(403);
        expect((await patch(lead, { request: 'x' }, cookie)).status).toBe(403);
        expect((await action(lead.id, 'stage', { stage: 'contacted' }, cookie)).status).toBe(403);
      }
    });

    it('lets the Operations manager read every lead without lead actions', async () => {
      const lead = await cast.createLead();
      const read = await ok(await detail(lead.id, cast.operations.cookie), leadDetailSchema);
      expect(read.permissions).toEqual({
        canEdit: false,
        moves: [],
        canChangeOwner: false,
        canLogActivity: false,
        canLose: false,
        canReopen: false,
        canConvert: false,
        canArchive: false,
        canRestore: false,
        canNewQuote: true,
      });
      const page = await ok(
        await client.get(
          `/api/leads?search=${encodeURIComponent(cast.run)}`,
          cast.operations.cookie,
        ),
        leadPageSchema,
      );
      expect(page.items.map((item) => item.id)).toContain(lead.id);
      expect((await patch(lead, { request: 'x' }, cast.operations.cookie)).status).toBe(403);
      expect(
        (await action(lead.id, 'stage', { stage: 'contacted' }, cast.operations.cookie)).status,
      ).toBe(403);
      expect((await client.post('/api/leads', cast.operations.cookie, {})).status).toBe(403);
    });

    it('keeps account managers on the leads they own (404 elsewhere)', async () => {
      const mine = await cast.createLead();
      const theirs = await cast.createLead({ ownerId: cast.otherAm.id });
      const page = await ok(
        await client.get(`/api/leads?search=${encodeURIComponent(cast.run)}`, cast.am.cookie),
        leadPageSchema,
      );
      const ids = page.items.map((item) => item.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
      expect((await detail(theirs.id, cast.am.cookie)).status).toBe(404);
      expect((await patch(theirs, { request: 'x' }, cast.am.cookie)).status).toBe(404);
      expect(
        (await action(theirs.id, 'stage', { stage: 'contacted' }, cast.am.cookie)).status,
      ).toBe(404);
      const own = await ok(await detail(mine.id, cast.am.cookie), leadDetailSchema);
      // Quotes on their own leads, but no archive (scope all only).
      expect(own.permissions).toMatchObject({
        canEdit: true,
        canNewQuote: true,
        canArchive: false,
      });
      const board = await ok(
        await client.get(`/api/leads/board?search=${cast.run}`, cast.am.cookie),
        leadBoardSchema,
      );
      const cards = board.columns.flatMap((column) => column.items.map((item) => item.id));
      expect(cards).toContain(mine.id);
      expect(cards).not.toContain(theirs.id);
    });

    it('answers 403 without lead management and 404 on another owner’s lead, for every action', async () => {
      const lead = await cast.createLead({ ownerId: cast.otherAm.id });
      const lost = await cast.createLead({ ownerId: cast.otherAm.id });
      await ok(await lose(lost.id), loseLeadResultSchema);
      const calls: [string, string, unknown][] = [
        [lead.id, 'stage', { stage: 'contacted' }],
        [lead.id, 'owner', { ownerId: cast.am.id }],
        [lead.id, 'lose', { reason: 'price' }],
        [lost.id, 'reopen', { stage: 'new', nextFollowUpOn: cast.tomorrow }],
        [lead.id, 'archive', {}],
        [lead.id, 'restore', {}],
      ];
      for (const [id, name, body] of calls) {
        for (const cookie of [cast.employee.cookie, cast.operations.cookie]) {
          expect((await action(id, name, body, cookie)).status).toBe(403);
        }
        expect((await action(id, name, body, cast.am.cookie)).status).toBe(404);
      }
      expect((await patch(lead, { request: 'x' }, cast.operations.cookie)).status).toBe(403);
    });

    it('lets Marketing members work every lead without writing quotes', async () => {
      const lead = await cast.createLead();
      const read = await ok(await detail(lead.id, cast.marketer.cookie), leadDetailSchema);
      expect(read.permissions).toMatchObject({
        canEdit: true,
        canNewQuote: false,
        canArchive: true,
      });
    });
  });

  describe('create (rules 1–3)', () => {
    it('creates a lead, audits it and tells the owner', async () => {
      const service = await cast.createService();
      const lead = await cast.createLead({
        email: ' Noor@Clinic.SY ',
        socialHandle: '@noor',
        budgetMinor: 40_000,
        budgetCurrency: 'USD',
        sector: 'Healthcare',
        isHealthcare: true,
        request: 'Monthly social',
        interests: [{ serviceId: service.id }],
      });
      expect(lead).toMatchObject({
        stage: 'new',
        email: 'noor@clinic.sy',
        displayName: lead.companyName,
        owner: { id: cast.am.id },
        nextFollowUpOn: cast.tomorrow,
        followUpOverdue: false,
        daysInStage: 0,
        budgetMinor: 40_000,
        budgetCurrency: 'USD',
        isHealthcare: true,
        interests: [{ kind: 'service', id: service.id, name: service.name, archived: false }],
        createdBy: { id: cast.communicator.id },
        ownerCanManage: true,
        notes: [],
      });
      const [entry] = await auditOf(lead.id, 'lead.created');
      expect(entry?.after).toMatchObject({
        name: lead.companyName,
        stage: 'new',
        ownerId: cast.am.id,
      });
      const [notice] = await notificationsOf(lead.id, 'lead_assigned');
      expect(notice).toMatchObject({ recipientId: cast.am.id, actorId: cast.communicator.id });
    });

    it('does not notify an owner who created the lead', async () => {
      const lead = await cast.createLead({}, cast.am.cookie);
      expect(await notificationsOf(lead.id, 'lead_assigned')).toEqual([]);
    });

    it('names a lead by its contact without a company', async () => {
      const lead = await cast.createLead({ companyName: null });
      expect(lead.displayName).toBe(lead.contactName);
    });

    it('refuses a lead without a contact method (CONTACT_REQUIRED)', async () => {
      await expectError(
        await client.post('/api/leads', cast.communicator.cookie, {
          contactName: 'x',
          source: 'instagram',
          nextFollowUpOn: cast.tomorrow,
          ownerId: cast.am.id,
        }),
        400,
        'CONTACT_REQUIRED',
      );
    });

    it('needs a detail for an other source (NOTE_REQUIRED)', async () => {
      const response = await client.post('/api/leads', cast.communicator.cookie, {
        contactName: 'x',
        socialHandle: '@x',
        source: 'other',
        nextFollowUpOn: cast.tomorrow,
        ownerId: cast.am.id,
      });
      await expectError(response, 400, 'NOTE_REQUIRED');
      const lead = await cast.createLead({ source: 'other', sourceDetail: 'Expo' });
      expect(lead.sourceDetail).toBe('Expo');
    });

    it('keeps the follow-up date between today and 180 days ahead (INVALID_DATES)', async () => {
      for (const nextFollowUpOn of [addDays(today, -1), addDays(today, 181)]) {
        const response = await client.post('/api/leads', cast.communicator.cookie, {
          contactName: 'x',
          socialHandle: '@x',
          source: 'instagram',
          nextFollowUpOn,
          ownerId: cast.am.id,
        });
        await expectError(response, 400, 'INVALID_DATES');
      }
      expect((await cast.createLead({ nextFollowUpOn: today })).nextFollowUpOn).toBe(today);
    });

    it('needs an eligible owner (INVALID_LEAD_OWNER)', async () => {
      for (const ownerId of [cast.employee.id, cast.operations.id, randomUUID()]) {
        await expectError(
          await client.post('/api/leads', cast.communicator.cookie, {
            contactName: 'x',
            socialHandle: '@x',
            source: 'instagram',
            nextFollowUpOn: cast.tomorrow,
            ownerId,
          }),
          400,
          'INVALID_LEAD_OWNER',
        );
      }
      for (const owner of [cast.marketer, cast.communicator, cast.gm]) {
        expect((await cast.createLead({ ownerId: owner.id })).owner.id).toBe(owner.id);
      }
    });

    it('lets an account manager create leads for themselves only', async () => {
      await expectError(
        await client.post('/api/leads', cast.am.cookie, {
          contactName: 'x',
          socialHandle: '@x',
          source: 'instagram',
          nextFollowUpOn: cast.tomorrow,
          ownerId: cast.otherAm.id,
        }),
        400,
        'INVALID_LEAD_OWNER',
      );
      expect((await cast.createLead({ ownerId: cast.am.id }, cast.am.cookie)).owner.id).toBe(
        cast.am.id,
      );
    });

    it('takes at most 10 live catalog interests', async () => {
      const tooMany = Array.from({ length: 11 }, () => ({ serviceId: randomUUID() }));
      const base = {
        contactName: 'x',
        socialHandle: '@x',
        source: 'instagram',
        nextFollowUpOn: cast.tomorrow,
        ownerId: cast.am.id,
      };
      await expectError(
        await client.post('/api/leads', cast.communicator.cookie, { ...base, interests: tooMany }),
        400,
        'LIMIT_REACHED',
      );
      const archived = await cast.createService();
      expect(
        (await client.post(`/api/catalog/services/${archived.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post('/api/leads', cast.communicator.cookie, {
          ...base,
          interests: [{ serviceId: archived.id }],
        }),
        409,
        'CATALOG_ITEM_ARCHIVED',
      );
      expect(
        (
          await client.post('/api/leads', cast.communicator.cookie, {
            ...base,
            interests: [{ serviceId: randomUUID() }],
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('edit (rule 7)', () => {
    it('saves the fields and replaces the interests, audited', async () => {
      const [first, second] = [await cast.createService(), await cast.createService()];
      const lead = await cast.createLead({ interests: [{ serviceId: first.id }] });
      const saved = await ok(
        await patch(lead, { request: 'Reels', interests: [{ serviceId: second.id }] }),
        leadDetailSchema,
      );
      expect(saved.request).toBe('Reels');
      expect(saved.interests.map((interest) => interest.id)).toEqual([second.id]);
      const [entry] = await auditOf(lead.id, 'lead.updated');
      expect(entry?.before).toMatchObject({ request: null, interests: [first.id] });
      expect(entry?.after).toMatchObject({ request: 'Reels', interests: [second.id] });
    });

    it('audits a date-only change as a follow-up change', async () => {
      const lead = await cast.createLead();
      await ok(await patch(lead, { nextFollowUpOn: addDays(today, 3) }), leadDetailSchema);
      const [entry] = await auditOf(lead.id, 'lead.follow_up_changed');
      expect(entry?.after).toMatchObject({ nextFollowUpOn: addDays(today, 3) });
    });

    it('keeps an interest archived later (edge case 10)', async () => {
      const service = await cast.createService();
      const lead = await cast.createLead({ interests: [{ serviceId: service.id }] });
      await client.post(`/api/catalog/services/${service.id}/archive`, cast.gm.cookie);
      const saved = await ok(
        await patch(lead, { request: 'Again', interests: [{ serviceId: service.id }] }),
        leadDetailSchema,
      );
      expect(saved.interests).toEqual([
        { kind: 'service', id: service.id, name: service.name, archived: true },
      ]);
    });

    it('refuses a stale save (STALE_LEAD) and the contact rule on the merged lead', async () => {
      const lead = await cast.createLead();
      await ok(await patch(lead, { request: 'first' }), leadDetailSchema);
      await expectError(await patch(lead, { request: 'second' }), 409, 'STALE_LEAD');
      const fresh = await ok(await detail(lead.id), leadDetailSchema);
      await expectError(await patch(fresh, { phone: null }), 400, 'CONTACT_REQUIRED');
    });

    it('refuses edits on closed and archived leads', async () => {
      const lost = await cast.createLead();
      await ok(await lose(lost.id), loseLeadResultSchema);
      const lostNow = await ok(await detail(lost.id), leadDetailSchema);
      await expectError(await patch(lostNow, { request: 'x' }), 409, 'LEAD_CLOSED');
      const archived = await cast.createLead();
      expect((await action(archived.id, 'archive')).status).toBe(204);
      const archivedNow = await ok(await detail(archived.id), leadDetailSchema);
      await expectError(await patch(archivedNow, { request: 'x' }), 409, 'LEAD_ARCHIVED');
    });
  });

  describe('duplicates (rule 2)', () => {
    it('warns about open leads and clients, with only the basics of unreadable leads', async () => {
      const theirs = await cast.createLead({ ownerId: cast.otherAm.id });
      const existing = await cast.createClient();
      const result = await ok(
        await client.post('/api/leads/duplicates', cast.am.cookie, {
          phone: theirs.phone,
          names: [existing.tradeName.toUpperCase()],
        }),
        leadDuplicatesSchema,
      );
      expect(result.leads).toEqual([
        {
          id: theirs.id,
          displayName: theirs.displayName,
          owner: { id: cast.otherAm.id, name: cast.otherAm.name },
          stage: 'new',
          readable: false,
        },
      ]);
      expect(result.clients).toEqual([
        {
          id: existing.id,
          tradeName: existing.tradeName,
          status: 'active',
          accountManager: { id: cast.am.id, name: cast.am.name },
        },
      ]);
      const excluded = await ok(
        await client.post('/api/leads/duplicates', cast.communicator.cookie, {
          phone: theirs.phone,
          excludeLeadId: theirs.id,
        }),
        leadDuplicatesSchema,
      );
      expect(excluded.leads).toEqual([]);
    });

    it('matches a client contact by phone and leaves closed leads out', async () => {
      const existing = await cast.createClient();
      const phone = '+963944000111';
      expect(
        (
          await client.post(`/api/clients/${existing.id}/contacts`, cast.gm.cookie, {
            name: 'Contact',
            phone,
          })
        ).status,
      ).toBe(201);
      const lost = await cast.createLead({ phone });
      await ok(await lose(lost.id), loseLeadResultSchema);
      const result = await ok(
        await client.post('/api/leads/duplicates', cast.communicator.cookie, { phone }),
        leadDuplicatesSchema,
      );
      expect(result.leads.map((lead) => lead.id)).not.toContain(lost.id);
      expect(result.clients.map((match) => match.id)).toContain(existing.id);
    });
  });

  describe('stages (rule 5)', () => {
    it('moves among New, Contacted and Meeting with an optional new date, audited', async () => {
      const lead = await cast.createLead();
      const contacted = await ok(
        await action(lead.id, 'stage', { stage: 'contacted' }),
        leadDetailSchema,
      );
      expect(contacted.stage).toBe('contacted');
      const meeting = await ok(
        await action(lead.id, 'stage', { stage: 'meeting', nextFollowUpOn: addDays(today, 2) }),
        leadDetailSchema,
      );
      expect(meeting).toMatchObject({ stage: 'meeting', nextFollowUpOn: addDays(today, 2) });
      expect(meeting.permissions.moves).toEqual(['new', 'contacted']);
      const entries = await auditOf(lead.id, 'lead.stage_changed');
      expect(entries.map((entry) => entry.after)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: 'meeting', nextFollowUpOn: addDays(today, 2) }),
        ]),
      );
      await expectError(
        await action(lead.id, 'stage', { stage: 'meeting' }),
        409,
        'INVALID_TRANSITION',
      );
      expect((await action(lead.id, 'stage', { stage: 'quote_sent' })).status).toBe(400);
      await expectError(
        await action(lead.id, 'stage', { stage: 'new', nextFollowUpOn: addDays(today, -1) }),
        400,
        'INVALID_DATES',
      );
    });

    it('never moves a closed or archived lead by hand', async () => {
      const lead = await cast.createLead();
      await ok(await lose(lead.id), loseLeadResultSchema);
      await expectError(
        await action(lead.id, 'stage', { stage: 'new' }),
        409,
        'INVALID_TRANSITION',
      );
      const archived = await cast.createLead();
      await action(archived.id, 'archive');
      await expectError(
        await action(archived.id, 'stage', { stage: 'contacted' }),
        409,
        'LEAD_ARCHIVED',
      );
    });
  });

  describe('owner (rule 6, edge case 9)', () => {
    it('hands a lead over; the new owner is told and the old one loses access', async () => {
      const lead = await cast.createLead({ ownerId: cast.am.id }, cast.am.cookie);
      const handed = await ok(
        await action(lead.id, 'owner', { ownerId: cast.otherAm.id }, cast.am.cookie),
        leadDetailSchema,
      );
      expect(handed.owner.id).toBe(cast.otherAm.id);
      const [entry] = await auditOf(lead.id, 'lead.owner_changed');
      expect(entry?.after).toMatchObject({ ownerId: cast.otherAm.id });
      const [notice] = await notificationsOf(lead.id, 'lead_assigned');
      expect(notice?.recipientId).toBe(cast.otherAm.id);
      expect((await detail(lead.id, cast.am.cookie)).status).toBe(404);
    });

    it('needs an eligible owner and an open lead', async () => {
      const lead = await cast.createLead();
      await expectError(
        await action(lead.id, 'owner', { ownerId: cast.employee.id }),
        400,
        'INVALID_LEAD_OWNER',
      );
      await ok(await lose(lead.id), loseLeadResultSchema);
      await expectError(
        await action(lead.id, 'owner', { ownerId: cast.marketer.id }),
        409,
        'LEAD_CLOSED',
      );
    });
  });

  describe('lose and reopen (rules 8–9)', () => {
    it('loses an open lead with a reason, clears the date and audits it', async () => {
      const lead = await cast.createLead();
      await expectError(await lose(lead.id, { reason: 'other' }), 400, 'NOTE_REQUIRED');
      const lost = await ok(
        await lose(lead.id, { reason: 'price', note: 'Too high' }),
        loseLeadResultSchema,
      );
      expect(lost).toMatchObject({
        stage: 'lost',
        lostReason: 'price',
        lostNote: 'Too high',
        nextFollowUpOn: null,
        rejectedQuotes: [],
      });
      expect(lost.closedAt).not.toBeNull();
      expect(lost.permissions).toMatchObject({
        canEdit: false,
        canReopen: true,
        canLose: false,
        moves: [],
      });
      const [entry] = await auditOf(lead.id, 'lead.lost');
      expect(entry?.after).toMatchObject({
        stage: 'lost',
        lostReason: 'price',
        rejectedQuotes: [],
      });
      await expectError(await lose(lead.id), 409, 'INVALID_TRANSITION');
    });

    it('reopens a lost lead to New or Contacted with a date', async () => {
      const lead = await cast.createLead();
      await expectError(
        await action(lead.id, 'reopen', { stage: 'contacted', nextFollowUpOn: cast.tomorrow }),
        409,
        'INVALID_TRANSITION',
      );
      await ok(await lose(lead.id, { reason: 'timing' }), loseLeadResultSchema);
      await expectError(
        await action(lead.id, 'reopen', { stage: 'contacted', nextFollowUpOn: addDays(today, -1) }),
        400,
        'INVALID_DATES',
      );
      const reopened = await ok(
        await action(lead.id, 'reopen', { stage: 'contacted', nextFollowUpOn: cast.tomorrow }),
        leadDetailSchema,
      );
      expect(reopened).toMatchObject({
        stage: 'contacted',
        lostReason: null,
        lostNote: null,
        closedAt: null,
        nextFollowUpOn: cast.tomorrow,
      });
      const [entry] = await auditOf(lead.id, 'lead.reopened');
      expect(entry?.before).toMatchObject({ stage: 'lost', lostReason: 'timing' });
    });

    it('refuses losing an archived lead (LEAD_ARCHIVED)', async () => {
      const lead = await cast.createLead();
      await action(lead.id, 'archive');
      await expectError(await lose(lead.id), 409, 'LEAD_ARCHIVED');
    });
  });

  describe('archive and restore (rule 12)', () => {
    it('archives for scope-all lead managers only, hiding the lead', async () => {
      const lead = await cast.createLead();
      expect((await action(lead.id, 'archive', {}, cast.am.cookie)).status).toBe(403);
      expect((await action(lead.id, 'archive')).status).toBe(204);
      const [entry] = await auditOf(lead.id, 'lead.archived');
      expect(entry?.after).toMatchObject({ archived: true });
      await expectError(await action(lead.id, 'archive'), 409, 'INVALID_TRANSITION');
      const search = `/api/leads?search=${encodeURIComponent(lead.contactName)}`;
      const open = await ok(await client.get(search, cast.communicator.cookie), leadPageSchema);
      expect(open.items.map((item) => item.id)).not.toContain(lead.id);
      const archived = await ok(
        await client.get(`${search}&archived=true`, cast.communicator.cookie),
        leadPageSchema,
      );
      expect(archived.items.map((item) => item.id)).toContain(lead.id);
      expect((await client.get(`${search}&archived=true`, cast.am.cookie)).status).toBe(403);
      // The owner without scope all no longer sees it.
      expect((await detail(lead.id, cast.am.cookie)).status).toBe(404);
      const read = await ok(await detail(lead.id), leadDetailSchema);
      expect(read.permissions).toMatchObject({
        canRestore: true,
        canArchive: false,
        canEdit: false,
      });
    });

    it('restores an archived lead to its stage', async () => {
      const lead = await cast.createLead();
      await ok(await lose(lead.id), loseLeadResultSchema);
      await action(lead.id, 'archive');
      expect((await action(lead.id, 'restore', {}, cast.am.cookie)).status).toBe(404);
      expect((await action(lead.id, 'restore')).status).toBe(204);
      expect((await ok(await detail(lead.id), leadDetailSchema)).stage).toBe('lost');
      await expectError(await action(lead.id, 'restore'), 409, 'INVALID_TRANSITION');
      expect(await auditOf(lead.id, 'lead.restored')).toHaveLength(1);
    });
  });

  describe('list and board', () => {
    it('filters by search, source and follow-up, and pages', async () => {
      const lead = await cast.createLead({ source: 'referral', nextFollowUpOn: today });
      const phoneSearch = await ok(
        await client.get(
          `/api/leads?search=${encodeURIComponent(lead.phone?.slice(-6) ?? '')}`,
          cast.communicator.cookie,
        ),
        leadPageSchema,
      );
      expect(phoneSearch.items.map((item) => item.id)).toContain(lead.id);
      const filtered = await ok(
        await client.get(
          `/api/leads?search=${encodeURIComponent(cast.run)}&source=referral&followUp=today`,
          cast.communicator.cookie,
        ),
        leadPageSchema,
      );
      expect(filtered.items.map((item) => item.id)).toEqual([lead.id]);
      expect(filtered.items[0]).toMatchObject({ followUpDueToday: true, followUpOverdue: false });
      const lost = await ok(
        await client.get(
          `/api/leads?search=${encodeURIComponent(cast.run)}&stage=lost&pageSize=1`,
          cast.communicator.cookie,
        ),
        leadPageSchema,
      );
      expect(lost.items.every((item) => item.stage === 'lost')).toBe(true);
      expect(lost.pageSize).toBe(1);
    });

    it('puts every stage in a column, closed ones of the last 30 days', async () => {
      const open = await cast.createLead();
      const lost = await cast.createLead();
      await ok(await lose(lost.id), loseLeadResultSchema);
      const board = await ok(
        await client.get(
          `/api/leads/board?search=${encodeURIComponent(cast.run)}`,
          cast.communicator.cookie,
        ),
        leadBoardSchema,
      );
      expect(board.columns.map((column) => column.stage)).toEqual([
        'new',
        'contacted',
        'meeting',
        'quote_sent',
        'won',
        'lost',
      ]);
      const column = (stage: string) => board.columns.find((c) => c.stage === stage);
      expect(column('new')?.items.map((item) => item.id)).toContain(open.id);
      expect(column('lost')?.items.map((item) => item.id)).toContain(lost.id);
      expect(column('new')?.count).toBe(column('new')?.items.length);
      expect(column('new')?.truncated).toBe(false);
    });
  });

  describe('owners and the user archive blocker (rule 1, edge case 3)', () => {
    it('lists active users who may own leads', async () => {
      const { items } = await ok(
        await client.get('/api/leads/owners', cast.communicator.cookie),
        leadOwnerOptionsSchema,
      );
      const ids = items.map((item) => item.id);
      for (const owner of [cast.am, cast.otherAm, cast.communicator, cast.marketer, cast.gm]) {
        expect(ids).toContain(owner.id);
      }
      expect(ids).not.toContain(cast.employee.id);
      expect(ids).not.toContain(cast.operations.id);
      expect(items.find((item) => item.id === cast.marketer.id)?.departments).toEqual([
        'marketing',
      ]);
    });

    it('refuses archiving a user who owns open leads', async () => {
      const owner = await cast.signedIn({ departments: [{ code: 'marketing' }] });
      const lead = await cast.createLead({ ownerId: owner.id });
      const lost = await cast.createLead({ ownerId: owner.id });
      await ok(await lose(lost.id), loseLeadResultSchema);
      const body = (await expectError(
        await client.post(`/api/users/${owner.id}/archive`, cast.gm.cookie),
        409,
        'USER_HAS_RESPONSIBILITIES',
      )) as ErrorResponse;
      expect(body.details).toEqual([
        { type: 'owner_of_open_leads', id: lead.id, name: lead.displayName },
      ]);
      // An archived open lead blocks too: a restore would make it live again.
      expect((await action(lead.id, 'archive')).status).toBe(204);
      await expectError(
        await client.post(`/api/users/${owner.id}/archive`, cast.gm.cookie),
        409,
        'USER_HAS_RESPONSIBILITIES',
      );
    });

    it('refuses reopening a lost lead whose owner was archived since', async () => {
      const owner = await cast.signedIn({ departments: [{ code: 'marketing' }] });
      const lead = await cast.createLead({ ownerId: owner.id });
      await ok(await lose(lead.id), loseLeadResultSchema);
      expect((await client.post(`/api/users/${owner.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      await expectError(
        await action(lead.id, 'reopen', { stage: 'new', nextFollowUpOn: cast.tomorrow }),
        400,
        'INVALID_LEAD_OWNER',
      );
      // Reopened to an eligible owner instead (owner decision), who is told.
      const reopened = await ok(
        await action(lead.id, 'reopen', {
          stage: 'new',
          nextFollowUpOn: cast.tomorrow,
          ownerId: cast.marketer.id,
        }),
        leadDetailSchema,
      );
      expect(reopened).toMatchObject({ stage: 'new', owner: { id: cast.marketer.id } });
      const [entry] = await auditOf(lead.id, 'lead.reopened');
      expect(entry?.before).toMatchObject({ ownerId: owner.id });
      expect(entry?.after).toMatchObject({ ownerId: cast.marketer.id });
      const notices = await notificationsOf(lead.id, 'lead_assigned');
      expect(notices.map((notice) => notice.recipientId)).toContain(cast.marketer.id);
    });

    it('reopens only to an eligible owner, and an account manager may hand it over', async () => {
      const lead = await cast.createLead({ ownerId: cast.am.id }, cast.am.cookie);
      await ok(await lose(lead.id, { reason: 'price' }, cast.am.cookie), loseLeadResultSchema);
      await expectError(
        await action(
          lead.id,
          'reopen',
          { stage: 'new', nextFollowUpOn: cast.tomorrow, ownerId: cast.employee.id },
          cast.am.cookie,
        ),
        400,
        'INVALID_LEAD_OWNER',
      );
      const reopened = await ok(
        await action(
          lead.id,
          'reopen',
          { stage: 'contacted', nextFollowUpOn: cast.tomorrow, ownerId: cast.otherAm.id },
          cast.am.cookie,
        ),
        leadDetailSchema,
      );
      expect(reopened.owner.id).toBe(cast.otherAm.id);
    });
  });
});
