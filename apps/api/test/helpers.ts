import { createHmac, randomUUID } from 'node:crypto';
import type { AssignableRole, DepartmentCode } from '@vertex-hub/contracts';
import {
  accounts,
  auditEntries,
  type Database,
  departmentMembers,
  departments,
  newId,
  userRoles,
  users,
} from '@vertex-hub/db';
import { hashPassword } from 'better-auth/crypto';
import { eq, inArray, or } from 'drizzle-orm';

/*
 * Shared helpers for API integration tests: seed users straight into the test database, sign in
 * over HTTP (with the two-factor step), and clean up. Test data is unique per run (ADR 0013).
 */

/** Better Auth rejects cookie-carrying requests from origins it does not trust (CSRF). */
export const ORIGIN = 'http://127.0.0.1:5173';
export const PASSWORD = 'correct-horse-battery-staple';

export const uniqueEmail = (label: string) =>
  `${label}-${randomUUID().slice(0, 8)}@test.vertex.local`;

/**
 * A client address per call. Sign-in is rate limited per address (F01 rule 18), so each helper
 * call looks like a new client unless a test passes its own.
 */
export const clientIp = () =>
  `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;

export interface SeedUser {
  email?: string;
  name?: string;
  roles?: AssignableRole[];
  /** First entry is the primary department. Defaults to Design. */
  departments?: { code: DepartmentCode; manager?: boolean }[];
  /** `null` seeds an invited user (no password yet). */
  password?: string | null;
  archived?: boolean;
}

export interface SeededUser {
  id: string;
  email: string;
  name: string;
}

export async function departmentId(db: Database, code: DepartmentCode): Promise<string> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, code));
  if (!row) throw new Error(`Department ${code} is not seeded`);
  return row.id;
}

export async function seedUser(db: Database, input: SeedUser = {}): Promise<SeededUser> {
  const id = newId();
  const email = input.email ?? uniqueEmail('user');
  const name = input.name ?? 'مستخدم اختبار';
  const password = input.password === undefined ? PASSWORD : input.password;
  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    archivedAt: input.archived ? new Date() : null,
  });
  if (password !== null) {
    await db.insert(accounts).values({
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: await hashPassword(password),
    });
  }
  if (input.roles?.length) {
    await db.insert(userRoles).values(input.roles.map((role) => ({ userId: id, role })));
  }
  const memberships = input.departments ?? [{ code: 'design' }];
  for (const [index, membership] of memberships.entries()) {
    const deptId = await departmentId(db, membership.code);
    await db
      .insert(departmentMembers)
      .values({ userId: id, departmentId: deptId, isPrimary: index === 0 });
    if (membership.manager) {
      await db.update(departments).set({ managerId: id }).where(eq(departments.id, deptId));
    }
  }
  return { id, email, name };
}

/** Removes seeded users with everything that points at them (test cleanup only). */
export async function removeUsers(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(auditEntries)
    .where(or(inArray(auditEntries.actorId, ids), inArray(auditEntries.entityId, ids)));
  await db.update(departments).set({ managerId: null }).where(inArray(departments.managerId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** The current 6-digit TOTP code (RFC 6238, SHA-1, 30 s) for a base32 secret. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

export function api(url: string) {
  const request = (
    method: string,
    path: string,
    options: { cookie?: string; body?: unknown; ip?: string } = {},
  ) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': options.ip ?? clientIp(),
        ...(options.cookie && { cookie: options.cookie }),
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  /** Signs in with email and password, and with a TOTP code when the user has 2FA on. */
  async function signIn(
    email: string,
    options: { password?: string; totpSecret?: string; ip?: string } = {},
  ): Promise<string> {
    const ip = options.ip ?? clientIp();
    const response = await request('POST', '/api/auth/sign-in/email', {
      body: { email, password: options.password ?? PASSWORD },
      ip,
    });
    if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status}`);
    const body = (await response.json()) as { twoFactorRedirect?: boolean };
    if (!body.twoFactorRedirect) return cookieHeader(response);
    if (!options.totpSecret) throw new Error('Sign-in needs a TOTP secret');
    const verified = await request('POST', '/api/auth/two-factor/verify-totp', {
      cookie: cookieHeader(response),
      body: { code: totp(options.totpSecret) },
      ip,
    });
    if (verified.status !== 200) throw new Error(`2FA verification failed: ${verified.status}`);
    return cookieHeader(verified);
  }

  /**
   * Turns on two-factor sign-in through Better Auth for a signed-in user, the way the setup page
   * does. Better Auth replaces the session when 2FA turns on: use the returned cookie.
   */
  async function enableTwoFactor(
    cookie: string,
    password = PASSWORD,
  ): Promise<{ secret: string; backupCodes: string[]; cookie: string }> {
    const ip = clientIp();
    const enabled = await request('POST', '/api/auth/two-factor/enable', {
      cookie,
      body: { password },
      ip,
    });
    if (enabled.status !== 200) throw new Error(`2FA enable failed: ${enabled.status}`);
    const { totpURI, backupCodes } = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    const verified = await request('POST', '/api/auth/two-factor/verify-totp', {
      cookie,
      body: { code: totp(secret) },
      ip,
    });
    if (verified.status !== 200) throw new Error(`2FA verification failed: ${verified.status}`);
    return { secret, backupCodes, cookie: cookieHeader(verified) || cookie };
  }

  /** Seeds a user who must use 2FA, enables it, and returns them signed in. */
  async function signInWithTwoFactor(db: Database, input: SeedUser) {
    const user = await seedUser(db, input);
    const { secret, backupCodes } = await enableTwoFactor(await signIn(user.email));
    const cookie = await signIn(user.email, { totpSecret: secret });
    return { ...user, cookie, secret, backupCodes };
  }

  return {
    get: (path: string, cookie?: string) => request('GET', path, { cookie }),
    post: (path: string, cookie?: string, body?: unknown) =>
      request('POST', path, { cookie, body: body ?? {} }),
    request,
    signIn,
    enableTwoFactor,
    signInWithTwoFactor,
  };
}
