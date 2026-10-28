import type { INestApplication } from '@nestjs/common';
import {
  departmentListResponseSchema,
  type ErrorResponse,
  taskDetailSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, departments } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserDirectory } from '../src/modules/auth/index.js';
import { api, removeTasks, removeUsers, seedUser, textDoc } from './helpers.js';
import { startApp } from './start-app.js';

type SignedIn = Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;

/** F23 PR 1 (ADR 0043): departments as records, the archived checks and rule 14. */
describe('departments as records', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const taskIds: string[] = [];
  const marker = `f23-${crypto.randomUUID().slice(0, 8)}`;
  const archivedCode = `d_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let archivedId: string;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: SignedIn;
  let employee: { id: string; cookie: string };

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    const [archived] = await db
      .insert(departments)
      .values({
        code: archivedCode,
        name: `${marker} مؤرشف`,
        color: 'c4',
        icon: 'film',
        position: 99,
        archivedAt: new Date(),
      })
      .returning({ id: departments.id });
    archivedId = archived?.id ?? '';
    gm = await client.signInWithTwoFactor(db, {
      roles: ['general_manager'],
      departments: [{ code: 'general_management' }],
    });
    const member = await seedUser(db, { departments: [{ code: 'design' }] });
    seeded.push(gm.id, member.id);
    employee = { id: member.id, cookie: await client.signIn(member.email) };
  });

  afterAll(async () => {
    await app?.close();
    await removeTasks(db, taskIds);
    await removeUsers(db, seeded);
    await db.delete(auditEntries).where(eq(auditEntries.entityId, archivedId));
    await db.delete(departments).where(eq(departments.id, archivedId));
    await connection.close();
  });

  it('lists departments with their identity, active ones in order, then archived ones', async () => {
    const response = await client.get('/api/departments', employee.cookie);
    expect(response.status).toBe(200);
    const { items } = departmentListResponseSchema.parse(await response.json());
    const active = items.filter((item) => !item.archivedAt);
    expect(active.map((item) => item.position)).toEqual(
      [...active.map((item) => item.position)].sort((a, b) => a - b),
    );
    expect(items.findIndex((item) => item.code === archivedCode)).toBeGreaterThanOrEqual(
      active.length,
    );
    expect(items.find((item) => item.code === 'design')).toMatchObject({
      color: 'c5',
      icon: 'palette',
      description: null,
      archivedAt: null,
    });
  });

  it('refuses a task in an archived or unknown department, and accepts an active one', async () => {
    const body = (department: string) => ({
      title: `${marker} مهمة`,
      department,
      dueDate: '2099-01-01',
    });
    await expectError(
      await client.post('/api/tasks', gm.cookie, body(archivedCode)),
      409,
      'DEPARTMENT_ARCHIVED',
    );
    await expectError(
      await client.post('/api/tasks', gm.cookie, body('d_unknown0')),
      400,
      'UNKNOWN_DEPARTMENT',
    );
    const created = await client.post('/api/tasks', gm.cookie, body('design'));
    expect(created.status).toBe(201);
    const task = taskDetailSchema.parse(await created.json());
    taskIds.push(task.id);

    await expectError(
      await client.request('PATCH', `/api/tasks/${task.id}`, {
        cookie: gm.cookie,
        body: { department: archivedCode },
      }),
      409,
      'DEPARTMENT_ARCHIVED',
    );
    await expectError(
      await client.post(`/api/tasks/${task.id}/questions`, gm.cookie, {
        bodyDoc: textDoc('سؤال؟'),
        addressedDepartment: archivedCode,
      }),
      409,
      'DEPARTMENT_ARCHIVED',
    );
  });

  it('accepts an archived department in a filter', async () => {
    const list = await client.get(`/api/tasks?department=${archivedCode}`, gm.cookie);
    expect(list.status).toBe(200);
    const board = await client.get(`/api/tasks/board?department=${archivedCode}`, gm.cookie);
    expect(board.status).toBe(200);
  });

  it('refuses a catalog service in an archived department', async () => {
    await expectError(
      await client.post('/api/catalog/services', gm.cookie, {
        name: `${marker} خدمة`,
        department: archivedCode,
        billing: 'one_off',
        priceUsdMinor: 1000,
      }),
      409,
      'DEPARTMENT_ARCHIVED',
    );
  });

  it('refuses edits to an archived department and joining it', async () => {
    await expectError(
      await client.request('PATCH', `/api/departments/${archivedId}`, {
        cookie: gm.cookie,
        body: { name: `${marker} جديد` },
      }),
      409,
      'DEPARTMENT_ARCHIVED',
    );
    await expectError(
      await client.request('PATCH', `/api/users/${employee.id}`, {
        cookie: gm.cookie,
        body: { secondaryDepartmentIds: [archivedId] },
      }),
      409,
      'DEPARTMENT_ARCHIVED',
    );
  });

  it('sends an archived department’s notices to the General Managers (rule 14)', async () => {
    const users = app.get(UserDirectory);
    const managers = await users.functionManagers([archivedCode, 'design']);
    expect(managers.get(archivedCode)).toContain(gm.id);
    expect(managers.get('design') ?? []).not.toContain(gm.id);
    const members = await users.functionMembers([archivedCode]);
    expect(members.find((member) => member.id === gm.id)?.departments).toEqual([archivedCode]);
    expect(members.every((member) => member.id !== employee.id)).toBe(true);
    // An active department keeps its own people.
    const design = await users.functionMembers(['design']);
    expect(design.some((member) => member.id === employee.id)).toBe(true);
    expect(design.some((member) => member.id === gm.id)).toBe(false);
  });

  it('keeps an archived department out of the default lists', async () => {
    const users = app.get(UserDirectory);
    expect(await users.activeDepartmentCodes()).not.toContain(archivedCode);
    const ordered = await users.orderedDepartments();
    expect(ordered.find((row) => row.code === archivedCode)).toEqual({
      code: archivedCode,
      archived: true,
    });
    const rows = await db
      .select({ code: departments.code })
      .from(departments)
      .where(inArray(departments.code, [archivedCode]));
    expect(rows).toHaveLength(1);
  });
});
