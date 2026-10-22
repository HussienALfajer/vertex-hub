import { Injectable } from '@nestjs/common';
import {
  addDays,
  attendanceDateSubjectId,
  businessDate,
  businessInstant,
  type CalendarDate,
  type DayPhase,
  type DayResult,
  dayItems,
  type LatenessTier,
  proposedFraction,
  type RaisedItem,
} from '@vertex-hub/contracts';
import { attendanceDays, attendanceItems, type hrSettings, type Transaction } from '@vertex-hub/db';
import { and, count, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { recordAudit } from '../audit/index.js';
import { UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { LeaveLedger } from './leave-ledger.js';

export type ItemRow = typeof attendanceItems.$inferSelect;

type DayRow = typeof attendanceDays.$inferSelect;

type SettingsRow = typeof hrSettings.$inferSelect;

/** What `AttendanceDays` knows of a day it has just recomputed. */
export interface ComputedDay {
  row: DayRow;
  computed: DayResult;
  phase: DayPhase;
  trial: boolean;
  settings: SettingsRow;
}

/**
 * The attendance items (rules C14, C17 and C18), kept in step with each recomputed day: an item
 * the day raises is added (and the employee and the General Managers told), a pending one follows
 * the day's minutes, and one that no longer applies becomes `void`. A decided item whose minutes
 * changed is voided and raised again, so a decision is never kept for figures it did not see.
 * Callers hold the user's HR lock.
 */
@Injectable()
export class AttendanceItems {
  constructor(
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly ledger: LeaveLedger,
  ) {}

  async reconcile(tx: Transaction, day: ComputedDay, now: Date): Promise<void> {
    const { row } = day;
    const wanted = dayItems({
      phase: day.phase,
      trial: day.trial,
      status: day.computed.status,
      lateMinutes: day.computed.lateMinutes,
      earlyMinutes: day.computed.earlyMinutes,
      overtimeMinutes: day.computed.overtimeMinutes,
      missingOut: day.computed.missingOut,
    });
    const live = await tx
      .select()
      .from(attendanceItems)
      .where(and(eq(attendanceItems.dayId, row.id), ne(attendanceItems.status, 'void')));
    for (const item of live) {
      const next = wanted.find((raised) => raised.kind === item.kind);
      if (next && (item.status === 'pending' || next.minutes === item.minutes)) continue;
      await this.void(tx, item, now);
    }
    for (const raised of wanted) {
      const current = live.find((item) => item.kind === raised.kind);
      const proposal = proposedFraction(raised, {
        tiers: day.settings.latenessTiers as LatenessTier[],
        firstLatenessWarning: day.settings.firstLatenessWarning,
        firstLatenessOfMonth:
          raised.kind === 'lateness' && (await this.firstLatenessOfMonth(tx, row)),
        halfDayLeave: row.leave === 'first_half' || row.leave === 'second_half',
      });
      if (current?.status === 'pending') {
        if (current.minutes !== raised.minutes || current.proposedFraction !== proposal) {
          await tx
            .update(attendanceItems)
            .set({ minutes: raised.minutes, proposedFraction: proposal })
            .where(eq(attendanceItems.id, current.id));
        }
        continue;
      }
      if (current && current.minutes === raised.minutes) continue;
      await this.raise(tx, row, raised, proposal);
    }
    await this.settleReminders(tx, day);
  }

  /**
   * Rules C2 and C14: a day attendance no longer applies to (exempt, a later start, an earlier
   * end of service) keeps none of its items or reminders.
   */
  async dropDay(tx: Transaction, dayId: string, now: Date): Promise<void> {
    const live = await tx
      .select()
      .from(attendanceItems)
      .where(and(eq(attendanceItems.dayId, dayId), ne(attendanceItems.status, 'void')));
    for (const item of live) await this.void(tx, item, now);
    await this.center.resolve(tx, {
      subject: { type: 'attendance_day', id: dayId },
      types: ['attendance_check_in_missing', 'attendance_check_out_missing'],
      outcome: 'void',
      actorId: null,
    });
  }

  /**
   * An item leaves `pending` (decided or void): the employee's notice resolves, and the GMs'
   * notice of the date it was raised on once none of that date's items waits.
   */
  async settle(
    tx: Transaction,
    item: ItemRow,
    outcome: 'done' | 'void',
    actorId: string | null,
  ): Promise<void> {
    await this.center.resolve(tx, {
      subject: { type: 'attendance_item', id: item.id },
      types: ['attendance_item_raised'],
      outcome,
      actorId,
    });
    const raisedOn = businessDate(item.createdAt);
    const [waiting] = await tx
      .select({ count: count() })
      .from(attendanceItems)
      .where(
        and(
          eq(attendanceItems.status, 'pending'),
          gte(attendanceItems.createdAt, businessInstant(raisedOn, '00:00')),
          lt(attendanceItems.createdAt, businessInstant(addDays(raisedOn, 1), '00:00')),
        ),
      );
    if ((waiting?.count ?? 0) > 0) return;
    await this.center.resolve(tx, {
      subject: { type: 'attendance_date', id: attendanceDateSubjectId(raisedOn) },
      types: ['attendance_items_pending'],
      outcome,
      actorId,
    });
  }

  /** Rule C18: a `time_off` decision changed or voided gives its credit back. */
  async reverseCredit(
    tx: Transaction,
    item: ItemRow,
    date: CalendarDate,
    actorId: string | null,
  ): Promise<void> {
    if (item.status !== 'time_off' || !item.creditedDays) return;
    await this.ledger.insert(tx, [
      {
        userId: item.userId,
        leaveType: 'annual',
        year: Number(date.slice(0, 4)),
        days: -item.creditedDays,
        entry: 'overtime_credit',
        itemId: item.id,
        createdById: actorId,
      },
    ]);
  }

  private async raise(
    tx: Transaction,
    row: DayRow,
    raised: RaisedItem,
    proposal: number,
  ): Promise<void> {
    const [item] = await tx
      .insert(attendanceItems)
      .values({
        userId: row.userId,
        dayId: row.id,
        kind: raised.kind,
        minutes: raised.minutes,
        proposedFraction: proposal,
      })
      .returning();
    if (!item) throw new Error('Item insert returned no row');
    const [profile] = await this.users.profiles({ ids: [row.userId] }, tx);
    await this.center.notify(tx, [
      {
        type: 'attendance_item_raised',
        data: { kind: item.kind, date: row.date, minutes: item.minutes },
        recipients: [row.userId],
        actorId: null,
        subjectId: item.id,
      },
      {
        type: 'attendance_items_pending',
        data: { employee: profile?.name ?? '', kind: item.kind, date: row.date },
        recipients: await this.users.withRole('general_manager', tx),
        actorId: null,
        subjectId: attendanceDateSubjectId(businessDate(item.createdAt)),
      },
    ]);
  }

  private async void(tx: Transaction, item: ItemRow, now: Date): Promise<void> {
    await tx
      .update(attendanceItems)
      .set({ status: 'void', creditedDays: null, decidedFraction: null, decidedMinutes: null })
      .where(eq(attendanceItems.id, item.id));
    if (item.status !== 'pending') {
      const [day] = await tx
        .select({ date: attendanceDays.date })
        .from(attendanceDays)
        .where(eq(attendanceDays.id, item.dayId));
      await this.reverseCredit(tx, item, day?.date ?? businessDate(now), null);
      await recordAudit(tx, {
        actor: null,
        action: 'attendance_item.voided',
        entityType: 'attendance_item',
        entityId: item.id,
        before: { status: item.status, minutes: item.minutes, creditedDays: item.creditedDays },
        after: { status: 'void' },
      });
    }
    await this.settle(tx, item, 'void', null);
  }

  /** Rule C17: no other live lateness of the user earlier in the day's month. */
  private async firstLatenessOfMonth(tx: Transaction, row: DayRow): Promise<boolean> {
    const [earlier] = await tx
      .select({ count: count() })
      .from(attendanceItems)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
      .where(
        and(
          eq(attendanceItems.userId, row.userId),
          eq(attendanceItems.kind, 'lateness'),
          inArray(attendanceItems.status, ['pending', 'deducted', 'waived', 'warned']),
          gte(attendanceDays.date, `${row.date.slice(0, 7)}-01`),
          lt(attendanceDays.date, row.date),
        ),
      );
    return (earlier?.count ?? 0) === 0;
  }

  /** Rule C21: a reminder resolves once its punch, leave or the day's end makes it moot. */
  private async settleReminders(tx: Transaction, day: ComputedDay): Promise<void> {
    const { row, computed, phase } = day;
    const subject = { type: 'attendance_day' as const, id: row.id };
    const noArrivalDue = row.kind !== 'work' || row.leave === 'full' || phase === 'after';
    if (computed.firstInAt || noArrivalDue) {
      await this.center.resolve(tx, {
        subject,
        types: ['attendance_check_in_missing'],
        outcome: computed.firstInAt ? 'done' : 'void',
        actorId: null,
      });
    }
    if (!computed.missingOut || phase === 'after') {
      await this.center.resolve(tx, {
        subject,
        types: ['attendance_check_out_missing'],
        outcome: computed.missingOut ? 'void' : 'done',
        actorId: null,
      });
    }
  }
}
