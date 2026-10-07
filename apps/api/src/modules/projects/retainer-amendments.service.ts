import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Amendment,
  type AmendmentEffect,
  type AmendmentListQuery,
  type AmendmentPage,
  type AmendmentPreview,
  type ApproveAmendment,
  amendmentMoneyDelta,
  amendmentNeedsApproval,
  businessDate,
  type CalendarDate,
  type CreateAmendment,
  type DeliverableKind,
  deliverableKey,
  duplicateDeliverables,
  firstOfMonth,
  hasPermission,
  type MonthEffect,
  type PendingAmendmentListQuery,
  planMonthChange,
  RETAINER_LIMITS,
  type RejectAmendment,
  type RescheduleTerm,
  type RetainerAmendmentPage,
  termMonths,
} from '@vertex-hub/contracts';
import {
  type AmendmentEffectRow,
  type Database,
  retainerAmendmentLines,
  retainerAmendments,
  retainerCharges,
  retainerCycleLines,
  retainerCycles,
  retainerDeliverables,
  retainers,
  retainerTerms,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, inArray, isNull, lte, max, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { ChargeInvoices } from './charge-invoices.js';
import { actorOf, assertCanEditMoney, coversClient, seesMoney } from './project-access.js';
import { QuoteRenewalHooks } from './quote-renewal-hooks.js';
import { type RetainerAccess, readableRetainer, workableRetainer } from './retainer-access.js';
import { RetainerCharges } from './retainer-charges.js';

type Executor = Database | Transaction;

/** What planning reads of the retainer the caller locked. */
type PlannedRetainer = Pick<RetainerAccess, 'id' | 'status' | 'archivedAt' | 'startDate'> & {
  /** Set from the API; the job skips retainers of archived clients itself. */
  client?: { archived: boolean };
};

type AmendmentRow = typeof retainerAmendments.$inferSelect;

type LineRow = typeof retainerAmendmentLines.$inferSelect;

/** A line an amendment stores: a change (`quantityDelta`) or a quote's new quantity. */
interface AmendmentLineInput {
  kind: DeliverableKind;
  label?: string | null;
  quantityDelta?: number | null;
  quantity?: number | null;
  revisionLimit?: number | null;
}

/** What an accepted quote renews a retainer with (F04 A7, F05B Q2). */
export interface QuoteRenewalInput {
  quoteId: string;
  /** The month it takes effect in: after the active term, else next month. */
  effectiveMonth: CalendarDate;
  /** The quote's monthly net: the open-ended fee from that month. */
  feeMinor: number;
  /** The monthly template to link in that month; null keeps the retainer's. */
  templateId: string | null;
  /** The quote's merged lines, which replace the standing lines. */
  lines: {
    kind: DeliverableKind;
    label: string | null;
    monthlyQuantity: number;
    revisionLimit: number | null;
  }[];
  reason: string;
}

/** What a `change` amendment asks for (A1–A3). */
type ChangeInput = Pick<CreateAmendment, 'scope' | 'effectiveMonth' | 'lines' | 'amountDeltaMinor'>;

interface MonthlyCharge {
  id: string;
  month: CalendarDate;
  amountMinor: number;
  dueAt: Date | null;
}

/** One month's amount change: on its monthly charge, or a charge the apply creates. */
interface MonthPlan {
  charge: MonthlyCharge | null;
  effect: MonthEffect;
  /** A term month (an onward change moves its base, A3). */
  termMonth: boolean;
  /** Without a charge: the amount the apply creates it at (the fee plus the change). */
  createMinor: number;
}

/** A line change on the standing lines or on a cycle (A2). */
interface LinePlan {
  kind: DeliverableKind;
  label: string | null;
  /** The existing line, if any. */
  id: string | null;
  quantity: number;
  revisionLimit: number | null;
}

/** What applying a `change` amendment does, worked out against the current state. */
interface ChangePlan {
  months: MonthPlan[];
  fee: { beforeMinor: number; afterMinor: number } | null;
  standing: LinePlan[];
  /** The effective month's cycle, when it has one; null: no cycle yet. */
  cycle: { id: string; lines: LinePlan[] } | null;
  /** A month-scope line change on a month that began without a cycle (edge case 5). */
  noCycle: boolean;
  effects: AmendmentEffectRow[];
  moneyDeltaMinor: number;
}

const OPEN_TERM_STATUSES = ['active', 'scheduled'] as const;

const OPEN_AMENDMENT_STATUSES = ['pending_approval', 'scheduled'] as const;

/**
 * Amendments of retainers (spec F05B A1–A9, C6, ADR 0029): every later change of a retainer's
 * lines and amounts is a numbered amendment, applied at once, in its month by the daily job, or
 * after the General Manager approves a reduction. Every change holds the retainer row lock (G2)
 * and writes its audit entry in the same transaction (G1).
 */
@Injectable()
export class RetainerAmendmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly charges: RetainerCharges,
    private readonly invoices: ChargeInvoices,
    private readonly notifications: NotificationCenter,
    private readonly renewalHooks: QuoteRenewalHooks,
  ) {}

  async list(
    actor: CurrentUserInfo,
    retainerId: string,
    query: AmendmentListQuery,
  ): Promise<AmendmentPage> {
    const retainer = await readableRetainer(this.db, this.clients, actor, retainerId);
    const where = and(
      eq(retainerAmendments.retainerId, retainerId),
      query.status ? inArray(retainerAmendments.status, query.status) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(retainerAmendments)
        .where(where)
        .orderBy(desc(retainerAmendments.number))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(retainerAmendments).where(where),
    ]);
    return {
      items: await this.present(this.db, rows, seesMoney(actor, retainer.client)),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** `GET /api/retainer-amendments`: amendments waiting for the General Manager, oldest first. */
  async pending(
    _actor: CurrentUserInfo,
    query: PendingAmendmentListQuery,
  ): Promise<RetainerAmendmentPage> {
    const where = and(
      eq(retainerAmendments.status, query.status),
      isNull(retainers.archivedAt),
      this.clients.isLive(retainers.clientId),
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          amendment: retainerAmendments,
          retainer: { name: retainers.name, currency: retainers.currency },
          clientId: retainers.clientId,
        })
        .from(retainerAmendments)
        .innerJoin(retainers, eq(retainers.id, retainerAmendments.retainerId))
        .where(where)
        .orderBy(asc(retainerAmendments.createdAt), asc(retainerAmendments.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(retainerAmendments)
        .innerJoin(retainers, eq(retainers.id, retainerAmendments.retainerId))
        .where(where),
    ]);
    const presented = await this.present(
      this.db,
      rows.map((row) => row.amendment),
      true,
    );
    const clients = await this.clients.summaries(rows.map((row) => row.clientId));
    return {
      items: rows.map((row, index) => {
        const amendment = presented[index] as Amendment;
        return {
          ...amendment,
          retainer: {
            id: row.amendment.retainerId,
            name: row.retainer.name,
            currency: row.retainer.currency,
          },
          client: { id: row.clientId, name: clients.get(row.clientId)?.name ?? '' },
        };
      }),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** `POST /amendments/preview`: what saving would do (A4, C6); nothing is saved. */
  async preview(
    actor: CurrentUserInfo,
    retainerId: string,
    input: CreateAmendment,
  ): Promise<AmendmentPreview> {
    return this.db.transaction(async (tx) => {
      const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
      assertCanEditMoney(actor, retainer.client);
      const plan = await this.plan(tx, retainer, input, businessDate());
      return {
        months: plan.effects.map((effect) => presentEffect(effect, true)),
        moneyDeltaMinor: plan.moneyDeltaMinor,
        needsApproval: amendmentNeedsApproval(plan.moneyDeltaMinor, canApprove(actor)),
      };
    });
  }

  /**
   * A1–A5: an amendment that reduces waits for approval; any other applies at once in the current
   * month, or is scheduled for its month.
   */
  async create(
    actor: CurrentUserInfo,
    retainerId: string,
    input: CreateAmendment,
  ): Promise<Amendment> {
    const id = await this.db.transaction(async (tx) => {
      const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
      assertCanEditMoney(actor, retainer.client);
      const today = businessDate();
      const plan = await this.plan(tx, retainer, input, today);
      const pending = amendmentNeedsApproval(plan.moneyDeltaMinor, canApprove(actor));
      const status = pending
        ? 'pending_approval'
        : input.effectiveMonth <= firstOfMonth(today)
          ? 'applied'
          : 'scheduled';
      const row = await this.insert(tx, retainer.id, actorOf(actor), {
        kind: 'change',
        scope: input.scope,
        effectiveMonth: input.effectiveMonth,
        amountDeltaMinor: input.amountDeltaMinor,
        moneyDeltaMinor: plan.moneyDeltaMinor,
        reason: input.reason,
        status,
        effects: plan.effects,
        lines: input.lines,
      });
      if (status === 'applied') await this.execute(tx, row, plan, today, actorOf(actor));
      if (pending) await this.notifyPending(tx, retainer, row, actor);
      return row.id;
    });
    return this.one(actor, retainerId, id);
  }

  /** A4: the General Manager applies (or schedules) a reduction after checking it again. */
  async approve(
    actor: CurrentUserInfo,
    retainerId: string,
    amendmentId: string,
    input: ApproveAmendment,
  ): Promise<Amendment> {
    await this.db.transaction(async (tx) => {
      const retainer = await readableRetainer(tx, this.clients, actor, retainerId, {
        forUpdate: true,
      });
      const row = await this.pendingRow(tx, retainerId, amendmentId);
      const today = businessDate();
      let plan: ChangePlan;
      try {
        plan = await this.plan(tx, retainer, changeOf(row, await this.lines(tx, [row.id])), today);
      } catch (error) {
        if (error instanceof CodedException) {
          throw new CodedException(
            409,
            'AMENDMENT_INVALID',
            'The retainer changed since the amendment was requested; reject it instead',
            [codeOf(error)],
          );
        }
        throw error;
      }
      const applies = row.effectiveMonth <= firstOfMonth(today);
      const note = input.note || null;
      await tx
        .update(retainerAmendments)
        .set({
          status: 'scheduled',
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: note,
          effects: plan.effects,
          updatedAt: new Date(),
        })
        .where(eq(retainerAmendments.id, row.id));
      await this.audit(tx, actorOf(actor), 'retainer_amendment.approved', row, {
        status: applies ? 'applied' : 'scheduled',
        ...(note && { decisionNote: note }),
      });
      if (applies) await this.execute(tx, row, plan, today, actorOf(actor));
      await this.notifyDecided(tx, retainer, row, actor, { approved: true, note });
    });
    return this.one(actor, retainerId, amendmentId);
  }

  /** A4: rejecting needs a note; nothing changes. */
  async reject(
    actor: CurrentUserInfo,
    retainerId: string,
    amendmentId: string,
    input: RejectAmendment,
  ): Promise<Amendment> {
    await this.db.transaction(async (tx) => {
      const retainer = await readableRetainer(tx, this.clients, actor, retainerId, {
        forUpdate: true,
      });
      const row = await this.pendingRow(tx, retainerId, amendmentId);
      await tx
        .update(retainerAmendments)
        .set({
          status: 'rejected',
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: input.note,
          updatedAt: new Date(),
        })
        .where(eq(retainerAmendments.id, row.id));
      await this.audit(tx, actorOf(actor), 'retainer_amendment.rejected', row, {
        status: 'rejected',
        decisionNote: input.note,
      });
      await this.notifyDecided(tx, retainer, row, actor, { approved: false, note: input.note });
    });
    return this.one(actor, retainerId, amendmentId);
  }

  /** A4: the creator or a manager of the retainer withdraws a pending amendment. */
  async withdraw(
    actor: CurrentUserInfo,
    retainerId: string,
    amendmentId: string,
  ): Promise<Amendment> {
    await this.db.transaction(async (tx) => {
      const retainer = await readableRetainer(tx, this.clients, actor, retainerId, {
        forUpdate: true,
      });
      const row = await this.row(tx, retainerId, amendmentId);
      if (!coversClient(actor, retainer.client) && row.createdById !== actor.id) {
        throw new ForbiddenException();
      }
      if (row.status !== 'pending_approval') {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Only a pending amendment is withdrawn',
        );
      }
      await tx
        .update(retainerAmendments)
        .set({ status: 'withdrawn', updatedAt: new Date() })
        .where(eq(retainerAmendments.id, row.id));
      await this.audit(tx, actorOf(actor), 'retainer_amendment.withdrawn', row, {
        status: 'withdrawn',
      });
    });
    return this.one(actor, retainerId, amendmentId);
  }

  /**
   * A6: new amounts for months of the active or a scheduled term that no issued invoice bills,
   * with the same sum; applied at once, no approval. Drafts are synced (C6), bases follow.
   */
  async reschedule(
    actor: CurrentUserInfo,
    retainerId: string,
    termId: string,
    input: RescheduleTerm,
  ): Promise<Amendment> {
    const id = await this.db.transaction(async (tx) => {
      const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
      assertCanEditMoney(actor, retainer.client);
      const [term] = await tx
        .select()
        .from(retainerTerms)
        .where(and(eq(retainerTerms.id, termId), eq(retainerTerms.retainerId, retainerId)));
      if (!term) throw new NotFoundException();
      if (term.status !== 'active' && term.status !== 'scheduled') {
        throw new CodedException(409, 'TERM_STARTED', 'Only an active or scheduled term changes');
      }
      const months = termMonths(term.startMonth, term.months);
      const chosen = input.schedule.map((entry) => entry.month);
      if (
        new Set(chosen).size !== chosen.length ||
        chosen.some((month) => !months.includes(month))
      ) {
        throw new CodedException(
          409,
          'SCHEDULE_TOTAL_MISMATCH',
          'Each month of the term is listed once',
        );
      }
      const charges = await this.monthlyCharges(tx, retainerId, chosen);
      const invoiced = await this.invoices.of(
        tx,
        charges.map((charge) => charge.id),
      );
      const issued = charges.filter((charge) => invoiced.get(charge.id)?.issued);
      if (issued.length > 0 || charges.length !== chosen.length) {
        throw new CodedException(
          409,
          'MONTH_INVOICED',
          'A month is on an issued invoice; change its amount by amendment',
          issued.map((charge) => charge.month),
        );
      }
      const before = charges.reduce((total, charge) => total + charge.amountMinor, 0);
      const after = input.schedule.reduce((total, entry) => total + entry.amountMinor, 0);
      if (before !== after) {
        throw new CodedException(
          409,
          'SCHEDULE_TOTAL_MISMATCH',
          'The new amounts must sum to the months’ current total',
        );
      }
      const effects: AmendmentEffectRow[] = [];
      for (const entry of [...input.schedule].sort((a, b) => a.month.localeCompare(b.month))) {
        const charge = charges.find((row) => row.month === entry.month);
        if (!charge || charge.amountMinor === entry.amountMinor) continue;
        const invoice = invoiced.get(charge.id) ?? null;
        effects.push({
          month: entry.month,
          effect: invoice ? 'draft_synced' : 'charge_changed',
          invoice: invoice ? { id: invoice.id, displayNumber: invoice.displayNumber } : null,
          beforeMinor: charge.amountMinor,
          afterMinor: entry.amountMinor,
        });
      }
      const row = await this.insert(tx, retainerId, actorOf(actor), {
        kind: 'reschedule',
        scope: null,
        effectiveMonth: [...chosen].sort()[0] as CalendarDate,
        amountDeltaMinor: 0,
        moneyDeltaMinor: 0,
        reason: input.reason,
        status: 'applied',
        effects,
        schedule: input.schedule,
        lines: [],
      });
      const today = businessDate();
      for (const entry of input.schedule) {
        const charge = charges.find((item) => item.month === entry.month);
        if (!charge) continue;
        await this.charges.reschedule(tx, retainerId, charge, entry.amountMinor, {
          amendmentId: row.id,
          draft: invoiced.has(charge.id),
          today,
          actor: actorOf(actor),
        });
      }
      await this.markApplied(tx, row, effects, actorOf(actor));
      return row.id;
    });
    return this.one(actor, retainerId, id);
  }

  /**
   * A5, the job's step on a retainer it locked: scheduled amendments of the current month or
   * earlier apply in number order, before the month's charges become due and its cycle opens.
   * One the retainer's state no longer allows is cancelled (its month left the term, A8).
   */
  async applyScheduled(
    tx: Transaction,
    retainer: PlannedRetainer,
    today: CalendarDate,
  ): Promise<number> {
    const due = await tx
      .select()
      .from(retainerAmendments)
      .where(
        and(
          eq(retainerAmendments.retainerId, retainer.id),
          eq(retainerAmendments.status, 'scheduled'),
          lte(retainerAmendments.effectiveMonth, firstOfMonth(today)),
        ),
      )
      .orderBy(asc(retainerAmendments.number));
    let applied = 0;
    for (const row of due) {
      try {
        // A savepoint: an amendment that fails rolls back alone (ADR 0015).
        await tx.transaction(async (savepoint) => {
          const lines = await this.lines(savepoint, [row.id]);
          if (row.kind === 'quote_renewal') {
            await this.applyQuoteRenewal(savepoint, row, lines, null);
            return;
          }
          const plan = await this.plan(savepoint, retainer, changeOf(row, lines), today, {
            fromJob: true,
          });
          await this.execute(savepoint, row, plan, today, null);
        });
      } catch (error) {
        if (!(error instanceof CodedException)) throw error;
        await this.cancel(tx, row, null, codeOf(error));
        continue;
      }
      applied += 1;
    }
    return applied;
  }

  /**
   * F05B Q2 on a retainer the caller locked: the quote's lines and fee become a `quote_renewal`
   * amendment of its effective month, applied by the job like any scheduled amendment (A5), with
   * no approval (the quote's own discount approval covers it). A quote renewal still scheduled is
   * replaced by the newer one.
   */
  async createQuoteRenewal(
    tx: Transaction,
    retainerId: string,
    actor: AuditActor,
    input: QuoteRenewalInput,
  ): Promise<void> {
    const replaced = await tx
      .select()
      .from(retainerAmendments)
      .where(
        and(
          eq(retainerAmendments.retainerId, retainerId),
          eq(retainerAmendments.kind, 'quote_renewal'),
          eq(retainerAmendments.status, 'scheduled'),
        ),
      )
      .orderBy(asc(retainerAmendments.number));
    for (const row of replaced) await this.cancel(tx, row, actor, 'replaced');
    const [fee] = await tx
      .select({ monthlyFeeMinor: retainers.monthlyFeeMinor })
      .from(retainers)
      .where(eq(retainers.id, retainerId));
    const beforeMinor = fee?.monthlyFeeMinor ?? 0;
    const deltaMinor = input.feeMinor - beforeMinor;
    // The amendment is the system's (no creator); the audit entry names who accepted the quote.
    const row = await this.insert(tx, retainerId, actor, {
      kind: 'quote_renewal',
      scope: 'onward',
      effectiveMonth: input.effectiveMonth,
      amountDeltaMinor: deltaMinor,
      moneyDeltaMinor: deltaMinor,
      reason: input.reason,
      status: 'scheduled',
      effects:
        deltaMinor === 0
          ? []
          : [
              {
                month: input.effectiveMonth,
                effect: 'fee_changed',
                invoice: null,
                beforeMinor,
                afterMinor: input.feeMinor,
              },
            ],
      quoteId: input.quoteId,
      feeMinor: input.feeMinor,
      templateId: input.templateId,
      createdById: null,
      lines: input.lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        quantity: line.monthlyQuantity,
        revisionLimit: line.revisionLimit,
      })),
    });
    if (input.effectiveMonth <= firstOfMonth(businessDate())) {
      await this.applyQuoteRenewal(tx, row, await this.lines(tx, [row.id]), actor);
    }
  }

  /**
   * Applies a `quote_renewal` in its month (A5): the quote's lines replace the standing lines
   * (same kind and label keep their identity, the others are archived) and its monthly template is
   * linked before the month's cycle opens and copies them, and its fee becomes the open-ended rate.
   */
  private async applyQuoteRenewal(
    tx: Transaction,
    row: AmendmentRow,
    lines: LineRow[],
    actor: AuditActor | null,
  ): Promise<void> {
    const standingLines = await tx
      .select({
        id: retainerDeliverables.id,
        kind: retainerDeliverables.kind,
        label: retainerDeliverables.label,
      })
      .from(retainerDeliverables)
      .where(
        and(
          eq(retainerDeliverables.retainerId, row.retainerId),
          isNull(retainerDeliverables.archivedAt),
        ),
      );
    const wanted = new Set(lines.map((line) => deliverableKey(line)));
    const plan: LinePlan[] = [
      ...standingLines
        .filter((line) => !wanted.has(deliverableKey(line)))
        .map((line) => ({ ...line, quantity: 0, revisionLimit: null })),
      ...lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        id: standingLines.find((item) => deliverableKey(item) === deliverableKey(line))?.id ?? null,
        quantity: line.quantity ?? 0,
        revisionLimit: line.revisionLimit,
      })),
    ];
    await this.applyStanding(tx, row.retainerId, plan, { revisionLimits: true });
    if (row.templateId) {
      await this.renewalHooks.run(tx, {
        retainerId: row.retainerId,
        amendmentId: row.id,
        templateId: row.templateId,
        actor,
      });
    }
    const effects: AmendmentEffectRow[] = [];
    const [fee] = await tx
      .select({ monthlyFeeMinor: retainers.monthlyFeeMinor })
      .from(retainers)
      .where(eq(retainers.id, row.retainerId));
    const beforeMinor = fee?.monthlyFeeMinor ?? null;
    if (row.feeMinor !== null && beforeMinor !== row.feeMinor) {
      await tx
        .update(retainers)
        .set({ monthlyFeeMinor: row.feeMinor })
        .where(eq(retainers.id, row.retainerId));
      await recordAudit(tx, {
        actor,
        action: 'retainer.updated',
        entityType: 'retainer',
        entityId: row.retainerId,
        before: { monthlyFeeMinor: beforeMinor },
        after: { monthlyFeeMinor: row.feeMinor, amendmentId: row.id },
      });
      effects.push({
        month: row.effectiveMonth,
        effect: 'fee_changed',
        invoice: null,
        beforeMinor: beforeMinor ?? 0,
        afterMinor: row.feeMinor,
      });
    }
    await this.markApplied(tx, row, effects, actor);
  }

  /** A8: ending a retainer cancels its pending and scheduled amendments. */
  async cancelOpen(tx: Transaction, retainerId: string, actor: AuditActor | null): Promise<void> {
    const open = await tx
      .select()
      .from(retainerAmendments)
      .where(
        and(
          eq(retainerAmendments.retainerId, retainerId),
          inArray(retainerAmendments.status, [...OPEN_AMENDMENT_STATUSES]),
        ),
      )
      .orderBy(asc(retainerAmendments.number));
    for (const row of open) await this.cancel(tx, row, actor, 'retainer_ended');
  }

  /** The number of amendments waiting for approval, per retainer (A4). */
  async pendingCounts(
    executor: Executor,
    retainerIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (retainerIds.length === 0) return new Map();
    const rows = await executor
      .select({ retainerId: retainerAmendments.retainerId, value: count() })
      .from(retainerAmendments)
      .where(
        and(
          inArray(retainerAmendments.retainerId, [...retainerIds]),
          eq(retainerAmendments.status, 'pending_approval'),
        ),
      )
      .groupBy(retainerAmendments.retainerId);
    return new Map(rows.map((row) => [row.retainerId, row.value]));
  }

  /** The `pendingApproval` list filter on `retainers` (A4). */
  pendingApprovalFilter(wanted: boolean) {
    const exists = sql`exists (select 1 from ${retainerAmendments} where ${retainerAmendments.retainerId} = ${retainers.id} and ${retainerAmendments.status} = 'pending_approval')`;
    return wanted ? exists : sql`not ${exists}`;
  }

  /** Month-scope line changes applied for `month` (a cycle opening later takes them, A2). */
  async monthLines(
    tx: Transaction,
    retainerId: string,
    month: CalendarDate,
  ): Promise<{ amendmentId: string; lines: LineRow[] }[]> {
    const rows = await tx
      .select({ id: retainerAmendments.id })
      .from(retainerAmendments)
      .where(
        and(
          eq(retainerAmendments.retainerId, retainerId),
          eq(retainerAmendments.status, 'applied'),
          eq(retainerAmendments.kind, 'change'),
          eq(retainerAmendments.scope, 'month'),
          eq(retainerAmendments.effectiveMonth, month),
        ),
      )
      .orderBy(asc(retainerAmendments.number));
    const lines = await this.lines(
      tx,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      amendmentId: row.id,
      lines: lines.filter((line) => line.amendmentId === row.id),
    }));
  }

  // Planning (A1–A3, C6)

  /**
   * Works out a `change` amendment against the retainer's current state, or throws the coded
   * error of the first rule it breaks. `fromJob`: the job applies it in its own month.
   */
  private async plan(
    tx: Transaction,
    retainer: PlannedRetainer,
    input: ChangeInput,
    today: CalendarDate,
    options: { fromJob?: boolean } = {},
  ): Promise<ChangePlan> {
    if (retainer.archivedAt) {
      throw new CodedException(409, 'RETAINER_ARCHIVED', 'Restore the retainer before changing it');
    }
    if (retainer.status === 'ended') {
      throw new CodedException(409, 'RETAINER_ENDED', 'Reactivate the retainer before changing it');
    }
    const current = firstOfMonth(today);
    const month = input.effectiveMonth;
    if (input.lines.length === 0 && input.amountDeltaMinor === 0) {
      throw new CodedException(400, 'EMPTY_AMENDMENT', 'Change a line or the amount');
    }
    if (retainer.client?.archived) {
      throw new CodedException(
        409,
        'CLIENT_ARCHIVED',
        'Restore the client before changing its work',
      );
    }
    if (month < current && !options.fromJob) throw invalidMonth();
    // An amendment never reaches a month before the retainer starts.
    if (month < firstOfMonth(retainer.startDate)) throw invalidMonth();
    const terms = await tx
      .select()
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainer.id),
          inArray(retainerTerms.status, [...OPEN_TERM_STATUSES]),
        ),
      )
      .orderBy(asc(retainerTerms.startMonth));
    const termMonthSet = new Set(terms.flatMap((term) => termMonths(term.startMonth, term.months)));
    const first = terms[0];
    const last = terms.at(-1);
    const openEnded =
      !first ||
      month < first.startMonth ||
      (last !== undefined && month > last.endMonth && last.endAction === 'continue');
    if (!termMonthSet.has(month) && !openEnded) throw invalidMonth();

    // Money (A3, C6)
    const delta = input.amountDeltaMinor;
    const affected =
      input.scope === 'month' ? [month] : [...termMonthSet].filter((item) => item >= month).sort();
    if (input.scope === 'onward' && openEnded && !affected.includes(month)) affected.unshift(month);
    const [fee] = await tx
      .select({ monthlyFeeMinor: retainers.monthlyFeeMinor })
      .from(retainers)
      .where(eq(retainers.id, retainer.id));
    const feeMinor = fee?.monthlyFeeMinor ?? null;
    const months: MonthPlan[] = [];
    if (delta !== 0) {
      const charges = await this.monthlyCharges(tx, retainer.id, affected);
      const invoiced = await this.invoices.of(
        tx,
        charges.map((charge) => charge.id),
      );
      const extras = await this.extras(tx, retainer.id, affected);
      for (const item of affected) {
        const charge = charges.find((row) => row.month === item) ?? null;
        const termMonth = termMonthSet.has(item);
        // An open-ended onward month without a charge takes the new fee when its cycle opens.
        if (!charge && input.scope === 'onward') continue;
        // C2: a month without its charge is charged only when its cycle opens, which an active,
        // started retainer does in its month; a paused or not yet started month takes no amount.
        if (
          !charge &&
          item <= current &&
          !(retainer.status === 'active' && retainer.startDate <= today)
        ) {
          throw invalidMonth();
        }
        const effect = planMonthChange(
          {
            month: item,
            amountMinor: charge?.amountMinor ?? feeMinor ?? 0,
            invoice: (charge && invoiced.get(charge.id)) || null,
            extrasMinor: extras.get(item) ?? 0,
          },
          delta,
        );
        if (effect === 'negative') throw negative();
        if (effect) {
          months.push({ charge, effect, termMonth, createMinor: (feeMinor ?? 0) + delta });
        }
      }
    }
    let feePlan: ChangePlan['fee'] = null;
    if (input.scope === 'onward' && openEnded && delta !== 0) {
      const beforeMinor = feeMinor ?? 0;
      if (beforeMinor + delta < 0) throw negative();
      feePlan = { beforeMinor, afterMinor: beforeMinor + delta };
    }

    // Lines (A2)
    if (duplicateDeliverables(input.lines).length > 0) {
      throw new CodedException(
        409,
        'DUPLICATE_DELIVERABLE',
        'Each line needs its own kind or label',
      );
    }
    const standingLines = await tx
      .select({
        id: retainerDeliverables.id,
        kind: retainerDeliverables.kind,
        label: retainerDeliverables.label,
        quantity: retainerDeliverables.monthlyQuantity,
        revisionLimit: retainerDeliverables.revisionLimit,
      })
      .from(retainerDeliverables)
      .where(
        and(
          eq(retainerDeliverables.retainerId, retainer.id),
          isNull(retainerDeliverables.archivedAt),
        ),
      );
    const [cycleRow] = await tx
      .select({ id: retainerCycles.id, status: retainerCycles.status })
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainer.id), eq(retainerCycles.month, month)));
    const cycleLines = cycleRow
      ? await tx
          .select({
            id: retainerCycleLines.id,
            kind: retainerCycleLines.kind,
            label: retainerCycleLines.label,
            quantity: retainerCycleLines.committedQuantity,
            revisionLimit: retainerCycleLines.revisionLimit,
          })
          .from(retainerCycleLines)
          .where(eq(retainerCycleLines.cycleId, cycleRow.id))
      : [];
    let standing: LinePlan[] = [];
    let cycle: ChangePlan['cycle'] = null;
    if (input.lines.length > 0) {
      if (input.scope === 'onward') {
        standing = changeLines(standingLines, input.lines, { clamp: false });
        const kept = standingLines.length + standing.filter((line) => !line.id).length;
        const archived = standing.filter((line) => line.id && line.quantity === 0).length;
        if (kept - archived > RETAINER_LIMITS.deliverables) throw limit();
      } else if (!cycleRow) {
        // Checked against the standing lines the cycle will copy when it opens.
        changeLines(standingLines, input.lines, { clamp: false });
      }
      if (cycleRow && cycleRow.status === 'open') {
        const lines = changeLines(cycleLines, input.lines, {
          clamp: input.scope === 'onward',
        });
        if (
          cycleLines.length + lines.filter((line) => !line.id).length >
          RETAINER_LIMITS.cycleLines
        ) {
          throw limit();
        }
        cycle = { id: cycleRow.id, lines };
      } else if (cycleRow && input.scope === 'month') {
        throw new CodedException(409, 'CYCLE_CLOSED', 'The month’s cycle is closed');
      }
    }
    const noCycle =
      !options.fromJob &&
      input.scope === 'month' &&
      input.lines.length > 0 &&
      !cycleRow &&
      month <= current;

    const effects: AmendmentEffectRow[] = months.map(({ effect }) => ({
      month: effect.month,
      effect: effect.effect,
      invoice: effect.invoice,
      beforeMinor: effect.beforeMinor,
      afterMinor: effect.afterMinor,
    }));
    if (feePlan) {
      effects.push({ month, effect: 'fee_changed', invoice: null, ...feePlan });
    }
    if (noCycle) {
      effects.push({ month, effect: 'no_cycle', invoice: null, beforeMinor: 0, afterMinor: 0 });
    }
    effects.sort((a, b) => a.month.localeCompare(b.month));
    const counted = months.filter((item) => item.termMonth || input.scope === 'month').length;
    return {
      months,
      fee: feePlan,
      standing,
      cycle,
      noCycle,
      effects,
      moneyDeltaMinor: amendmentMoneyDelta({
        amountDeltaMinor: delta,
        months: delta === 0 ? 0 : Math.max(counted, input.scope === 'month' ? 1 : 0),
        changesFee: feePlan !== null,
      }),
    };
  }

  /** Applies a planned `change` amendment: amounts (C6), fee (A3), lines (A2), then marks it. */
  private async execute(
    tx: Transaction,
    row: AmendmentRow,
    plan: ChangePlan,
    today: CalendarDate,
    actor: AuditActor | null,
  ): Promise<void> {
    const onward = row.scope === 'onward';
    for (const month of plan.months) {
      if (month.charge) {
        await this.charges.changeMonth(tx, row.retainerId, month.charge, month.effect, {
          deltaMinor: row.amountDeltaMinor,
          onward: onward && month.termMonth,
          amendmentId: row.id,
          today,
          actor,
        });
      } else {
        // A month without its charge yet (its cycle has not opened): created at the new amount.
        await this.charges.createMonthly(
          tx,
          row.retainerId,
          month.effect.month,
          month.createMinor,
          actor,
        );
        await this.charges.runDue(tx, row.retainerId, today, actor);
      }
    }
    if (plan.fee) {
      await tx
        .update(retainers)
        .set({ monthlyFeeMinor: plan.fee.afterMinor })
        .where(eq(retainers.id, row.retainerId));
      await recordAudit(tx, {
        actor,
        action: 'retainer.updated',
        entityType: 'retainer',
        entityId: row.retainerId,
        before: { monthlyFeeMinor: plan.fee.beforeMinor },
        after: { monthlyFeeMinor: plan.fee.afterMinor, amendmentId: row.id },
      });
    }
    await this.applyStanding(tx, row.retainerId, plan.standing);
    if (plan.cycle) await this.applyCycleLines(tx, plan.cycle.id, plan.cycle.lines, row.id);
    await this.markApplied(tx, row, plan.effects, actor);
  }

  /** A2, `onward`: lines change, new ones are added, a line reaching 0 is archived. */
  private async applyStanding(
    tx: Transaction,
    retainerId: string,
    lines: LinePlan[],
    options: { revisionLimits?: boolean } = {},
  ) {
    if (lines.length === 0) return;
    const [top] = await tx
      .select({ value: max(retainerDeliverables.position) })
      .from(retainerDeliverables)
      .where(
        and(
          eq(retainerDeliverables.retainerId, retainerId),
          isNull(retainerDeliverables.archivedAt),
        ),
      );
    let position = top?.value ?? 0;
    for (const line of lines) {
      if (line.id && line.quantity === 0) {
        await tx
          .update(retainerDeliverables)
          .set({ archivedAt: new Date() })
          .where(eq(retainerDeliverables.id, line.id));
      } else if (line.id) {
        await tx
          .update(retainerDeliverables)
          .set({
            monthlyQuantity: line.quantity,
            // A quote renewal brings its lines' revision rounds (F04 A6).
            ...(options.revisionLimits && { revisionLimit: line.revisionLimit }),
          })
          .where(eq(retainerDeliverables.id, line.id));
      } else {
        position += 1;
        await tx.insert(retainerDeliverables).values({
          retainerId,
          kind: line.kind,
          label: line.label,
          monthlyQuantity: line.quantity,
          revisionLimit: line.revisionLimit,
          position,
        });
      }
    }
  }

  /** A2: the cycle's lines take the change, marked with the amendment. */
  async applyCycleLines(
    tx: Transaction,
    cycleId: string,
    lines: LinePlan[],
    amendmentId: string,
  ): Promise<void> {
    if (lines.length === 0) return;
    const [top] = await tx
      .select({ value: max(retainerCycleLines.position) })
      .from(retainerCycleLines)
      .where(eq(retainerCycleLines.cycleId, cycleId));
    let position = top?.value ?? 0;
    for (const line of lines) {
      if (line.id) {
        await tx
          .update(retainerCycleLines)
          .set({ committedQuantity: line.quantity, amendmentId })
          .where(eq(retainerCycleLines.id, line.id));
        continue;
      }
      if (line.quantity <= 0) continue;
      const [standing] = await tx
        .select({ id: retainerDeliverables.id })
        .from(retainerDeliverables)
        .innerJoin(retainerCycles, eq(retainerCycles.retainerId, retainerDeliverables.retainerId))
        .where(
          and(
            eq(retainerCycles.id, cycleId),
            eq(retainerDeliverables.kind, line.kind),
            sql`lower(coalesce(${retainerDeliverables.label}, '')) = lower(${line.label ?? ''})`,
            isNull(retainerDeliverables.archivedAt),
          ),
        );
      position += 1;
      await tx.insert(retainerCycleLines).values({
        cycleId,
        deliverableId: standing?.id ?? null,
        kind: line.kind,
        label: line.label,
        committedQuantity: line.quantity,
        revisionLimit: line.revisionLimit,
        position,
        amendmentId,
      });
    }
  }

  /** A2: a cycle opening in a month takes the month-scope line changes applied for it. */
  async openWithAmendments(
    tx: Transaction,
    retainerId: string,
    cycleId: string,
    month: CalendarDate,
  ): Promise<void> {
    for (const { amendmentId, lines } of await this.monthLines(tx, retainerId, month)) {
      const current = await tx
        .select({
          id: retainerCycleLines.id,
          kind: retainerCycleLines.kind,
          label: retainerCycleLines.label,
          quantity: retainerCycleLines.committedQuantity,
          revisionLimit: retainerCycleLines.revisionLimit,
        })
        .from(retainerCycleLines)
        .where(eq(retainerCycleLines.cycleId, cycleId));
      const inputs = lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        quantityDelta: line.quantityDelta ?? 0,
        revisionLimit: line.revisionLimit,
      }));
      await this.applyCycleLines(
        tx,
        cycleId,
        changeLines(current, inputs, { clamp: true }),
        amendmentId,
      );
    }
  }

  private async markApplied(
    tx: Transaction,
    row: AmendmentRow,
    effects: AmendmentEffectRow[],
    actor: AuditActor | null,
  ): Promise<void> {
    await tx
      .update(retainerAmendments)
      .set({ status: 'applied', appliedAt: new Date(), effects, updatedAt: new Date() })
      .where(eq(retainerAmendments.id, row.id));
    await this.audit(tx, actor, 'retainer_amendment.applied', row, { status: 'applied', effects });
  }

  private async cancel(
    tx: Transaction,
    row: AmendmentRow,
    actor: AuditActor | null,
    cause: string,
  ): Promise<void> {
    await tx
      .update(retainerAmendments)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(retainerAmendments.id, row.id));
    await this.audit(tx, actor, 'retainer_amendment.cancelled', row, {
      status: 'cancelled',
      cause,
    });
  }

  private async insert(
    tx: Transaction,
    retainerId: string,
    actor: AuditActor | null,
    values: {
      kind: AmendmentRow['kind'];
      scope: AmendmentRow['scope'];
      effectiveMonth: CalendarDate;
      amountDeltaMinor: number;
      moneyDeltaMinor: number;
      reason: string;
      status: AmendmentRow['status'];
      effects: AmendmentEffectRow[];
      schedule?: { month: string; amountMinor: number }[];
      quoteId?: string;
      feeMinor?: number;
      templateId?: string | null;
      /** Default: the actor (a person's amendment). */
      createdById?: string | null;
      lines: AmendmentLineInput[];
    },
  ): Promise<AmendmentRow> {
    const [top] = await tx
      .select({ value: max(retainerAmendments.number), total: count() })
      .from(retainerAmendments)
      .where(eq(retainerAmendments.retainerId, retainerId));
    if ((top?.total ?? 0) >= RETAINER_LIMITS.amendments) throw limit();
    const { lines, createdById, ...fields } = values;
    const [row] = await tx
      .insert(retainerAmendments)
      .values({
        ...fields,
        retainerId,
        number: (top?.value ?? 0) + 1,
        createdById: createdById === undefined ? (actor?.id ?? null) : createdById,
        schedule: values.schedule ?? null,
      })
      .returning();
    if (!row) throw new Error('Amendment insert returned no row');
    if (lines.length > 0) {
      await tx.insert(retainerAmendmentLines).values(
        lines.map((line, index) => ({
          amendmentId: row.id,
          kind: line.kind,
          label: line.label ?? null,
          quantityDelta: line.quantityDelta ?? null,
          quantity: line.quantity ?? null,
          revisionLimit: line.revisionLimit ?? null,
          position: index + 1,
        })),
      );
    }
    await recordAudit(tx, {
      actor,
      action: 'retainer_amendment.created',
      entityType: 'retainer_amendment',
      entityId: row.id,
      after: {
        number: row.number,
        kind: row.kind,
        scope: row.scope,
        effectiveMonth: row.effectiveMonth,
        status: row.status,
        amountDeltaMinor: row.amountDeltaMinor,
        moneyDeltaMinor: row.moneyDeltaMinor,
        ...(row.schedule && { schedule: row.schedule }),
        lines: lines.map(({ kind, label, quantityDelta, quantity }) => ({
          kind,
          label,
          ...(quantityDelta != null && { quantityDelta }),
          ...(quantity != null && { quantity }),
        })),
        ...(row.feeMinor !== null && { feeMinor: row.feeMinor }),
        ...(row.quoteId && { quoteId: row.quoteId }),
        ...(row.templateId && { templateId: row.templateId }),
        reason: row.reason,
        retainerId,
      },
    });
    return row;
  }

  private audit(
    tx: Transaction,
    actor: AuditActor | null,
    action:
      | 'retainer_amendment.approved'
      | 'retainer_amendment.rejected'
      | 'retainer_amendment.withdrawn'
      | 'retainer_amendment.applied'
      | 'retainer_amendment.cancelled',
    row: AmendmentRow,
    after: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      actor,
      action,
      entityType: 'retainer_amendment',
      entityId: row.id,
      before: { status: row.status },
      after: { ...after, number: row.number, retainerId: row.retainerId },
    });
  }

  private async notifyPending(
    tx: Transaction,
    retainer: RetainerAccess,
    row: AmendmentRow,
    actor: CurrentUserInfo,
  ): Promise<void> {
    const managers = (await this.users.withRole('general_manager', tx)).filter(
      (id) => id !== actor.id,
    );
    if (managers.length === 0) return;
    await this.notifications.notify(tx, {
      type: 'retainer_amendment_pending',
      recipients: managers,
      actorId: actor.id,
      subjectId: retainer.id,
      data: {
        retainer: retainer.name,
        client: retainer.client.name,
        number: row.number,
        moneyDeltaMinor: row.moneyDeltaMinor,
        currency: retainer.currency,
        creator: actor.name,
      },
    });
  }

  private async notifyDecided(
    tx: Transaction,
    retainer: RetainerAccess,
    row: AmendmentRow,
    actor: CurrentUserInfo,
    decision: { approved: boolean; note: string | null },
  ): Promise<void> {
    if (!row.createdById || row.createdById === actor.id) return;
    await this.notifications.notify(tx, {
      type: 'retainer_amendment_decided',
      recipients: [row.createdById],
      actorId: actor.id,
      subjectId: retainer.id,
      data: { retainer: retainer.name, number: row.number, ...decision },
    });
  }

  // Reads

  private async one(actor: CurrentUserInfo, retainerId: string, id: string): Promise<Amendment> {
    const retainer = await readableRetainer(this.db, this.clients, actor, retainerId);
    const row = await this.row(this.db, retainerId, id);
    const [amendment] = await this.present(this.db, [row], seesMoney(actor, retainer.client));
    if (!amendment) throw new NotFoundException();
    return amendment;
  }

  private async row(executor: Executor, retainerId: string, id: string): Promise<AmendmentRow> {
    const [row] = await executor
      .select()
      .from(retainerAmendments)
      .where(and(eq(retainerAmendments.id, id), eq(retainerAmendments.retainerId, retainerId)));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async pendingRow(tx: Transaction, retainerId: string, id: string) {
    const row = await this.row(tx, retainerId, id);
    if (row.status !== 'pending_approval') {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The amendment is not pending');
    }
    return row;
  }

  private lines(executor: Executor, amendmentIds: string[]): Promise<LineRow[]> {
    if (amendmentIds.length === 0) return Promise.resolve([]);
    return executor
      .select()
      .from(retainerAmendmentLines)
      .where(inArray(retainerAmendmentLines.amendmentId, amendmentIds))
      .orderBy(asc(retainerAmendmentLines.position));
  }

  /** The live `monthly` charges of the months. */
  private monthlyCharges(
    executor: Executor,
    retainerId: string,
    months: readonly CalendarDate[],
  ): Promise<MonthlyCharge[]> {
    if (months.length === 0) return Promise.resolve([]);
    return executor
      .select({
        id: retainerCharges.id,
        month: retainerCharges.month,
        amountMinor: retainerCharges.amountMinor,
        dueAt: retainerCharges.dueAt,
      })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.kind, 'monthly'),
          ne(retainerCharges.status, 'cancelled'),
          inArray(retainerCharges.month, [...months]),
        ),
      );
  }

  /** Σ of each month's non-cancelled additions and credits. */
  private async extras(
    executor: Executor,
    retainerId: string,
    months: readonly CalendarDate[],
  ): Promise<Map<string, number>> {
    if (months.length === 0) return new Map();
    const rows = await executor
      .select({ month: retainerCharges.month, amountMinor: retainerCharges.amountMinor })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          inArray(retainerCharges.kind, ['addition', 'credit']),
          ne(retainerCharges.status, 'cancelled'),
          inArray(retainerCharges.month, [...months]),
        ),
      );
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.month, (totals.get(row.month) ?? 0) + row.amountMinor);
    return totals;
  }

  private async present(
    executor: Executor,
    rows: AmendmentRow[],
    withMoney: boolean,
  ): Promise<Amendment[]> {
    const lines = await this.lines(
      executor,
      rows.map((row) => row.id),
    );
    const people = await this.users.summaries(
      rows.flatMap((row) => [row.createdById, row.decidedById].filter((id) => id !== null)),
      executor,
    );
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? '' });
    return rows.map((row) => ({
      id: row.id,
      retainerId: row.retainerId,
      number: row.number,
      kind: row.kind,
      scope: row.scope,
      effectiveMonth: row.effectiveMonth,
      status: row.status,
      reason: row.reason,
      lines: lines
        .filter((line) => line.amendmentId === row.id)
        .map((line) => ({
          kind: line.kind,
          label: line.label,
          quantityDelta: line.quantityDelta,
          quantity: line.quantity,
          revisionLimit: line.revisionLimit,
          position: line.position,
        })),
      createdBy: row.createdById ? person(row.createdById) : null,
      createdAt: row.createdAt.toISOString(),
      decision:
        row.decidedById && row.decidedAt
          ? {
              approved: row.status !== 'rejected',
              by: person(row.decidedById),
              at: row.decidedAt.toISOString(),
              note: row.decisionNote,
            }
          : null,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      effects: row.effects.map((effect) => presentEffect(effect, withMoney)),
      ...(withMoney && {
        money: {
          amountDeltaMinor: row.amountDeltaMinor,
          moneyDeltaMinor: row.moneyDeltaMinor,
          schedule: row.schedule,
        },
      }),
    }));
  }
}

/** The error code a coded exception answers with. */
function codeOf(error: CodedException): string {
  return (error.getResponse() as { code: string }).code;
}

function canApprove(actor: CurrentUserInfo): boolean {
  return hasPermission(actor.access, 'retainers.approve_reduction');
}

/** A stored amendment as the planner's input. */
function changeOf(row: AmendmentRow, lines: LineRow[]): ChangeInput {
  return {
    scope: row.scope ?? 'month',
    effectiveMonth: row.effectiveMonth,
    amountDeltaMinor: row.amountDeltaMinor,
    lines: lines.map((line) => ({
      kind: line.kind,
      label: line.label,
      quantityDelta: line.quantityDelta ?? 0,
      revisionLimit: line.revisionLimit,
    })),
  };
}

/**
 * A2: the lines after the change, by kind and label: an existing line's quantity moves by the
 * delta (refused below 0 or above 999 unless `clamp`, which stops at 0), a new line needs a delta
 * > 0. Returns only the lines that change.
 */
function changeLines(
  current: readonly {
    id: string;
    kind: DeliverableKind;
    label: string | null;
    quantity: number;
    revisionLimit: number | null;
  }[],
  changes: readonly {
    kind: DeliverableKind;
    label?: string | null;
    quantityDelta: number;
    revisionLimit?: number | null;
  }[],
  options: { clamp: boolean },
): LinePlan[] {
  return changes.map((change) => {
    const line = current.find((item) => deliverableKey(item) === deliverableKey(change));
    const quantity = (line?.quantity ?? 0) + change.quantityDelta;
    if (!options.clamp && (quantity < 0 || (!line && change.quantityDelta <= 0))) {
      throw invalidQuantity();
    }
    if (quantity > 999) throw invalidQuantity();
    return {
      kind: change.kind,
      label: line?.label ?? change.label ?? null,
      id: line?.id ?? null,
      quantity: Math.max(0, quantity),
      revisionLimit: line ? line.revisionLimit : (change.revisionLimit ?? null),
    };
  });
}

function presentEffect(effect: AmendmentEffectRow, withMoney: boolean): AmendmentEffect {
  return {
    month: effect.month,
    effect: effect.effect as AmendmentEffect['effect'],
    invoice: withMoney ? effect.invoice : null,
    ...(withMoney && { money: { beforeMinor: effect.beforeMinor, afterMinor: effect.afterMinor } }),
  };
}

function invalidMonth() {
  return new CodedException(
    400,
    'INVALID_EFFECTIVE_MONTH',
    'The effective month is the current month or later, within a term or open-ended',
  );
}

function invalidQuantity() {
  return new CodedException(
    400,
    'INVALID_QUANTITY',
    'A quantity stays between 0 and 999, and a new line needs an increase',
  );
}

function negative() {
  return new CodedException(409, 'NEGATIVE_AMOUNT', 'No month’s amount goes below 0');
}

function limit() {
  return new CodedException(409, 'LIMIT_REACHED', 'The retainer reached a limit');
}
