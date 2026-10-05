import type { INestApplication } from '@nestjs/common';
import { emailPageSchema, emailSummarySchema } from '@vertex-hub/contracts';
import { clients, createDatabase, emailMessages, newId, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CurrentUserInfo } from '../src/modules/auth/index.js';
import { ClientEmails } from '../src/modules/clients/index.js';
import { EmailService } from '../src/modules/email/email.service.js';
import { Mailer } from '../src/modules/email/index.js';
import { seedClientCast } from './client-cast.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type SignedIn = Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;

const DAY = 24 * 60 * 60 * 1000;

describe('email outbox (F14 email)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seededUsers: string[] = [];
  const seededEmails: string[] = [];
  const marker = `m${newId().slice(-8)}`;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let admin: SignedIn;
  let employee: { id: string; cookie: string };
  let service: EmailService;
  let mailer: Mailer;

  /** An email written straight into the outbox, as `Mailer.queue` would. */
  async function seedEmail(
    values: Partial<typeof emailMessages.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(emailMessages).values({
      id,
      kind: 'test',
      audience: 'staff',
      to: [{ name: 'Rana', email: `rana.${marker}@example.com` }],
      subject: 'Test',
      data: { requestedBy: 'Rana' },
      ...values,
    });
    seededEmails.push(id);
    return id;
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    service = app.get(EmailService);
    mailer = app.get(Mailer);
    admin = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'internal_operations', manager: true }],
    });
    const member = await seedUser(db, { departments: [{ code: 'photography' }] });
    seededUsers.push(admin.id, member.id);
    employee = { id: member.id, cookie: await client.signIn(member.email) };
  });

  afterAll(async () => {
    await app?.close();
    if (seededEmails.length > 0) {
      await db.delete(emailMessages).where(inArray(emailMessages.id, seededEmails));
    }
    await removeUsers(db, seededUsers);
    await connection.close();
  });

  it('requires a session', async () => {
    expect((await client.get('/api/emails')).status).toBe(401);
    expect((await client.request('POST', '/api/emails/test')).status).toBe(401);
  });

  it('keeps the log and the test email to administrators', async () => {
    expect((await client.get('/api/emails', employee.cookie)).status).toBe(403);
    expect(
      (await client.request('POST', '/api/emails/test', { cookie: employee.cookie })).status,
    ).toBe(403);
  });

  it('queues a test email to the administrator (rule 26)', async () => {
    const response = await client.request('POST', '/api/emails/test', { cookie: admin.cookie });
    expect(response.status).toBe(202);
    const summary = emailSummarySchema.parse(await response.json());
    expect(summary).toMatchObject({
      kind: 'test',
      status: 'queued',
      to: [{ email: admin.email, userId: admin.id }],
      cc: [],
      sender: { id: admin.id },
      sentAt: null,
      error: null,
    });
    const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, summary.id));
    expect(row).toMatchObject({
      audience: 'staff',
      attempts: 0,
      data: { requestedBy: admin.name },
    });
  });

  it('writes the email with the change and drops it when the change rolls back (rule 1)', async () => {
    const queue = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      mailer.queue(tx, {
        kind: 'test',
        to: [{ name: 'Rana', email: `rollback.${marker}@example.com` }],
        subject: 'Test',
        data: { requestedBy: 'Rana' },
        sender: null,
      });
    const kept = await db.transaction(queue);
    seededEmails.push(kept);
    let dropped = '';
    await expect(
      db.transaction(async (tx) => {
        dropped = await queue(tx);
        throw new Error('change failed');
      }),
    ).rejects.toThrow('change failed');
    const rows = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(inArray(emailMessages.id, [kept, dropped]));
    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it('refuses template data that does not match its kind', async () => {
    await expect(
      db.transaction((tx) =>
        mailer.queue(tx, {
          kind: 'test',
          to: [{ name: 'Rana', email: 'rana@example.com' }],
          subject: 'Test',
          data: {} as { requestedBy: string },
          sender: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('records the outcome once, and never moves an email back (rule 1)', async () => {
    const sent = await seedEmail();
    const sentAt = '2026-10-04T05:00:00.000Z';
    await service.recordResult({
      id: sent,
      status: 'sent',
      attempts: 2,
      providerMessageId: '<id@vertex>',
      sentAt,
    });
    await service.recordResult({ id: sent, status: 'failed', attempts: 4, error: 'late' });
    const failed = await seedEmail();
    await service.recordResult({
      id: failed,
      status: 'failed',
      attempts: 4,
      error: 'x'.repeat(1200),
    });
    const rows = await db
      .select()
      .from(emailMessages)
      .where(inArray(emailMessages.id, [sent, failed]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(sent)).toMatchObject({
      status: 'sent',
      attempts: 2,
      providerMessageId: '<id@vertex>',
      sentAt: new Date(sentAt),
      lastError: null,
    });
    expect(byId.get(failed)).toMatchObject({ status: 'failed', attempts: 4 });
    expect(byId.get(failed)?.lastError).toHaveLength(1000);
  });

  it('lists the outbox newest first with its filters (screen 6)', async () => {
    const tag = `list.${marker}`;
    const failed = await seedEmail({
      to: [{ name: 'Rana', email: `rana.${tag}@example.com` }],
      status: 'failed',
      lastError: 'EAUTH',
      attempts: 4,
    });
    const client_ = await seedEmail({
      kind: 'client_invoice',
      audience: 'client',
      to: [{ name: 'Client', email: `billing.${tag}@example.com` }],
      cc: [{ name: 'Rana', email: `am.${tag}@example.com` }],
      recordType: 'invoice',
      recordId: newId(),
    });
    const list = async (query: string) => {
      const response = await client.get(`/api/emails?${query}`, admin.cookie);
      expect(response.status).toBe(200);
      return emailPageSchema.parse(await response.json());
    };

    const byMarker = await list(`search=${tag}&pageSize=100`);
    const ids = byMarker.items.map((item) => item.id);
    expect(ids).toContain(failed);
    expect(ids.indexOf(client_)).toBeLessThan(ids.indexOf(failed));

    const failures = await list(`search=${tag}&status=failed`);
    expect(failures.items.map((item) => item.id)).toEqual([failed]);
    expect(failures.items[0]).toMatchObject({ error: 'EAUTH', attempts: 4, audience: 'staff' });

    const clients = await list(`search=${tag}&audience=client&kind=client_invoice`);
    expect(clients.items).toHaveLength(1);
    expect(clients.items[0]?.record).toMatchObject({ type: 'invoice' });

    // A copied address finds the email too.
    expect((await list(`search=am.${tag}`)).items.map((item) => item.id)).toEqual([client_]);
    expect((await list(`search=${tag}&from=2000-01-01&to=2000-01-31`)).total).toBe(0);
  });

  it('purges staff emails after 90 days and keeps client emails (rule 25)', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 91 * DAY);
    const recent = new Date(now.getTime() - 89 * DAY);
    const oldStaff = await seedEmail({ createdAt: old });
    const recentStaff = await seedEmail({ createdAt: recent });
    const oldClient = await seedEmail({
      kind: 'client_quote',
      audience: 'client',
      createdAt: old,
    });
    await service.purge(now);
    const rows = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(inArray(emailMessages.id, [oldStaff, recentStaff, oldClient]));
    expect(rows.map((row) => row.id).sort()).toEqual([recentStaff, oldClient].sort());
  });

  describe('client emails (rules 17, 18, 23)', () => {
    let cast: Awaited<ReturnType<typeof seedClientCast>>;
    let clientId: string;
    let contactId: string;
    const signature = { name: 'Rana', title: null, phone: null, email: 'rana@example.com' };
    const quoteData = {
      client: 'Acme',
      signature,
      quote: {
        number: 'Q-2026-0001',
        title: 'Social media',
        currency: 'USD',
        oneOffMinor: 100_000,
        monthlyMinor: null,
        validUntil: '2026-10-30',
      },
    };

    beforeAll(async () => {
      cast = await seedClientCast(db, client);
      clientId = (await cast.createClient()).id;
      contactId = (await cast.createContact(clientId)).id;
    });

    afterAll(async () => {
      await cast?.cleanup();
    });

    const queue = (extra: { attachments?: { sizeBytes: number }[] } = {}) =>
      db.transaction((tx) =>
        app.get(ClientEmails).queue(tx, cast.am as unknown as CurrentUserInfo, {
          kind: 'client_quote',
          clientId,
          recipients: { contactIds: [contactId], ccAccountManager: true, ccMe: false },
          subject: 'Quote',
          message: 'Hello',
          data: { quote: quoteData.quote } as never,
          attachments: extra.attachments?.map((file, index) => ({
            fileName: `${index}.pdf`,
            storageKey: `objects/test/${index}`,
            sizeBytes: file.sizeBytes,
            sha256: 'a'.repeat(64),
          })),
          record: { type: 'quote', id: newId() },
        }),
      );

    it('refuses attachments over 10 MB in all (edge case 15)', async () => {
      await expect(
        queue({ attachments: [{ sizeBytes: 6 * 1024 * 1024 }, { sizeBytes: 5 * 1024 * 1024 }] }),
      ).rejects.toMatchObject({ response: { code: 'ATTACHMENT_TOO_LARGE' } });
      const { id } = await queue({ attachments: [{ sizeBytes: 5 * 1024 * 1024 }] });
      expect(id).toBeTruthy();
    });

    it('refuses an archived client (rule 18)', async () => {
      await db.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, clientId));
      try {
        await expect(queue()).rejects.toMatchObject({ response: { code: 'CLIENT_ARCHIVED' } });
      } finally {
        await db.update(clients).set({ archivedAt: null }).where(eq(clients.id, clientId));
      }
    });

    it('tells the sender when a client email fails for good, opening its document (rule 23)', async () => {
      const quoteId = newId();
      const failing = await seedEmail({
        kind: 'client_quote',
        audience: 'client',
        senderId: admin.id,
        senderName: 'Admin',
        clientId,
        recordType: 'quote',
        recordId: quoteId,
        to: [{ name: 'سامي', email: `sami.${marker}@example.com` }],
        data: quoteData,
      });
      await service.recordResult({ id: failing, status: 'failed', attempts: 4, error: 'EAUTH' });
      // A repeated outcome changes nothing and tells nobody twice.
      await service.recordResult({ id: failing, status: 'failed', attempts: 4, error: 'EAUTH' });
      const notices = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, admin.id), eq(notifications.type, 'email_failed')),
        );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        subjectType: 'quote',
        subjectId: quoteId,
        data: {
          kind: 'client_quote',
          client: 'Acme',
          document: 'Q-2026-0001',
          recipients: ['سامي'],
        },
      });
      // Staff emails and sent client emails tell nobody.
      const staff = await seedEmail({ senderId: admin.id, senderName: 'Admin' });
      await service.recordResult({ id: staff, status: 'failed', attempts: 4, error: 'EAUTH' });
      const sent = await seedEmail({
        kind: 'client_quote',
        audience: 'client',
        senderId: admin.id,
        senderName: 'Admin',
        clientId,
        data: quoteData,
      });
      await service.recordResult({
        id: sent,
        status: 'sent',
        attempts: 1,
        providerMessageId: null,
        sentAt: new Date().toISOString(),
      });
      const after = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, admin.id), eq(notifications.type, 'email_failed')),
        );
      expect(after).toHaveLength(1);
    });
  });
});
