import type { INestApplication } from '@nestjs/common';
import { type AudienceInput, audiencePreviewSchema, audienceSchema } from '@vertex-hub/contracts';
import { contentPosts, createDatabase, projects, tasks } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AudienceResolver } from '../src/modules/audiences/index.js';
import { seedClientCast } from './client-cast.js';
import { api, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('audiences (F16 part D, rules D1–D2)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let resolver: AudienceResolver;
  let clientId: string;
  let projectId: string;
  const people: Record<string, { id: string }> = {};

  const resolve = (audience: AudienceInput) => resolver.resolve(db, audienceSchema.parse(audience));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    resolver = app.get(AudienceResolver);
    cast = await seedClientCast(db, client);
    const seed = async (name: string, input: Parameters<typeof seedUser>[1] = {}) => {
      const user = await seedUser(db, { name: `${name} ${cast.run}`, ...input });
      cast.trackUser(user.id);
      people[name] = user;
      return user;
    };
    await seed('photoManager', { departments: [{ code: 'photography', manager: true }] });
    await seed('photographer', { departments: [{ code: 'photography' }] });
    await seed('finance', { roles: ['finance'] });
    await seed('openAssignee');
    await seed('deliveredAssignee');
    await seed('clientAssignee');
    await seed('responsible');
    await seed('publishedResponsible');
    await seed('closedManager');
    await seed('invited', { password: null, departments: [{ code: 'photography' }] });
    await seed('archived', { archived: true, departments: [{ code: 'photography' }] });

    const created = await cast.createClient();
    clientId = created.id;
    projectId = (await cast.createProject(clientId, { departments: ['photography'] })).id;
    const closed = await cast.createProject(clientId, {
      projectManagerId: people.closedManager?.id,
    });
    await db
      .update(projects)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(projects.id, closed.id));
    const task = (assigneeId: string | undefined, extra: Partial<typeof tasks.$inferInsert>) => ({
      title: 'مهمة',
      department: 'design' as const,
      dueDate: '2099-01-01',
      clientId,
      needsClientApproval: false,
      createdById: cast.gm.id,
      assigneeId,
      ...extra,
    });
    await db
      .insert(tasks)
      .values([
        task(people.openAssignee?.id, { projectId }),
        task(people.deliveredAssignee?.id, { projectId, status: 'delivered' }),
        task(people.clientAssignee?.id, {}),
      ]);
    const post = (responsibleId: string, extra: Partial<typeof contentPosts.$inferInsert>) => ({
      clientId,
      title: 'منشور',
      type: 'post' as const,
      platforms: ['instagram' as const],
      publishDate: '2099-01-01',
      responsibleId,
      createdById: cast.gm.id,
      ...extra,
    });
    await db.insert(contentPosts).values([
      post(people.responsible?.id as string, {}),
      post(people.publishedResponsible?.id as string, {
        status: 'published',
        publishedAt: new Date(),
        publishedById: cast.gm.id,
        publishedLinks: [{ platform: 'instagram', url: 'https://instagram.com/p/a' }],
        needsClientApproval: false,
      }),
    ]);
  });

  afterAll(async () => {
    await cast?.cleanup();
    await app?.close();
    await connection.close();
  });

  it("resolves a project's team: manager, account manager, open assignees, departments' managers", async () => {
    expect(await resolve({ projects: [projectId] })).toEqual(
      [cast.employee.id, cast.am.id, people.openAssignee?.id, people.photoManager?.id].sort(),
    );
  });

  it("resolves a client's team: account manager, open projects' managers, open assignees, open posts' responsible", async () => {
    expect(await resolve({ clients: [clientId] })).toEqual(
      [
        cast.am.id,
        cast.employee.id,
        people.openAssignee?.id,
        people.clientAssignee?.id,
        people.responsible?.id,
      ].sort(),
    );
  });

  it('resolves departments, roles, people and everyone, active users only, minus exclusions', async () => {
    const photography = await resolve({ departments: ['photography'] });
    expect(photography).toEqual(
      expect.arrayContaining([people.photoManager?.id, people.photographer?.id]),
    );
    expect(photography).not.toContain(people.invited?.id);
    expect(photography).not.toContain(people.archived?.id);
    expect(await resolve({ roles: ['finance'] })).toContain(people.finance?.id);
    expect(await resolve({ roles: ['department_manager'] })).toContain(people.photoManager?.id);
    expect(
      await resolve({
        users: [people.finance?.id as string, people.photographer?.id as string],
        exclude: [people.finance?.id as string],
      }),
    ).toEqual([people.photographer?.id]);
    const everyone = await resolve({ everyone: true });
    expect(everyone).toEqual(expect.arrayContaining([cast.gm.id, people.finance?.id]));
    expect(everyone).not.toContain(people.archived?.id);
    expect(await resolve({ roles: ['employee'] })).toEqual(everyone);
  });

  it('previews the count and the names, and refuses an audience without a source', async () => {
    expect(
      (await client.post('/api/audiences/preview', undefined, { everyone: true })).status,
    ).toBe(401);
    expect((await client.post('/api/audiences/preview', cast.employee.cookie, {})).status).toBe(
      400,
    );
    const response = await client.post('/api/audiences/preview', cast.otherAm.cookie, {
      projects: [projectId],
      exclude: [cast.am.id],
    });
    expect(response.status).toBe(200);
    const preview = audiencePreviewSchema.parse(await response.json());
    expect(preview.count).toBe(3);
    expect(preview.users.map((user) => user.id).sort()).toEqual(
      [cast.employee.id, people.openAssignee?.id, people.photoManager?.id].sort(),
    );
    const photoManager = preview.users.find((user) => user.id === people.photoManager?.id);
    expect(photoManager?.department).toBe('photography');
    // The caller is left out, as the author is left out of what they send (rule D3).
    const own = audiencePreviewSchema.parse(
      await (
        await client.post('/api/audiences/preview', cast.employee.cookie, {
          projects: [projectId],
          exclude: [cast.am.id],
        })
      ).json(),
    );
    expect(own.users.map((user) => user.id)).not.toContain(cast.employee.id);
    expect(own.count).toBe(2);
  });
});
