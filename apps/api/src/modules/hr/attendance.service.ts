import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AttendanceDay,
  type AttendanceDayList,
  type AttendanceDayListQuery,
  type AttendanceExemption,
  type AttendanceGreeting,
  type AttendancePunch,
  addDays,
  businessDate,
  businessInstant,
  businessTimeOfDay,
  type CalendarDate,
  DUPLICATE_PUNCH_SECONDS,
  type MyAttendanceToday,
  nextPunchDirection,
  type PunchInput,
  type PunchOptionsInput,
  type PunchResult,
  partOfDay,
  punchDates,
  type SelfPunchMethod,
  type WebAuthnChallenge,
  weekdayOf,
} from '@vertex-hub/contracts';
import {
  attendanceKiosks,
  attendancePasskeys,
  attendancePunches,
  type Database,
  employeeFiles,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { AttendanceDays, type DayRow } from './attendance-days.js';
import { AttendanceKiosksService, OfficeRefused } from './attendance-kiosks.service.js';
import { AttendancePasskeys, type PasskeyRow } from './attendance-passkeys.js';
import { AttendanceShoots } from './attendance-shoots.js';
import { AttendanceWebAuthn, type StoredCredential } from './attendance-webauthn.js';
import { HrScope } from './hr-scope.js';
import { HrSettingsService } from './hr-settings.service.js';
import { KioskStream } from './kiosk-stream.js';
import { lockLeave } from './leave-ledger.js';
import { LeaveWorkSources } from './leave-work-sources.js';

type Executor = Database | Transaction;

type FileRow = typeof employeeFiles.$inferSelect;

type PunchRow = typeof attendancePunches.$inferSelect;

/** What the punch ticket carries from the options to the punch (rules C7–C13). */
interface PunchTicket extends Record<string, unknown> {
  method: SelfPunchMethod;
  kioskId: string | null;
  shootId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
}

const credentialOf = (row: PasskeyRow): StoredCredential => ({
  credentialId: row.credentialId,
  publicKey: row.publicKey,
  counter: row.counter,
  transports: row.transports,
});

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Rule C2: why attendance does not apply to the user today, or null. */
function exemptionOf(file: FileRow | undefined, today: CalendarDate): AttendanceExemption | null {
  if (!file || file.attendanceExempt) return 'exempt';
  if (file.archivedAt || (file.endedOn && file.endedOn < today)) return 'ended';
  if (!file.startDate || file.startDate > today) return 'not_started';
  return null;
}

const exempt = () =>
  new CodedException(403, 'EXEMPT', 'Attendance does not apply to this account today');

const noPasskey = () =>
  new CodedException(409, 'NO_PASSKEY', 'Register the attendance passkey first');

const locationRequired = () =>
  new CodedException(400, 'LOCATION_REQUIRED', 'This punch needs the phone’s location');

const duplicatePunch = () =>
  new CodedException(409, 'DUPLICATE_PUNCH', 'A punch was recorded less than a minute ago');

/**
 * Check-in and check-out (rules C1, C2, C5–C8, C10, C11, C13, C15, C16, C20; edge case 8): the
 * options request checks the place (the entrance code and the office network, a remote day, a
 * shoot) and returns a WebAuthn challenge in a ticket; the punch verifies the passkey, writes the
 * punch at the server's time and recomputes the day. A refused office punch is audited.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly days: AttendanceDays,
    private readonly kiosks: AttendanceKiosksService,
    private readonly passkeys: AttendancePasskeys,
    private readonly shoots: AttendanceShoots,
    private readonly webAuthn: AttendanceWebAuthn,
    private readonly scope: HrScope,
    private readonly settings: HrSettingsService,
    private readonly stream: KioskStream,
    private readonly work: LeaveWorkSources,
  ) {}

  /** `GET /attendance/me/today`. */
  async today(actor: CurrentUserInfo, now = new Date()): Promise<MyAttendanceToday> {
    const today = businessDate(now);
    const file = await this.file(this.db, actor.id);
    const exemption = exemptionOf(file, today);
    const [settings, active, pending] = await Promise.all([
      this.settings.row(),
      this.passkeys.current(this.db, actor.id, 'active'),
      this.passkeys.current(this.db, actor.id, 'pending'),
    ]);
    let day: AttendanceDay | null = null;
    let methods: SelfPunchMethod[] = [];
    let shoots: MyAttendanceToday['shoots'] = [];
    if (!exemption) {
      const row = await this.db.transaction(async (tx) => {
        await lockLeave(tx, actor.id);
        return (await this.days.refresh(tx, actor.id, [today], { create: true, now })).get(today);
      });
      day = row ? ((await this.present(this.db, actor.id, [row]))[0] ?? null) : null;
      shoots = await this.shoots.punchable(this.db, actor.id, now);
      methods = [
        'office',
        ...(file?.remoteWeekdays.includes(weekdayOf(today)) ? (['remote'] as const) : []),
        'field',
        ...(shoots.length > 0 ? (['shoot'] as const) : []),
      ];
    }
    return {
      date: today,
      exemption,
      trial: !settings.attendanceStartsOn || today < settings.attendanceStartsOn,
      passkey: { active: !!active, pending: !!pending },
      day,
      nextDirection: nextPunchDirection(await this.lastPunch(this.db, actor.id), now),
      methods,
      shoots,
    };
  }

  /** `POST /attendance/punch/options`: the place is checked, then the passkey is asked for. */
  async options(
    actor: CurrentUserInfo,
    input: PunchOptionsInput,
    ipAddress: string | null,
    now = new Date(),
  ): Promise<WebAuthnChallenge> {
    const file = await this.file(this.db, actor.id);
    if (exemptionOf(file, businessDate(now))) throw exempt();
    const passkey = await this.passkeys.current(this.db, actor.id, 'active');
    if (!passkey) throw noPasskey();
    await this.refuseDuplicate(this.db, actor.id, now);
    let kioskId: string | null = null;
    if (input.method === 'office') {
      kioskId = (await this.officeKiosk(actor, input.code ?? '', ipAddress, now)).id;
    } else {
      if (
        input.method === 'remote' &&
        !file?.remoteWeekdays.includes(weekdayOf(businessDate(now)))
      ) {
        throw new CodedException(409, 'NOT_REMOTE_DAY', 'Today is not a remote day');
      }
      if (input.method === 'shoot') {
        const open = await this.shoots.punchable(this.db, actor.id, now);
        if (!open.some((shoot) => shoot.id === input.shootId)) {
          throw new CodedException(
            409,
            'NOT_ON_SHOOT',
            'Not crew of this shoot, or outside its check-in time',
          );
        }
      }
      if (input.latitude === undefined || input.longitude === undefined) throw locationRequired();
    }
    const ticket: PunchTicket = {
      method: input.method,
      kioskId,
      shootId: input.method === 'shoot' ? (input.shootId ?? null) : null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyM: input.accuracyM ?? null,
    };
    return this.webAuthn.authenticationOptions(actor.id, credentialOf(passkey), ticket);
  }

  /** `POST /attendance/punch`: the signed assertion writes the punch. */
  async punch(
    actor: CurrentUserInfo,
    input: PunchInput,
    ipAddress: string | null,
    now = new Date(),
  ): Promise<PunchResult> {
    const ticket = this.webAuthn.open<PunchTicket>(input.ticket, 'punch', actor.id);
    if (ticket.method === 'field' && !input.fieldNote) {
      throw new BadRequestException('A field punch needs a note');
    }
    let kiosk: typeof attendanceKiosks.$inferSelect | null = null;
    if (ticket.method === 'office') {
      // Rule C6, checked again: the phone may have left the office network since the options.
      const [row] = await this.db
        .select()
        .from(attendanceKiosks)
        .where(eq(attendanceKiosks.id, ticket.kioskId ?? ''));
      if (!row || row.archivedAt || !this.kiosks.onOfficeNetwork(row, ipAddress, now)) {
        await this.refused(actor, 'OFF_OFFICE_NETWORK', ipAddress, ticket.kioskId);
        throw new OfficeRefused('OFF_OFFICE_NETWORK');
      }
      kiosk = row;
    }
    const today = businessDate(now);
    const result = await this.db.transaction(async (tx) => {
      await lockLeave(tx, actor.id);
      const file = await this.file(tx, actor.id);
      if (exemptionOf(file, today)) throw exempt();
      const passkey = await this.passkeys.current(tx, actor.id, 'active');
      if (!passkey) throw noPasskey();
      const counter = await this.webAuthn.verifyAuthentication(
        ticket,
        input.assertion,
        credentialOf(passkey),
      );
      await tx
        .update(attendancePasskeys)
        .set({ counter })
        .where(eq(attendancePasskeys.id, passkey.id));
      await this.refuseDuplicate(tx, actor.id, now);
      const direction = nextPunchDirection(await this.lastPunch(tx, actor.id), now);
      const field = ticket.method === 'field' || ticket.method === 'shoot';
      const [punch] = await tx
        .insert(attendancePunches)
        .values({
          userId: actor.id,
          direction,
          at: now,
          method: ticket.method,
          kioskId: ticket.kioskId,
          ipAddress,
          latitude: ticket.latitude,
          longitude: ticket.longitude,
          accuracyM: ticket.accuracyM,
          fieldNote: ticket.method === 'field' ? (input.fieldNote ?? null) : null,
          shootId: ticket.shootId,
          fieldReview: field ? 'accepted' : null,
        })
        .returning();
      if (!punch) throw new Error('Punch insert returned no row');
      // Rule C15: an out after midnight may belong to yesterday.
      const refreshed = await this.days.refresh(tx, actor.id, [addDays(today, -1), today], {
        create: true,
        now,
      });
      const day =
        direction === 'out' &&
        refreshed.get(addDays(today, -1))?.lastOutAt?.getTime() === now.getTime()
          ? refreshed.get(addDays(today, -1))
          : refreshed.get(today);
      if (!day) throw new Error('The punch has no attendance day');
      const greeting = await this.greeting(tx, actor, direction, day, now);
      if (kiosk) await this.stream.publish(tx, kiosk.id, greeting);
      return { punch, day, greeting };
    });
    const [day] = await this.present(this.db, actor.id, [result.day]);
    const [punch] = await this.presentPunches(this.db, [result.punch]);
    if (!day || !punch) throw new NotFoundException();
    return { punch, day, greeting: result.greeting };
  }

  /** `GET /attendance/days`: one's own month, or one `hr.read` covers; 404 otherwise. */
  async month(actor: CurrentUserInfo, query: AttendanceDayListQuery): Promise<AttendanceDayList> {
    const userId = query.userId === 'me' ? actor.id : query.userId;
    if (userId !== actor.id && !(await this.scope.covers(actor, userId))) {
      throw new NotFoundException();
    }
    const rows = await this.days.month(this.db, userId, query.month);
    return { items: await this.present(this.db, userId, rows) };
  }

  /** Rules C5 and C6, with a refused attempt audited for the GM. */
  private async officeKiosk(
    actor: CurrentUserInfo,
    code: string,
    ipAddress: string | null,
    now: Date,
  ) {
    try {
      const kiosk = await this.kiosks.verifyCode(code, now);
      if (!this.kiosks.onOfficeNetwork(kiosk, ipAddress, now)) {
        throw Object.assign(new OfficeRefused('OFF_OFFICE_NETWORK'), { kioskId: kiosk.id });
      }
      return kiosk;
    } catch (error) {
      if (error instanceof OfficeRefused) {
        const kioskId = (error as OfficeRefused & { kioskId?: string }).kioskId ?? null;
        await this.refused(actor, error.reason, ipAddress, kioskId);
      }
      throw error;
    }
  }

  private async refused(
    actor: CurrentUserInfo,
    reason: OfficeRefused['reason'],
    ipAddress: string | null,
    kioskId: string | null,
  ): Promise<void> {
    await recordAudit(this.db, {
      actor: { id: actor.id, name: actor.name },
      action: 'attendance.punch_refused',
      entityType: 'attendance',
      entityId: actor.id,
      after: { reason, ipAddress, kioskId },
    });
  }

  /** Edge case 8: a second punch within a minute is refused. */
  private async refuseDuplicate(executor: Executor, userId: string, now: Date): Promise<void> {
    const last = await this.lastPunch(executor, userId);
    if (last && now.getTime() - last.at.getTime() < DUPLICATE_PUNCH_SECONDS * 1000) {
      throw duplicatePunch();
    }
  }

  private async lastPunch(executor: Executor, userId: string) {
    const [row] = await executor
      .select({ direction: attendancePunches.direction, at: attendancePunches.at })
      .from(attendancePunches)
      .where(and(eq(attendancePunches.userId, userId), isNull(attendancePunches.archivedAt)))
      .orderBy(desc(attendancePunches.at), desc(attendancePunches.id))
      .limit(1);
    return row ?? null;
  }

  private async file(executor: Executor, userId: string): Promise<FileRow | undefined> {
    const [row] = await executor
      .select()
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, userId));
    return row;
  }

  /** Rule C20: no client names; open tasks due today and the first shoot or meeting today. */
  private async greeting(
    tx: Transaction,
    actor: CurrentUserInfo,
    direction: 'in' | 'out',
    day: DayRow,
    now: Date,
  ): Promise<AttendanceGreeting> {
    const name = firstName(actor.name);
    if (direction === 'out') {
      return {
        direction,
        firstName: name,
        partOfDay: null,
        tasksDueToday: null,
        firstEventAt: null,
        workedMinutes: day.workedMinutes,
      };
    }
    const today = businessDate(now);
    const work = await this.work.find(tx, actor.id, { from: today, to: today });
    const events = work
      .filter((item) => item.kind !== 'task' && item.startsAt && item.date === today)
      .map((item) => item.startsAt as string)
      .sort();
    return {
      direction,
      firstName: name,
      partOfDay: partOfDay(businessTimeOfDay(now)),
      tasksDueToday: work.filter((item) => item.kind === 'task').length,
      firstEventAt: events[0] ?? null,
      workedMinutes: null,
    };
  }

  /** Days with their punches (rejected ones included), by date. */
  private async present(
    executor: Executor,
    userId: string,
    rows: readonly DayRow[],
  ): Promise<AttendanceDay[]> {
    const dates = rows.map((row) => row.date).sort();
    const first = dates[0];
    const last = dates.at(-1);
    if (!first || !last) return [];
    const punchRows = await executor
      .select()
      .from(attendancePunches)
      .where(
        and(
          eq(attendancePunches.userId, userId),
          gte(attendancePunches.at, dayStart(addDays(first, -1))),
          lt(attendancePunches.at, dayStart(addDays(last, 2))),
        ),
      )
      .orderBy(asc(attendancePunches.at), asc(attendancePunches.id));
    const punches = await this.presentPunches(executor, punchRows);
    const live = punchRows.filter((punch) => !punch.archivedAt);
    const liveDates = punchDates(live);
    // A rejected punch belongs to the date it was made on.
    const dateOf = (punch: PunchRow) => liveDates.get(punch) ?? businessDate(punch.at);
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      date: row.date,
      kind: row.kind,
      expectedStart: row.expectedStart?.toISOString() ?? null,
      latestStart: row.latestStart?.toISOString() ?? null,
      expectedEnd: row.expectedEnd?.toISOString() ?? null,
      requiredMinutes: row.requiredMinutes,
      place: row.place,
      leave: row.leave,
      firstInAt: row.firstInAt?.toISOString() ?? null,
      lastOutAt: row.lastOutAt?.toISOString() ?? null,
      workedMinutes: row.workedMinutes,
      lateMinutes: row.lateMinutes,
      earlyMinutes: row.earlyMinutes,
      overtimeMinutes: row.overtimeMinutes,
      status: row.status,
      punches: punchRows
        .map((punch, i) => ({ punch, presented: punches[i] }))
        .filter(({ punch }) => dateOf(punch) === row.date)
        .flatMap(({ presented }) => (presented ? [presented] : [])),
    }));
  }

  private async presentPunches(
    executor: Executor,
    rows: readonly PunchRow[],
  ): Promise<AttendancePunch[]> {
    const kioskIds = [...new Set(rows.flatMap((row) => (row.kioskId ? [row.kioskId] : [])))];
    const [kiosks, places] = await Promise.all([
      kioskIds.length === 0
        ? Promise.resolve([])
        : executor
            .select({ id: attendanceKiosks.id, name: attendanceKiosks.name })
            .from(attendanceKiosks)
            .where(inArray(attendanceKiosks.id, kioskIds)),
      this.shoots.places(executor, [
        ...new Set(rows.flatMap((row) => (row.shootId ? [row.shootId] : []))),
      ]),
    ]);
    const kioskNames = new Map(kiosks.map((kiosk) => [kiosk.id, kiosk.name]));
    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      at: row.at.toISOString(),
      method: row.method,
      kioskName: row.kioskId ? (kioskNames.get(row.kioskId) ?? null) : null,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyM: row.accuracyM,
      fieldNote: row.fieldNote,
      shoot: row.shootId ? (places.get(row.shootId) ?? null) : null,
      fieldReview: row.fieldReview,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }
}

const dayStart = (date: CalendarDate) => businessInstant(date, '00:00');
