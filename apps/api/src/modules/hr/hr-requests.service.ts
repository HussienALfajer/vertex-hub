import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  type CancelHrRequest,
  type CreateHrOpinion,
  type CreateHrRequest,
  type DecideHrRequest,
  type HolidayRange,
  type HrOpinion,
  type HrRequest,
  type HrRequestDetail,
  type HrRequestListQuery,
  type HrRequestPage,
  type HrRequestPreview,
  type HrRequestWarning,
  isScheduleWorkDay,
  type LeaveHalf,
  type LeaveType,
  lastOfMonth,
  leaveSplit,
  leaveUnits,
  type PunchDirection,
  paidDaysByYear,
  permissionMinutes,
  type RequestSpan,
  requestsOverlap,
  sumDays,
  type TimeOfDay,
  unitDays,
} from '@vertex-hub/contracts';
import {
  attendancePunches,
  type Database,
  hrOpinions,
  hrRequests,
  type Transaction,
} from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory, UserLifecycle } from '../auth/index.js';
import { FileVersions } from '../files/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { AttendanceDays } from './attendance-days.js';
import { AttendancePasskeys } from './attendance-passkeys.js';
import { assertMonthsOpen } from './closed-months.js';
import { holdsAll } from './employee-access.js';
import { HrScope, reaches } from './hr-scope.js';
import { HrSettingsService } from './hr-settings.service.js';
import { LeaveContext, type LeaveSubject } from './leave-context.js';
import { type Balances, drawsOn, LeaveLedger, lockLeave, noBalances } from './leave-ledger.js';
import { LeaveWorkSources } from './leave-work-sources.js';

type Executor = Database | Transaction;

type RequestRow = typeof hrRequests.$inferSelect;

type SettingsRow = Awaited<ReturnType<HrSettingsService['row']>>;

/** A request's fields as the rules evaluated them, before it is stored. */
interface Evaluated {
  userId: string;
  kind: CreateHrRequest['kind'];
  leaveType: LeaveType | null;
  startsOn: CalendarDate;
  endsOn: CalendarDate;
  half: LeaveHalf | null;
  fromTime: TimeOfDay | null;
  toTime: TimeOfDay | null;
  correctionDirection: PunchDirection | null;
  days: number | null;
  paidDays: number | null;
  unpaidDays: number | null;
  reason: string | null;
  shortNotice: boolean;
  certificateRequired: boolean;
  /** `hr.approve` records it: approved at once (rule B8 and "Roles and access"). */
  approvedAtOnce: boolean;
}

const LIVE_STATUSES = ['pending', 'approved'] as const;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const toTime = (value: string | null): TimeOfDay | null => value?.slice(0, 5) ?? null;

const spanOf = (row: RequestRow): RequestSpan => ({
  kind: row.kind,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  half: row.half,
  fromTime: toTime(row.fromTime),
  toTime: toTime(row.toTime),
});

const auditFields = (row: Evaluated | RequestRow) => ({
  userId: row.userId,
  kind: row.kind,
  leaveType: row.leaveType,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  half: row.half,
  fromTime: toTime(row.fromTime),
  toTime: toTime(row.toTime),
  correctionDirection: row.correctionDirection,
  days: row.days,
  paidDays: row.paidDays,
  unpaidDays: row.unpaidDays,
});

const yearOf = (date: CalendarDate) => Number(date.slice(0, 4));

/**
 * Leave, permission, remote-day and correction requests (rules B8–B15, B18, C19 and edge cases
 * 11, 13, 22): submitted by the employee, or recorded by `hr.approve` and approved at once;
 * decided by `hr.approve`, with the opinions of `hr.read` holders. Approving writes the ledger
 * rows of the paid days or a correction's punch, and a holiday change recounts the days of open
 * leaves.
 */
@Injectable()
export class HrRequestsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly lifecycle: UserLifecycle,
    private readonly center: NotificationCenter,
    private readonly fileVersions: FileVersions,
    private readonly scope: HrScope,
    private readonly settings: HrSettingsService,
    private readonly context: LeaveContext,
    private readonly ledger: LeaveLedger,
    private readonly work: LeaveWorkSources,
    private readonly passkeys: AttendancePasskeys,
    private readonly days: AttendanceDays,
  ) {}

  onModuleInit(): void {
    // Rule A8: an archived account's pending requests are cancelled.
    this.lifecycle.register({
      archived: async (tx, userId, actor) => {
        const pending = await tx
          .update(hrRequests)
          .set({ status: 'cancelled', decidedById: actor?.id ?? null, decidedAt: new Date() })
          .where(and(eq(hrRequests.userId, userId), eq(hrRequests.status, 'pending')))
          .returning();
        for (const row of pending) {
          await recordAudit(tx, {
            actor,
            action: 'hr_request.cancelled',
            entityType: 'hr_request',
            entityId: row.id,
            before: { status: 'pending' },
            after: { status: 'cancelled', reason: 'account_archived' },
          });
          await this.resolveSubmitted(tx, row.id, 'void', actor?.id ?? null);
        }
        await this.passkeys.revokePending(tx, userId, actor ?? null, null);
      },
    });
  }

  /** `POST /requests/preview`: what the request would be, with its warnings. */
  async preview(actor: CurrentUserInfo, input: CreateHrRequest): Promise<HrRequestPreview> {
    const evaluated = await this.evaluate(this.db, actor, input);
    const warnings: HrRequestWarning[] = [];
    if (evaluated.shortNotice) warnings.push('short_notice');
    if ((evaluated.unpaidDays ?? 0) > 0 && evaluated.leaveType !== 'unpaid') {
      warnings.push('unpaid_days');
    }
    if (evaluated.certificateRequired) warnings.push('certificate_required');
    return {
      days: evaluated.days,
      paidDays: evaluated.paidDays,
      unpaidDays: evaluated.unpaidDays,
      shortNotice: evaluated.shortNotice,
      warnings,
    };
  }

  /** `POST /requests` (rule B8). */
  async create(actor: CurrentUserInfo, input: CreateHrRequest): Promise<HrRequest> {
    const id = await this.db.transaction(async (tx) => {
      await lockLeave(tx, input.userId ?? actor.id);
      const evaluated = await this.evaluate(tx, actor, input);
      const now = new Date();
      const [row] = await tx
        .insert(hrRequests)
        .values({
          userId: evaluated.userId,
          kind: evaluated.kind,
          leaveType: evaluated.leaveType,
          startsOn: evaluated.startsOn,
          endsOn: evaluated.endsOn,
          half: evaluated.half,
          fromTime: evaluated.fromTime,
          toTime: evaluated.toTime,
          correctionDirection: evaluated.correctionDirection,
          days: evaluated.days,
          paidDays: evaluated.paidDays,
          unpaidDays: evaluated.unpaidDays,
          reason: evaluated.reason,
          shortNotice: evaluated.shortNotice,
          status: evaluated.approvedAtOnce ? 'approved' : 'pending',
          createdById: actor.id,
          ...(evaluated.approvedAtOnce && { decidedById: actor.id, decidedAt: now }),
        })
        .returning();
      if (!row) throw new Error('Request insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_request.created',
        entityType: 'hr_request',
        entityId: row.id,
        after: { ...auditFields(row), reason: row.reason, shortNotice: row.shortNotice },
      });
      if (evaluated.approvedAtOnce) {
        await this.syncTaken(tx, row, actor.id);
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'hr_request.approved',
          entityType: 'hr_request',
          entityId: row.id,
          before: { status: 'pending' },
          // "Roles and access": recorded by an approver, so no decision was asked.
          after: { status: 'approved', recordedByApprover: true },
        });
        if (row.userId !== actor.id) await this.notifyDecided(tx, row, 'approved', actor.id);
        await this.writeCorrection(tx, row);
        await this.refreshDays(tx, row);
      } else {
        await this.notifySubmitted(tx, row);
      }
      return row.id;
    });
    return this.one(id);
  }

  /**
   * Rule C9: registering a passkey while one is active asks the General Manager to approve the
   * new one; a holder of `hr.approve` gets it approved at once ("Roles and access"). Called in
   * the registration's transaction, under the user's lock.
   */
  async createPasskeyReplacement(tx: Transaction, actor: CurrentUserInfo): Promise<void> {
    const today = businessDate();
    const approvedAtOnce = holdsAll(actor, 'hr.approve');
    const now = new Date();
    const [row] = await tx
      .insert(hrRequests)
      .values({
        userId: actor.id,
        kind: 'passkey_replacement',
        startsOn: today,
        endsOn: today,
        status: approvedAtOnce ? 'approved' : 'pending',
        createdById: actor.id,
        ...(approvedAtOnce && { decidedById: actor.id, decidedAt: now }),
      })
      .returning();
    if (!row) throw new Error('Request insert returned no row');
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'hr_request.created',
      entityType: 'hr_request',
      entityId: row.id,
      after: auditFields(row),
    });
    if (!approvedAtOnce) {
      await this.notifySubmitted(tx, row);
      return;
    }
    await this.passkeys.activatePending(tx, actor.id, actorOf(actor));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'hr_request.approved',
      entityType: 'hr_request',
      entityId: row.id,
      before: { status: 'pending' },
      after: { status: 'approved', recordedByApprover: true },
    });
  }

  /** `hr.approve` revoked the pending passkey: its replacement request is cancelled. */
  async cancelPasskeyReplacement(
    tx: Transaction,
    userId: string,
    actor: CurrentUserInfo,
    note: string,
  ): Promise<void> {
    const pending = await tx
      .update(hrRequests)
      .set({
        status: 'cancelled',
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: note,
      })
      .where(
        and(
          eq(hrRequests.userId, userId),
          eq(hrRequests.kind, 'passkey_replacement'),
          eq(hrRequests.status, 'pending'),
        ),
      )
      .returning();
    for (const row of pending) {
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_request.cancelled',
        entityType: 'hr_request',
        entityId: row.id,
        before: { status: 'pending' },
        after: { status: 'cancelled', note },
      });
      await this.resolveSubmitted(tx, row.id, 'void', actor.id);
      await this.notifyDecided(tx, row, 'cancelled', actor.id);
    }
  }

  /** `GET /requests`: one's own, and those `hr.read` covers. */
  async list(actor: CurrentUserInfo, query: HrRequestListQuery): Promise<HrRequestPage> {
    const reach = await this.scope.reach(actor);
    const filters: SQL[] = [isNull(hrRequests.archivedAt)];
    const userId = query.userId === 'me' ? actor.id : query.userId;
    if (userId) {
      if (userId !== actor.id && !reaches(reach, userId)) return empty(query);
      filters.push(eq(hrRequests.userId, userId));
    } else if (!reach) {
      filters.push(eq(hrRequests.userId, actor.id));
    } else if (!reach.all) {
      filters.push(inArray(hrRequests.userId, [...reach.userIds, actor.id]));
    }
    if (query.departmentId) {
      const members = await this.users.profiles({ departmentId: query.departmentId });
      if (members.length === 0) return empty(query);
      filters.push(
        inArray(
          hrRequests.userId,
          members.map((member) => member.id),
        ),
      );
    }
    if (query.status) filters.push(inArray(hrRequests.status, query.status));
    if (query.kind) filters.push(eq(hrRequests.kind, query.kind));
    if (query.month) {
      const first = `${query.month}-01`;
      filters.push(lte(hrRequests.startsOn, lastOfMonth(first)), gte(hrRequests.endsOn, first));
    }
    const where = and(...filters);
    const order = query.order === 'asc' ? asc : desc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(hrRequests)
        .where(where)
        .orderBy(order(hrRequests.createdAt), order(hrRequests.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ count: count() }).from(hrRequests).where(where),
    ]);
    return {
      items: await this.present(this.db, rows),
      total: total?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** `GET /requests/:id`: the owner's, or one `hr.read` covers; 404 otherwise. */
  async detail(actor: CurrentUserInfo, id: string): Promise<HrRequestDetail> {
    const row = await this.readable(this.db, actor, id);
    const [request] = await this.present(this.db, [row]);
    if (!request) throw new NotFoundException();
    const opinionRows = await this.db
      .select()
      .from(hrOpinions)
      .where(and(eq(hrOpinions.requestId, id), isNull(hrOpinions.archivedAt)))
      .orderBy(asc(hrOpinions.createdAt), asc(hrOpinions.id));
    const authors = await this.users.summaries(opinionRows.map((opinion) => opinion.authorId));
    const approver = holdsAll(actor, 'hr.approve');
    const covers = await this.scope.covers(actor, row.userId);
    return {
      ...request,
      opinions: opinionRows.map((opinion) =>
        toOpinion(opinion, authors.get(opinion.authorId)?.name ?? ''),
      ),
      overlappingWork:
        approver && row.kind === 'leave'
          ? await this.work.find(this.db, row.userId, { from: row.startsOn, to: row.endsOn })
          : null,
      permissions: {
        canDecide: approver && row.status === 'pending',
        canCancel: cancellable(actor, row, businessDate()),
        canGiveOpinion: covers && row.userId !== actor.id && row.status === 'pending',
      },
    };
  }

  /** `POST /requests/:id/decision` (rules B13 and B14). */
  async decide(actor: CurrentUserInfo, id: string, input: DecideHrRequest): Promise<HrRequest> {
    await this.db.transaction(async (tx) => {
      await lockLeave(tx, await this.ownerOf(tx, id));
      const current = await this.locked(tx, id);
      if (current.status !== 'pending') throw notPending();
      if (current.kind !== 'passkey_replacement') {
        await assertMonthsOpen(tx, current.startsOn, current.endsOn);
      }
      if (input.decision === 'reject') {
        await tx
          .update(hrRequests)
          .set({
            status: 'rejected',
            decidedById: actor.id,
            decidedAt: new Date(),
            decisionNote: input.note,
          })
          .where(eq(hrRequests.id, id));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'hr_request.rejected',
          entityType: 'hr_request',
          entityId: id,
          before: { status: 'pending' },
          after: { status: 'rejected', note: input.note },
        });
        if (current.kind === 'passkey_replacement') {
          await this.passkeys.revokePending(tx, current.userId, actorOf(actor), input.note ?? null);
        }
        await this.resolveSubmitted(tx, id, 'done', actor.id);
        await this.notifyDecided(tx, current, 'rejected', actor.id);
        return;
      }
      // The days and the split as they stand now (holidays and balances may have changed).
      const recount =
        current.kind === 'leave' && current.leaveType
          ? await this.countLeave(tx, current.userId, {
              leaveType: current.leaveType,
              startsOn: current.startsOn,
              endsOn: current.endsOn,
              half: current.half,
              exceptId: id,
            })
          : null;
      const certificateMissing =
        current.leaveType === 'sick' &&
        (recount?.days ?? 0) > (await this.settings.row(tx)).sickCertificateAfterDays &&
        !(await this.fileVersions.hrRequestDocumentCounts([id], tx)).get(id);
      if (certificateMissing && !input.confirmMissingCertificate) {
        throw new CodedException(
          409,
          'CERTIFICATE_MISSING',
          'The sick certificate is not attached; confirm to approve without it',
        );
      }
      const [approved] = await tx
        .update(hrRequests)
        .set({
          status: 'approved',
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: input.note,
          ...(recount && {
            days: recount.days,
            paidDays: recount.paidDays,
            unpaidDays: recount.unpaidDays,
          }),
        })
        .where(eq(hrRequests.id, id))
        .returning();
      if (!approved) throw new NotFoundException();
      await this.syncTaken(tx, approved, actor.id);
      if (approved.kind === 'passkey_replacement') {
        await this.passkeys.activatePending(tx, approved.userId, actorOf(actor));
      }
      await this.writeCorrection(tx, approved);
      await this.refreshDays(tx, approved);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_request.approved',
        entityType: 'hr_request',
        entityId: id,
        before: { status: 'pending' },
        after: {
          status: 'approved',
          note: input.note,
          ...(recount && {
            days: recount.days,
            paidDays: recount.paidDays,
            unpaidDays: recount.unpaidDays,
          }),
          ...(certificateMissing && { withoutCertificate: true }),
        },
      });
      await this.resolveSubmitted(tx, id, 'done', actor.id);
      await this.notifyDecided(tx, approved, 'approved', actor.id);
    });
    return this.one(id);
  }

  /**
   * `POST /requests/:id/cancel` (rule B15): the owner cancels a pending request, or an approved
   * one whose first day has not come; `hr.approve` cancels any pending or approved one. The days
   * not taken yet are restored.
   */
  async cancel(actor: CurrentUserInfo, id: string, input: CancelHrRequest): Promise<HrRequest> {
    await this.db.transaction(async (tx) => {
      await lockLeave(tx, await this.ownerOf(tx, id));
      const current = await this.locked(tx, id, actor);
      const today = businessDate();
      if (current.kind !== 'passkey_replacement') {
        await assertMonthsOpen(tx, current.startsOn, current.endsOn);
      }
      if (!cancellable(actor, current, today)) {
        throw new CodedException(409, 'NOT_CANCELLABLE', 'This request can no longer be cancelled');
      }
      const [cancelled] = await tx
        .update(hrRequests)
        .set({
          status: 'cancelled',
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: input.note,
        })
        .where(eq(hrRequests.id, id))
        .returning();
      if (!cancelled) throw new NotFoundException();
      if (current.status === 'approved') {
        // The days before today were taken; the rest return to the balance.
        await this.syncTaken(tx, cancelled, actor.id, today);
        // Rule C19: a cancelled correction's punch no longer counts.
        await tx
          .update(attendancePunches)
          .set({ archivedAt: new Date() })
          .where(eq(attendancePunches.requestId, id));
        await this.refreshDays(tx, cancelled);
      }
      if (current.kind === 'passkey_replacement') {
        await this.passkeys.revokePending(tx, current.userId, actorOf(actor), input.note ?? null);
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_request.cancelled',
        entityType: 'hr_request',
        entityId: id,
        before: { status: current.status },
        after: { status: 'cancelled', note: input.note },
      });
      if (current.status === 'pending') {
        await this.resolveSubmitted(tx, id, 'void', actor.id);
      } else if (current.userId !== actor.id) {
        await this.notifyDecided(tx, current, 'cancelled', actor.id);
      }
    });
    return this.one(id);
  }

  /** `POST /opinions` (rule B14): `hr.read` covering the employee, on a pending request. */
  async opine(actor: CurrentUserInfo, input: CreateHrOpinion): Promise<HrOpinion> {
    const row = await this.db.transaction(async (tx) => {
      const request = await this.locked(tx, input.requestId ?? '');
      if (request.userId === actor.id || !(await this.scope.covers(actor, request.userId, tx))) {
        throw new NotFoundException();
      }
      if (request.status !== 'pending') throw notPending();
      const [opinion] = await tx
        .insert(hrOpinions)
        .values({ requestId: request.id, authorId: actor.id, body: input.body })
        .returning();
      if (!opinion) throw new Error('Opinion insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_opinion.created',
        entityType: 'hr_opinion',
        entityId: opinion.id,
        after: { requestId: request.id, body: input.body },
      });
      return opinion;
    });
    return toOpinion(row, actor.name);
  }

  /**
   * Rule B3 and edge case 11: a holiday added, re-dated or archived recounts the pending and
   * approved leaves sharing a day with `ranges`; an approved one restores or takes the
   * difference. Called in the holiday's transaction.
   */
  async recount(
    tx: Transaction,
    actor: CurrentUserInfo,
    ranges: readonly HolidayRange[],
  ): Promise<void> {
    if (ranges.length === 0) return;
    const rows = await tx
      .select()
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.kind, 'leave'),
          inArray(hrRequests.status, [...LIVE_STATUSES]),
          isNull(hrRequests.archivedAt),
          sql`(${sql.join(
            ranges.map(
              (range) =>
                sql`(${hrRequests.startsOn} <= ${range.endsOn} and ${hrRequests.endsOn} >= ${range.startsOn})`,
            ),
            sql` or `,
          )})`,
        ),
      )
      .orderBy(asc(hrRequests.id));
    // Every user this touches (leave owners and those with attendance days on the dates) is
    // locked first, in user-id order, as every writer that locks several users does.
    const dayUsers = new Map<CalendarDate[], string[]>();
    for (const range of ranges) {
      const dates: CalendarDate[] = [];
      for (let date = range.startsOn; date <= range.endsOn; date = addDays(date, 1)) {
        dates.push(date);
      }
      dayUsers.set(dates, await this.days.usersWithDays(tx, range.startsOn, range.endsOn));
    }
    const touched = new Set([...rows.map((row) => row.userId), ...[...dayUsers.values()].flat()]);
    for (const userId of [...touched].sort()) await lockLeave(tx, userId);
    for (const found of rows) {
      const row = await this.locked(tx, found.id);
      if (!row.leaveType || (row.status !== 'pending' && row.status !== 'approved')) continue;
      const counted = await this.countLeave(tx, row.userId, {
        leaveType: row.leaveType,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        half: row.half,
        exceptId: row.id,
      });
      // An approved sick or emergency leave keeps the paid days it was given, within its days.
      const paidDays =
        row.status === 'approved' && row.leaveType !== 'annual'
          ? Math.min(row.paidDays ?? 0, counted.days)
          : counted.paidDays;
      const next = {
        days: counted.days,
        paidDays,
        unpaidDays: sumDays([counted.days, -paidDays]),
      };
      if (
        next.days === row.days &&
        next.paidDays === row.paidDays &&
        next.unpaidDays === row.unpaidDays
      ) {
        continue;
      }
      const [updated] = await tx
        .update(hrRequests)
        .set(next)
        .where(eq(hrRequests.id, row.id))
        .returning();
      if (!updated) continue;
      if (updated.status === 'approved') await this.syncTaken(tx, updated, actor.id);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_request.recounted',
        entityType: 'hr_request',
        entityId: row.id,
        before: { days: row.days, paidDays: row.paidDays, unpaidDays: row.unpaidDays },
        after: next,
      });
    }
    // Rule C14: the attendance days of those dates become holidays or work days again.
    for (const [dates, userIds] of dayUsers) {
      for (const userId of userIds) await this.days.refresh(tx, userId, dates);
    }
  }

  /** The days of the user's pending leaves, by the balance they draw on, in `year`. */
  async pendingDays(
    executor: Executor,
    userId: string,
    year: number,
    exceptId?: string,
  ): Promise<Balances> {
    const rows = await executor
      .select()
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.userId, userId),
          eq(hrRequests.kind, 'leave'),
          eq(hrRequests.status, 'pending'),
          isNull(hrRequests.archivedAt),
          lte(hrRequests.startsOn, `${year}-12-31`),
          gte(hrRequests.endsOn, `${year}-01-01`),
          exceptId ? ne(hrRequests.id, exceptId) : undefined,
        ),
      );
    const result = noBalances();
    if (rows.length === 0) return result;
    const subject = await this.context.subject(userId, executor);
    // From the earliest start: a leave crossing into `year` counted its days from its own start.
    const holidays = await this.context.holidaysFrom(
      rows.reduce((from, row) => (row.startsOn < from ? row.startsOn : from), `${year}-01-01`),
      executor,
    );
    for (const row of rows) {
      if (!row.leaveType || !subject) continue;
      const paid = paidDaysByYear(
        leaveUnits(row, subject.workWeekdays, holidays),
        row.paidDays ?? 0,
      ).get(year);
      if (!paid) continue;
      for (const leaveType of drawsOn(row.leaveType)) {
        result[leaveType] = sumDays([result[leaveType], paid]);
      }
    }
    return result;
  }

  /** The rules of a new request (B8–B13), against the database as it stands. */
  private async evaluate(
    executor: Executor,
    actor: CurrentUserInfo,
    input: CreateHrRequest,
  ): Promise<Evaluated> {
    const approver = holdsAll(actor, 'hr.approve');
    const userId = input.userId ?? actor.id;
    if (userId !== actor.id && !approver) throw new NotFoundException();
    const subject = await this.context.subject(userId, executor);
    if (!subject || subject.archived) throw new NotFoundException();
    const settings = await this.settings.row(executor);
    const today = businessDate();
    // Recorded by an approver for someone else: the notice and the deadlines are theirs to
    // waive (rule B8: a leave recorded after the fact).
    const deadlines = !(approver && userId !== actor.id);
    const span = spanOfInput(input);
    // Rule D2 and edge case 13: nothing new is dated in a closed month.
    await assertMonthsOpen(executor, span.startsOn, span.endsOn);
    const holidays = await this.context.holidaysFrom(
      span.startsOn < today ? span.startsOn : today,
      executor,
    );
    const base = {
      userId,
      kind: input.kind,
      ...span,
      correctionDirection: input.kind === 'correction' ? input.direction : null,
      reason: input.reason,
      approvedAtOnce: approver,
    };
    const plain = {
      leaveType: null,
      days: null,
      paidDays: null,
      unpaidDays: null,
      shortNotice: false,
      certificateRequired: false,
    };

    let evaluated: Evaluated;
    if (input.kind === 'remote_day') {
      // Rules B9 and C19: the work days it covers, from today on, short notice under the setting.
      const days = countWorkDays(addDays(input.startsOn, -1), input.endsOn, subject, holidays);
      if (days === 0) throw notWorkDay();
      if (deadlines && input.startsOn < today) throw tooLate();
      evaluated = {
        ...base,
        ...plain,
        days,
        shortNotice:
          deadlines &&
          countWorkDays(today, input.startsOn, subject, holidays) < settings.remoteNoticeWorkDays,
      };
    } else if (input.kind === 'correction') {
      // Rule C19: a moment that has passed, on a day attendance applies to the employee.
      if (businessInstant(input.date, input.time) > new Date()) {
        throw new CodedException(400, 'NOT_YET', 'A correction is for a moment that has passed');
      }
      if (!(await this.days.appliesOn(executor, userId, input.date))) {
        throw new CodedException(403, 'EXEMPT', 'Attendance does not apply to this day');
      }
      evaluated = { ...base, ...plain };
    } else if (input.kind === 'permission') {
      if (!isScheduleWorkDay(input.date, subject.workWeekdays, holidays)) throw notWorkDay();
      if (deadlines && input.date < today) throw tooLate();
      if (permissionMinutes(input) > settings.permissionMaxMinutes) {
        throw permissionLimit('A permission lasts at most the set minutes');
      }
      const first = `${input.date.slice(0, 7)}-01`;
      const [used] = await executor
        .select({ count: count() })
        .from(hrRequests)
        .where(
          and(
            eq(hrRequests.userId, userId),
            eq(hrRequests.kind, 'permission'),
            inArray(hrRequests.status, [...LIVE_STATUSES]),
            isNull(hrRequests.archivedAt),
            gte(hrRequests.startsOn, first),
            lte(hrRequests.startsOn, lastOfMonth(first)),
          ),
        );
      if ((used?.count ?? 0) >= settings.permissionsPerMonth) {
        throw permissionLimit('No permissions left this month');
      }
      evaluated = { ...base, ...plain };
    } else {
      const counted = await this.countLeave(executor, userId, input, { subject, holidays });
      if (counted.days === 0) throw notWorkDay();
      if (deadlines) checkDeadline(input, subject, holidays, settings, today);
      if (
        input.leaveType === 'annual' &&
        subject.probationEndDate &&
        input.startsOn <= subject.probationEndDate
      ) {
        throw new CodedException(
          409,
          'ON_PROBATION',
          'Annual leave is taken after the probation ends',
        );
      }
      if (input.leaveType === 'annual') {
        for (const [year, paid] of counted.paidByYear) {
          const available = (await this.available(executor, userId, year)).annual;
          if (paid > available) {
            throw new CodedException(
              409,
              'INSUFFICIENT_BALANCE',
              'The annual balance does not cover these days',
              { year, available },
            );
          }
        }
      }
      evaluated = {
        ...base,
        leaveType: input.leaveType,
        days: counted.days,
        paidDays: counted.paidDays,
        unpaidDays: counted.unpaidDays,
        shortNotice:
          deadlines &&
          input.leaveType === 'annual' &&
          countWorkDays(today, input.startsOn, subject, holidays) < settings.annualNoticeWorkDays,
        certificateRequired:
          input.leaveType === 'sick' && counted.days > settings.sickCertificateAfterDays,
      };
    }
    if (input.kind !== 'correction') {
      await this.checkOverlap(executor, userId, { kind: input.kind, ...span });
    }
    return evaluated;
  }

  /**
   * A leave's days and split (rules B11 and B12), the split against the balances of its first
   * year less the user's other pending leaves.
   */
  private async countLeave(
    executor: Executor,
    userId: string,
    leave: {
      leaveType: LeaveType;
      startsOn: CalendarDate;
      endsOn: CalendarDate;
      half: LeaveHalf | null;
      exceptId?: string;
    },
    loaded?: { subject: LeaveSubject; holidays: HolidayRange[] },
  ) {
    const subject = loaded?.subject ?? (await this.context.subject(userId, executor));
    const holidays =
      loaded?.holidays ?? (await this.context.holidaysFrom(leave.startsOn, executor));
    const units = subject ? leaveUnits(leave, subject.workWeekdays, holidays) : [];
    const days = unitDays(units);
    const available = await this.available(
      executor,
      userId,
      yearOf(leave.startsOn),
      leave.exceptId,
    );
    const split = leaveSplit(leave.leaveType, days, available);
    return { days, ...split, paidByYear: paidDaysByYear(units, split.paidDays) };
  }

  /** The balances of `year` less the user's pending leaves (other than `exceptId`). */
  private async available(
    executor: Executor,
    userId: string,
    year: number,
    exceptId?: string,
  ): Promise<Balances> {
    const [balances, pending] = await Promise.all([
      this.ledger.balances(executor, userId, year),
      this.pendingDays(executor, userId, year, exceptId),
    ]);
    return {
      annual: sumDays([balances.annual, -pending.annual]),
      sick: sumDays([balances.sick, -pending.sick]),
      emergency: sumDays([balances.emergency, -pending.emergency]),
    };
  }

  /** Rule B8: no pending or approved request of the user covers the same time. */
  private async checkOverlap(executor: Executor, userId: string, span: RequestSpan): Promise<void> {
    const rows = await executor
      .select()
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.userId, userId),
          // A passkey replacement and a correction are dated, but take no time.
          inArray(hrRequests.kind, ['leave', 'permission', 'remote_day']),
          inArray(hrRequests.status, [...LIVE_STATUSES]),
          isNull(hrRequests.archivedAt),
          lte(hrRequests.startsOn, span.endsOn),
          gte(hrRequests.endsOn, span.startsOn),
        ),
      );
    if (rows.some((row) => requestsOverlap(spanOf(row), span))) {
      throw new CodedException(
        409,
        'REQUEST_OVERLAP',
        'Another pending or approved request covers this time',
      );
    }
  }

  /**
   * Brings an approved leave's ledger rows to its paid days, all of them or (rule B15, `before`)
   * only those before a day.
   */
  private async syncTaken(
    tx: Transaction,
    row: RequestRow,
    actorId: string,
    before?: CalendarDate,
  ): Promise<void> {
    if (row.kind !== 'leave' || !row.leaveType) return;
    const subject = await this.context.subject(row.userId, tx);
    const holidays = await this.context.holidaysFrom(row.startsOn, tx);
    const units = subject ? leaveUnits(row, subject.workWeekdays, holidays) : [];
    const paid = paidDaysByYear(units, row.paidDays ?? 0);
    if (before) {
      for (const [year, days] of paidDaysByYear(units, row.paidDays ?? 0, before)) {
        paid.set(year, sumDays([paid.get(year) ?? 0, -days]));
      }
    }
    await this.ledger.syncRequest(
      tx,
      { id: row.id, userId: row.userId, leaveType: row.leaveType },
      paid,
      actorId,
    );
  }

  /**
   * Rule C14: the attendance days a leave, permission or remote day covers are recomputed; for a
   * correction, its day and the one before (rule C15: an early `out` may close it).
   */
  private async refreshDays(tx: Transaction, row: RequestRow): Promise<void> {
    if (row.kind === 'passkey_replacement') return;
    const dates: CalendarDate[] = row.kind === 'correction' ? [addDays(row.startsOn, -1)] : [];
    for (let date = row.startsOn; date <= row.endsOn; date = addDays(date, 1)) dates.push(date);
    // A correction's punch needs its day, even one the daily job has not created yet.
    await this.days.refresh(tx, row.userId, dates, { create: row.kind === 'correction' });
  }

  /** Rule C19: an approved correction writes its punch at the time asked for. */
  private async writeCorrection(tx: Transaction, row: RequestRow): Promise<void> {
    if (row.kind !== 'correction' || !row.correctionDirection || !row.fromTime) return;
    await tx.insert(attendancePunches).values({
      userId: row.userId,
      direction: row.correctionDirection,
      at: businessInstant(row.startsOn, toTime(row.fromTime) ?? '00:00'),
      method: 'correction',
      requestId: row.id,
    });
  }

  /** The employee of a request, read before taking their lock; 404 when there is none. */
  private async ownerOf(tx: Transaction, id: string): Promise<string> {
    const [row] = await tx
      .select({ userId: hrRequests.userId })
      .from(hrRequests)
      .where(eq(hrRequests.id, id));
    if (!row) throw new NotFoundException();
    return row.userId;
  }

  /** The request, locked; 404 unless the actor may act on it (owner or `hr.approve`). */
  private async locked(tx: Transaction, id: string, actor?: CurrentUserInfo): Promise<RequestRow> {
    const [row] = await tx
      .select()
      .from(hrRequests)
      .where(and(eq(hrRequests.id, id), isNull(hrRequests.archivedAt)))
      .for('update');
    if (!row) throw new NotFoundException();
    if (actor && row.userId !== actor.id && !holdsAll(actor, 'hr.approve')) {
      throw new NotFoundException();
    }
    return row;
  }

  private async readable(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<RequestRow> {
    const [row] = await executor
      .select()
      .from(hrRequests)
      .where(and(eq(hrRequests.id, id), isNull(hrRequests.archivedAt)));
    if (!row) throw new NotFoundException();
    if (row.userId !== actor.id && !(await this.scope.covers(actor, row.userId, executor))) {
      throw new NotFoundException();
    }
    return row;
  }

  private async one(id: string): Promise<HrRequest> {
    const [row] = await this.db.select().from(hrRequests).where(eq(hrRequests.id, id));
    if (!row) throw new NotFoundException();
    const [request] = await this.present(this.db, [row]);
    if (!request) throw new NotFoundException();
    return request;
  }

  private async present(executor: Executor, rows: readonly RequestRow[]): Promise<HrRequest[]> {
    if (rows.length === 0) return [];
    const [people, documents, settings] = await Promise.all([
      this.users.summaries(
        rows.flatMap((row) => [
          row.userId,
          row.createdById,
          ...(row.decidedById ? [row.decidedById] : []),
        ]),
        executor,
      ),
      this.fileVersions.hrRequestDocumentCounts(
        rows.map((row) => row.id),
        executor,
      ),
      this.settings.row(executor),
    ]);
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? '' });
    return rows.map((row) => ({
      id: row.id,
      user: person(row.userId),
      kind: row.kind,
      leaveType: row.leaveType,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      half: row.half,
      fromTime: toTime(row.fromTime),
      toTime: toTime(row.toTime),
      correctionDirection: row.correctionDirection,
      days: row.days,
      paidDays: row.paidDays,
      unpaidDays: row.unpaidDays,
      reason: row.reason,
      shortNotice: row.shortNotice,
      status: row.status,
      certificateRequired:
        row.leaveType === 'sick' && (row.days ?? 0) > settings.sickCertificateAfterDays,
      documents: documents.get(row.id) ?? 0,
      createdBy: person(row.createdById),
      decidedBy: row.decidedById ? person(row.decidedById) : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** Rule B8: the GMs (the holders of `hr.approve`) other than the employee. */
  private async notifySubmitted(tx: Transaction, row: RequestRow): Promise<void> {
    const [profile] = await this.users.profiles({ ids: [row.userId] }, tx);
    await this.center.notify(tx, {
      type: 'hr_request_submitted',
      data: {
        employee: profile?.name ?? '',
        kind: row.kind,
        leaveType: row.leaveType,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      },
      recipients: (await this.users.withRole('general_manager', tx)).filter(
        (id) => id !== row.userId,
      ),
      actorId: row.userId,
      subjectId: row.id,
    });
  }

  private async notifyDecided(
    tx: Transaction,
    row: RequestRow,
    decision: 'approved' | 'rejected' | 'cancelled',
    actorId: string,
  ): Promise<void> {
    if (row.userId === actorId) return;
    await this.center.notify(tx, {
      type: 'hr_request_decided',
      data: {
        decision,
        kind: row.kind,
        leaveType: row.leaveType,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      },
      recipients: [row.userId],
      actorId,
      subjectId: row.id,
    });
  }

  private async resolveSubmitted(
    tx: Transaction,
    id: string,
    outcome: 'done' | 'void',
    actorId: string | null,
  ): Promise<void> {
    await this.center.resolve(tx, {
      subject: { type: 'hr_request', id },
      types: ['hr_request_submitted'],
      outcome,
      actorId,
    });
  }
}

/** Rule B15. */
function cancellable(actor: CurrentUserInfo, row: RequestRow, today: CalendarDate): boolean {
  if (row.status !== 'pending' && row.status !== 'approved') return false;
  // Rule C9: an approved replacement has swapped the passkeys; revoking one is its own action.
  if (row.kind === 'passkey_replacement' && row.status === 'approved') return false;
  if (holdsAll(actor, 'hr.approve')) return true;
  if (row.userId !== actor.id) return false;
  return row.status === 'pending' || row.startsOn > today;
}

/** The user's work days in `(from, to]`. */
function countWorkDays(
  from: CalendarDate,
  to: CalendarDate,
  subject: LeaveSubject,
  holidays: readonly HolidayRange[],
): number {
  let days = 0;
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) {
    if (isScheduleWorkDay(date, subject.workWeekdays, holidays)) days += 1;
  }
  return days;
}

/** The `n`th work day of the user after `date`. */
function nthWorkDayAfter(
  date: CalendarDate,
  n: number,
  subject: LeaveSubject,
  holidays: readonly HolidayRange[],
): CalendarDate {
  let day = date;
  for (let found = 0; found < n && subject.workWeekdays.length > 0; ) {
    day = addDays(day, 1);
    if (isScheduleWorkDay(day, subject.workWeekdays, holidays)) found += 1;
  }
  return day;
}

/**
 * Rule B9: annual and unpaid leave start today or later; emergency leave up to a day back; sick
 * leave up to `sickRequestWithinWorkDays` work days after the employee's return.
 */
function checkDeadline(
  leave: { leaveType: LeaveType; startsOn: CalendarDate; endsOn: CalendarDate },
  subject: LeaveSubject,
  holidays: readonly HolidayRange[],
  settings: SettingsRow,
  today: CalendarDate,
): void {
  const late =
    leave.leaveType === 'sick'
      ? today >
        nthWorkDayAfter(
          nthWorkDayAfter(leave.endsOn, 1, subject, holidays),
          settings.sickRequestWithinWorkDays,
          subject,
          holidays,
        )
      : leave.leaveType === 'emergency'
        ? leave.startsOn < addDays(today, -1)
        : leave.startsOn < today;
  if (late) throw tooLate();
}

const notPending = () => new CodedException(409, 'NOT_PENDING', 'The request is no longer pending');

const notWorkDay = () =>
  new CodedException(400, 'NOT_A_WORK_DAY', 'The request covers no work day');

const tooLate = () => new CodedException(409, 'TOO_LATE', 'Too late to request these days');

const permissionLimit = (message: string) => new CodedException(409, 'PERMISSION_LIMIT', message);

const empty = (query: HrRequestListQuery): HrRequestPage => ({
  items: [],
  total: 0,
  page: query.page,
  pageSize: query.pageSize,
});

/** The span a new request covers (rule B8): a correction is its day and its punch's time. */
function spanOfInput(input: CreateHrRequest): Omit<RequestSpan, 'kind'> {
  switch (input.kind) {
    case 'leave':
      return {
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        half: input.half,
        fromTime: null,
        toTime: null,
      };
    case 'remote_day':
      return {
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        half: null,
        fromTime: null,
        toTime: null,
      };
    case 'correction':
      return {
        startsOn: input.date,
        endsOn: input.date,
        half: null,
        fromTime: input.time,
        toTime: null,
      };
    default:
      return {
        startsOn: input.date,
        endsOn: input.date,
        half: null,
        fromTime: input.fromTime,
        toTime: input.toTime,
      };
  }
}

export function toOpinion(row: typeof hrOpinions.$inferSelect, authorName: string): HrOpinion {
  return {
    id: row.id,
    requestId: row.requestId,
    itemId: row.itemId,
    author: { id: row.authorId, name: authorName },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
