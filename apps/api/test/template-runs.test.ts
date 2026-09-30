import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreateTemplateInput,
  cycleDetailSchema,
  isWorkDay,
  lastOfMonth,
  nthWorkDay,
  type RetainerDetail,
  retainerTemplateSchema,
  type TemplateRunInputBody,
  templateDetailSchema,
  templateRunPageSchema,
  templateRunPlanSchema,
  templateRunSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clients,
  createDatabase,
  departmentMembers,
  projectMilestones,
  projects,
  retainerCycleLines,
  retainerCycles,
  taskChecklistItems,
  taskDependencies,
  tasks,
  templateRuns,
  templateRunTasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetainerCyclesService } from '../src/modules/projects/retainer-cycles.service.js';
import { expectError, seedClientCast } from './client-cast.js';
import { api, departmentId, removeTemplates } from './helpers.js';
import { startApp } from './start-app.js';

describe('template runs', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let designer: Awaited<ReturnType<typeof cast.signedIn>>;
  let marketer: Awaited<ReturnType<typeof cast.signedIn>>;
  let clientId: string;
  let projectTemplate: string;
  let monthlyTemplate: string;
  const templates: string[] = [];
  const today = businessDate();
  const nextMonth = addDays(lastOfMonth(today), 1);

  const preview = (id: string, cookie: string | undefined, body: TemplateRunInputBody) =>
    client.post(`/api/templates/${id}/preview`, cookie, body);
  const apply = (id: string, cookie: string | undefined, body: TemplateRunInputBody) =>
    client.post(`/api/templates/${id}/runs`, cookie, body);
  const linkTemplate = (retainerId: string, cookie: string | undefined, templateId: unknown) =>
    client.request('PUT', `/api/retainers/${retainerId}/template`, {
      cookie,
      body: { templateId },
    });
  const missingTasks = (retainerId: string, cycleId: string, lineId: string, cookie?: string) =>
    client.post(
      `/api/retainers/${retainerId}/cycles/${cycleId}/lines/${lineId}/missing-tasks`,
      cookie,
    );

  async function createTemplate(input: CreateTemplateInput) {
    const response = await client.post('/api/templates', cast.operations.cookie, input);
    expect(response.status).toBe(201);
    const created = templateDetailSchema.parse(await response.json());
    templates.push(created.id);
    return created;
  }

  async function applied(id: string, cookie: string, body: TemplateRunInputBody) {
    const response = await apply(id, cookie, body);
    if (response.status !== 201) {
      throw new Error(`Run failed: ${response.status} ${await response.text()}`);
    }
    return templateRunSchema.parse(await response.json());
  }

  async function planned(id: string, cookie: string, body: TemplateRunInputBody) {
    const response = await preview(id, cookie, body);
    if (response.status !== 200) {
      throw new Error(`Preview failed: ${response.status} ${await response.text()}`);
    }
    return templateRunPlanSchema.parse(await response.json());
  }

  async function retainerTemplate(retainerId: string, cookie = cast.am.cookie) {
    const response = await client.get(`/api/retainers/${retainerId}/template`, cookie);
    expect(response.status).toBe(200);
    return retainerTemplateSchema.parse(await response.json());
  }

  /** The tasks a run created, in step order. */
  async function runTasks(runId: string) {
    return db
      .select({
        id: tasks.id,
        title: tasks.title,
        department: tasks.department,
        assigneeId: tasks.assigneeId,
        dueDate: tasks.dueDate,
        milestoneId: tasks.milestoneId,
        retainerCycleId: tasks.retainerCycleId,
        cycleLineId: tasks.cycleLineId,
        createdById: tasks.createdById,
        stepId: templateRunTasks.stepId,
        instance: templateRunTasks.instance,
      })
      .from(templateRunTasks)
      .innerJoin(tasks, eq(tasks.id, templateRunTasks.taskId))
      .where(eq(templateRunTasks.runId, runId))
      .orderBy(asc(tasks.dueDate), asc(tasks.title));
  }

  const dependenciesOf = (taskIds: string[]) =>
    db
      .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
      .from(taskDependencies)
      .where(inArray(taskDependencies.taskId, taskIds));

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  /** Runs of a cycle, straight from the database. */
  const cycleRuns = (cycleId: string) =>
    db.select().from(templateRuns).where(eq(templateRuns.retainerCycleId, cycleId));

  /** A started retainer (this month's cycle open) of the client, with its current cycle. */
  async function startedRetainer(input: Partial<Parameters<typeof cast.createRetainer>[1]> = {}) {
    const retainer = await cast.createRetainer(clientId, input);
    const state = await retainerTemplate(retainer.id);
    if (!state.cycle) throw new Error('The retainer has no open cycle');
    return { retainer, cycle: state.cycle, lines: state.lines };
  }

  /** Removes the retainer's cycles, as if the retainer had been paused across a month end. */
  async function dropCycles(retainer: RetainerDetail) {
    const cycles = await db
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .where(eq(retainerCycles.retainerId, retainer.id));
    const ids = cycles.map((cycle) => cycle.id);
    if (ids.length === 0) return;
    await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
    await db.delete(retainerCycleLines).where(inArray(retainerCycleLines.cycleId, ids));
    await db.delete(retainerCycles).where(inArray(retainerCycles.id, ids));
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    designer = await cast.signedIn({ departments: [{ code: 'design' }] });
    marketer = await cast.signedIn({ departments: [{ code: 'marketing' }] });
    clientId = (await cast.createClient()).id;

    projectTemplate = (
      await createTemplate({
        name: `قالب مشروع ${cast.run}`,
        kind: 'project',
        stages: [
          { key: 'discovery', name: 'Discovery' },
          { key: 'design', name: 'Design' },
          { key: 'unused', name: 'Unused' },
        ],
        steps: [
          {
            key: 'brief',
            stageKey: 'discovery',
            title: 'Brief',
            department: 'marketing',
            dueDay: 1,
          },
          {
            key: 'logo',
            stageKey: 'design',
            title: 'Logo',
            department: 'design',
            dueDay: 3,
            priority: 'high',
            needsClientApproval: false,
            revisionLimit: 4,
            checklist: ['Three directions', 'Mono version'],
            dependsOn: ['brief'],
          },
          {
            key: 'handover',
            title: 'Handover',
            department: 'design',
            dueDay: 5,
            dependsOn: ['logo'],
          },
        ],
        assignees: [{ department: 'design', userId: designer.id }],
      })
    ).id;

    monthlyTemplate = (
      await createTemplate({
        name: `قالب شهري ${cast.run}`,
        kind: 'retainer_cycle',
        steps: [
          { key: 'plan', title: 'Plan', department: 'content_management', dueDay: 3 },
          {
            key: 'design',
            title: 'Design',
            department: 'design',
            repeatKind: 'design',
            spreadFromDay: 4,
            dependsOn: ['plan'],
          },
          {
            key: 'reel',
            title: 'Reel',
            department: 'photography',
            repeatKind: 'reel',
            dependsOn: ['plan'],
          },
          {
            key: 'report',
            title: 'Report',
            department: 'marketing',
            repeatKind: 'monthly_report',
            spreadFromDay: 27,
          },
        ],
        assignees: [{ department: 'design', userId: designer.id }],
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
    await removeTemplates(db, templates);
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    const body = { projectId: id };
    expect((await preview(id, undefined, body)).status).toBe(401);
    expect((await apply(id, undefined, body)).status).toBe(401);
    expect((await client.get(`/api/template-runs?projectId=${id}`)).status).toBe(401);
    expect((await client.get(`/api/retainers/${id}/template`)).status).toBe(401);
    expect((await linkTemplate(id, undefined, null)).status).toBe(401);
    expect((await missingTasks(id, id, id)).status).toBe(401);
  });

  describe('project runs', () => {
    it('previews the tasks and milestones without writing anything (rules 6, 7, 13)', async () => {
      const project = await cast.createProject(clientId, { milestones: [{ name: ' discovery ' }] });
      const plan = await planned(projectTemplate, cast.am.cookie, { projectId: project.id });
      const start = project.startDate > today ? project.startDate : today;
      expect(plan.startDate).toBe(start);
      expect(
        plan.tasks.map((task) => [task.title, task.dueDate, task.assignee?.id ?? null]),
      ).toEqual([
        ['Brief', nthWorkDay(start, 1), null],
        ['Logo', nthWorkDay(start, 3), designer.id],
        ['Handover', nthWorkDay(start, 5), designer.id],
      ]);
      expect(plan.tasks.every((task) => isWorkDay(task.dueDate))).toBe(true);
      const [discovery] = await db
        .select({ id: projectMilestones.id })
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, project.id));
      expect(plan.tasks.map((task) => task.milestone)).toEqual([
        { existingId: discovery?.id, name: 'Discovery' },
        { existingId: null, name: 'Design' },
        null,
      ]);
      expect(plan.milestonesToCreate).toEqual([{ name: 'Design', dueDate: nthWorkDay(start, 3) }]);
      expect(plan.warnings).toEqual([]);
      expect(
        await db.select().from(templateRuns).where(eq(templateRuns.projectId, project.id)),
      ).toEqual([]);
    });

    it("lets the project's manager apply it, with the template's assignees (rules 11, 12)", async () => {
      const project = await cast.createProject(clientId, { milestones: [{ name: 'Discovery' }] });
      // The employee manages the project and cannot assign designers by hand.
      const run = await applied(projectTemplate, cast.employee.cookie, { projectId: project.id });
      expect(run).toMatchObject({
        template: { id: projectTemplate, archived: false },
        trigger: 'manual',
        project: { id: project.id, name: project.name },
        cycle: null,
        taskCount: 3,
        milestonesCreated: 1,
        createdBy: { id: cast.employee.id },
      });

      const created = await runTasks(run.id);
      expect(created.map((task) => [task.title, task.assigneeId, task.createdById])).toEqual([
        ['Brief', null, cast.employee.id],
        ['Logo', designer.id, cast.employee.id],
        ['Handover', designer.id, cast.employee.id],
      ]);
      const [logo] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, created[1]?.id ?? ''));
      expect(logo).toMatchObject({
        type: 'work',
        status: 'new',
        priority: 'high',
        needsClientApproval: false,
        revisionLimit: 4,
        clientId,
        projectId: project.id,
      });
      const checklist = await db
        .select({ text: taskChecklistItems.text, position: taskChecklistItems.position })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, logo?.id ?? ''))
        .orderBy(taskChecklistItems.position);
      expect(checklist).toEqual([
        { text: 'Three directions', position: 1 },
        { text: 'Mono version', position: 2 },
      ]);
      const ids = created.map((task) => task.id);
      expect(await dependenciesOf(ids)).toEqual(
        expect.arrayContaining([
          { taskId: ids[1], dependsOnId: ids[0] },
          { taskId: ids[2], dependsOnId: ids[1] },
        ]),
      );

      // Rule 13: Design is appended as a new milestone; Discovery is reused.
      const milestones = await db
        .select()
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, project.id))
        .orderBy(projectMilestones.position);
      expect(milestones.map((m) => [m.name, m.position, m.dueDate])).toEqual([
        ['Discovery', 1, null],
        ['Design', 2, created[1]?.dueDate],
      ]);
      expect(created.map((task) => task.milestoneId)).toEqual([
        milestones[0]?.id,
        milestones[1]?.id,
        null,
      ]);

      // Audit, in the run's transaction.
      expect(await auditOf(run.id)).toMatchObject([
        {
          action: 'template_run.created',
          actorId: cast.employee.id,
          after: expect.objectContaining({
            templateId: projectTemplate,
            trigger: 'manual',
            projectId: project.id,
            taskCount: 3,
            milestonesCreated: 1,
          }),
        },
      ]);
      expect(await auditOf(ids[1] ?? '')).toMatchObject([
        {
          action: 'task.created',
          actorId: cast.employee.id,
          after: expect.objectContaining({ templateRunId: run.id, title: 'Logo' }),
        },
      ]);
      expect(await auditOf(milestones[1]?.id ?? '')).toMatchObject([
        { action: 'project_milestone.created', actorId: cast.employee.id },
      ]);

      // Run history: by project, by task, with its tasks.
      const byProject = await client.get(
        `/api/template-runs?projectId=${project.id}`,
        cast.employee.cookie,
      );
      expect(templateRunPageSchema.parse(await byProject.json())).toMatchObject({
        total: 1,
        items: [{ id: run.id }],
      });
      const byTask = await client.get(
        `/api/template-runs?taskId=${ids[1]}&include=tasks`,
        designer.cookie,
      );
      const page = templateRunPageSchema.parse(await byTask.json());
      expect(page.items[0]?.tasks?.map((task) => [task.title, task.status])).toEqual([
        ['Brief', 'new'],
        ['Logo', 'new'],
        ['Handover', 'new'],
      ]);

      // Rule 15: a second application is allowed and warned about; Design now exists.
      const again = await planned(projectTemplate, cast.am.cookie, { projectId: project.id });
      expect(again.warnings).toEqual([{ type: 'applied_before', department: null, count: 1 }]);
      expect(again.milestonesToCreate).toEqual([]);
    });

    it('takes the chosen start date and assignees, and checks them (rules 6, 10)', async () => {
      const project = await cast.createProject(clientId);
      const start = addDays(today > project.startDate ? today : project.startDate, 10);
      const plan = await planned(projectTemplate, cast.am.cookie, {
        projectId: project.id,
        startDate: start,
        assignees: [
          { department: 'marketing', userId: marketer.id },
          { department: 'design', userId: null },
        ],
      });
      expect(plan.startDate).toBe(start);
      expect(plan.tasks.map((task) => task.assignee?.id ?? null)).toEqual([
        marketer.id,
        null,
        null,
      ]);

      await expectError(
        await preview(projectTemplate, cast.am.cookie, {
          projectId: project.id,
          startDate: addDays(today, -1),
        }),
        400,
        'INVALID_DATES',
      );
      await expectError(
        await apply(projectTemplate, cast.am.cookie, {
          projectId: project.id,
          assignees: [{ department: 'marketing', userId: designer.id }],
        }),
        400,
        'INVALID_ASSIGNEE',
      );
    });

    it('replaces a default assignee who left the department with the queue (rule 10)', async () => {
      const leaver = await cast.signedIn({ departments: [{ code: 'design' }] });
      const template = await createTemplate({
        name: `قالب مغادر ${cast.run}`,
        kind: 'project',
        steps: [{ key: 'a', title: 'Poster', department: 'design', dueDay: 2 }],
        assignees: [{ department: 'design', userId: leaver.id }],
      });
      await db
        .update(departmentMembers)
        .set({ departmentId: await departmentId(db, 'marketing') })
        .where(eq(departmentMembers.userId, leaver.id));
      const project = await cast.createProject(clientId);
      // Sending the unchanged default is not an error: it is replaced.
      const body = {
        projectId: project.id,
        assignees: [{ department: 'design' as const, userId: leaver.id }],
      };
      const plan = await planned(template.id, cast.am.cookie, body);
      expect(plan.tasks[0]).toMatchObject({ assignee: null, assigneeReplaced: true });
      expect(plan.warnings).toEqual([
        { type: 'assignee_replaced', department: 'design', count: 1 },
      ]);
      const run = await applied(template.id, cast.am.cookie, body);
      expect((await runTasks(run.id))[0]?.assigneeId).toBeNull();
    });

    it('warns about tasks due after the project', async () => {
      const project = await cast.createProject(clientId, { dueDate: '2026-10-01' });
      const plan = await planned(projectTemplate, cast.am.cookie, { projectId: project.id });
      const late = plan.tasks.filter((task) => task.dueDate > '2026-10-01').length;
      expect(plan.warnings).toEqual([{ type: 'due_after_project', department: null, count: late }]);
    });

    it('is refused out of scope (actions table)', async () => {
      const project = await cast.createProject(clientId);
      const stranger = await cast.signedIn();
      for (const cookie of [cast.otherAm.cookie, stranger.cookie]) {
        expect((await preview(projectTemplate, cookie, { projectId: project.id })).status).toBe(
          403,
        );
        expect((await apply(projectTemplate, cookie, { projectId: project.id })).status).toBe(403);
      }
      expect(
        (await preview(projectTemplate, cast.am.cookie, { projectId: randomUUID() })).status,
      ).toBe(404);
      expect((await preview(randomUUID(), cast.am.cookie, { projectId: project.id })).status).toBe(
        404,
      );
      expect((await preview(projectTemplate, cast.am.cookie, {})).status).toBe(400);
    });

    it('needs a running project of a working client and a live project template (rule 15)', async () => {
      await expectError(
        await preview(monthlyTemplate, cast.am.cookie, {
          projectId: (await cast.createProject(clientId)).id,
        }),
        400,
        'TEMPLATE_KIND_MISMATCH',
      );

      const closed = await cast.createProject(clientId);
      await db.update(projects).set({ status: 'completed' }).where(eq(projects.id, closed.id));
      await expectError(
        await apply(projectTemplate, cast.am.cookie, { projectId: closed.id }),
        409,
        'PROJECT_CLOSED',
      );

      const archived = await cast.createProject(clientId);
      await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, archived.id));
      await expectError(
        await apply(projectTemplate, cast.gm.cookie, { projectId: archived.id }),
        409,
        'PROJECT_ARCHIVED',
      );

      const endedClient = await cast.createClient();
      const ended = await cast.createProject(endedClient.id);
      await db.update(clients).set({ status: 'ended' }).where(eq(clients.id, endedClient.id));
      await expectError(
        await apply(projectTemplate, cast.gm.cookie, { projectId: ended.id }),
        409,
        'CLIENT_ENDED',
      );

      const archivedClient = await cast.createClient();
      const orphan = await cast.createProject(archivedClient.id);
      await db
        .update(clients)
        .set({ archivedAt: new Date() })
        .where(eq(clients.id, archivedClient.id));
      await expectError(
        await apply(projectTemplate, cast.gm.cookie, { projectId: orphan.id }),
        409,
        'CLIENT_ARCHIVED',
      );

      const old = await createTemplate({
        name: `قالب مؤرشف ${cast.run}`,
        kind: 'project',
        steps: [{ key: 'a', title: 'Old', department: 'design', dueDay: 1 }],
      });
      await client.post(`/api/templates/${old.id}/archive`, cast.operations.cookie);
      await expectError(
        await apply(old.id, cast.am.cookie, { projectId: (await cast.createProject(clientId)).id }),
        409,
        'TEMPLATE_ARCHIVED',
      );
    });

    it('refuses a run that would pass 30 milestones, naming the stages (edge case 5)', async () => {
      const project = await cast.createProject(clientId, {
        milestones: Array.from({ length: 30 }, (_, i) => ({ name: `M${i + 1}` })),
      });
      const body = await expectError(
        await preview(projectTemplate, cast.am.cookie, { projectId: project.id }),
        409,
        'LIMIT_REACHED',
      );
      expect(body.details).toEqual({ stages: ['Discovery', 'Design'] });
    });
  });

  describe("a retainer's monthly template", () => {
    it('links a monthly template for client-scope users only (rule 19)', async () => {
      const { retainer, cycle } = await startedRetainer();
      expect(await retainerTemplate(retainer.id)).toMatchObject({
        template: null,
        cycle: { id: cycle.id },
        run: null,
        lines: [
          { kind: 'design', committed: 12, tasks: 0, missing: 12, canGenerate: false },
          { kind: 'reel', committed: 4, tasks: 0, missing: 4, canGenerate: false },
        ],
        permissions: { canLink: true, canGenerate: false },
      });
      expect((await retainerTemplate(retainer.id, cast.employee.cookie)).permissions).toEqual({
        canLink: false,
        canGenerate: false,
      });

      expect((await linkTemplate(retainer.id, cast.employee.cookie, monthlyTemplate)).status).toBe(
        403,
      );
      expect((await linkTemplate(retainer.id, cast.otherAm.cookie, monthlyTemplate)).status).toBe(
        403,
      );
      expect((await linkTemplate(randomUUID(), cast.am.cookie, monthlyTemplate)).status).toBe(404);
      expect((await linkTemplate(retainer.id, cast.am.cookie, randomUUID())).status).toBe(404);
      await expectError(
        await linkTemplate(retainer.id, cast.am.cookie, projectTemplate),
        400,
        'TEMPLATE_KIND_MISMATCH',
      );

      const linked = await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      expect(linked.status).toBe(200);
      // Rule 19: the current cycle is not generated by linking.
      expect(retainerTemplateSchema.parse(await linked.json())).toMatchObject({
        template: { id: monthlyTemplate, archived: false },
        run: null,
        lines: [
          { kind: 'design', canGenerate: true },
          { kind: 'reel', canGenerate: true },
        ],
        permissions: { canLink: true, canGenerate: true },
      });
      expect(await cycleRuns(cycle.id)).toEqual([]);
      // Linking the same template again changes nothing.
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      const changes = (await auditOf(retainer.id)).filter(
        (entry) => entry.action === 'retainer.template_changed',
      );
      expect(changes).toMatchObject([
        { before: { template: null }, after: { template: { id: monthlyTemplate } } },
      ]);

      const unlinked = await linkTemplate(retainer.id, cast.am.cookie, null);
      expect(retainerTemplateSchema.parse(await unlinked.json()).template).toBeNull();
    });

    it("generates the current cycle's tasks by hand once (rules 8, 9, 12, 17)", async () => {
      const { retainer, cycle, lines } = await startedRetainer();
      const [design, reel] = lines;
      await expectError(
        await preview(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id }),
        409,
        'NO_TEMPLATE',
      );
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      expect(
        (await preview(monthlyTemplate, cast.employee.cookie, { retainerCycleId: cycle.id }))
          .status,
      ).toBe(403);
      await expectError(
        await preview(projectTemplate, cast.am.cookie, { retainerCycleId: cycle.id }),
        409,
        'TEMPLATE_NOT_LINKED',
      );

      const plan = await planned(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id });
      expect(plan.taskCount).toBe(17);
      const planKey = plan.tasks[0]?.key;
      expect(plan.tasks[0]).toMatchObject({ title: 'Plan', cycleLineId: null, dependsOn: [] });
      const designs = plan.tasks.filter((task) => task.cycleLineId === design?.id);
      expect(designs.map((task) => task.title)).toEqual(
        Array.from({ length: 12 }, (_, i) => `Design ${i + 1}`),
      );
      expect(
        designs.every((task) => task.dependsOn.length === 1 && task.dependsOn[0] === planKey),
      ).toBe(true);
      expect(plan.tasks.filter((task) => task.cycleLineId === reel?.id)).toHaveLength(4);
      expect(
        plan.tasks.every(
          (task) => task.dueDate >= cycle.periodStart && task.dueDate <= cycle.periodEnd,
        ),
      ).toBe(true);
      expect(designs.at(-1)?.assignee?.id).toBe(designer.id);

      const run = await applied(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id });
      expect(run).toMatchObject({
        trigger: 'manual',
        project: null,
        cycle: { id: cycle.id, retainer: { id: retainer.id } },
        taskCount: 17,
        createdBy: { id: cast.am.id },
      });
      const created = await runTasks(run.id);
      expect(created.filter((task) => task.cycleLineId === design?.id)).toHaveLength(12);
      expect(created.every((task) => task.retainerCycleId === cycle.id)).toBe(true);
      const planTask = created.find((task) => task.title === 'Plan');
      const waiting = await dependenciesOf(created.map((task) => task.id));
      expect(waiting).toHaveLength(16);
      expect(waiting.every((edge) => edge.dependsOnId === planTask?.id)).toBe(true);

      const state = await retainerTemplate(retainer.id);
      expect(state.run).toMatchObject({ id: run.id, trigger: 'manual' });
      expect(state.lines.map((line) => [line.kind, line.tasks, line.missing])).toEqual([
        ['design', 12, 0],
        ['reel', 4, 0],
      ]);
      await expectError(
        await apply(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id }),
        409,
        'ALREADY_GENERATED',
      );

      // The F05 counter counts generated tasks.
      await db
        .update(tasks)
        .set({ status: 'delivered', deliveredAt: new Date() })
        .where(eq(tasks.id, created.find((task) => task.title === 'Design 1')?.id ?? ''));
      const detail = await client.get(
        `/api/retainers/${retainer.id}/cycles/${cycle.id}`,
        cast.am.cookie,
      );
      const line = cycleDetailSchema
        .parse(await detail.json())
        .lines.find((l) => l.id === design?.id);
      expect(line).toMatchObject({ delivered: 1, tasks: { total: 12, delivered: 1 } });

      // Run history of the retainer.
      const history = await client.get(
        `/api/template-runs?retainerId=${retainer.id}`,
        cast.employee.cookie,
      );
      expect(templateRunPageSchema.parse(await history.json()).items.map((r) => r.id)).toEqual([
        run.id,
      ]);
    });

    it('generates the missing tasks of a grown line (rule 18)', async () => {
      const { retainer, cycle, lines } = await startedRetainer();
      const [design] = lines;
      const designId = design?.id ?? '';
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      await applied(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id });
      await expectError(
        await missingTasks(retainer.id, cycle.id, designId, cast.am.cookie),
        409,
        'NOTHING_MISSING',
      );
      const raised = await client.request(
        'PATCH',
        `/api/retainers/${retainer.id}/cycles/${cycle.id}/lines/${designId}`,
        { cookie: cast.am.cookie, body: { committedQuantity: 14, reason: 'Two more this month' } },
      );
      expect(raised.status).toBe(200);
      expect((await retainerTemplate(retainer.id)).lines[0]).toMatchObject({
        committed: 14,
        tasks: 12,
        missing: 2,
        canGenerate: true,
      });

      expect(
        (await missingTasks(retainer.id, cycle.id, designId, cast.employee.cookie)).status,
      ).toBe(403);
      expect((await missingTasks(retainer.id, cycle.id, randomUUID(), cast.am.cookie)).status).toBe(
        404,
      );
      const response = await missingTasks(retainer.id, cycle.id, designId, cast.am.cookie);
      expect(response.status).toBe(201);
      const run = templateRunSchema.parse(await response.json());
      expect(run).toMatchObject({
        trigger: 'missing_tasks',
        cycleLine: { id: designId, kind: 'design' },
        taskCount: 2,
      });
      const created = await runTasks(run.id);
      expect(created.map((task) => [task.title, task.cycleLineId, task.instance])).toEqual([
        ['Design 13', designId, 13],
        ['Design 14', designId, 14],
      ]);
      expect(await dependenciesOf(created.map((task) => task.id))).toEqual([]);
      expect((await retainerTemplate(retainer.id)).lines[0]).toMatchObject({
        tasks: 14,
        missing: 0,
      });

      // A cycle line whose kind the template does not repeat.
      const added = await client.post(
        `/api/retainers/${retainer.id}/cycles/${cycle.id}/lines`,
        cast.am.cookie,
        {
          kind: 'story',
          committedQuantity: 2,
          reason: 'Stories this month',
        },
      );
      expect(added.status).toBe(201);
      const story = (await retainerTemplate(retainer.id)).lines.find((l) => l.kind === 'story');
      expect(story).toMatchObject({ missing: 2, canGenerate: false });
      await expectError(
        await missingTasks(retainer.id, cycle.id, story?.id ?? '', cast.am.cookie),
        409,
        'NO_REPEATED_STEP',
      );

      await linkTemplate(retainer.id, cast.am.cookie, null);
      await expectError(
        await missingTasks(retainer.id, cycle.id, designId, cast.am.cookie),
        409,
        'NO_TEMPLATE',
      );
    });

    it('generates a month once when two runs arrive together (edge case 2)', async () => {
      const { retainer, cycle } = await startedRetainer();
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      const responses = await Promise.all([
        apply(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id }),
        apply(monthlyTemplate, cast.gm.cookie, { retainerCycleId: cycle.id }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const refused = responses.find((response) => response.status === 409);
      if (!refused) throw new Error('No refused run');
      expect(((await refused.json()) as { code: string }).code).toBe('ALREADY_GENERATED');
      expect((await retainerTemplate(retainer.id)).lines[0]).toMatchObject({ tasks: 12 });
    });

    it('counts a cancelled generated task as missing again, and regenerates it (edge case 14)', async () => {
      const { retainer, cycle, lines } = await startedRetainer();
      const designId = lines[0]?.id ?? '';
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      const run = await applied(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id });
      const design = (await runTasks(run.id)).find((task) => task.title === 'Design 1');
      const cancelled = await client.post(`/api/tasks/${design?.id}/status`, cast.gm.cookie, {
        status: 'cancelled',
        note: 'The client dropped this one',
      });
      expect(cancelled.status).toBe(200);
      expect((await retainerTemplate(retainer.id)).lines[0]).toMatchObject({
        tasks: 11,
        missing: 1,
        canGenerate: true,
      });
      const response = await missingTasks(retainer.id, cycle.id, designId, cast.am.cookie);
      expect(response.status).toBe(201);
      expect(templateRunSchema.parse(await response.json()).taskCount).toBe(1);
    });

    it('keeps an archived linked template, which generates nothing', async () => {
      const template = await createTemplate({
        name: `قالب شهري مؤرشف ${cast.run}`,
        kind: 'retainer_cycle',
        steps: [{ key: 'd', title: 'Design', department: 'design', repeatKind: 'design' }],
      });
      const { retainer, cycle, lines } = await startedRetainer();
      await linkTemplate(retainer.id, cast.am.cookie, template.id);
      await client.post(`/api/templates/${template.id}/archive`, cast.operations.cookie);
      expect(await retainerTemplate(retainer.id)).toMatchObject({
        template: { id: template.id, archived: true },
        permissions: { canGenerate: false },
      });
      await expectError(
        await apply(template.id, cast.am.cookie, { retainerCycleId: cycle.id }),
        409,
        'TEMPLATE_ARCHIVED',
      );
      await expectError(
        await missingTasks(retainer.id, cycle.id, lines[0]?.id ?? '', cast.am.cookie),
        409,
        'TEMPLATE_ARCHIVED',
      );
      await expectError(
        await linkTemplate((await cast.createRetainer(clientId)).id, cast.am.cookie, template.id),
        409,
        'TEMPLATE_ARCHIVED',
      );
    });

    it('refuses changes on an ended retainer', async () => {
      const { retainer, cycle } = await startedRetainer();
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      await client.post(`/api/retainers/${retainer.id}/status`, cast.gm.cookie, {
        status: 'ended',
      });
      await expectError(
        await linkTemplate(retainer.id, cast.am.cookie, null),
        409,
        'RETAINER_ENDED',
      );
      await expectError(
        await apply(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id }),
        409,
        'RETAINER_ENDED',
      );
    });
  });

  describe('automatic cycle runs (rule 16)', () => {
    it('generates the tasks when a retainer starts', async () => {
      const retainer = await cast.createRetainer(clientId, { startDate: addDays(today, 40) });
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      const started = await client.request('PATCH', `/api/retainers/${retainer.id}`, {
        cookie: cast.am.cookie,
        body: { startDate: today },
      });
      expect(started.status).toBe(200);
      const state = await retainerTemplate(retainer.id);
      expect(state.run).toMatchObject({ trigger: 'cycle_opened', taskCount: 17 });
    });

    it('generates the tasks when a retainer resumes or is reactivated in a new month', async () => {
      const paused = await startedRetainer();
      await linkTemplate(paused.retainer.id, cast.am.cookie, monthlyTemplate);
      await client.post(`/api/retainers/${paused.retainer.id}/status`, cast.am.cookie, {
        status: 'paused',
      });
      await dropCycles(paused.retainer);
      await client.post(`/api/retainers/${paused.retainer.id}/status`, cast.am.cookie, {
        status: 'active',
      });
      expect((await retainerTemplate(paused.retainer.id)).run).toMatchObject({
        trigger: 'cycle_opened',
        taskCount: 17,
      });

      const ended = await startedRetainer();
      await linkTemplate(ended.retainer.id, cast.am.cookie, monthlyTemplate);
      await client.post(`/api/retainers/${ended.retainer.id}/status`, cast.gm.cookie, {
        status: 'ended',
      });
      await dropCycles(ended.retainer);
      const reactivated = await client.post(
        `/api/retainers/${ended.retainer.id}/status`,
        cast.gm.cookie,
        {
          status: 'active',
        },
      );
      expect(reactivated.status).toBe(200);
      expect((await retainerTemplate(ended.retainer.id)).run).toMatchObject({
        trigger: 'cycle_opened',
        taskCount: 17,
      });
    });

    it('generates the next month on the daily job without a creator, once', async () => {
      const { retainer, cycle, lines } = await startedRetainer();
      await linkTemplate(retainer.id, cast.am.cookie, monthlyTemplate);
      const job = app.get(RetainerCyclesService);
      await job.runDaily(nextMonth);

      const state = await retainerTemplate(retainer.id);
      expect(state.cycle).toMatchObject({ month: nextMonth, periodStart: nextMonth });
      expect(state.run).toMatchObject({ trigger: 'cycle_opened', taskCount: 17, createdBy: null });
      const runId = state.run?.id ?? '';
      const created = await runTasks(runId);
      expect(created.every((task) => task.createdById === null)).toBe(true);
      expect(created.every((task) => task.dueDate >= nextMonth)).toBe(true);
      expect(await auditOf(runId)).toMatchObject([
        { action: 'template_run.created', actorId: null },
      ]);
      expect(await auditOf(created[0]?.id ?? '')).toMatchObject([
        { action: 'task.created', actorId: null },
      ]);
      const system = await db
        .select({ createdById: taskDependencies.createdById })
        .from(taskDependencies)
        .where(
          inArray(
            taskDependencies.taskId,
            created.map((task) => task.id),
          ),
        );
      expect(system.every((edge) => edge.createdById === null)).toBe(true);

      // Idempotent: another run of the job adds nothing.
      await job.runDaily(nextMonth);
      expect(await cycleRuns(state.cycle?.id ?? '')).toHaveLength(1);

      // The closed month takes no more runs.
      await expectError(
        await apply(monthlyTemplate, cast.am.cookie, { retainerCycleId: cycle.id }),
        409,
        'CYCLE_CLOSED',
      );
      await expectError(
        await missingTasks(retainer.id, cycle.id, lines[0]?.id ?? '', cast.am.cookie),
        409,
        'CYCLE_CLOSED',
      );
    });
  });

  it('lists runs by exactly one of project, retainer and task', async () => {
    expect((await client.get('/api/template-runs', cast.employee.cookie)).status).toBe(400);
    const both = `/api/template-runs?projectId=${randomUUID()}&taskId=${randomUUID()}`;
    expect((await client.get(both, cast.employee.cookie)).status).toBe(400);
    expect(
      (await client.get(`/api/template-runs?projectId=${randomUUID()}`, cast.employee.cookie))
        .status,
    ).toBe(404);
    expect(
      (await client.get(`/api/template-runs?taskId=${randomUUID()}`, cast.employee.cookie)).status,
    ).toBe(404);

    // The runs of a task follow the task's visibility: a task of an archived project is read by
    // scope-all holders only (F06 rule 17).
    const project = await cast.createProject(clientId);
    const run = await applied(projectTemplate, cast.am.cookie, { projectId: project.id });
    const [task] = await runTasks(run.id);
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, project.id));
    const byTask = `/api/template-runs?taskId=${task?.id}`;
    expect((await client.get(byTask, cast.employee.cookie)).status).toBe(404);
    const shown = await client.get(byTask, cast.gm.cookie);
    expect(templateRunPageSchema.parse(await shown.json()).items.map((r) => r.id)).toEqual([
      run.id,
    ]);
  });
});
