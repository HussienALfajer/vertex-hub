import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  OFFICE_NETWORK,
  TIMED_REMINDER_GRACE_MINUTES,
  weekdayOf,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendanceKiosks,
  attendancePunches,
  type Database,
  employeeFiles,
  hrRequests,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { UserDirectory } from '../auth/index.js';
import { DailyReminders, NotificationCenter, TimedNotifications } from '../notifications/index.js';
import { attendanceApplies, type DayRow } from './attendance-days.js';
import { AttendanceShoots } from './attendance-shoots.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { HrSettingsService } from './hr-settings.service.js';

const MINUTE = 60_000;

/** Rule C21: the check-out reminder comes an hour after the expected end. */
const CHECK_OUT_REMINDER_MINUTES = 60;

/** Rule C13: the shoot check-in reminder comes 15 minutes after the start. */
const SHOOT_REMINDER_MINUTES = 15;

/** Rule C22: a paired screen unseen this long is offline. */
const KIOSK_OFFLINE_MINUTES = 10;

const minutesLater = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE);

const toTime = (value: string) => value.slice(0, 5);

/**
 * The attendance sources of the F16 minute job (`notifications.timed`): the check-in and
 * check-out reminders (rule C21, once per day each), the shoot check-in reminder (rule C13) and
 * the offline entrance screen (rule C22), each with what closes it again. Nothing is sent while
 * attendance runs in trial (rule C1).
 */
@Injectable()
export class AttendanceReminders implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly timed: TimedNotifications,
    private readonly daily: DailyReminders,
    private readonly center: NotificationCenter,
    private readonly users: UserDirectory,
    private readonly settings: HrSettingsService,
    private readonly shoots: AttendanceShoots,
    private readonly holidays: HolidayCalendar,
  ) {}

  onModuleInit(): void {
    this.timed.register('attendance', (now) => this.run(now));
  }

  /** One run at `now`; returns how many reminders it sent. */
  async run(now: Date): Promise<number> {
    const settings = await this.settings.row();
    const today = businessDate(now);
    const trial = !settings.attendanceStartsOn || today < settings.attendanceStartsOn;
    let sent = 0;
    if (!trial) {
      sent += await this.checkIns(now, today, settings.checkInReminderMinutes);
      sent += await this.checkOuts(now, today);
      sent += await this.shootCheckIns(now);
    }
    sent += await this.offlineKiosks(now, today);
    return sent;
  }

  /** Rule C21: no presence at the latest allowed start plus the setting, on a work day. */
  private async checkIns(now: Date, today: CalendarDate, afterMinutes: number): Promise<number> {
    const days = await this.db
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.date, today),
          eq(attendanceDays.kind, 'work'),
          isNull(attendanceDays.archivedAt),
          isNull(attendanceDays.firstInAt),
          ne(attendanceDays.leave, 'full'),
        ),
      );
    if (days.length === 0) return 0;
    const permissions = await this.db
      .select({
        userId: hrRequests.userId,
        fromTime: hrRequests.fromTime,
        toTime: hrRequests.toTime,
      })
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.kind, 'permission'),
          eq(hrRequests.status, 'approved'),
          eq(hrRequests.startsOn, today),
          isNull(hrRequests.archivedAt),
          inArray(
            hrRequests.userId,
            days.map((day) => day.userId),
          ),
        ),
      );
    let sent = 0;
    for (const day of days) {
      let start = allowedStart(day);
      if (!start || !day.expectedEnd) continue;
      // Rule C15: a permission at the start of the day moves the arrival to its end.
      for (const permission of permissions.filter((row) => row.userId === day.userId)) {
        if (!permission.fromTime || !permission.toTime) continue;
        const from = businessInstant(today, toTime(permission.fromTime));
        const to = businessInstant(today, toTime(permission.toTime));
        if (from <= start && start < to) start = to;
      }
      if (now < minutesLater(start, afterMinutes) || now >= day.expectedEnd) continue;
      const done = await this.db.transaction((tx) =>
        this.daily.remindOnce(
          tx,
          { kind: 'attendance_check_in', subjectId: day.id, occurrence: today },
          today,
          {
            type: 'attendance_check_in_missing',
            data: { date: today },
            recipients: [day.userId],
            actorId: null,
            subjectId: day.id,
          },
        ),
      );
      if (done) sent += 1;
    }
    return sent;
  }

  /** Rule C21: an `in` still open an hour after the expected end, today or yesterday. */
  private async checkOuts(now: Date, today: CalendarDate): Promise<number> {
    const days = await this.db
      .select()
      .from(attendanceDays)
      .where(
        and(
          gte(attendanceDays.date, addDays(today, -1)),
          lte(attendanceDays.date, today),
          isNull(attendanceDays.archivedAt),
          isNotNull(attendanceDays.firstInAt),
          isNull(attendanceDays.lastOutAt),
        ),
      );
    let sent = 0;
    for (const day of days) {
      const end = expectedEnd(day);
      if (!end || now < minutesLater(end, CHECK_OUT_REMINDER_MINUTES)) continue;
      const done = await this.db.transaction((tx) =>
        this.daily.remindOnce(
          tx,
          { kind: 'attendance_check_out', subjectId: day.id, occurrence: day.date },
          today,
          {
            type: 'attendance_check_out_missing',
            data: { date: day.date },
            recipients: [day.userId],
            actorId: null,
            subjectId: day.id,
          },
        ),
      );
      if (done) sent += 1;
    }
    return sent;
  }

  /**
   * Rule C13: 15 minutes after a shoot's start, each team crew member attendance applies to and
   * without a shoot check-in is reminded; a shoot that ended voids what is left.
   */
  private async shootCheckIns(now: Date): Promise<number> {
    const to = minutesLater(now, -SHOOT_REMINDER_MINUTES);
    const from = minutesLater(to, -TIMED_REMINDER_GRACE_MINUTES);
    const ended = await this.shoots.endingBetween(
      this.db,
      minutesLater(now, -TIMED_REMINDER_GRACE_MINUTES),
      now,
    );
    if (ended.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const id of ended) {
          await this.center.resolve(tx, {
            subject: { type: 'shoot', id },
            types: ['shoot_check_in_missing'],
            outcome: 'void',
            actorId: null,
          });
        }
      });
    }
    const started = await this.shoots.startingBetween(this.db, from, to);
    let sent = 0;
    for (const shoot of started) {
      const today = businessDate(shoot.startsAt);
      const [files, punched] = await Promise.all([
        this.db.select().from(employeeFiles).where(inArray(employeeFiles.userId, shoot.crewIds)),
        this.db
          .selectDistinct({ userId: attendancePunches.userId })
          .from(attendancePunches)
          .where(
            and(eq(attendancePunches.shootId, shoot.id), isNull(attendancePunches.archivedAt)),
          ),
      ]);
      const checkedIn = new Set(punched.map((row) => row.userId));
      for (const userId of shoot.crewIds) {
        const file = files.find((row) => row.userId === userId);
        if (checkedIn.has(userId) || !attendanceApplies(file, today, today)) continue;
        const done = await this.db.transaction((tx) =>
          this.timed.remindOnce(
            tx,
            { kind: 'shoot_check_in', subjectId: userId, occursAt: shoot.startsAt },
            {
              type: 'shoot_check_in_missing',
              data: {
                shoot: {
                  title: shoot.title,
                  client: null,
                  startsAt: shoot.startsAt.toISOString(),
                  endsAt: shoot.endsAt.toISOString(),
                  location: shoot.location,
                },
              },
              recipients: [userId],
              actorId: null,
              subjectId: shoot.id,
            },
          ),
        );
        if (done) sent += 1;
      }
    }
    return sent;
  }

  /**
   * Rule C22: a paired screen unseen for 10 minutes during the default schedule's hours tells
   * Ops and the GMs once per outage; it resolves when the screen is seen again.
   */
  private async offlineKiosks(now: Date, today: CalendarDate): Promise<number> {
    const kiosks = await this.db
      .select()
      .from(attendanceKiosks)
      .where(and(isNull(attendanceKiosks.archivedAt), isNotNull(attendanceKiosks.tokenHash)));
    if (kiosks.length === 0) return 0;
    const seenSince = minutesLater(now, -OFFICE_NETWORK.screenSeenMinutes);
    const back = kiosks.filter((kiosk) => kiosk.lastSeenAt && kiosk.lastSeenAt >= seenSince);
    if (back.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const kiosk of back) {
          await this.center.resolve(tx, {
            subject: { type: 'kiosk', id: kiosk.id },
            types: ['kiosk_offline'],
            outcome: 'done',
            actorId: null,
          });
        }
      });
    }
    const offlineSince = minutesLater(now, -KIOSK_OFFLINE_MINUTES);
    const offline = kiosks.filter((kiosk) => kiosk.lastSeenAt && kiosk.lastSeenAt < offlineSince);
    if (offline.length === 0 || !(await this.workingHours(now, today))) return 0;
    let sent = 0;
    for (const kiosk of offline) {
      const lastSeenAt = kiosk.lastSeenAt as Date;
      const done = await this.db.transaction(async (tx) => {
        const ops = (await this.users.functionManagers(['internal_operations'], tx)).get(
          'internal_operations',
        );
        return this.timed.remindOnce(
          tx,
          { kind: 'kiosk_offline', subjectId: kiosk.id, occursAt: lastSeenAt },
          {
            type: 'kiosk_offline',
            data: { name: kiosk.name, lastSeenAt: lastSeenAt.toISOString() },
            recipients: [...(await this.users.withRole('general_manager', tx)), ...(ops ?? [])],
            actorId: null,
            subjectId: kiosk.id,
          },
        );
      });
      if (done) sent += 1;
    }
    return sent;
  }

  /** Rule C22: between the default schedule's start and end today, on a day that is no holiday. */
  private async workingHours(now: Date, today: CalendarDate): Promise<boolean> {
    const [day] = await this.db
      .select({
        startTime: workScheduleDays.startTime,
        latestStartTime: workScheduleDays.latestStartTime,
        requiredMinutes: workScheduleDays.requiredMinutes,
      })
      .from(workScheduleDays)
      .innerJoin(workSchedules, eq(workSchedules.id, workScheduleDays.scheduleId))
      .where(
        and(eq(workSchedules.isDefault, true), eq(workScheduleDays.weekday, weekdayOf(today))),
      );
    if (!day) return false;
    const holidays = await this.holidays.from(today, this.db);
    if (holidays.some((holiday) => holiday.startsOn <= today && today <= holiday.endsOn)) {
      return false;
    }
    const start = businessInstant(today, toTime(day.startTime));
    const end = minutesLater(
      businessInstant(today, toTime(day.latestStartTime ?? day.startTime)),
      day.requiredMinutes,
    );
    return start <= now && now < end;
  }
}

/** Rules C15 and C21: the latest allowed arrival; a first-half leave moves it by half the day. */
function allowedStart(day: DayRow): Date | null {
  const start = day.latestStart ?? day.expectedStart;
  if (!start || day.requiredMinutes === null) return null;
  return day.leave === 'first_half'
    ? minutesLater(start, Math.floor(day.requiredMinutes / 2))
    : start;
}

/** Rule C15: a fixed day's end, or a flexible day's from its first presence; half on half leave. */
function expectedEnd(day: DayRow): Date | null {
  if (!day.expectedStart || !day.expectedEnd || day.requiredMinutes === null) return null;
  const half = day.leave === 'first_half' || day.leave === 'second_half';
  const minutes = half
    ? day.requiredMinutes - Math.floor(day.requiredMinutes / 2)
    : day.requiredMinutes;
  if (!day.latestStart) {
    return day.leave === 'second_half'
      ? minutesLater(day.expectedEnd, -Math.floor(day.requiredMinutes / 2))
      : day.expectedEnd;
  }
  const opened = day.expectedStart;
  const first = day.firstInAt && day.firstInAt > opened ? day.firstInAt : opened;
  return minutesLater(first, minutes);
}
