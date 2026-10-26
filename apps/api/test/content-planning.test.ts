import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  clientContentSettingsSchema,
  contentAgencySettingsSchema,
  contentCalendarSchema,
  contentGridSchema,
  contentOccasionListSchema,
  contentOccasionSchema,
  contentPillarListSchema,
  contentPillarSchema,
  contentPlanningSchema,
  contentSnippetListSchema,
  contentSnippetSchema,
  contentWeekSubjectId,
  type PostingWindow,
  weekday,
} from '@vertex-hub/contracts';
import {
  contentIdeas,
  contentPillars,
  contentPlanningSettings,
  contentPosts,
  createDatabase,
  notifications,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostReminders } from '../src/modules/content/post-reminders.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/*
 * F08B PR 2, part C and the jobs of part D: pillars, best times and client settings, occasions
 * with confirmed dates, snippets, the planning check on the calendar and its own endpoint, the
 * Instagram grid, `post_at_risk`, the weekly check and `post_publish_shortly` for approved posts.
 */
describe('planning aids (F08B part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;
  let clientId: string;
  const pillars: string[] = [];

  const get = async <T>(path: string, parse: { parse: (value: unknown) => T }, cookie?: string) => {
    const response = await client.get(path, cookie ?? cast.gm.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return parse.parse(await response.json());
  };
  const put = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', path, { cookie, body });

  /** A day of the week at least a month ahead (0 = Sunday). */
  const ahead = (day: number) => {
    let date = addDays(businessDate(), 35);
    while (weekday(date) !== day) date = addDays(date, 1);
    return date;
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedPostCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    if (pillars.length > 0) {
      await db
        .update(contentPosts)
        .set({ pillarId: null })
        .where(inArray(contentPosts.pillarId, pillars));
      await db
        .update(contentIdeas)
        .set({ pillarId: null })
        .where(inArray(contentIdeas.pillarId, pillars));
    }
    await cast?.cleanup();
    if (pillars.length > 0)
      await db.delete(contentPillars).where(inArray(contentPillars.id, pillars));
    await connection.close();
  });

  describe('pillars (rule C1)', () => {
    it('are read by everyone and changed by content.review over all posts', async () => {
      const before = await get(
        '/api/content/pillars',
        contentPillarListSchema,
        cast.employee.cookie,
      );
      const live = before.items.filter((pillar) => !pillar.archived);
      expect(live.map((pillar) => pillar.name)).toEqual(
        expect.arrayContaining(['توعية', 'ترويج', 'ترفيه', 'خلف الكواليس']),
      );
      const body = { name: `تعليمي ${cast.run}`, color: 'chart_5' };
      expect((await client.post('/api/content/pillars', cast.writer.cookie, body)).status).toBe(
        403,
      );
      expect((await client.post('/api/content/pillars', undefined, body)).status).toBe(401);
      const response = await client.post('/api/content/pillars', cast.contentManager.cookie, body);
      expect(response.status, await response.clone().text()).toBe(201);
      const pillar = contentPillarSchema.parse(await response.json());
      pillars.push(pillar.id);
      expect(pillar.position).toBe(live.length + 1);
      await expectError(
        await client.post('/api/content/pillars', cast.contentManager.cookie, {
          ...body,
          name: body.name.toUpperCase(),
        }),
        409,
        'NAME_TAKEN',
      );

      // Reorder: every live pillar once.
      const ids = [pillar.id, ...live.map((item) => item.id)];
      await expectError(
        await put('/api/content/pillars/order', cast.contentManager.cookie, { ids: ids.slice(1) }),
        400,
        'INVALID_ORDER',
      );
      const ordered = contentPillarListSchema.parse(
        await (await put('/api/content/pillars/order', cast.contentManager.cookie, { ids })).json(),
      );
      expect(ordered.items[0]).toMatchObject({ id: pillar.id, position: 1 });

      // Archived: the others close up; restored at the end.
      const archived = await client.post(
        `/api/content/pillars/${pillar.id}/archive`,
        cast.contentManager.cookie,
      );
      expect(contentPillarSchema.parse(await archived.json()).archived).toBe(true);
      const after = await get('/api/content/pillars', contentPillarListSchema);
      expect(after.items.filter((item) => !item.archived).map((item) => item.position)).toEqual(
        live.map((_, index) => index + 1),
      );
      const restored = contentPillarSchema.parse(
        await (
          await client.post(`/api/content/pillars/${pillar.id}/restore`, cast.contentManager.cookie)
        ).json(),
      );
      expect(restored).toMatchObject({ archived: false, position: live.length + 1 });
      expect((await cast.auditOf(pillar.id)).map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['content_pillar.created', 'content_pillar.archived']),
      );
    });

    it('offers at most 10', async () => {
      const live = (await get('/api/content/pillars', contentPillarListSchema)).items.filter(
        (pillar) => !pillar.archived,
      );
      for (let n = live.length; n < 10; n++) {
        const response = await client.post('/api/content/pillars', cast.contentManager.cookie, {
          name: `عمود ${n} ${cast.run}`,
          color: 'chart_7',
        });
        pillars.push(contentPillarSchema.parse(await response.json()).id);
      }
      await expectError(
        await client.post('/api/content/pillars', cast.contentManager.cookie, {
          name: `زائد ${cast.run}`,
          color: 'chart_8',
        }),
        409,
        'LIMIT_REACHED',
      );
      // Back to the seeded ones for the rest of the suite.
      for (const id of pillars) {
        await client.post(`/api/content/pillars/${id}/archive`, cast.contentManager.cookie);
      }
    });
  });

  describe('settings (rules C1, C3, C4, C7)', () => {
    it('keeps the agency best times for content.review over all posts', async () => {
      const original = await get('/api/content/settings', contentAgencySettingsSchema);
      expect(original.postingTimes.length).toBeGreaterThan(0);
      const times: PostingWindow[] = [
        { platform: 'instagram', weekdays: [6], from: '10:00', to: '12:00' },
      ];
      expect(
        (await put('/api/content/settings', cast.writer.cookie, { postingTimes: times })).status,
      ).toBe(403);
      const saved = await put('/api/content/settings', cast.contentManager.cookie, {
        postingTimes: times,
      });
      expect(contentAgencySettingsSchema.parse(await saved.json()).postingTimes).toEqual(times);
      await put('/api/content/settings', cast.contentManager.cookie, original);
    });

    it("keeps a client's settings for edit scope on it, targets summing to 100", async () => {
      const health = await cast.createClient({ isHealthcare: true });
      const path = `/api/content/clients/${health.id}/settings`;
      const defaults = await get(path, clientContentSettingsSchema, cast.employee.cookie);
      expect(defaults).toMatchObject({
        saved: false,
        maxGapDays: 3,
        occasionCategories: ['general', 'healthcare'],
        xLongPosts: false,
      });
      const [first, second] = (
        await get('/api/content/pillars', contentPillarListSchema)
      ).items.filter((pillar) => !pillar.archived);
      const body = {
        postingTimes: [{ platform: 'instagram', weekdays: [0], from: '09:00', to: '10:00' }],
        pillarTargets: [
          { pillarId: first?.id, percent: 60 },
          { pillarId: second?.id, percent: 30 },
        ],
        maxGapDays: 2,
        occasionCategories: ['healthcare'],
        excludedOccasionIds: [],
        xLongPosts: true,
      };
      expect((await put(path, cast.otherAm.cookie, body)).status).toBe(403);
      expect((await put(path, cast.employee.cookie, body)).status).toBe(403);
      await expectError(await put(path, cast.am.cookie, body), 400, 'INVALID_TARGETS');
      const response = await put(path, cast.am.cookie, {
        ...body,
        pillarTargets: [
          { pillarId: first?.id, percent: 60 },
          { pillarId: second?.id, percent: 40 },
        ],
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const saved = clientContentSettingsSchema.parse(await response.json());
      expect(saved).toMatchObject({ saved: true, maxGapDays: 2, xLongPosts: true });
      expect(saved.effectivePostingTimes.filter((w) => w.platform === 'instagram')).toEqual(
        body.postingTimes,
      );
      expect(saved.effectivePostingTimes.some((w) => w.platform === 'facebook')).toBe(true);

      // X long posts: a 300-character X caption no longer blocks.
      const post = await cast.createPost(cast.writer.cookie, {
        clientId: health.id,
        platforms: ['x'],
        captions: [{ group: 'x', caption: 'x'.repeat(300) }],
      });
      expect(post.checks.filter((check) => check.blocking)).toEqual([]);
      expect(
        (await client.get(`/api/content/clients/${randomUUID()}/settings`, cast.gm.cookie)).status,
      ).toBe(404);
    });
  });

  describe('occasions (rules C4–C6)', () => {
    it('dates Ramadan by Umm al-Qura and lets a manager confirm the start', async () => {
      const list = await get(
        '/api/content/occasions?from=2027-02-01&to=2027-03-31',
        contentOccasionListSchema,
        cast.employee.cookie,
      );
      const ramadan = list.items.find((item) => item.name === 'رمضان');
      expect(ramadan?.occurrences).toEqual([
        { year: 2027, startDate: '2027-02-08', endDate: '2027-03-09', confirmed: false },
      ]);
      const path = `/api/content/occasions/${ramadan?.id}/dates/2027`;
      expect((await put(path, cast.writer.cookie, { startDate: '2027-02-09' })).status).toBe(403);
      await expectError(
        await put(path, cast.contentManager.cookie, { startDate: '2026-02-09' }),
        400,
        'INVALID_DATES',
      );
      const confirmed = await put(path, cast.contentManager.cookie, { startDate: '2027-02-09' });
      expect(confirmed.status, await confirmed.clone().text()).toBe(200);
      const after = await get(
        '/api/content/occasions?from=2027-02-01&to=2027-03-31',
        contentOccasionListSchema,
      );
      expect(after.items.find((item) => item.id === ramadan?.id)?.occurrences[0]).toMatchObject({
        startDate: '2027-02-09',
        confirmed: true,
      });
      const cleared = await client.request('DELETE', path, { cookie: cast.contentManager.cookie });
      expect(contentOccasionSchema.parse(await cleared.json()).occurrences).toEqual(
        expect.arrayContaining([expect.objectContaining({ year: 2027, startDate: '2027-02-08' })]),
      );
      expect((await cast.auditOf(ramadan?.id ?? '')).map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'content_occasion.date_confirmed',
          'content_occasion.date_cleared',
        ]),
      );
    });

    it("lets edit scope on a client add the client's own occasions, and checks their dates", async () => {
      const body = {
        name: `ذكرى ${cast.run}`,
        category: 'general',
        clientId,
        calendar: 'once',
        date: cast.inDays(10),
      };
      expect((await client.post('/api/content/occasions', cast.otherAm.cookie, body)).status).toBe(
        403,
      );
      await expectError(
        await client.post('/api/content/occasions', cast.am.cookie, { ...body, month: 3 }),
        400,
        'INVALID_DATES',
      );
      const response = await client.post('/api/content/occasions', cast.am.cookie, body);
      expect(response.status, await response.clone().text()).toBe(201);
      const occasion = contentOccasionSchema.parse(await response.json());
      expect(occasion.client?.id).toBe(clientId);
      // An agency occasion is for content.review over all posts.
      expect(
        (await client.post('/api/content/occasions', cast.am.cookie, { ...body, clientId: null }))
          .status,
      ).toBe(403);
      const archived = await client.post(
        `/api/content/occasions/${occasion.id}/archive`,
        cast.am.cookie,
      );
      expect(contentOccasionSchema.parse(await archived.json()).archived).toBe(true);
    });
  });

  describe('snippets (rule A10)', () => {
    it("keeps the client's and the agency's, each by its own scope", async () => {
      const own = await client.post('/api/content/snippets', cast.writer.cookie, {
        clientId,
        kind: 'hashtags',
        name: 'وسوم العميل',
        body: '#قهوة #صباح',
      });
      expect(own.status, await own.clone().text()).toBe(201);
      const snippet = contentSnippetSchema.parse(await own.json());
      const agency = { kind: 'caption', name: `ختام ${cast.run}`, body: 'تابعونا للمزيد' };
      expect((await client.post('/api/content/snippets', cast.writer.cookie, agency)).status).toBe(
        403,
      );
      const agencySnippet = contentSnippetSchema.parse(
        await (
          await client.post('/api/content/snippets', cast.contentManager.cookie, agency)
        ).json(),
      );
      const listed = await get(
        `/api/content/snippets?clientId=${clientId}`,
        contentSnippetListSchema,
        cast.employee.cookie,
      );
      expect(listed.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([snippet.id, agencySnippet.id]),
      );
      expect(listed.items.find((item) => item.id === snippet.id)?.canEdit).toBe(false);
      expect(
        (
          await client.request('PATCH', `/api/content/snippets/${snippet.id}`, {
            cookie: cast.writer.cookie,
            body: { body: '#'.repeat(1001) },
          })
        ).status,
      ).toBe(400);
      expect(
        (await client.post(`/api/content/snippets/${snippet.id}/archive`, cast.otherAm.cookie))
          .status,
      ).toBe(403);
      expect(
        (await client.post(`/api/content/snippets/${snippet.id}/archive`, cast.writer.cookie))
          .status,
      ).toBe(204);
      expect(
        (
          await get(`/api/content/snippets?clientId=${clientId}`, contentSnippetListSchema)
        ).items.some((item) => item.id === snippet.id),
      ).toBe(false);
      await client.post(
        `/api/content/snippets/${agencySnippet.id}/archive`,
        cast.contentManager.cookie,
      );
    });
  });

  describe('the planning check (rules C6–C11)', () => {
    let planned: string;
    const from = ahead(6);
    const to = addDays(from, 13);

    beforeAll(async () => {
      planned = (await cast.createClient()).id;
      // Settings saved: the check applies to the client.
      await put(`/api/content/clients/${planned}/settings`, cast.am.cookie, {
        postingTimes: [],
        pillarTargets: [],
        maxGapDays: 3,
        occasionCategories: [],
        excludedOccasionIds: [],
        xLongPosts: false,
      });
    });

    it('marks gaps, posts too close and occasions without a post, on the calendar and the check', async () => {
      const at = (publishDate: string, publishTime: string, platforms = ['instagram']) =>
        cast.createPost(cast.writer.cookie, {
          clientId: planned,
          publishDate,
          publishTime,
          platforms: platforms as never,
        });
      await at(from, '10:00');
      await at(from, '11:00', ['instagram', 'facebook']);
      await at(addDays(from, 8), '10:00');
      const occasion = contentOccasionSchema.parse(
        await (
          await client.post('/api/content/occasions', cast.am.cookie, {
            name: `افتتاح الفرع ${cast.run}`,
            category: 'general',
            clientId: planned,
            calendar: 'once',
            date: addDays(from, 5),
            leadDays: 3,
          })
        ).json(),
      );

      const check = await get(
        `/api/content/planning?from=${from}&to=${to}&clientId=${planned}`,
        contentPlanningSchema,
        cast.employee.cookie,
      );
      const issues = check.clients[0]?.issues ?? [];
      expect(
        issues.filter((issue) => issue.kind === 'gap').map((issue) => [issue.date, issue.endDate]),
      ).toEqual([
        [addDays(from, 1), addDays(from, 7)],
        [addDays(from, 9), to],
      ]);
      expect(issues.find((issue) => issue.kind === 'too_close')).toMatchObject({
        platform: 'instagram',
      });
      expect(issues.find((issue) => issue.occasionId === occasion.id)).toMatchObject({
        occasionId: occasion.id,
        date: addDays(from, 5),
      });

      const calendar = await get(
        `/api/content/calendar?from=${from}&to=${to}&clientId=${planned}`,
        contentCalendarSchema,
      );
      expect(calendar.occasions.find((item) => item.id === occasion.id)).toMatchObject({
        covered: false,
        skipped: false,
      });
      expect(calendar.issues.every((issue) => issue.clientId === planned)).toBe(true);

      // Covered by a post of the occasion; "No post this year" skips it.
      const covering = await cast.createPost(cast.writer.cookie, {
        clientId: planned,
        publishDate: addDays(from, 5),
        occasionId: occasion.id,
      });
      expect(covering.occasion).toMatchObject({ id: occasion.id });
      const covered = await get(
        `/api/content/calendar?from=${from}&to=${to}&clientId=${planned}`,
        contentCalendarSchema,
      );
      expect(covered.occasions.find((item) => item.id === occasion.id)?.covered).toBe(true);
      expect(covered.issues.some((issue) => issue.occasionId === occasion.id)).toBe(false);
    });

    it('counts planned posts against the open cycle and flags what falls short', async () => {
      const committed = (await cast.createClient()).id;
      await cast.createRetainer(committed);
      const today = businessDate();
      const check = await get(
        `/api/content/planning?from=${today}&to=${addDays(today, 13)}&clientId=${committed}`,
        contentPlanningSchema,
      );
      const [entry] = check.clients;
      expect(entry?.commitments.map((line) => [line.kind, line.planned, line.committed])).toEqual([
        ['post', 0, 12],
        ['reel', 0, 4],
      ]);
      expect(entry?.issues.filter((issue) => issue.kind === 'under_committed')).toHaveLength(2);
      // A client without a retainer or settings has no check (edge case 14).
      const plain = (await cast.createClient()).id;
      expect(
        (
          await get(
            `/api/content/planning?from=${today}&to=${addDays(today, 13)}&clientId=${plain}`,
            contentPlanningSchema,
          )
        ).clients,
      ).toEqual([]);
      expect(
        (
          await client.get(
            `/api/content/planning?from=${today}&to=${addDays(today, 60)}`,
            cast.gm.cookie,
          )
        ).status,
      ).toBe(400);
    });

    it('shows the Instagram grid of the month and the two before, newest first', async () => {
      const gridClient = (await cast.createClient()).id;
      const month = from.slice(0, 7);
      const feed = await cast.createPost(cast.writer.cookie, {
        clientId: gridClient,
        publishDate: from,
      });
      const reel = await cast.createPost(cast.writer.cookie, {
        clientId: gridClient,
        publishDate: addDays(from, 1),
        type: 'reel',
      });
      await cast.createPost(cast.writer.cookie, {
        clientId: gridClient,
        publishDate: from,
        type: 'story',
      });
      await cast.createPost(cast.writer.cookie, {
        clientId: gridClient,
        publishDate: from,
        platforms: ['tiktok'],
      });
      const grid = await get(
        `/api/content/grid?clientId=${gridClient}&month=${month}`,
        contentGridSchema,
      );
      expect(grid.tiles.map((tile) => tile.postId)).toEqual([reel.id, feed.id]);
      expect(
        (
          await client.get(
            `/api/content/grid?clientId=${randomUUID()}&month=${month}`,
            cast.gm.cookie,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('jobs (part D)', () => {
    let reminders: PostReminders;
    beforeAll(() => {
      reminders = app.get(PostReminders);
    });

    it('sends post_at_risk once for an open post due within two work days', async () => {
      const sunday = ahead(0);
      const risky = await cast.createPost(cast.writer.cookie, { clientId, publishDate: sunday });
      await db
        .update(contentPosts)
        .set({ publishDate: addDays(sunday, 1) })
        .where(eq(contentPosts.id, risky.id));
      const far = await cast.createPost(cast.writer.cookie, { clientId });
      await db
        .update(contentPosts)
        .set({ publishDate: addDays(sunday, 5) })
        .where(eq(contentPosts.id, far.id));
      expect(await reminders.remind(addDays(sunday, -2))).toBe(0);
      await reminders.remind(sunday);
      await reminders.remind(sunday);
      expect(await cast.typesOf(cast.writer.id, risky.id)).toEqual(['post_at_risk']);
      expect(await cast.typesOf(cast.am.id, risky.id)).toEqual(['post_at_risk']);
      expect(await cast.typesOf(cast.writer.id, far.id)).toEqual([]);
      const [notice] = await db
        .select({ data: notifications.data })
        .from(notifications)
        .where(and(eq(notifications.subjectId, risky.id), eq(notifications.type, 'post_at_risk')));
      expect(notice?.data).toMatchObject({ waitingOn: 'production', clientSince: null });
    });

    it('sends the weekly check once, on the week first work day only', async () => {
      const saturday = ahead(6);
      const subject = contentWeekSubjectId(saturday);
      await reminders.remind(addDays(saturday, 1));
      await reminders.remind(saturday);
      await reminders.remind(saturday);
      const rows = await db
        .select({ recipientId: notifications.recipientId })
        .from(notifications)
        .where(
          and(eq(notifications.subjectId, subject), eq(notifications.type, 'content_week_check')),
        );
      expect(rows.filter((row) => row.recipientId === cast.writer.id)).toHaveLength(1);
      expect(rows.some((row) => row.recipientId === cast.designer.id)).toBe(false);
      await db.delete(notifications).where(eq(notifications.subjectId, subject));
    });

    it('reminds before the publish time of approved posts only', async () => {
      const day = ahead(1);
      const approved = await cast.postAt('approved', {
        clientId,
        publishDate: day,
        publishTime: '12:00',
      });
      const scheduled = await cast.postAt('scheduled', {
        clientId,
        publishDate: day,
        publishTime: '12:00',
      });
      await reminders.publishShortly(businessInstant(day, '10:00'));
      expect(await cast.typesOf(cast.writer.id, approved.id)).toContain('post_publish_shortly');
      expect(await cast.typesOf(cast.writer.id, scheduled.id)).not.toContain(
        'post_publish_shortly',
      );
    });
  });

  it('leaves the agency settings row in place', async () => {
    const [agency] = await db
      .select({ id: contentPlanningSettings.id })
      .from(contentPlanningSettings)
      .where(isNull(contentPlanningSettings.clientId));
    expect(agency).toBeDefined();
  });
});
