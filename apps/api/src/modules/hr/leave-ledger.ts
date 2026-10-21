import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BALANCE_LEAVE_TYPES,
  type BalanceLeaveType,
  type CreateLeaveAdjustment,
  LEDGER_ENTRIES,
  type LeaveBalance,
  type LeaveType,
  type LedgerEntry,
  sumDays,
} from '@vertex-hub/contracts';
import { type Database, leaveLedger, type Transaction } from '@vertex-hub/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';

type Executor = Database | Transaction;

export type Balances = Record<BalanceLeaveType, number>;

export const noBalances = (): Balances => ({ annual: 0, sick: 0, emergency: 0 });

/**
 * The balances a leave type draws on (rule B12): emergency days count against both the emergency
 * cap and the annual balance; unpaid leave has none.
 */
export function drawsOn(leaveType: LeaveType): BalanceLeaveType[] {
  if (leaveType === 'unpaid') return [];
  return leaveType === 'emergency' ? ['emergency', 'annual'] : [leaveType];
}

/** A row the jobs or a request writes. */
export interface LedgerInsert {
  userId: string;
  leaveType: BalanceLeaveType;
  year: number;
  days: number;
  entry: LedgerEntry;
  period?: string | null;
  requestId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

/**
 * The leave balance ledger (rules B4–B7, spec `leave_ledger`): a balance is the sum of the
 * non-archived rows of a user, type and year. Rows are never edited; a request's days are kept in
 * step by `taken` and `restored` rows (`syncRequest`).
 */
@Injectable()
export class LeaveLedger {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
  ) {}

  /** The user's balances of `year`. */
  async balances(executor: Executor, userId: string, year: number): Promise<Balances> {
    const rows = await executor
      .select({ leaveType: leaveLedger.leaveType, days: leaveLedger.days })
      .from(leaveLedger)
      .where(
        and(
          eq(leaveLedger.userId, userId),
          eq(leaveLedger.year, year),
          isNull(leaveLedger.archivedAt),
        ),
      );
    const result = noBalances();
    for (const row of rows) result[row.leaveType] = sumDays([result[row.leaveType], row.days]);
    return result;
  }

  async insert(executor: Executor, rows: readonly LedgerInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await executor
      .insert(leaveLedger)
      .values(rows.map((row) => ({ ...row })))
      .onConflictDoNothing()
      .returning({ id: leaveLedger.id });
    return inserted.length;
  }

  /**
   * Rules B14, B15 and B3: writes the `taken` or `restored` rows that bring a leave's net days on
   * each balance it draws on to `paidByYear` (paid days by year, positive).
   */
  async syncRequest(
    tx: Transaction,
    request: { id: string; userId: string; leaveType: LeaveType },
    paidByYear: ReadonlyMap<number, number>,
    actorId: string | null,
  ): Promise<void> {
    const types = drawsOn(request.leaveType);
    if (types.length === 0) return;
    const rows = await tx
      .select({ leaveType: leaveLedger.leaveType, year: leaveLedger.year, days: leaveLedger.days })
      .from(leaveLedger)
      .where(
        and(
          eq(leaveLedger.requestId, request.id),
          inArray(leaveLedger.entry, ['taken', 'restored']),
          isNull(leaveLedger.archivedAt),
        ),
      );
    const inserts: LedgerInsert[] = [];
    for (const leaveType of types) {
      const years = new Set([
        ...paidByYear.keys(),
        ...rows.filter((row) => row.leaveType === leaveType).map((row) => row.year),
      ]);
      for (const year of [...years].sort()) {
        const current = sumDays(
          rows
            .filter((row) => row.leaveType === leaveType && row.year === year)
            .map((row) => row.days),
        );
        const change = sumDays([-(paidByYear.get(year) ?? 0), -current]);
        if (change === 0) continue;
        inserts.push({
          userId: request.userId,
          leaveType,
          year,
          days: change,
          entry: change < 0 ? 'taken' : 'restored',
          requestId: request.id,
          createdById: actorId,
        });
      }
    }
    await this.insert(tx, inserts);
  }

  /**
   * `GET /balances/:userId`: the year's balances with their parts and ledger; `pending` holds the
   * days of the user's pending requests by type.
   */
  async view(userId: string, year: number, pending: Balances): Promise<LeaveBalance> {
    const rows = await this.db
      .select()
      .from(leaveLedger)
      .where(
        and(
          eq(leaveLedger.userId, userId),
          eq(leaveLedger.year, year),
          isNull(leaveLedger.archivedAt),
        ),
      )
      .orderBy(desc(leaveLedger.createdAt), desc(leaveLedger.id));
    const people = await this.users.summaries(
      rows.flatMap((row) => (row.createdById ? [row.createdById] : [])),
    );
    const sum = (leaveType: BalanceLeaveType, entries: readonly LedgerEntry[]) =>
      sumDays(
        rows
          .filter((row) => row.leaveType === leaveType && entries.includes(row.entry))
          .map((row) => row.days),
      );
    return {
      userId,
      year,
      balances: BALANCE_LEAVE_TYPES.map((leaveType) => {
        const balance = sum(leaveType, LEDGER_ENTRIES);
        return {
          leaveType,
          balance,
          pending: pending[leaveType],
          available: sumDays([balance, -pending[leaveType]]),
          opening: sum(leaveType, ['opening']),
          accrued: sum(leaveType, ['accrual', 'grant']),
          carriedOver: sum(leaveType, ['carry_over']),
          taken: -sum(leaveType, ['taken', 'restored']),
          expired: -sum(leaveType, ['expiry']),
          adjusted: sum(leaveType, ['adjustment']),
        };
      }),
      ledger: rows.map((row) => ({
        id: row.id,
        leaveType: row.leaveType,
        year: row.year,
        days: row.days,
        entry: row.entry,
        period: row.period,
        requestId: row.requestId,
        note: row.note,
        createdBy: row.createdById
          ? { id: row.createdById, name: people.get(row.createdById)?.name ?? '' }
          : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Rules B6 and B7: `hr.approve` records an opening balance or a signed adjustment; the
   * employee hears of an adjustment (`leave_balance_adjusted`).
   */
  async adjust(
    actor: CurrentUserInfo,
    userId: string,
    input: CreateLeaveAdjustment,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [profile] = await this.users.profiles({ ids: [userId] }, tx);
      if (!profile) throw new NotFoundException();
      const [row] = await tx
        .insert(leaveLedger)
        .values({
          userId,
          leaveType: input.leaveType,
          year: input.year,
          days: input.days,
          entry: input.entry,
          note: input.note,
          createdById: actor.id,
        })
        .returning({ id: leaveLedger.id });
      const auditActor: AuditActor = { id: actor.id, name: actor.name };
      await recordAudit(tx, {
        actor: auditActor,
        action: input.entry === 'opening' ? 'leave_balance.opening' : 'leave_balance.adjusted',
        entityType: 'leave_balance',
        entityId: userId,
        after: {
          ledgerRowId: row?.id,
          leaveType: input.leaveType,
          year: input.year,
          days: input.days,
          note: input.note,
        },
      });
      if (input.entry === 'adjustment' && userId !== actor.id) {
        await this.center.notify(tx, {
          type: 'leave_balance_adjusted',
          data: { leaveType: input.leaveType, year: input.year, days: input.days },
          recipients: [userId],
          actorId: actor.id,
          subjectId: userId,
        });
      }
    });
  }
}
