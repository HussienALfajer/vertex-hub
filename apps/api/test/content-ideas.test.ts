import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  businessDate,
  contentIdeaPageSchema,
  contentIdeaSchema,
  contentIdeasSubjectId,
} from '@vertex-hub/contracts';
import { contentPillars, createDatabase, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08B PR 2, rule C12: the ideas bank. Any user adds an idea; its author edits or drops it while
 * open; edit scope on its client (every holder for one without a client) edits, drops, restores
 * and uses it; Content Management hears of new ideas.
 */
describe('the ideas bank (F08B rule C12)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;
  let employee: Awaited<ReturnType<typeof cast.signedIn>>;
  let other: Awaited<ReturnType<typeof cast.signedIn>>;
  const pillars: string[] = [];

  const ideas = '/api/content/ideas';
  const add = (cookie: string | undefined, body: object) => client.post(ideas, cookie, body);
  const patch = (id: string, cookie: string, body: object) =>
    client.request('PATCH', `${ideas}/${id}`, { cookie, body });
  const drop = (id: string, cookie: string, body: object = {}) =>
    client.post(`${ideas}/${id}/drop`, cookie, body);
  const restore = (id: string, cookie: string) => client.post(`${ideas}/${id}/restore`, cookie);

  async function addOk(cookie: string, body: object = {}) {
    const response = await add(cookie, {
      text: `فكرة ${cast.run} ${randomUUID().slice(0, 6)}`,
      ...body,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return contentIdeaSchema.parse(await response.json());
  }

  async function list(query: string, cookie: string) {
    const response = await client.get(`${ideas}?${query}`, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return contentIdeaPageSchema.parse(await response.json());
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
    employee = await cast.signedIn({
      name: `موظف ${cast.run}`,
      departments: [{ code: 'development' }],
    });
    other = await cast.signedIn({
      name: `موظف آخر ${cast.run}`,
      departments: [{ code: 'marketing' }],
    });
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    if (pillars.length > 0)
      await db.delete(contentPillars).where(inArray(contentPillars.id, pillars));
    await connection.close();
  });

  it('lets any employee add an idea, and tells Content Management once a day', async () => {
    expect((await add(undefined, { text: 'x' })).status).toBe(401);
    expect((await add(employee.cookie, { text: ' ' })).status).toBe(400);
    const idea = await addOk(employee.cookie, { clientId });
    expect(idea).toMatchObject({
      status: 'open',
      client: { id: clientId },
      createdBy: { id: employee.id },
      post: null,
      permissions: { canEdit: true, canDrop: true, canRestore: false, canUse: false },
    });
    const second = await addOk(employee.cookie);
    expect(second.client).toBeNull();
    const subject = contentIdeasSubjectId(businessDate());
    const [notice] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, cast.writer.id),
          eq(notifications.type, 'content_idea_added'),
          eq(notifications.subjectId, subject),
        ),
      );
    expect(notice?.count).toBeGreaterThanOrEqual(2);
    const ownNotice = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, employee.id), eq(notifications.subjectId, subject)));
    expect(ownNotice).toEqual([]);
    expect((await cast.auditOf(idea.id))[0]).toMatchObject({ action: 'content_idea.created' });
  });

  it('refuses an archived client, an archived pillar and an occasion of another client', async () => {
    const archived = await cast.createClient();
    await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
    expect((await add(employee.cookie, { text: 'فكرة', clientId: archived.id })).status).toBe(409);
    const [pillar] = await db
      .insert(contentPillars)
      .values({ name: `قديم ${cast.run}`, color: 'chart_6', position: 98, archivedAt: new Date() })
      .returning();
    if (pillar) pillars.push(pillar.id);
    await expectError(
      await add(employee.cookie, { text: 'فكرة', pillarId: pillar?.id }),
      400,
      'INVALID_LINK',
    );
    const otherClient = (await cast.createClient()).id;
    const occasion = await client.post('/api/content/occasions', cast.contentManager.cookie, {
      name: `افتتاح ${cast.run}`,
      category: 'general',
      clientId: otherClient,
      calendar: 'once',
      date: cast.inDays(20),
    });
    expect(occasion.status, await occasion.clone().text()).toBe(201);
    const occasionId = ((await occasion.json()) as { id: string }).id;
    await expectError(
      await add(employee.cookie, { text: 'فكرة', clientId, occasionId }),
      400,
      'INVALID_LINK',
    );
  });

  it('lets the author edit and drop an open idea, and edit scope restore it', async () => {
    const idea = await addOk(employee.cookie, { clientId });
    expect((await patch(idea.id, other.cookie, { text: 'تغيير' })).status).toBe(403);
    const edited = await patch(idea.id, employee.cookie, { text: '  نص أوضح  ' });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(contentIdeaSchema.parse(await edited.json()).text).toBe('نص أوضح');
    const dropped = contentIdeaSchema.parse(
      await (await drop(idea.id, employee.cookie, { reason: 'مكررة' })).json(),
    );
    expect(dropped).toMatchObject({ status: 'dropped', dropReason: 'مكررة' });
    // A dropped idea is no longer edited; only edit scope on its client restores it.
    expect((await patch(idea.id, employee.cookie, { text: 'x' })).status).toBe(409);
    expect((await restore(idea.id, employee.cookie)).status).toBe(403);
    expect((await restore(idea.id, cast.otherAm.cookie)).status).toBe(403);
    const restored = contentIdeaSchema.parse(await (await restore(idea.id, cast.am.cookie)).json());
    expect(restored).toMatchObject({ status: 'open', dropReason: null });
    expect((await cast.auditOf(idea.id)).map((entry) => entry.action)).toEqual([
      'content_idea.created',
      'content_idea.updated',
      'content_idea.dropped',
      'content_idea.restored',
    ]);
  });

  it('lets every edit-scope holder handle an idea without a client', async () => {
    const idea = await addOk(employee.cookie);
    const seen = (await list('status=open', cast.otherAm.cookie)).items.find(
      (item) => item.id === idea.id,
    );
    expect(seen?.permissions).toMatchObject({ canEdit: true, canUse: true });
    expect((await drop(idea.id, cast.otherAm.cookie)).status).toBe(200);
    expect((await restore(idea.id, cast.otherAm.cookie)).status).toBe(200);
  });

  it('lists by status, client, author and text', async () => {
    const mine = await addOk(other.cookie, { clientId, text: `قهوة الصباح ${cast.run}` });
    const used = await addOk(other.cookie, { clientId });
    const post = await cast.createPost(cast.writer.cookie, { clientId, ideaId: used.id });
    expect((await list(`mine=true`, other.cookie)).items.map((item) => item.id)).toEqual([mine.id]);
    expect(
      (
        await list(`q=${encodeURIComponent('قهوة الصباح')}&clientId=${clientId}`, cast.gm.cookie)
      ).items.map((item) => item.id),
    ).toEqual([mine.id]);
    const usedPage = await list(`status=used&clientId=${clientId}`, cast.gm.cookie);
    expect(usedPage.items.find((item) => item.id === used.id)?.post).toEqual({
      id: post.id,
      title: post.title,
    });
    // A used idea is never edited or dropped.
    await expectError(await patch(used.id, other.cookie, { text: 'x' }), 409, 'IDEA_USED');
    await expectError(await drop(used.id, cast.gm.cookie), 409, 'IDEA_USED');
    expect((await client.get(`${ideas}?status=maybe`, cast.gm.cookie)).status).toBe(400);
    expect((await client.get(ideas)).status).toBe(401);
  });
});
