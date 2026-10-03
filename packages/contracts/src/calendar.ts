import { z } from 'zod';
import { contactSchema } from './clients.js';
import {
  addDays,
  businessDate,
  type CalendarDate,
  calendarDateSchema,
  daysInclusive,
  nextWorkDay,
  nthWorkDay,
  workDaysBefore,
} from './dates.js';
import { type DepartmentCode, departmentCodeSchema } from './departments.js';
import { invoiceStatusSchema } from './invoices.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema, queryListSchema } from './lists.js';
import { taskLinkProblem, taskStatusSchema, taskTitleSchema } from './tasks.js';
import { httpUrlSchema, optionalText } from './text.js';
import { phoneSchema } from './users.js';

/*
 * The company calendar (spec F11, ADR 0022): shoots tied to a Photography task, meetings with
 * team attendees and client contacts, and the key dates of projects and retainers.
 */

export const SHOOT_TYPES = ['product', 'video', 'event', 'people', 'other'] as const;

export const shootTypeSchema = z.enum(SHOOT_TYPES).meta({ id: 'ShootType' });

export type ShootType = z.infer<typeof shootTypeSchema>;

export const SHOOT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;

export const shootStatusSchema = z.enum(SHOOT_STATUSES).meta({ id: 'ShootStatus' });

export type ShootStatus = z.infer<typeof shootStatusSchema>;

export const CREW_ROLES = [
  'photographer',
  'videographer',
  'assistant',
  'director',
  'other',
] as const;

export const crewRoleSchema = z.enum(CREW_ROLES).meta({ id: 'CrewRole' });

export type CrewRole = z.infer<typeof crewRoleSchema>;

export const MEETING_STATUSES = ['scheduled', 'cancelled'] as const;

export const meetingStatusSchema = z.enum(MEETING_STATUSES).meta({ id: 'MeetingStatus' });

export type MeetingStatus = z.infer<typeof meetingStatusSchema>;

/** Limits of shoots, meetings and calendar queries (edge case 11). */
export const CALENDAR_LIMITS = {
  title: 160,
  location: 300,
  brief: 2000,
  closeNote: 2000,
  cancelReason: 500,
  shotText: 300,
  shotNote: 500,
  externalCrewName: 80,
  crew: 10,
  externalCrew: 10,
  shots: 100,
  attendees: 20,
  contacts: 10,
  /** The longest shoot, start to end. */
  shootHours: 72,
  /** The longest meeting, start to end. */
  meetingHours: 12,
  /** The widest range one calendar request covers, in days. */
  calendarDays: 45,
  /** Users one conflict query checks. */
  conflictUsers: 30,
} as const;

/** The department every shoot task and the default editing task belong to. */
export const SHOOT_DEPARTMENT: DepartmentCode = 'photography';

// Rules

type Interval = { startsAt: string | Date; endsAt: string | Date };

const instant = (value: string | Date) =>
  typeof value === 'string' ? Date.parse(value) : value.getTime();

/** Rule 5: two `[start, end)` intervals overlap; touching ends do not. */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return instant(a.startsAt) < instant(b.endsAt) && instant(b.startsAt) < instant(a.endsAt);
}

/** "The shoot's day": the Damascus date of its start (edge case 3). */
export const calendarDay = (startsAt: string | Date): CalendarDate =>
  businessDate(new Date(instant(startsAt)));

/** The daily job reminds on the last work day before the item's day (Friday skipped). */
export const upcomingReminderDay = (day: CalendarDate): CalendarDate => workDaysBefore(day, 1);

/** The daily job reports a shoot not closed on the first work day after its end day. */
export const notClosedReminderDay = (endsAt: string | Date): CalendarDate =>
  nextWorkDay(calendarDay(endsAt));

/**
 * The title prefixes of the tasks a shoot creates (rules 3 and 12). Stored in Arabic, the
 * language of the records, like F08's post tasks.
 */
const SHOOT_TASK_PREFIX = 'تصوير';
const EDITING_TASK_PREFIX = 'مونتاج';

/** Rule 3: "Shoot: <shoot title>", cut to the length of a task title. */
export const shootTaskTitle = (title: string): string =>
  `${SHOOT_TASK_PREFIX}: ${title}`.slice(0, 160);

/** Rule 12: "Editing: <shoot title>", cut to the length of a task title. */
export const editingTaskTitle = (title: string): string =>
  `${EDITING_TASK_PREFIX}: ${title}`.slice(0, 160);

/** Rule 12: the close day plus 3 work days. */
export const editingTaskDueDate = (closeDay: CalendarDate): CalendarDate =>
  nthWorkDay(addDays(closeDay, 1), 3);

/**
 * Rule 12: what the close dialog proposes. The editing task is created by default unless the
 * shoot task already has non-cancelled dependents; its assignee is the lead when they belong to
 * Photography; client approval is on when the shoot has a client.
 */
export function editingTaskDefaults(input: {
  shootTitle: string;
  closeDay: CalendarDate;
  lead: { id: string; inPhotography: boolean } | null;
  hasDependents: boolean;
  hasClient: boolean;
}) {
  return {
    create: !input.hasDependents,
    title: editingTaskTitle(input.shootTitle),
    department: SHOOT_DEPARTMENT,
    assigneeId: input.lead?.inPhotography ? input.lead.id : null,
    dueDate: editingTaskDueDate(input.closeDay),
    needsClientApproval: input.hasClient,
  };
}

/** Why a start and end do not make a booking, or null: the end first, then the length. */
export function timeRangeProblem(
  startsAt: string,
  endsAt: string,
  maxHours: number,
): 'order' | 'length' | null {
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) return 'order';
  if (length > maxHours * 60 * 60 * 1000) return 'length';
  return null;
}

// Inputs

const instantSchema = z.iso.datetime({ offset: true });

const titleSchema = z.string().trim().min(1).max(CALENDAR_LIMITS.title);

const uniqueIds = (max: number) =>
  z
    .array(z.uuid())
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.uuid()).max(max));

/** Adds the time range issues of `timeRangeProblem` when both ends are given. */
function checkTimeRange(maxHours: number) {
  return (value: { startsAt?: string; endsAt?: string }, ctx: z.RefinementCtx) => {
    if (!value.startsAt !== !value.endsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Start and end go together' });
      return;
    }
    if (!value.startsAt || !value.endsAt) return;
    const problem = timeRangeProblem(value.startsAt, value.endsAt, maxHours);
    if (problem === 'order')
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end is after the start' });
    if (problem === 'length')
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: `At most ${maxHours} hours long`,
      });
  };
}

/** A team crew member; the API checks the user and the single lead (`LEAD_REQUIRED`). */
export const crewMemberInputSchema = z
  .object({ userId: z.uuid(), role: crewRoleSchema, isLead: z.boolean().default(false) })
  .meta({ id: 'CrewMemberInput' });

const crewInputSchema = z
  .array(crewMemberInputSchema)
  .min(1)
  .max(CALENDAR_LIMITS.crew)
  .refine((crew) => new Set(crew.map((member) => member.userId)).size === crew.length, {
    message: 'Each person once',
  });

/** A freelancer: a name and a role, never checked for conflicts. */
export const externalCrewMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(CALENDAR_LIMITS.externalCrewName),
    role: crewRoleSchema,
    phone: phoneSchema.default(null),
  })
  .meta({ id: 'ExternalCrewMember' });

export type ExternalCrewMember = z.infer<typeof externalCrewMemberSchema>;

const externalCrewInputSchema = z.array(externalCrewMemberSchema).max(CALENDAR_LIMITS.externalCrew);

/** A shot list item; `id` keeps an existing item and its tick (rule 7). */
export const shotInputSchema = z
  .object({
    id: z.uuid().optional(),
    text: z.string().trim().min(1).max(CALENDAR_LIMITS.shotText),
    note: optionalText(CALENDAR_LIMITS.shotNote).default(null),
  })
  .meta({ id: 'ShotInput' });

const shotsInputSchema = z.array(shotInputSchema).max(CALENDAR_LIMITS.shots);

const shootFieldsSchema = z.object({
  title: titleSchema,
  type: shootTypeSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
  location: z.string().trim().min(1).max(CALENDAR_LIMITS.location),
  mapUrl: httpUrlSchema.nullable(),
  brief: optionalText(CALENDAR_LIMITS.brief),
  crew: crewInputSchema,
  externalCrew: externalCrewInputSchema,
  /** Save despite the conflicts the API reported (rule 5); recorded in the audit entry. */
  acceptConflicts: z.boolean().default(false),
});

/**
 * Rule 3: the links of a new shoot task, under the shoot's client; F06 rules apply (`UNKNOWN_*`,
 * closed cycle).
 */
export const shootTaskLinksSchema = z
  .object({
    projectId: z.uuid().nullable().default(null),
    milestoneId: z.uuid().nullable().default(null),
    retainerCycleId: z.uuid().nullable().default(null),
    cycleLineId: z.uuid().nullable().default(null),
  })
  .meta({ id: 'ShootTaskLinks' });

/**
 * Rule 1: booked from an existing task (`taskId`, whose client the shoot takes) or with a new
 * shoot task (`newTask`, under `clientId`; null books an internal shoot), never both.
 */
export const createShootSchema = shootFieldsSchema
  .extend({
    mapUrl: httpUrlSchema.nullable().default(null),
    brief: optionalText(CALENDAR_LIMITS.brief).default(null),
    externalCrew: externalCrewInputSchema.default([]),
    shots: shotsInputSchema.default([]),
    taskId: z.uuid().optional(),
    newTask: shootTaskLinksSchema.optional(),
    clientId: z.uuid().nullable().optional(),
  })
  .superRefine((shoot, ctx) => {
    if (!shoot.taskId === !shoot.newTask)
      ctx.addIssue({ code: 'custom', path: ['taskId'], message: 'Either taskId or newTask' });
    if (shoot.taskId && shoot.clientId !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['clientId'],
        message: 'A shoot booked from a task takes its client',
      });
    if (shoot.newTask) {
      const problem = taskLinkProblem({ clientId: shoot.clientId ?? null, ...shoot.newTask });
      if (problem)
        ctx.addIssue({
          code: 'custom',
          path: ['newTask', problem],
          message: 'The task links do not match',
        });
    }
    checkTimeRange(CALENDAR_LIMITS.shootHours)(shoot, ctx);
  })
  .meta({ id: 'CreateShoot' });

export type CreateShoot = z.infer<typeof createShootSchema>;

export type CreateShootInput = z.input<typeof createShootSchema>;

/**
 * Rule 8: any subset of the fields while scheduled; the start and the end go together. The shot
 * list has its own route; the client and the task never change.
 */
export const updateShootSchema = shootFieldsSchema
  .partial()
  .extend({ acceptConflicts: z.boolean().default(false) })
  .superRefine(checkTimeRange(CALENDAR_LIMITS.shootHours))
  .meta({ id: 'UpdateShoot' });

export type UpdateShoot = z.infer<typeof updateShootSchema>;

export type UpdateShootInput = z.input<typeof updateShootSchema>;

/** Rule 7: the whole list in its new order. */
export const shotListInputSchema = z
  .object({ shots: shotsInputSchema })
  .meta({ id: 'ShotListInput' });

export type ShotListInput = z.infer<typeof shotListInputSchema>;

export type ShotListInputValue = z.input<typeof shotListInputSchema>;

export const shotDoneInputSchema = z.object({ done: z.boolean() }).meta({ id: 'ShotDoneInput' });

export type ShotDoneInput = z.infer<typeof shotDoneInputSchema>;

/**
 * Rule 12: the editing task created by closing. The API checks the assignee (`INVALID_ASSIGNEE`)
 * and that the due date is not in the past.
 */
export const editingTaskInputSchema = z
  .object({
    title: taskTitleSchema,
    department: departmentCodeSchema,
    assigneeId: z.uuid().nullable().default(null),
    dueDate: calendarDateSchema,
    needsClientApproval: z.boolean(),
  })
  .meta({ id: 'EditingTaskInput' });

/** Rules 10–12; `editingTask` null closes without one. */
export const closeShootSchema = z
  .object({
    note: optionalText(CALENDAR_LIMITS.closeNote).default(null),
    rawFilesUrl: httpUrlSchema.nullable().default(null),
    editingTask: editingTaskInputSchema.nullable(),
  })
  .meta({ id: 'CloseShoot' });

export type CloseShoot = z.infer<typeof closeShootSchema>;

export type CloseShootInput = z.input<typeof closeShootSchema>;

/** Rule 13: `cancelTask` also cancels the shoot task with the same reason. */
export const cancelShootSchema = z
  .object({
    reason: z.string().trim().min(1).max(CALENDAR_LIMITS.cancelReason),
    cancelTask: z.boolean().default(false),
  })
  .meta({ id: 'CancelShoot' });

export type CancelShoot = z.infer<typeof cancelShootSchema>;

export type CancelShootInput = z.input<typeof cancelShootSchema>;

export const reopenShootSchema = z
  .object({ acceptConflicts: z.boolean().default(false) })
  .meta({ id: 'ReopenShoot' });

export type ReopenShoot = z.infer<typeof reopenShootSchema>;

const meetingFieldsSchema = z.object({
  title: titleSchema,
  /** Changing it needs the contacts of the old client dropped in the same request. */
  clientId: z.uuid().nullable(),
  startsAt: instantSchema,
  endsAt: instantSchema,
  location: optionalText(CALENDAR_LIMITS.location),
  onlineUrl: httpUrlSchema.nullable(),
  agenda: optionalText(CALENDAR_LIMITS.brief),
  /** Team members other than the organizer (`INVALID_ATTENDEE`). */
  attendeeIds: uniqueIds(CALENDAR_LIMITS.attendees),
  /** Contacts of the meeting's client (`UNKNOWN_CONTACT`). */
  contactIds: uniqueIds(CALENDAR_LIMITS.contacts),
  acceptConflicts: z.boolean().default(false),
});

/** Rule 14: the creator becomes the organizer. */
export const createMeetingSchema = meetingFieldsSchema
  .extend({
    clientId: z.uuid().nullable().default(null),
    location: optionalText(CALENDAR_LIMITS.location).default(null),
    onlineUrl: httpUrlSchema.nullable().default(null),
    agenda: optionalText(CALENDAR_LIMITS.brief).default(null),
    attendeeIds: uniqueIds(CALENDAR_LIMITS.attendees).default([]),
    contactIds: uniqueIds(CALENDAR_LIMITS.contacts).default([]),
  })
  .superRefine(checkTimeRange(CALENDAR_LIMITS.meetingHours))
  .meta({ id: 'CreateMeeting' });

export type CreateMeeting = z.infer<typeof createMeetingSchema>;

export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

/** Rule 14: any subset; `organizerId` is another non-archived user. */
export const updateMeetingSchema = meetingFieldsSchema
  .extend({ organizerId: z.uuid() })
  .partial()
  .extend({ acceptConflicts: z.boolean().default(false) })
  .superRefine(checkTimeRange(CALENDAR_LIMITS.meetingHours))
  .meta({ id: 'UpdateMeeting' });

export type UpdateMeeting = z.infer<typeof updateMeetingSchema>;

export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

export const cancelMeetingSchema = z
  .object({ reason: optionalText(CALENDAR_LIMITS.cancelReason).default(null) })
  .meta({ id: 'CancelMeeting' });

export type CancelMeeting = z.infer<typeof cancelMeetingSchema>;

/** Rule 5 for the people of a booking being edited, before saving. */
export const conflictQuerySchema = z
  .object({
    userIds: queryListSchema(z.uuid()).pipe(
      z.array(z.uuid()).min(1).max(CALENDAR_LIMITS.conflictUsers),
    ),
    startsAt: instantSchema,
    endsAt: instantSchema,
    /** The shoot or meeting being edited, which never conflicts with itself. */
    excludeShootId: z.uuid().optional(),
    excludeMeetingId: z.uuid().optional(),
  })
  .refine((query) => Date.parse(query.startsAt) < Date.parse(query.endsAt), {
    message: 'The end is after the start',
    path: ['endsAt'],
  });

export type ConflictQuery = z.infer<typeof conflictQuerySchema>;

export type ConflictQueryInput = z.input<typeof conflictQuerySchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

const archivablePersonSchema = personSchema.extend({ archived: z.boolean() });

export const CALENDAR_ITEM_KINDS = ['shoot', 'meeting'] as const;

export const calendarItemKindSchema = z.enum(CALENDAR_ITEM_KINDS).meta({ id: 'CalendarItemKind' });

export type CalendarItemKind = z.infer<typeof calendarItemKindSchema>;

/** Rule 5: one person booked elsewhere at an overlapping time. */
export const scheduleConflictSchema = z
  .object({
    user: personSchema,
    kind: calendarItemKindSchema,
    id: z.uuid(),
    title: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .meta({ id: 'ScheduleConflict' });

export type ScheduleConflict = z.infer<typeof scheduleConflictSchema>;

export const conflictListSchema = z
  .object({ items: z.array(scheduleConflictSchema) })
  .meta({ id: 'ConflictList', description: 'By user, then start time' });

export type ConflictList = z.infer<typeof conflictListSchema>;

/** A shoot as the calendar and the lists show it. */
export const shootSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    type: shootTypeSchema,
    status: shootStatusSchema,
    /** Null for an internal shoot; `archived` is the client's state (edge case 9). */
    client: archivablePersonSchema.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    location: z.string(),
    lead: archivablePersonSchema,
    /** Team and external crew. */
    crewCount: z.number().int().min(0),
    /** A team crew member is booked elsewhere at an overlapping time (rule 5). */
    conflict: z.boolean(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Shoot' });

export type Shoot = z.infer<typeof shootSchema>;

export const crewMemberSchema = z
  .object({ user: archivablePersonSchema, role: crewRoleSchema, isLead: z.boolean() })
  .meta({ id: 'CrewMember' });

export type CrewMember = z.infer<typeof crewMemberSchema>;

export const shotSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().min(1),
    text: z.string(),
    note: z.string().nullable(),
    doneAt: z.iso.datetime().nullable(),
    doneBy: personSchema.nullable(),
  })
  .meta({ id: 'Shot' });

export type Shot = z.infer<typeof shotSchema>;

const shootTaskSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  department: departmentCodeSchema,
  status: taskStatusSchema,
});

export const shootPermissionsSchema = z
  .object({
    /** Shoot scope on a scheduled, non-archived shoot (rule 8). */
    canEdit: z.boolean(),
    /** Team crew or shoot scope on a scheduled, non-archived shoot (rule 7). */
    canTick: z.boolean(),
    /** Shoot scope or the lead, on a scheduled shoot that has started (rule 10). */
    canClose: z.boolean(),
    canCancel: z.boolean(),
    canReopen: z.boolean(),
    /** Shoot scope `all`. */
    canArchive: z.boolean(),
  })
  .meta({ id: 'ShootPermissions', description: 'What the caller may do, for the UI' });

export type ShootPermissions = z.infer<typeof shootPermissionsSchema>;

export const shootDetailSchema = shootSchema
  .extend({
    mapUrl: z.string().nullable(),
    brief: z.string().nullable(),
    /** The lead first, then by when they were added. */
    crew: z.array(crewMemberSchema),
    externalCrew: z.array(externalCrewMemberSchema.extend({ phone: z.string().nullable() })),
    /** By position. */
    shots: z.array(shotSchema),
    task: shootTaskSummarySchema.extend({
      /** Non-cancelled tasks that depend on it: the close dialog's default (rule 12). */
      dependentCount: z.number().int().min(0),
    }),
    editingTask: shootTaskSummarySchema.nullable(),
    /** Of the team crew, while scheduled (rule 5). */
    conflicts: z.array(scheduleConflictSchema),
    closeNote: z.string().nullable(),
    rawFilesUrl: z.string().nullable(),
    completedAt: z.iso.datetime().nullable(),
    completedBy: personSchema.nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    permissions: shootPermissionsSchema,
  })
  .meta({ id: 'ShootDetail' });

export type ShootDetail = z.infer<typeof shootDetailSchema>;

export const shootListQuerySchema = pageQuerySchema.extend({
  status: queryListSchema(shootStatusSchema).optional(),
  /** Shoots starting on or after `from` and on or before `to` (Damascus days). */
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  clientId: z.uuid().optional(),
  /** Shoots where the user is team crew. */
  userId: z.union([z.uuid(), z.literal('me')]).optional(),
  taskId: z.uuid().optional(),
  /** Matches the title and the location. */
  q: z.string().trim().min(1).max(100).optional(),
  /** `true` lists archived shoots only; needs `shoots.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
});

export type ShootListQuery = z.infer<typeof shootListQuerySchema>;

export type ShootListQueryInput = z.input<typeof shootListQuerySchema>;

export const shootPageSchema = pageSchema(shootSchema).meta({
  id: 'ShootPage',
  description: 'Shoots by start time, latest first',
});

export type ShootPage = z.infer<typeof shootPageSchema>;

/** A meeting as the calendar shows it. */
export const meetingSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    status: meetingStatusSchema,
    client: archivablePersonSchema.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    location: z.string().nullable(),
    onlineUrl: z.string().nullable(),
    organizer: archivablePersonSchema,
    attendeeCount: z.number().int().min(0),
    /** The organizer or an attendee is booked elsewhere at an overlapping time (rule 5). */
    conflict: z.boolean(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Meeting' });

export type Meeting = z.infer<typeof meetingSchema>;

export const meetingPermissionsSchema = z
  .object({
    /** Meeting scope on a scheduled, non-archived meeting (rule 14). */
    canEdit: z.boolean(),
    canCancel: z.boolean(),
    /** Meeting scope `all`. */
    canArchive: z.boolean(),
  })
  .meta({ id: 'MeetingPermissions', description: 'What the caller may do, for the UI' });

export type MeetingPermissions = z.infer<typeof meetingPermissionsSchema>;

export const meetingDetailSchema = meetingSchema
  .extend({
    agenda: z.string().nullable(),
    attendees: z.array(archivablePersonSchema),
    contacts: z.array(
      contactSchema.pick({ id: true, name: true, phone: true }).extend({
        archived: z.boolean(),
      }),
    ),
    /** Of the organizer and the attendees, while scheduled (rule 5). */
    conflicts: z.array(scheduleConflictSchema),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    permissions: meetingPermissionsSchema,
  })
  .meta({ id: 'MeetingDetail' });

export type MeetingDetail = z.infer<typeof meetingDetailSchema>;

// Company calendar

/** `invoice_due` (F13) reaches invoice readers only, for the invoices they may read. */
export const KEY_DATE_KINDS = ['project_due', 'milestone_due', 'renewal', 'invoice_due'] as const;

export const keyDateKindSchema = z.enum(KEY_DATE_KINDS).meta({ id: 'KeyDateKind' });

export type KeyDateKind = z.infer<typeof keyDateKindSchema>;

/** What the calendar shows: shoots, meetings and the key date kinds (rule 15). */
export const CALENDAR_KINDS = [...CALENDAR_ITEM_KINDS, ...KEY_DATE_KINDS] as const;

export const calendarKindSchema = z.enum(CALENDAR_KINDS).meta({ id: 'CalendarKind' });

export type CalendarKind = z.infer<typeof calendarKindSchema>;

/** A due date or renewal date read from `projects` or `invoices`, never stored (ADR 0022). */
export const keyDateSchema = z
  .object({
    kind: keyDateKindSchema,
    date: calendarDateSchema,
    /** The project, milestone or retainer name; the invoice number (`INV-2026-0012`). */
    title: z.string(),
    /** What the chip opens: the project (also for a milestone), the retainer or the invoice. */
    targetId: z.uuid(),
    client: archivablePersonSchema,
    /** The invoice's status for `invoice_due` (never an amount); null for the other kinds. */
    invoiceStatus: invoiceStatusSchema.nullable(),
  })
  .meta({ id: 'KeyDate' });

export type KeyDate = z.infer<typeof keyDateSchema>;

/** Rule 15: a range of at most `CALENDAR_LIMITS.calendarDays` days. */
export const calendarQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    kinds: queryListSchema(calendarKindSchema).optional(),
    clientId: z.uuid().optional(),
    userId: z.union([z.uuid(), z.literal('me')]).optional(),
    shootType: shootTypeSchema.optional(),
  })
  .refine(
    (query) =>
      query.from <= query.to && daysInclusive(query.from, query.to) <= CALENDAR_LIMITS.calendarDays,
    { message: `A range of 1 to ${CALENDAR_LIMITS.calendarDays} days`, path: ['to'] },
  );

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export type CalendarQueryInput = z.input<typeof calendarQuerySchema>;

export const calendarSchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    /** Overlapping the range, by start; cancelled ones included, archived ones never. */
    shoots: z.array(shootSchema),
    meetings: z.array(meetingSchema),
    /** By date. */
    keyDates: z.array(keyDateSchema),
  })
  .meta({ id: 'Calendar' });

export type Calendar = z.infer<typeof calendarSchema>;
