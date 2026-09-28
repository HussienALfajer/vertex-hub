import { Controller, Get, type INestApplication } from '@nestjs/common';
import { meResponseSchema, type Role } from '@vertex-hub/contracts';
import { createDatabase, users } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/auth/create-user.js';
import { RequirePermissions } from '../src/auth/require-permissions.decorator.js';
import { startApp } from './start-app.js';

/** Test-only routes exercising the permission guard. */
@Controller('probe')
class ProbeController {
  @Get('invoices')
  @RequirePermissions('invoices.manage')
  invoices() {
    return { ok: true };
  }

  @Get('signed-in')
  signedIn() {
    return { ok: true };
  }
}

// Better Auth rejects cookie-carrying requests from origins it does not trust (CSRF protection).
const origin = 'http://127.0.0.1:5173';
const password = 'correct-horse-battery-staple';
const run = crypto.randomUUID().slice(0, 8);
const emails: Record<'finance' | 'employee' | 'multi', string> = {
  finance: `finance-${run}@test.vertex.local`,
  employee: `employee-${run}@test.vertex.local`,
  multi: `multi-${run}@test.vertex.local`,
};

describe('authentication and permissions', () => {
  const connection = createDatabase(testDatabaseUrl());
  let app: INestApplication;
  let url: string;

  const seed = (email: string, roles: Role[]) =>
    createUser(connection.db, { name: 'اختبار', email, password, roles });

  async function signIn(email: string, pass = password): Promise<Response> {
    return fetch(`${url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, password: pass }),
    });
  }

  async function sessionCookie(email: string): Promise<string> {
    const response = await signIn(email);
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  }

  const get = (path: string, cookie?: string) =>
    fetch(`${url}${path}`, { headers: cookie ? { cookie, origin } : { origin } });

  beforeAll(async () => {
    await seed(emails.finance, ['finance']);
    await seed(emails.employee, ['employee']);
    await seed(emails.multi, ['employee', 'account_manager']);
    ({ app, url } = await startApp({ controllers: [ProbeController] }));
  });

  afterAll(async () => {
    await app?.close();
    await connection.db.delete(users).where(inArray(users.email, Object.values(emails)));
    await connection.close();
  });

  it('rejects requests without a session', async () => {
    expect((await get('/api/me')).status).toBe(401);
    expect((await get('/api/probe/signed-in')).status).toBe(401);
    expect((await get('/api/probe/invoices')).status).toBe(401);
  });

  it('keeps the health check public', async () => {
    expect((await get('/api/health')).status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    expect((await signIn(emails.finance, 'not-the-password')).status).toBe(401);
  });

  it('does not allow self sign-up', async () => {
    const response = await fetch(`${url}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ name: 'x', email: `new-${run}@test.vertex.local`, password }),
    });
    expect(response.ok).toBe(false);
  });

  it('signs in and returns the user with roles and permissions from the shared map', async () => {
    const cookie = await sessionCookie(emails.multi);
    const response = await get('/api/me', cookie);
    expect(response.status).toBe(200);
    const me = meResponseSchema.parse(await response.json());
    expect(me.user.email).toBe(emails.multi);
    expect(me.roles).toEqual(['employee', 'account_manager']);
    expect(me.permissions).toContain('clients.manage');
    expect(me.permissions).not.toContain('invoices.manage');
  });

  it('allows a route to users whose roles grant the permission and forbids everyone else', async () => {
    const finance = await sessionCookie(emails.finance);
    const employee = await sessionCookie(emails.employee);
    expect((await get('/api/probe/invoices', finance)).status).toBe(200);
    expect((await get('/api/probe/invoices', employee)).status).toBe(403);
    expect((await get('/api/probe/signed-in', employee)).status).toBe(200);
  });

  it('ends the session on sign-out', async () => {
    const cookie = await sessionCookie(emails.employee);
    const response = await fetch(`${url}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, origin },
    });
    expect(response.status).toBe(200);
    expect((await get('/api/me', cookie)).status).toBe(401);
  });
});
