import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  catalogServiceSchema,
  type DepartmentDetailResponse,
  departmentArchivePreviewSchema,
  departmentDetailResponseSchema,
  departmentListResponseSchema,
  departmentOverviewSchema,
  type ErrorResponse,
  taskDetailSchema,
  templateDetailSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  catalogServices,
  createDatabase,
  departmentMembers,
  departments,
  notifications,
  projects,
  quoteLines,
  quotes,
  retainers,
  taskComments,
  tasks,
  workTemplateAssignees,
  workTemplateSteps,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedClientCast } from './client-cast.js';
import {
  api,
  removeCatalog,
  removeTasks,
  removeTemplates,
  removeUsers,
  seedUser,
} from './helpers.js';
import { startApp } from './start-app.js';

type SignedIn = Awaited<ReturnType<ReturnType<typeof api>['signInWithTwoFactor']>>;

/** F23 PR 2: creating, editing, ordering, members, overview, archiving and restoring. */
describe('departments management', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const created: string[] = [];
  const taskIds: string[] = [];
  const templateIds: string[] = [];
  const serviceIds: string[] = [];
  const marker = `f23m-${randomUUID().slice(0, 8)}`;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let operations: SignedIn;
  let employee: { id: string; cookie: string };

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status, await response.clone().text()).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  /** A new department, created by the General Manager. */
  async function createDepartment(label: string): Promise<DepartmentDetailResponse> {
    const response = await client.post('/api/departments', cast.gm.cookie, {
      name: `${marker} ${label}`,
      description: `${label} description`,
      color: 'c3',
      icon: 'film',
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const department = departmentDetailResponseSchema.parse(await response.json());
    created.push(department.id);
    return department;
  }

  const detail = async (id: string, cookie = cast.gm.cookie) =>
    departmentDetailResponseSchema.parse(
      await (await client.get(`/api/departments/${id}`, cookie)).json(),
    );

  const memberships = (userId: string) =>
    db
      .select({
        departmentId: departmentMembers.departmentId,
        isPrimary: departmentMembers.isPrimary,
      })
      .from(departmentMembers)
      .where(eq(departmentMembers.userId, userId));

  const noticesOf = (recipientId: string, type: string) =>
    db
      .select({ data: notifications.data, subjectId: notifications.subjectId })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, type as typeof notifications.$inferSelect.type),
        ),
      );

  const auditOf = (entityId: string, action: string) =>
    db
      .select({ before: auditEntries.before, after: auditEntries.after })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, entityId),
          eq(auditEntries.action, action as typeof auditEntries.$inferSelect.action),
        ),
      );

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    operations = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'internal_operations', manager: true }],
    });
    const member = await seedUser(db, { departments: [{ code: 'photography' }] });
    seeded.push(operations.id, member.id);
    employee = { id: member.id, cookie: await client.signIn(member.email) };
  });

  afterAll(async () => {
    await app?.close();
    await removeTasks(db, taskIds);
    await removeTemplates(db, templateIds);
    // Quotes point at the services: the clients (and their quotes) go first.
    await cast?.cleanup();
    await removeCatalog(db, serviceIds, []);
    if (created.length > 0) {
      await db
        .update(departments)
        .set({ managerId: null, archivedById: null })
        .where(inArray(departments.id, created));
      await db.delete(departmentMembers).where(inArray(departmentMembers.departmentId, created));
    }
    await removeUsers(db, seeded);
    if (created.length > 0) {
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, created));
      await db.delete(departments).where(inArray(departments.id, created));
    }
    await connection.close();
  });

  describe('access', () => {
    it('requires a session', async () => {
      const id = randomUUID();
      for (const response of [
        await client.post('/api/departments', undefined, {}),
        await client.request('PUT', '/api/departments/order', { body: { ids: [id] } }),
        await client.get(`/api/departments/${id}/overview`),
        await client.get(`/api/departments/${id}/archive-preview`),
        await client.post(`/api/departments/${id}/archive`, undefined, { targets: {} }),
        await client.post(`/api/departments/${id}/restore`),
        await client.post(`/api/departments/${id}/members`, undefined, { userIds: [id] }),
        await client.post(`/api/departments/${id}/members/${id}/primary`),
        await client.post(`/api/departments/${id}/members/${id}/move`, undefined, {
          departmentId: id,
        }),
        await client.request('DELETE', `/api/departments/${id}/members/${id}`),
      ]) {
        expect(response.status).toBe(401);
      }
    });

    it('keeps create, archive and restore to the General Manager (departments.manage)', async () => {
      const department = await createDepartment('access');
      const body = { name: `${marker} x`, color: 'c1', icon: 'film' };
      expect((await client.post('/api/departments', operations.cookie, body)).status).toBe(403);
      expect(
        (await client.get(`/api/departments/${department.id}/archive-preview`, operations.cookie))
          .status,
      ).toBe(403);
      expect(
        (
          await client.post(`/api/departments/${department.id}/archive`, operations.cookie, {
            targets: {},
          })
        ).status,
      ).toBe(403);
      expect(
        (await client.post(`/api/departments/${department.id}/restore`, operations.cookie)).status,
      ).toBe(403);
    });

    it('keeps edits, order and members to user managers', async () => {
      const department = await createDepartment('edits');
      const id = department.id;
      expect(
        (
          await client.request('PATCH', `/api/departments/${id}`, {
            cookie: employee.cookie,
            body: { color: 'c2' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.request('PUT', '/api/departments/order', {
            cookie: employee.cookie,
            body: { ids: [id] },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.post(`/api/departments/${id}/members`, employee.cookie, {
            userIds: [employee.id],
          })
        ).status,
      ).toBe(403);
      expect(
        (await client.get(`/api/departments/${randomUUID()}/overview`, employee.cookie)).status,
      ).toBe(404);
    });
  });

  describe('identity and order', () => {
    it('creates a department last in the order with a generated code, audited (rule 2)', async () => {
      const before = departmentListResponseSchema.parse(
        await (await client.get('/api/departments', employee.cookie)).json(),
      );
      const department = await createDepartment('new');
      expect(department.code).toMatch(/^d_[a-z2-7]{8}$/);
      expect(department).toMatchObject({
        description: 'new description',
        color: 'c3',
        icon: 'film',
        manager: null,
        memberCount: 0,
        members: [],
        archivedAt: null,
        archivedBy: null,
        grants: { member: [], manager: [] },
        systemFunctions: [],
      });
      const lastActive = Math.max(
        ...before.items.filter((item) => !item.archivedAt).map((item) => item.position),
      );
      expect(department.position).toBe(lastActive + 1);
      expect(await auditOf(department.id, 'department.created')).toEqual([
        {
          before: null,
          after: {
            name: department.name,
            description: 'new description',
            color: 'c3',
            icon: 'film',
          },
        },
      ]);
    });

    it('refuses a name another department holds, whatever its case (rule 3)', async () => {
      const department = await createDepartment('Unique Name');
      await expectError(
        await client.post('/api/departments', cast.gm.cookie, {
          name: department.name.toUpperCase(),
          color: 'c1',
          icon: 'film',
        }),
        409,
        'DEPARTMENT_NAME_TAKEN',
      );
    });

    it('edits description, color and icon, audited', async () => {
      const department = await createDepartment('identity');
      const response = await client.request('PATCH', `/api/departments/${department.id}`, {
        cookie: operations.cookie,
        body: { description: '', color: 'c7', icon: 'camera' },
      });
      expect(response.status).toBe(200);
      expect(departmentDetailResponseSchema.parse(await response.json())).toMatchObject({
        description: null,
        color: 'c7',
        icon: 'camera',
      });
      expect(await auditOf(department.id, 'department.updated')).toEqual([
        {
          before: { description: 'identity description', color: 'c3', icon: 'film' },
          after: { description: null, color: 'c7', icon: 'camera' },
        },
      ]);
    });

    it('lists what a system department grants and its functions (rule 27)', async () => {
      const [operationsDepartment] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, 'internal_operations'));
      const granted = await detail(operationsDepartment?.id ?? '', employee.cookie);
      expect(granted.grants.manager).toContain('users.manage');
      expect(granted.grants.manager).not.toContain('departments.manage');
      expect(granted.systemFunctions).toEqual(['escalations', 'user_management']);
    });

    it('reorders the active departments, and refuses a stale list (rule 4)', async () => {
      await createDepartment('order');
      const list = async () =>
        departmentListResponseSchema
          .parse(await (await client.get('/api/departments', operations.cookie)).json())
          .items.filter((item) => !item.archivedAt);
      const original = (await list()).map((item) => item.id);
      const put = (ids: string[]) =>
        client.request('PUT', '/api/departments/order', {
          cookie: operations.cookie,
          body: { ids },
        });
      await expectError(await put(original.slice(1)), 409, 'DEPARTMENT_ORDER_MISMATCH');
      await expectError(
        await put([...original.slice(1), original[1] ?? '']),
        409,
        'DEPARTMENT_ORDER_MISMATCH',
      );
      const swapped = [original[1] ?? '', original[0] ?? '', ...original.slice(2)];
      try {
        const response = await put(swapped);
        expect(response.status).toBe(200);
        expect((await list()).map((item) => item.id)).toEqual(swapped);
        expect(await auditOf(swapped[0] ?? '', 'department.reordered')).toContainEqual({
          before: { position: 2 },
          after: { position: 1 },
        });
      } finally {
        expect((await put(original)).status).toBe(200);
        await db
          .delete(auditEntries)
          .where(
            and(
              inArray(auditEntries.entityId, original.slice(0, 2)),
              eq(auditEntries.action, 'department.reordered'),
            ),
          );
      }
    });
  });

  describe('members (rules 17–23)', () => {
    it('adds secondary members all or nothing, audited and told', async () => {
      const department = await createDepartment('members');
      const manager = await seedUser(db, {
        departments: [{ code: department.code, manager: true }],
      });
      const one = await seedUser(db, { departments: [{ code: 'design' }] });
      const two = await seedUser(db, { password: null, departments: [{ code: 'design' }] });
      const archived = await seedUser(db, { archived: true, departments: [{ code: 'design' }] });
      seeded.push(manager.id, one.id, two.id, archived.id);
      const add = (userIds: string[]) =>
        client.post(`/api/departments/${department.id}/members`, operations.cookie, { userIds });

      await expectError(await add([one.id, archived.id]), 409, 'USER_ARCHIVED');
      expect(await memberships(one.id)).toHaveLength(1);
      await expectError(await add([manager.id]), 409, 'ALREADY_MEMBER');

      const response = await add([one.id, two.id]);
      expect(response.status).toBe(200);
      const added = departmentDetailResponseSchema.parse(await response.json());
      expect(added.members.filter((m) => [one.id, two.id].includes(m.id))).toEqual([
        expect.objectContaining({ isPrimary: false }),
        expect.objectContaining({ isPrimary: false }),
      ]);
      expect(await auditOf(department.id, 'department.member_added')).toContainEqual({
        before: null,
        after: { user: { id: one.id, name: one.name }, kind: 'secondary' },
      });
      expect(await noticesOf(one.id, 'department_member_added')).toEqual([
        {
          subjectId: department.id,
          data: { department: department.code, member: null, primary: false },
        },
      ]);
      expect(
        (await noticesOf(manager.id, 'department_member_added')).map((n) => n.data),
      ).toContainEqual({ department: department.code, member: one.name, primary: false });
      // Never to the actor.
      expect(await noticesOf(operations.id, 'department_member_added')).toEqual([]);
    });

    it('makes primary here, keeping the old primary as secondary (rule 18)', async () => {
      const department = await createDepartment('primary');
      const [design] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, 'design'));
      const person = await seedUser(db, {
        departments: [{ code: 'design' }, { code: department.code }],
      });
      seeded.push(person.id);
      const response = await client.post(
        `/api/departments/${department.id}/members/${person.id}/primary`,
        operations.cookie,
      );
      expect(response.status).toBe(200);
      expect(await memberships(person.id)).toEqual(
        expect.arrayContaining([
          { departmentId: department.id, isPrimary: true },
          { departmentId: design?.id, isPrimary: false },
        ]),
      );
      expect(await auditOf(department.id, 'department.primary_changed')).toHaveLength(1);
      expect(
        (
          await client.post(
            `/api/departments/${department.id}/members/${cast.am.id}/primary`,
            operations.cookie,
          )
        ).status,
      ).toBe(404);
    });

    it('moves a membership keeping its kind, merging into an existing one (rule 19)', async () => {
      const from = await createDepartment('move from');
      const to = await createDepartment('move to');
      const primary = await seedUser(db, { departments: [{ code: from.code }] });
      const both = await seedUser(db, {
        departments: [{ code: from.code }, { code: to.code }],
      });
      seeded.push(primary.id, both.id);
      const move = (userId: string, departmentId: string) =>
        client.post(`/api/departments/${from.id}/members/${userId}/move`, operations.cookie, {
          departmentId,
        });
      await expectError(await move(primary.id, from.id), 400, 'INVALID_TRANSFER_TARGET');
      expect((await move(primary.id, to.id)).status).toBe(200);
      expect(await memberships(primary.id)).toEqual([{ departmentId: to.id, isPrimary: true }]);
      // Primary wins: the secondary row in the target becomes primary.
      expect((await move(both.id, to.id)).status).toBe(200);
      expect(await memberships(both.id)).toEqual([{ departmentId: to.id, isPrimary: true }]);
      expect(await noticesOf(primary.id, 'department_member_removed')).toHaveLength(1);
    });

    it('removes secondary memberships only, and never the manager’s (rules 20, 21)', async () => {
      const department = await createDepartment('remove');
      const manager = await seedUser(db, {
        departments: [{ code: 'design' }, { code: department.code, manager: true }],
      });
      const primary = await seedUser(db, { departments: [{ code: department.code }] });
      const secondary = await seedUser(db, {
        departments: [{ code: 'design' }, { code: department.code }],
      });
      seeded.push(manager.id, primary.id, secondary.id);
      const remove = (userId: string) =>
        client.request('DELETE', `/api/departments/${department.id}/members/${userId}`, {
          cookie: operations.cookie,
        });
      await expectError(await remove(manager.id), 409, 'MANAGER_MEMBERSHIP_REQUIRED');
      await expectError(await remove(primary.id), 409, 'PRIMARY_DEPARTMENT_REQUIRED');
      expect((await remove(secondary.id)).status).toBe(200);
      expect(await memberships(secondary.id)).toHaveLength(1);
      expect(await auditOf(department.id, 'department.member_removed')).toHaveLength(1);
      expect((await remove(secondary.id)).status).toBe(404);
    });

    it('refuses changes to archived users (rule 22)', async () => {
      const department = await createDepartment('archived user');
      const archived = await seedUser(db, {
        archived: true,
        departments: [{ code: 'design' }, { code: department.code }],
      });
      seeded.push(archived.id);
      await expectError(
        await client.request('DELETE', `/api/departments/${department.id}/members/${archived.id}`, {
          cookie: operations.cookie,
        }),
        409,
        'USER_ARCHIVED',
      );
    });

    it('writes department entries for the user form too', async () => {
      const department = await createDepartment('user form');
      const person = await seedUser(db, { departments: [{ code: 'design' }] });
      seeded.push(person.id);
      const [design] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, 'design'));
      const response = await client.request('PATCH', `/api/users/${person.id}`, {
        cookie: operations.cookie,
        body: { primaryDepartmentId: department.id, secondaryDepartmentIds: [design?.id] },
      });
      expect(response.status).toBe(200);
      expect(await auditOf(department.id, 'department.member_added')).toEqual([
        { before: null, after: { user: { id: person.id, name: person.name }, kind: 'primary' } },
      ]);
    });
  });

  describe('overview (rules 24–26)', () => {
    it('shows counts to everyone and the workload to report readers', async () => {
      const department = await createDepartment('overview');
      const member = await seedUser(db, { departments: [{ code: department.code }] });
      seeded.push(member.id);
      const task = await client.post('/api/tasks', cast.gm.cookie, {
        title: `${marker} مهمة`,
        department: department.code,
        dueDate: '2099-01-01',
      });
      expect(task.status, await task.clone().text()).toBe(201);
      const taskId = taskDetailSchema.parse(await task.json()).id;
      taskIds.push(taskId);
      // Overdue: past due dates are refused on create.
      await db.update(tasks).set({ dueDate: '2000-01-01' }).where(eq(tasks.id, taskId));

      const plain = departmentOverviewSchema.parse(
        await (
          await client.get(`/api/departments/${department.id}/overview`, employee.cookie)
        ).json(),
      );
      expect(plain).toMatchObject({ overdue: 1, unassigned: 1, services: 0, projects: 0 });
      expect(plain.byStatus.find((row) => row.status === 'new')?.count).toBe(1);
      expect(plain).not.toHaveProperty('members');

      const full = departmentOverviewSchema.parse(
        await (
          await client.get(`/api/departments/${department.id}/overview`, cast.gm.cookie)
        ).json(),
      );
      expect(full.members?.map((row) => row.user.id)).toEqual([member.id]);
      expect(full.onLeave).toEqual([]);
    });
  });

  describe('archive and restore (rules 8–16)', () => {
    it('moves every category to its target in one transaction, and restores empty', async () => {
      const archived = await createDepartment('archived');
      const target = await createDepartment('target');
      const services = await createDepartment('services');
      const manager = await seedUser(db, {
        departments: [{ code: archived.code, manager: true }],
      });
      const secondary = await seedUser(db, {
        departments: [{ code: 'design' }, { code: archived.code }],
      });
      // Already secondary in the target: that row becomes primary.
      const merged = await seedUser(db, {
        departments: [{ code: archived.code }, { code: target.code }],
      });
      const targetManager = await seedUser(db, {
        departments: [{ code: target.code, manager: true }],
      });
      seeded.push(manager.id, secondary.id, merged.id, targetManager.id);

      // Tasks: one open and assigned, one delivered (it stays, rule 11).
      const createTask = async (assigneeId?: string) => {
        const response = await client.post('/api/tasks', cast.gm.cookie, {
          title: `${marker} مهمة`,
          department: archived.code,
          dueDate: '2099-01-01',
          ...(assigneeId && { assigneeId }),
        });
        expect(response.status, await response.clone().text()).toBe(201);
        const id = taskDetailSchema.parse(await response.json()).id;
        taskIds.push(id);
        return id;
      };
      const openTask = await createTask(manager.id);
      const closedTask = await createTask();
      await db.update(tasks).set({ status: 'delivered' }).where(eq(tasks.id, closedTask));
      const [question] = await db
        .insert(taskComments)
        .values({
          taskId: openTask,
          authorId: cast.gm.id,
          body: 'سؤال',
          kind: 'question',
          addressedDepartment: archived.code,
          questionStatus: 'open',
          clockStartedAt: new Date(),
        })
        .returning({ id: taskComments.id });

      // Services, and the lines of an open and an accepted quote.
      const service = await client.post('/api/catalog/services', cast.gm.cookie, {
        name: `${marker} خدمة`,
        department: archived.code,
        billing: 'one_off',
        priceUsdMinor: 1000,
      });
      expect(service.status).toBe(201);
      const serviceId = catalogServiceSchema.parse(await service.json()).id;
      serviceIds.push(serviceId);
      const clientId = (await cast.createClient()).id;
      const quoteLine = async (status: 'draft' | 'accepted') => {
        const [quote] = await db
          .insert(quotes)
          .values({
            year: 2099,
            number: Math.floor(Math.random() * 1_000_000),
            clientId,
            title: `${marker} عرض`,
            status,
            validityDays: 30,
            createdById: cast.gm.id,
          })
          .returning({ id: quotes.id });
        const [line] = await db
          .insert(quoteLines)
          .values({
            quoteId: quote?.id ?? '',
            section: 'one_off',
            serviceId,
            name: 'خدمة',
            department: archived.code,
            quantity: 1,
            unitPriceMinor: 1000,
            position: 1,
          })
          .returning({ id: quoteLines.id });
        return line?.id ?? '';
      };
      const openLine = await quoteLine('draft');
      const acceptedLine = await quoteLine('accepted');

      // A template step with its default assignee, who moves to the target as a member.
      const template = await client.post('/api/templates', cast.gm.cookie, {
        name: `${marker} قالب`,
        kind: 'project',
        stages: [],
        steps: [{ key: 'a', title: 'خطوة', department: archived.code, dueDay: 1 }],
        assignees: [{ department: archived.code, userId: manager.id }],
      });
      expect(template.status, await template.clone().text()).toBe(201);
      const templateId = templateDetailSchema.parse(await template.json()).id;
      templateIds.push(templateId);

      // Engagements: the target is listed already on the project, so no duplicate.
      const project = await cast.createProject(clientId, {
        departments: [archived.code, target.code],
      });
      const retainer = await cast.createRetainer(clientId, { departments: [archived.code] });

      const preview = departmentArchivePreviewSchema.parse(
        await (
          await client.get(`/api/departments/${archived.id}/archive-preview`, cast.gm.cookie)
        ).json(),
      );
      const counts = Object.fromEntries(preview.categories.map((c) => [c.category, c.count]));
      expect(counts).toEqual({
        members: 3,
        tasks: 1,
        questions: 1,
        services: 2,
        templates: 2,
        engagements: 2,
      });

      const archive = (targets: Record<string, string>) =>
        client.post(`/api/departments/${archived.id}/archive`, cast.gm.cookie, { targets });
      const all = (id: string) => ({
        members: id,
        tasks: id,
        questions: id,
        services: id,
        templates: id,
        engagements: id,
      });
      const { services: _, ...withoutServices } = all(target.id);
      await expectError(await archive(withoutServices), 400, 'TRANSFER_TARGET_REQUIRED');
      await expectError(await archive(all(archived.id)), 400, 'INVALID_TRANSFER_TARGET');
      await expectError(
        await archive({ ...all(target.id), tasks: randomUUID() }),
        400,
        'INVALID_TRANSFER_TARGET',
      );
      // Nothing moved on a refusal.
      expect((await detail(archived.id)).memberCount).toBe(3);

      const response = await archive({ ...all(target.id), services: services.id });
      expect(response.status, await response.clone().text()).toBe(200);
      const after = departmentDetailResponseSchema.parse(await response.json());
      expect(after.archivedAt).not.toBeNull();
      expect(after).toMatchObject({
        manager: null,
        memberCount: 0,
        archivedBy: { id: cast.gm.id },
      });

      // Members: primary members are primary in the target; secondary rows are gone.
      expect(await memberships(manager.id)).toEqual([{ departmentId: target.id, isPrimary: true }]);
      expect(await memberships(merged.id)).toEqual([{ departmentId: target.id, isPrimary: true }]);
      expect(await memberships(secondary.id)).toHaveLength(1);
      // Work moved, closed work stayed.
      const taskDepartment = async (id: string) =>
        (
          await db
            .select({ d: tasks.department, a: tasks.assigneeId })
            .from(tasks)
            .where(eq(tasks.id, id))
        )[0];
      expect(await taskDepartment(openTask)).toEqual({ d: target.code, a: manager.id });
      expect((await taskDepartment(closedTask))?.d).toBe(archived.code);
      const [movedQuestion] = await db
        .select({ department: taskComments.addressedDepartment })
        .from(taskComments)
        .where(eq(taskComments.id, question?.id ?? ''));
      expect(movedQuestion?.department).toBe(target.code);
      const [movedService] = await db
        .select({ department: catalogServices.department })
        .from(catalogServices)
        .where(eq(catalogServices.id, serviceId));
      expect(movedService?.department).toBe(services.code);
      const lineDepartment = async (id: string) =>
        (
          await db
            .select({ d: quoteLines.department })
            .from(quoteLines)
            .where(eq(quoteLines.id, id))
        )[0]?.d;
      expect(await lineDepartment(openLine)).toBe(services.code);
      expect(await lineDepartment(acceptedLine)).toBe(archived.code);
      expect(
        await db
          .select({ d: workTemplateSteps.department })
          .from(workTemplateSteps)
          .where(eq(workTemplateSteps.templateId, templateId)),
      ).toEqual([{ d: target.code }]);
      expect(
        await db
          .select({ d: workTemplateAssignees.department, u: workTemplateAssignees.userId })
          .from(workTemplateAssignees)
          .where(eq(workTemplateAssignees.templateId, templateId)),
      ).toEqual([{ d: target.code, u: manager.id }]);
      const [movedProject] = await db
        .select({ d: projects.departments })
        .from(projects)
        .where(eq(projects.id, project.id));
      expect(movedProject?.d).toEqual([target.code]);
      const [movedRetainer] = await db
        .select({ d: retainers.departments })
        .from(retainers)
        .where(eq(retainers.id, retainer.id));
      expect(movedRetainer?.d).toEqual([target.code]);

      // Audit and notices.
      const [entry] = await auditOf(archived.id, 'department.archived');
      expect(entry?.after).toMatchObject({
        moved: { members: 2, tasks: 1, questions: 1, services: 2, templates: 2, engagements: 2 },
      });
      expect(await auditOf(openTask, 'task.updated')).toContainEqual({
        before: { department: archived.code },
        after: { department: target.code, reason: 'department_archived' },
      });
      expect((await noticesOf(manager.id, 'department_archived')).map((n) => n.data)).toEqual([
        { department: archived.code, target: target.code, received: null },
      ]);
      expect((await noticesOf(targetManager.id, 'department_archived')).map((n) => n.data)).toEqual(
        [{ department: archived.code, target: target.code, received: 8 }],
      );

      // Archived: no edits, no overview, no second archive; writes refuse it.
      await expectError(await archive(all(target.id)), 409, 'DEPARTMENT_ARCHIVED');
      await expectError(
        await client.get(`/api/departments/${archived.id}/overview`, employee.cookie),
        409,
        'DEPARTMENT_ARCHIVED',
      );
      await expectError(
        await client.post(`/api/departments/${archived.id}/members`, operations.cookie, {
          userIds: [secondary.id],
        }),
        409,
        'DEPARTMENT_ARCHIVED',
      );

      // Restore: empty, last in the order, once.
      const restored = await client.post(`/api/departments/${archived.id}/restore`, cast.gm.cookie);
      expect(restored.status).toBe(200);
      const back = departmentDetailResponseSchema.parse(await restored.json());
      const active = departmentListResponseSchema
        .parse(await (await client.get('/api/departments', employee.cookie)).json())
        .items.filter((item) => !item.archivedAt);
      expect(active.at(-1)?.id).toBe(archived.id);
      expect(back).toMatchObject({ archivedAt: null, archivedBy: null, memberCount: 0 });
      expect((await taskDepartment(openTask))?.d).toBe(target.code);
      await expectError(
        await client.post(`/api/departments/${archived.id}/restore`, cast.gm.cookie),
        409,
        'DEPARTMENT_NOT_ARCHIVED',
      );
    });
  });
});
