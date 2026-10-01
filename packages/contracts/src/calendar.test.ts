import { describe, expect, it } from 'vitest';
import {
  CALENDAR_LIMITS,
  type CreateShootInput,
  calendarDay,
  calendarQuerySchema,
  closeShootSchema,
  conflictQuerySchema,
  createMeetingSchema,
  createShootSchema,
  editingTaskDefaults,
  editingTaskDueDate,
  editingTaskTitle,
  intervalsOverlap,
  notClosedReminderDay,
  shootTaskTitle,
  timeRangeProblem,
  upcomingReminderDay,
  updateMeetingSchema,
  updateShootSchema,
} from './calendar.js';

const USER = '0198f0c2-0000-7000-8000-000000000001';
const OTHER = '0198f0c2-0000-7000-8000-000000000002';
const TASK = '0198f0c2-0000-7000-8000-000000000003';
const CLIENT = '0198f0c2-0000-7000-8000-000000000004';
const PROJECT = '0198f0c2-0000-7000-8000-000000000005';

const at = (time: string) => `2026-10-10T${time}:00+03:00`;

function shoot(input: Partial<CreateShootInput> = {}): CreateShootInput {
  return {
    title: 'Autumn products',
    type: 'product',
    startsAt: at('10:00'),
    endsAt: at('13:00'),
    location: 'Studio',
    crew: [{ userId: USER, role: 'photographer', isLead: true }],
    taskId: TASK,
    ...input,
  };
}

describe('conflict overlap (rule 5)', () => {
  const booking = { startsAt: at('10:00'), endsAt: at('12:00') };

  it('finds overlapping intervals', () => {
    expect(intervalsOverlap(booking, { startsAt: at('11:00'), endsAt: at('13:00') })).toBe(true);
    expect(intervalsOverlap(booking, { startsAt: at('09:00'), endsAt: at('10:01') })).toBe(true);
    expect(intervalsOverlap(booking, { startsAt: at('10:30'), endsAt: at('11:00') })).toBe(true);
  });

  it('treats touching ends as free: [start, end)', () => {
    expect(intervalsOverlap(booking, { startsAt: at('12:00'), endsAt: at('13:00') })).toBe(false);
    expect(intervalsOverlap(booking, { startsAt: at('08:00'), endsAt: at('10:00') })).toBe(false);
  });

  it('accepts dates as well as strings', () => {
    expect(
      intervalsOverlap(booking, {
        startsAt: new Date(at('11:00')),
        endsAt: new Date(at('11:30')),
      }),
    ).toBe(true);
  });
});

describe('calendar days and reminders', () => {
  it('puts a shoot on the Damascus day it starts, also across midnight (edge case 3)', () => {
    expect(calendarDay('2026-10-10T22:30:00Z')).toBe('2026-10-11');
    expect(calendarDay('2026-10-10T20:59:00Z')).toBe('2026-10-10');
  });

  it('reminds on the last work day before the day, skipping Friday (edge case 4)', () => {
    // 2026-10-10 is a Saturday: the reminder goes on Thursday.
    expect(upcomingReminderDay('2026-10-10')).toBe('2026-10-08');
    // A Friday shoot is reminded on Thursday.
    expect(upcomingReminderDay('2026-10-09')).toBe('2026-10-08');
    expect(upcomingReminderDay('2026-10-12')).toBe('2026-10-11');
  });

  it('reports a shoot not closed on the first work day after its end day', () => {
    // Ends on Thursday 2026-10-08: reported on Saturday.
    expect(notClosedReminderDay('2026-10-08T12:00:00+03:00')).toBe('2026-10-10');
    expect(notClosedReminderDay('2026-10-10T12:00:00+03:00')).toBe('2026-10-11');
  });
});

describe('editing task defaults (rule 12)', () => {
  const input = {
    shootTitle: 'Autumn products',
    closeDay: '2026-10-07',
    lead: { id: USER, inPhotography: true },
    hasDependents: false,
    hasClient: true,
  };

  it('is due 3 work days after the close day, skipping Friday', () => {
    // Wednesday → Thursday, Saturday, Sunday.
    expect(editingTaskDueDate('2026-10-07')).toBe('2026-10-11');
    expect(editingTaskDueDate('2026-10-10')).toBe('2026-10-13');
  });

  it('proposes the task for the lead in Photography with client approval', () => {
    expect(editingTaskDefaults(input)).toEqual({
      create: true,
      title: editingTaskTitle('Autumn products'),
      department: 'photography',
      assigneeId: USER,
      dueDate: '2026-10-11',
      needsClientApproval: true,
    });
  });

  it('is off when the shoot task already has dependents', () => {
    expect(editingTaskDefaults({ ...input, hasDependents: true }).create).toBe(false);
  });

  it('has no assignee when the lead is not in Photography, and no approval without a client', () => {
    const defaults = editingTaskDefaults({
      ...input,
      lead: { id: USER, inPhotography: false },
      hasClient: false,
    });
    expect(defaults.assigneeId).toBeNull();
    expect(defaults.needsClientApproval).toBe(false);
  });

  it('cuts task titles to the task title length', () => {
    expect(shootTaskTitle('x'.repeat(160))).toHaveLength(160);
    expect(editingTaskTitle('Reel')).toMatch(/Reel$/);
  });
});

describe('time ranges', () => {
  it('needs the end after the start and caps the length', () => {
    expect(timeRangeProblem(at('10:00'), at('10:00'), 12)).toBe('order');
    expect(timeRangeProblem(at('10:00'), '2026-10-13T10:00:01+03:00', 72)).toBe('length');
    expect(timeRangeProblem(at('10:00'), '2026-10-13T10:00:00+03:00', 72)).toBeNull();
  });
});

describe('shoot inputs', () => {
  it('books from a task, or with a new task, never both (rule 1)', () => {
    expect(createShootSchema.safeParse(shoot()).success).toBe(true);
    expect(
      createShootSchema.safeParse(shoot({ taskId: undefined, newTask: {}, clientId: null }))
        .success,
    ).toBe(true);
    expect(createShootSchema.safeParse(shoot({ newTask: {} })).success).toBe(false);
    expect(createShootSchema.safeParse(shoot({ taskId: undefined })).success).toBe(false);
  });

  it('takes the client from the task when booked from one', () => {
    expect(createShootSchema.safeParse(shoot({ clientId: CLIENT })).success).toBe(false);
  });

  it('checks the links of a new shoot task', () => {
    const newTask = { projectId: PROJECT };
    expect(
      createShootSchema.safeParse(shoot({ taskId: undefined, newTask, clientId: CLIENT })).success,
    ).toBe(true);
    expect(
      createShootSchema.safeParse(shoot({ taskId: undefined, newTask, clientId: null })).success,
    ).toBe(false);
  });

  it('caps the crew and keeps each person once', () => {
    const member = { userId: USER, role: 'photographer' as const, isLead: true };
    expect(createShootSchema.safeParse(shoot({ crew: [] })).success).toBe(false);
    expect(createShootSchema.safeParse(shoot({ crew: [member, member] })).success).toBe(false);
    const external = Array.from({ length: CALENDAR_LIMITS.externalCrew + 1 }, () => ({
      name: 'Sami',
      role: 'assistant' as const,
    }));
    expect(createShootSchema.safeParse(shoot({ externalCrew: external })).success).toBe(false);
  });

  it('normalizes freelancer phones and caps the shot list', () => {
    const parsed = createShootSchema.parse(
      shoot({ externalCrew: [{ name: 'Sami', role: 'assistant', phone: '00963 944 123 456' }] }),
    );
    expect(parsed.externalCrew[0]?.phone).toBe('+963944123456');
    const shots = Array.from({ length: CALENDAR_LIMITS.shots + 1 }, () => ({ text: 'Front' }));
    expect(createShootSchema.safeParse(shoot({ shots })).success).toBe(false);
  });

  it('refuses a shoot longer than 72 hours or ending before it starts', () => {
    expect(
      createShootSchema.safeParse(shoot({ endsAt: '2026-10-13T13:00:00+03:00' })).success,
    ).toBe(false);
    expect(createShootSchema.safeParse(shoot({ endsAt: at('09:00') })).success).toBe(false);
  });

  it('moves the start and the end together on update', () => {
    expect(updateShootSchema.safeParse({ startsAt: at('09:00') }).success).toBe(false);
    expect(
      updateShootSchema.safeParse({ startsAt: at('09:00'), endsAt: at('11:00') }).success,
    ).toBe(true);
    expect(updateShootSchema.parse({ title: 'New' }).acceptConflicts).toBe(false);
  });

  it('closes with or without an editing task, never leaving it out', () => {
    expect(closeShootSchema.safeParse({}).success).toBe(false);
    expect(closeShootSchema.parse({ editingTask: null })).toEqual({
      note: null,
      rawFilesUrl: null,
      editingTask: null,
    });
    expect(closeShootSchema.safeParse({ editingTask: null, rawFilesUrl: 'ftp://x' }).success).toBe(
      false,
    );
  });
});

describe('meeting inputs', () => {
  const meeting = { title: 'Kick-off', startsAt: at('10:00'), endsAt: at('11:00') };

  it('defaults to no client, attendees or contacts, and keeps ids once', () => {
    expect(createMeetingSchema.parse(meeting)).toMatchObject({
      clientId: null,
      attendeeIds: [],
      contactIds: [],
    });
    expect(
      createMeetingSchema.parse({ ...meeting, attendeeIds: [USER, USER] }).attendeeIds,
    ).toEqual([USER]);
  });

  it('caps a meeting at 12 hours and 20 attendees', () => {
    expect(
      createMeetingSchema.safeParse({ ...meeting, endsAt: '2026-10-10T22:01:00+03:00' }).success,
    ).toBe(false);
    const attendeeIds = Array.from(
      { length: CALENDAR_LIMITS.attendees + 1 },
      (_, index) => `0198f0c2-0000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(createMeetingSchema.safeParse({ ...meeting, attendeeIds }).success).toBe(false);
  });

  it('lets an update change the organizer', () => {
    expect(updateMeetingSchema.parse({ organizerId: OTHER }).organizerId).toBe(OTHER);
  });
});

describe('calendar queries', () => {
  it('accepts up to 45 days', () => {
    expect(calendarQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-14' }).success).toBe(
      true,
    );
    expect(calendarQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-15' }).success).toBe(
      false,
    );
    expect(calendarQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(
      false,
    );
  });

  it('reads one or several kinds', () => {
    expect(
      calendarQuerySchema.parse({ from: '2026-10-01', to: '2026-10-31', kinds: 'shoot' }).kinds,
    ).toEqual(['shoot']);
  });

  it('checks at most 30 users for conflicts', () => {
    const query = { startsAt: at('10:00'), endsAt: at('11:00') };
    expect(conflictQuerySchema.parse({ ...query, userIds: USER }).userIds).toEqual([USER]);
    const userIds = Array.from(
      { length: CALENDAR_LIMITS.conflictUsers + 1 },
      (_, index) => `0198f0c2-0000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(conflictQuerySchema.safeParse({ ...query, userIds }).success).toBe(false);
  });
});
