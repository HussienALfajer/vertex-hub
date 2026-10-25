import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  EMAIL_DATA_SCHEMAS,
  type HardwareSignals,
  signedInDeviceListSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, emailMessages, sessions } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionActivity } from '../src/modules/auth/session-activity.js';
import { clientIp, ORIGIN, PASSWORD, removeUsers, type SeedUser, seedUser } from './helpers.js';
import { mmdbFixture } from './mmdb-fixture.js';
import { startApp } from './start-app.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/141.0.0.0`;
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const OFFICE_IP = '185.12.34.56';
const PHONE_IP = '2a02:2f0c:1:2::5';

const SIGNALS: HardwareSignals = {
  cores: 8,
  timeZone: 'Asia/Damascus',
  screen: { long: 1920, short: 1080 },
  gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const newDeviceValue = () => randomBytes(32).toString('base64url');

interface Browser {
  /** Session and `vh_device` cookies, as the browser sends them. */
  cookie: string;
  device: string;
  sessionId: string;
  ip: string;
}

describe('signed-in devices (F01B)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let url: string;
  let geoDir: string;

  const seed = async (input: SeedUser = {}) => {
    const user = await seedUser(db, { name: `جهاز ${run} ${seeded.length}`, ...input });
    seeded.push(user.id);
    return user;
  };

  /** Signs in like a browser: its user agent, address and `vh_device` cookie, if it has one. */
  const signIn = async (
    user: { id: string; email: string },
    options: { userAgent?: string; ip?: string; device?: string } = {},
  ): Promise<Browser & { setCookies: string[] }> => {
    const ip = options.ip ?? clientIp();
    const response = await fetch(`${url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': ip,
        'user-agent': options.userAgent ?? CHROME_WINDOWS,
        'content-type': 'application/json',
        ...(options.device && { cookie: `vh_device=${options.device}` }),
      },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    const issued = setCookies.find((cookie) => cookie.startsWith('vh_device='));
    const device = options.device ?? issued?.split(';')[0]?.slice('vh_device='.length) ?? '';
    const session = setCookies
      .filter((cookie) => !cookie.startsWith('vh_device='))
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.id))
      .limit(1);
    return {
      cookie: `${session}; vh_device=${device}`,
      device,
      sessionId: row?.id ?? '',
      ip,
      setCookies,
    };
  };

  const call = (
    method: string,
    path: string,
    browser: Pick<Browser, 'cookie' | 'ip'> | null,
    body?: unknown,
  ) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': browser?.ip ?? clientIp(),
        ...(browser && { cookie: browser.cookie }),
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const list = async (browser: Browser) => {
    const response = await call('GET', '/api/me/sessions', browser);
    expect(response.status).toBe(200);
    return signedInDeviceListSchema.parse(await response.json()).items;
  };

  const report = (browser: Browser, signals: HardwareSignals = SIGNALS) =>
    call('PUT', '/api/me/sessions/current/hardware', browser, signals);

  const sessionRow = async (id: string) => {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    return row;
  };

  const audits = (userId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, userId), eq(auditEntries.action, action)));

  const notices = async (userId: string) =>
    (
      await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.kind, 'security_notice'),
            sql`exists (select 1 from jsonb_array_elements(${emailMessages.to}) as r
              where r->>'userId' = ${userId})`,
          ),
        )
    ).map((email) => EMAIL_DATA_SCHEMAS.security_notice.parse(email.data).change);

  beforeAll(async () => {
    geoDir = await mkdtemp(join(tmpdir(), 'geoip-devices-'));
    const geoPath = join(geoDir, 'dbip-city-lite.mmdb');
    await writeFile(
      geoPath,
      mmdbFixture([
        ['185.12.34.0/24', { country: { iso_code: 'SY' }, city: { names: { en: 'Damascus' } } }],
        ['2a02:2f0c::/32', { country: { iso_code: 'DE' }, city: { names: { en: 'Berlin' } } }],
      ]),
    );
    process.env.GEOIP_DB_PATH = geoPath;
    ({ app, url } = await startApp());
  });

  afterAll(async () => {
    await removeUsers(db, seeded);
    await app?.close();
    await connection.close();
    delete process.env.GEOIP_DB_PATH;
    await rm(geoDir, { recursive: true, force: true });
  });

  describe('browser key (rules 1–3)', () => {
    it('gives a browser its cookie at sign-in and keys the session with it', async () => {
      const user = await seed();
      const browser = await signIn(user);
      const issued = browser.setCookies.find((cookie) => cookie.startsWith('vh_device='));
      expect(issued).toMatch(/^vh_device=[A-Za-z0-9_-]{43}; /);
      expect(issued).toContain('Path=/api');
      expect(issued).toContain(`Max-Age=${400 * 24 * 60 * 60}`);
      expect(issued).toContain('HttpOnly');
      expect(issued).toContain('SameSite=Lax');
      expect((await sessionRow(browser.sessionId))?.browserKey).toBe(sha256(browser.device));
    });

    it('keeps the cookie of a browser that has one', async () => {
      const user = await seed();
      const device = newDeviceValue();
      const browser = await signIn(user, { device });
      expect(browser.setCookies.some((cookie) => cookie.startsWith('vh_device='))).toBe(false);
      expect((await sessionRow(browser.sessionId))?.browserKey).toBe(sha256(device));
    });

    it('keys a session without a browser key at its next request', async () => {
      const user = await seed();
      const browser = await signIn(user);
      await db.update(sessions).set({ browserKey: null }).where(eq(sessions.id, browser.sessionId));
      const session = browser.cookie.replace(/; vh_device=.*$/, '');
      const response = await call('GET', '/api/me', { cookie: session, ip: browser.ip });
      expect(response.status).toBe(200);
      const issued = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('vh_device='));
      const device = issued?.split(';')[0]?.slice('vh_device='.length) ?? '';
      expect(device).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await sessionRow(browser.sessionId))?.browserKey).toBe(sha256(device));
    });

    it('issues the same cookie to the parallel requests of an app load', async () => {
      const user = await seed();
      const browser = await signIn(user);
      await db.update(sessions).set({ browserKey: null }).where(eq(sessions.id, browser.sessionId));
      const session = { cookie: browser.cookie.replace(/; vh_device=.*$/, ''), ip: browser.ip };
      const responses = await Promise.all([
        call('GET', '/api/me', session),
        call('GET', '/api/me/sessions', session),
        call('GET', '/api/auth/get-session', session),
      ]);
      const issued = responses.map(
        (response) =>
          response.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith('vh_device='))
            ?.split(';')[0],
      );
      expect(new Set(issued).size).toBe(1);
      const device = issued[0]?.slice('vh_device='.length) ?? '';
      expect((await sessionRow(browser.sessionId))?.browserKey).toBe(sha256(device));
    });
  });

  describe('last activity (rule 4)', () => {
    it('records activity and address at most once every 5 minutes', async () => {
      const user = await seed();
      const browser = await signIn(user, { ip: OFFICE_IP });
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await db
        .update(sessions)
        .set({ lastActiveAt: old })
        .where(eq(sessions.id, browser.sessionId));

      expect((await call('GET', '/api/me', { ...browser, ip: '185.12.34.99' })).status).toBe(200);
      const touched = await sessionRow(browser.sessionId);
      expect(touched?.lastActiveAt.getTime()).toBeGreaterThan(old.getTime());
      expect(touched?.lastIpAddress).toBe('185.12.34.99');

      await db
        .update(sessions)
        .set({ lastActiveAt: old })
        .where(eq(sessions.id, browser.sessionId));
      expect((await call('GET', '/api/me', { ...browser, ip: '185.12.34.100' })).status).toBe(200);
      const throttled = await sessionRow(browser.sessionId);
      expect(throttled?.lastActiveAt).toEqual(old);
      expect(throttled?.lastIpAddress).toBe('185.12.34.99');
    });

    it('writes nothing for a session active in the last 5 minutes', async () => {
      const user = await seed();
      const browser = await signIn(user);
      const before = await sessionRow(browser.sessionId);
      await app.get(SessionActivity).touch(browser.sessionId, {
        'x-forwarded-for': '185.12.34.77',
        cookie: browser.cookie,
      });
      const after = await sessionRow(browser.sessionId);
      expect(after?.lastActiveAt).toEqual(before?.lastActiveAt);
      expect(after?.lastIpAddress).toBeNull();
    });

    it('writes again 5 minutes after the stored activity, whatever requests came between', async () => {
      const user = await seed();
      const browser = await signIn(user);
      const activity = app.get(SessionActivity);
      const headers = { 'x-forwarded-for': '185.12.34.78', cookie: browser.cookie };
      // Active 4 minutes ago: this request writes nothing.
      const recent = new Date(Date.now() - 4 * 60 * 1000);
      await db
        .update(sessions)
        .set({ lastActiveAt: recent })
        .where(eq(sessions.id, browser.sessionId));
      await activity.touch(browser.sessionId, headers);
      expect((await sessionRow(browser.sessionId))?.lastActiveAt).toEqual(recent);
      // Two minutes later the stored time is 6 minutes old: the next request writes, although
      // the request before came only 2 minutes ago.
      const old = new Date(Date.now() - 6 * 60 * 1000);
      await db
        .update(sessions)
        .set({ lastActiveAt: old })
        .where(eq(sessions.id, browser.sessionId));
      const later = Date.now() + 2 * 60 * 1000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
      try {
        await activity.touch(browser.sessionId, headers);
      } finally {
        clock.mockRestore();
      }
      const written = await sessionRow(browser.sessionId);
      expect(written?.lastActiveAt.getTime()).toBeGreaterThan(old.getTime());
      expect(written?.lastIpAddress).toBe('185.12.34.78');
    });
  });

  describe('GET /api/me/sessions (rules 14–16)', () => {
    it('lists the open sessions with devices and places, the current one first', async () => {
      const user = await seed();
      const phone = await signIn(user, { userAgent: SAFARI_IPHONE, ip: PHONE_IP });
      const chrome = await signIn(user, { ip: OFFICE_IP });
      // An expired session is not open.
      const expired = await signIn(user);
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, expired.sessionId));

      const items = await list(phone);
      expect(items.map((item) => item.id)).toEqual([phone.sessionId, chrome.sessionId]);
      const [current, other] = items;
      expect(current).toMatchObject({
        current: true,
        device: { browser: 'Safari', system: 'iOS', label: 'Safari · iOS' },
        signIn: { ip: PHONE_IP, location: { countryCode: 'DE', city: 'Berlin' } },
        sharedWith: [],
      });
      expect(other).toMatchObject({
        current: false,
        device: { label: 'Chrome · Windows' },
        signIn: { ip: OFFICE_IP, location: { countryCode: 'SY', city: 'Damascus' } },
        lastActive: { ip: OFFICE_IP, location: { countryCode: 'SY', city: 'Damascus' } },
      });
      expect(JSON.stringify(items)).not.toContain(chrome.cookie.split('=')[1]?.split(';')[0]);
    });

    it('names local addresses the local network', async () => {
      const user = await seed();
      const browser = await signIn(user, { ip: '127.0.0.1' });
      const [item] = await list(browser);
      expect(item?.signIn.location).toEqual({ local: true });
    });

    it('names colleagues in the same browser, with their primary department', async () => {
      const first = await seed({
        departments: [{ code: 'content_management' }, { code: 'design' }],
      });
      const second = await seed();
      const device = newDeviceValue();
      const left = await signIn(first, { device });
      const now = await signIn(second, { device });

      const [mine] = await list(now);
      expect(mine?.sharedWith).toEqual([
        {
          user: { id: first.id, name: first.name, imageId: null },
          department: { code: 'content_management', name: expect.any(String) },
          match: 'same_browser',
          lastActiveAt: expect.any(String),
        },
      ]);
      const [theirs] = await list(left);
      expect(theirs?.sharedWith.map((shared) => [shared.user.id, shared.match])).toEqual([
        [second.id, 'same_browser'],
      ]);
    });

    it('names colleagues probably in another browser: same hardware and address', async () => {
      const first = await seed();
      const second = await seed();
      const third = await seed();
      const edge = await signIn(first, { userAgent: EDGE_WINDOWS, ip: '185.12.34.10' });
      const chrome = await signIn(second, { ip: '185.12.34.10' });
      const elsewhere = await signIn(third, { ip: '185.12.35.1' });
      for (const browser of [edge, chrome, elsewhere]) {
        expect((await report(browser)).status).toBe(204);
      }

      const [mine] = await list(edge);
      expect(mine?.sharedWith.map((shared) => [shared.user.id, shared.match])).toEqual([
        [second.id, 'same_device'],
      ]);
    });

    it('lists a colleague once, with the stronger match', async () => {
      const first = await seed();
      const second = await seed();
      const device = newDeviceValue();
      const mine = await signIn(first, { device, ip: '185.12.34.200' });
      const sameBrowser = await signIn(second, { device, ip: '185.12.34.200' });
      const otherBrowser = await signIn(second, { userAgent: EDGE_WINDOWS, ip: '185.12.34.200' });
      for (const browser of [mine, sameBrowser, otherBrowser]) await report(browser);

      const [item] = await list(mine);
      expect(item?.sharedWith.map((shared) => [shared.user.id, shared.match])).toEqual([
        [second.id, 'same_browser'],
      ]);
    });

    it('answers 401 without a session', async () => {
      expect((await call('GET', '/api/me/sessions', null)).status).toBe(401);
    });

    it('holds back a user who must still set up two-factor sign-in', async () => {
      const user = await seed({ roles: ['finance'] });
      const browser = await signIn(user);
      const requests = [
        call('GET', '/api/me/sessions', browser),
        call('PUT', '/api/me/sessions/current/hardware', browser, SIGNALS),
        call('DELETE', `/api/me/sessions/${randomUUID()}`, browser),
        call('POST', '/api/me/sessions/sign-out-all', browser, { includeCurrent: false }),
      ];
      for (const response of await Promise.all(requests)) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
      }
    });
  });

  describe('PUT /api/me/sessions/current/hardware (rule 5)', () => {
    it('stores the HMAC of the signals once per session', async () => {
      const user = await seed();
      const browser = await signIn(user);
      expect((await report(browser)).status).toBe(204);
      const stored = (await sessionRow(browser.sessionId))?.hardwareKey;
      expect(stored).toMatch(/^[0-9a-f]{64}$/);

      expect((await report(browser, { ...SIGNALS, cores: 4 })).status).toBe(204);
      expect((await sessionRow(browser.sessionId))?.hardwareKey).toBe(stored);
    });

    it('stores nothing with fewer than three known signals (edge case 8)', async () => {
      const user = await seed();
      const browser = await signIn(user);
      const hidden = { cores: 8, timeZone: null, screen: null, gpu: null };
      expect((await report(browser, hidden)).status).toBe(204);
      expect((await sessionRow(browser.sessionId))?.hardwareKey).toBeNull();
    });

    it('refuses invalid signals and requests without a session', async () => {
      const user = await seed();
      const browser = await signIn(user);
      expect((await report(browser, { ...SIGNALS, cores: 0 })).status).toBe(400);
      expect((await call('PUT', '/api/me/sessions/current/hardware', null, SIGNALS)).status).toBe(
        401,
      );
    });
  });

  describe('DELETE /api/me/sessions/:id (rules 9 and 12)', () => {
    it('signs out another device, audits it and sends a security notice', async () => {
      const user = await seed();
      const phone = await signIn(user, { userAgent: SAFARI_IPHONE, ip: PHONE_IP });
      const chrome = await signIn(user, { ip: OFFICE_IP });

      const response = await call('DELETE', `/api/me/sessions/${phone.sessionId}`, chrome);
      expect(response.status).toBe(204);
      expect(await sessionRow(phone.sessionId)).toBeUndefined();
      expect((await call('GET', '/api/me', phone)).status).toBe(401);
      expect((await call('GET', '/api/me', chrome)).status).toBe(200);

      const [entry] = await audits(user.id, 'user.session_signed_out');
      expect(entry?.after).toEqual({
        device: 'Safari · iOS',
        ipAddress: PHONE_IP,
        location: { countryCode: 'DE', city: 'Berlin' },
      });
      expect(await notices(user.id)).toEqual(['device_signed_out']);

      // Edge case 3: the second click finds nothing and writes nothing.
      const again = await call('DELETE', `/api/me/sessions/${phone.sessionId}`, chrome);
      expect(again.status).toBe(404);
      expect(await audits(user.id, 'user.session_signed_out')).toHaveLength(1);
    });

    it("answers NOT_FOUND for another user's session and keeps it open", async () => {
      const user = await seed();
      const other = await seed();
      const mine = await signIn(user);
      const theirs = await signIn(other);
      const response = await call('DELETE', `/api/me/sessions/${theirs.sessionId}`, mine);
      expect(response.status).toBe(404);
      expect(await sessionRow(theirs.sessionId)).toBeDefined();
    });

    it('refuses the current session', async () => {
      const user = await seed();
      const browser = await signIn(user);
      const response = await call('DELETE', `/api/me/sessions/${browser.sessionId}`, browser);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'CURRENT_SESSION' });
      expect((await call('GET', '/api/me', browser)).status).toBe(200);
    });

    it('answers 401 without a session', async () => {
      expect((await call('DELETE', `/api/me/sessions/${randomUUID()}`, null)).status).toBe(401);
    });
  });

  describe('POST /api/me/sessions/sign-out-all (rules 10–12)', () => {
    it('signs out every other device and keeps this one', async () => {
      const user = await seed();
      const other = await seed();
      const phone = await signIn(user, { userAgent: SAFARI_IPHONE });
      const edge = await signIn(user, { userAgent: EDGE_WINDOWS });
      const chrome = await signIn(user);
      const theirs = await signIn(other);

      const response = await call('POST', '/api/me/sessions/sign-out-all', chrome, {
        includeCurrent: false,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ signedOut: 2 });
      expect(response.headers.getSetCookie()).toEqual([]);
      for (const gone of [phone, edge])
        expect((await call('GET', '/api/me', gone)).status).toBe(401);
      expect((await call('GET', '/api/me', chrome)).status).toBe(200);
      expect((await call('GET', '/api/me', theirs)).status).toBe(200);

      const [entry] = await audits(user.id, 'user.sessions_signed_out');
      expect(entry?.after).toEqual({ count: 2, includedCurrent: false });
      expect(await notices(user.id)).toEqual(['all_devices_signed_out']);
    });

    it('signs out every device with this one and clears the session cookie', async () => {
      const user = await seed();
      const phone = await signIn(user, { userAgent: SAFARI_IPHONE });
      const chrome = await signIn(user);

      const response = await call('POST', '/api/me/sessions/sign-out-all', chrome, {
        includeCurrent: true,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ signedOut: 2 });
      const cleared = response.headers.getSetCookie();
      expect(cleared.some((cookie) => /session_token=;.*Max-Age=0/.test(cookie))).toBe(true);
      expect(cleared.some((cookie) => cookie.startsWith('vh_device='))).toBe(false);
      for (const gone of [phone, chrome]) {
        expect((await call('GET', '/api/me', gone)).status).toBe(401);
      }
      const [entry] = await audits(user.id, 'user.sessions_signed_out');
      expect(entry?.after).toEqual({ count: 2, includedCurrent: true });
    });

    it('writes nothing when there is no other device', async () => {
      const user = await seed();
      const browser = await signIn(user);
      const response = await call('POST', '/api/me/sessions/sign-out-all', browser, {
        includeCurrent: false,
      });
      expect(await response.json()).toEqual({ signedOut: 0 });
      expect(await audits(user.id, 'user.sessions_signed_out')).toEqual([]);
      expect(await notices(user.id)).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      const response = await call('POST', '/api/me/sessions/sign-out-all', null, {
        includeCurrent: false,
      });
      expect(response.status).toBe(401);
    });
  });

  it("disables Better Auth's own session endpoints (rule 13)", async () => {
    const user = await seed();
    const browser = await signIn(user);
    expect((await call('GET', '/api/auth/list-sessions', browser)).status).toBe(404);
    for (const path of ['revoke-session', 'revoke-sessions', 'revoke-other-sessions']) {
      const response = await call('POST', `/api/auth/${path}`, browser, {
        token: 'anything',
      });
      expect(response.status).toBe(404);
    }
    expect((await call('GET', '/api/me', browser)).status).toBe(200);
  });
});
