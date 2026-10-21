import { z } from 'zod';
import {
  addDays,
  businessDate,
  businessTimeOfDay,
  type CalendarDate,
  calendarDateSchema,
  calendarMonthSchema,
  instantSchema,
} from './dates.js';

/*
 * HR attendance (spec F17 part C, ADR 0039): attendance passkeys, entrance screens (kiosks) and
 * their rotating code, punches, and the day computed from them. Items, corrections and remote-day
 * requests follow in the next part.
 */

export const ATTENDANCE_PUNCH_DIRECTIONS = ['in', 'out'] as const;

export const punchDirectionSchema = z
  .enum(ATTENDANCE_PUNCH_DIRECTIONS)
  .meta({ id: 'PunchDirection' });

export type PunchDirection = z.infer<typeof punchDirectionSchema>;

export const PUNCH_METHODS = ['office', 'remote', 'field', 'shoot', 'correction'] as const;

export const punchMethodSchema = z.enum(PUNCH_METHODS).meta({ id: 'PunchMethod' });

export type PunchMethod = z.infer<typeof punchMethodSchema>;

/** The methods a person punches with themselves; `correction` comes from a request. */
export const SELF_PUNCH_METHODS = ['office', 'remote', 'field', 'shoot'] as const;

export const selfPunchMethodSchema = z.enum(SELF_PUNCH_METHODS).meta({ id: 'SelfPunchMethod' });

export type SelfPunchMethod = z.infer<typeof selfPunchMethodSchema>;

/** Rule C12: field and shoot punches start accepted; the General Manager may reject them. */
export const FIELD_REVIEWS = ['accepted', 'rejected'] as const;

export const fieldReviewSchema = z.enum(FIELD_REVIEWS).meta({ id: 'FieldReview' });

export type FieldReview = z.infer<typeof fieldReviewSchema>;

export const PASSKEY_STATUSES = ['pending', 'active', 'revoked'] as const;

export const passkeyStatusSchema = z.enum(PASSKEY_STATUSES).meta({ id: 'PasskeyStatus' });

export type PasskeyStatus = z.infer<typeof passkeyStatusSchema>;

export const ATTENDANCE_DAY_KINDS = ['work', 'off', 'holiday'] as const;

export const attendanceDayKindSchema = z
  .enum(ATTENDANCE_DAY_KINDS)
  .meta({ id: 'AttendanceDayKind' });

export type AttendanceDayKind = z.infer<typeof attendanceDayKindSchema>;

export const ATTENDANCE_PLACES = ['office', 'remote'] as const;

export const attendancePlaceSchema = z.enum(ATTENDANCE_PLACES).meta({ id: 'AttendancePlace' });

export type AttendancePlace = z.infer<typeof attendancePlaceSchema>;

export const DAY_LEAVES = ['none', 'full', 'first_half', 'second_half'] as const;

export const dayLeaveSchema = z.enum(DAY_LEAVES).meta({ id: 'DayLeave' });

export type DayLeave = z.infer<typeof dayLeaveSchema>;

export const ATTENDANCE_DAY_STATUSES = [
  'upcoming',
  'in_progress',
  'present',
  'partial',
  'absent',
  'leave',
  'holiday',
  'off',
  'trial',
] as const;

export const attendanceDayStatusSchema = z
  .enum(ATTENDANCE_DAY_STATUSES)
  .meta({ id: 'AttendanceDayStatus' });

export type AttendanceDayStatus = z.infer<typeof attendanceDayStatusSchema>;

/*
 * Rule C5: the entrance screen's code, `kioskId.window.mac`, changes every 20 seconds and is
 * accepted for its window and the previous one. The API computes the MAC; this checks the shape
 * and the window.
 */

export const ATTENDANCE_CODE_WINDOW_SECONDS = 20;

/** The code's 20-second window at `at`. */
export function attendanceCodeWindow(at: Date): number {
  return Math.floor(at.getTime() / 1000 / ATTENDANCE_CODE_WINDOW_SECONDS);
}

/** When a window's code stops being shown (it stays accepted one window longer). */
export function attendanceCodeWindowEnd(window: number): Date {
  return new Date((window + 1) * ATTENDANCE_CODE_WINDOW_SECONDS * 1000);
}

export interface AttendanceCode {
  kioskId: string;
  window: number;
  /** HMAC-SHA-256 of `attendanceCodeMessage`, truncated to 16 bytes, base64url. */
  mac: string;
}

const ATTENDANCE_CODE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/;

/** What the MAC signs. */
export function attendanceCodeMessage(kioskId: string, window: number): string {
  return `${kioskId}.${window}`;
}

/** The parts of a scanned code (with or without the `/attend#` link around it), or null. */
export function parseAttendanceCode(scanned: string): AttendanceCode | null {
  const code = scanned.trim().split('#').pop() ?? '';
  const match = ATTENDANCE_CODE.exec(code);
  if (!match) return null;
  const [, kioskId = '', window = '', mac = ''] = match;
  return { kioskId, window: Number(window), mac };
}

/** Rule C5: a code is accepted for its window and the previous one (up to 40 seconds). */
export function attendanceCodeWindowAccepted(codeWindow: number, currentWindow: number): boolean {
  return codeWindow === currentWindow || codeWindow === currentWindow - 1;
}

/*
 * Rule C6: an office punch comes from an address the paired screen used in the last 10 minutes,
 * IPv4 equal or IPv6 in the same /64, while the screen was seen in the last 2 minutes.
 */

export const OFFICE_NETWORK = { addressMinutes: 10, screenSeenMinutes: 2 } as const;

/** The 8 groups of an IPv6 address, or null. */
function ipv6Groups(address: string): number[] | null {
  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const part = (text: string): number[] | null => {
    if (text === '') return [];
    const groups: number[] = [];
    const pieces = text.split(':');
    for (const [i, piece] of pieces.entries()) {
      if (i === pieces.length - 1 && piece.includes('.')) {
        const v4 = ipv4Octets(piece);
        if (!v4) return null;
        groups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) {
        groups.push(Number.parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };
  const start = part(head);
  const end = tail === undefined ? [] : part(tail);
  if (!start || !end) return null;
  if (tail === undefined) return start.length === 8 ? start : null;
  const missing = 8 - start.length - end.length;
  return missing >= 1 ? [...start, ...Array<number>(missing).fill(0), ...end] : null;
}

function ipv4Octets(address: string): number[] | null {
  const octets = address.split('.');
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet))) return null;
  const values = octets.map(Number);
  return values.every((value) => value <= 255) ? values : null;
}

/** An address as IPv4 octets or IPv6 groups; an IPv4-mapped IPv6 address is IPv4. */
function parseAddress(address: string): { v4: number[] } | { v6: number[] } | null {
  const bare = address.trim().split('%')[0] ?? '';
  const v4 = ipv4Octets(bare);
  if (v4) return { v4 };
  const v6 = ipv6Groups(bare.toLowerCase());
  if (!v6) return null;
  const mapped = v6.slice(0, 6).join(',') === '0,0,0,0,0,65535';
  if (mapped) {
    const [high = 0, low = 0] = v6.slice(6);
    return { v4: [high >> 8, high & 255, low >> 8, low & 255] };
  }
  return { v6 };
}

/** Rule C6: the same IPv4 address, or IPv6 addresses in the same /64. */
export function sameOfficeNetwork(a: string, b: string): boolean {
  const left = parseAddress(a);
  const right = parseAddress(b);
  if (!left || !right) return false;
  if ('v4' in left && 'v4' in right) return left.v4.join('.') === right.v4.join('.');
  if ('v6' in left && 'v6' in right) {
    return left.v6.slice(0, 4).join(':') === right.v6.slice(0, 4).join(':');
  }
  return false;
}

/*
 * Rules C14–C16: the day computation. Presence is the union of `[in, out)` intervals whatever
 * their method; lateness, early leave and overtime come from the day's frozen expectations.
 */

/** Rule C15 (owner, 2026-10-22): a punch before 06:00 closes the previous day's open `in`. */
export const MIDNIGHT_OUT_UNTIL = '06:00';

const MINUTE = 60_000;

/** Whether an `in` of `inDate` is still open at `at`: that date, or the next one before 06:00. */
function stillOpen(inDate: CalendarDate, at: Date): boolean {
  const date = businessDate(at);
  return (
    date === inDate || (date === addDays(inDate, 1) && businessTimeOfDay(at) < MIDNIGHT_OUT_UNTIL)
  );
}

export interface PunchMoment {
  direction: PunchDirection;
  at: Date;
}

/**
 * The day each punch belongs to: its own business date, except an `out` before 06:00 that closes
 * the previous day's open `in` (rule C15). `punches` in time order.
 */
export function punchDates<T extends PunchMoment>(punches: readonly T[]): Map<T, CalendarDate> {
  const result = new Map<T, CalendarDate>();
  let open: CalendarDate | null = null;
  for (const punch of punches) {
    const own = businessDate(punch.at);
    const date: CalendarDate =
      punch.direction === 'out' && open && open !== own && stillOpen(open, punch.at) ? open : own;
    result.set(punch, date);
    if (punch.direction === 'in') {
      if (open !== date) open = date;
    } else {
      open = null;
    }
  }
  return result;
}

/**
 * Rule C7: the next punch is an `out` while the last one is an `in` still open (rule C15: its
 * date, or the next one before 06:00), else an `in`.
 */
export function nextPunchDirection(last: PunchMoment | null, now: Date): PunchDirection {
  if (!last || last.direction === 'out') return 'in';
  return stillOpen(businessDate(last.at), now) ? 'out' : 'in';
}

/** Where the day is relative to now: the job finalizes it once it has passed. */
export type DayPhase = 'before' | 'during' | 'after';

export interface DayInput {
  kind: AttendanceDayKind;
  /** Fixed: the start; flexible: the start window's opening. */
  expectedStart: Date | null;
  /** Flexible only: the start window's close. */
  latestStart: Date | null;
  /** Fixed: the end; flexible: the latest end. */
  expectedEnd: Date | null;
  requiredMinutes: number | null;
  leave: DayLeave;
  /** Approved permissions of the day. */
  permissions: readonly { from: Date; to: Date }[];
  /** The punches of the day (`punchDates`), in time order. */
  punches: readonly PunchMoment[];
  graceMinutes: number;
  overtimeMinMinutes: number;
  phase: DayPhase;
  /** Rule C1: before the start date. */
  trial: boolean;
}

export interface DayResult {
  firstInAt: Date | null;
  lastOutAt: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  /** An `in` without its `out`. */
  missingOut: boolean;
  status: AttendanceDayStatus;
}

const minutesBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE));

const addMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE);

/** Rules C15 and C16, for one user and date. */
export function computeDay(input: DayInput): DayResult {
  const intervals: { from: Date; to: Date }[] = [];
  let open: Date | null = null;
  for (const punch of input.punches) {
    if (punch.direction === 'in') {
      open ??= punch.at;
    } else if (open) {
      intervals.push({ from: open, to: punch.at });
      open = null;
    }
  }
  const firstInAt = intervals[0]?.from ?? open;
  const lastOutAt = open ? null : (intervals.at(-1)?.to ?? null);
  const workedMinutes = intervals.reduce((sum, i) => sum + minutesBetween(i.from, i.to), 0);
  const missingOut = open !== null;
  const counted = (minutes: number) => (minutes > input.graceMinutes ? minutes : 0);
  const overtime = (minutes: number) => (minutes >= input.overtimeMinMinutes ? minutes : 0);

  const working =
    input.kind === 'work' &&
    input.leave !== 'full' &&
    input.expectedStart !== null &&
    input.expectedEnd !== null &&
    input.requiredMinutes !== null;
  let lateMinutes = 0;
  let earlyMinutes = 0;
  let overtimeMinutes = 0;
  if (!working) {
    overtimeMinutes = overtime(workedMinutes);
  } else {
    const required = input.requiredMinutes ?? 0;
    const half = Math.floor(required / 2);
    const firstHalfOff = input.leave === 'first_half';
    const secondHalfOff = input.leave === 'second_half';
    const flexible = input.latestStart !== null;
    const windowOpen = addMinutes(input.expectedStart as Date, firstHalfOff ? half : 0);
    let allowedStart = addMinutes(
      input.latestStart ?? (input.expectedStart as Date),
      firstHalfOff ? half : 0,
    );
    for (const permission of input.permissions) {
      if (permission.from <= allowedStart && allowedStart < permission.to) {
        allowedStart = permission.to;
      }
    }
    if (firstInAt) lateMinutes = counted(minutesBetween(allowedStart, firstInAt));

    const dayMinutes = firstHalfOff || secondHalfOff ? required - half : required;
    let expectedEnd: Date | null;
    if (flexible) {
      expectedEnd = firstInAt
        ? addMinutes(firstInAt > windowOpen ? firstInAt : windowOpen, dayMinutes)
        : null;
    } else {
      expectedEnd = addMinutes(input.expectedEnd as Date, secondHalfOff ? -half : 0);
    }
    if (expectedEnd) {
      for (const permission of input.permissions) {
        if (permission.from < expectedEnd && expectedEnd <= permission.to) {
          expectedEnd = permission.from;
        }
      }
      if (lastOutAt) earlyMinutes = counted(minutesBetween(lastOutAt, expectedEnd));
      const end = expectedEnd;
      overtimeMinutes = overtime(
        intervals.reduce((sum, i) => sum + minutesBetween(i.from > end ? i.from : end, i.to), 0),
      );
    }
  }

  const status = dayStatus(input, {
    present: firstInAt !== null,
    short: lateMinutes > 0 || earlyMinutes > 0 || missingOut,
  });
  return {
    firstInAt,
    lastOutAt,
    workedMinutes,
    lateMinutes,
    earlyMinutes,
    overtimeMinutes,
    missingOut,
    status,
  };
}

/** Rule C16, with rule C1's `trial` in place of the work-day statuses. */
function dayStatus(
  input: Pick<DayInput, 'kind' | 'leave' | 'phase' | 'trial'>,
  presence: { present: boolean; short: boolean },
): AttendanceDayStatus {
  if (input.kind === 'holiday') return 'holiday';
  if (input.kind === 'off') return 'off';
  if (input.leave === 'full') return 'leave';
  if (input.trial) return 'trial';
  if (input.phase === 'before') return 'upcoming';
  if (input.phase === 'during') return 'in_progress';
  if (!presence.present) return 'absent';
  return presence.short ? 'partial' : 'present';
}

/*
 * Rule C20: the greeting the phone and the screen show after a punch, without client names.
 */

export const PARTS_OF_DAY = ['morning', 'afternoon', 'evening'] as const;

export const partOfDaySchema = z.enum(PARTS_OF_DAY).meta({ id: 'PartOfDay' });

export type PartOfDay = z.infer<typeof partOfDaySchema>;

/** Morning until noon, afternoon until 17:00, then evening; `time` is `HH:MM`. */
export function partOfDay(time: string): PartOfDay {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return 'morning';
  return hour < 17 ? 'afternoon' : 'evening';
}

/** How long the greeting stays on the screen and the phone. */
export const GREETING_SECONDS = 8;

export const attendanceGreetingSchema = z
  .object({
    direction: punchDirectionSchema,
    firstName: z.string(),
    /** `in` only. */
    partOfDay: partOfDaySchema.nullable(),
    /** `in` only: open tasks assigned to the user and due today. */
    tasksDueToday: z.number().int().min(0).nullable(),
    /** `in` only: when the user's first shoot or meeting today starts. */
    firstEventAt: instantSchema.nullable(),
    /** `out` only: the time worked today. */
    workedMinutes: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'AttendanceGreeting' });

export type AttendanceGreeting = z.infer<typeof attendanceGreetingSchema>;

/*
 * Rules C3 and C9: the attendance passkey, a WebAuthn credential that never signs anyone in.
 */

const personRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const attendancePasskeySchema = z
  .object({
    id: z.uuid(),
    user: personRefSchema,
    /** The registering browser, e.g. "Safari · iPhone". */
    deviceLabel: z.string(),
    status: passkeyStatusSchema,
    /** Who approved the replacement, or revoked it. */
    decidedBy: personRefSchema.nullable(),
    decidedAt: instantSchema.nullable(),
    createdAt: instantSchema,
  })
  .meta({ id: 'AttendancePasskey' });

export type AttendancePasskey = z.infer<typeof attendancePasskeySchema>;

export const attendancePasskeyListSchema = z
  .object({ items: z.array(attendancePasskeySchema) })
  .meta({ id: 'AttendancePasskeyList' });

export type AttendancePasskeyList = z.infer<typeof attendancePasskeyListSchema>;

export const attendancePasskeyListQuerySchema = z.object({ userId: z.uuid() });

export type AttendancePasskeyListQuery = z.infer<typeof attendancePasskeyListQuerySchema>;

/** WebAuthn options in their JSON form, for the browser's `navigator.credentials` call. */
const webAuthnJsonSchema = z.record(z.string(), z.unknown());

/**
 * The browser's WebAuthn options and a signed ticket that carries the challenge to the next
 * request (60 seconds). Used to register a passkey and to punch.
 */
export const webAuthnChallengeSchema = z
  .object({ ticket: z.string(), options: webAuthnJsonSchema })
  .meta({ id: 'WebAuthnChallenge' });

export type WebAuthnChallenge = z.infer<typeof webAuthnChallengeSchema>;

export const WEBAUTHN_TICKET_SECONDS = 60;

export const registerPasskeySchema = z
  .object({ ticket: z.string().min(1).max(2000), response: webAuthnJsonSchema })
  .meta({ id: 'RegisterPasskey' });

export type RegisterPasskey = z.infer<typeof registerPasskeySchema>;

export const revokePasskeySchema = z
  .object({ note: z.string().trim().min(1).max(500) })
  .meta({ id: 'RevokePasskey' });

export type RevokePasskey = z.infer<typeof revokePasskeySchema>;

/*
 * Rule C4: entrance screens, paired with a code and then known by their cookie.
 */

export const KIOSK_LIMITS = { name: 100, pairingMinutes: 15 } as const;

/** Pairing codes avoid the letters and digits that read alike (0/O, 1/I/L). */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const PAIRING_CODE_LENGTH = 8;

export const attendanceKioskSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    paired: z.boolean(),
    /** While a pairing code is waiting to be used. */
    pairingExpiresAt: instantSchema.nullable(),
    lastSeenAt: instantSchema.nullable(),
    lastIpAddress: z.string().nullable(),
    createdAt: instantSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'AttendanceKiosk' });

export type AttendanceKiosk = z.infer<typeof attendanceKioskSchema>;

export const attendanceKioskListSchema = z
  .object({ items: z.array(attendanceKioskSchema) })
  .meta({ id: 'AttendanceKioskList' });

export type AttendanceKioskList = z.infer<typeof attendanceKioskListSchema>;

/** A screen with its pairing code, shown once. */
export const attendanceKioskPairingSchema = attendanceKioskSchema
  .extend({ pairingCode: z.string() })
  .meta({ id: 'AttendanceKioskPairing' });

export type AttendanceKioskPairing = z.infer<typeof attendanceKioskPairingSchema>;

export const createAttendanceKioskSchema = z
  .object({ name: z.string().trim().min(1).max(KIOSK_LIMITS.name) })
  .meta({ id: 'CreateAttendanceKiosk' });

export type CreateAttendanceKiosk = z.infer<typeof createAttendanceKioskSchema>;

export const pairKioskSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`)),
  })
  .meta({ id: 'PairKiosk' });

export type PairKiosk = z.infer<typeof pairKioskSchema>;

export const pairedKioskSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .meta({ id: 'PairedKiosk' });

export type PairedKiosk = z.infer<typeof pairedKioskSchema>;

/** The `code` event of the screen's stream: the code to show until `expiresAt`. */
export const kioskCodeEventSchema = z
  .object({ code: z.string(), window: z.number().int(), expiresAt: instantSchema })
  .meta({ id: 'KioskCodeEvent' });

export type KioskCodeEvent = z.infer<typeof kioskCodeEventSchema>;

/** How often the screen's stream pings; each ping marks the screen as seen (rule C6). */
export const KIOSK_STREAM_PING_MS = 30_000;

/** The stream closes after this long, so the screen reconnects. */
export const KIOSK_STREAM_LIFETIME_MS = 15 * 60_000;

/*
 * Rules C7–C13: punches. A punch costs two requests: the options (with the code, the shoot and
 * the location) return a WebAuthn challenge in a ticket; the punch sends the signed assertion.
 */

export const ATTENDANCE_LIMITS = { fieldNote: 500, code: 200 } as const;

/** Rule C13: a shoot check-in opens 30 minutes before the start. */
export const SHOOT_CHECK_IN_MINUTES_BEFORE = 30;

/** Edge case 8: a second punch within a minute is refused. */
export const DUPLICATE_PUNCH_SECONDS = 60;

const latitudeSchema = z.number().min(-90).max(90);

const longitudeSchema = z.number().min(-180).max(180);

export const punchOptionsInputSchema = z
  .object({
    method: selfPunchMethodSchema,
    /** Office only: the scanned code. */
    code: z.string().trim().max(ATTENDANCE_LIMITS.code).optional(),
    /** Shoot only. */
    shootId: z.uuid().optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    accuracyM: z.number().int().min(0).max(1_000_000).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.method === 'office' && !input.code) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'Required' });
    }
    if (input.method === 'shoot' && !input.shootId) {
      ctx.addIssue({ code: 'custom', path: ['shootId'], message: 'Required' });
    }
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['longitude'], message: 'Both or neither' });
    }
  })
  .meta({ id: 'PunchOptionsInput' });

export type PunchOptionsInput = z.infer<typeof punchOptionsInputSchema>;

export const punchInputSchema = z
  .object({
    ticket: z.string().min(1).max(4000),
    assertion: webAuthnJsonSchema,
    /** Field only: where and why (rule C11). */
    fieldNote: z.string().trim().min(1).max(ATTENDANCE_LIMITS.fieldNote).optional(),
  })
  .meta({ id: 'PunchInput' });

export type PunchInput = z.infer<typeof punchInputSchema>;

export const attendancePunchSchema = z
  .object({
    id: z.uuid(),
    direction: punchDirectionSchema,
    at: instantSchema,
    method: punchMethodSchema,
    /** Office only: the screen's name. */
    kioskName: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    accuracyM: z.number().int().nullable(),
    fieldNote: z.string().nullable(),
    shoot: z
      .object({
        id: z.uuid(),
        title: z.string(),
        location: z.string(),
        mapUrl: z.string().nullable(),
      })
      .nullable(),
    fieldReview: fieldReviewSchema.nullable(),
    /** A rejected field punch is archived and no longer counts (rule C12). */
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'AttendancePunch' });

export type AttendancePunch = z.infer<typeof attendancePunchSchema>;

export const attendanceDaySchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    date: calendarDateSchema,
    kind: attendanceDayKindSchema,
    expectedStart: instantSchema.nullable(),
    latestStart: instantSchema.nullable(),
    expectedEnd: instantSchema.nullable(),
    requiredMinutes: z.number().int().nullable(),
    place: attendancePlaceSchema.nullable(),
    leave: dayLeaveSchema,
    firstInAt: instantSchema.nullable(),
    lastOutAt: instantSchema.nullable(),
    workedMinutes: z.number().int(),
    lateMinutes: z.number().int(),
    earlyMinutes: z.number().int(),
    overtimeMinutes: z.number().int(),
    status: attendanceDayStatusSchema,
    /** The day's punches in time order, rejected ones included. */
    punches: z.array(attendancePunchSchema),
  })
  .meta({ id: 'AttendanceDay' });

export type AttendanceDay = z.infer<typeof attendanceDaySchema>;

export const attendanceDayListSchema = z
  .object({ items: z.array(attendanceDaySchema) })
  .meta({ id: 'AttendanceDayList' });

export type AttendanceDayList = z.infer<typeof attendanceDayListSchema>;

export const attendanceDayListQuerySchema = z.object({
  /** `me` for one's own; others' days need `hr.read` covering them. */
  userId: z.union([z.uuid(), z.literal('me')]).default('me'),
  month: calendarMonthSchema,
});

export type AttendanceDayListQuery = z.infer<typeof attendanceDayListQuerySchema>;

export type AttendanceDayListQueryInput = z.input<typeof attendanceDayListQuerySchema>;

export const punchResultSchema = z
  .object({
    punch: attendancePunchSchema,
    day: attendanceDaySchema,
    greeting: attendanceGreetingSchema,
  })
  .meta({ id: 'PunchResult' });

export type PunchResult = z.infer<typeof punchResultSchema>;

/** Rule C13: a shoot the user may check in or out of now. */
export const punchableShootSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    startsAt: instantSchema,
    endsAt: instantSchema,
    location: z.string(),
  })
  .meta({ id: 'PunchableShoot' });

export type PunchableShoot = z.infer<typeof punchableShootSchema>;

/** Why attendance does not apply to the user today (rule C2), or null when it does. */
export const ATTENDANCE_EXEMPTIONS = ['exempt', 'not_started', 'ended'] as const;

export const attendanceExemptionSchema = z
  .enum(ATTENDANCE_EXEMPTIONS)
  .meta({ id: 'AttendanceExemption' });

export type AttendanceExemption = z.infer<typeof attendanceExemptionSchema>;

/** My attendance today: the day, the next direction and the methods offered now. */
export const myAttendanceTodaySchema = z
  .object({
    date: calendarDateSchema,
    exemption: attendanceExemptionSchema.nullable(),
    /** Rule C1: before the start date. */
    trial: z.boolean(),
    passkey: z.object({ active: z.boolean(), pending: z.boolean() }),
    /** Null when attendance does not apply today. */
    day: attendanceDaySchema.nullable(),
    nextDirection: punchDirectionSchema,
    methods: z.array(selfPunchMethodSchema),
    shoots: z.array(punchableShootSchema),
  })
  .meta({ id: 'MyAttendanceToday' });

export type MyAttendanceToday = z.infer<typeof myAttendanceTodaySchema>;
