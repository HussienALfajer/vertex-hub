import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AttendanceItem,
  type AttendanceItemDetail,
  type AttendanceItemListQuery,
  type AttendanceItemPage,
  type CreateHrOpinion,
  type DecideItem,
  type HrOpinion,
  itemOutcome,
  type JustifyItem,
  lastOfMonth,
  overtimeCreditDays,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendanceItems,
  type Database,
  hrOpinions,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceItems, type ItemRow } from './attendance-items.js';
import { holdsAll } from './employee-access.js';
import { toOpinion } from './hr-requests.service.js';
import { HrScope, reaches } from './hr-scope.js';
import { HrSettingsService } from './hr-settings.service.js';
import { LeaveLedger, lockLeave } from './leave-ledger.js';

type Executor = Database | Transaction;

type DayRow = typeof attendanceDays.$inferSelect;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const notPending = () => new CodedException(409, 'NOT_PENDING', 'The item is no longer pending');

/**
 * The attendance items as people act on them (rules C17 and C18): the employee reads their own
 * and justifies a pending one; `hr.read` reads those it covers and gives opinions; `hr.approve`
 * decides, and may change a decision while the month is open (a changed `time_off` gives its
 * credit back). A holder of `hr.approve` decides their own items too ("Roles and access").
 */
@Injectable()
export class AttendanceItemsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly scope: HrScope,
    private readonly settings: HrSettingsService,
    private readonly ledger: LeaveLedger,
    private readonly items: AttendanceItems,
    private readonly attendance: AttendanceService,
  ) {}

  /** `GET /items`: one's own, and those `hr.read` covers, by the date of their day. */
  async list(actor: CurrentUserInfo, query: AttendanceItemListQuery): Promise<AttendanceItemPage> {
    const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    const reach = await this.scope.reach(actor);
    const filters: SQL[] = [];
    const userId = query.userId === 'me' ? actor.id : query.userId;
    if (userId) {
      if (userId !== actor.id && !reaches(reach, userId)) return empty;
      filters.push(eq(attendanceItems.userId, userId));
    } else if (!reach) {
      filters.push(eq(attendanceItems.userId, actor.id));
    } else if (!reach.all) {
      filters.push(inArray(attendanceItems.userId, [...reach.userIds, actor.id]));
    }
    if (query.departmentId) {
      const members = await this.users.profiles({ departmentId: query.departmentId });
      if (members.length === 0) return empty;
      filters.push(
        inArray(
          attendanceItems.userId,
          members.map((member) => member.id),
        ),
      );
    }
    if (query.status) filters.push(inArray(attendanceItems.status, query.status));
    if (query.kind) filters.push(eq(attendanceItems.kind, query.kind));
    if (query.month) {
      const first = `${query.month}-01`;
      filters.push(gte(attendanceDays.date, first), lte(attendanceDays.date, lastOfMonth(first)));
    }
    const where = and(...filters);
    const order = query.order === 'asc' ? asc : desc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ item: attendanceItems, date: attendanceDays.date })
        .from(attendanceItems)
        .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
        .where(where)
        .orderBy(order(attendanceDays.date), order(attendanceItems.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ count: count() })
        .from(attendanceItems)
        .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
        .where(where),
    ]);
    return {
      items: await this.present(this.db, rows),
      total: total?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** `GET /items/:id`: the owner's, or one `hr.read` covers; 404 otherwise. */
  async detail(actor: CurrentUserInfo, id: string): Promise<AttendanceItemDetail> {
    const { item, day } = await this.readable(this.db, actor, id);
    const [presented] = await this.present(this.db, [{ item, date: day.date }]);
    const [presentedDay] = await this.attendance.presentDays(this.db, item.userId, [day]);
    if (!presented || !presentedDay) throw new NotFoundException();
    const opinionRows = await this.db
      .select()
      .from(hrOpinions)
      .where(eq(hrOpinions.itemId, id))
      .orderBy(asc(hrOpinions.createdAt), asc(hrOpinions.id));
    const authors = await this.users.summaries(opinionRows.map((opinion) => opinion.authorId));
    const covers = await this.scope.covers(actor, item.userId);
    const pending = item.status === 'pending';
    return {
      ...presented,
      day: presentedDay,
      opinions: opinionRows.map((opinion) =>
        toOpinion(opinion, authors.get(opinion.authorId)?.name ?? ''),
      ),
      permissions: {
        canDecide: holdsAll(actor, 'hr.approve') && item.status !== 'void',
        canJustify: item.userId === actor.id && pending,
        canGiveOpinion: covers && item.userId !== actor.id && pending,
      },
    };
  }

  /** `POST /items/:id/justification` (rule C17): the employee, until the item is decided. */
  async justify(actor: CurrentUserInfo, id: string, input: JustifyItem): Promise<AttendanceItem> {
    await this.db.transaction(async (tx) => {
      const item = await this.locked(tx, id);
      if (item.userId !== actor.id) throw new NotFoundException();
      if (item.status !== 'pending') throw notPending();
      await tx
        .update(attendanceItems)
        .set({ justification: input.text, justifiedAt: new Date() })
        .where(eq(attendanceItems.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'attendance_item.justified',
        entityType: 'attendance_item',
        entityId: id,
        before: { justification: item.justification },
        after: { justification: input.text },
      });
      await this.center.resolve(tx, {
        subject: { type: 'attendance_item', id },
        types: ['attendance_item_raised'],
        outcome: 'done',
        actorId: actor.id,
      });
    });
    return this.one(id);
  }

  /** `POST /items/:id/decision` (rule C18): `hr.approve`, on an item that is not void. */
  async decide(actor: CurrentUserInfo, id: string, input: DecideItem): Promise<AttendanceItem> {
    await this.db.transaction(async (tx) => {
      const owner = await this.ownerOf(tx, id);
      await lockLeave(tx, owner);
      const item = await this.locked(tx, id);
      if (item.status === 'void') throw notPending();
      const outcome = itemOutcome(item, input);
      if (!outcome) {
        throw new CodedException(400, 'INVALID_DECISION', 'This decision does not fit this item');
      }
      const date = await this.dateOf(tx, item);
      await this.items.reverseCredit(tx, item, date, actor.id);
      let creditedDays: number | null = null;
      if (outcome.status === 'time_off' && outcome.decidedMinutes) {
        const settings = await this.settings.row(tx);
        creditedDays = overtimeCreditDays(
          outcome.decidedMinutes,
          settings.overtimeMinutesPerLeaveDay,
        );
        if (creditedDays > 0) {
          await this.ledger.insert(tx, [
            {
              userId: item.userId,
              leaveType: 'annual',
              year: Number(date.slice(0, 4)),
              days: creditedDays,
              entry: 'overtime_credit',
              itemId: item.id,
              createdById: actor.id,
            },
          ]);
        }
      }
      const after = {
        status: outcome.status,
        decidedFraction: outcome.decidedFraction,
        decidedMinutes: outcome.decidedMinutes,
        creditedDays,
        decisionNote: input.note,
      };
      await tx
        .update(attendanceItems)
        .set({ ...after, decidedById: actor.id, decidedAt: new Date() })
        .where(eq(attendanceItems.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'attendance_item.decided',
        entityType: 'attendance_item',
        entityId: id,
        before: {
          status: item.status,
          decidedFraction: item.decidedFraction,
          decidedMinutes: item.decidedMinutes,
          creditedDays: item.creditedDays,
        },
        // "Roles and access": an approver deciding their own item needs no one else.
        after: { ...after, ...(item.userId === actor.id && { ownItem: true }) },
      });
      if (item.status === 'pending') await this.items.settle(tx, item, 'done', actor.id);
      if (item.userId !== actor.id) {
        await this.center.notify(tx, {
          type: 'attendance_item_decided',
          data: { kind: item.kind, date, decision: outcome.status },
          recipients: [item.userId],
          actorId: actor.id,
          subjectId: id,
        });
      }
    });
    return this.one(id);
  }

  /** `POST /opinions` on an item (rule B14): `hr.read` covering the employee, while pending. */
  async opine(actor: CurrentUserInfo, input: CreateHrOpinion): Promise<HrOpinion> {
    const row = await this.db.transaction(async (tx) => {
      const item = await this.locked(tx, input.itemId ?? '');
      if (item.userId === actor.id || !(await this.scope.covers(actor, item.userId, tx))) {
        throw new NotFoundException();
      }
      if (item.status !== 'pending') throw notPending();
      const [opinion] = await tx
        .insert(hrOpinions)
        .values({ itemId: item.id, authorId: actor.id, body: input.body })
        .returning();
      if (!opinion) throw new Error('Opinion insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_opinion.created',
        entityType: 'hr_opinion',
        entityId: opinion.id,
        after: { itemId: item.id, body: input.body },
      });
      return opinion;
    });
    return toOpinion(row, actor.name);
  }

  private async one(id: string): Promise<AttendanceItem> {
    const [row] = await this.db
      .select({ item: attendanceItems, date: attendanceDays.date })
      .from(attendanceItems)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
      .where(eq(attendanceItems.id, id));
    const [item] = row ? await this.present(this.db, [row]) : [];
    if (!item) throw new NotFoundException();
    return item;
  }

  private async readable(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<{ item: ItemRow; day: DayRow }> {
    const [row] = await executor
      .select({ item: attendanceItems, day: attendanceDays })
      .from(attendanceItems)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
      .where(eq(attendanceItems.id, id));
    if (!row) throw new NotFoundException();
    if (
      row.item.userId !== actor.id &&
      !(await this.scope.covers(actor, row.item.userId, executor))
    ) {
      throw new NotFoundException();
    }
    return row;
  }

  /** The employee of an item, read before taking their lock; 404 when there is none. */
  private async ownerOf(tx: Transaction, id: string): Promise<string> {
    const [row] = await tx
      .select({ userId: attendanceItems.userId })
      .from(attendanceItems)
      .where(eq(attendanceItems.id, id));
    if (!row) throw new NotFoundException();
    return row.userId;
  }

  private async locked(tx: Transaction, id: string): Promise<ItemRow> {
    const [row] = await tx
      .select()
      .from(attendanceItems)
      .where(eq(attendanceItems.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  private async dateOf(tx: Transaction, item: ItemRow): Promise<string> {
    const [day] = await tx
      .select({ date: attendanceDays.date })
      .from(attendanceDays)
      .where(eq(attendanceDays.id, item.dayId));
    if (!day) throw new NotFoundException();
    return day.date;
  }

  private async present(
    executor: Executor,
    rows: readonly { item: ItemRow; date: string }[],
  ): Promise<AttendanceItem[]> {
    if (rows.length === 0) return [];
    const people = await this.users.summaries(
      rows.flatMap(({ item }) => [item.userId, ...(item.decidedById ? [item.decidedById] : [])]),
      executor,
    );
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? '' });
    return rows.map(({ item, date }) => ({
      id: item.id,
      user: person(item.userId),
      dayId: item.dayId,
      date,
      kind: item.kind,
      minutes: item.minutes,
      proposedFraction: item.proposedFraction,
      justification: item.justification,
      justifiedAt: item.justifiedAt?.toISOString() ?? null,
      status: item.status,
      decidedFraction: item.decidedFraction,
      decidedMinutes: item.decidedMinutes,
      creditedDays: item.creditedDays,
      decidedBy: item.decidedById ? person(item.decidedById) : null,
      decidedAt: item.decidedAt?.toISOString() ?? null,
      decisionNote: item.decisionNote,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }));
  }
}
