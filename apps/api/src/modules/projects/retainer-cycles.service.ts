import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  type CreateCycleAdjustment,
  type CreateCycleLine,
  type Cycle,
  type CycleDetail,
  type CycleLine,
  type CycleListQuery,
  type CyclePage,
  type CycleStatus,
  type DeliverableKind,
  deliverableKey,
  deliveryRate,
  firstOfMonth,
  isLineBehind,
  lastOfMonth,
  RETAINER_CYCLES_JOB,
  RETAINER_LIMITS,
  type RetainerStatus,
  type UpdateCycleLine,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerCycleAdjustments,
  retainerCycleLines,
  retainerCycles,
  retainerDeliverables,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, inArray, isNull, lt, max, sql, sum } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { CycleOpenedHooks } from './cycle-opened-hooks.js';
import { actorOf } from './project-access.js';
import { readableRetainer, workableRetainer } from './retainer-access.js';
import { NO_TASKS, WorkProgress } from './work-progress.js';

type Executor = Database | Transaction;

const cycleColumns = {
  id: retainerCycles.id,
  retainerId: retainerCycles.retainerId,
  month: retainerCycles.month,
  periodStart: retainerCycles.periodStart,
  periodEnd: retainerCycles.periodEnd,
  status: retainerCycles.status,
  closedAt: retainerCycles.closedAt,
};

export interface CycleRow {
  id: string;
  retainerId: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  status: CycleStatus;
  closedAt: Date | null;
}

const lineColumns = {
  id: retainerCycleLines.id,
  cycleId: retainerCycleLines.cycleId,
  deliverableId: retainerCycleLines.deliverableId,
  kind: retainerCycleLines.kind,
  label: retainerCycleLines.label,
  committedQuantity: retainerCycleLines.committedQuantity,
  deliveredAtClose: retainerCycleLines.deliveredAtClose,
  position: retainerCycleLines.position,
};

interface LineRow {
  id: string;
  cycleId: string;
  deliverableId: string | null;
  kind: DeliverableKind;
  label: string | null;
  committedQuantity: number;
  deliveredAtClose: number | null;
  position: number;
}

const later = (a: string, b: string) => (a > b ? a : b);

/**
 * Monthly cycles of retainers (spec F05 R2–R9, ADR 0015): opening and closing them, the
 * deliverables counter, and the daily `retainers.cycles` job that `apps/worker` schedules.
 */
@Injectable()
export class RetainerCyclesService implements OnModuleInit {
  private readonly logger = new Logger(RetainerCyclesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly progress: WorkProgress,
    private readonly jobs: JobQueue,
    private readonly openedHooks: CycleOpenedHooks,
  ) {}

  onModuleInit(): void {
    this.jobs.work(RETAINER_CYCLES_JOB.queue, async () => {
      const result = await this.runDaily();
      this.logger.log(`Retainer cycles: ${result.closed} closed, ${result.opened} opened`);
    });
  }

  /**
   * R2: for every non-archived retainer of a non-archived client, closes open cycles that ended
   * before `today` and opens the current month's for an active, started retainer. Idempotent.
   */
  async runDaily(today: string = businessDate()): Promise<{ closed: number; opened: number }> {
    const candidates = await this.db
      .select({ id: retainers.id })
      .from(retainers)
      .where(and(isNull(retainers.archivedAt), this.clients.isLive(retainers.clientId)))
      .orderBy(asc(retainers.id));
    let closed = 0;
    let opened = 0;
    for (const { id } of candidates) {
      await this.db.transaction(async (tx) => {
        // An opening cycle may assign its tasks (F07 rule 16); taken before the retainer lock.
        await lockAccessChanges(tx);
        const [retainer] = await tx
          .select({
            status: retainers.status,
            startDate: retainers.startDate,
            archivedAt: retainers.archivedAt,
            clientId: retainers.clientId,
          })
          .from(retainers)
          .where(eq(retainers.id, id))
          .for('update');
        if (!retainer || retainer.archivedAt) return;
        const client = await this.clients.summary(retainer.clientId, tx);
        if (!client || client.archived) return;
        const ended = await tx
          .select(cycleColumns)
          .from(retainerCycles)
          .where(
            and(
              eq(retainerCycles.retainerId, id),
              eq(retainerCycles.status, 'open'),
              lt(retainerCycles.periodEnd, today),
            ),
          );
        for (const cycle of ended) {
          await this.close(tx, cycle, null);
          closed += 1;
        }
        if (retainer.status === 'active' && retainer.startDate <= today) {
          if (await this.open(tx, id, retainer.startDate, today, null)) opened += 1;
        }
      });
    }
    return { closed, opened };
  }

  /**
   * R3, R4: opens the retainer's cycle for the month of `today` unless one exists, copying the
   * retainer's lines with their full quantities. The period starts on the 1st or on `from`,
   * whichever is later, then runs the `CycleOpenedHooks` in the same transaction (F07 rule 16).
   * Returns the new cycle's id, or null when the month already has one.
   */
  async open(
    tx: Transaction,
    retainerId: string,
    from: string,
    today: string,
    actor: AuditActor | null,
  ): Promise<string | null> {
    const month = firstOfMonth(today);
    const period = { periodStart: later(from, month), periodEnd: lastOfMonth(today) };
    const [created] = await tx
      .insert(retainerCycles)
      .values({ retainerId, month, ...period })
      .onConflictDoNothing({ target: [retainerCycles.retainerId, retainerCycles.month] })
      .returning({ id: retainerCycles.id });
    if (!created) return null;
    const standing = await tx
      .select({
        id: retainerDeliverables.id,
        kind: retainerDeliverables.kind,
        label: retainerDeliverables.label,
        monthlyQuantity: retainerDeliverables.monthlyQuantity,
      })
      .from(retainerDeliverables)
      .where(
        and(
          eq(retainerDeliverables.retainerId, retainerId),
          isNull(retainerDeliverables.archivedAt),
        ),
      )
      .orderBy(asc(retainerDeliverables.position), asc(retainerDeliverables.id));
    const lines = standing.map((line, index) => ({
      cycleId: created.id,
      deliverableId: line.id,
      kind: line.kind,
      label: line.label,
      committedQuantity: line.monthlyQuantity,
      position: index + 1,
    }));
    if (lines.length > 0) await tx.insert(retainerCycleLines).values(lines);
    await recordAudit(tx, {
      actor,
      action: 'retainer_cycle.created',
      entityType: 'retainer_cycle',
      entityId: created.id,
      after: {
        month,
        ...period,
        lines: lines.map(({ kind, label, committedQuantity }) => ({
          kind,
          label,
          committed: committedQuantity,
        })),
        retainerId,
      },
    });
    await this.openedHooks.run(tx, { cycleId: created.id, retainerId, today, actor });
    return created.id;
  }

  /** R5: ending closes every open cycle; the current one ends `today`. */
  async closeAll(tx: Transaction, retainerId: string, today: string, actor: AuditActor) {
    const openCycles = await tx
      .select(cycleColumns)
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainerId), eq(retainerCycles.status, 'open')));
    for (const cycle of openCycles) await this.close(tx, cycle, actor, today);
  }

  /**
   * R8: freezes each line's delivered count and closes the cycle. `endOn` shortens the period
   * when the retainer ends before the month does.
   */
  private async close(
    tx: Transaction,
    cycle: CycleRow,
    actor: AuditActor | null,
    endOn?: string,
  ): Promise<void> {
    const lines = await this.lineRows([cycle.id], tx);
    const delivered = await this.liveDelivered(
      lines.map((line) => line.id),
      tx,
    );
    for (const line of lines) {
      await tx
        .update(retainerCycleLines)
        .set({ deliveredAtClose: delivered.get(line.id) ?? 0 })
        .where(eq(retainerCycleLines.id, line.id));
    }
    const periodEnd =
      endOn && endOn < cycle.periodEnd ? later(endOn, cycle.periodStart) : cycle.periodEnd;
    await tx
      .update(retainerCycles)
      .set({ status: 'closed', closedAt: new Date(), periodEnd })
      .where(eq(retainerCycles.id, cycle.id));
    await recordAudit(tx, {
      actor,
      action: 'retainer_cycle.closed',
      entityType: 'retainer_cycle',
      entityId: cycle.id,
      before: { status: 'open', periodEnd: cycle.periodEnd },
      after: {
        status: 'closed',
        periodEnd,
        lines: lines.map((line) => ({
          kind: line.kind,
          label: line.label,
          committed: line.committedQuantity,
          delivered: delivered.get(line.id) ?? 0,
        })),
        retainerId: cycle.retainerId,
      },
    });
  }

  /** The newest open cycle of each retainer, as the API returns it. */
  async current(
    retainerRows: { id: string; status: RetainerStatus }[],
    executor: Executor = this.db,
  ): Promise<Map<string, Cycle>> {
    if (retainerRows.length === 0) return new Map();
    const rows = await executor
      .select(cycleColumns)
      .from(retainerCycles)
      .where(
        and(
          inArray(
            retainerCycles.retainerId,
            retainerRows.map((row) => row.id),
          ),
          eq(retainerCycles.status, 'open'),
        ),
      )
      .orderBy(desc(retainerCycles.month));
    const newest = new Map<string, CycleRow>();
    for (const row of rows) if (!newest.has(row.retainerId)) newest.set(row.retainerId, row);
    const statuses = new Map(retainerRows.map((row) => [row.id, row.status]));
    const cycles = await this.present([...newest.values()], statuses, executor);
    return new Map(cycles.map((cycle) => [cycle.retainerId, cycle]));
  }

  async list(
    actor: CurrentUserInfo,
    retainerId: string,
    query: CycleListQuery,
  ): Promise<CyclePage> {
    const retainer = await readableRetainer(this.db, this.clients, actor, retainerId);
    const where = eq(retainerCycles.retainerId, retainerId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select(cycleColumns)
        .from(retainerCycles)
        .where(where)
        .orderBy(desc(retainerCycles.month))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(retainerCycles).where(where),
    ]);
    return {
      items: await this.present(rows, new Map([[retainerId, retainer.status]])),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(actor: CurrentUserInfo, retainerId: string, cycleId: string): Promise<CycleDetail> {
    const retainer = await readableRetainer(this.db, this.clients, actor, retainerId);
    const row = await this.cycle(this.db, retainerId, cycleId);
    const [cycle] = await this.present([row], new Map([[retainerId, retainer.status]]));
    if (!cycle) throw new NotFoundException();
    const lineIds = cycle.lines.map((line) => line.id);
    const adjustments = lineIds.length
      ? await this.db
          .select({
            id: retainerCycleAdjustments.id,
            lineId: retainerCycleAdjustments.lineId,
            delta: retainerCycleAdjustments.delta,
            reason: retainerCycleAdjustments.reason,
            authorId: retainerCycleAdjustments.authorId,
            createdAt: retainerCycleAdjustments.createdAt,
          })
          .from(retainerCycleAdjustments)
          .where(inArray(retainerCycleAdjustments.lineId, lineIds))
          .orderBy(desc(retainerCycleAdjustments.createdAt), desc(retainerCycleAdjustments.id))
      : [];
    const authors = await this.users.summaries(adjustments.map((entry) => entry.authorId));
    return {
      ...cycle,
      lines: cycle.lines.map((line) => ({
        ...line,
        adjustments: adjustments
          .filter((entry) => entry.lineId === line.id)
          .map((entry) => ({
            id: entry.id,
            delta: entry.delta,
            reason: entry.reason,
            author: { id: entry.authorId, name: authors.get(entry.authorId)?.name ?? '' },
            createdAt: entry.createdAt.toISOString(),
          })),
      })),
    };
  }

  /** R9: an open cycle's committed quantity, with a reason. */
  async updateLine(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    lineId: string,
    input: UpdateCycleLine,
  ): Promise<CycleLine> {
    await this.db.transaction(async (tx) => {
      await workableRetainer(tx, this.clients, actor, retainerId);
      await this.openCycle(tx, retainerId, cycleId);
      const line = await this.line(tx, cycleId, lineId);
      if (line.committedQuantity === input.committedQuantity) return;
      await tx
        .update(retainerCycleLines)
        .set({ committedQuantity: input.committedQuantity })
        .where(eq(retainerCycleLines.id, lineId));
      await this.audit(tx, actor, 'retainer_cycle.line_updated', cycleId, retainerId, {
        before: { lineId, kind: line.kind, label: line.label, committed: line.committedQuantity },
        after: {
          lineId,
          kind: line.kind,
          label: line.label,
          committed: input.committedQuantity,
          reason: input.reason,
        },
      });
    });
    return this.presentLine(actor, retainerId, cycleId, lineId);
  }

  /** R9: a line for this cycle only, with a reason. */
  async addLine(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    input: CreateCycleLine,
  ): Promise<CycleLine> {
    const id = await this.db.transaction(async (tx) => {
      await workableRetainer(tx, this.clients, actor, retainerId);
      await this.openCycle(tx, retainerId, cycleId);
      const lines = await this.lineRows([cycleId], tx);
      if (lines.length >= RETAINER_LIMITS.cycleLines) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A cycle holds at most 30 lines');
      }
      const label = input.label ?? null;
      const key = deliverableKey({ kind: input.kind, label });
      if (lines.some((line) => deliverableKey(line) === key)) {
        throw new CodedException(409, 'DUPLICATE_DELIVERABLE', 'The cycle has this line already');
      }
      const [top] = await tx
        .select({ value: max(retainerCycleLines.position) })
        .from(retainerCycleLines)
        .where(eq(retainerCycleLines.cycleId, cycleId));
      const [created] = await tx
        .insert(retainerCycleLines)
        .values({
          cycleId,
          kind: input.kind,
          label,
          committedQuantity: input.committedQuantity,
          position: (top?.value ?? 0) + 1,
        })
        .returning({ id: retainerCycleLines.id });
      if (!created) throw new Error('Cycle line insert returned no row');
      await this.audit(tx, actor, 'retainer_cycle.line_added', cycleId, retainerId, {
        after: {
          lineId: created.id,
          kind: input.kind,
          label,
          committed: input.committedQuantity,
          reason: input.reason,
        },
      });
      return created.id;
    });
    return this.presentLine(actor, retainerId, cycleId, id);
  }

  /** R7: a reasoned correction of the delivered count; it never makes it negative. */
  async adjust(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    lineId: string,
    input: CreateCycleAdjustment,
  ): Promise<CycleLine> {
    await this.db.transaction(async (tx) => {
      await workableRetainer(tx, this.clients, actor, retainerId);
      // The cycle row lock serializes adjustments, so the negative check sees every earlier one.
      await this.openCycle(tx, retainerId, cycleId);
      const line = await this.line(tx, cycleId, lineId);
      const [existing] = await tx
        .select({ value: count() })
        .from(retainerCycleAdjustments)
        .where(eq(retainerCycleAdjustments.lineId, lineId));
      if ((existing?.value ?? 0) >= RETAINER_LIMITS.adjustmentsPerLine) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A line holds at most 100 adjustments');
      }
      const before = (await this.liveDelivered([lineId], tx)).get(lineId) ?? 0;
      const after = before + input.delta;
      if (after < 0) {
        throw new CodedException(409, 'NEGATIVE_DELIVERED', 'Delivered cannot go below zero');
      }
      await tx
        .insert(retainerCycleAdjustments)
        .values({ lineId, delta: input.delta, reason: input.reason, authorId: actor.id });
      await this.audit(tx, actor, 'retainer_cycle.adjusted', cycleId, retainerId, {
        before: { lineId, kind: line.kind, label: line.label, delivered: before },
        after: {
          lineId,
          kind: line.kind,
          label: line.label,
          delivered: after,
          delta: input.delta,
          reason: input.reason,
        },
      });
    });
    return this.presentLine(actor, retainerId, cycleId, lineId);
  }

  /** Whether the retainer has had any cycle (its start date is then fixed). */
  async hasCycles(tx: Transaction, retainerId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .where(eq(retainerCycles.retainerId, retainerId))
      .limit(1);
    return !!row;
  }

  /** Cycles as the API returns them, with the counter (R7, R8, R11, R13). */
  private async present(
    cycles: CycleRow[],
    statuses: Map<string, RetainerStatus>,
    executor: Executor = this.db,
  ): Promise<Cycle[]> {
    const lines = await this.lineRows(
      cycles.map((cycle) => cycle.id),
      executor,
    );
    const lineIds = lines.map((line) => line.id);
    const [live, tasks] = await Promise.all([
      this.liveDelivered(lineIds, executor),
      this.progress.cycleLines(lineIds),
    ]);
    const today = businessDate();
    return cycles.map((cycle) => {
      const open = cycle.status === 'open';
      const counting = open && statuses.get(cycle.retainerId) === 'active';
      const presented: CycleLine[] = lines
        .filter((line) => line.cycleId === cycle.id)
        .map((line) => {
          const now = live.get(line.id) ?? 0;
          const frozen = line.deliveredAtClose ?? 0;
          const delivered = open ? Math.max(0, now) : frozen;
          return {
            id: line.id,
            cycleId: line.cycleId,
            deliverableId: line.deliverableId,
            kind: line.kind,
            label: line.label,
            position: line.position,
            committed: line.committedQuantity,
            delivered,
            deliveredAfterClose: open ? 0 : Math.max(0, now - frozen),
            behind:
              counting &&
              isLineBehind({ committed: line.committedQuantity, delivered }, cycle, today),
            tasks: tasks.get(line.id) ?? NO_TASKS,
          };
        });
      return {
        id: cycle.id,
        retainerId: cycle.retainerId,
        month: cycle.month,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        status: cycle.status,
        closedAt: cycle.closedAt?.toISOString() ?? null,
        deliveryRate: deliveryRate(presented),
        behind: presented.some((line) => line.behind),
        lines: presented,
      };
    });
  }

  private async presentLine(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    lineId: string,
  ): Promise<CycleLine> {
    const retainer = await readableRetainer(this.db, this.clients, actor, retainerId);
    const row = await this.cycle(this.db, retainerId, cycleId);
    const [cycle] = await this.present([row], new Map([[retainerId, retainer.status]]));
    const line = cycle?.lines.find((candidate) => candidate.id === lineId);
    if (!line) throw new NotFoundException();
    return line;
  }

  /** R7: delivered tasks linked to each line + the sum of its adjustments. */
  private async liveDelivered(lineIds: string[], executor: Executor) {
    if (lineIds.length === 0) return new Map<string, number>();
    const [sums, tasks] = await Promise.all([
      executor
        .select({
          lineId: retainerCycleAdjustments.lineId,
          total: sql<number>`${sum(retainerCycleAdjustments.delta)}::int`,
        })
        .from(retainerCycleAdjustments)
        .where(inArray(retainerCycleAdjustments.lineId, lineIds))
        .groupBy(retainerCycleAdjustments.lineId),
      this.progress.cycleLines(lineIds),
    ]);
    const adjusted = new Map(sums.map((row) => [row.lineId, Number(row.total)]));
    return new Map(
      lineIds.map((id) => [id, (tasks.get(id)?.delivered ?? 0) + (adjusted.get(id) ?? 0)]),
    );
  }

  private lineRows(cycleIds: string[], executor: Executor): Promise<LineRow[]> {
    if (cycleIds.length === 0) return Promise.resolve([]);
    return executor
      .select(lineColumns)
      .from(retainerCycleLines)
      .where(inArray(retainerCycleLines.cycleId, cycleIds))
      .orderBy(asc(retainerCycleLines.position), asc(retainerCycleLines.id));
  }

  /** A cycle of the retainer, else 404. */
  private async cycle(
    executor: Executor,
    retainerId: string,
    cycleId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<CycleRow> {
    const query = executor
      .select(cycleColumns)
      .from(retainerCycles)
      .where(and(eq(retainerCycles.id, cycleId), eq(retainerCycles.retainerId, retainerId)));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Locks an open cycle of the retainer (R9: `CYCLE_CLOSED` otherwise). */
  private async openCycle(tx: Transaction, retainerId: string, cycleId: string) {
    const cycle = await this.cycle(tx, retainerId, cycleId, { forUpdate: true });
    if (cycle.status !== 'open') {
      throw new CodedException(409, 'CYCLE_CLOSED', 'A closed cycle cannot change');
    }
    return cycle;
  }

  private async line(tx: Transaction, cycleId: string, lineId: string): Promise<LineRow> {
    const [row] = await tx
      .select(lineColumns)
      .from(retainerCycleLines)
      .where(and(eq(retainerCycleLines.id, lineId), eq(retainerCycleLines.cycleId, cycleId)));
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Cycle entries carry the retainer, so the audit log links them to its page. */
  private audit(
    tx: Transaction,
    actor: CurrentUserInfo,
    action: 'retainer_cycle.line_updated' | 'retainer_cycle.line_added' | 'retainer_cycle.adjusted',
    cycleId: string,
    retainerId: string,
    change: { before?: Record<string, unknown>; after: Record<string, unknown> },
  ) {
    return recordAudit(tx, {
      actor: actorOf(actor),
      action,
      entityType: 'retainer_cycle',
      entityId: cycleId,
      before: change.before ?? null,
      after: { ...change.after, retainerId },
    });
  }
}
