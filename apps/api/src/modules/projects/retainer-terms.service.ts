import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  addMonths,
  businessDate,
  type CalendarDate,
  type CancelRetainerTerm,
  type CreateRetainerTerm,
  dayAfterTerm,
  firstOfMonth,
  lastOfMonth,
  type RetainerChargeKind,
  type RetainerChargeStatus,
  type RetainerStatus,
  type RetainerTerm,
  type RetainerTermInput,
  type RetainerTermList,
  type RetainerTermMonth,
  type RetainerTermSummary,
  scheduleMatches,
  TERM_RENEWAL_DAYS,
  type TermEndAction,
  termEndMonth,
  termMonths,
  type UpdateRetainerTerm,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerCharges,
  retainers,
  retainerTerms,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, desc, eq, gt, inArray, isNotNull, max, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { BillingLocks } from './billing-locks.js';
import { actorOf, assertCanEditMoney, seesMoney } from './project-access.js';
import { readableRetainer, workableRetainer } from './retainer-access.js';
import { RetainerCharges } from './retainer-charges.js';

type Executor = Database | Transaction;

type TermRow = typeof retainerTerms.$inferSelect;

/** What a term is made of when it is created (T2–T4). */
interface TermPlan {
  startMonth: CalendarDate;
  months: number;
  agreedTotalMinor: number;
  schedule: number[];
  endAction: TermEndAction;
}

interface ChargeRow {
  id: string;
  month: string;
  kind: RetainerChargeKind;
  amountMinor: number;
  baseAmountMinor: number | null;
  status: RetainerChargeStatus;
  termId: string | null;
  dueAt: Date | null;
}

const chargeColumns = {
  id: retainerCharges.id,
  month: retainerCharges.month,
  kind: retainerCharges.kind,
  amountMinor: retainerCharges.amountMinor,
  baseAmountMinor: retainerCharges.baseAmountMinor,
  status: retainerCharges.status,
  termId: retainerCharges.termId,
  dueAt: retainerCharges.dueAt,
};

const OPEN_STATUSES = ['active', 'scheduled'] as const;

/**
 * Fixed terms of retainers (spec F05B T1–T12, E1–E3, ADR 0029): a term's schedule is its
 * `monthly` charges. Every change holds the retainer row lock (G2) and writes its audit entry in
 * the same transaction (G1); the daily `retainers.cycles` job starts, completes and renews terms.
 */
@Injectable()
export class RetainerTermsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly charges: RetainerCharges,
    private readonly locks: BillingLocks,
    private readonly notifications: NotificationCenter,
  ) {}

  async list(actor: CurrentUserInfo, retainerId: string): Promise<RetainerTermList> {
    const retainer = await readableRetainer(this.db, this.clients, actor, retainerId);
    return { items: await this.present(this.db, retainerId, seesMoney(actor, retainer.client)) };
  }

  async create(
    actor: CurrentUserInfo,
    retainerId: string,
    input: CreateRetainerTerm,
  ): Promise<RetainerTerm> {
    const id = await this.db.transaction(async (tx) => {
      const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
      assertCanEditMoney(actor, retainer.client);
      const term = await this.createIn(tx, actorOf(actor), retainer, input, businessDate());
      return term.id;
    });
    return this.presentOne(actor, retainerId, id);
  }

  /**
   * T2–T4 in the caller's transaction, on a retainer it locked: checks the schedule and the
   * placement, frees an open-ended charge of a month that already began, creates the term and its
   * charges and, when the start month began, marks its charge due (its draft follows, C3, C4).
   */
  async createIn(
    tx: Transaction,
    actor: AuditActor | null,
    retainer: { id: string; startDate: CalendarDate },
    plan: TermPlan,
    today: CalendarDate,
    options: { renewedFromId?: string; quoteId?: string } = {},
  ): Promise<TermRow> {
    assertSchedule(plan);
    await this.assertPlacement(tx, retainer, plan.startMonth, today);
    const active = plan.startMonth <= firstOfMonth(today);
    if (active) await this.freeMonth(tx, retainer.id, plan.startMonth, actor);
    const [top] = await tx
      .select({ value: max(retainerTerms.number) })
      .from(retainerTerms)
      .where(eq(retainerTerms.retainerId, retainer.id));
    const [term] = await tx
      .insert(retainerTerms)
      .values({
        retainerId: retainer.id,
        number: (top?.value ?? 0) + 1,
        startMonth: plan.startMonth,
        months: plan.months,
        endMonth: termEndMonth(plan.startMonth, plan.months),
        agreedTotalMinor: plan.agreedTotalMinor,
        endAction: plan.endAction,
        status: active ? 'active' : 'scheduled',
        renewedFromId: options.renewedFromId ?? null,
        quoteId: options.quoteId ?? null,
      })
      .returning();
    if (!term) throw new Error('Term insert returned no row');
    await this.charges.createTermMonths(
      tx,
      retainer.id,
      term.id,
      termMonths(plan.startMonth, plan.months).map((month, index) => ({
        month,
        amountMinor: plan.schedule[index] ?? 0,
      })),
    );
    await recordAudit(tx, {
      actor,
      action: options.renewedFromId ? 'retainer_term.renewed' : 'retainer_term.created',
      entityType: 'retainer_term',
      entityId: term.id,
      after: {
        number: term.number,
        status: term.status,
        startMonth: term.startMonth,
        endMonth: term.endMonth,
        months: term.months,
        agreedTotalMinor: term.agreedTotalMinor,
        schedule: plan.schedule,
        endAction: term.endAction,
        ...(options.renewedFromId && { renewedFromId: options.renewedFromId }),
        ...(options.quoteId && { quoteId: options.quoteId }),
        retainerId: retainer.id,
      },
    });
    if (active) await this.charges.runDue(tx, retainer.id, today, actor);
    await this.syncRenewalDate(tx, retainer.id, actor);
    return term;
  }

  /** T5: a scheduled term changes every field; an active term its end action only (T10). */
  async update(
    actor: CurrentUserInfo,
    retainerId: string,
    termId: string,
    input: UpdateRetainerTerm,
  ): Promise<RetainerTerm> {
    await this.db.transaction(async (tx) => {
      const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
      assertCanEditMoney(actor, retainer.client);
      const term = await this.term(tx, retainerId, termId);
      assertChangeable(term);
      const today = businessDate();
      const schedule = await this.schedule(tx, term);
      if (term.status === 'active') {
        const changes =
          (input.startMonth !== undefined && input.startMonth !== term.startMonth) ||
          (input.months !== undefined && input.months !== term.months) ||
          (input.agreedTotalMinor !== undefined &&
            input.agreedTotalMinor !== term.agreedTotalMinor) ||
          (input.schedule !== undefined && !sameAmounts(input.schedule, schedule));
        if (changes) {
          throw new CodedException(
            409,
            'TERM_STARTED',
            'A term that started changes its end action only; its amounts change by amendment',
          );
        }
        if (input.endAction && input.endAction !== term.endAction) {
          await this.setEndAction(tx, term, input.endAction, actorOf(actor));
        }
        return;
      }
      await this.reschedule(tx, actorOf(actor), retainer, term, schedule, input, today);
    });
    return this.presentOne(actor, retainerId, termId);
  }

  /** T5: a scheduled term is cancelled with a reason; its charges with it. */
  async cancel(
    actor: CurrentUserInfo,
    retainerId: string,
    termId: string,
    input: CancelRetainerTerm,
  ): Promise<RetainerTerm> {
    await this.db.transaction(async (tx) => {
      const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
      assertCanEditMoney(actor, retainer.client);
      const term = await this.term(tx, retainerId, termId);
      assertChangeable(term);
      if (term.status !== 'scheduled') {
        throw new CodedException(409, 'TERM_STARTED', 'A term that started cannot be cancelled');
      }
      await this.cancelTerm(tx, term, actorOf(actor), { reason: input.reason });
      await this.syncRenewalDate(tx, retainerId, actorOf(actor), { clearWhenNone: true });
    });
    return this.presentOne(actor, retainerId, termId);
  }

  /**
   * F05B Q2: the month a quote renewal takes effect in, per retainer: the month after its active
   * term (`afterTerm`), else next month, and never before the retainer's start month (T2).
   */
  async renewalStarts(
    executor: Executor,
    retainers: readonly { id: string; startDate: CalendarDate }[],
    today: CalendarDate,
  ): Promise<Map<string, { renewsFrom: CalendarDate; afterTerm: boolean }>> {
    const retainerIds = retainers.map((retainer) => retainer.id);
    const active =
      retainerIds.length === 0
        ? []
        : await executor
            .select({ retainerId: retainerTerms.retainerId, endMonth: retainerTerms.endMonth })
            .from(retainerTerms)
            .where(
              and(
                inArray(retainerTerms.retainerId, [...retainerIds]),
                eq(retainerTerms.status, 'active'),
              ),
            );
    const nextMonth = addMonths(firstOfMonth(today), 1);
    return new Map(
      retainers.map(({ id, startDate }) => {
        const term = active.find((row) => row.retainerId === id);
        // A term that ended but the job has not completed yet: next month.
        const candidates = [
          nextMonth,
          firstOfMonth(startDate),
          ...(term ? [dayAfterTerm(term.endMonth)] : []),
        ].sort();
        return [id, { renewsFrom: candidates.at(-1) ?? nextMonth, afterTerm: !!term }];
      }),
    );
  }

  /**
   * F05B Q2 on a retainer the caller locked: a quote renewal replaces the scheduled term; with a
   * term, the new term starts the month after the active term (else next month); without one, an
   * active term continues monthly after it ends. Returns the month the renewal takes effect in.
   */
  async renewForQuote(
    tx: Transaction,
    actor: AuditActor,
    retainer: { id: string; startDate: CalendarDate },
    input: { quoteId: string; term: RetainerTermInput | null },
    today: CalendarDate,
  ): Promise<CalendarDate> {
    const open = await tx
      .select()
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainer.id),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      );
    const active = open.find((term) => term.status === 'active');
    const scheduled = open.find((term) => term.status === 'scheduled');
    const start = (await this.renewalStarts(tx, [retainer], today)).get(retainer.id);
    if (!start) throw new Error('No renewal month');
    if (scheduled) await this.cancelTerm(tx, scheduled, actor, { cause: 'quote_renewal' });
    if (input.term) {
      await this.createIn(
        tx,
        actor,
        retainer,
        { ...input.term, startMonth: start.renewsFrom },
        today,
        { quoteId: input.quoteId },
      );
      return start.renewsFrom;
    }
    if (active && active.endAction !== 'continue') {
      await this.setEndAction(tx, active, 'continue', actor);
    }
    if (scheduled) await this.syncRenewalDate(tx, retainer.id, actor, { clearWhenNone: true });
    return start.renewsFrom;
  }

  /** T11: whether the retainer has an active or scheduled term (its renewal date is derived). */
  async hasOpenTerm(executor: Executor, retainerId: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: retainerTerms.id })
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainerId),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** T2: the first month of the retainer's earliest active or scheduled term, if any. */
  async firstOpenMonth(executor: Executor, retainerId: string): Promise<CalendarDate | null> {
    const [row] = await executor
      .select({ startMonth: retainerTerms.startMonth })
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainerId),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(asc(retainerTerms.startMonth))
      .limit(1);
    return row?.startMonth ?? null;
  }

  /** T11: the end action of the retainer's last active or scheduled term, for the reminder. */
  async lastEndAction(executor: Executor, retainerId: string): Promise<TermEndAction | null> {
    const [row] = await executor
      .select({ endAction: retainerTerms.endAction })
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainerId),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(desc(retainerTerms.endMonth))
      .limit(1);
    return row?.endAction ?? null;
  }

  /**
   * E1: ending a retainer keeps the current month; later `monthly` charges that no live invoice
   * bills are cancelled, and its active and scheduled terms become `cancelled` (`end_month` kept).
   * Pending credits stay (C9).
   */
  async endEarly(
    tx: Transaction,
    retainerId: string,
    today: CalendarDate,
    actor: AuditActor | null,
  ): Promise<void> {
    const open = await tx
      .select()
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainerId),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(asc(retainerTerms.number));
    for (const term of open) {
      await this.cancelTerm(tx, term, actor, { cause: 'retainer_ended', keepCharges: true });
    }
    const later = await tx
      .select(chargeColumns)
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.kind, 'monthly'),
          eq(retainerCharges.status, 'pending'),
          gt(retainerCharges.month, firstOfMonth(today)),
        ),
      )
      .orderBy(asc(retainerCharges.month));
    await this.charges.cancel(tx, later, retainerId, actor);
  }

  /**
   * The job's term steps (spec "Jobs") on a retainer the caller locked: completes active terms
   * whose last month ended, starts the scheduled term whose month began (then completes it too
   * when the job missed its whole span). Returns the day the retainer ends on when a term with
   * end action `end` just completed and no term follows it (T8).
   */
  async advance(
    tx: Transaction,
    retainerId: string,
    status: RetainerStatus,
    today: CalendarDate,
  ): Promise<{ endOn: CalendarDate | null }> {
    const month = firstOfMonth(today);
    const completed = await this.complete(tx, retainerId, month);
    if (status !== 'ended') {
      const [scheduled] = await tx
        .select()
        .from(retainerTerms)
        .where(
          and(eq(retainerTerms.retainerId, retainerId), eq(retainerTerms.status, 'scheduled')),
        );
      if (scheduled && scheduled.startMonth <= month) {
        await tx
          .update(retainerTerms)
          .set({ status: 'active' })
          .where(eq(retainerTerms.id, scheduled.id));
        await this.audit(tx, null, 'retainer_term.started', scheduled, 'scheduled', 'active');
        completed.push(...(await this.complete(tx, retainerId, month)));
      }
    }
    const ending = completed.find((term) => term.endAction === 'end');
    if (status === 'ended' || !ending || (await this.hasOpenTerm(tx, retainerId))) {
      return { endOn: null };
    }
    return { endOn: lastOfMonth(ending.endMonth) };
  }

  /**
   * T7: on the first run on or after 30 days before the end of an active term that renews, with
   * no scheduled term, the next term is scheduled with the same months and the ending term's base
   * amounts by position; the account manager is notified. Returns whether it renewed.
   */
  async renew(
    tx: Transaction,
    retainer: {
      id: string;
      name: string;
      clientId: string;
      startDate: CalendarDate;
      status: RetainerStatus;
    },
    today: CalendarDate,
  ): Promise<boolean> {
    if (retainer.status === 'ended') return false;
    const terms = await tx
      .select()
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainer.id),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      );
    const active = terms.find((term) => term.status === 'active');
    if (active?.endAction !== 'renew') return false;
    if (terms.some((term) => term.status === 'scheduled')) return false;
    // A renewal a manager cancelled (with a reason, T5) stays cancelled; one cancelled by
    // leaving `renew` (T10) comes back when the term renews again.
    const [refused] = await tx
      .select({ id: retainerTerms.id })
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.renewedFromId, active.id),
          eq(retainerTerms.status, 'cancelled'),
          isNotNull(retainerTerms.cancelReason),
        ),
      )
      .limit(1);
    if (refused) return false;
    if (today < addDays(dayAfterTerm(active.endMonth), -TERM_RENEWAL_DAYS)) return false;
    const schedule = await this.schedule(tx, active);
    const term = await this.createIn(
      tx,
      null,
      retainer,
      {
        startMonth: dayAfterTerm(active.endMonth),
        months: active.months,
        agreedTotalMinor: schedule.reduce((total, amount) => total + amount, 0),
        schedule,
        endAction: 'renew',
      },
      today,
      { renewedFromId: active.id },
    );
    const client = await this.clients.summary(retainer.clientId, tx);
    if (client) {
      await this.notifications.notify(tx, {
        type: 'retainer_term_renewed',
        recipients: [client.accountManagerId],
        actorId: null,
        subjectId: retainer.id,
        data: {
          retainer: retainer.name,
          client: client.name,
          termNumber: term.number,
          startMonth: term.startMonth,
          endMonth: term.endMonth,
        },
      });
    }
    return true;
  }

  /** The active term of each retainer, else its scheduled one, without money. */
  async summaries(
    executor: Executor,
    retainerIds: readonly string[],
  ): Promise<Map<string, RetainerTermSummary>> {
    if (retainerIds.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(retainerTerms)
      .where(
        and(
          inArray(retainerTerms.retainerId, [...retainerIds]),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      );
    const chosen = new Map<string, TermRow>();
    for (const row of rows) {
      const current = chosen.get(row.retainerId);
      if (!current || row.status === 'active') chosen.set(row.retainerId, row);
    }
    return new Map([...chosen].map(([id, term]) => [id, summaryOf(term)]));
  }

  /** The retainer's term summary with its money (T6), for its page. */
  async summaryWithMoney(
    executor: Executor,
    retainerId: string,
    withMoney: boolean,
  ): Promise<RetainerTermSummary | null> {
    const summary = (await this.summaries(executor, [retainerId])).get(retainerId);
    if (!summary || !withMoney) return summary ?? null;
    const [term] = await executor
      .select()
      .from(retainerTerms)
      .where(eq(retainerTerms.id, summary.id));
    if (!term) return summary;
    const charges = await this.chargeRows(executor, retainerId);
    return {
      ...summary,
      money: {
        agreedTotalMinor: term.agreedTotalMinor,
        currentTotalMinor: monthsOf(term, charges).reduce(
          (total, month) => total + (month.money?.totalMinor ?? 0),
          0,
        ),
      },
    };
  }

  private async presentOne(
    actor: CurrentUserInfo,
    retainerId: string,
    termId: string,
  ): Promise<RetainerTerm> {
    const { items } = await this.list(actor, retainerId);
    const term = items.find((item) => item.id === termId);
    if (!term) throw new NotFoundException();
    return term;
  }

  private async present(
    executor: Executor,
    retainerId: string,
    withMoney: boolean,
  ): Promise<RetainerTerm[]> {
    const terms = await executor
      .select()
      .from(retainerTerms)
      .where(eq(retainerTerms.retainerId, retainerId))
      .orderBy(desc(retainerTerms.number));
    const charges = await this.chargeRows(executor, retainerId);
    const numbers = new Map(terms.map((term) => [term.id, term.number]));
    return terms.map((term) => {
      const months = monthsOf(term, charges);
      const renewedFromNumber = term.renewedFromId ? numbers.get(term.renewedFromId) : undefined;
      return {
        ...summaryOf(term),
        renewedFrom:
          term.renewedFromId && renewedFromNumber
            ? { id: term.renewedFromId, number: renewedFromNumber }
            : null,
        cancelledAt: term.cancelledAt?.toISOString() ?? null,
        cancelReason: term.cancelReason,
        createdAt: term.createdAt.toISOString(),
        ...(withMoney && {
          money: {
            agreedTotalMinor: term.agreedTotalMinor,
            currentTotalMinor: months.reduce(
              (total, row) => total + (row.money?.totalMinor ?? 0),
              0,
            ),
          },
        }),
        schedule: withMoney ? months : months.map(({ money: _money, ...row }) => row),
      };
    });
  }

  private chargeRows(executor: Executor, retainerId: string): Promise<ChargeRow[]> {
    return executor
      .select(chargeColumns)
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          ne(retainerCharges.kind, 'termination_fee'),
        ),
      )
      .orderBy(asc(retainerCharges.month), asc(retainerCharges.createdAt), asc(retainerCharges.id));
  }

  /** T5 on a scheduled term: new fields, its charges rebuilt month by month. */
  private async reschedule(
    tx: Transaction,
    actor: AuditActor,
    retainer: { id: string; startDate: CalendarDate },
    term: TermRow,
    schedule: number[],
    input: UpdateRetainerTerm,
    today: CalendarDate,
  ): Promise<void> {
    const next: TermPlan = {
      startMonth: input.startMonth ?? term.startMonth,
      months: input.months ?? term.months,
      agreedTotalMinor: input.agreedTotalMinor ?? term.agreedTotalMinor,
      schedule: input.schedule ?? schedule,
      endAction: input.endAction ?? term.endAction,
    };
    const before = {
      startMonth: term.startMonth,
      months: term.months,
      agreedTotalMinor: term.agreedTotalMinor,
      schedule,
      endAction: term.endAction,
    };
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    assertSchedule(next);
    await this.assertPlacement(tx, retainer, next.startMonth, today, term.id);
    const active = next.startMonth <= firstOfMonth(today);
    if (active) await this.freeMonth(tx, retainer.id, next.startMonth, actor);

    const months = termMonths(next.startMonth, next.months);
    const existing = (
      await tx
        .select(chargeColumns)
        .from(retainerCharges)
        .where(and(eq(retainerCharges.termId, term.id), eq(retainerCharges.status, 'pending')))
    ).filter((charge) => charge.kind === 'monthly');
    // Months leaving the term free the unique monthly index before new months take theirs.
    await this.charges.cancel(
      tx,
      existing.filter((charge) => !months.includes(charge.month)),
      retainer.id,
      actor,
    );
    const added: { month: CalendarDate; amountMinor: number }[] = [];
    for (const [index, month] of months.entries()) {
      const amountMinor = next.schedule[index] ?? 0;
      const charge = existing.find((row) => row.month === month);
      if (charge) await this.charges.setScheduleAmount(tx, charge, amountMinor, retainer.id, actor);
      else added.push({ month, amountMinor });
    }
    await this.charges.createTermMonths(tx, retainer.id, term.id, added);
    await tx
      .update(retainerTerms)
      .set({
        startMonth: next.startMonth,
        months: next.months,
        endMonth: termEndMonth(next.startMonth, next.months),
        agreedTotalMinor: next.agreedTotalMinor,
        endAction: next.endAction,
        status: active ? 'active' : 'scheduled',
      })
      .where(eq(retainerTerms.id, term.id));
    await recordAudit(tx, {
      actor,
      action: 'retainer_term.updated',
      entityType: 'retainer_term',
      entityId: term.id,
      before: { ...before, status: term.status },
      after: {
        ...next,
        status: active ? 'active' : 'scheduled',
        number: term.number,
        retainerId: retainer.id,
      },
    });
    if (active) await this.charges.runDue(tx, retainer.id, today, actor);
    await this.syncRenewalDate(tx, retainer.id, actor);
  }

  /** T10: leaving `renew` cancels the term's scheduled renewal. */
  private async setEndAction(
    tx: Transaction,
    term: TermRow,
    endAction: TermEndAction,
    actor: AuditActor,
  ): Promise<void> {
    await tx.update(retainerTerms).set({ endAction }).where(eq(retainerTerms.id, term.id));
    await recordAudit(tx, {
      actor,
      action: 'retainer_term.end_action_changed',
      entityType: 'retainer_term',
      entityId: term.id,
      before: { endAction: term.endAction },
      after: { endAction, number: term.number, retainerId: term.retainerId },
    });
    if (term.endAction !== 'renew' || endAction === 'renew') return;
    const [renewal] = await tx
      .select()
      .from(retainerTerms)
      .where(and(eq(retainerTerms.renewedFromId, term.id), eq(retainerTerms.status, 'scheduled')));
    if (renewal) {
      await this.cancelTerm(tx, renewal, actor, { cause: 'end_action_changed' });
      await this.syncRenewalDate(tx, term.retainerId, actor);
    }
  }

  /** A term becomes `cancelled`; its pending charges too unless `keepCharges` (C10). */
  private async cancelTerm(
    tx: Transaction,
    term: TermRow,
    actor: AuditActor | null,
    options: {
      reason?: string;
      cause?: 'retainer_ended' | 'end_action_changed' | 'quote_renewal';
      keepCharges?: boolean;
    },
  ): Promise<void> {
    await tx
      .update(retainerTerms)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: options.reason ?? null })
      .where(eq(retainerTerms.id, term.id));
    await recordAudit(tx, {
      actor,
      action: 'retainer_term.cancelled',
      entityType: 'retainer_term',
      entityId: term.id,
      before: { status: term.status },
      after: {
        status: 'cancelled',
        number: term.number,
        ...(options.reason && { cancelReason: options.reason }),
        ...(options.cause && { cause: options.cause }),
        retainerId: term.retainerId,
      },
    });
    if (options.keepCharges) return;
    const pending = await tx
      .select(chargeColumns)
      .from(retainerCharges)
      .where(and(eq(retainerCharges.termId, term.id), eq(retainerCharges.status, 'pending')))
      .orderBy(asc(retainerCharges.month));
    await this.charges.cancel(tx, pending, term.retainerId, actor);
  }

  /** Active terms whose last month ended before `month` become `completed`. */
  private async complete(tx: Transaction, retainerId: string, month: CalendarDate) {
    const ended = (
      await tx
        .select()
        .from(retainerTerms)
        .where(and(eq(retainerTerms.retainerId, retainerId), eq(retainerTerms.status, 'active')))
    ).filter((term) => term.endMonth < month);
    for (const term of ended) {
      await tx
        .update(retainerTerms)
        .set({ status: 'completed' })
        .where(eq(retainerTerms.id, term.id));
      await this.audit(tx, null, 'retainer_term.completed', term, 'active', 'completed');
    }
    return ended;
  }

  private audit(
    tx: Transaction,
    actor: AuditActor | null,
    action: 'retainer_term.started' | 'retainer_term.completed',
    term: TermRow,
    from: string,
    to: string,
  ) {
    return recordAudit(tx, {
      actor,
      action,
      entityType: 'retainer_term',
      entityId: term.id,
      before: { status: from },
      after: { status: to, number: term.number, retainerId: term.retainerId },
    });
  }

  /**
   * T2: a term starts in the current month or later, not before the retainer's start month
   * (`INVALID_DATES`), and after every other non-cancelled term, with at most one scheduled
   * (`TERM_OVERLAP`).
   */
  private async assertPlacement(
    tx: Transaction,
    retainer: { id: string; startDate: CalendarDate },
    startMonth: CalendarDate,
    today: CalendarDate,
    exceptId?: string,
  ): Promise<void> {
    if (startMonth < firstOfMonth(today) || startMonth < firstOfMonth(retainer.startDate)) {
      throw new CodedException(
        400,
        'INVALID_DATES',
        'A term starts in the current month or later, and not before the retainer',
      );
    }
    const others = await tx
      .select({ status: retainerTerms.status, endMonth: retainerTerms.endMonth })
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainer.id),
          ne(retainerTerms.status, 'cancelled'),
          exceptId ? ne(retainerTerms.id, exceptId) : undefined,
        ),
      );
    if (others.some((term) => term.status === 'scheduled' || term.endMonth >= startMonth)) {
      throw new CodedException(409, 'TERM_OVERLAP', 'The term overlaps another term');
    }
  }

  /**
   * T4: a month that began may already have a monthly charge (open-ended, or kept by a term
   * cancelled when the retainer ended this month, E1): replaced when no live invoice bills it,
   * else the term is refused (`MONTH_ALREADY_CHARGED`).
   */
  private async freeMonth(
    tx: Transaction,
    retainerId: string,
    month: CalendarDate,
    actor: AuditActor | null,
  ): Promise<void> {
    const charged = await tx
      .select(chargeColumns)
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.month, month),
          eq(retainerCharges.kind, 'monthly'),
          ne(retainerCharges.status, 'cancelled'),
        ),
      );
    for (const charge of charged) {
      if (charge.status !== 'pending' || (await this.locks.chargeInvoiced(tx, charge.id))) {
        throw new CodedException(
          409,
          'MONTH_ALREADY_CHARGED',
          'The month is already invoiced; start the term next month',
        );
      }
    }
    await this.charges.cancel(tx, charged, retainerId, actor);
  }

  /**
   * T11: with an active or scheduled term, the renewal date is the day after its last term.
   * `clearWhenNone`: a cancellation that leaves no such term clears the derived date.
   */
  private async syncRenewalDate(
    tx: Transaction,
    retainerId: string,
    actor: AuditActor | null,
    options: { clearWhenNone?: boolean } = {},
  ): Promise<void> {
    const [last] = await tx
      .select({ endMonth: retainerTerms.endMonth })
      .from(retainerTerms)
      .where(
        and(
          eq(retainerTerms.retainerId, retainerId),
          inArray(retainerTerms.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(desc(retainerTerms.endMonth))
      .limit(1);
    if (!last && !options.clearWhenNone) return;
    const renewalDate = last ? dayAfterTerm(last.endMonth) : null;
    const [row] = await tx
      .select({ renewalDate: retainers.renewalDate })
      .from(retainers)
      .where(eq(retainers.id, retainerId));
    if (!row || row.renewalDate === renewalDate) return;
    await tx.update(retainers).set({ renewalDate }).where(eq(retainers.id, retainerId));
    await recordAudit(tx, {
      actor,
      action: 'retainer.updated',
      entityType: 'retainer',
      entityId: retainerId,
      before: { renewalDate: row.renewalDate },
      after: { renewalDate },
    });
  }

  /** The term's base amount per month, by position (what a renewal copies, T7). */
  private async schedule(executor: Executor, term: TermRow): Promise<number[]> {
    const rows = await executor
      .select(chargeColumns)
      .from(retainerCharges)
      .where(and(eq(retainerCharges.termId, term.id), eq(retainerCharges.kind, 'monthly')))
      .orderBy(asc(retainerCharges.createdAt), asc(retainerCharges.id));
    return termMonths(term.startMonth, term.months).map((month) => {
      const own = rows.filter((row) => row.month === month);
      const charge = own.find((row) => row.status !== 'cancelled') ?? own.at(-1);
      return charge ? (charge.baseAmountMinor ?? charge.amountMinor) : 0;
    });
  }

  private async term(tx: Transaction, retainerId: string, termId: string): Promise<TermRow> {
    const [row] = await tx
      .select()
      .from(retainerTerms)
      .where(and(eq(retainerTerms.id, termId), eq(retainerTerms.retainerId, retainerId)));
    if (!row) throw new NotFoundException();
    return row;
  }
}

/** T3: one amount per month, summing to the agreed total. */
function assertSchedule(plan: TermPlan): void {
  if (!scheduleMatches(plan)) {
    throw new CodedException(
      409,
      'SCHEDULE_TOTAL_MISMATCH',
      'The schedule needs one amount per month, summing to the agreed total',
    );
  }
}

/** A completed term is history; a cancelled one is final. */
function assertChangeable(term: TermRow): void {
  if (term.status === 'cancelled') {
    throw new CodedException(409, 'INVALID_TRANSITION', 'A cancelled term cannot change');
  }
  if (term.status === 'completed') {
    throw new CodedException(409, 'TERM_STARTED', 'A completed term cannot change');
  }
}

function sameAmounts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((amount, index) => amount === b[index]);
}

function summaryOf(term: TermRow): RetainerTermSummary {
  return {
    id: term.id,
    number: term.number,
    status: term.status,
    startMonth: term.startMonth,
    endMonth: term.endMonth,
    months: term.months,
    endAction: term.endAction,
  };
}

/**
 * A term's months with their `monthly` charge (the live one, else the last cancelled) and T6's
 * total: the charge plus the month's additions and credits, unless the term was cancelled.
 */
function monthsOf(term: TermRow, charges: readonly ChargeRow[]): RetainerTermMonth[] {
  return termMonths(term.startMonth, term.months).map((month, index) => {
    const own = charges.filter((row) => row.termId === term.id && row.month === month);
    const charge = own.find((row) => row.status !== 'cancelled') ?? own.at(-1);
    const live = charge && charge.status !== 'cancelled' ? charge.amountMinor : 0;
    // T6: the month's additions and credits count while the term still charges the month. A
    // cancelled month (an early end, a cancelled scheduled term) leaves them to whoever bills it.
    const extras =
      !charge || charge.status === 'cancelled'
        ? 0
        : charges
            .filter(
              (row) =>
                row.month === month &&
                (row.kind === 'addition' || row.kind === 'credit') &&
                row.status !== 'cancelled',
            )
            .reduce((total, row) => total + row.amountMinor, 0);
    return {
      month,
      position: index + 1,
      chargeId: charge?.id ?? null,
      status: charge?.status ?? null,
      due: !!charge?.dueAt,
      money: {
        amountMinor: charge?.amountMinor ?? 0,
        baseAmountMinor: charge?.baseAmountMinor ?? charge?.amountMinor ?? 0,
        totalMinor: live + extras,
      },
    };
  });
}
