import type { INestApplication } from '@nestjs/common';
import {
  acceptPlanSchema,
  businessDate,
  type CatalogService,
  type ConvertLeadInput,
  clientDetailResponseSchema,
  type LeadDetail,
  leadConversionPlanSchema,
  leadDetailSchema,
  leadQuotesSchema,
  loseLeadResultSchema,
  type QuoteDetail,
  quoteDetailSchema,
  quotePageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clientContacts,
  clientNotes,
  clients,
  createDatabase,
  notifications,
  quotes,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok } from './campaign-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedLeadCast } from './lead-cast.js';
import { startApp } from './start-app.js';

describe('lead conversion and quotes on leads (F03 rules 8, 10, 11, 14–16)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedLeadCast>>;
  let finance: { id: string; cookie: string };
  let monthly: CatalogService;

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action as never)))
      .orderBy(asc(auditEntries.occurredAt), asc(auditEntries.id));

  const notificationsOf = (subjectId: string, type: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.subjectId, subjectId), eq(notifications.type, type as never)));

  const leadOf = async (id: string, cookie = cast.communicator.cookie) =>
    ok(await client.get(`/api/leads/${id}`, cookie), leadDetailSchema);

  const quoteOf = async (id: string, cookie = cast.gm.cookie) =>
    ok(await client.get(`/api/quotes/${id}`, cookie), quoteDetailSchema);

  /** A new client for the lead with the owner as account manager and the lead's contact. */
  const newClient = (lead: LeadDetail, input: Record<string, unknown> = {}): ConvertLeadInput => ({
    mode: 'new',
    client: {
      tradeName: lead.displayName,
      sector: 'Healthcare',
      isHealthcare: true,
      accountManagerId: cast.am.id,
      ...input,
    },
    contact: { add: true, name: lead.contactName, phone: lead.phone, hasFinalApproval: true },
  });

  const convert = (id: string, body: unknown, cookie = cast.communicator.cookie) =>
    client.post(`/api/leads/${id}/convert`, cookie, body);

  /** Tracks the client a conversion created, for cleanup. */
  const converted = async (response: Response) => {
    const lead = await ok(response, leadDetailSchema);
    if (lead.client) cast.trackClient(lead.client.id);
    return lead;
  };

  /** A draft quote on the lead with one monthly line, by `cookie` (the owner by default). */
  const leadQuote = (leadId: string, cookie = cast.am.cookie) => draftQuote({ leadId }, cookie);

  /** A draft quote for a lead or a client with one monthly line. */
  async function draftQuote(
    recipient: { leadId: string } | { clientId: string },
    cookie = cast.am.cookie,
  ): Promise<QuoteDetail> {
    const quote = await ok(
      await client.post('/api/quotes', cookie, { ...recipient, title: `عرض ${cast.run}` }),
      quoteDetailSchema,
      201,
    );
    return ok(
      await client.request('PUT', `/api/quotes/${quote.id}`, {
        cookie,
        body: {
          updatedAt: quote.updatedAt,
          contactId: null,
          title: quote.title,
          currency: quote.currency,
          validityDays: quote.validityDays,
          oneOffDiscountMinor: 0,
          monthlyDiscountMinor: 0,
          monthlyTermMonths: null,
          clientNotes: null,
          terms: null,
          lines: [
            {
              section: 'monthly',
              serviceId: monthly.id,
              quantity: 4,
              unitPriceMinor: 1500,
              revisionRounds: 2,
            },
          ],
          installments: [],
        },
      }),
      quoteDetailSchema,
    );
  }

  const send = (quote: QuoteDetail, cookie = cast.am.cookie) =>
    client.post(`/api/quotes/${quote.id}/send`, cookie, {});

  async function sentLeadQuote(leadId: string) {
    return ok(await send(await leadQuote(leadId)), quoteDetailSchema);
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedLeadCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    monthly = await cast.createService({ deliverableKind: 'design' });
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  describe('conversion plan', () => {
    it('offers the lead as a new client, with the owner as account manager', async () => {
      const lead = await cast.createLead({ sector: 'Dental', isHealthcare: true });
      await client.post(`/api/leads/${lead.id}/notes`, cast.am.cookie, {
        channel: 'whatsapp',
        summary: 'Asked for prices',
        nextFollowUpOn: cast.tomorrow,
      });
      await leadQuote(lead.id);
      const plan = await ok(
        await client.get(`/api/leads/${lead.id}/conversion-plan`, cast.am.cookie),
        leadConversionPlanSchema,
      );
      expect(plan.client).toEqual({
        tradeName: lead.displayName,
        sector: 'Dental',
        isHealthcare: true,
        accountManagerId: cast.am.id,
      });
      expect(plan.contact).toEqual({ name: lead.contactName, phone: lead.phone, email: null });
      expect(plan.accountManagers.map((user) => user.id)).toEqual(
        expect.arrayContaining([cast.am.id, cast.otherAm.id]),
      );
      expect(plan).toMatchObject({ noteCount: 1, quoteCount: 1, existingClient: null });
    });

    it('describes an existing client and whether it has the contact', async () => {
      const lead = await cast.createLead();
      const existing = await cast.createClient({ accountManagerId: cast.otherAm.id });
      await client.post(`/api/clients/${existing.id}/contacts`, cast.gm.cookie, {
        name: 'Someone',
        phone: lead.phone,
      });
      const plan = await ok(
        await client.get(
          `/api/leads/${lead.id}/conversion-plan?clientId=${existing.id}`,
          cast.communicator.cookie,
        ),
        leadConversionPlanSchema,
      );
      expect(plan.existingClient).toMatchObject({
        id: existing.id,
        accountManager: { id: cast.otherAm.id },
        hasContact: true,
      });
      // The owner of a lead created for a member is not an account manager: chosen in the dialog.
      const own = await cast.createLead({ ownerId: cast.marketer.id });
      const memberPlan = await ok(
        await client.get(`/api/leads/${own.id}/conversion-plan`, cast.marketer.cookie),
        leadConversionPlanSchema,
      );
      expect(memberPlan.client.accountManagerId).toBeNull();
    });

    it('answers 401, 403 and 404 by scope', async () => {
      const lead = await cast.createLead();
      const path = `/api/leads/${lead.id}/conversion-plan`;
      expect((await client.get(path)).status).toBe(401);
      expect((await client.get(path, cast.employee.cookie)).status).toBe(403);
      // The Operations manager reads leads but does not manage them.
      expect((await client.get(path, cast.operations.cookie)).status).toBe(403);
      expect((await client.get(path, cast.otherAm.cookie)).status).toBe(404);
    });
  });

  describe('convert (rule 10)', () => {
    it('creates the client with its contact, copies the log and closes the lead', async () => {
      const lead = await cast.createLead({ isHealthcare: true });
      await client.post(`/api/leads/${lead.id}/notes`, cast.am.cookie, {
        channel: 'whatsapp',
        summary: 'Wants a monthly plan',
        nextFollowUpOn: cast.tomorrow,
      });
      const won = await converted(await convert(lead.id, newClient(lead)));
      expect(won).toMatchObject({ stage: 'won', nextFollowUpOn: null });
      expect(won.convertedBy?.id).toBe(cast.communicator.id);
      expect(won.permissions).toMatchObject({ canEdit: false, canConvert: false, moves: [] });
      const clientId = won.client?.id ?? '';
      const created = await ok(
        await client.get(`/api/clients/${clientId}`, cast.gm.cookie),
        clientDetailResponseSchema,
      );
      expect(created).toMatchObject({
        tradeName: lead.displayName,
        status: 'active',
        isHealthcare: true,
        accountManager: { id: cast.am.id },
      });
      const [contact] = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, clientId));
      expect(contact).toMatchObject({ name: lead.contactName, hasFinalApproval: true });
      const notes = await db.select().from(clientNotes).where(eq(clientNotes.clientId, clientId));
      expect(notes).toEqual([
        expect.objectContaining({
          authorId: cast.am.id,
          channel: 'whatsapp',
          summary: 'Wants a monthly plan',
          contactId: contact?.id,
        }),
      ]);
      expect(await auditOf(lead.id, 'lead.converted')).toHaveLength(1);
      expect(await auditOf(clientId, 'client.created')).toHaveLength(1);
      // The account manager is told once, as the new client's manager.
      expect(await notificationsOf(clientId, 'client_account_manager_assigned')).toHaveLength(1);
      expect(await notificationsOf(lead.id, 'lead_won')).toHaveLength(0);
    });

    it('links an existing ended client, which becomes active and gains the contact', async () => {
      const lead = await cast.createLead();
      const existing = await cast.createClient({ accountManagerId: cast.otherAm.id });
      await client.request('PATCH', `/api/clients/${existing.id}`, {
        cookie: cast.gm.cookie,
        body: { status: 'ended' },
      });
      const won = await converted(
        await convert(lead.id, {
          mode: 'existing',
          clientId: existing.id,
          contact: { add: true, name: lead.contactName, phone: lead.phone },
        }),
      );
      expect(won.client?.id).toBe(existing.id);
      const [row] = await db.select().from(clients).where(eq(clients.id, existing.id));
      expect(row?.status).toBe('active');
      // The PATCH ended it; the conversion made it active again.
      const statusChanges = await auditOf(existing.id, 'client.status_changed');
      expect(statusChanges.map((entry) => entry.after)).toEqual([
        { status: 'ended' },
        { status: 'active' },
      ]);
      // The owner and the client's account manager learn about the win.
      const won_ = await notificationsOf(lead.id, 'lead_won');
      expect(won_.map((notice) => notice.recipientId).sort()).toEqual(
        [cast.am.id, cast.otherAm.id].sort(),
      );
    });

    it('rolls everything back on a refused F02 rule', async () => {
      const taken = await cast.createClient();
      const lead = await cast.createLead();
      await expectError(
        await convert(lead.id, newClient(lead, { tradeName: taken.tradeName })),
        409,
        'CLIENT_NAME_TAKEN',
      );
      await expectError(
        await convert(lead.id, newClient(lead, { accountManagerId: cast.employee.id })),
        400,
        'INVALID_ACCOUNT_MANAGER',
      );
      expect((await leadOf(lead.id)).stage).toBe('new');
      expect(
        await db.select().from(clients).where(eq(clients.tradeName, lead.displayName)),
      ).toEqual([]);
    });

    it('converts once when two people convert at the same time (edge case 1)', async () => {
      const lead = await cast.createLead();
      const responses = await Promise.all([
        convert(lead.id, newClient(lead)),
        convert(lead.id, newClient(lead), cast.marketer.cookie),
      ]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 409]);
      const winner = responses.find((response) => response.status === 200);
      if (winner) await converted(winner);
    });

    it('refuses archived, lost and won leads, and callers without lead scope', async () => {
      const archived = await cast.createLead();
      await client.post(`/api/leads/${archived.id}/archive`, cast.communicator.cookie, {});
      await expectError(await convert(archived.id, newClient(archived)), 409, 'LEAD_ARCHIVED');
      const lost = await cast.createLead();
      await client.post(`/api/leads/${lost.id}/lose`, cast.communicator.cookie, {
        reason: 'timing',
      });
      await expectError(await convert(lost.id, newClient(lost)), 409, 'INVALID_TRANSITION');
      const lead = await cast.createLead();
      expect((await convert(lead.id, newClient(lead), cast.operations.cookie)).status).toBe(403);
      expect((await convert(lead.id, newClient(lead), cast.otherAm.cookie)).status).toBe(404);
      expect((await client.post(`/api/leads/${lead.id}/convert`, undefined, {})).status).toBe(401);
      expect((await convert(lead.id, { mode: 'new', contact: { add: false } })).status).toBe(400);
    });
  });

  describe('quotes on leads (rules 14–16)', () => {
    it('is written by the owner and quote managers, not by lead members', async () => {
      const lead = await cast.createLead();
      expect(
        (
          await client.post('/api/quotes', cast.communicator.cookie, {
            leadId: lead.id,
            title: 'x',
          })
        ).status,
      ).toBe(403);
      const byOps = await ok(
        await client.post('/api/quotes', cast.operations.cookie, {
          leadId: lead.id,
          title: 'Ops',
        }),
        quoteDetailSchema,
        201,
      );
      expect(byOps).toMatchObject({
        client: null,
        recipient: { kind: 'lead', id: lead.id, name: lead.displayName },
        accountManager: { id: cast.am.id },
        lead: { id: lead.id, stage: 'new' },
      });
      expect(
        (await client.post('/api/quotes', cast.otherAm.cookie, { leadId: lead.id, title: 'x' }))
          .status,
      ).toBe(404);
      expect(
        (
          await client.post('/api/quotes', cast.am.cookie, {
            leadId: lead.id,
            contactId: lead.id,
            title: 'x',
          })
        ).status,
      ).toBe(400);
      expect((await client.post('/api/quotes', cast.am.cookie, { title: 'x' })).status).toBe(400);
    });

    it('is out of scope for other account managers', async () => {
      const lead = await cast.createLead();
      const quote = await sentLeadQuote(lead.id);
      const other = cast.otherAm.cookie;
      expect((await client.get(`/api/quotes/${quote.id}`, other)).status).toBe(404);
      expect((await client.get(`/api/quotes/${quote.id}/accept-plan`, other)).status).toBe(404);
      expect((await send(quote, other)).status).toBe(404);
      expect(
        (
          await client.post(`/api/quotes/${quote.id}/accept`, other, {
            respondedOn: businessDate(),
          })
        ).status,
      ).toBe(404);
      // The owner cannot see another manager's client through step 0's plan (403).
      const foreign = await cast.createClient({ accountManagerId: cast.otherAm.id });
      expect(
        (
          await client.get(
            `/api/quotes/${quote.id}/accept-plan?clientId=${foreign.id}`,
            cast.am.cookie,
          )
        ).status,
      ).toBe(403);
    });

    it('moves the lead back to Quote sent when an expired quote is extended', async () => {
      const lead = await cast.createLead();
      const quote = await sentLeadQuote(lead.id);
      await db.update(quotes).set({ status: 'expired' }).where(eq(quotes.id, quote.id));
      await ok(
        await client.post(`/api/leads/${lead.id}/stage`, cast.am.cookie, { stage: 'meeting' }),
        leadDetailSchema,
      );
      await ok(
        await client.post(`/api/quotes/${quote.id}/extend`, cast.am.cookie, {
          validUntil: businessDate(),
        }),
        quoteDetailSchema,
      );
      expect((await leadOf(lead.id)).stage).toBe('quote_sent');
    });

    it('moves the lead to Quote sent when sent, and keeps it there', async () => {
      const lead = await cast.createLead();
      const quote = await sentLeadQuote(lead.id);
      expect(quote.status).toBe('sent');
      expect((await leadOf(lead.id)).stage).toBe('quote_sent');
      const stageAudit = await auditOf(lead.id, 'lead.stage_changed');
      expect(stageAudit.at(-1)?.after).toMatchObject({ stage: 'quote_sent', quoteId: quote.id });
      await expectError(
        await client.post(`/api/leads/${lead.id}/stage`, cast.am.cookie, { stage: 'meeting' }),
        409,
        'LEAD_HAS_SENT_QUOTE',
      );
      await expectError(
        await client.post(`/api/leads/${lead.id}/archive`, cast.communicator.cookie, {}),
        409,
        'LEAD_HAS_QUOTES',
      );
      // A rejection does not move the lead (rule 15).
      await client.post(`/api/quotes/${quote.id}/reject`, cast.am.cookie, {
        respondedOn: businessDate(),
        reason: 'price',
      });
      expect((await leadOf(lead.id)).stage).toBe('quote_sent');
    });

    it('lists lead quotes by lead and owner, for readers of every quote', async () => {
      const lead = await cast.createLead();
      const quote = await leadQuote(lead.id);
      const page = await ok(
        await client.get(`/api/quotes?leadId=${lead.id}`, finance.cookie),
        quotePageSchema,
      );
      expect(page.items.map((item) => item.id)).toEqual([quote.id]);
      const mine = await ok(
        await client.get(
          `/api/quotes?accountManagerId=${cast.am.id}&leadId=${lead.id}`,
          cast.am.cookie,
        ),
        quotePageSchema,
      );
      expect(mine.items[0]?.recipient).toEqual({
        kind: 'lead',
        id: lead.id,
        name: lead.displayName,
      });
      const search = await ok(
        await client.get(
          `/api/quotes?search=${encodeURIComponent(lead.displayName)}`,
          cast.am.cookie,
        ),
        quotePageSchema,
      );
      expect(search.items.map((item) => item.id)).toContain(quote.id);
      const other = await ok(
        await client.get(`/api/quotes?leadId=${lead.id}`, cast.otherAm.cookie),
        quotePageSchema,
      );
      expect(other.items).toEqual([]);
    });

    it("shows a lead's quotes on its page, with nets only for quote readers", async () => {
      const lead = await cast.createLead();
      const quote = await sentLeadQuote(lead.id);
      const path = `/api/quotes/by-lead/${lead.id}`;
      const forOwner = await ok(await client.get(path, cast.am.cookie), leadQuotesSchema);
      expect(forOwner.items).toEqual([
        expect.objectContaining({
          id: quote.id,
          status: 'sent',
          monthlyNetMinor: 6000,
          versions: [{ id: quote.id, version: 1, status: 'sent' }],
        }),
      ]);
      const forMember = await ok(await client.get(path, cast.marketer.cookie), leadQuotesSchema);
      expect(forMember.items[0]).toMatchObject({ oneOffNetMinor: null, monthlyNetMinor: null });
      expect((await client.get(path)).status).toBe(401);
      expect((await client.get(path, cast.employee.cookie)).status).toBe(403);
      expect((await client.get(path, cast.otherAm.cookie)).status).toBe(404);
    });
  });

  describe('lose and convert with quotes (rules 8, 10; edge cases 7, 8)', () => {
    it('rejects sent quotes on a loss; drafts stay and cannot be sent', async () => {
      const lead = await cast.createLead();
      const sent = await sentLeadQuote(lead.id);
      const draft = await leadQuote(lead.id);
      const result = await ok(
        await client.post(`/api/leads/${lead.id}/lose`, cast.communicator.cookie, {
          reason: 'not_a_fit',
          note: 'Wants video only',
        }),
        loseLeadResultSchema,
      );
      expect(result.rejectedQuotes).toEqual([sent.displayNumber]);
      const rejected = await quoteOf(sent.id);
      expect(rejected).toMatchObject({
        status: 'rejected',
        response: { rejectionReason: 'scope', note: 'Wants video only' },
      });
      expect(rejected.response?.by.id).toBe(cast.communicator.id);
      expect((await quoteOf(draft.id)).status).toBe('draft');
      await expectError(await send(draft), 409, 'LEAD_CLOSED');
      await expectError(
        await client.post('/api/quotes', cast.am.cookie, { leadId: lead.id, title: 'x' }),
        409,
        'LEAD_CLOSED',
      );
    });

    it('moves every quote to the client on conversion, a sent one included', async () => {
      const lead = await cast.createLead();
      const sent = await sentLeadQuote(lead.id);
      const won = await converted(await convert(lead.id, newClient(lead)));
      const moved = await quoteOf(sent.id);
      expect(moved).toMatchObject({
        status: 'sent',
        client: { id: won.client?.id },
        recipient: { kind: 'client', id: won.client?.id },
        lead: { id: lead.id, stage: 'won' },
      });
      expect(moved.contact).not.toBeNull();
      // After the draft save, the move to the client.
      const updates = await auditOf(sent.id, 'quote.updated');
      expect(updates.at(-1)?.after).toMatchObject({ clientId: won.client?.id });
      // Still on the lead page, as history.
      const onLead = await ok(
        await client.get(`/api/quotes/by-lead/${lead.id}`, cast.am.cookie),
        leadQuotesSchema,
      );
      expect(onLead.items.map((item) => item.id)).toEqual([sent.id]);
    });
  });

  describe('accepting a lead quote (rule 11)', () => {
    const acceptBody = (conversion: unknown) => ({
      respondedOn: businessDate(),
      conversion,
      retainer: {
        mode: 'new',
        name: `عقد ${cast.run}`,
        departments: ['design'],
        startDate: businessDate(),
        renewalDate: null,
        templateId: null,
      },
    });

    it('plans step 0 and converts inside the acceptance', async () => {
      const lead = await cast.createLead({ isHealthcare: true });
      const quote = await sentLeadQuote(lead.id);
      const plan = await ok(
        await client.get(`/api/quotes/${quote.id}/accept-plan`, cast.am.cookie),
        acceptPlanSchema,
      );
      expect(plan.conversion?.client.tradeName).toBe(lead.displayName);
      expect(plan.retainer?.renewable).toEqual([]);
      const accepted = await ok(
        await client.post(
          `/api/quotes/${quote.id}/accept`,
          cast.am.cookie,
          acceptBody(newClient(lead)),
        ),
        quoteDetailSchema,
      );
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
      if (row?.clientId) cast.trackClient(row.clientId);
      expect(accepted).toMatchObject({ status: 'accepted', recipient: { kind: 'client' } });
      expect(accepted.retainer).not.toBeNull();
      expect(accepted.response?.contact).not.toBeNull();
      const won = await leadOf(lead.id);
      expect(won).toMatchObject({ stage: 'won', client: { id: row?.clientId } });
    });

    it('rolls the conversion back when the acceptance is refused', async () => {
      const lead = await cast.createLead();
      const quote = await sentLeadQuote(lead.id);
      const body = acceptBody(newClient(lead));
      // A retainer is required for the monthly section: the whole acceptance is refused.
      const response = await client.post(`/api/quotes/${quote.id}/accept`, cast.am.cookie, {
        ...body,
        retainer: null,
      });
      expect(response.status).toBe(400);
      expect((await leadOf(lead.id)).stage).toBe('quote_sent');
      expect((await quoteOf(quote.id)).status).toBe('sent');
      expect(
        await db
          .select({ id: clients.id })
          .from(clients)
          .where(inArray(clients.tradeName, [lead.displayName])),
      ).toEqual([]);
    });

    it('refuses a conversion on a client quote', async () => {
      const own = await cast.createClient();
      const quote = await ok(await send(await draftQuote({ clientId: own.id })), quoteDetailSchema);
      const lead = await cast.createLead();
      expect(
        (
          await client.post(
            `/api/quotes/${quote.id}/accept`,
            cast.am.cookie,
            acceptBody(newClient(lead)),
          )
        ).status,
      ).toBe(400);
    });

    it('needs step 0 for a lead quote only, and the lead open (edge case 2)', async () => {
      const lead = await cast.createLead();
      const quote = await sentLeadQuote(lead.id);
      expect(
        (await client.post(`/api/quotes/${quote.id}/accept`, cast.am.cookie, acceptBody(null)))
          .status,
      ).toBe(400);
      // Linking a client needs projects.manage over it.
      const foreign = await cast.createClient({ accountManagerId: cast.otherAm.id });
      expect(
        (
          await client.post(
            `/api/quotes/${quote.id}/accept`,
            cast.am.cookie,
            acceptBody({ mode: 'existing', clientId: foreign.id, contact: { add: false } }),
          )
        ).status,
      ).toBe(403);
      // A loss rejected the quote first: the acceptance comes second and is refused.
      const reopened = await cast.createLead();
      const another = await sentLeadQuote(reopened.id);
      await client.post(`/api/leads/${reopened.id}/lose`, cast.communicator.cookie, {
        reason: 'timing',
      });
      await expectError(
        await client.post(
          `/api/quotes/${another.id}/accept`,
          cast.am.cookie,
          acceptBody(newClient(reopened)),
        ),
        409,
        'INVALID_TRANSITION',
      );
    });
  });
});
