import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  EMAIL_DATA_SCHEMAS,
  REDACTED,
  userLinkSchema,
  userWithLinkResponseSchema,
} from '@vertex-hub/contracts';
import { createDatabase, emailMessages, userDevices } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  api,
  clientIp,
  departmentId,
  ORIGIN,
  PASSWORD,
  removeUsers,
  type SeedUser,
  seedUser,
  uniqueEmail,
} from './helpers.js';
import { startApp } from './start-app.js';

type SignedIn = Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

describe('account emails (F14 email rules 13–15)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let operations: SignedIn;

  const seed = async (input: SeedUser = {}) => {
    const user = await seedUser(db, { name: `عضو ${run}`, ...input });
    seeded.push(user.id);
    return user;
  };

  /** The emails sent to a user, newest first. */
  const emailsTo = (userId: string) =>
    db
      .select()
      .from(emailMessages)
      .where(
        sql`exists (select 1 from jsonb_array_elements(${emailMessages.to}) as r
          where r->>'userId' = ${userId})`,
      )
      .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id));

  const notices = async (userId: string) =>
    (await emailsTo(userId))
      .filter((email) => email.kind === 'security_notice')
      .map((email) => EMAIL_DATA_SCHEMAS.security_notice.parse(email.data));

  const requestLink = (email: string) =>
    client.post('/api/password-links/request', undefined, { email });

  /** "Forgot password" answers first and emails after: waits for `count` emails to the user. */
  const requestedEmails = (userId: string, count: number) =>
    vi.waitFor(
      async () => {
        const sent = await emailsTo(userId);
        expect(sent).toHaveLength(count);
        return sent;
      },
      { timeout: 5_000, interval: 100 },
    );

  beforeAll(async () => {
    ({ app, url } = await startApp());
    client = api(url);
    operations = await client.signInWithTwoFactor(db, {
      name: `العمليات ${run}`,
      departments: [{ code: 'internal_operations', manager: true }],
    });
    seeded.push(operations.id);
  });

  afterAll(async () => {
    await app?.close();
    await removeUsers(db, seeded);
    await connection.close();
  });

  describe('links (rule 13)', () => {
    it('emails the activation link of a new user, redacted in the outbox', async () => {
      const response = await client.post('/api/users', operations.cookie, {
        name: `جديد ${run}`,
        email: uniqueEmail('new'),
        primaryDepartmentId: await departmentId(db, 'design'),
      });
      expect(response.status).toBe(201);
      const { user, link } = userWithLinkResponseSchema.parse(await response.json());
      seeded.push(user.id);
      const [email] = await emailsTo(user.id);
      expect(email).toMatchObject({
        kind: 'account_activation',
        audience: 'staff',
        subject: 'فعّل حسابك في Vertex Hub',
        senderId: null,
      });
      expect(email?.to).toEqual([{ name: user.name, email: user.email, userId: user.id }]);
      const data = EMAIL_DATA_SCHEMAS.account_activation.parse(email?.data);
      expect(data).toMatchObject({ link: REDACTED, expiresAt: link.expiresAt, restored: false });
      expect(JSON.stringify(email)).not.toContain(new URL(link.url).hash.slice(1));
    });

    it('emails a reset link issued by a user manager, and the restored wording', async () => {
      const active = await seed();
      const link = userLinkSchema.parse(
        await (await client.post(`/api/users/${active.id}/link`, operations.cookie)).json(),
      );
      expect(link.kind).toBe('reset');
      const [reset] = await emailsTo(active.id);
      expect(reset?.kind).toBe('password_reset');
      expect(EMAIL_DATA_SCHEMAS.password_reset.parse(reset?.data).requested).toBe(false);

      const archived = await seed({ archived: true });
      const restored = await client.post(`/api/users/${archived.id}/restore`, operations.cookie);
      expect(restored.status).toBe(200);
      const [activation] = await emailsTo(archived.id);
      expect(activation?.subject).toBe('أُعيد تفعيل حسابك في Vertex Hub');
      expect(EMAIL_DATA_SCHEMAS.account_activation.parse(activation?.data).restored).toBe(true);
    });
  });

  describe('forgot password (rule 13)', () => {
    it('answers 204 for every address and emails only an active user, for 1 hour', async () => {
      const active = await seed();
      const invited = await seed({ password: null });
      const archived = await seed({ archived: true });
      for (const email of [active.email, invited.email, archived.email, uniqueEmail('nobody')]) {
        expect((await requestLink(email)).status).toBe(204);
      }
      const [email] = await requestedEmails(active.id, 1);
      expect(await emailsTo(invited.id)).toHaveLength(0);
      expect(await emailsTo(archived.id)).toHaveLength(0);
      const data = EMAIL_DATA_SCHEMAS.password_reset.parse(email?.data);
      expect(data.requested).toBe(true);
      const minutes = (Date.parse(data.expiresAt) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(59);
      expect(minutes).toBeLessThanOrEqual(60);
    });

    it('reads the address trimmed and in any case (edge case 9)', async () => {
      const active = await seed();
      expect((await requestLink(`  ${active.email.toUpperCase()} `)).status).toBe(204);
      await requestedEmails(active.id, 1);
    });

    it('honours 3 requests an hour per user, and ignores the rest silently', async () => {
      const active = await seed();
      for (let i = 0; i < 3; i += 1) {
        expect((await requestLink(active.email)).status).toBe(204);
        await requestedEmails(active.id, i + 1);
      }
      for (let i = 0; i < 2; i += 1) {
        expect((await requestLink(active.email)).status).toBe(204);
      }
      // Give the ignored requests the time the honoured ones took.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await emailsTo(active.id)).toHaveLength(3);
    });

    it('refuses what is not an email address', async () => {
      expect((await requestLink('not an address')).status).toBe(400);
    });
  });

  describe('security notices (rule 14)', () => {
    it('tells the user their password changed through a reset link, not on activation', async () => {
      const invited = await seed({ password: null });
      const activation = userLinkSchema.parse(
        await (await client.post(`/api/users/${invited.id}/link`, operations.cookie)).json(),
      );
      const token = (link: string) =>
        new URLSearchParams(new URL(link).hash.slice(1)).get('token') ?? '';
      const redeem = (link: string, password: string) =>
        client.post('/api/password-links/redeem', undefined, { token: token(link), password });
      expect((await redeem(activation.url, PASSWORD)).status).toBe(204);
      expect(await notices(invited.id)).toHaveLength(0);

      const reset = userLinkSchema.parse(
        await (await client.post(`/api/users/${invited.id}/link`, operations.cookie)).json(),
      );
      expect((await redeem(reset.url, `${PASSWORD}-2`)).status).toBe(204);
      expect(await notices(invited.id)).toMatchObject([{ change: 'password_changed', by: null }]);
    });

    it('tells the user when they change their own password or two-factor', async () => {
      const user = await seed();
      const cookie = await client.signIn(user.email);
      const changed = await client.post('/api/auth/change-password', cookie, {
        currentPassword: PASSWORD,
        newPassword: `${PASSWORD}-new`,
      });
      expect(changed.status).toBe(200);
      expect(await notices(user.id)).toMatchObject([{ change: 'password_changed', by: null }]);

      const fresh = await client.signIn(user.email, { password: `${PASSWORD}-new` });
      const { cookie: verified } = await client.enableTwoFactor(fresh, `${PASSWORD}-new`);
      expect((await notices(user.id))[0]).toMatchObject({ change: 'two_factor_enabled', by: null });

      const regenerated = await client.post(
        '/api/auth/two-factor/generate-backup-codes',
        verified,
        {
          password: `${PASSWORD}-new`,
        },
      );
      expect(regenerated.status).toBe(200);
      expect((await notices(user.id))[0]).toMatchObject({
        change: 'backup_codes_regenerated',
        by: null,
      });
    });

    it('names the user manager who changed roles, reset two-factor or archived', async () => {
      const user = await seed();
      const patched = await client.request('PATCH', `/api/users/${user.id}`, {
        cookie: operations.cookie,
        body: { roles: ['account_manager'] },
      });
      expect(patched.status).toBe(200);
      const reset = await client.post(`/api/users/${user.id}/two-factor/reset`, operations.cookie);
      expect(reset.status).toBe(200);
      const archived = await client.post(`/api/users/${user.id}/archive`, operations.cookie);
      expect(archived.status).toBe(200);
      expect((await notices(user.id)).map(({ change, by }) => [change, by])).toEqual([
        ['archived', operations.name],
        ['two_factor_reset', operations.name],
        ['roles_changed', operations.name],
      ]);
    });
  });

  describe('new device (rule 15)', () => {
    const signInFrom = (email: string, userAgent: string, ip = clientIp()) =>
      fetch(`${url}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          'user-agent': userAgent,
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ email, password: PASSWORD }),
      });

    it('records the first device quietly, then emails once per new browser and system', async () => {
      const user = await seed();
      expect((await signInFrom(user.email, CHROME_WINDOWS)).status).toBe(200);
      expect(await emailsTo(user.id)).toHaveLength(0);
      const devices = await db.select().from(userDevices).where(eq(userDevices.userId, user.id));
      expect(devices.map((device) => device.label)).toEqual(['Chrome · Windows']);

      // A browser update is the same device.
      const updated = CHROME_WINDOWS.replace('141.0.0.0', '142.0.0.0');
      expect((await signInFrom(user.email, updated)).status).toBe(200);
      expect(await emailsTo(user.id)).toHaveLength(0);

      expect((await signInFrom(user.email, SAFARI_IPHONE, '203.0.113.7')).status).toBe(200);
      const [email] = await emailsTo(user.id);
      expect(email?.kind).toBe('new_device');
      expect(EMAIL_DATA_SCHEMAS.new_device.parse(email?.data)).toMatchObject({
        device: 'Safari · iOS',
        ip: '203.0.113.7',
      });

      expect((await signInFrom(user.email, SAFARI_IPHONE)).status).toBe(200);
      expect(await emailsTo(user.id)).toHaveLength(1);
    });
  });
});
