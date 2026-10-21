import { describe, expect, it } from 'vitest';
import {
  attendanceCodeMessage,
  attendanceCodeWindow,
  attendanceCodeWindowAccepted,
  attendanceCodeWindowEnd,
  computeDay,
  type DayInput,
  nextPunchDirection,
  pairKioskSchema,
  parseAttendanceCode,
  partOfDay,
  punchDates,
  punchOptionsInputSchema,
  sameOfficeNetwork,
} from './attendance.js';
import { businessInstant } from './dates.js';

const KIOSK = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const MAC = 'AbCdEfGhIjKlMnOpQrStUv';

describe('the entrance code (rule C5)', () => {
  it('changes every 20 seconds', () => {
    expect(attendanceCodeWindow(new Date(0))).toBe(0);
    expect(attendanceCodeWindow(new Date(19_999))).toBe(0);
    expect(attendanceCodeWindow(new Date(20_000))).toBe(1);
    expect(attendanceCodeWindowEnd(1).getTime()).toBe(40_000);
    expect(attendanceCodeMessage(KIOSK, 7)).toBe(`${KIOSK}.7`);
  });

  it('parses the code alone or inside its /attend link', () => {
    const parts = { kioskId: KIOSK, window: 88_000_000, mac: MAC };
    expect(parseAttendanceCode(`${KIOSK}.88000000.${MAC}`)).toEqual(parts);
    expect(parseAttendanceCode(`https://hub.example/attend#${KIOSK}.88000000.${MAC}`)).toEqual(
      parts,
    );
    expect(parseAttendanceCode(`${KIOSK}.88000000.short`)).toBeNull();
    expect(parseAttendanceCode('not a code')).toBeNull();
  });

  it('is accepted for its window and the previous one only', () => {
    expect(attendanceCodeWindowAccepted(10, 10)).toBe(true);
    expect(attendanceCodeWindowAccepted(9, 10)).toBe(true);
    expect(attendanceCodeWindowAccepted(8, 10)).toBe(false);
    expect(attendanceCodeWindowAccepted(11, 10)).toBe(false);
  });
});

describe('the office network (rule C6)', () => {
  it('compares IPv4 addresses exactly, IPv4-mapped IPv6 included', () => {
    expect(sameOfficeNetwork('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(sameOfficeNetwork('203.0.113.7', '203.0.113.8')).toBe(false);
    expect(sameOfficeNetwork('::ffff:203.0.113.7', '203.0.113.7')).toBe(true);
    expect(sameOfficeNetwork('::ffff:cb00:7107', '203.0.113.7')).toBe(true);
  });

  it('compares IPv6 addresses by their /64', () => {
    expect(sameOfficeNetwork('2001:db8:1:2::10', '2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe(
      true,
    );
    expect(sameOfficeNetwork('2001:db8:1:2::10', '2001:db8:1:3::10')).toBe(false);
    expect(sameOfficeNetwork('fe80::1%eth0', 'fe80::2')).toBe(true);
  });

  it('never matches across families or with a malformed address', () => {
    expect(sameOfficeNetwork('2001:db8::1', '203.0.113.7')).toBe(false);
    expect(sameOfficeNetwork('', '')).toBe(false);
    expect(sameOfficeNetwork('1:2:3', '1:2:3')).toBe(false);
    expect(sameOfficeNetwork('1::2::3', '1::2::3')).toBe(false);
    expect(sameOfficeNetwork('300.1.1.1', '300.1.1.1')).toBe(false);
  });
});

const at = (date: string, time: string) => businessInstant(date, time);

describe('punch days (rule C15)', () => {
  it("gives an out before 06:00 to the previous day's open in, however long the day", () => {
    const morningIn = { direction: 'in' as const, at: at('2026-11-01', '09:00') };
    const nightOut = { direction: 'out' as const, at: at('2026-11-02', '05:59') };
    const nextIn = { direction: 'in' as const, at: at('2026-11-02', '09:00') };
    const dates = punchDates([morningIn, nightOut, nextIn]);
    expect(dates.get(nightOut)).toBe('2026-11-01');
    expect(dates.get(nextIn)).toBe('2026-11-02');
  });

  it('leaves an out from 06:00 on, or two days later, on its own date', () => {
    const lateIn = { direction: 'in' as const, at: at('2026-11-01', '22:00') };
    const out = { direction: 'out' as const, at: at('2026-11-02', '06:00') };
    expect(punchDates([lateIn, out]).get(out)).toBe('2026-11-02');
    const later = { direction: 'out' as const, at: at('2026-11-03', '01:00') };
    expect(punchDates([lateIn, later]).get(later)).toBe('2026-11-03');
  });

  it('is an out while an in is open, else an in', () => {
    const now = at('2026-11-02', '17:00');
    expect(nextPunchDirection(null, now)).toBe('in');
    const morning = { direction: 'in' as const, at: at('2026-11-02', '09:00') };
    expect(nextPunchDirection(morning, now)).toBe('out');
    expect(nextPunchDirection({ ...morning, direction: 'out' }, now)).toBe('in');
    const yesterday = { direction: 'in' as const, at: at('2026-11-01', '09:00') };
    expect(nextPunchDirection(yesterday, at('2026-11-02', '00:30'))).toBe('out');
    expect(nextPunchDirection(yesterday, at('2026-11-02', '06:00'))).toBe('in');
    expect(nextPunchDirection(yesterday, now)).toBe('in');
  });
});

const DAY = '2026-11-02';

/** A fixed day 09:00–17:00 (480 minutes), grace 10, overtime from 30 minutes, finished. */
const fixed = (overrides: Partial<DayInput> = {}): DayInput => ({
  kind: 'work',
  expectedStart: at(DAY, '09:00'),
  latestStart: null,
  expectedEnd: at(DAY, '17:00'),
  requiredMinutes: 480,
  leave: 'none',
  permissions: [],
  punches: [],
  graceMinutes: 10,
  overtimeMinMinutes: 30,
  phase: 'after',
  trial: false,
  ...overrides,
});

/** A flexible day: start between 08:00 and 10:00, 480 minutes. */
const flexible = (overrides: Partial<DayInput> = {}): DayInput =>
  fixed({
    expectedStart: at(DAY, '08:00'),
    latestStart: at(DAY, '10:00'),
    expectedEnd: at(DAY, '18:00'),
    ...overrides,
  });

const punches = (...times: string[]) =>
  times.map((time, i) => ({
    direction: i % 2 === 0 ? ('in' as const) : ('out' as const),
    at: at(DAY, time),
  }));

describe('the day computation (rules C15, C16)', () => {
  it('is present when the fixed hours are met', () => {
    const day = computeDay(fixed({ punches: punches('08:55', '17:05') }));
    expect(day).toMatchObject({
      workedMinutes: 490,
      lateMinutes: 0,
      earlyMinutes: 0,
      overtimeMinutes: 0,
      missingOut: false,
      status: 'present',
    });
    expect(day.firstInAt).toEqual(at(DAY, '08:55'));
    expect(day.lastOutAt).toEqual(at(DAY, '17:05'));
  });

  it('forgives lateness within the grace period and counts all of it beyond', () => {
    expect(computeDay(fixed({ punches: punches('09:10', '17:00') })).lateMinutes).toBe(0);
    const late = computeDay(fixed({ punches: punches('09:11', '17:00') }));
    expect(late.lateMinutes).toBe(11);
    expect(late.status).toBe('partial');
  });

  it('counts early leave the same way', () => {
    expect(computeDay(fixed({ punches: punches('09:00', '16:50') })).earlyMinutes).toBe(0);
    expect(computeDay(fixed({ punches: punches('09:00', '16:00') })).earlyMinutes).toBe(60);
  });

  it('moves the expected arrival to the end of a permission at the start (edge case 16)', () => {
    const permissions = [{ from: at(DAY, '09:00'), to: at(DAY, '11:00') }];
    expect(computeDay(fixed({ permissions, punches: punches('11:05', '17:00') })).lateMinutes).toBe(
      0,
    );
    expect(computeDay(fixed({ permissions, punches: punches('11:30', '17:00') })).lateMinutes).toBe(
      30,
    );
  });

  it('moves the expected end to the start of a permission at the end', () => {
    const permissions = [{ from: at(DAY, '15:00'), to: at(DAY, '17:00') }];
    const day = computeDay(fixed({ permissions, punches: punches('09:00', '15:00') }));
    expect(day.earlyMinutes).toBe(0);
    expect(day.status).toBe('present');
  });

  it('starts a first-half leave half a day later and ends a second-half leave half a day earlier', () => {
    expect(
      computeDay(fixed({ leave: 'first_half', punches: punches('13:00', '17:00') })),
    ).toMatchObject({ lateMinutes: 0, earlyMinutes: 0, status: 'present' });
    expect(
      computeDay(fixed({ leave: 'second_half', punches: punches('09:00', '13:00') })),
    ).toMatchObject({ lateMinutes: 0, earlyMinutes: 0, status: 'present' });
    expect(
      computeDay(fixed({ leave: 'second_half', punches: punches('09:30', '13:00') })).lateMinutes,
    ).toBe(30);
  });

  it('counts overtime after the expected end from the minimum on', () => {
    expect(computeDay(fixed({ punches: punches('09:00', '17:29') })).overtimeMinutes).toBe(0);
    expect(computeDay(fixed({ punches: punches('09:00', '17:45') })).overtimeMinutes).toBe(45);
  });

  it('ends a flexible day the required minutes after the arrival', () => {
    const day = computeDay(flexible({ punches: punches('09:30', '17:30') }));
    expect(day).toMatchObject({ lateMinutes: 0, earlyMinutes: 0, status: 'present' });
    expect(computeDay(flexible({ punches: punches('09:30', '17:00') })).earlyMinutes).toBe(30);
    expect(computeDay(flexible({ punches: punches('10:30', '18:30') })).lateMinutes).toBe(30);
  });

  it('counts a flexible day from the window opening, not as overtime (edge case 15)', () => {
    const day = computeDay(flexible({ punches: punches('07:00', '16:00') }));
    expect(day).toMatchObject({ earlyMinutes: 0, overtimeMinutes: 0, status: 'present' });
  });

  it('joins intervals of any method and counts only presence as worked', () => {
    const day = computeDay(fixed({ punches: punches('09:00', '12:00', '13:00', '17:00') }));
    expect(day.workedMinutes).toBe(420);
    expect(day.status).toBe('present');
  });

  it('marks a missing out as partial', () => {
    const day = computeDay(fixed({ punches: punches('09:00') }));
    expect(day).toMatchObject({ missingOut: true, lastOutAt: null, workedMinutes: 0 });
    expect(day.status).toBe('partial');
  });

  it('is absent on a finished work day without presence', () => {
    expect(computeDay(fixed()).status).toBe('absent');
  });

  it('counts all presence on an off day, a holiday or a full leave as overtime', () => {
    const off = computeDay(fixed({ kind: 'off', punches: punches('10:00', '12:00') }));
    expect(off).toMatchObject({ overtimeMinutes: 120, lateMinutes: 0, status: 'off' });
    expect(computeDay(fixed({ kind: 'holiday' })).status).toBe('holiday');
    const leave = computeDay(fixed({ leave: 'full', punches: punches('10:00', '11:00') }));
    expect(leave).toMatchObject({ overtimeMinutes: 60, status: 'leave' });
  });

  it('is upcoming before the day and in progress during it', () => {
    expect(computeDay(fixed({ phase: 'before' })).status).toBe('upcoming');
    const running = computeDay(fixed({ phase: 'during', punches: punches('09:20') }));
    expect(running).toMatchObject({ status: 'in_progress', lateMinutes: 20 });
  });

  it('shows trial on work days before the start date (rule C1)', () => {
    expect(computeDay(fixed({ trial: true, punches: punches('09:30', '17:00') }))).toMatchObject({
      status: 'trial',
      lateMinutes: 30,
    });
    expect(computeDay(fixed({ trial: true, kind: 'holiday' })).status).toBe('holiday');
  });
});

describe('the greeting (rule C20)', () => {
  it('says morning until noon, afternoon until 17:00, then evening', () => {
    expect(partOfDay('08:59')).toBe('morning');
    expect(partOfDay('12:00')).toBe('afternoon');
    expect(partOfDay('16:59')).toBe('afternoon');
    expect(partOfDay('17:00')).toBe('evening');
  });
});

describe('punch options', () => {
  it('needs the code at the office and the shoot for a shoot punch', () => {
    expect(punchOptionsInputSchema.safeParse({ method: 'office' }).success).toBe(false);
    expect(punchOptionsInputSchema.safeParse({ method: 'office', code: 'x' }).success).toBe(true);
    expect(punchOptionsInputSchema.safeParse({ method: 'shoot' }).success).toBe(false);
    expect(punchOptionsInputSchema.safeParse({ method: 'field' }).success).toBe(true);
  });

  it('takes a location as both coordinates or neither', () => {
    expect(punchOptionsInputSchema.safeParse({ method: 'remote', latitude: 33.5 }).success).toBe(
      false,
    );
    expect(
      punchOptionsInputSchema.safeParse({ method: 'remote', latitude: 33.5, longitude: 36.3 })
        .success,
    ).toBe(true);
  });
});

describe('pairing codes (rule C4)', () => {
  it('are 8 characters of the unambiguous alphabet, in any case', () => {
    expect(pairKioskSchema.parse({ code: ' abcd2345 ' }).code).toBe('ABCD2345');
    expect(pairKioskSchema.safeParse({ code: 'ABCD1234' }).success).toBe(false);
    expect(pairKioskSchema.safeParse({ code: 'ABCD234' }).success).toBe(false);
  });
});
