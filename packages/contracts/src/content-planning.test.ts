import { describe, expect, it } from 'vitest';
import {
  commitmentsOf,
  createContentOccasionSchema,
  createContentSnippetSchema,
  dropContentIdeaSchema,
  effectivePostingTimes,
  occasionApplies,
  occasionDates,
  occasionRuleProblem,
  occasionStart,
  type PlannedPost,
  type PostingWindow,
  pillarBalance,
  planningIssues,
  postingWindowSchema,
  suggestPublishTimes,
  updateClientContentSettingsSchema,
} from './content-planning.js';

const window = (fields: Partial<PostingWindow>): PostingWindow => ({
  platform: 'instagram',
  weekdays: [0, 1, 2, 3, 4, 6],
  from: '12:00',
  to: '14:00',
  ...fields,
});

const post = (id: string, fields: Partial<PlannedPost> = {}): PlannedPost => ({
  id,
  type: 'post',
  platforms: ['instagram'],
  publishDate: '2026-11-01',
  publishTime: null,
  pillarId: null,
  occasionId: null,
  ...fields,
});

describe('best publishing times (rule C3)', () => {
  const agency = [
    window({}),
    window({ from: '19:00', to: '22:00' }),
    window({ platform: 'facebook' }),
    window({ platform: 'tiktok', weekdays: [0, 1, 2, 3, 4, 5, 6], from: '18:00', to: '23:00' }),
  ];

  it("offers the weekday's windows of the chosen platforms, one chip per window, by start", () => {
    // 2026-11-01 is a Sunday.
    expect(suggestPublishTimes([], agency, '2026-11-01', ['facebook', 'instagram'])).toEqual([
      { from: '12:00', to: '14:00', platforms: ['instagram', 'facebook'] },
      { from: '19:00', to: '22:00', platforms: ['instagram'] },
    ]);
    // Friday: Instagram and Facebook have no window, TikTok has.
    expect(suggestPublishTimes([], agency, '2026-10-30', ['instagram', 'tiktok'])).toEqual([
      { from: '18:00', to: '23:00', platforms: ['tiktok'] },
    ]);
  });

  it("uses the client's windows for a platform it sets, the agency's for the others", () => {
    const client = [window({ weekdays: [6], from: '10:00', to: '11:00' })];
    expect(effectivePostingTimes(agency, client).filter((w) => w.platform === 'instagram')).toEqual(
      client,
    );
    // Saturday 2026-10-31.
    expect(suggestPublishTimes(client, agency, '2026-10-31', ['instagram', 'facebook'])).toEqual([
      { from: '10:00', to: '11:00', platforms: ['instagram'] },
      { from: '12:00', to: '14:00', platforms: ['facebook'] },
    ]);
  });

  it('validates windows: from before to, each weekday once', () => {
    expect(postingWindowSchema.safeParse(window({ from: '14:00', to: '12:00' })).success).toBe(
      false,
    );
    expect(postingWindowSchema.safeParse(window({ weekdays: [1, 1] })).success).toBe(false);
    expect(postingWindowSchema.safeParse(window({ weekdays: [7] })).success).toBe(false);
  });
});

describe('occasions (rules C4–C6)', () => {
  const ramadan = {
    calendar: 'hijri' as const,
    month: 9,
    day: 1,
    date: null,
    durationDays: 30,
    leadDays: 14,
  };

  it('computes Hijri starts with the Umm al-Qura calendar, each Gregorian year', () => {
    expect(occasionStart(ramadan, 2026)).toBe('2026-02-18');
    expect(occasionStart(ramadan, 2027)).toBe('2027-02-08');
    expect(occasionStart({ ...ramadan, month: 10 }, 2026)).toBe('2026-03-20');
  });

  it("lets a manager's confirmed start replace the computed one for its year (edge case 12)", () => {
    const confirmed = new Map([[2026, '2026-02-19']]);
    expect(occasionDates(ramadan, '2026-02-01', '2026-03-31', confirmed)).toEqual([
      { year: 2026, start: '2026-02-19', end: '2026-03-20', confirmed: true },
    ]);
    expect(occasionDates(ramadan, '2027-02-01', '2027-02-28', confirmed)).toEqual([
      { year: 2027, start: '2027-02-08', end: '2027-03-09', confirmed: false },
    ]);
  });

  it('includes an occurrence by its days or its hint window, across the year end', () => {
    const newYear = {
      calendar: 'gregorian' as const,
      month: 1,
      day: 1,
      date: null,
      durationDays: 3,
    };
    expect(occasionDates(newYear, '2026-12-30', '2026-12-31')).toEqual([]);
    expect(occasionDates({ ...newYear, leadDays: 7 }, '2026-12-30', '2026-12-31')).toEqual([
      { year: 2027, start: '2027-01-01', end: '2027-01-03', confirmed: false },
    ]);
    expect(occasionDates(newYear, '2027-01-03', '2027-01-10')).toEqual([
      { year: 2027, start: '2027-01-01', end: '2027-01-03', confirmed: false },
    ]);
  });

  it('dates one-time occasions in their year and skips 29 February outside leap years', () => {
    const launch = {
      calendar: 'once' as const,
      month: null,
      day: null,
      date: '2026-11-05',
      durationDays: 1,
    };
    expect(occasionStart(launch, 2026)).toBe('2026-11-05');
    expect(occasionStart(launch, 2027)).toBeNull();
    const leap = { calendar: 'gregorian' as const, month: 2, day: 29, date: null, durationDays: 1 };
    expect(occasionStart(leap, 2027)).toBeNull();
    expect(occasionStart(leap, 2028)).toBe('2028-02-29');
  });

  it('checks the shape of each calendar', () => {
    expect(occasionRuleProblem({ ...ramadan, date: '2026-01-01' })).not.toBeNull();
    expect(occasionRuleProblem({ ...ramadan, day: 31 })).not.toBeNull();
    expect(occasionRuleProblem(ramadan)).toBeNull();
    const parsed = createContentOccasionSchema.parse({
      name: ' يوم القهوة ',
      category: 'food',
      calendar: 'gregorian',
      month: 10,
      day: 1,
    });
    expect(parsed).toMatchObject({
      name: 'يوم القهوة',
      durationDays: 1,
      leadDays: 7,
      clientId: null,
    });
  });

  it("applies the client's own, general and enabled categories, never excluded ones", () => {
    const client = { id: 'c', occasionCategories: ['food' as const], excludedOccasionIds: ['x'] };
    expect(occasionApplies({ id: 'a', clientId: null, category: 'general' }, client)).toBe(true);
    expect(occasionApplies({ id: 'b', clientId: null, category: 'food' }, client)).toBe(true);
    expect(occasionApplies({ id: 'd', clientId: null, category: 'healthcare' }, client)).toBe(
      false,
    );
    expect(occasionApplies({ id: 'x', clientId: null, category: 'general' }, client)).toBe(false);
    expect(occasionApplies({ id: 'e', clientId: 'c', category: 'retail' }, client)).toBe(true);
    expect(occasionApplies({ id: 'f', clientId: 'other', category: 'general' }, client)).toBe(
      false,
    );
  });
});

describe('the planning check (rules C2, C6–C10)', () => {
  const base = {
    from: '2026-11-01',
    to: '2026-11-14',
    maxGapDays: 3,
    posts: [] as PlannedPost[],
    occasions: [],
    commitments: [],
    pillarTargets: [],
    pillarIds: ['p1', 'p2'],
  };

  it('flags runs of days without a post longer than the rhythm', () => {
    const posts = [
      post('a', { publishDate: '2026-11-03' }),
      post('b', { publishDate: '2026-11-06' }),
    ];
    const issues = planningIssues({ ...base, posts });
    expect(
      issues.filter((item) => item.kind === 'gap').map((item) => [item.date, item.endDate]),
    ).toEqual([['2026-11-07', '2026-11-14']]);
    // Two empty days before the first post and two between: within the rhythm of 3.
    expect(
      planningIssues({ ...base, posts, maxGapDays: 8 }).filter((i) => i.kind === 'gap'),
    ).toEqual([]);
  });

  it('flags posts on a shared platform under 3 hours apart, or on one day without a time', () => {
    const posts = [
      post('a', { publishDate: '2026-11-02', publishTime: '10:00' }),
      post('b', {
        publishDate: '2026-11-02',
        publishTime: '12:30',
        platforms: ['facebook', 'instagram'],
      }),
      post('c', { publishDate: '2026-11-02', publishTime: '18:00' }),
      post('d', { publishDate: '2026-11-03', publishTime: null, platforms: ['x'] }),
      post('e', { publishDate: '2026-11-03', publishTime: '20:00', platforms: ['x'] }),
      post('f', { publishDate: '2026-11-03', publishTime: '23:00', platforms: ['tiktok'] }),
      post('g', { publishDate: '2026-11-04', publishTime: '00:30', platforms: ['tiktok'] }),
    ];
    const close = planningIssues({ ...base, posts, maxGapDays: 14 }).filter(
      (item) => item.kind === 'too_close',
    );
    expect(close.map((item) => [item.postIds, item.platform])).toEqual([
      [['a', 'b'], 'instagram'],
      [['d', 'e'], 'x'],
      [['f', 'g'], 'tiktok'],
    ]);
  });

  it('flags a cycle planned below its commitment: posts and carousels against post and design lines', () => {
    const cycle = {
      cycleId: 'cy',
      from: '2026-11-01',
      to: '2026-11-30',
      lines: [
        { kind: 'post', count: 2 },
        { kind: 'design', count: 1 },
        { kind: 'reel', count: 2 },
        { kind: 'video', count: 4 },
      ],
    };
    const posts = [
      post('a', { type: 'carousel' }),
      post('b', { type: 'post', publishDate: '2026-11-20' }),
      post('c', { type: 'post', publishDate: '2026-11-25' }),
      post('d', { type: 'reel' }),
      post('e', { type: 'reel', publishDate: '2026-12-02' }),
    ];
    expect(commitmentsOf(cycle, posts)).toEqual([
      { kind: 'post', planned: 3, committed: 3 },
      { kind: 'reel', planned: 1, committed: 2 },
    ]);
    const short = planningIssues({ ...base, posts, commitments: [cycle], maxGapDays: 14 }).filter(
      (item) => item.kind === 'under_committed',
    );
    expect(short).toMatchObject([
      { commitment: 'reel', planned: 1, committed: 2, date: '2026-11-01' },
    ]);
  });

  it('flags an applying occasion without a post from its lead days, unless covered or skipped', () => {
    const occasion = {
      id: 'o',
      start: '2026-11-20',
      end: '2026-11-20',
      leadDays: 7,
      skipped: false,
    };
    const issues = (posts: PlannedPost[], occasions = [occasion]) =>
      planningIssues({ ...base, posts, occasions, maxGapDays: 14 }).filter(
        (item) => item.kind === 'occasion_uncovered',
      );
    expect(issues([])).toMatchObject([
      { occasionId: 'o', date: '2026-11-20', endDate: '2026-11-20' },
    ]);
    expect(issues([], [{ ...occasion, leadDays: 5 }])).toEqual([]);
    expect(issues([], [{ ...occasion, skipped: true }])).toEqual([]);
    // A post covers it whatever its date.
    expect(issues([post('a', { occasionId: 'o', publishDate: '2026-12-01' })])).toEqual([]);
  });

  it('flags the month when a pillar is 15 points off its target with at least 4 posts', () => {
    const targets = [
      { pillarId: 'p1', percent: 50 },
      { pillarId: 'p2', percent: 50 },
    ];
    const posts = [
      post('a', { pillarId: 'p1' }),
      post('b', { pillarId: 'p1' }),
      post('c', { pillarId: 'p1' }),
      post('d', { pillarId: 'p2' }),
    ];
    expect(pillarBalance(posts, targets, ['p1', 'p2'])).toEqual([
      { pillarId: 'p1', count: 3, share: 75, target: 50, off: true },
      { pillarId: 'p2', count: 1, share: 25, target: 50, off: true },
    ]);
    const mix = (items: PlannedPost[]) =>
      planningIssues({ ...base, posts: items, pillarTargets: targets, maxGapDays: 14 }).filter(
        (item) => item.kind === 'pillar_mix',
      );
    expect(mix(posts)).toMatchObject([{ date: '2026-11-01', endDate: '2026-11-30' }]);
    expect(mix(posts.slice(1))).toEqual([]);
    // Without a pillar, counted apart; targets on archived pillars ignored (edge case 13).
    expect(pillarBalance([post('x'), post('y', { pillarId: 'gone' })], targets, ['p1'])).toEqual([
      { pillarId: 'p1', count: 0, share: 0, target: 50, off: false },
      { pillarId: null, count: 2, share: 100, target: null, off: false },
    ]);
  });
});

describe('settings, snippets and ideas schemas', () => {
  const settings = {
    postingTimes: [],
    pillarTargets: [],
    maxGapDays: 3,
    occasionCategories: ['general', 'general', 'food'],
    excludedOccasionIds: [],
    xLongPosts: false,
  };

  it('takes targets once per pillar and a rhythm of 1 to 14 days', () => {
    expect(updateClientContentSettingsSchema.parse(settings).occasionCategories).toEqual([
      'general',
      'food',
    ]);
    const id = '0198f0c2-0000-7000-8000-000000000001';
    const twice = [
      { pillarId: id, percent: 50 },
      { pillarId: id, percent: 50 },
    ];
    expect(
      updateClientContentSettingsSchema.safeParse({ ...settings, pillarTargets: twice }).success,
    ).toBe(false);
    expect(
      updateClientContentSettingsSchema.safeParse({ ...settings, maxGapDays: 15 }).success,
    ).toBe(false);
  });

  it('limits a snippet by its kind', () => {
    const snippet = { kind: 'hashtags', name: 'وسوم', body: '#'.repeat(1001) };
    expect(createContentSnippetSchema.safeParse(snippet).success).toBe(false);
    expect(createContentSnippetSchema.safeParse({ ...snippet, kind: 'caption' }).success).toBe(
      true,
    );
  });

  it('drops an idea with an optional reason', () => {
    expect(dropContentIdeaSchema.parse(undefined)).toEqual({});
    expect(dropContentIdeaSchema.parse({ reason: ' ' })).toEqual({ reason: null });
  });
});
