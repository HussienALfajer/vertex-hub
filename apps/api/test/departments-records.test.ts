import type { INestApplication } from '@nestjs/common';
import {
  businessDate,
  catalogServiceSchema,
  departmentListResponseSchema,
  type ErrorResponse,
  taskDetailSchema,
  templateDetailSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, departments } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserDirectory } from '../src/modules/auth/index.js';
import { seedClientCast } from './client-cast.js';
import {
  api,
  removeCatalog,
  removeTasks,
  removeTemplates,
  removeUsers,
  seedUser,
  textDoc,
} from './helpers.js';
import { startApp } from './start-app.js';

/** F23 PR 1 (ADR 0043): departments as records, the archived checks and rule 14. */
describe('departments as records', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const taskIds: string[] = [];
  const templateIds: string[] = [];
  const serviceIds: string[] = [];
  const marker = `f23-${crypto.randomUUID().slice(0, 8)}`;
  const archivedCode = `d_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const unknownCode = 'd_unknown0';
  let archivedId: string;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let clientId: string;
  let employee: { id: string; cookie: string };

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status, await response.clone().text()).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  /** A write refused for an archived department and for an unknown one. */
  async function expectRefused(send: (department: string) => Promise<Response>) {
    await expectError(await send(archivedCode), 409, 'DEPARTMENT_ARCHIVED');
    await expectError(await send(unknownCode), 400, 'UNKNOWN_DEPARTMENT');
  }

  const patch = (path: string, body: unknown) =>
    client.request('PATCH', path, { cookie: cast.gm.cookie, body });

  async function createTask(): Promise<string> {
    const created = await client.post('/api/tasks', cast.gm.cookie, {
      title: `${marker} مهمة`,
      department: 'design',
      dueDate: '2099-01-01',
    });
    expect(created.status).toBe(201);
    const task = taskDetailSchema.parse(await created.json());
    taskIds.push(task.id);
    return task.id;
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
    cast = await seedClientCast(db, client);
    clientId = (await cast.createClient()).id;
    const member = await seedUser(db, { departments: [{ code: 'design' }] });
    seeded.push(member.id);
    employee = { id: member.id, cookie: await client.signIn(member.email) };
  });

  afterAll(async () => {
    await app?.close();
    await removeTasks(db, taskIds);
    await removeTemplates(db, templateIds);
    await removeCatalog(db, serviceIds, []);
    await cast?.cleanup();
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

  describe('writes refuse archived and unknown departments (rule 5)', () => {
    it('tasks: create, change of department, subtask and question', async () => {
      await expectRefused((department) =>
        client.post('/api/tasks', cast.gm.cookie, {
          title: `${marker} مهمة`,
          department,
          dueDate: '2099-01-01',
        }),
      );
      const taskId = await createTask();
      await expectRefused((department) => patch(`/api/tasks/${taskId}`, { department }));
      await expectRefused((department) =>
        client.post(`/api/tasks/${taskId}/subtasks`, cast.gm.cookie, {
          title: `${marker} فرعية`,
          department,
          dueDate: '2099-01-01',
        }),
      );
      await expectRefused((department) =>
        client.post(`/api/tasks/${taskId}/questions`, cast.gm.cookie, {
          bodyDoc: textDoc('سؤال؟'),
          addressedDepartment: department,
        }),
      );
    });

    it('catalog services: create and a change of department', async () => {
      const service = (department: string) => ({
        name: `${marker} خدمة ${crypto.randomUUID().slice(0, 6)}`,
        department,
        billing: 'one_off',
        priceUsdMinor: 1000,
      });
      await expectRefused((department) =>
        client.post('/api/catalog/services', cast.gm.cookie, service(department)),
      );
      const created = await client.post('/api/catalog/services', cast.gm.cookie, service('design'));
      expect(created.status).toBe(201);
      const { id } = catalogServiceSchema.parse(await created.json());
      serviceIds.push(id);
      await expectRefused((department) => patch(`/api/catalog/services/${id}`, { department }));
    });

    it('projects and retainers: create, and adding a department', async () => {
      await expectRefused((department) =>
        client.post('/api/projects', cast.gm.cookie, {
          clientId,
          name: `${marker} مشروع ${crypto.randomUUID().slice(0, 6)}`,
          projectManagerId: cast.employee.id,
          departments: ['design', department],
          startDate: '2026-10-01',
          dueDate: '2099-12-31',
        }),
      );
      const project = await cast.createProject(clientId);
      await expectRefused((department) =>
        patch(`/api/projects/${project.id}`, { departments: ['design', department] }),
      );

      await expectRefused((department) =>
        client.post('/api/retainers', cast.gm.cookie, {
          clientId,
          name: `${marker} عقد ${crypto.randomUUID().slice(0, 6)}`,
          departments: [department],
          startDate: businessDate(),
          deliverables: [{ kind: 'design', monthlyQuantity: 4 }],
        }),
      );
      const retainer = await cast.createRetainer(clientId);
      await expectRefused((department) =>
        patch(`/api/retainers/${retainer.id}`, { departments: ['design', department] }),
      );
    });

    it('templates: a step in a new department', async () => {
      const template = (department: string) => ({
        name: `${marker} قالب ${crypto.randomUUID().slice(0, 6)}`,
        kind: 'project',
        stages: [],
        steps: [{ key: 'a', title: 'خطوة', department, dueDay: 1 }],
        assignees: [],
      });
      await expectRefused((department) =>
        client.post('/api/templates', cast.gm.cookie, template(department)),
      );
      const created = await client.post('/api/templates', cast.gm.cookie, template('design'));
      expect(created.status).toBe(201);
      templateIds.push(templateDetailSchema.parse(await created.json()).id);
    });

    it('announcements: an audience naming the department', async () => {
      await expectRefused((department) =>
        client.post('/api/announcements', cast.gm.cookie, {
          title: `${marker} إعلان`,
          body: textDoc('نص'),
          priority: 'normal',
          requiresAck: false,
          audience: { departments: [department] },
          send: 'draft',
        }),
      );
    });

    it('the department itself and joining it', async () => {
      await expectError(
        await patch(`/api/departments/${archivedId}`, { name: `${marker} جديد` }),
        409,
        'DEPARTMENT_ARCHIVED',
      );
      await expectError(
        await patch(`/api/users/${employee.id}`, { secondaryDepartmentIds: [archivedId] }),
        409,
        'DEPARTMENT_ARCHIVED',
      );
    });
  });

  it('accepts an archived department in a filter and refuses an unknown one', async () => {
    for (const path of [
      '/api/tasks?department=',
      '/api/tasks/board?department=',
      '/api/tasks/workload?department=',
      '/api/projects?department=',
      '/api/retainers?department=',
      '/api/catalog/services?department=',
    ]) {
      const archived = await client.get(`${path}${archivedCode}`, cast.gm.cookie);
      expect(archived.status, path).toBe(200);
      await expectError(
        await client.get(`${path}${unknownCode}`, cast.gm.cookie),
        400,
        'UNKNOWN_DEPARTMENT',
      );
    }
  });

  it('sends an archived department’s notices to the General Managers (rule 14)', async () => {
    const users = app.get(UserDirectory);
    const managers = await users.functionManagers([archivedCode, 'design']);
    expect(managers.get(archivedCode)).toContain(cast.gm.id);
    expect(managers.get('design') ?? []).not.toContain(cast.gm.id);
    const members = await users.functionMembers([archivedCode]);
    expect(members.find((member) => member.id === cast.gm.id)?.departments).toEqual([archivedCode]);
    expect(members.every((member) => member.id !== employee.id)).toBe(true);
    // An active department keeps its own people.
    const design = await users.functionMembers(['design']);
    expect(design.some((member) => member.id === employee.id)).toBe(true);
    const marketing = await users.functionMembers(['marketing']);
    expect(marketing.some((member) => member.id === cast.gm.id)).toBe(false);
  });

  it('keeps an archived department out of the default lists', async () => {
    const users = app.get(UserDirectory);
    expect(await users.activeDepartmentCodes()).not.toContain(archivedCode);
    expect((await users.orderedDepartments()).at(-1)?.archived).toBe(true);
  });
});
