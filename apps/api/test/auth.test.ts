import { Controller, Get, type INestApplication } from '@nestjs/common';
import { auditPageSchema, meResponseSchema } from '@vertex-hub/contracts';
import { auditEntries, createDatabase, departmentMembers, users } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermissions, RequireSession } from '../src/core/access/index.js';
import { SIGN_IN_LIMITS } from '../src/modules/auth/auth.config.js';
import { createUser, resetTwoFactor } from '../src/modules/auth/index.js';
import {
  api,
  clientIp,
  cookieHeader,
  ORIGIN,
  PASSWORD,
  removeUsers,
  type SeededUser,
  seedUser,
  totp,
  uniqueEmail,
} from './helpers.js';
import { startApp } from './start-app.js';

/** Test-only routes exercising the permission guard. */
@Controller('probe')
class ProbeController {
  @Get('invoices')
  @RequirePermissions('invoices.manage')
  invoices() {
    return { ok: true };
  }

  @Get('medical')
  @RequirePermissions('approvals.review_medical')
  medical() {
    return { ok: true };
  }

  @Get('signed-in')
  @RequireSession()
  signedIn() {
    return { ok: true };
  }
}

describe('authentication and permissions', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;

  async function seed(...args: Parameters<typeof seedUser>[1][]): Promise<SeededUser> {
    const user = await seedUser(db, args[0]);
    seeded.push(user.id);
    return user;
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp({ controllers: [ProbeController] }));
    client = api(url);
  });

  afterAll(async () => {
    await app?.close();
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('rejects requests without a session', async () => {
    expect((await client.get('/api/me')).status).toBe(401);
    expect((await client.get('/api/probe/signed-in')).status).toBe(401);
    expect((await client.get('/api/probe/invoices')).status).toBe(401);
  });

  it('keeps the health check public', async () => {
    expect((await client.get('/api/health')).status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const user = await seed();
    const response = await client.request('POST', '/api/auth/sign-in/email', {
      body: { email: user.email, password: 'not-the-password' },
    });
    expect(response.status).toBe(401);
  });

  it('turns off the Better Auth endpoints Vertex Hub does not use', async () => {
    for (const path of [
      '/api/auth/sign-up/email',
      '/api/auth/update-user',
      '/api/auth/change-email',
      '/api/auth/delete-user',
      '/api/auth/request-password-reset',
      '/api/auth/reset-password',
      '/api/auth/two-factor/send-otp',
    ]) {
      const response = await client.post(path, undefined, { email: 'x@test.vertex.local' });
      expect(response.status, path).toBe(404);
    }
    for (const path of ['/api/auth/reset-password/some-token', '/api/auth/callback/google']) {
      expect((await client.get(path)).status, path).toBe(404);
    }
  });

  it('returns effective roles, departments, scoped permissions and 2FA state on /api/me', async () => {
    const user = await seed({
      roles: ['account_manager'],
      departments: [{ code: 'design', manager: true }, { code: 'marketing' }],
    });
    const response = await client.get('/api/me', await client.signIn(user.email));
    expect(response.status).toBe(200);
    const me = meResponseSchema.parse(await response.json());
    expect(me.user.email).toBe(user.email);
    expect(me.roles).toEqual(['department_manager', 'employee', 'account_manager']);
    expect(me.departments.map((d) => [d.code, d.isPrimary, d.isManager])).toEqual([
      ['design', true, true],
      ['marketing', false, false],
    ]);
    expect(me.permissions).toContainEqual({
      permission: 'leads.read',
      scopes: ['all', 'assigned'],
    });
    expect(me.permissions).toContainEqual({ permission: 'users.read', scopes: ['all'] });
    expect(me.permissions.map((p) => p.permission)).not.toContain('invoices.manage');
    expect(me.twoFactor).toEqual({ enabled: false, required: false });
  });

  it('grants permissions from roles and from department membership', async () => {
    const employee = await client.signIn((await seed()).email);
    const medical = await client.signIn(
      (await seed({ departments: [{ code: 'design' }, { code: 'medical_consultation' }] })).email,
    );
    expect((await client.get('/api/probe/signed-in', employee)).status).toBe(200);
    expect((await client.get('/api/probe/medical', employee)).status).toBe(403);
    expect((await client.get('/api/probe/medical', medical)).status).toBe(200);
  });

  it('applies role changes to an open session at the next request', async () => {
    const user = await seed({ departments: [{ code: 'medical_consultation' }] });
    const cookie = await client.signIn(user.email);
    expect((await client.get('/api/probe/medical', cookie)).status).toBe(200);
    await db.delete(departmentMembers).where(eq(departmentMembers.userId, user.id));
    expect((await client.get('/api/probe/medical', cookie)).status).toBe(403);
  });

  describe('required two-factor sign-in', () => {
    it('holds back a required user until they enable 2FA, then lets them through', async () => {
      const user = await seed({ roles: ['finance'] });
      const cookie = await client.signIn(user.email);

      const me = meResponseSchema.parse(await (await client.get('/api/me', cookie)).json());
      expect(me.twoFactor).toEqual({ enabled: false, required: true });
      const blocked = await client.get('/api/probe/invoices', cookie);
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
      expect((await client.get('/api/probe/signed-in', cookie)).status).toBe(403);
      const changePassword = await client.post('/api/auth/change-password', cookie, {
        currentPassword: PASSWORD,
        newPassword: `${PASSWORD}-2`,
      });
      expect(changePassword.status).toBe(403);

      const enabled = await client.enableTwoFactor(cookie);
      expect((await client.get('/api/probe/invoices', enabled.cookie)).status).toBe(200);

      // A new sign-in asks for the code.
      const signedIn = await client.signIn(user.email, { totpSecret: enabled.secret });
      expect((await client.get('/api/probe/invoices', signedIn)).status).toBe(200);
    });

    it('requires 2FA for the Operations manager as soon as they become manager', async () => {
      const user = await seed({ departments: [{ code: 'internal_operations', manager: true }] });
      const cookie = await client.signIn(user.email);
      const response = await client.get('/api/audit', cookie);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    });

    it('refuses to disable 2FA while it is required, and audits enabling it', async () => {
      const user = await client.signInWithTwoFactor(db, { roles: ['finance'] });
      seeded.push(user.id);
      const disabled = await client.post('/api/auth/two-factor/disable', user.cookie, {
        password: PASSWORD,
      });
      expect(disabled.status).toBe(403);
      expect(await disabled.json()).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });

      const manager = await client.signInWithTwoFactor(db, { roles: ['general_manager'] });
      seeded.push(manager.id);
      const page = auditPageSchema.parse(
        await (
          await client.get(
            `/api/audit?entityId=${user.id}&action=user.two_factor_enabled`,
            manager.cookie,
          )
        ).json(),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        actorId: user.id,
        actorName: user.name,
        before: { twoFactorEnabled: false },
        after: { twoFactorEnabled: true },
      });
    });

    it('lets an optional user disable 2FA, audited', async () => {
      const user = await client.signInWithTwoFactor(db, {});
      seeded.push(user.id);
      const disabled = await client.post('/api/auth/two-factor/disable', user.cookie, {
        password: PASSWORD,
      });
      expect(disabled.status).toBe(200);
      const actions = (
        await db
          .select({ action: auditEntries.action })
          .from(auditEntries)
          .where(eq(auditEntries.entityId, user.id))
      ).map((row) => row.action);
      expect(actions.sort()).toEqual(['user.two_factor_disabled', 'user.two_factor_enabled']);
    });

    it('audits new backup codes, and not a refused attempt', async () => {
      const user = await client.signInWithTwoFactor(db, {});
      seeded.push(user.id);
      const refused = await client.post('/api/auth/two-factor/generate-backup-codes', user.cookie, {
        password: 'not-the-password',
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      const generated = await client.post(
        '/api/auth/two-factor/generate-backup-codes',
        user.cookie,
        {
          password: PASSWORD,
        },
      );
      expect(generated.status).toBe(200);
      // Written by hand: lowercase letters and digits without look-alikes (i, l, o, 0, 1).
      const { backupCodes } = (await generated.json()) as { backupCodes: string[] };
      expect(backupCodes).toHaveLength(10);
      for (const code of backupCodes) {
        expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
      }
      const actions = (
        await db
          .select({ action: auditEntries.action })
          .from(auditEntries)
          .where(eq(auditEntries.entityId, user.id))
      ).map((row) => row.action);
      expect(actions.sort()).toEqual(['user.backup_codes_regenerated', 'user.two_factor_enabled']);
    });

    it('does not offer "trust this device"', async () => {
      const user = await client.signInWithTwoFactor(db, {});
      seeded.push(user.id);
      const ip = clientIp();
      const first = await client.request('POST', '/api/auth/sign-in/email', {
        body: { email: user.email, password: PASSWORD },
        ip,
      });
      const cookie = first.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      const response = await client.request('POST', '/api/auth/two-factor/verify-totp', {
        cookie,
        body: { code: '000000', trustDevice: true },
        ip,
      });
      expect(response.status).toBe(400);
    });
  });

  it('audits a password change made through Better Auth', async () => {
    const user = await seed();
    const cookie = await client.signIn(user.email);
    const response = await client.post('/api/auth/change-password', cookie, {
      currentPassword: PASSWORD,
      newPassword: `${PASSWORD}-new`,
    });
    expect(response.status).toBe(200);
    const rows = await db.select().from(auditEntries).where(eq(auditEntries.entityId, user.id));
    expect(rows).toMatchObject([
      { action: 'user.password_changed', actorId: user.id, before: null, after: null },
    ]);
  });

  it('refuses sign-in to archived and invited users with the wrong-password error', async () => {
    const archived = await seed({ archived: true });
    const invited = await seed({ password: null });
    for (const email of [archived.email, invited.email]) {
      const response = await client.request('POST', '/api/auth/sign-in/email', {
        body: { email, password: PASSWORD },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
    }
  });

  it('refuses the 2FA step to a user archived after the password step', async () => {
    const user = await client.signInWithTwoFactor(db, {});
    seeded.push(user.id);
    const ip = clientIp();
    const first = await client.request('POST', '/api/auth/sign-in/email', {
      body: { email: user.email, password: PASSWORD },
      ip,
    });
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, user.id));
    const verified = await client.request('POST', '/api/auth/two-factor/verify-totp', {
      cookie: cookieHeader(first),
      body: { code: totp(user.secret) },
      ip,
    });
    expect(verified.status).toBe(401);
  });

  it("leaves an archived user's leftover session nothing but sign-out", async () => {
    const user = await seed();
    const cookie = await client.signIn(user.email);
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, user.id));
    expect((await client.get('/api/probe/signed-in', cookie)).status).toBe(401);
    const changed = await client.post('/api/auth/change-password', cookie, {
      currentPassword: PASSWORD,
      newPassword: `${PASSWORD}-new`,
    });
    expect(changed.status).toBe(401);
    expect((await client.post('/api/auth/sign-out', cookie)).status).toBe(200);
  });

  it('limits sign-in to 20 attempts per minute per client address (rule 18)', async () => {
    const ip = clientIp();
    const statuses: number[] = [];
    // Different accounts, as an office behind one address: the per-account limit stays out.
    for (let attempt = 0; attempt < SIGN_IN_LIMITS.perIpPerMinute + 1; attempt++) {
      const response = await client.request('POST', '/api/auth/sign-in/email', {
        body: { email: uniqueEmail('nobody'), password: 'wrong-password-here' },
        ip,
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another address is not affected.
    expect((await client.signIn((await seed()).email)).length).toBeGreaterThan(0);
  });

  it('limits failed sign-ins per account, whatever the address (rule 18)', async () => {
    const user = await seed();
    for (let attempt = 0; attempt < SIGN_IN_LIMITS.failuresPerAccount; attempt++) {
      const response = await client.request('POST', '/api/auth/sign-in/email', {
        body: { email: user.email, password: 'wrong-password-here' },
      });
      expect(response.status).toBe(401);
    }
    // Each attempt came from a new address, and even the right password is held back now.
    const blocked = await client.request('POST', '/api/auth/sign-in/email', {
      body: { email: user.email, password: PASSWORD },
    });
    expect(blocked.status).toBe(429);
    // Other accounts sign in as usual.
    expect((await client.signIn((await seed()).email)).length).toBeGreaterThan(0);
  });

  it('refuses cross-origin state changes on API routes (CSRF)', async () => {
    const cookie = await client.signIn((await seed()).email);
    const url = await app.getUrl();
    const post = (headers: Record<string, string>) =>
      fetch(`${url}/api/me/notifications/read-all`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': clientIp(), ...headers },
      });
    expect((await post({ origin: 'https://evil.vertexmedia.pro' })).status).toBe(403);
    expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await post({ origin: ORIGIN })).status).toBe(200);
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    // Reading is never refused.
    const read = await fetch(`${url}/api/me`, {
      headers: { cookie, origin: 'https://evil.vertexmedia.pro' },
    });
    expect(read.status).toBe(200);
  });

  it('ends the session on sign-out', async () => {
    const cookie = await client.signIn((await seed()).email);
    expect((await client.post('/api/auth/sign-out', cookie)).status).toBe(200);
    expect((await client.get('/api/me', cookie)).status).toBe(401);
  });

  describe('CLI commands', () => {
    it('creates an active user with a primary department, audited with no actor', async () => {
      const email = uniqueEmail('cli');
      const { id } = await createUser(
        db,
        {
          name: 'مدير',
          email,
          password: PASSWORD,
          roles: ['general_manager'],
          department: 'general_management',
        },
        null,
      );
      seeded.push(id);
      const me = meResponseSchema.parse(
        await (await client.get('/api/me', await client.signIn(email))).json(),
      );
      expect(me.roles).toEqual(['general_manager', 'employee']);
      expect(me.departments).toMatchObject([{ code: 'general_management', isPrimary: true }]);
      const rows = await db.select().from(auditEntries).where(eq(auditEntries.entityId, id));
      expect(rows).toMatchObject([{ action: 'user.created', actorId: null, actorName: null }]);
    });

    it('resets 2FA, so a required user must set it up again', async () => {
      const user = await client.signInWithTwoFactor(db, { roles: ['general_manager'] });
      seeded.push(user.id);
      await db.transaction((tx) => resetTwoFactor(tx, user.id, null));
      const cookie = await client.signIn(user.email);
      const me = meResponseSchema.parse(await (await client.get('/api/me', cookie)).json());
      expect(me.twoFactor).toEqual({ enabled: false, required: true });
      const rows = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'user.two_factor_reset'));
      expect(rows.filter((row) => row.entityId === user.id)).toMatchObject([
        { actorId: null, before: { twoFactorEnabled: true }, after: { twoFactorEnabled: false } },
      ]);
    });
  });
});
