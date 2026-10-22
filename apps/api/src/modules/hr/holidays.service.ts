import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CalendarDate,
  type CreateHoliday,
  type Holiday,
  type HolidayList,
  holidayRangeValid,
  type RepeatHolidays,
  shiftedHoliday,
  type UpdateHoliday,
} from '@vertex-hub/contracts';
import { type Database, publicHolidays, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { assertMonthsOpen } from './closed-months.js';
import { HrRequestsService } from './hr-requests.service.js';

type HolidayRow = typeof publicHolidays.$inferSelect;

type HolidayChange = 'added' | 'redated' | 'archived';

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const auditFields = (row: HolidayRow) => ({
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  paid: row.paid,
});

/**
 * Rule B3: public holidays, managed by `hr.manage` and read by everyone with `calendar.read`.
 * Overlapping non-archived holidays are refused under one lock, so two writes cannot both pass
 * the check. Adding, re-dating or archiving one notifies everyone (`holiday_changed`) and recounts
 * the open leaves sharing its days (edge case 11).
 */
@Injectable()
export class HolidaysService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly requests: HrRequestsService,
  ) {}

  /** The non-archived holidays with a day in `year`, by start date. */
  async list(year: number): Promise<HolidayList> {
    const rows = await this.db
      .select()
      .from(publicHolidays)
      .where(
        and(
          isNull(publicHolidays.archivedAt),
          lte(publicHolidays.startsOn, `${year}-12-31`),
          gte(publicHolidays.endsOn, `${year}-01-01`),
        ),
      )
      .orderBy(asc(publicHolidays.startsOn), asc(publicHolidays.id));
    return { items: rows.map(toResponse) };
  }

  async create(actor: CurrentUserInfo, input: CreateHoliday): Promise<Holiday> {
    checkRange(input);
    const row = await this.db.transaction(async (tx) => {
      await lockHolidays(tx);
      // Edge case 12: a holiday in a closed month is refused; reopen first.
      await assertMonthsOpen(tx, input.startsOn, input.endsOn);
      if (await this.overlapping(tx, input)) throw overlapError();
      const created = await this.insert(tx, actor, input);
      await this.notify(tx, actor, created, 'added');
      await this.requests.recount(tx, actor, [created]);
      return created;
    });
    return toResponse(row);
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateHoliday): Promise<Holiday> {
    const row = await this.db.transaction(async (tx) => {
      await lockHolidays(tx);
      const current = await this.live(tx, id);
      const merged = { ...auditFields(current), ...input };
      checkRange(merged);
      const changes = changedFields(auditFields(current), input);
      if (!changes) return current;
      await assertMonthsOpen(tx, current.startsOn, current.endsOn);
      await assertMonthsOpen(tx, merged.startsOn, merged.endsOn);
      if (await this.overlapping(tx, merged, id)) throw overlapError();
      const [updated] = await tx
        .update(publicHolidays)
        .set({ ...changes.after, updatedAt: new Date() })
        .where(eq(publicHolidays.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'holiday.updated',
        entityType: 'holiday',
        entityId: id,
        before: changes.before,
        after: changes.after,
      });
      if (updated.startsOn !== current.startsOn || updated.endsOn !== current.endsOn) {
        await this.notify(tx, actor, updated, 'redated');
        await this.requests.recount(tx, actor, [current, updated]);
      }
      return updated;
    });
    return toResponse(row);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<Holiday> {
    const row = await this.db.transaction(async (tx) => {
      await lockHolidays(tx);
      const [current] = await tx
        .select()
        .from(publicHolidays)
        .where(eq(publicHolidays.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (current.archivedAt) return current;
      await assertMonthsOpen(tx, current.startsOn, current.endsOn);
      const [archived] = await tx
        .update(publicHolidays)
        .set({ archivedAt: new Date() })
        .where(eq(publicHolidays.id, id))
        .returning();
      if (!archived) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'holiday.archived',
        entityType: 'holiday',
        entityId: id,
        before: { archived: false },
        after: { archived: true, ...auditFields(current) },
      });
      await this.notify(tx, actor, archived, 'archived');
      await this.requests.recount(tx, actor, [archived]);
      return archived;
    });
    return toResponse(row);
  }

  /**
   * "Repeat last year": the holidays that start in the year before `year`, copied to the same
   * dates for review. A copy that would overlap a holiday already there is skipped.
   */
  async repeat(actor: CurrentUserInfo, input: RepeatHolidays): Promise<HolidayList> {
    const created = await this.db.transaction(async (tx) => {
      await lockHolidays(tx);
      const previous = input.year - 1;
      const sources = await tx
        .select()
        .from(publicHolidays)
        .where(
          and(
            isNull(publicHolidays.archivedAt),
            gte(publicHolidays.startsOn, `${previous}-01-01`),
            lte(publicHolidays.startsOn, `${previous}-12-31`),
          ),
        )
        .orderBy(asc(publicHolidays.startsOn), asc(publicHolidays.id));
      const rows: HolidayRow[] = [];
      for (const source of sources) {
        const copy = { name: source.name, paid: source.paid, ...shiftedHoliday(source, 1) };
        // Each copy is inserted before the next check, so copies never overlap each other.
        if (await this.overlapping(tx, copy)) continue;
        await assertMonthsOpen(tx, copy.startsOn, copy.endsOn);
        const row = await this.insert(tx, actor, copy, source.id);
        await this.notify(tx, actor, row, 'added');
        await this.requests.recount(tx, actor, [row]);
        rows.push(row);
      }
      return rows;
    });
    return { items: created.map(toResponse) };
  }

  private async insert(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: CreateHoliday,
    repeatedFromId?: string,
  ): Promise<HolidayRow> {
    const [created] = await tx.insert(publicHolidays).values(input).returning();
    if (!created) throw new Error('Holiday not created');
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'holiday.created',
      entityType: 'holiday',
      entityId: created.id,
      after: { ...auditFields(created), ...(repeatedFromId ? { repeatedFromId } : {}) },
    });
    return created;
  }

  private async live(tx: Transaction, id: string): Promise<HolidayRow> {
    const [row] = await tx
      .select()
      .from(publicHolidays)
      .where(and(eq(publicHolidays.id, id), isNull(publicHolidays.archivedAt)))
      .for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Whether a non-archived holiday other than `exceptId` shares a day with `range`. */
  private async overlapping(
    tx: Transaction,
    range: { startsOn: CalendarDate; endsOn: CalendarDate },
    exceptId?: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: publicHolidays.id })
      .from(publicHolidays)
      .where(
        and(
          isNull(publicHolidays.archivedAt),
          lte(publicHolidays.startsOn, range.endsOn),
          gte(publicHolidays.endsOn, range.startsOn),
          exceptId ? ne(publicHolidays.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return !!row;
  }

  private async notify(
    tx: Transaction,
    actor: CurrentUserInfo,
    row: HolidayRow,
    change: HolidayChange,
  ): Promise<void> {
    await this.center.notify(tx, {
      type: 'holiday_changed',
      data: { change, name: row.name, startsOn: row.startsOn, endsOn: row.endsOn },
      recipients: await this.users.activeOf({ everyone: true }, tx),
      actorId: actor.id,
      subjectId: row.id,
    });
  }
}

/**
 * Serializes the holiday writes, so the overlap check holds; closing a month takes it too, before
 * any user lock, so a holiday never lands in a month closing beside it (edge case 12).
 */
export async function lockHolidays(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('hr.public_holidays', 0))`);
}

function checkRange(range: { startsOn: CalendarDate; endsOn: CalendarDate }): void {
  if (!holidayRangeValid(range)) {
    throw new CodedException(
      400,
      'INVALID_DATES',
      'A holiday ends on or after its start and lasts at most 10 days',
    );
  }
}

const overlapError = () =>
  new CodedException(409, 'HOLIDAY_OVERLAP', 'Another holiday covers some of these days');

function toResponse(row: HolidayRow): Holiday {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    paid: row.paid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
