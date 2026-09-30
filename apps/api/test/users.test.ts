import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  clientDetailResponseSchema,
  type ErrorResponse,
  meResponseSchema,
  projectDetailSchema,
  userLinkSchema,
  userPageSchema,
  userResponseSchema,
  userWithLinkResponseSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  departments,
  userRoles,
  users,
  verifications,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  departmentId,
  PASSWORD,
  removeClients,
  removeUsers,
  type SeedUser,
  seedUser,
  uniqueEmail,
} from './helpers.js';
import { startApp } from './start-app.js';

type SignedIn = Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;

describe('users', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const seededClients: string[] = [];
  /** Names carry the run id, so searches see only this run's users. */
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: SignedIn;
  let operations: SignedIn;
  let employee: { id: string; email: string; cookie: string };
  let design: string;
  let marketing: string;

  const seed = async (input: SeedUser = {}) => {
    const user = await seedUser(db, { name: `عضو ${run}`, ...input });
    seeded.push(user.id);
    return user;
  };

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    const body = (await response.json()) as ErrorResponse;
    expect(body.code).toBe(code);
    return body;
  }

  const patch = (path: string, cookie: string, body: unknown) =>
    client.request('PATCH', path, { cookie, body });

  const tokenOf = (url: string) =>
    new URLSearchParams(new URL(url).hash.slice(1)).get('token') ?? '';
  const redeem = (token: string, password = PASSWORD) =>
    client.post('/api/password-links/redeem', undefined, { token, password });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    design = await departmentId(db, 'design');
    marketing = await departmentId(db, 'marketing');
    gm = await client.signInWithTwoFactor(db, {
      name: `المدير ${run}`,
      roles: ['general_manager'],
      departments: [{ code: 'general_management' }],
    });
    operations = await client.signInWithTwoFactor(db, {
      name: `العمليات ${run}`,
      departments: [{ code: 'internal_operations', manager: true }],
    });
    seeded.push(gm.id, operations.id);
    const plain = await seed({ skills: ['Photoshop', 'مونتاج'] } as SeedUser);
    await db
      .update(users)
      .set({ skills: ['Photoshop', 'مونتاج'] })
      .where(eq(users.id, plain.id));
    employee = { ...plain, cookie: await client.signIn(plain.email) };
  });

  afterAll(async () => {
    await app?.close();
    await removeClients(db, seededClients);
    await removeUsers(db, seeded);
    await connection.close();
  });

  describe('directory', () => {
    it('requires a session', async () => {
      expect((await client.get('/api/users')).status).toBe(401);
      expect((await client.get(`/api/users/${gm.id}`)).status).toBe(401);
      expect((await client.get('/api/users/skills')).status).toBe(401);
    });

    it('shows every employee directory fields only', async () => {
      const response = await client.get(`/api/users?search=${run}`, employee.cookie);
      const page = userPageSchema.parse(await response.json());
      expect(page.items.map((u) => u.id)).toEqual(expect.arrayContaining([employee.id, gm.id]));
      for (const user of page.items) {
        expect(user).not.toHaveProperty('status');
        expect(user).not.toHaveProperty('roles');
        expect(user).not.toHaveProperty('twoFactorEnabled');
      }
      const operationsEntry = page.items.find((u) => u.id === operations.id);
      expect(operationsEntry?.departments).toMatchObject([
        { code: 'internal_operations', isPrimary: true, isManager: true },
      ]);
    });

    it('shows status, roles and 2FA to user managers', async () => {
      const response = await client.get(`/api/users/${gm.id}`, operations.cookie);
      expect(userResponseSchema.parse(await response.json())).toMatchObject({
        status: 'active',
        roles: ['general_manager'],
        twoFactorEnabled: true,
      });
    });

    it('lists invited and archived users to user managers only', async () => {
      expect((await client.get('/api/users?status=invited', employee.cookie)).status).toBe(403);
      const invited = await seed({ password: null });
      const page = userPageSchema.parse(
        await (await client.get(`/api/users?status=invited&search=${run}`, gm.cookie)).json(),
      );
      expect(page.items.map((u) => u.id)).toContain(invited.id);
      expect(page.items.every((u) => u.status === 'invited')).toBe(true);
    });

    it('keeps the assigned-role filter to user managers', async () => {
      for (const role of ['general_manager', 'finance', 'account_manager']) {
        expect((await client.get(`/api/users?role=${role}`, employee.cookie)).status, role).toBe(
          403,
        );
      }
      expect((await client.get('/api/users?role=department_manager', employee.cookie)).status).toBe(
        200,
      );
    });

    it('filters by department, role and skill, case-insensitively', async () => {
      const list = async (query: string) =>
        userPageSchema
          .parse(await (await client.get(`/api/users?search=${run}&${query}`, gm.cookie)).json())
          .items.map((u) => u.id);
      expect(await list(`departmentId=${design}`)).toContain(employee.id);
      expect(await list(`departmentId=${design}`)).not.toContain(gm.id);
      expect(await list('role=general_manager')).toEqual([gm.id]);
      expect(await list('role=department_manager')).toEqual([operations.id]);
      expect(await list('skill=photoshop')).toEqual([employee.id]);
    });

    it('lists skills in use once each', async () => {
      const other = await seed();
      await db
        .update(users)
        .set({ skills: ['PHOTOSHOP', 'Premiere'] })
        .where(eq(users.id, other.id));
      const response = await client.get('/api/users/skills', employee.cookie);
      const { items } = (await response.json()) as { items: string[] };
      expect(items.filter((s) => s.toLowerCase() === 'photoshop')).toHaveLength(1);
      expect(items).toEqual(expect.arrayContaining(['Premiere', 'مونتاج']));
    });

    it('answers 404 for an unknown user and 400 for a malformed id', async () => {
      expect((await client.get(`/api/users/${randomUUID()}`, gm.cookie)).status).toBe(404);
      expect((await client.get('/api/users/not-an-id', gm.cookie)).status).toBe(400);
    });
  });

  describe('create and activate', () => {
    const newUser = () => ({
      name: `جديد ${run}`,
      email: uniqueEmail('New'),
      primaryDepartmentId: design,
      secondaryDepartmentIds: [marketing],
      title: 'مصمم',
      phone: '+963 944 000 111',
      skills: ['Figma', ' figma '],
      roles: ['account_manager'],
    });

    it('is closed to users without users.manage', async () => {
      expect((await client.post('/api/users', undefined, newUser())).status).toBe(401);
      expect((await client.post('/api/users', employee.cookie, newUser())).status).toBe(403);
    });

    it('creates an invited user with an activation link, audited', async () => {
      const input = newUser();
      const response = await client.post('/api/users', operations.cookie, input);
      expect(response.status).toBe(201);
      const { user, link } = userWithLinkResponseSchema.parse(await response.json());
      seeded.push(user.id);
      expect(user).toMatchObject({
        email: input.email.toLowerCase(),
        phone: '+963944000111',
        skills: ['Figma'],
        status: 'invited',
        roles: ['account_manager'],
      });
      expect(user.departments.map((d) => [d.id, d.isPrimary])).toEqual([
        [design, true],
        [marketing, false],
      ]);
      expect(link.kind).toBe('activation');
      expect(link.url).toMatch(/\/activate#token=/);
      const hours = (Date.parse(link.expiresAt) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(71.9);
      expect(hours).toBeLessThanOrEqual(72);
      const audit = await auditOf(user.id);
      expect(audit.map((a) => a.action)).toEqual(['user.created', 'user.link_issued']);
      expect(audit[0]).toMatchObject({ actorId: operations.id, actorName: operations.name });
      expect(audit[1]?.after).toEqual({ kind: 'activation' });
      expect(JSON.stringify(audit)).not.toContain(tokenOf(link.url));
    });

    it('refuses a taken email, an unknown department and the primary as secondary', async () => {
      const input = newUser();
      await expectError(
        await client.post('/api/users', gm.cookie, { ...input, email: gm.email.toUpperCase() }),
        409,
        'EMAIL_TAKEN',
      );
      await expectError(
        await client.post('/api/users', gm.cookie, {
          ...input,
          secondaryDepartmentIds: [randomUUID()],
        }),
        400,
        'UNKNOWN_DEPARTMENT',
      );
      const response = await client.post('/api/users', gm.cookie, {
        ...input,
        secondaryDepartmentIds: [design],
      });
      expect(response.status).toBe(400);
    });

    it('lets only a General Manager grant the General Manager role', async () => {
      await expectError(
        await client.post('/api/users', operations.cookie, {
          ...newUser(),
          roles: ['general_manager'],
        }),
        403,
        'GENERAL_MANAGER_ONLY',
      );
    });

    it('activates the account through the link, once', async () => {
      const created = userWithLinkResponseSchema.parse(
        await (await client.post('/api/users', gm.cookie, newUser())).json(),
      );
      seeded.push(created.user.id);
      const token = tokenOf(created.link.url);
      expect((await redeem(token, 'short')).status).toBe(400);
      expect((await redeem(token)).status).toBe(204);
      await expectError(await redeem(token), 400, 'LINK_INVALID');
      const cookie = await client.signIn(created.user.email ?? '');
      expect((await client.get('/api/users/skills', cookie)).status).toBe(200);
      const detail = userResponseSchema.parse(
        await (await client.get(`/api/users/${created.user.id}`, gm.cookie)).json(),
      );
      expect(detail.status).toBe('active');
      expect((await auditOf(created.user.id)).at(-1)).toMatchObject({
        action: 'user.password_set',
        actorId: created.user.id,
      });
    });

    it('keeps only the newest link working, and refuses expired ones', async () => {
      const user = await seed({ password: null });
      const first = userLinkSchema.parse(
        await (await client.post(`/api/users/${user.id}/link`, gm.cookie)).json(),
      );
      const second = userLinkSchema.parse(
        await (await client.post(`/api/users/${user.id}/link`, gm.cookie)).json(),
      );
      expect(second.kind).toBe('activation');
      await expectError(await redeem(tokenOf(first.url)), 400, 'LINK_INVALID');
      await db
        .update(verifications)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(
          and(like(verifications.identifier, 'user-link:%'), eq(verifications.value, user.id)),
        );
      await expectError(await redeem(tokenOf(second.url)), 400, 'LINK_INVALID');
    });

    it('resets an active user’s password and ends their sessions', async () => {
      const user = await seed();
      const cookie = await client.signIn(user.email);
      const link = userLinkSchema.parse(
        await (await client.post(`/api/users/${user.id}/link`, gm.cookie)).json(),
      );
      expect(link.kind).toBe('reset');
      expect((await redeem(tokenOf(link.url), `${PASSWORD}-reset`)).status).toBe(204);
      expect((await client.get('/api/users/skills', cookie)).status).toBe(401);
      expect(
        (await client.signIn(user.email, { password: `${PASSWORD}-reset` })).length,
      ).toBeGreaterThan(0);
    });
  });

  describe('access to management endpoints', () => {
    it('answers 401 without a session and 403 without users.manage', async () => {
      const target = await seed();
      const routes = [
        ['PATCH', `/api/users/${target.id}`],
        ['POST', `/api/users/${target.id}/link`],
        ['POST', `/api/users/${target.id}/archive`],
        ['POST', `/api/users/${target.id}/restore`],
        ['POST', `/api/users/${target.id}/two-factor/reset`],
      ] as const;
      for (const [method, path] of routes) {
        expect((await client.request(method, path, { body: {} })).status, path).toBe(401);
        const forbidden = await client.request(method, path, {
          cookie: employee.cookie,
          body: { title: 'x' },
        });
        expect(forbidden.status, path).toBe(403);
      }
    });
  });

  describe('update', () => {
    it('writes one audit entry per kind of change, with the changed fields only', async () => {
      const user = await seed({ roles: ['account_manager'] });
      const response = await patch(`/api/users/${user.id}`, gm.cookie, {
        name: `معدّل ${run}`,
        title: 'كاتب',
        roles: ['account_manager', 'finance'],
        secondaryDepartmentIds: [marketing],
      });
      expect(response.status).toBe(200);
      const audit = await auditOf(user.id);
      expect(audit.map((a) => a.action)).toEqual([
        'user.updated',
        'user.departments_changed',
        'user.roles_changed',
      ]);
      expect(audit[0]).toMatchObject({
        before: { name: `عضو ${run}`, title: null },
        after: { name: `معدّل ${run}`, title: 'كاتب' },
      });
      expect(audit[1]?.after).toMatchObject({
        primaryDepartment: { id: design },
        secondaryDepartments: [{ id: marketing }],
      });
      expect(audit[2]).toMatchObject({
        before: { roles: ['account_manager'] },
        after: { roles: ['account_manager', 'finance'] },
      });
    });

    it('applies role and department changes to open sessions at once', async () => {
      const user = await seed();
      const cookie = await client.signIn(user.email);
      await patch(`/api/users/${user.id}`, gm.cookie, { roles: ['finance'] });
      // Finance must use 2FA (F01 edge case 3).
      await expectError(await client.get('/api/users/skills', cookie), 403, 'TWO_FACTOR_REQUIRED');
      const me = meResponseSchema.parse(await (await client.get('/api/me', cookie)).json());
      expect(me.roles).toContain('finance');
    });

    it('keeps sessions and password when a user manager changes the email', async () => {
      const user = await seed();
      const cookie = await client.signIn(user.email);
      const email = uniqueEmail('moved');
      expect((await patch(`/api/users/${user.id}`, gm.cookie, { email })).status).toBe(200);
      expect((await client.get('/api/users/skills', cookie)).status).toBe(200);
      expect((await client.signIn(email)).length).toBeGreaterThan(0);
      await expectError(
        await patch(`/api/users/${user.id}`, gm.cookie, { email: gm.email }),
        409,
        'EMAIL_TAKEN',
      );
    });

    it('keeps a manager in the department they manage', async () => {
      const user = await seed({
        departments: [{ code: 'design' }, { code: 'photography', manager: true }],
      });
      const body = await expectError(
        await patch(`/api/users/${user.id}`, gm.cookie, { secondaryDepartmentIds: [] }),
        409,
        'MANAGER_MEMBERSHIP_REQUIRED',
      );
      expect(body.details).toMatchObject([{ type: 'manages_department' }]);
      await db
        .update(departments)
        .set({ managerId: null })
        .where(eq(departments.managerId, user.id));
    });

    it('moves the primary department; the old one stays only if listed as secondary', async () => {
      const user = await seed({ departments: [{ code: 'design' }, { code: 'marketing' }] });
      const moved = userResponseSchema.parse(
        await (
          await patch(`/api/users/${user.id}`, gm.cookie, { primaryDepartmentId: marketing })
        ).json(),
      );
      expect(moved.departments.map((d) => [d.id, d.isPrimary])).toEqual([[marketing, true]]);
      const swapped = userResponseSchema.parse(
        await (
          await patch(`/api/users/${user.id}`, gm.cookie, {
            primaryDepartmentId: design,
            secondaryDepartmentIds: [marketing],
          })
        ).json(),
      );
      expect(swapped.departments.map((d) => [d.id, d.isPrimary])).toEqual([
        [design, true],
        [marketing, false],
      ]);
    });

    it('asks accounts created before F01 for a primary department', async () => {
      const user = await seed({ departments: [] });
      await expectError(
        await patch(`/api/users/${user.id}`, gm.cookie, { title: 'x' }),
        400,
        'PRIMARY_DEPARTMENT_REQUIRED',
      );
      expect(
        (await patch(`/api/users/${user.id}`, gm.cookie, { primaryDepartmentId: design })).status,
      ).toBe(200);
    });

    it('lets only a General Manager change a General Manager (rule 5)', async () => {
      const other = await seed({ roles: ['general_manager'] });
      for (const [method, path] of [
        ['PATCH', `/api/users/${other.id}`],
        ['POST', `/api/users/${other.id}/link`],
        ['POST', `/api/users/${other.id}/archive`],
        ['POST', `/api/users/${other.id}/two-factor/reset`],
      ] as const) {
        const response = await client.request(method, path, {
          cookie: operations.cookie,
          body: { title: 'x' },
        });
        await expectError(response, 403, 'GENERAL_MANAGER_ONLY');
      }
      const archivedManager = await seed({ roles: ['general_manager'], archived: true });
      await expectError(
        await client.post(`/api/users/${archivedManager.id}/restore`, operations.cookie),
        403,
        'GENERAL_MANAGER_ONLY',
      );
      await db.delete(userRoles).where(eq(userRoles.userId, archivedManager.id));
      const plain = await seed();
      await expectError(
        await patch(`/api/users/${plain.id}`, operations.cookie, { roles: ['general_manager'] }),
        403,
        'GENERAL_MANAGER_ONLY',
      );
      expect(
        (await patch(`/api/users/${plain.id}`, gm.cookie, { roles: ['general_manager'] })).status,
      ).toBe(200);
      expect((await patch(`/api/users/${plain.id}`, gm.cookie, { roles: [] })).status).toBe(200);
      await db.delete(userRoles).where(eq(userRoles.userId, other.id));
    });

    it('lets only a General Manager grant or remove Finance (rule 5)', async () => {
      const plain = await seed();
      await expectError(
        await patch(`/api/users/${plain.id}`, operations.cookie, { roles: ['finance'] }),
        403,
        'GENERAL_MANAGER_ONLY',
      );
      await expectError(
        await client.post('/api/users', operations.cookie, {
          name: 'مالية',
          email: uniqueEmail('finance'),
          primaryDepartmentId: design,
          roles: ['finance'],
        }),
        403,
        'GENERAL_MANAGER_ONLY',
      );
      expect(
        (await patch(`/api/users/${plain.id}`, gm.cookie, { roles: ['finance'] })).status,
      ).toBe(200);
      await expectError(
        await patch(`/api/users/${plain.id}`, operations.cookie, { roles: [] }),
        403,
        'GENERAL_MANAGER_ONLY',
      );
      expect((await patch(`/api/users/${plain.id}`, gm.cookie, { roles: [] })).status).toBe(200);
    });

    it('refuses changes to the actor’s own roles (rule 5)', async () => {
      await expectError(
        await patch(`/api/users/${operations.id}`, operations.cookie, {
          roles: ['account_manager'],
        }),
        403,
        'CANNOT_CHANGE_OWN_ROLES',
      );
      // Unchanged roles are not a change: the rest of the own record still saves.
      expect(
        (await patch(`/api/users/${gm.id}`, gm.cookie, { roles: ['general_manager'] })).status,
      ).toBe(200);
    });

    it('keeps the last active General Manager (rule 6)', async () => {
      const activeGeneralManagers = await db
        .select({ id: users.id })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(userRoles.role, 'general_manager'), isNull(users.archivedAt)));
      // Only `gm` may be an active General Manager here, or the rule cannot apply.
      expect(activeGeneralManagers.map((row) => row.id)).toEqual([gm.id]);
      // Only another General Manager may remove the role (rule 5), who is then an active one:
      // removing the last one's role is refused before the rule is reached.
      await expectError(
        await patch(`/api/users/${gm.id}`, gm.cookie, { roles: [] }),
        403,
        'CANNOT_CHANGE_OWN_ROLES',
      );
    });

    it('lets a General Manager archive another one while an active one remains', async () => {
      // Archiving the last active General Manager needs another General Manager as the actor,
      // who is then an active one: the check can only fire under a race, which the lock prevents.
      const second = await seed({ roles: ['general_manager'] });
      const archived = userResponseSchema.parse(
        await (await client.post(`/api/users/${second.id}/archive`, gm.cookie)).json(),
      );
      expect(archived.status).toBe('archived');
      await db.delete(userRoles).where(eq(userRoles.userId, second.id));
    });

    it('edits only phone and skills on the own account', async () => {
      const response = await patch('/api/me/profile', employee.cookie, {
        phone: '0096 3944 222 333',
        skills: ['Illustrator'],
        name: 'ignored',
      });
      expect(response.status).toBe(200);
      const user = userResponseSchema.parse(await response.json());
      expect(user).toMatchObject({ phone: '+963944222333', skills: ['Illustrator'] });
      expect(user.name).not.toBe('ignored');
      expect((await auditOf(employee.id)).at(-1)).toMatchObject({
        action: 'user.profile_updated',
        actorId: employee.id,
        after: { phone: '+963944222333', skills: ['Illustrator'] },
      });
      expect((await client.request('PATCH', '/api/me/profile', { body: {} })).status).toBe(401);
    });
  });

  describe('archive, restore and 2FA reset', () => {
    it('refuses to archive oneself', async () => {
      await expectError(
        await client.post(`/api/users/${operations.id}/archive`, operations.cookie),
        409,
        'CANNOT_ARCHIVE_SELF',
      );
    });

    it('refuses while the user manages a department, then archives and signs them out', async () => {
      const user = await seed({ departments: [{ code: 'photography', manager: true }] });
      const cookie = await client.signIn(user.email);
      const body = await expectError(
        await client.post(`/api/users/${user.id}/archive`, gm.cookie),
        409,
        'USER_HAS_RESPONSIBILITIES',
      );
      expect(body.details).toEqual([
        {
          type: 'manages_department',
          id: await departmentId(db, 'photography'),
          name: expect.any(String),
        },
      ]);
      const photography = await departmentId(db, 'photography');
      expect(
        (await patch(`/api/departments/${photography}`, gm.cookie, { managerId: null })).status,
      ).toBe(200);
      const archived = userResponseSchema.parse(
        await (await client.post(`/api/users/${user.id}/archive`, gm.cookie)).json(),
      );
      expect(archived.status).toBe('archived');
      expect((await client.get('/api/users/skills', cookie)).status).toBe(401);
      const signIn = await client.request('POST', '/api/auth/sign-in/email', {
        body: { email: user.email, password: PASSWORD },
      });
      expect(signIn.status).toBe(401);
      // Archived users keep their email reserved and hide it from the directory.
      const seen = userResponseSchema.parse(
        await (await client.get(`/api/users/${user.id}`, employee.cookie)).json(),
      );
      expect(seen.email).toBeNull();
      await expectError(
        await patch(`/api/users/${user.id}`, gm.cookie, { title: 'x' }),
        409,
        'USER_ARCHIVED',
      );
      await expectError(
        await client.post(`/api/users/${user.id}/link`, gm.cookie),
        409,
        'USER_ARCHIVED',
      );
      expect((await auditOf(user.id)).at(-1)).toMatchObject({
        action: 'user.archived',
        before: { status: 'active' },
        after: { status: 'archived' },
      });
    });

    it('invalidates pending links on archive', async () => {
      const user = await seed({ password: null });
      const link = userLinkSchema.parse(
        await (await client.post(`/api/users/${user.id}/link`, gm.cookie)).json(),
      );
      expect((await client.post(`/api/users/${user.id}/archive`, gm.cookie)).status).toBe(200);
      await expectError(await redeem(tokenOf(link.url)), 400, 'LINK_INVALID');
    });

    it('restores an archived user as invited with a new link, keeping roles and departments', async () => {
      const user = await seed({ roles: ['finance'], departments: [{ code: 'design' }] });
      await client.post(`/api/users/${user.id}/archive`, gm.cookie);
      const restored = userWithLinkResponseSchema.parse(
        await (await client.post(`/api/users/${user.id}/restore`, gm.cookie)).json(),
      );
      expect(restored.user).toMatchObject({ status: 'invited', roles: ['finance'] });
      expect(restored.user.departments.map((d) => d.id)).toEqual([design]);
      expect(restored.link.kind).toBe('activation');
      const signIn = await client.request('POST', '/api/auth/sign-in/email', {
        body: { email: user.email, password: PASSWORD },
      });
      expect(signIn.status).toBe(401);
      await expectError(
        await client.post(`/api/users/${user.id}/restore`, gm.cookie),
        409,
        'USER_NOT_ARCHIVED',
      );
    });

    it('resets 2FA of a user who lost their device', async () => {
      const user = await client.signInWithTwoFactor(db, { name: `ثنائي ${run}` });
      seeded.push(user.id);
      const reset = userResponseSchema.parse(
        await (
          await client.post(`/api/users/${user.id}/two-factor/reset`, operations.cookie)
        ).json(),
      );
      expect(reset.twoFactorEnabled).toBe(false);
      expect((await auditOf(user.id)).at(-1)).toMatchObject({
        action: 'user.two_factor_reset',
        actorId: operations.id,
      });
      expect(
        (await client.post(`/api/users/${user.id}/two-factor/reset`, employee.cookie)).status,
      ).toBe(403);
    });
  });
  describe('account manager responsibilities (F02 rule 8)', () => {
    const createClient = async (accountManagerId: string, status = 'active') => {
      const response = await client.post('/api/clients', gm.cookie, {
        tradeName: `عميل ${run} ${randomUUID().slice(0, 6)}`,
        accountManagerId,
        status,
      });
      expect(response.status).toBe(201);
      const created = clientDetailResponseSchema.parse(await response.json());
      seededClients.push(created.id);
      return created;
    };

    it('refuses to archive the manager of an active or paused client, listing it', async () => {
      const user = await seed({ roles: ['account_manager'] });
      const active = await createClient(user.id);
      const paused = await createClient(user.id, 'paused');
      await createClient(user.id, 'ended');
      const body = await expectError(
        await client.post(`/api/users/${user.id}/archive`, operations.cookie),
        409,
        'USER_HAS_RESPONSIBILITIES',
      );
      expect(body.details).toEqual(
        [active, paused]
          .sort((a, b) => a.tradeName.localeCompare(b.tradeName))
          .map((c) => ({ type: 'account_manager_of_client', id: c.id, name: c.tradeName })),
      );
      const other = await seed({ roles: ['account_manager'] });
      for (const { id } of [active, paused]) {
        expect(
          (await patch(`/api/clients/${id}`, gm.cookie, { accountManagerId: other.id })).status,
        ).toBe(200);
      }
      // Ended clients do not block.
      expect((await client.post(`/api/users/${user.id}/archive`, operations.cookie)).status).toBe(
        200,
      );
    });

    it('refuses to remove the Account Manager role while it is needed', async () => {
      const user = await seed({ roles: ['account_manager', 'finance'] });
      const managed = await createClient(user.id);
      const body = await expectError(
        await patch(`/api/users/${user.id}`, gm.cookie, { roles: ['finance'] }),
        409,
        'USER_HAS_RESPONSIBILITIES',
      );
      expect(body.details).toEqual([
        { type: 'account_manager_of_client', id: managed.id, name: managed.tradeName },
      ]);
      const [roles] = await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(and(eq(userRoles.userId, user.id), eq(userRoles.role, 'account_manager')));
      expect(roles).toBeDefined();
      // Other role changes go through.
      expect(
        (await patch(`/api/users/${user.id}`, gm.cookie, { roles: ['account_manager'] })).status,
      ).toBe(200);
      expect(
        (await patch(`/api/clients/${managed.id}`, gm.cookie, { status: 'ended' })).status,
      ).toBe(200);
      expect((await patch(`/api/users/${user.id}`, gm.cookie, { roles: [] })).status).toBe(200);
    });
  });

  describe('project manager responsibilities (F05 rule 4)', () => {
    it('refuses to archive the manager of an open project, listing it', async () => {
      const manager = await seed();
      const other = await seed();
      const response = await client.post('/api/clients', gm.cookie, {
        tradeName: `عميل ${run} ${randomUUID().slice(0, 6)}`,
        accountManagerId: (await seed({ roles: ['account_manager'] })).id,
      });
      const { id: clientId } = clientDetailResponseSchema.parse(await response.json());
      seededClients.push(clientId);
      const createProject = async (name: string) => {
        const created = await client.post('/api/projects', gm.cookie, {
          clientId,
          name: `${name} ${run}`,
          projectManagerId: manager.id,
          departments: ['design'],
          startDate: '2026-10-01',
          dueDate: '2099-12-31',
        });
        expect(created.status).toBe(201);
        return projectDetailSchema.parse(await created.json());
      };
      const open = await createProject('Open');
      const cancelled = await createProject('Cancelled');
      await client.post(`/api/projects/${cancelled.id}/status`, gm.cookie, {
        status: 'cancelled',
        reason: 'Stopped',
      });
      const body = await expectError(
        await client.post(`/api/users/${manager.id}/archive`, operations.cookie),
        409,
        'USER_HAS_RESPONSIBILITIES',
      );
      expect(body.details).toEqual([
        { type: 'project_manager_of_project', id: open.id, name: open.name },
      ]);
      expect(
        (await patch(`/api/projects/${open.id}`, gm.cookie, { projectManagerId: other.id })).status,
      ).toBe(200);
      // Completed and cancelled projects do not block.
      expect(
        (await client.post(`/api/users/${manager.id}/archive`, operations.cookie)).status,
      ).toBe(200);
    });
  });

  // Last: archiving a General Manager ends their sessions, which the tests above use.
  describe('concurrency', () => {
    it('always keeps an active General Manager when two archive each other at once (rule 6)', async () => {
      const second = await client.signInWithTwoFactor(db, {
        roles: ['general_manager'],
        departments: [{ code: 'general_management' }],
      });
      seeded.push(second.id);
      const [first, other] = await Promise.all([
        client.post(`/api/users/${second.id}/archive`, gm.cookie),
        client.post(`/api/users/${gm.id}/archive`, second.cookie),
      ]);
      // The access-change lock serializes them: the second sees the first's result.
      expect([first.status, other.status].filter((status) => status === 200)).toHaveLength(1);
      const active = await db
        .select({ id: users.id })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(userRoles.role, 'general_manager'), isNull(users.archivedAt)));
      expect(active).toHaveLength(1);
      await db.delete(userRoles).where(eq(userRoles.userId, second.id));
    });
  });
});
