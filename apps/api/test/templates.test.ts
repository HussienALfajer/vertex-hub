import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type CreateTemplateInput,
  type TemplateDetail,
  templateDetailSchema,
  templatePageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  retainerTemplates,
  users,
  workTemplates,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api, removeTemplates } from './helpers.js';
import { startApp } from './start-app.js';

describe('templates', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let writer: Awaited<ReturnType<typeof cast.signedIn>>;
  const templates: string[] = [];

  const put = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', `/api/templates/${id}`, { cookie, body });
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  const projectInput = (): CreateTemplateInput => ({
    name: `قالب ${cast.run} ${randomUUID().slice(0, 6)}`,
    kind: 'project',
    description: 'For tests',
    stages: [
      { key: 'discovery', name: 'Discovery' },
      { key: 'design', name: 'Design' },
    ],
    steps: [
      { key: 'brief', stageKey: 'discovery', title: 'Brief', department: 'marketing', dueDay: 2 },
      {
        key: 'logo',
        stageKey: 'design',
        title: 'Logo',
        department: 'design',
        dueDay: 5,
        checklist: ['Three directions'],
        dependsOn: ['brief'],
      },
      { key: 'handover', title: 'Handover', department: 'design', dueDay: 8, dependsOn: ['logo'] },
    ],
    assignees: [{ department: 'design', userId: cast.employee.id }],
  });

  async function create(input: CreateTemplateInput, cookie = cast.operations.cookie) {
    const response = await client.post('/api/templates', cookie, input);
    if (response.status !== 201) {
      throw new Error(`Template creation failed: ${response.status} ${await response.text()}`);
    }
    const created = templateDetailSchema.parse(await response.json());
    templates.push(created.id);
    return created;
  }

  async function detail(id: string, cookie: string): Promise<TemplateDetail> {
    const response = await client.get(`/api/templates/${id}`, cookie);
    expect(response.status).toBe(200);
    return templateDetailSchema.parse(await response.json());
  }

  /** The template as a PUT body, keeping every row by its id. */
  const asInput = (template: TemplateDetail) => ({
    name: template.name,
    description: template.description,
    stages: template.stages.map((stage) => ({ key: stage.id, name: stage.name })),
    steps: template.steps.map(({ id, stageId, position, dependsOn, ...step }) => ({
      ...step,
      key: id,
      stageKey: stageId,
      dependsOn,
    })),
    assignees: template.assignees.map((a) => ({ department: a.department, userId: a.user.id })),
  });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    writer = await cast.signedIn({ departments: [{ code: 'content_management' }] });
  });

  afterAll(async () => {
    await app?.close();
    await removeTemplates(db, templates);
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/templates')).status).toBe(401);
    expect((await client.get(`/api/templates/${id}`)).status).toBe(401);
    expect((await client.post('/api/templates', undefined, projectInput())).status).toBe(401);
    expect((await put(id, undefined, {})).status).toBe(401);
    expect((await client.post(`/api/templates/${id}/archive`)).status).toBe(401);
    expect((await client.post(`/api/templates/${id}/restore`)).status).toBe(401);
  });

  describe('seed templates', () => {
    it('ships the four drafts to every user', async () => {
      const response = await client.get('/api/templates?pageSize=100', cast.employee.cookie);
      expect(response.status).toBe(200);
      const page = templatePageSchema.parse(await response.json());
      const seeds = Object.fromEntries(
        page.items
          .filter((item) =>
            [
              'هوية بصرية',
              'فيديو ترويجي',
              'موقع إلكتروني',
              'دورة التواصل الاجتماعي الشهرية',
            ].includes(item.name),
          )
          .map((item) => [item.name, item]),
      );
      expect(Object.keys(seeds)).toHaveLength(4);
      expect(seeds['موقع إلكتروني']).toMatchObject({
        kind: 'project',
        stepCount: 10,
        departments: ['design', 'content_management', 'development'],
        warningCount: 0,
      });
      expect(seeds['دورة التواصل الاجتماعي الشهرية']).toMatchObject({
        kind: 'retainer_cycle',
        stepCount: 9,
      });
    });

    it('seeds stages, days and dependencies', async () => {
      const [website] = await db
        .select({ id: workTemplates.id })
        .from(workTemplates)
        .where(eq(workTemplates.name, 'موقع إلكتروني'));
      const template = await detail(website?.id ?? '', cast.employee.cookie);
      expect(template.stages.map((stage) => stage.name)).toEqual([
        'الاستكشاف',
        'التصميم',
        'التنفيذ',
        'الاختبار',
        'التسليم',
      ]);
      const byTitle = new Map(template.steps.map((step) => [step.title, step]));
      expect(byTitle.get('إدخال المحتوى')?.dependsOn).toEqual([
        byTitle.get('جرد المحتوى')?.id,
        byTitle.get('الخلفية ونظام إدارة المحتوى')?.id,
      ]);
      expect(template.permissions).toEqual({ canEdit: false, canArchive: false });

      const [monthly] = await db
        .select({ id: workTemplates.id })
        .from(workTemplates)
        .where(eq(workTemplates.name, 'دورة التواصل الاجتماعي الشهرية'));
      const cycle = await detail(monthly?.id ?? '', cast.employee.cookie);
      expect(cycle.steps.filter((step) => step.repeatKind).map((step) => step.repeatKind)).toEqual([
        'design',
        'post',
        'story',
        'reel',
        'video',
        'photo_shoot',
        'ad_campaign',
        'monthly_report',
      ]);
    });
  });

  describe('list', () => {
    it('filters by kind and name, and sorts', async () => {
      const a = await create({ ...projectInput(), name: `ب ${cast.run} list` });
      const b = await create({ ...projectInput(), name: `أ ${cast.run} list` });
      const response = await client.get(
        `/api/templates?search=${encodeURIComponent(`${cast.run} list`)}&kind=project`,
        cast.employee.cookie,
      );
      const page = templatePageSchema.parse(await response.json());
      expect(page.items.map((item) => item.id)).toEqual([b.id, a.id]);
      expect(page.items[0]).toMatchObject({
        stepCount: 3,
        departments: ['marketing', 'design'],
        linkedRetainerCount: 0,
      });
      const monthly = await client.get(
        `/api/templates?search=${encodeURIComponent(`${cast.run} list`)}&kind=retainer_cycle`,
        cast.employee.cookie,
      );
      expect(templatePageSchema.parse(await monthly.json()).total).toBe(0);
    });

    it('shows archived templates to template managers only', async () => {
      expect((await client.get('/api/templates?archived=true', cast.employee.cookie)).status).toBe(
        403,
      );
      expect((await client.get('/api/templates?archived=true', cast.am.cookie)).status).toBe(403);
      expect(
        (await client.get('/api/templates?archived=true', cast.operations.cookie)).status,
      ).toBe(200);
    });
  });

  describe('create', () => {
    it('saves the whole document with defaults and audits it', async () => {
      const created = await create(projectInput());
      expect(created).toMatchObject({
        kind: 'project',
        description: 'For tests',
        archivedAt: null,
        warnings: [],
        linkedRetainers: [],
        permissions: { canEdit: true, canArchive: true },
      });
      expect(created.stages.map((stage) => [stage.name, stage.position])).toEqual([
        ['Discovery', 1],
        ['Design', 2],
      ]);
      const [brief, logo, handover] = created.steps;
      expect(logo).toMatchObject({
        stageId: created.stages[1]?.id,
        position: 2,
        priority: 'normal',
        needsClientApproval: true,
        revisionLimit: 2,
        checklist: ['Three directions'],
        repeatKind: null,
        spreadFromDay: null,
        dependsOn: [brief?.id],
      });
      expect(handover).toMatchObject({ stageId: null, dependsOn: [logo?.id] });
      expect(created.assignees).toEqual([
        {
          department: 'design',
          user: { id: cast.employee.id, name: cast.employee.name, archived: false },
          valid: true,
        },
      ]);
      const [entry, assignee] = await auditOf(created.id);
      expect(entry).toMatchObject({
        action: 'template.created',
        entityType: 'template',
        actorId: cast.operations.id,
        after: { kind: 'project', stages: 2, steps: 3 },
      });
      expect(assignee).toMatchObject({
        action: 'template.assignees_updated',
        before: { department: 'design', user: null },
        after: { department: 'design', user: { id: cast.employee.id } },
      });
    });

    it('saves a monthly template with repeated steps', async () => {
      const created = await create({
        name: `شهري ${cast.run}`,
        kind: 'retainer_cycle',
        steps: [
          { key: 'plan', title: 'Plan', department: 'content_management', dueDay: 3 },
          {
            key: 'design',
            title: 'Design',
            department: 'design',
            repeatKind: 'design',
            dependsOn: ['plan'],
          },
          {
            key: 'blog',
            title: 'Blog',
            department: 'content_management',
            repeatKind: 'other',
            repeatLabel: 'Blog',
            spreadFromDay: 10,
          },
        ],
      });
      expect(
        created.steps.map((step) => [step.repeatKind, step.dueDay, step.spreadFromDay]),
      ).toEqual([
        [null, 3, null],
        ['design', null, 1],
        ['other', null, 10],
      ]);
      expect(created.steps[2]?.repeatLabel).toBe('Blog');
    });

    it('lets the General Manager create templates, nobody else', async () => {
      await create(projectInput(), cast.gm.cookie);
      for (const cookie of [cast.employee.cookie, cast.am.cookie]) {
        expect((await client.post('/api/templates', cookie, projectInput())).status).toBe(403);
      }
    });

    it('checks the kind rules (rules 1–3)', async () => {
      const input = projectInput();
      const response = await client.post('/api/templates', cast.operations.cookie, {
        ...input,
        steps: [{ ...input.steps[0], repeatKind: 'design' }],
        assignees: [],
      });
      expect(response.status).toBe(400);
      expect(
        (await client.post('/api/templates', cast.operations.cookie, { ...input, steps: [] }))
          .status,
      ).toBe(400);
    });

    it('refuses a name in use, whatever the case', async () => {
      const name = `Brand ${cast.run}`;
      await create({ ...projectInput(), name });
      await expectError(
        await client.post('/api/templates', cast.operations.cookie, {
          ...projectInput(),
          name: name.toUpperCase(),
        }),
        409,
        'TEMPLATE_NAME_TAKEN',
      );
    });

    it('needs default assignees who are members of the department (rule 4)', async () => {
      await expectError(
        await client.post('/api/templates', cast.operations.cookie, {
          ...projectInput(),
          assignees: [{ department: 'design', userId: writer.id }],
        }),
        400,
        'INVALID_ASSIGNEE',
      );
    });
  });

  describe('replace', () => {
    it('keeps rows by id, adds and removes the rest, and audits a summary', async () => {
      const created = await create(projectInput());
      const input = asInput(created);
      const [brief, logo] = input.steps;
      const body = {
        ...input,
        name: `${created.name} v2`,
        stages: [{ key: created.stages[1]?.id, name: 'Visual design' }],
        steps: [
          { ...logo, stageKey: created.stages[1]?.id, dueDay: 6, dependsOn: [] },
          {
            key: 'new',
            title: 'Guidelines',
            department: 'design',
            dueDay: 9,
            dependsOn: [logo?.key],
          },
        ],
        assignees: [{ department: 'design', userId: cast.am.id }],
      };
      const response = await put(created.id, cast.operations.cookie, body);
      expect(response.status).toBe(200);
      const updated = templateDetailSchema.parse(await response.json());
      expect(updated.name).toBe(`${created.name} v2`);
      expect(updated.stages).toEqual([
        { id: created.stages[1]?.id, name: 'Visual design', position: 1 },
      ]);
      expect(updated.steps.map((step) => [step.title, step.position])).toEqual([
        ['Logo', 1],
        ['Guidelines', 2],
      ]);
      expect(updated.steps[0]?.id).toBe(logo?.key);
      expect(updated.steps[1]?.dependsOn).toEqual([logo?.key]);
      expect(updated.steps.some((step) => step.id === brief?.key)).toBe(false);
      expect(updated.assignees.map((a) => a.user.id)).toEqual([cast.am.id]);

      const entries = await auditOf(created.id);
      expect(entries.map((entry) => entry.action)).toEqual([
        'template.created',
        'template.assignees_updated',
        'template.updated',
        'template.assignees_updated',
      ]);
      expect(entries[2]).toMatchObject({
        before: { name: created.name },
        after: {
          name: `${created.name} v2`,
          stagesChanged: ['Visual design'],
          stagesRemoved: ['Discovery'],
          stepsAdded: ['Guidelines'],
          stepsChanged: ['Logo'],
          stepsRemoved: ['Brief', 'Handover'],
        },
      });
      expect(entries[3]).toMatchObject({
        before: { department: 'design', user: { id: cast.employee.id } },
        after: { department: 'design', user: { id: cast.am.id } },
      });
    });

    it('writes nothing to the audit log when nothing changed', async () => {
      const created = await create(projectInput());
      expect((await put(created.id, cast.operations.cookie, asInput(created))).status).toBe(200);
      expect((await auditOf(created.id)).map((entry) => entry.action)).toEqual([
        'template.created',
        'template.assignees_updated',
      ]);
    });

    it('audits a reorder of the stages alone', async () => {
      const created = await create(projectInput());
      const input = asInput(created);
      const response = await put(created.id, cast.operations.cookie, {
        ...input,
        stages: [...input.stages].reverse(),
      });
      expect(response.status).toBe(200);
      const updated = templateDetailSchema.parse(await response.json());
      expect(updated.stages.map((stage) => stage.name)).toEqual(['Design', 'Discovery']);
      const entries = await auditOf(created.id);
      expect(entries.at(-1)).toMatchObject({
        action: 'template.updated',
        after: { stagesChanged: ['Design', 'Discovery'] },
      });
    });

    it('checks the rules against the stored kind', async () => {
      const created = await create(projectInput());
      const input = asInput(created);
      const response = await put(created.id, cast.operations.cookie, {
        ...input,
        steps: input.steps.map((step) => ({ ...step, dueDay: null, repeatKind: 'design' })),
      });
      expect(response.status).toBe(400);
    });

    it('is for template managers only, and answers 404 for an unknown template', async () => {
      const created = await create(projectInput());
      expect((await put(created.id, cast.employee.cookie, asInput(created))).status).toBe(403);
      expect((await put(randomUUID(), cast.operations.cookie, asInput(created))).status).toBe(404);
    });

    it('refuses a name in use by another template', async () => {
      const first = await create(projectInput());
      const second = await create(projectInput());
      await expectError(
        await put(second.id, cast.operations.cookie, { ...asInput(second), name: first.name }),
        409,
        'TEMPLATE_NAME_TAKEN',
      );
    });
  });

  describe('invalid default assignees (rule 4, edge case 10)', () => {
    it('warns once the default leaves, keeps it on save, and refuses a new invalid one', async () => {
      const designer = await cast.signedIn({ name: `مصمم ${cast.run}` });
      const created = await create({
        ...projectInput(),
        assignees: [{ department: 'design', userId: designer.id }],
      });
      await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, designer.id));

      const read = await detail(created.id, cast.operations.cookie);
      expect(read.warnings).toEqual([{ type: 'invalid_assignee', department: 'design' }]);
      expect(read.assignees[0]).toMatchObject({ valid: false, user: { archived: true } });
      const response = await client.get(
        `/api/templates?search=${encodeURIComponent(created.name)}`,
        cast.operations.cookie,
      );
      expect(templatePageSchema.parse(await response.json()).items[0]?.warningCount).toBe(1);

      const renamed = { ...asInput(read), name: `${read.name} kept` };
      expect((await put(created.id, cast.operations.cookie, renamed)).status).toBe(200);
      await expectError(
        await put(created.id, cast.operations.cookie, {
          ...renamed,
          assignees: [{ department: 'marketing', userId: designer.id }],
        }),
        400,
        'INVALID_ASSIGNEE',
      );
    });
  });

  describe('archive and restore', () => {
    it('archives, hides from readers, and restores', async () => {
      const created = await create(projectInput());
      const archived = await client.post(
        `/api/templates/${created.id}/archive`,
        cast.operations.cookie,
      );
      expect(archived.status).toBe(200);
      const body = templateDetailSchema.parse(await archived.json());
      expect(body.archivedAt).not.toBeNull();
      expect(body.permissions).toEqual({ canEdit: false, canArchive: true });

      await expectError(
        await client.post(`/api/templates/${created.id}/archive`, cast.operations.cookie),
        409,
        'TEMPLATE_ARCHIVED',
      );
      await expectError(
        await put(created.id, cast.operations.cookie, asInput(created)),
        409,
        'TEMPLATE_ARCHIVED',
      );
      expect((await client.get(`/api/templates/${created.id}`, cast.employee.cookie)).status).toBe(
        404,
      );
      const search = `search=${encodeURIComponent(created.name)}`;
      const active = await client.get(`/api/templates?${search}`, cast.operations.cookie);
      expect(templatePageSchema.parse(await active.json()).total).toBe(0);
      const listed = await client.get(
        `/api/templates?${search}&archived=true`,
        cast.operations.cookie,
      );
      expect(templatePageSchema.parse(await listed.json()).items.map((item) => item.id)).toEqual([
        created.id,
      ]);

      const restored = await client.post(
        `/api/templates/${created.id}/restore`,
        cast.operations.cookie,
      );
      expect(restored.status).toBe(200);
      expect(templateDetailSchema.parse(await restored.json()).archivedAt).toBeNull();
      await expectError(
        await client.post(`/api/templates/${created.id}/restore`, cast.operations.cookie),
        409,
        'TEMPLATE_NOT_ARCHIVED',
      );
      expect((await auditOf(created.id)).map((entry) => entry.action)).toEqual([
        'template.created',
        'template.assignees_updated',
        'template.archived',
        'template.restored',
      ]);
    });

    it('frees the name while archived and refuses a restore onto a taken name', async () => {
      const created = await create(projectInput());
      await client.post(`/api/templates/${created.id}/archive`, cast.operations.cookie);
      await create({ ...projectInput(), name: created.name });
      await expectError(
        await client.post(`/api/templates/${created.id}/restore`, cast.operations.cookie),
        409,
        'TEMPLATE_NAME_TAKEN',
      );
    });

    it('is for template managers only', async () => {
      const created = await create(projectInput());
      for (const action of ['archive', 'restore']) {
        expect(
          (await client.post(`/api/templates/${created.id}/${action}`, cast.employee.cookie))
            .status,
        ).toBe(403);
      }
      expect(
        (await client.post(`/api/templates/${randomUUID()}/archive`, cast.operations.cookie))
          .status,
      ).toBe(404);
    });
  });

  it('lists the retainers linked to a monthly template', async () => {
    const monthly = await create({
      name: `مرتبط ${cast.run}`,
      kind: 'retainer_cycle',
      steps: [{ key: 'plan', title: 'Plan', department: 'design', dueDay: 1 }],
    });
    const { id: clientId, tradeName } = await cast.createClient();
    const retainer = await cast.createRetainer(clientId);
    await db
      .insert(retainerTemplates)
      .values({ retainerId: retainer.id, templateId: monthly.id, linkedById: cast.gm.id });

    expect((await detail(monthly.id, cast.employee.cookie)).linkedRetainers).toEqual([
      { id: retainer.id, name: retainer.name, client: { id: clientId, name: tradeName } },
    ]);
    const response = await client.get(
      `/api/templates?search=${encodeURIComponent(monthly.name)}`,
      cast.employee.cookie,
    );
    expect(templatePageSchema.parse(await response.json()).items[0]?.linkedRetainerCount).toBe(1);
    await db.delete(retainerTemplates).where(and(eq(retainerTemplates.retainerId, retainer.id)));
  });
});
