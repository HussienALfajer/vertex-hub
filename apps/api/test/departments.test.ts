import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  departmentDetailResponseSchema,
  departmentListResponseSchema,
  type ErrorResponse,
  meResponseSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, departments } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, departmentId, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type SignedIn = Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;

describe('departments', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let operations: SignedIn;
  let employee: { id: string; cookie: string };
  let photography: string;
  let originalName: string;

  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/departments/${id}`, { cookie, body });

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    photography = await departmentId(db, 'photography');
    const [department] = await db
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.id, photography));
    originalName = department?.name ?? '';
    operations = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'internal_operations', manager: true }],
    });
    const member = await seedUser(db, { departments: [{ code: 'photography' }] });
    seeded.push(operations.id, member.id);
    employee = { id: member.id, cookie: await client.signIn(member.email) };
  });

  afterAll(async () => {
    await app?.close();
    await db
      .update(departments)
      .set({ name: originalName, managerId: null })
      .where(eq(departments.id, photography));
    await db.delete(auditEntries).where(eq(auditEntries.entityId, photography));
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('requires a session', async () => {
    expect((await client.get('/api/departments')).status).toBe(401);
    expect((await client.get(`/api/departments/${photography}`)).status).toBe(401);
    expect((await patch(photography, undefined, { name: 'x' })).status).toBe(401);
  });

  it('lists the ten departments to every employee, with manager and member count', async () => {
    const response = await client.get('/api/departments', employee.cookie);
    const { items } = departmentListResponseSchema.parse(await response.json());
    expect(items.map((d) => d.code)).toEqual([
      'general_management',
      'internal_operations',
      'public_relations',
      'marketing',
      'design',
      'photography',
      'content_management',
      'development',
      'general_communication',
      'medical_consultation',
    ]);
    expect(items.find((d) => d.code === 'internal_operations')?.manager).toEqual({
      id: operations.id,
      name: operations.name,
    });
    expect(items.find((d) => d.code === 'photography')?.memberCount).toBeGreaterThanOrEqual(1);
  });

  it('shows a department with its members, primary members first', async () => {
    const secondary = await seedUser(db, {
      departments: [{ code: 'design' }, { code: 'photography' }],
    });
    const invited = await seedUser(db, { password: null, departments: [{ code: 'photography' }] });
    seeded.push(secondary.id, invited.id);
    const response = await client.get(`/api/departments/${photography}`, employee.cookie);
    const detail = departmentDetailResponseSchema.parse(await response.json());
    const members = detail.members.filter((m) =>
      [employee.id, secondary.id, invited.id].includes(m.id),
    );
    expect(members.find((m) => m.id === secondary.id)).toMatchObject({ isPrimary: false });
    // Invited or active is for user managers only.
    expect(members.find((m) => m.id === invited.id)).not.toHaveProperty('status');
    const managed = departmentDetailResponseSchema.parse(
      await (await client.get(`/api/departments/${photography}`, operations.cookie)).json(),
    );
    expect(managed.members.find((m) => m.id === invited.id)).toMatchObject({ status: 'invited' });
    const firstSecondary = detail.members.findIndex((m) => !m.isPrimary);
    expect(detail.members.slice(firstSecondary).every((m) => !m.isPrimary)).toBe(true);
    expect((await client.get(`/api/departments/${randomUUID()}`, employee.cookie)).status).toBe(
      404,
    );
  });

  it('is changed by user managers only', async () => {
    expect((await patch(photography, employee.cookie, { name: 'x' })).status).toBe(403);
  });

  it('renames a department, audited, and keeps names unique', async () => {
    const name = `التصوير ${randomUUID().slice(0, 6)}`;
    const response = await patch(photography, operations.cookie, { name });
    expect(response.status).toBe(200);
    expect(departmentDetailResponseSchema.parse(await response.json()).name).toBe(name);
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, photography))
      .orderBy(auditEntries.id);
    expect(entry).toMatchObject({
      action: 'department.updated',
      actorId: operations.id,
      before: { name: originalName },
      after: { name },
    });
    const [design] = await db
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.code, 'design'));
    await expectError(
      await patch(photography, operations.cookie, { name: design?.name }),
      409,
      'DEPARTMENT_NAME_TAKEN',
    );
  });

  it('accepts only an active member as manager', async () => {
    const outsider = await seedUser(db, { departments: [{ code: 'design' }] });
    const invited = await seedUser(db, { password: null, departments: [{ code: 'photography' }] });
    seeded.push(outsider.id, invited.id);
    for (const managerId of [outsider.id, invited.id, randomUUID()]) {
      await expectError(
        await patch(photography, operations.cookie, { managerId }),
        400,
        'MANAGER_NOT_MEMBER',
      );
    }
  });

  it('makes a member Department Manager at once, and takes it back with "no manager"', async () => {
    const response = await patch(photography, operations.cookie, { managerId: employee.id });
    expect(response.status).toBe(200);
    expect(departmentDetailResponseSchema.parse(await response.json()).manager?.id).toBe(
      employee.id,
    );
    const me = async () =>
      meResponseSchema.parse(await (await client.get('/api/me', employee.cookie)).json());
    expect((await me()).roles).toContain('department_manager');
    expect((await me()).departments[0]).toMatchObject({ isManager: true });

    expect((await patch(photography, operations.cookie, { managerId: null })).status).toBe(200);
    expect((await me()).roles).not.toContain('department_manager');
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, photography))
      .orderBy(auditEntries.occurredAt)
      .limit(1)
      .offset(1);
    expect(entry).toMatchObject({
      before: { manager: null },
      after: { manager: { id: employee.id } },
    });
  });

  it('moves the Operations manager’s capabilities with the manager change', async () => {
    const internalOperations = await departmentId(db, 'internal_operations');
    const successor = await seedUser(db, { departments: [{ code: 'internal_operations' }] });
    seeded.push(successor.id);
    const successorCookie = await client.signIn(successor.email);
    expect(
      (await patch(internalOperations, operations.cookie, { managerId: successor.id })).status,
    ).toBe(200);
    // The former manager loses user management at once; the new one must set up 2FA first.
    expect((await client.get('/api/audit', operations.cookie)).status).toBe(403);
    const blocked = await client.get('/api/audit', successorCookie);
    expect(((await blocked.json()) as ErrorResponse).code).toBe('TWO_FACTOR_REQUIRED');
    await db
      .update(departments)
      .set({ managerId: operations.id })
      .where(eq(departments.id, internalOperations));
  });
});
