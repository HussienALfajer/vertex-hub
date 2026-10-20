import type { INestApplication } from '@nestjs/common';
import {
  type Announcement,
  type AnnouncementPoll,
  announcementPollSchema,
  announcementSchema,
  type CreateAnnouncementInput,
  type ErrorResponse,
} from '@vertex-hub/contracts';
import { announcementPolls, auditEntries, createDatabase, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnnouncementPolls } from '../src/modules/announcements/announcement-polls.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string };

const HOUR = 3_600_000;

describe('announcement polls (F16 rule D11)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let polls: AnnouncementPolls;
  let author: Person;
  let designer: Person;
  let photographer: Person;
  let outsider: Person;
  let gm: Person;

  const poll = (overrides: Record<string, unknown> = {}) => ({
    question: 'أي يوم يناسب الاجتماع؟',
    options: ['الأحد', 'الاثنين', 'الثلاثاء'],
    ...overrides,
  });

  const input = (overrides: Partial<CreateAnnouncementInput> = {}): CreateAnnouncementInput => ({
    title: 'اجتماع الفريق',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'صوّتوا على اليوم' }] }],
    },
    priority: 'normal',
    requiresAck: false,
    audience: { users: [designer.id, photographer.id] },
    send: 'now',
    poll: poll() as CreateAnnouncementInput['poll'],
    ...overrides,
  });

  async function create(person: Person, overrides: Partial<CreateAnnouncementInput> = {}) {
    const response = await client.post('/api/announcements', person.cookie, input(overrides));
    expect(response.status).toBe(201);
    return announcementSchema.parse(await response.json());
  }

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  const read = async (person: Person, id: string) => {
    const response = await client.get(`/api/announcements/${id}`, person.cookie);
    expect(response.status).toBe(200);
    return announcementSchema.parse(await response.json());
  };

  const vote = (person: Person | undefined, id: string, optionIds: string[]) =>
    client.request('PUT', `/api/announcements/${id}/poll/vote`, {
      cookie: person?.cookie,
      body: { optionIds },
    });

  const voted = async (person: Person, id: string, optionIds: string[]) => {
    const response = await vote(person, id, optionIds);
    expect(response.status).toBe(200);
    return announcementPollSchema.parse(await response.json());
  };

  const optionIds = (announcement: Announcement) =>
    (announcement.poll as AnnouncementPoll).options.map((option) => option.id);

  const notificationsOf = (subjectId: string, type: 'poll_closing' | 'poll_results') =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.subjectId, subjectId), eq(notifications.type, type)));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    polls = app.get(AnnouncementPolls);
    const signedIn = async () => {
      const user = await seedUser(db);
      seeded.push(user.id);
      return { id: user.id, cookie: await client.signIn(user.email) };
    };
    author = await signedIn();
    designer = await signedIn();
    photographer = await signedIn();
    outsider = await signedIn();
    const general = await client.signInWithTwoFactor(db, { roles: ['general_manager'] });
    seeded.push(general.id);
    gm = { id: general.id, cookie: general.cookie };
  });

  afterAll(async () => {
    await app?.close();
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('answers 401 without a session', async () => {
    const sent = await create(author);
    expect((await vote(undefined, sent.id, optionIds(sent).slice(0, 1))).status).toBe(401);
    expect((await client.post(`/api/announcements/${sent.id}/poll/close`)).status).toBe(401);
  });

  it('stores the poll with the announcement, single choice and named by default', async () => {
    const sent = await create(author);
    expect(sent.poll).toMatchObject({
      question: 'أي يوم يناسب الاجتماع؟',
      multiple: false,
      anonymous: false,
      results: 'everyone_after_voting',
      closesAt: null,
      closed: false,
      voters: 0,
      myVote: [],
      rights: { vote: false, close: true },
    });
    expect(sent.poll?.options.map((option) => option.label)).toEqual([
      'الأحد',
      'الاثنين',
      'الثلاثاء',
    ]);
    const recipientView = await read(designer, sent.id);
    expect(recipientView.poll?.rights).toEqual({ vote: true, close: false });
    // Results for everyone show only after voting.
    expect(recipientView.poll?.voters).toBeNull();
    expect(recipientView.poll?.options.every((option) => option.votes === null)).toBe(true);
  });

  it('lets recipients vote and change their vote; single choice takes one option', async () => {
    const sent = await create(author);
    const [sunday, monday] = optionIds(sent) as [string, string];
    await expectError(await vote(designer, sent.id, [sunday, monday]), 400, 'SINGLE_CHOICE');
    expect((await vote(outsider, sent.id, [sunday])).status).toBe(404);
    expect((await vote(author, sent.id, [sunday])).status).toBe(404);
    expect((await vote(designer, sent.id, ['019a0000-0000-7000-8000-000000000001'])).status).toBe(
      400,
    );
    const first = await voted(designer, sent.id, [sunday]);
    expect(first.myVote).toEqual([sunday]);
    expect(first.options.map((option) => option.votes)).toEqual([1, 0, 0]);
    // Recipients never see the names.
    expect(first.options.every((option) => option.voters === null)).toBe(true);
    const changed = await voted(designer, sent.id, [monday]);
    expect(changed.myVote).toEqual([monday]);
    expect(changed.options.map((option) => option.votes)).toEqual([0, 1, 0]);
    expect(changed.voters).toBe(1);
    const authorView = (await read(author, sent.id)).poll as AnnouncementPoll;
    expect(authorView.options[1]?.voters).toEqual([{ id: designer.id, name: expect.any(String) }]);
  });

  it('takes several options in a multiple-choice poll', async () => {
    const sent = await create(author, { poll: poll({ multiple: true }) as never });
    const [sunday, , tuesday] = optionIds(sent) as [string, string, string];
    const result = await voted(photographer, sent.id, [sunday, tuesday]);
    expect(result.options.map((option) => option.votes)).toEqual([1, 0, 1]);
    expect(result.voters).toBe(1);
  });

  it('never names the voters of an anonymous poll, to anyone (rule D11, edge case 19)', async () => {
    const sent = await create(author, { poll: poll({ anonymous: true }) as never });
    const [sunday] = optionIds(sent) as [string];
    await voted(designer, sent.id, [sunday]);
    for (const person of [author, gm, designer]) {
      const view = (await read(person, sent.id)).poll as AnnouncementPoll;
      expect(view.options[0]?.votes).toBe(1);
      expect(view.options.every((option) => option.voters === null)).toBe(true);
    }
  });

  it('shows author-only results to the author and managers, not to voters', async () => {
    const sent = await create(author, { poll: poll({ results: 'author_only' }) as never });
    const [sunday] = optionIds(sent) as [string];
    const mine = await voted(designer, sent.id, [sunday]);
    expect(mine.myVote).toEqual([sunday]);
    expect(mine.voters).toBeNull();
    expect(mine.options[0]?.votes).toBeNull();
    expect((await read(author, sent.id)).poll?.options[0]?.votes).toBe(1);
    expect((await read(gm, sent.id)).poll?.options[0]?.voters).toHaveLength(1);
  });

  it('closes by the author: no more votes, the closing reminder voided, audited', async () => {
    const sent = await create(author);
    const [sunday] = optionIds(sent) as [string];
    expect(
      (await client.post(`/api/announcements/${sent.id}/poll/close`, designer.cookie)).status,
    ).toBe(403);
    expect(
      (await client.post(`/api/announcements/${sent.id}/poll/close`, outsider.cookie)).status,
    ).toBe(404);
    const closed = announcementPollSchema.parse(
      await (await client.post(`/api/announcements/${sent.id}/poll/close`, author.cookie)).json(),
    );
    expect(closed.closed).toBe(true);
    expect(closed.rights.close).toBe(false);
    await expectError(
      await client.post(`/api/announcements/${sent.id}/poll/close`, author.cookie),
      409,
      'POLL_CLOSED',
    );
    await expectError(await vote(designer, sent.id, [sunday]), 409, 'POLL_CLOSED');
    // A closed poll shows its results to everyone when they are for everyone.
    expect((await read(designer, sent.id)).poll?.voters).toBe(0);
    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, sent.id),
          eq(auditEntries.action, 'announcement_poll.closed'),
        ),
      );
    expect(audit?.after).toEqual({ closed: true, voters: 0 });
    // The author closed it: no results notification to themselves.
    expect(await notificationsOf(sent.id, 'poll_results')).toHaveLength(0);
  });

  it('checks the closing time: 1 hour to 90 days after sending', async () => {
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    const response = await client.post(
      '/api/announcements',
      author.cookie,
      input({ poll: poll({ closesAt: soon }) as never }),
    );
    expect(response.status).toBe(400);
    // A draft keeps it until it is sent.
    const draft = await create(author, { send: 'draft', poll: poll({ closesAt: soon }) as never });
    expect(draft.poll?.closesAt).not.toBeNull();
    expect((await client.post(`/api/announcements/${draft.id}/send`, author.cookie)).status).toBe(
      400,
    );
  });

  it('reminds non-voters a day before, then closes at the time and tells the author (minute job)', async () => {
    const sent = await create(author, {
      poll: poll({ closesAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString() }) as never,
    });
    const [sunday] = optionIds(sent) as [string];
    await voted(designer, sent.id, [sunday]);
    const closesAt = new Date(sent.poll?.closesAt as string);
    // More than a day before: nothing.
    expect(await polls.runTimed(new Date(closesAt.getTime() - 25 * HOUR))).toBe(0);
    const dayBefore = new Date(closesAt.getTime() - 23 * HOUR);
    expect(await polls.runTimed(dayBefore)).toBe(1);
    expect(await polls.runTimed(dayBefore)).toBe(0);
    const reminders = await notificationsOf(sent.id, 'poll_closing');
    expect(reminders.map((row) => row.recipientId)).toEqual([photographer.id]);

    await polls.runTimed(new Date(closesAt.getTime() + 60_000));
    const [stored] = await db
      .select()
      .from(announcementPolls)
      .where(eq(announcementPolls.announcementId, sent.id));
    expect(stored?.closedAt).not.toBeNull();
    const results = await notificationsOf(sent.id, 'poll_results');
    expect(results.map((row) => [row.recipientId, row.data])).toEqual([
      [author.id, { title: 'اجتماع الفريق', voters: 1 }],
    ]);
    const [reminder] = await notificationsOf(sent.id, 'poll_closing');
    expect(reminder?.resolution).toBe('void');
  });

  it('closes the reminder of a recipient who votes', async () => {
    const sent = await create(author, {
      poll: poll({ closesAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString() }) as never,
    });
    const closesAt = new Date(sent.poll?.closesAt as string);
    await polls.runTimed(new Date(closesAt.getTime() - 23 * HOUR));
    await voted(photographer, sent.id, optionIds(sent).slice(0, 1));
    const [mine] = (await notificationsOf(sent.id, 'poll_closing')).filter(
      (row) => row.recipientId === photographer.id,
    );
    expect(mine?.resolution).toBe('done');
  });

  it('sends no closing reminder to a poll that runs less than two days', async () => {
    const sent = await create(author, {
      poll: poll({ closesAt: new Date(Date.now() + 30 * HOUR).toISOString() }) as never,
    });
    const closesAt = new Date(sent.poll?.closesAt as string);
    await polls.runTimed(new Date(closesAt.getTime() - 2 * HOUR));
    expect(await notificationsOf(sent.id, 'poll_closing')).toHaveLength(0);
  });

  it('edits the poll of a sent announcement only until someone votes (rule D10)', async () => {
    const sent = await create(author);
    const edited = await client.request('PATCH', `/api/announcements/${sent.id}`, {
      cookie: author.cookie,
      body: { poll: poll({ options: ['صباحًا', 'مساءً'] }) },
    });
    expect(edited.status).toBe(200);
    const after = announcementSchema.parse(await edited.json());
    expect(after.poll?.options.map((option) => option.label)).toEqual(['صباحًا', 'مساءً']);
    expect(after.editedAt).not.toBeNull();
    await voted(designer, sent.id, optionIds(after).slice(0, 1));
    const locked = await client.request('PATCH', `/api/announcements/${sent.id}`, {
      cookie: author.cookie,
      body: { poll: poll() },
    });
    await expectError(locked, 409, 'LOCKED_FIELD');
    // Removing or adding a poll after sending is refused too.
    const plain = await create(author, { poll: undefined });
    await expectError(
      await client.request('PATCH', `/api/announcements/${plain.id}`, {
        cookie: author.cookie,
        body: { poll: poll() },
      }),
      409,
      'LOCKED_FIELD',
    );
  });

  it('never reopens a closed poll by editing it', async () => {
    const sent = await create(author);
    await client.post(`/api/announcements/${sent.id}/poll/close`, author.cookie);
    await expectError(
      await client.request('PATCH', `/api/announcements/${sent.id}`, {
        cookie: author.cookie,
        body: { poll: poll() },
      }),
      409,
      'POLL_CLOSED',
    );
    expect((await read(author, sent.id)).poll?.closed).toBe(true);
  });

  it('sends no closing reminder for a poll closed since the job read it', async () => {
    const sent = await create(author, {
      poll: poll({ closesAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString() }) as never,
    });
    const closesAt = new Date(sent.poll?.closesAt as string);
    await db
      .update(announcementPolls)
      .set({ closedAt: new Date() })
      .where(eq(announcementPolls.announcementId, sent.id));
    expect(await polls.runTimed(new Date(closesAt.getTime() - 23 * HOUR))).toBe(0);
    expect(await notificationsOf(sent.id, 'poll_closing')).toHaveLength(0);
  });

  it('removes the poll of a draft', async () => {
    const draft = await create(author, { send: 'draft' });
    const response = await client.request('PATCH', `/api/announcements/${draft.id}`, {
      cookie: author.cookie,
      body: { poll: null },
    });
    expect(announcementSchema.parse(await response.json()).poll).toBeNull();
  });

  it('voids the closing reminders when the announcement is withdrawn', async () => {
    const sent = await create(author, {
      poll: poll({ closesAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString() }) as never,
    });
    const closesAt = new Date(sent.poll?.closesAt as string);
    await polls.runTimed(new Date(closesAt.getTime() - 23 * HOUR));
    await client.post(`/api/announcements/${sent.id}/withdraw`, author.cookie);
    const reminders = await notificationsOf(sent.id, 'poll_closing');
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((row) => row.resolution === 'void')).toBe(true);
    // A withdrawn announcement's poll no longer closes or takes votes.
    expect(
      (await client.post(`/api/announcements/${sent.id}/poll/close`, author.cookie)).status,
    ).toBe(409);
  });
});
