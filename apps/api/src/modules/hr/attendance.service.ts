import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AttendanceDay,
  type AttendanceDayList,
  type AttendanceDayListQuery,
  type AttendanceExemption,
  type AttendanceGreeting,
  type AttendancePunch,
  addDays,
  attendanceDateSubjectId,
  businessDate,
  businessInstant,
  businessTimeOfDay,
  type CalendarDate,
  DUPLICATE_PUNCH_SECONDS,
  type FieldWork,
  type MyAttendanceToday,
  nextPunchDirection,
  PUNCH_REFUSALS,
  type PunchInput,
  type PunchOptionsInput,
  type PunchRefusal,
  type PunchResult,
  partOfDay,
  punchDates,
  type RejectPunch,
  type SelfPunchMethod,
  type TodayBoard,
  type TodayBoardQuery,
  type TodayState,
  type WebAuthnChallenge,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
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
import { AuditService, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, personRef, UserDirectory } from '../auth/index.js';
import { ImagesService } from '../files/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { AttendanceDays, type DayRow } from './attendance-days.js';
import { AttendanceFieldWork } from './attendance-field-work.js';
import { AttendanceKiosksService, OfficeRefused } from './attendance-kiosks.service.js';
import { AttendancePasskeys, type PasskeyRow } from './attendance-passkeys.js';
import { AttendanceShoots } from './attendance-shoots.js';
import { AttendanceWebAuthn, type StoredCredential } from './attendance-webauthn.js';
import { assertMonthsOpen } from './closed-months.js';
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
    private readonly fieldWork: AttendanceFieldWork,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly audit: AuditService,
    private readonly images: ImagesService,
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
    let fieldWork: FieldWork[] = [];
    if (!exemption) {
      const row = await this.db.transaction(async (tx) => {
        await lockLeave(tx, actor.id);
        return (await this.days.refresh(tx, actor.id, [today], { create: true, now })).get(today);
      });
      day = row ? ((await this.presentDays(this.db, actor.id, [row]))[0] ?? null) : null;
      shoots = await this.shoots.punchable(this.db, actor.id, now);
      fieldWork = await this.fieldWorkOf(this.db, actor.id, today);
      methods = [
        'office',
        // Rules C8 and C19: a standing remote weekday or an approved remote day.
        ...(row?.place === 'remote' ? (['remote'] as const) : []),
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
      fieldWork,
    };
  }

  /** Rule C11: what a field punch may name: the open tasks due today and today's meetings. */
  private async fieldWorkOf(
    executor: Executor,
    userId: string,
    date: CalendarDate,
  ): Promise<FieldWork[]> {
    const work = await this.work.find(executor, userId, { from: date, to: date });
    return work.flatMap((item) =>
      item.kind === 'task' || item.kind === 'meeting'
        ? [{ kind: item.kind, id: item.id, title: item.title, startsAt: item.startsAt }]
        : [],
    );
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
    // Rule D2: an out after midnight (rule C15) would land in yesterday, maybe a closed month.
    await this.refuseClosedOut(this.db, actor.id, now);
    let kioskId: string | null = null;
    if (input.method === 'office') {
      kioskId = (await this.officeKiosk(actor, input.code ?? '', ipAddress, now)).id;
    } else {
      if (
        input.method === 'remote' &&
        !(file && (await this.days.remoteOn(this.db, file, businessDate(now))))
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
    const named = input.fieldWork;
    if (
      named &&
      (ticket.method !== 'field' ||
        !(await this.fieldWorkOf(this.db, actor.id, businessDate(now))).some(
          (work) => work.kind === named.kind && work.id === named.id,
        ))
    ) {
      throw new BadRequestException('Not a task due today or a meeting today');
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
      await this.refuseClosedOut(tx, actor.id, now);
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
          fieldTaskId: named?.kind === 'task' ? named.id : null,
          fieldMeetingId: named?.kind === 'meeting' ? named.id : null,
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
      if (ticket.method === 'field') {
        // Rule C11: accepted at once; the GMs see it, merged per date.
        await this.center.notify(tx, {
          type: 'field_punch_recorded',
          data: { employee: actor.name, direction, at: now.toISOString() },
          recipients: await this.users.withRole('general_manager', tx),
          actorId: actor.id,
          subjectId: attendanceDateSubjectId(today),
        });
      }
      if (ticket.method === 'shoot' && ticket.shootId && direction === 'in') {
        await this.center.resolve(tx, {
          subject: { type: 'shoot', id: ticket.shootId },
          types: ['shoot_check_in_missing'],
          outcome: 'done',
          actorId: actor.id,
          recipients: [actor.id],
        });
      }
      const greeting = await this.greeting(tx, actor, direction, day, now);
      // F01C rule 15: the photo is read once committed, never carried by the notification.
      const imageId = (await this.users.summaries([actor.id], tx)).get(actor.id)?.imageId ?? null;
      if (kiosk) await this.stream.publish(tx, kiosk.id, greeting, imageId);
      return { punch, day, greeting, imageId };
    });
    const [day] = await this.presentDays(this.db, actor.id, [result.day]);
    const [punch] = await this.presentPunches(this.db, [result.punch]);
    if (!day || !punch) throw new NotFoundException();
    const photo = await this.images.photoDataUrl(result.imageId);
    return { punch, day, greeting: { ...result.greeting, photo } };
  }

  /**
   * `POST /attendance/punches/:id/reject` (rule C12): `hr.approve` rejects a field or shoot
   * punch with a note; it is archived, its day recomputes and the employee is told.
   */
  async rejectPunch(
    actor: CurrentUserInfo,
    id: string,
    input: RejectPunch,
    now = new Date(),
  ): Promise<AttendanceDay> {
    const result = await this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ userId: attendancePunches.userId })
        .from(attendancePunches)
        .where(eq(attendancePunches.id, id));
      if (!found) throw new NotFoundException();
      await lockLeave(tx, found.userId);
      const [punch] = await tx
        .select()
        .from(attendancePunches)
        .where(eq(attendancePunches.id, id))
        .for('update');
      if (!punch) throw new NotFoundException();
      if ((punch.method !== 'field' && punch.method !== 'shoot') || punch.archivedAt) {
        throw new CodedException(409, 'NOT_FIELD', 'Only a live field or shoot punch is rejected');
      }
      // The date the punch counted for (rule C15), read before it stops counting.
      const date = await this.punchDate(tx, punch);
      await assertMonthsOpen(tx, date);
      await tx
        .update(attendancePunches)
        .set({ fieldReview: 'rejected', archivedAt: now })
        .where(eq(attendancePunches.id, id));
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'attendance_punch.rejected',
        entityType: 'attendance_punch',
        entityId: id,
        before: { fieldReview: punch.fieldReview },
        after: { fieldReview: 'rejected', note: input.note, userId: punch.userId },
      });
      const days = await this.days.refresh(tx, punch.userId, [date], { now });
      if (punch.userId !== actor.id) {
        await this.center.notify(tx, {
          type: 'field_punch_rejected',
          data: { method: punch.method, direction: punch.direction, at: punch.at.toISOString() },
          recipients: [punch.userId],
          actorId: actor.id,
          subjectId: punch.userId,
        });
      }
      const day = days.get(date);
      if (!day) throw new NotFoundException();
      return { userId: punch.userId, day };
    });
    const [day] = await this.presentDays(this.db, result.userId, [result.day]);
    if (!day) throw new NotFoundException();
    return day;
  }

  /**
   * `GET /attendance/today` (spec, Screens): everyone `hr.read` covers, where they stand today,
   * and the office punches refused today (rule C6).
   */
  async board(
    actor: CurrentUserInfo,
    query: TodayBoardQuery,
    now = new Date(),
  ): Promise<TodayBoard> {
    const today = businessDate(now);
    const reach = await this.scope.reach(actor);
    if (!reach) throw new NotFoundException();
    const profiles = (
      await this.users.profiles({ departmentId: query.departmentId, archived: false })
    ).filter((profile) => reach.all || reach.userIds.has(profile.id));
    const ids = profiles.map((profile) => profile.id);
    if (ids.length === 0) return { date: today, rows: [], refusals: [] };
    const [files, dayRows, passkeys, punches] = await Promise.all([
      this.db.select().from(employeeFiles).where(inArray(employeeFiles.userId, ids)),
      this.db
        .select()
        .from(attendanceDays)
        .where(
          and(
            inArray(attendanceDays.userId, ids),
            eq(attendanceDays.date, today),
            isNull(attendanceDays.archivedAt),
          ),
        ),
      this.db
        .select({ userId: attendancePasskeys.userId })
        .from(attendancePasskeys)
        .where(
          and(inArray(attendancePasskeys.userId, ids), eq(attendancePasskeys.status, 'active')),
        ),
      this.db
        .select({ userId: attendancePunches.userId, method: attendancePunches.method })
        .from(attendancePunches)
        .where(
          and(
            inArray(attendancePunches.userId, ids),
            isNull(attendancePunches.archivedAt),
            gte(attendancePunches.at, dayStart(today)),
          ),
        )
        .orderBy(asc(attendancePunches.at), asc(attendancePunches.id)),
    ]);
    const fileOf = new Map(files.map((file) => [file.userId, file]));
    const dayOf = new Map(dayRows.map((row) => [row.userId, row]));
    const withPasskey = new Set(passkeys.map((row) => row.userId));
    const lastMethod = new Map(punches.map((row) => [row.userId, row.method]));
    const presented = new Map<string, AttendanceDay>();
    for (const row of dayRows) {
      const [day] = await this.presentDays(this.db, row.userId, [row]);
      if (day) presented.set(row.userId, day);
    }
    const rows = profiles.flatMap((profile) => {
      const exemption = exemptionOf(fileOf.get(profile.id), today);
      // Not started or already gone: not part of today.
      if (exemption === 'not_started' || exemption === 'ended') return [];
      const row = dayOf.get(profile.id);
      return [
        {
          user: { id: profile.id, name: profile.name, imageId: profile.imageId },
          state: exemption ? 'exempt' : stateOf(row),
          late: (row?.lateMinutes ?? 0) > 0,
          method: lastMethod.get(profile.id) ?? null,
          noPasskey: !exemption && !withPasskey.has(profile.id),
          day: presented.get(profile.id) ?? null,
        },
      ];
    });
    const audit = await this.audit.list(
      {
        action: 'attendance.punch_refused',
        from: dayStart(today).toISOString(),
        page: 1,
        pageSize: 100,
      },
      { showsPay: false },
    );
    const names = new Map(profiles.map((profile) => [profile.id, profile]));
    const refusals: PunchRefusal[] = audit.items.flatMap((entry) => {
      const after = (entry.after ?? {}) as { reason?: string; ipAddress?: string | null };
      const reason = PUNCH_REFUSALS.find((value) => value === after.reason);
      if (!reason || !names.has(entry.entityId)) return [];
      return [
        {
          user: personRef(names, entry.entityId),
          at: entry.occurredAt,
          reason,
          ipAddress: after.ipAddress ?? null,
        },
      ];
    });
    return {
      date: today,
      rows: rows.sort((a, b) => a.user.name.localeCompare(b.user.name, 'ar')),
      refusals,
    };
  }

  /** `GET /attendance/days`: one's own month, or one `hr.read` covers; 404 otherwise. */
  async month(actor: CurrentUserInfo, query: AttendanceDayListQuery): Promise<AttendanceDayList> {
    const userId = query.userId === 'me' ? actor.id : query.userId;
    if (userId !== actor.id && !(await this.scope.covers(actor, userId))) {
      throw new NotFoundException();
    }
    const rows = await this.days.month(this.db, userId, query.month);
    return { items: await this.presentDays(this.db, userId, rows) };
  }

  /** The date a punch counts for: its own, or the day before for an early `out` (rule C15). */
  private async punchDate(tx: Transaction, punch: PunchRow): Promise<CalendarDate> {
    const own = businessDate(punch.at);
    const around = await tx
      .select()
      .from(attendancePunches)
      .where(
        and(
          eq(attendancePunches.userId, punch.userId),
          isNull(attendancePunches.archivedAt),
          gte(attendancePunches.at, dayStart(addDays(own, -1))),
          lt(attendancePunches.at, dayStart(addDays(own, 1))),
        ),
      )
      .orderBy(asc(attendancePunches.at), asc(attendancePunches.id));
    return punchDates(around).get(around.find((row) => row.id === punch.id) ?? punch) ?? own;
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

  /** Rule D2: refuses an `out` that would count for a day of a closed month (rule C15). */
  private async refuseClosedOut(executor: Executor, userId: string, now: Date): Promise<void> {
    const last = await this.lastPunch(executor, userId);
    if (last && nextPunchDirection(last, now) === 'out') {
      await assertMonthsOpen(executor, businessDate(last.at));
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

  /**
   * Rule C20: no client names; open tasks due today and the first shoot or meeting today. The
   * photo is added once the punch committed (F01C rule 15).
   */
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
        photo: null,
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
      photo: null,
    };
  }

  /** Days with their punches (rejected ones included), by date. */
  async presentDays(
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
    const idsOf = (pick: (row: PunchRow) => string | null) => [
      ...new Set(rows.flatMap((row) => (pick(row) ? [pick(row) as string] : []))),
    ];
    const [kiosks, places, taskTitles, meetingTitles] = await Promise.all([
      kioskIds.length === 0
        ? Promise.resolve([])
        : executor
            .select({ id: attendanceKiosks.id, name: attendanceKiosks.name })
            .from(attendanceKiosks)
            .where(inArray(attendanceKiosks.id, kioskIds)),
      this.shoots.places(executor, [
        ...new Set(rows.flatMap((row) => (row.shootId ? [row.shootId] : []))),
      ]),
      this.fieldWork.titles(
        executor,
        'task',
        idsOf((row) => row.fieldTaskId),
      ),
      this.fieldWork.titles(
        executor,
        'meeting',
        idsOf((row) => row.fieldMeetingId),
      ),
    ]);
    const fieldWorkOf = (row: PunchRow): AttendancePunch['fieldWork'] => {
      const task = row.fieldTaskId ? taskTitles.get(row.fieldTaskId) : undefined;
      if (row.fieldTaskId && task !== undefined) {
        return { kind: 'task', id: row.fieldTaskId, title: task };
      }
      const meeting = row.fieldMeetingId ? meetingTitles.get(row.fieldMeetingId) : undefined;
      if (row.fieldMeetingId && meeting !== undefined) {
        return { kind: 'meeting', id: row.fieldMeetingId, title: meeting };
      }
      return null;
    };
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
      fieldWork: fieldWorkOf(row),
      shoot: row.shootId ? (places.get(row.shootId) ?? null) : null,
      fieldReview: row.fieldReview,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }
}

const dayStart = (date: CalendarDate) => businessInstant(date, '00:00');

/** Where someone attendance applies to stands today, from their day (none yet: not in). */
function stateOf(day: DayRow | undefined): TodayState {
  if (!day) return 'not_in';
  if (day.kind === 'holiday') return 'holiday';
  if (day.leave === 'full') return 'on_leave';
  if (day.firstInAt && !day.lastOutAt) return 'in';
  if (day.lastOutAt) return 'out';
  return day.kind === 'off' ? 'off' : 'not_in';
}
