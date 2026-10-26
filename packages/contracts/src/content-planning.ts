import { z } from 'zod';
import {
  addDays,
  type CalendarDate,
  calendarDateSchema,
  calendarMonthSchema,
  daysInclusive,
  firstOfMonth,
  lastOfMonth,
  type TimeOfDay,
  timeOfDaySchema,
  weekday,
} from './dates.js';
import { clientRefSchema, personSchema } from './images.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';
import {
  POST_PLATFORMS,
  type PostPlatform,
  type PostType,
  postPlatformSchema,
  postStatusSchema,
  postTypeSchema,
} from './post-values.js';
import { optionalText } from './text.js';

/*
 * The planning aids of the content calendar (spec F08B part C, ADR 0042): pillars, best
 * publishing times, occasions, snippets, ideas, the planning check and the Instagram grid. All
 * owned by the `content` module; the pure rules here serve the web and the API alike.
 */

export const CONTENT_PLANNING_LIMITS = {
  pillars: 10,
  pillarName: 40,
  occasionName: 80,
  /** Posting windows per platform (data table). */
  windowsPerPlatform: 4,
  snippetName: 60,
  snippetBody: { hashtags: 1000, caption: 2000 },
  /** Non-archived snippets per client (or the agency) and kind. */
  snippets: 50,
  ideaText: 300,
  dropReason: 300,
  /** The widest range of the planning check, in days. */
  planningDays: 45,
  /** The widest range of the occasions list, in days. */
  occasionDays: 400,
} as const;

/** Rules C2, C7, C8, C10 and Part D: the starting values of the planning check. */
export const PLANNING_RULES = {
  /** Rule C2: off balance from this many points away from the target. */
  pillarTolerance: 15,
  /** Rule C2: only months with at least this many posts. */
  pillarMinPosts: 4,
  /** Rule C7: a client's rhythm when it has no settings. */
  maxGapDays: 3,
  /** Rule C8: posts sharing a platform closer than this. */
  tooCloseHours: 3,
  /** Rule C10: the days the weekly notice covers. */
  weekCheckDays: 14,
  /** `post_at_risk`: not approved this many work days before the publish date. */
  atRiskWorkDays: 2,
} as const;

// Lists

/** Eight design-system chart tokens (the web maps each to a colour, both themes). */
export const PILLAR_COLORS = [
  'chart_1',
  'chart_2',
  'chart_3',
  'chart_4',
  'chart_5',
  'chart_6',
  'chart_7',
  'chart_8',
] as const;

export const pillarColorSchema = z.enum(PILLAR_COLORS).meta({ id: 'PillarColor' });

export type PillarColor = z.infer<typeof pillarColorSchema>;

export const OCCASION_CATEGORIES = [
  'general',
  'healthcare',
  'education',
  'food',
  'retail',
  'tourism',
  'beauty',
  'real_estate',
] as const;

export const occasionCategorySchema = z.enum(OCCASION_CATEGORIES).meta({ id: 'OccasionCategory' });

export type OccasionCategory = z.infer<typeof occasionCategorySchema>;

export const OCCASION_CALENDARS = ['gregorian', 'hijri', 'once'] as const;

export const occasionCalendarSchema = z.enum(OCCASION_CALENDARS).meta({ id: 'OccasionCalendar' });

export type OccasionCalendar = z.infer<typeof occasionCalendarSchema>;

export const SNIPPET_KINDS = ['hashtags', 'caption'] as const;

export const snippetKindSchema = z.enum(SNIPPET_KINDS).meta({ id: 'SnippetKind' });

export type SnippetKind = z.infer<typeof snippetKindSchema>;

export const IDEA_STATUSES = ['open', 'used', 'dropped'] as const;

export const ideaStatusSchema = z.enum(IDEA_STATUSES).meta({ id: 'IdeaStatus' });

export type IdeaStatus = z.infer<typeof ideaStatusSchema>;

// Pillars (rule C1)

const pillarNameSchema = z.string().trim().min(1).max(CONTENT_PLANNING_LIMITS.pillarName);

export const contentPillarSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    color: pillarColorSchema,
    position: z.number().int().min(1),
    archived: z.boolean(),
  })
  .meta({ id: 'ContentPillar' });

export type ContentPillar = z.infer<typeof contentPillarSchema>;

export const contentPillarListSchema = z
  .object({ items: z.array(contentPillarSchema) })
  .meta({ id: 'ContentPillarList', description: 'By position, archived ones last' });

export type ContentPillarList = z.infer<typeof contentPillarListSchema>;

export const createContentPillarSchema = z
  .object({ name: pillarNameSchema, color: pillarColorSchema })
  .meta({ id: 'CreateContentPillar' });

export type CreateContentPillar = z.infer<typeof createContentPillarSchema>;

export const updateContentPillarSchema = createContentPillarSchema
  .partial()
  .meta({ id: 'UpdateContentPillar' });

export type UpdateContentPillar = z.infer<typeof updateContentPillarSchema>;

/** Every non-archived pillar once, in the new order (`INVALID_ORDER` otherwise). */
export const contentPillarOrderSchema = z
  .object({
    ids: z
      .array(z.uuid())
      .max(CONTENT_PLANNING_LIMITS.pillars)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Each pillar once' }),
  })
  .meta({ id: 'ContentPillarOrder' });

export type ContentPillarOrder = z.infer<typeof contentPillarOrderSchema>;

// Settings and best times (rule C3)

/** A window of a platform on some weekdays (0 = Sunday), `from` before `to`. */
export const postingWindowSchema = z
  .object({
    platform: postPlatformSchema,
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, { message: 'Each day once' }),
    from: timeOfDaySchema,
    to: timeOfDaySchema,
  })
  .refine((window) => window.from < window.to, { message: 'From before to', path: ['to'] })
  .meta({ id: 'PostingWindow' });

export type PostingWindow = z.infer<typeof postingWindowSchema>;

const postingTimesSchema = z
  .array(postingWindowSchema)
  .max(POST_PLATFORMS.length * CONTENT_PLANNING_LIMITS.windowsPerPlatform)
  .refine(
    (windows) =>
      POST_PLATFORMS.every(
        (platform) =>
          windows.filter((window) => window.platform === platform).length <=
          CONTENT_PLANNING_LIMITS.windowsPerPlatform,
      ),
    { message: `At most ${CONTENT_PLANNING_LIMITS.windowsPerPlatform} windows per platform` },
  );

export const contentAgencySettingsSchema = z
  .object({ postingTimes: z.array(postingWindowSchema) })
  .meta({ id: 'ContentAgencySettings' });

export type ContentAgencySettings = z.infer<typeof contentAgencySettingsSchema>;

export const updateContentAgencySettingsSchema = z
  .object({ postingTimes: postingTimesSchema })
  .meta({ id: 'UpdateContentAgencySettings' });

export type UpdateContentAgencySettings = z.infer<typeof updateContentAgencySettingsSchema>;

/** A pillar's share of a client's month; the API checks the sum (`INVALID_TARGETS`). */
export const pillarTargetSchema = z
  .object({ pillarId: z.uuid(), percent: z.number().int().min(1).max(100) })
  .meta({ id: 'PillarTarget' });

export type PillarTarget = z.infer<typeof pillarTargetSchema>;

export const occasionSkipSchema = z
  .object({ occasionId: z.uuid(), year: z.number().int().min(2000).max(2999) })
  .meta({ id: 'OccasionSkip' });

export type OccasionSkip = z.infer<typeof occasionSkipSchema>;

/** Rule C1, C3, C4 and C7: what a client's content settings hold. */
export const updateClientContentSettingsSchema = z
  .object({
    /** A platform listed replaces the agency's windows for that platform. */
    postingTimes: postingTimesSchema,
    /** Empty, or integers summing to 100 (`INVALID_TARGETS`). */
    pillarTargets: z
      .array(pillarTargetSchema)
      .max(CONTENT_PLANNING_LIMITS.pillars)
      .refine((targets) => new Set(targets.map((t) => t.pillarId)).size === targets.length, {
        message: 'Each pillar once',
      }),
    maxGapDays: z.number().int().min(1).max(14),
    /** `general` always applies, listed or not. */
    occasionCategories: z
      .array(occasionCategorySchema)
      .transform((categories) => [...new Set(categories)]),
    excludedOccasionIds: z.array(z.uuid()).transform((ids) => [...new Set(ids)]),
    xLongPosts: z.boolean(),
  })
  .meta({ id: 'UpdateClientContentSettings' });

export type UpdateClientContentSettings = z.infer<typeof updateClientContentSettingsSchema>;

export type UpdateClientContentSettingsInput = z.input<typeof updateClientContentSettingsSchema>;

export const clientContentSettingsSchema = updateClientContentSettingsSchema
  .extend({
    clientId: z.uuid(),
    /** False until someone saved the client's settings: the defaults are shown. */
    saved: z.boolean(),
    skippedOccasions: z.array(occasionSkipSchema),
    /** The windows that apply: the client's per platform it sets, else the agency's. */
    effectivePostingTimes: z.array(postingWindowSchema),
  })
  .meta({ id: 'ClientContentSettings' });

export type ClientContentSettings = z.infer<typeof clientContentSettingsSchema>;

/** A healthcare client gets `healthcare` occasions by default (data table). */
export const defaultOccasionCategories = (healthcare: boolean): OccasionCategory[] =>
  healthcare ? ['general', 'healthcare'] : ['general'];

/** The windows that apply: the client's for every platform it lists, else the agency's. */
export function effectivePostingTimes(
  agency: readonly PostingWindow[],
  client: readonly PostingWindow[],
): PostingWindow[] {
  const own = new Set(client.map((window) => window.platform));
  return [...agency.filter((window) => !own.has(window.platform)), ...client];
}

/** A best-time chip: a window's start, with the platforms it is good for. */
export interface SuggestedTime {
  from: TimeOfDay;
  to: TimeOfDay;
  platforms: PostPlatform[];
}

/**
 * Rule C3: the windows of the date's weekday for the chosen platforms (the client's for a
 * platform it sets, else the agency's), one chip per distinct window, by start time.
 */
export function suggestPublishTimes(
  client: readonly PostingWindow[],
  agency: readonly PostingWindow[],
  date: CalendarDate,
  platforms: readonly PostPlatform[],
): SuggestedTime[] {
  const day = weekday(date);
  const chips = new Map<string, SuggestedTime>();
  for (const window of effectivePostingTimes(agency, client)) {
    if (!platforms.includes(window.platform) || !window.weekdays.includes(day)) continue;
    const key = `${window.from}-${window.to}`;
    const chip = chips.get(key) ?? { from: window.from, to: window.to, platforms: [] };
    if (!chip.platforms.includes(window.platform)) chip.platforms.push(window.platform);
    chips.set(key, chip);
  }
  return [...chips.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}

// Occasions (rules C4–C6)

export interface OccasionRule {
  calendar: OccasionCalendar;
  month: number | null;
  day: number | null;
  date: CalendarDate | null;
  durationDays: number;
}

/** Hijri month and day of each day of a Gregorian year (Umm al-Qura), computed once per year. */
const hijriYears = new Map<number, Map<string, CalendarDate>>();

function hijriDaysOf(year: number): Map<string, CalendarDate> {
  const known = hijriYears.get(year);
  if (known) return known;
  const format = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
  });
  const days = new Map<string, CalendarDate>();
  for (let date = `${year}-01-01`; date.startsWith(`${year}-`); date = addDays(date, 1)) {
    const parts = format.formatToParts(new Date(`${date}T00:00:00Z`));
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    const key = `${month}/${day}`;
    // A Hijri day falls twice in some Gregorian years: the first one counts.
    if (!days.has(key)) days.set(key, date);
  }
  hijriYears.set(year, days);
  return days;
}

/**
 * Rule C5: the occasion's start in a Gregorian year: its day each year, the Umm al-Qura date of
 * its Hijri day, or its one date; `confirmed` (a manager's date for that year) wins. Null when it
 * does not fall in the year (a `once` date of another year, a Hijri day the year misses).
 */
export function occasionStart(
  occasion: OccasionRule,
  year: number,
  confirmed: CalendarDate | null = null,
): CalendarDate | null {
  if (confirmed) return confirmed;
  if (occasion.calendar === 'once') {
    return occasion.date?.startsWith(`${year}-`) ? occasion.date : null;
  }
  if (occasion.month === null || occasion.day === null) return null;
  if (occasion.calendar === 'gregorian') {
    const date = `${year}-${String(occasion.month).padStart(2, '0')}-${String(occasion.day).padStart(2, '0')}`;
    // 29 February outside a leap year does not fall.
    return calendarDateSchema.safeParse(date).success &&
      new Date(`${date}T00:00:00Z`).getUTCDate() === occasion.day
      ? date
      : null;
  }
  return hijriDaysOf(year).get(`${occasion.month}/${occasion.day}`) ?? null;
}

/** A dated occurrence of an occasion: its first and last day, both inclusive. */
export interface OccasionOccurrence {
  year: number;
  start: CalendarDate;
  end: CalendarDate;
  confirmed: boolean;
}

/**
 * Rule C5: the occurrences of an occasion whose days, or hint window (`leadDays` before the
 * start), meet `[from, to]`; `confirmed` holds a manager's start per year.
 */
export function occasionDates(
  occasion: OccasionRule & { leadDays?: number },
  from: CalendarDate,
  to: CalendarDate,
  confirmed: ReadonlyMap<number, CalendarDate> = new Map(),
): OccasionOccurrence[] {
  const lead = occasion.leadDays ?? 0;
  const first = Number(addDays(from, -(occasion.durationDays + 1)).slice(0, 4));
  const last = Number(addDays(to, lead + 1).slice(0, 4));
  const occurrences: OccasionOccurrence[] = [];
  for (let year = first; year <= last; year++) {
    const start = occasionStart(occasion, year, confirmed.get(year) ?? null);
    if (!start) continue;
    const end = addDays(start, occasion.durationDays - 1);
    if (end < from || addDays(start, -lead) > to) continue;
    occurrences.push({ year, start, end, confirmed: confirmed.has(year) });
  }
  return occurrences;
}

const occasionFieldsSchema = z.object({
  name: z.string().trim().min(1).max(CONTENT_PLANNING_LIMITS.occasionName),
  category: occasionCategorySchema,
  /** A client's own occasion; its category is ignored. */
  clientId: z.uuid().nullable(),
  calendar: occasionCalendarSchema,
  month: z.number().int().min(1).max(12).nullable(),
  day: z.number().int().min(1).max(31).nullable(),
  date: calendarDateSchema.nullable(),
  durationDays: z.number().int().min(1).max(31),
  leadDays: z.number().int().min(0).max(30),
});

/** Rule C5's shape: a month and a day, or one date (`INVALID_DATES` otherwise). */
export function occasionRuleProblem(occasion: OccasionRule): string | null {
  if (occasion.calendar === 'once') {
    return occasion.date && occasion.month === null && occasion.day === null
      ? null
      : 'A one-time occasion has a date only';
  }
  if (occasion.month === null || occasion.day === null || occasion.date !== null) {
    return 'A yearly occasion has a month and a day only';
  }
  if (occasion.calendar === 'hijri' && occasion.day > 30) return 'A Hijri day is 1 to 30';
  return null;
}

export const createContentOccasionSchema = occasionFieldsSchema
  .extend({
    clientId: z.uuid().nullable().default(null),
    month: occasionFieldsSchema.shape.month.default(null),
    day: occasionFieldsSchema.shape.day.default(null),
    date: occasionFieldsSchema.shape.date.default(null),
    durationDays: occasionFieldsSchema.shape.durationDays.default(1),
    leadDays: occasionFieldsSchema.shape.leadDays.default(7),
  })
  .meta({ id: 'CreateContentOccasion' });

export type CreateContentOccasion = z.infer<typeof createContentOccasionSchema>;

export type CreateContentOccasionInput = z.input<typeof createContentOccasionSchema>;

/** The client never changes; the API checks the resulting rule (`INVALID_DATES`). */
export const updateContentOccasionSchema = occasionFieldsSchema
  .omit({ clientId: true })
  .partial()
  .meta({ id: 'UpdateContentOccasion' });

export type UpdateContentOccasion = z.infer<typeof updateContentOccasionSchema>;

export const confirmOccasionDateSchema = z
  .object({ startDate: calendarDateSchema })
  .meta({ id: 'ConfirmOccasionDate' });

export type ConfirmOccasionDate = z.infer<typeof confirmOccasionDateSchema>;

export const occasionOccurrenceSchema = z
  .object({
    year: z.number().int(),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    /** A manager confirmed this start (a Hijri date after the moon sighting). */
    confirmed: z.boolean(),
  })
  .meta({ id: 'OccasionOccurrence' });

export const contentOccasionSchema = occasionFieldsSchema
  .omit({ clientId: true })
  .extend({
    id: z.uuid(),
    client: clientRefSchema.nullable(),
    archived: z.boolean(),
    /** The occurrences meeting the range asked for (rule C5). */
    occurrences: z.array(occasionOccurrenceSchema),
  })
  .meta({ id: 'ContentOccasion' });

export type ContentOccasion = z.infer<typeof contentOccasionSchema>;

export const contentOccasionListQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    clientId: z.uuid().optional(),
    includeArchived: queryBooleanSchema.default(false),
  })
  .refine(
    (query) =>
      query.from <= query.to &&
      daysInclusive(query.from, query.to) <= CONTENT_PLANNING_LIMITS.occasionDays,
    { message: `A range of 1 to ${CONTENT_PLANNING_LIMITS.occasionDays} days`, path: ['to'] },
  );

export type ContentOccasionListQuery = z.infer<typeof contentOccasionListQuerySchema>;

export const contentOccasionListSchema = z
  .object({ items: z.array(contentOccasionSchema) })
  .meta({ id: 'ContentOccasionList', description: 'By next start in the range, then name' });

export type ContentOccasionList = z.infer<typeof contentOccasionListSchema>;

/** An occasion as the calendar shows it on its days. */
export const calendarOccasionSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    category: occasionCategorySchema,
    clientId: z.uuid().nullable(),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    /** The hint starts this many days before. */
    leadDays: z.number().int().min(0),
    confirmed: z.boolean(),
    /** With `clientId` asked: a post of the client carries it (rule C6); null otherwise. */
    covered: z.boolean().nullable(),
    /** With `clientId` asked: "No post this year" was chosen. */
    skipped: z.boolean().nullable(),
  })
  .meta({ id: 'CalendarOccasion' });

export type CalendarOccasion = z.infer<typeof calendarOccasionSchema>;

/**
 * Rule C4: an occasion applies to a client when it is the client's own, or `general`, or of an
 * enabled category, and not excluded. Skips are per year: the caller checks them.
 */
export function occasionApplies(
  occasion: { id: string; clientId: string | null; category: OccasionCategory },
  client: {
    id: string;
    occasionCategories: readonly OccasionCategory[];
    excludedOccasionIds: readonly string[];
  },
): boolean {
  if (client.excludedOccasionIds.includes(occasion.id)) return false;
  if (occasion.clientId) return occasion.clientId === client.id;
  return occasion.category === 'general' || client.occasionCategories.includes(occasion.category);
}

// Snippets (rule A10)

export const contentSnippetSchema = z
  .object({
    id: z.uuid(),
    /** Null for an agency snippet. */
    client: clientRefSchema.nullable(),
    kind: snippetKindSchema,
    name: z.string(),
    body: z.string(),
    canEdit: z.boolean(),
  })
  .meta({ id: 'ContentSnippet' });

export type ContentSnippet = z.infer<typeof contentSnippetSchema>;

export const contentSnippetListQuerySchema = z.object({
  /** The client's snippets and the agency's; the agency's only when left out. */
  clientId: z.uuid().optional(),
  kind: snippetKindSchema.optional(),
});

export type ContentSnippetListQuery = z.infer<typeof contentSnippetListQuerySchema>;

export const contentSnippetListSchema = z.object({ items: z.array(contentSnippetSchema) }).meta({
  id: 'ContentSnippetList',
  description: "The client's first, then the agency's, by name",
});

export type ContentSnippetList = z.infer<typeof contentSnippetListSchema>;

const snippetNameSchema = z.string().trim().min(1).max(CONTENT_PLANNING_LIMITS.snippetName);

const snippetBodySchema = z.string().trim().min(1).max(CONTENT_PLANNING_LIMITS.snippetBody.caption);

export const createContentSnippetSchema = z
  .object({
    clientId: z.uuid().nullable().default(null),
    kind: snippetKindSchema,
    name: snippetNameSchema,
    body: snippetBodySchema,
  })
  .refine((snippet) => snippet.body.length <= CONTENT_PLANNING_LIMITS.snippetBody[snippet.kind], {
    message: 'The text is too long for this kind',
    path: ['body'],
  })
  .meta({ id: 'CreateContentSnippet' });

export type CreateContentSnippet = z.infer<typeof createContentSnippetSchema>;

export type CreateContentSnippetInput = z.input<typeof createContentSnippetSchema>;

/** The API checks the body against the snippet's kind. */
export const updateContentSnippetSchema = z
  .object({ name: snippetNameSchema, body: snippetBodySchema })
  .partial()
  .meta({ id: 'UpdateContentSnippet' });

export type UpdateContentSnippet = z.infer<typeof updateContentSnippetSchema>;

// Ideas (rule C12)

const ideaTextSchema = z.string().trim().min(1).max(CONTENT_PLANNING_LIMITS.ideaText);

export const createContentIdeaSchema = z
  .object({
    text: ideaTextSchema,
    clientId: z.uuid().nullable().default(null),
    pillarId: z.uuid().nullable().default(null),
    occasionId: z.uuid().nullable().default(null),
  })
  .meta({ id: 'CreateContentIdea' });

export type CreateContentIdea = z.infer<typeof createContentIdeaSchema>;

export type CreateContentIdeaInput = z.input<typeof createContentIdeaSchema>;

export const updateContentIdeaSchema = z
  .object({
    text: ideaTextSchema,
    clientId: z.uuid().nullable(),
    pillarId: z.uuid().nullable(),
    occasionId: z.uuid().nullable(),
  })
  .partial()
  .meta({ id: 'UpdateContentIdea' });

export type UpdateContentIdea = z.infer<typeof updateContentIdeaSchema>;

export const dropContentIdeaSchema = z
  .object({ reason: optionalText(CONTENT_PLANNING_LIMITS.dropReason).optional() })
  .prefault({})
  .meta({ id: 'DropContentIdea' });

export type DropContentIdea = z.infer<typeof dropContentIdeaSchema>;

export const contentIdeaSchema = z
  .object({
    id: z.uuid(),
    text: z.string(),
    client: clientRefSchema.nullable(),
    pillar: contentPillarSchema.nullable(),
    occasion: z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }).nullable(),
    status: ideaStatusSchema,
    /** Set once the idea became a post. */
    post: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    dropReason: z.string().nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    permissions: z.object({
      canEdit: z.boolean(),
      canDrop: z.boolean(),
      canRestore: z.boolean(),
      canUse: z.boolean(),
    }),
  })
  .meta({ id: 'ContentIdea' });

export type ContentIdea = z.infer<typeof contentIdeaSchema>;

export const contentIdeaListQuerySchema = pageQuerySchema.extend({
  status: ideaStatusSchema.default('open'),
  clientId: z.uuid().optional(),
  mine: queryBooleanSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export type ContentIdeaListQuery = z.infer<typeof contentIdeaListQuerySchema>;

export type ContentIdeaListQueryInput = z.input<typeof contentIdeaListQuerySchema>;

export const contentIdeaPageSchema = pageSchema(contentIdeaSchema).meta({
  id: 'ContentIdeaPage',
  description: 'Ideas, newest first',
});

export type ContentIdeaPage = z.infer<typeof contentIdeaPageSchema>;

// The planning check (rules C2, C6–C10)

export const PLANNING_ISSUE_KINDS = [
  'gap',
  'too_close',
  'under_committed',
  'occasion_uncovered',
  'pillar_mix',
] as const;

export const planningIssueKindSchema = z
  .enum(PLANNING_ISSUE_KINDS)
  .meta({ id: 'PlanningIssueKind' });

export type PlanningIssueKind = z.infer<typeof planningIssueKindSchema>;

/** What commitments count planned posts against (rule C9). */
export const COMMITMENT_KINDS = ['post', 'reel', 'story'] as const;

export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

export const planningIssueSchema = z
  .object({
    kind: planningIssueKindSchema,
    /** The first day concerned: a gap's first day, the posts' day, the occasion's start. */
    date: calendarDateSchema,
    /** A gap's last day, an occasion's last day. */
    endDate: calendarDateSchema.nullable(),
    /** `too_close`: the two posts; their shared platform. */
    postIds: z.array(z.uuid()),
    platform: postPlatformSchema.nullable(),
    /** `occasion_uncovered`. */
    occasionId: z.uuid().nullable(),
    /** `under_committed`: what fell short, planned against committed. */
    commitment: z.enum(COMMITMENT_KINDS).nullable(),
    planned: z.number().int().min(0).nullable(),
    committed: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'PlanningIssue' });

export type PlanningIssue = z.infer<typeof planningIssueSchema>;

/** A planned post as the planning check reads it: neither cancelled nor archived. */
export interface PlannedPost {
  id: string;
  type: PostType;
  platforms: readonly PostPlatform[];
  publishDate: CalendarDate;
  publishTime: TimeOfDay | null;
  pillarId: string | null;
  occasionId: string | null;
}

/** An occasion that applies to the client, dated (rules C4–C6). */
export interface PlannedOccasion {
  id: string;
  start: CalendarDate;
  end: CalendarDate;
  leadDays: number;
  /** "No post this year" was chosen for its year. */
  skipped: boolean;
}

/** An open retainer cycle of the client with its committed lines (rule C9). */
export interface PlannedCommitment {
  cycleId: string;
  from: CalendarDate;
  to: CalendarDate;
  lines: readonly { kind: string; count: number }[];
}

const minutesOf = (time: TimeOfDay) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Rule C8: less than `tooCloseHours` apart, or the same day when either has no time. */
function tooClose(a: PlannedPost, b: PlannedPost): boolean {
  if (!a.publishTime || !b.publishTime) return a.publishDate === b.publishDate;
  const days = daysInclusive(a.publishDate, b.publishDate) - 1;
  const span = Math.abs(days * 24 * 60 + minutesOf(b.publishTime) - minutesOf(a.publishTime));
  return span < PLANNING_RULES.tooCloseHours * 60;
}

/** Rule C9: the commitment a post's type counts on. */
export const commitmentOf = (type: PostType): CommitmentKind =>
  type === 'reel' ? 'reel' : type === 'story' ? 'story' : 'post';

/** Rule C9: the cycle line kinds each commitment counts. */
const COMMITMENT_LINES: Record<CommitmentKind, readonly string[]> = {
  post: ['post', 'design'],
  reel: ['reel'],
  story: ['story'],
};

/** Rule C9: planned against committed per commitment kind of one cycle. */
export function commitmentsOf(
  cycle: PlannedCommitment,
  posts: readonly PlannedPost[],
): { kind: CommitmentKind; planned: number; committed: number }[] {
  return COMMITMENT_KINDS.flatMap((kind) => {
    const committed = cycle.lines
      .filter((line) => COMMITMENT_LINES[kind].includes(line.kind))
      .reduce((sum, line) => sum + line.count, 0);
    if (committed === 0) return [];
    const planned = posts.filter(
      (post) =>
        commitmentOf(post.type) === kind &&
        cycle.from <= post.publishDate &&
        post.publishDate <= cycle.to,
    ).length;
    return [{ kind, planned, committed }];
  });
}

export const pillarBalanceItemSchema = z
  .object({
    /** Null: posts without a pillar, counted apart. */
    pillarId: z.uuid().nullable(),
    count: z.number().int().min(0),
    /** Whole percent of the month's posts. */
    share: z.number().int().min(0).max(100),
    target: z.number().int().min(0).max(100).nullable(),
    off: z.boolean(),
  })
  .meta({ id: 'PillarBalanceItem' });

export type PillarBalanceItem = z.infer<typeof pillarBalanceItemSchema>;

/**
 * Rule C2: each pillar's share of the month's posts against its target; off balance at
 * `pillarTolerance` points or more away when the month has `pillarMinPosts` posts. Targets on
 * pillars not given (archived, edge case 13) are ignored.
 */
export function pillarBalance(
  posts: readonly Pick<PlannedPost, 'pillarId'>[],
  targets: readonly PillarTarget[],
  pillarIds: readonly string[],
): PillarBalanceItem[] {
  const total = posts.length;
  const share = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));
  const enough = total >= PLANNING_RULES.pillarMinPosts;
  const items = pillarIds.map((pillarId) => {
    const count = posts.filter((post) => post.pillarId === pillarId).length;
    const target = targets.find((item) => item.pillarId === pillarId)?.percent ?? null;
    const off =
      enough &&
      targets.length > 0 &&
      Math.abs(share(count) - (target ?? 0)) >= PLANNING_RULES.pillarTolerance;
    return { pillarId, count, share: share(count), target, off };
  });
  const none = posts.filter((post) => !post.pillarId || !pillarIds.includes(post.pillarId)).length;
  return none > 0
    ? [...items, { pillarId: null, count: none, share: share(none), target: null, off: false }]
    : items;
}

const issue = (
  fields: Partial<PlanningIssue> & Pick<PlanningIssue, 'kind' | 'date'>,
): PlanningIssue => ({
  endDate: null,
  postIds: [],
  platform: null,
  occasionId: null,
  commitment: null,
  planned: null,
  committed: null,
  ...fields,
});

/**
 * Rule C10 for one client over `[from, to]`: gaps longer than its rhythm (C7), posts too close
 * on a platform (C8), cycles planned below their commitment (C9), occasions without a post
 * (C6) and an unbalanced pillar mix in the month of `from` (C2). `posts` are the client's
 * non-cancelled, non-archived posts of every date the cycles and occasions need.
 */
export function planningIssues(input: {
  from: CalendarDate;
  to: CalendarDate;
  maxGapDays: number;
  posts: readonly PlannedPost[];
  occasions: readonly PlannedOccasion[];
  commitments: readonly PlannedCommitment[];
  pillarTargets: readonly PillarTarget[];
  pillarIds: readonly string[];
}): PlanningIssue[] {
  const { from, to } = input;
  const issues: PlanningIssue[] = [];
  const inRange = input.posts.filter((post) => from <= post.publishDate && post.publishDate <= to);
  const days = new Set(inRange.map((post) => post.publishDate));
  let runStart: CalendarDate | null = null;
  for (let date = from; date <= addDays(to, 1); date = addDays(date, 1)) {
    const empty = date <= to && !days.has(date);
    if (empty) {
      runStart ??= date;
      continue;
    }
    if (runStart && daysInclusive(runStart, addDays(date, -1)) > input.maxGapDays) {
      issues.push(issue({ kind: 'gap', date: runStart, endDate: addDays(date, -1) }));
    }
    runStart = null;
  }
  const sorted = [...inRange].sort(
    (a, b) =>
      a.publishDate.localeCompare(b.publishDate) ||
      (a.publishTime ?? '').localeCompare(b.publishTime ?? ''),
  );
  sorted.forEach((post, index) => {
    for (const other of sorted.slice(index + 1)) {
      if (daysInclusive(post.publishDate, other.publishDate) > 2) break;
      const platform = post.platforms.find((item) => other.platforms.includes(item));
      if (platform && tooClose(post, other)) {
        issues.push(
          issue({
            kind: 'too_close',
            date: post.publishDate,
            postIds: [post.id, other.id],
            platform,
          }),
        );
      }
    }
  });
  for (const cycle of input.commitments) {
    if (cycle.to < from || cycle.from > to) continue;
    for (const line of commitmentsOf(cycle, input.posts)) {
      if (line.planned < line.committed) {
        issues.push(
          issue({
            kind: 'under_committed',
            date: cycle.from,
            endDate: cycle.to,
            commitment: line.kind,
            planned: line.planned,
            committed: line.committed,
          }),
        );
      }
    }
  }
  const covered = new Set(input.posts.flatMap((post) => post.occasionId ?? []));
  for (const occasion of input.occasions) {
    if (occasion.skipped || covered.has(occasion.id)) continue;
    if (occasion.end < from || addDays(occasion.start, -occasion.leadDays) > to) continue;
    issues.push(
      issue({
        kind: 'occasion_uncovered',
        date: occasion.start,
        endDate: occasion.end,
        occasionId: occasion.id,
      }),
    );
  }
  const month = input.posts.filter(
    (post) => firstOfMonth(from) <= post.publishDate && post.publishDate <= lastOfMonth(from),
  );
  if (pillarBalance(month, input.pillarTargets, input.pillarIds).some((item) => item.off)) {
    issues.push(
      issue({ kind: 'pillar_mix', date: firstOfMonth(from), endDate: lastOfMonth(from) }),
    );
  }
  return issues;
}

export const contentPlanningQuerySchema = z
  .object({ from: calendarDateSchema, to: calendarDateSchema, clientId: z.uuid().optional() })
  .refine(
    (query) =>
      query.from <= query.to &&
      daysInclusive(query.from, query.to) <= CONTENT_PLANNING_LIMITS.planningDays,
    { message: `A range of 1 to ${CONTENT_PLANNING_LIMITS.planningDays} days`, path: ['to'] },
  );

export type ContentPlanningQuery = z.infer<typeof contentPlanningQuerySchema>;

export const commitmentSchema = z
  .object({
    cycleId: z.uuid(),
    retainer: z.object({ id: z.uuid(), name: z.string() }),
    from: calendarDateSchema,
    to: calendarDateSchema,
    kind: z.enum(COMMITMENT_KINDS),
    planned: z.number().int().min(0),
    committed: z.number().int().min(0),
  })
  .meta({ id: 'Commitment' });

export type Commitment = z.infer<typeof commitmentSchema>;

export const clientPlanningSchema = z
  .object({
    client: clientRefSchema,
    issues: z.array(planningIssueSchema),
    /** The month of `from`. */
    pillarBalance: z.object({
      month: calendarMonthSchema,
      posts: z.number().int().min(0),
      items: z.array(pillarBalanceItemSchema),
    }),
    commitments: z.array(commitmentSchema),
  })
  .meta({ id: 'ClientPlanning' });

export type ClientPlanning = z.infer<typeof clientPlanningSchema>;

export const contentPlanningSchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    /** Clients with an open cycle that has a post, reel, story or design line, or with settings. */
    clients: z.array(clientPlanningSchema),
  })
  .meta({ id: 'ContentPlanning' });

export type ContentPlanning = z.infer<typeof contentPlanningSchema>;

/** A planning issue of one client, as the calendar marks it. */
export const calendarIssueSchema = planningIssueSchema
  .extend({ clientId: z.uuid() })
  .meta({ id: 'CalendarIssue' });

export type CalendarIssue = z.infer<typeof calendarIssueSchema>;

// The Instagram grid (rule C11)

export const contentGridQuerySchema = z.object({
  clientId: z.uuid(),
  month: calendarMonthSchema,
});

export type ContentGridQuery = z.infer<typeof contentGridQuerySchema>;

export const gridTileSchema = z
  .object({
    postId: z.uuid(),
    title: z.string(),
    type: postTypeSchema,
    status: postStatusSchema,
    publishDate: calendarDateSchema,
    publishTime: timeOfDaySchema.nullable(),
    /** The first slide with a preview; null shows the type's icon. */
    thumbnailVersionId: z.uuid().nullable(),
  })
  .meta({ id: 'GridTile' });

export type GridTile = z.infer<typeof gridTileSchema>;

export const contentGridSchema = z
  .object({
    client: clientRefSchema,
    month: calendarMonthSchema,
    /** Newest first, three months up to the end of `month`. */
    tiles: z.array(gridTileSchema),
  })
  .meta({ id: 'ContentGrid' });

export type ContentGrid = z.infer<typeof contentGridSchema>;
