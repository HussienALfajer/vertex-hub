import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  projectDetailSchema,
  retainerDetailSchema,
  taskDetailSchema,
  taskPageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clientContacts,
  createDatabase,
  extraWorkItems,
  retainerCycles,
  tasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('tasks', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/tasks/${id}`, { cookie, body });
  const list = async (query: string, cookie: string) => {
    const response = await client.get(`/api/tasks?${query}`, cookie);
    expect(response.status).toBe(200);
    return taskPageSchema.parse(await response.json());
  };
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/tasks')).status).toBe(401);
    expect((await client.get(`/api/tasks/${id}`)).status).toBe(401);
    expect((await client.post('/api/tasks', undefined, {})).status).toBe(401);
    expect((await patch(id, undefined, { title: 'x' })).status).toBe(401);
    for (const action of ['status', 'archive', 'restore']) {
      expect((await client.post(`/api/tasks/${id}/${action}`)).status, action).toBe(401);
    }
    expect(
      (await client.request('PUT', `/api/tasks/${id}/dependencies`, { body: { dependsOn: [] } }))
        .status,
    ).toBe(401);
  });

  describe('create', () => {
    it('lets anyone request work from any department, unassigned and audited', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.createTask(cast.writer.cookie, {
        title: ' Banner for the launch ',
        clientId,
        checklist: ['Draft', 'Final'],
        links: [{ url: 'https://drive.example.com/brief' }],
      });
      expect(task).toMatchObject({
        title: 'Banner for the launch',
        type: 'work',
        department: 'design',
        assignee: null,
        status: 'new',
        priority: 'normal',
        needsClientApproval: true,
        revisions: { clientCount: 0, limit: 2 },
        checklist: { done: 0, total: 2 },
        createdBy: { id: cast.writer.id },
        client: { id: clientId },
      });
      expect(task.checklistItems.map((item) => [item.text, item.position])).toEqual([
        ['Draft', 1],
        ['Final', 2],
      ]);
      expect(task.links).toMatchObject([{ url: 'https://drive.example.com/brief', label: null }]);
      // The requester may edit and withdraw their own request, nothing else.
      expect(task.permissions).toMatchObject({ canEdit: true, canAssign: false, canWork: false });
      expect(task.allowedTransitions).toEqual(['cancelled']);
      const [entry] = await auditOf(task.id);
      expect(entry).toMatchObject({ action: 'task.created', actorId: cast.writer.id });
      expect(entry?.after).toMatchObject({ title: 'Banner for the launch', assigneeId: null });
    });

    it('lets staff assign themselves in their own departments only (rule 6)', async () => {
      const own = await cast.createTask(cast.designer.cookie, { assigneeId: cast.designer.id });
      expect(own.assignee).toMatchObject({ id: cast.designer.id, inDepartment: true });
      // Assigning oneself outside one's departments needs assign scope.
      const response = await client.post('/api/tasks', cast.designer.cookie, {
        title: 'Copy',
        department: 'content_management',
        dueDate: cast.inDays(2),
        assigneeId: cast.designer.id,
      });
      expect(response.status).toBe(403);
    });

    it('refuses an employee assigning someone else, and a manager outside their department', async () => {
      const body = { title: 'Poster', department: 'design', dueDate: cast.inDays(2) };
      expect(
        (
          await client.post('/api/tasks', cast.writer.cookie, {
            ...body,
            assigneeId: cast.designer.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.post('/api/tasks', cast.contentManager.cookie, {
            ...body,
            assigneeId: cast.designer.id,
          })
        ).status,
      ).toBe(403);
      const assigned = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      expect(assigned.assignee?.id).toBe(cast.designer.id);
      await expectError(
        await client.post('/api/tasks', cast.designManager.cookie, {
          ...body,
          assigneeId: cast.writer.id,
        }),
        400,
        'INVALID_ASSIGNEE',
      );
    });

    it('lets account managers assign on their own clients, never the project manager alone', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const byAm = await cast.createTask(cast.am.cookie, {
        clientId,
        projectId: project.id,
        assigneeId: cast.designer.id,
      });
      expect(byAm.project).toMatchObject({ id: project.id });
      expect(
        (
          await client.post('/api/tasks', cast.otherAm.cookie, {
            title: 'x',
            department: 'design',
            dueDate: cast.inDays(1),
            clientId,
            assigneeId: cast.designer.id,
          })
        ).status,
      ).toBe(403);
      // The employee manages the project but assigns no one else (owner decision).
      expect(
        (
          await client.post('/api/tasks', cast.employee.cookie, {
            title: 'x',
            department: 'design',
            dueDate: cast.inDays(1),
            clientId,
            projectId: project.id,
            assigneeId: cast.designer.id,
          })
        ).status,
      ).toBe(403);
      // The project manager manages the project's tasks.
      expect((await cast.detail(byAm.id, cast.employee.cookie)).permissions).toMatchObject({
        canEdit: true,
        canReview: true,
        canAssign: false,
      });
    });

    it('forces client approval off without a client (rule 8)', async () => {
      const task = await cast.createTask(cast.designer.cookie, { needsClientApproval: true });
      expect(task.needsClientApproval).toBe(false);
      expect(task.client).toBeNull();
    });

    it('checks links against the client, project, milestone and cycle (rule 7)', async () => {
      const { id: clientId } = await cast.createClient();
      const { id: otherClientId } = await cast.createClient();
      const project = await cast.createProject(clientId, { milestones: [{ name: 'One' }] });
      const otherProject = await cast.createProject(otherClientId);
      const create = (body: Record<string, unknown>) =>
        client.post('/api/tasks', cast.am.cookie, {
          title: 'Linked',
          department: 'design',
          dueDate: cast.inDays(2),
          ...body,
        });
      await expectError(
        await create({ clientId, projectId: otherProject.id }),
        400,
        'INVALID_LINK',
      );
      const milestone = project.milestones[0];
      if (!milestone) throw new Error('The project has no milestone');
      const linked = await create({ clientId, projectId: project.id, milestoneId: milestone.id });
      expect(linked.status).toBe(201);
      expect(taskDetailSchema.parse(await linked.json()).milestone).toMatchObject({
        id: milestone.id,
      });
      await client.post(
        `/api/projects/${project.id}/milestones/${milestone.id}/complete`,
        cast.gm.cookie,
        { confirmOpenTasks: true },
      );
      await expectError(
        await create({ clientId, projectId: project.id, milestoneId: milestone.id }),
        409,
        'MILESTONE_DONE',
      );
      const closed = await cast.createProject(clientId);
      await client.post(`/api/projects/${closed.id}/status`, cast.gm.cookie, {
        status: 'cancelled',
        reason: 'Stopped',
      });
      await expectError(await create({ clientId, projectId: closed.id }), 409, 'PROJECT_CLOSED');
      const { id: endedId } = await cast.createClient({ status: 'ended' });
      await expectError(await create({ clientId: endedId }), 409, 'CLIENT_ENDED');
      const { id: archivedClientId } = await cast.createClient();
      await client.post(`/api/clients/${archivedClientId}/archive`, cast.gm.cookie);
      await expectError(await create({ clientId: archivedClientId }), 409, 'CLIENT_ARCHIVED');
      const archivedProject = await cast.createProject(clientId);
      await client.post(`/api/projects/${archivedProject.id}/archive`, cast.gm.cookie);
      await expectError(
        await create({ clientId, projectId: archivedProject.id }),
        409,
        'PROJECT_ARCHIVED',
      );
    });

    it('refuses a closed cycle and a cycle of an archived retainer (rule 7)', async () => {
      const { id: clientId } = await cast.createClient();
      const create = (retainerCycleId: string) =>
        client.post('/api/tasks', cast.am.cookie, {
          title: 'Monthly design',
          department: 'design',
          dueDate: cast.inDays(2),
          clientId,
          retainerCycleId,
        });
      const open = (await cast.createRetainer(clientId)).currentCycle?.id ?? '';
      await db.update(retainerCycles).set({ status: 'closed' }).where(eq(retainerCycles.id, open));
      await expectError(await create(open), 409, 'CYCLE_CLOSED');
      await db.update(retainerCycles).set({ status: 'open' }).where(eq(retainerCycles.id, open));
      const archived = await cast.createRetainer(clientId);
      await client.post(`/api/retainers/${archived.id}/archive`, cast.gm.cookie);
      await expectError(await create(archived.currentCycle?.id ?? ''), 409, 'RETAINER_ARCHIVED');
    });

    it('links a retainer cycle line of the client, and counts its delivered tasks (R7)', async () => {
      const { id: clientId } = await cast.createClient();
      const retainer = await cast.createRetainer(clientId);
      const cycle = retainer.currentCycle;
      const line = cycle?.lines.find((l) => l.kind === 'design');
      if (!cycle || !line) throw new Error('The retainer has no open cycle');
      const task = await cast.taskAt('approved', {
        clientId,
        retainerCycleId: cycle.id,
        cycleLineId: line.id,
        needsClientApproval: false,
      });
      expect(task.retainer).toMatchObject({ id: retainer.id });
      expect(task.cycleLine).toMatchObject({ id: line.id, kind: 'design' });
      await cast.moveOk(task.id, cast.designer.cookie, { status: 'delivered' });
      const after = retainerDetailSchema.parse(
        await (await client.get(`/api/retainers/${retainer.id}`, cast.gm.cookie)).json(),
      );
      const counted = after.currentCycle?.lines.find((l) => l.id === line.id);
      expect(counted?.delivered).toBe(line.delivered + 1);
      expect(counted?.tasks).toMatchObject({ total: 1, delivered: 1 });
    });

    it('logs client requests with client scope; out of scope creates extra work (rule 11)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId);
      const [contact] = await db
        .insert(clientContacts)
        .values({ clientId, name: 'Contact' })
        .returning({ id: clientContacts.id });
      if (!contact) throw new Error('No contact');
      const request = {
        title: 'Extra reel',
        brief: 'A second reel for the launch',
        type: 'client_request' as const,
        department: 'design' as const,
        dueDate: cast.inDays(5),
        clientId,
      };
      expect((await client.post('/api/tasks', cast.designManager.cookie, request)).status).toBe(
        403,
      );
      await expectError(
        await client.post('/api/tasks', cast.am.cookie, {
          ...request,
          requestScope: 'out_of_scope',
        }),
        409,
        'NO_ENGAGEMENT',
      );
      await expectError(
        await client.post('/api/tasks', cast.am.cookie, {
          ...request,
          requestedOn: cast.inDays(1),
        }),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await client.post('/api/tasks', cast.am.cookie, {
          ...request,
          requestedByContactId: randomUUID(),
        }),
        400,
        'UNKNOWN_CONTACT',
      );
      const task = await cast.createTask(cast.am.cookie, {
        ...request,
        projectId: project.id,
        requestScope: 'out_of_scope',
        requestedByContactId: contact.id,
      });
      expect(task.clientRequest).toMatchObject({
        scope: 'out_of_scope',
        requestedOn: businessDate(),
        contact: { id: contact.id },
        extraWork: { title: 'Extra reel', billingStatus: 'unbilled' },
      });
      const itemId = task.clientRequest?.extraWork?.id ?? '';
      const [item] = await db.select().from(extraWorkItems).where(eq(extraWorkItems.id, itemId));
      expect(item).toMatchObject({
        projectId: project.id,
        description: 'A second reel for the launch',
        requestedByContactId: contact.id,
        loggedById: cast.am.id,
      });
      expect((await auditOf(itemId)).map((e) => e.action)).toEqual(['extra_work.created']);

      // Back in scope archives the unbilled item; once billed the switch is refused.
      const back = taskDetailSchema.parse(
        await (await patch(task.id, cast.am.cookie, { requestScope: 'in_scope' })).json(),
      );
      expect(back.clientRequest).toMatchObject({ scope: 'in_scope', extraWork: null });
      const [archived] = await db
        .select()
        .from(extraWorkItems)
        .where(eq(extraWorkItems.id, itemId));
      expect(archived?.archivedAt).not.toBeNull();
      const out = taskDetailSchema.parse(
        await (await patch(task.id, cast.am.cookie, { requestScope: 'out_of_scope' })).json(),
      );
      const newItem = out.clientRequest?.extraWork?.id ?? '';
      await db
        .update(extraWorkItems)
        .set({ billingStatus: 'billed', billingNote: 'INV-1' })
        .where(eq(extraWorkItems.id, newItem));
      await expectError(
        await patch(task.id, cast.am.cookie, { requestScope: 'in_scope' }),
        409,
        'EXTRA_WORK_BILLED',
      );
      expect(
        (await patch(task.id, cast.designManager.cookie, { requestScope: 'in_scope' })).status,
      ).toBe(403);
    });

    it('refuses past due dates and too many checklist items', async () => {
      const body = { title: 'Late', department: 'design' };
      await expectError(
        await client.post('/api/tasks', cast.designer.cookie, {
          ...body,
          dueDate: cast.inDays(-1),
        }),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await client.post('/api/tasks', cast.designer.cookie, {
          ...body,
          dueDate: cast.inDays(1),
          checklist: Array.from({ length: 21 }, (_, i) => `Item ${i}`),
        }),
        409,
        'LIMIT_REACHED',
      );
      expect(
        (await client.post('/api/tasks', cast.designer.cookie, { ...body, dueDate: 'soon' }))
          .status,
      ).toBe(400);
    });
  });

  describe('list and detail', () => {
    it('shows every task to every user, with filters (rule 12, list query)', async () => {
      const title = `قائمة ${cast.run}`;
      const mine = await cast.createTask(cast.designManager.cookie, {
        title,
        assigneeId: cast.designer.id,
        priority: 'urgent',
      });
      const queued = await cast.createTask(cast.writer.cookie, { title, dueDate: cast.inDays(10) });
      const overdue = await cast.createTask(cast.designManager.cookie, {
        title,
        assigneeId: cast.designer.id,
      });
      await db
        .update(tasks)
        .set({ dueDate: cast.inDays(-2) })
        .where(eq(tasks.id, overdue.id));
      const search = `search=${encodeURIComponent(title)}`;

      const all = await list(search, cast.writer.cookie);
      expect(all.items.map((t) => t.id).sort()).toEqual([mine.id, queued.id, overdue.id].sort());
      expect((await list(`${search}&assigneeId=me`, cast.designer.cookie)).items).toHaveLength(2);
      expect(
        (await list(`${search}&unassigned=true`, cast.gm.cookie)).items.map((t) => t.id),
      ).toEqual([queued.id]);
      expect(
        (await list(`${search}&createdBy=me`, cast.writer.cookie)).items.map((t) => t.id),
      ).toEqual([queued.id]);
      const late = await list(`${search}&overdue=true`, cast.writer.cookie);
      expect(late.items.map((t) => [t.id, t.overdue])).toEqual([[overdue.id, true]]);
      expect((await list(`${search}&priority=urgent`, cast.writer.cookie)).items).toHaveLength(1);
      expect(
        (await list(`${search}&internal=true&department=design`, cast.writer.cookie)).total,
      ).toBe(3);
      const sorted = await list(`${search}&sort=dueDate&order=desc`, cast.writer.cookie);
      expect(sorted.items[0]?.id).toBe(queued.id);
      expect(
        (await client.get(`/api/tasks?${search}&archived=true`, cast.writer.cookie)).status,
      ).toBe(403);
    });

    it('answers 404 for an unknown task', async () => {
      expect((await client.get(`/api/tasks/${randomUUID()}`, cast.writer.cookie)).status).toBe(404);
    });
  });

  describe('update', () => {
    it('edits with manage scope, audited; the requester only while new and unassigned', async () => {
      const request = await cast.createTask(cast.writer.cookie);
      const edited = taskDetailSchema.parse(
        await (await patch(request.id, cast.writer.cookie, { priority: 'high' })).json(),
      );
      expect(edited.priority).toBe('high');
      expect(
        (await patch(request.id, cast.writer.cookie, { assigneeId: cast.designer.id })).status,
      ).toBe(403);
      const assigned = taskDetailSchema.parse(
        await (
          await patch(request.id, cast.designManager.cookie, { assigneeId: cast.designer.id })
        ).json(),
      );
      expect(assigned.assignee?.id).toBe(cast.designer.id);
      expect((await patch(request.id, cast.writer.cookie, { priority: 'low' })).status).toBe(403);
      expect((await patch(request.id, cast.designer.cookie, { priority: 'low' })).status).toBe(403);
      expect(
        (await auditOf(request.id)).map((e) => [e.action, e.before, e.after]).slice(1),
      ).toEqual([
        ['task.updated', { priority: 'normal' }, { priority: 'high' }],
        [
          'task.assigned',
          { assignee: null },
          { assignee: { id: cast.designer.id, name: cast.designer.name } },
        ],
      ]);
    });

    it('moves a task to another department and clears an assignee who is not in it (rule 6)', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      // Assign scope covers the task as it will be: no moving and assigning into another department.
      const queued = await cast.createTask(cast.designManager.cookie);
      expect(
        (
          await patch(queued.id, cast.designManager.cookie, {
            department: 'content_management',
            assigneeId: cast.writer.id,
          })
        ).status,
      ).toBe(403);
      await expectError(
        await patch(task.id, cast.designManager.cookie, { assigneeId: cast.writer.id }),
        400,
        'INVALID_ASSIGNEE',
      );
      const moved = taskDetailSchema.parse(
        await (
          await patch(task.id, cast.designManager.cookie, { department: 'content_management' })
        ).json(),
      );
      expect(moved).toMatchObject({ department: 'content_management', assignee: null });
      expect((await auditOf(task.id)).map((e) => e.action)).toEqual([
        'task.created',
        'task.department_changed',
        'task.assigned',
      ]);
      // Now the Content manager assigns it, no longer the Design manager.
      expect(
        (await patch(task.id, cast.designManager.cookie, { assigneeId: cast.writer.id })).status,
      ).toBe(403);
      expect(
        (await patch(task.id, cast.contentManager.cookie, { assigneeId: cast.writer.id })).status,
      ).toBe(200);
    });

    it('turns client approval on when a client is added, and never off while awaiting it (rule 8)', async () => {
      const internal = await cast.createTask(cast.designManager.cookie);
      const { id: clientId } = await cast.createClient();
      const linked = taskDetailSchema.parse(
        await (await patch(internal.id, cast.designManager.cookie, { clientId })).json(),
      );
      expect(linked.needsClientApproval).toBe(true);
      const waiting = await cast.taskAt('awaiting_client');
      await expectError(
        await patch(waiting.id, cast.designManager.cookie, { needsClientApproval: false }),
        409,
        'INVALID_TRANSITION',
      );
      await expectError(
        await patch(waiting.id, cast.designManager.cookie, { projectId: randomUUID() }),
        400,
        'INVALID_LINK',
      );
    });
  });

  describe('archive and restore', () => {
    it('lets scope all archive, hides the task, and keeps it read-only (rule 17)', async () => {
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
      });
      expect(
        (await client.post(`/api/tasks/${task.id}/archive`, cast.designManager.cookie)).status,
      ).toBe(403);
      const archived = taskDetailSchema.parse(
        await (await client.post(`/api/tasks/${task.id}/archive`, cast.operations.cookie)).json(),
      );
      expect(archived).toMatchObject({ readOnly: true, allowedTransitions: [] });
      expect(archived.archivedAt).not.toBeNull();
      expect((await client.get(`/api/tasks/${task.id}`, cast.designer.cookie)).status).toBe(404);
      await expectError(
        await patch(task.id, cast.gm.cookie, { priority: 'low' }),
        409,
        'TASK_ARCHIVED',
      );
      await expectError(
        await client.post(`/api/tasks/${task.id}/archive`, cast.gm.cookie),
        409,
        'TASK_ARCHIVED',
      );
      const listed = await list('archived=true&status=new', cast.gm.cookie);
      expect(listed.items.map((t) => t.id)).toContain(task.id);
      await client.post(`/api/tasks/${task.id}/restore`, cast.gm.cookie);
      await expectError(
        await client.post(`/api/tasks/${task.id}/restore`, cast.gm.cookie),
        409,
        'TASK_NOT_ARCHIVED',
      );
      expect((await auditOf(task.id)).map((e) => e.action)).toEqual([
        'task.created',
        'task.archived',
        'task.restored',
      ]);
    });

    it('hides the tasks of an archived client and keeps them read-only', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.createTask(cast.designManager.cookie, {
        clientId,
        assigneeId: cast.designer.id,
      });
      await client.post(`/api/clients/${clientId}/archive`, cast.gm.cookie);
      expect((await client.get(`/api/tasks/${task.id}`, cast.designer.cookie)).status).toBe(404);
      expect((await list(`clientId=${clientId}`, cast.gm.cookie)).items).toEqual([]);
      await expectError(
        await cast.move(task.id, cast.gm.cookie, { status: 'in_progress' }),
        409,
        'TASK_ARCHIVED',
      );
    });
  });

  describe('projects (F05 changes)', () => {
    it('reports task counts and progress per project and milestone', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, { milestones: [{ name: 'Design' }] });
      const milestoneId = project.milestones[0]?.id ?? '';
      const input = { clientId, projectId: project.id, milestoneId, needsClientApproval: false };
      await cast.taskAt('delivered', input);
      await cast.taskAt('in_progress', input);
      const cancelled = await cast.createTask(cast.am.cookie, input);
      await cast.moveOk(cancelled.id, cast.am.cookie, { status: 'cancelled', note: 'Not needed' });
      const seen = projectDetailSchema.parse(
        await (await client.get(`/api/projects/${project.id}`, cast.gm.cookie)).json(),
      );
      expect(seen.tasks).toEqual({ total: 2, delivered: 1, open: 1, ready: 0 });
      expect(seen.progress).toBe(50);
      expect(seen.milestones[0]?.tasks).toEqual({ total: 2, delivered: 1, open: 1, ready: 0 });
    });

    it('refuses to complete a project with open tasks, and cancels them with the project', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, { status: 'active' });
      const open = await cast.taskAt('in_progress', { clientId, projectId: project.id });
      const body = await expectError(
        await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
          status: 'completed',
        }),
        409,
        'TASKS_OPEN',
      );
      expect(body.details).toEqual([{ id: open.id, name: open.title }]);
      await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
        status: 'cancelled',
        reason: 'Client stopped',
      });
      const after = await cast.detail(open.id, cast.gm.cookie);
      expect(after).toMatchObject({ status: 'cancelled', cancelReason: 'Client stopped' });
      const entry = (await auditOf(open.id)).at(-1);
      expect(entry).toMatchObject({
        actorId: cast.gm.id,
        before: { status: 'in_progress' },
        after: { status: 'cancelled', note: 'Client stopped', projectId: project.id },
      });
      // A reopened project does not reopen its cancelled tasks (edge case 7).
      await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, { status: 'active' });
      expect((await cast.detail(open.id, cast.gm.cookie)).status).toBe('cancelled');
    });

    it('withdraws the unbilled extra work of requests cancelled with their project (edge case 10)', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, { status: 'active' });
      const request = await cast.createTask(cast.am.cookie, {
        type: 'client_request',
        clientId,
        projectId: project.id,
        requestScope: 'out_of_scope',
      });
      const itemId = request.clientRequest?.extraWork?.id ?? '';
      await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
        status: 'cancelled',
        reason: 'Stopped',
      });
      const [item] = await db.select().from(extraWorkItems).where(eq(extraWorkItems.id, itemId));
      expect(item?.archivedAt).not.toBeNull();
      const after = await cast.detail(request.id, cast.gm.cookie);
      expect(after).toMatchObject({ status: 'cancelled', clientRequest: { extraWork: null } });
      // No extra work goes on a closed project (M3).
      expect((await patch(request.id, cast.am.cookie, { requestScope: 'in_scope' })).status).toBe(
        200,
      );
      await expectError(
        await patch(request.id, cast.am.cookie, { requestScope: 'out_of_scope' }),
        409,
        'PROJECT_CLOSED',
      );
    });
  });

  describe('engagement changes of out-of-scope requests (rule 11)', () => {
    it('moves unbilled extra work with the request, refuses removing its engagement', async () => {
      const { id: clientId } = await cast.createClient();
      const first = await cast.createProject(clientId, { status: 'active' });
      const second = await cast.createProject(clientId, { status: 'active' });
      const request = await cast.createTask(cast.am.cookie, {
        type: 'client_request',
        clientId,
        projectId: first.id,
        requestScope: 'out_of_scope',
      });
      const firstItem = request.clientRequest?.extraWork?.id ?? '';

      await expectError(
        await patch(request.id, cast.am.cookie, { projectId: null }),
        409,
        'NO_ENGAGEMENT',
      );

      const moved = taskDetailSchema.parse(
        await (await patch(request.id, cast.am.cookie, { projectId: second.id })).json(),
      );
      const secondItem = moved.clientRequest?.extraWork?.id ?? '';
      expect(secondItem).not.toBe(firstItem);
      const items = await db
        .select()
        .from(extraWorkItems)
        .where(inArray(extraWorkItems.id, [firstItem, secondItem]));
      expect(items.find((item) => item.id === firstItem)?.archivedAt).not.toBeNull();
      expect(items.find((item) => item.id === secondItem)).toMatchObject({
        projectId: second.id,
        archivedAt: null,
      });
      expect((await auditOf(request.id)).map((entry) => entry.action)).toContain(
        'task.extra_work_moved',
      );

      // Billed extra work stays where it was billed: the move is refused.
      await db
        .update(extraWorkItems)
        .set({ billingStatus: 'billed', billingNote: 'INV-2' })
        .where(eq(extraWorkItems.id, secondItem));
      await expectError(
        await patch(request.id, cast.am.cookie, { projectId: first.id }),
        409,
        'EXTRA_WORK_BILLED',
      );
      expect((await cast.detail(request.id, cast.gm.cookie)).project?.id).toBe(second.id);
    });

    it('keeps only the label and site of links in the task.created audit entry', async () => {
      const task = await cast.createTask(cast.designer.cookie, {
        links: [
          { url: 'https://drive.example.com/file/d/secret-token?usp=sharing', label: 'Brief' },
        ],
      });
      const [created] = (await auditOf(task.id)).filter((entry) => entry.action === 'task.created');
      expect(created?.after).toMatchObject({
        links: [{ label: 'Brief', site: 'drive.example.com' }],
      });
      expect(JSON.stringify(created?.after)).not.toContain('secret-token');
    });
  });

  describe('closed projects and archived assignees (F05 rule 7, F06 rule 6)', () => {
    it('refuses to reopen or restore work of a completed or cancelled project', async () => {
      const { id: clientId } = await cast.createClient();
      const project = await cast.createProject(clientId, { status: 'active' });
      const delivered = await cast.taskAt('delivered', { clientId, projectId: project.id });
      const archivedOpen = await cast.createTask(cast.designManager.cookie, {
        clientId,
        projectId: project.id,
      });
      expect(
        (await client.post(`/api/tasks/${archivedOpen.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      expect(
        (
          await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, {
            status: 'completed',
          })
        ).status,
      ).toBe(200);
      expect((await cast.detail(delivered.id, cast.gm.cookie)).allowedTransitions).toEqual([]);
      await expectError(
        await cast.move(delivered.id, cast.designManager.cookie, {
          status: 'in_progress',
          note: 'Once more',
        }),
        409,
        'PROJECT_CLOSED',
      );
      await expectError(
        await client.post(`/api/tasks/${archivedOpen.id}/restore`, cast.gm.cookie),
        409,
        'PROJECT_CLOSED',
      );
      // Reopening the project first allows both.
      await client.post(`/api/projects/${project.id}/status`, cast.gm.cookie, { status: 'active' });
      await cast.moveOk(delivered.id, cast.designManager.cookie, {
        status: 'in_progress',
        note: 'Once more',
      });
      expect(
        (await client.post(`/api/tasks/${archivedOpen.id}/restore`, cast.gm.cookie)).status,
      ).toBe(200);
    });

    it('never hands open work back to an archived user', async () => {
      const worker = await cast.signedIn({ name: `عامل ${cast.run}` });
      const cancelled = await cast.createTask(cast.designManager.cookie, { assigneeId: worker.id });
      await cast.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'Not needed',
      });
      const archivedTask = await cast.createTask(cast.designManager.cookie, {
        assigneeId: worker.id,
      });
      expect(
        (await client.post(`/api/tasks/${archivedTask.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      expect((await client.post(`/api/users/${worker.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );

      await expectError(
        await cast.move(cancelled.id, cast.designManager.cookie, {
          status: 'in_progress',
          note: 'Back on',
        }),
        409,
        'INVALID_ASSIGNEE',
      );
      // Restored open work returns to the department queue, the change audited.
      const restored = taskDetailSchema.parse(
        await (await client.post(`/api/tasks/${archivedTask.id}/restore`, cast.gm.cookie)).json(),
      );
      expect(restored.assignee).toBeNull();
      expect((await auditOf(archivedTask.id)).at(-1)).toMatchObject({
        action: 'task.assigned',
        after: { assignee: null },
      });
    });
  });

  describe('users (F01 change)', () => {
    it('refuses to archive a user with open assigned tasks', async () => {
      const worker = await cast.signedIn({ name: `منفذ ${cast.run}` });
      const task = await cast.createTask(cast.designManager.cookie, {
        assigneeId: worker.id,
        dueDate: addDays(businessDate(), 1),
      });
      const body = await expectError(
        await client.post(`/api/users/${worker.id}/archive`, cast.gm.cookie),
        409,
        'USER_HAS_RESPONSIBILITIES',
      );
      expect(body.details).toEqual([
        { type: 'assignee_of_open_tasks', id: task.id, name: task.title },
      ]);
      await cast.moveOk(task.id, cast.designManager.cookie, { status: 'cancelled', note: 'Done' });
      expect((await client.post(`/api/users/${worker.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
    });
  });
});
