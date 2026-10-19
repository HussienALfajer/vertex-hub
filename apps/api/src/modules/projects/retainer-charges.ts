import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CalendarDate,
  type CatchUpBilling,
  type CycleEffect,
  cyclePeriod,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerCharges,
  retainerCycles,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { RETAINER_BILLED_OUTSIDE_NOTE } from '@vertex-hub/messages';
import { and, asc, desc, eq, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { BillingLocks } from './billing-locks.js';
import { ChargeInvoices } from './charge-invoices.js';
import { RetainerChargeDueHooks } from './retainer-charge-due-hooks.js';

/** A retainer cycle a charge belongs to: its number and its `cyclePeriod` start (F05C). */
export interface ChargeCycle {
  number: number;
  start: CalendarDate;
}

/** A cycle's live `monthly` charge, as amendments change it (C6). */
export interface CycleCharge {
  id: string;
  cycle: ChargeCycle;
  amountMinor: number;
  dueAt: Date | null;
}

/** A charge row's cycle. */
export const chargeCycleOf = (row: {
  cycleNumber: number;
  cycleStart: CalendarDate;
}): ChargeCycle => ({ number: row.cycleNumber, start: row.cycleStart });

/**
 * The charges of retainers (spec F05B, ADR 0029): every billable amount of a retainer is a charge
 * that invoices bill, in a cycle of the retainer (F05C). Callers hold the retainer row lock (G2).
 */
@Injectable()
export class RetainerCharges {
  constructor(
    private readonly dueHooks: RetainerChargeDueHooks,
    private readonly locks: BillingLocks,
    private readonly invoices: ChargeInvoices,
  ) {}

  /** T4: a term's `monthly` charges, one per cycle, its schedule (`base` = the amount). */
  async createTermCycles(
    tx: Transaction,
    retainerId: string,
    termId: string,
    cycles: { cycle: ChargeCycle; amountMinor: number }[],
  ): Promise<void> {
    if (cycles.length === 0) return;
    await tx.insert(retainerCharges).values(
      cycles.map(({ cycle, amountMinor }) => ({
        retainerId,
        termId,
        cycleNumber: cycle.number,
        cycleStart: cycle.start,
        kind: 'monthly' as const,
        amountMinor,
        baseAmountMinor: amountMinor,
      })),
    );
  }

  /**
   * T5: a scheduled term's cycle gets a new schedule amount (its charge is not due and on no
   * invoice: drafts start in the term's first cycle).
   */
  async setScheduleAmount(
    tx: Transaction,
    charge: { id: string; cycle: number; amountMinor: number },
    amountMinor: number,
    retainerId: string,
    actor: AuditActor | null,
  ): Promise<void> {
    if (charge.amountMinor === amountMinor) return;
    await tx
      .update(retainerCharges)
      .set({ amountMinor, baseAmountMinor: amountMinor })
      .where(eq(retainerCharges.id, charge.id));
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.amount_changed',
      entityType: 'retainer_charge',
      entityId: charge.id,
      before: { amountMinor: charge.amountMinor },
      after: { cycle: charge.cycle, amountMinor, retainerId },
    });
  }

  /**
   * C10: pending charges become `cancelled` unless a live invoice bills them. Returns how many
   * were cancelled.
   */
  async cancel(
    tx: Transaction,
    charges: { id: string; cycle: number; kind: string; amountMinor: number }[],
    retainerId: string,
    actor: AuditActor | null,
  ): Promise<number> {
    let cancelled = 0;
    for (const charge of charges) {
      if (await this.locks.chargeInvoiced(tx, charge.id)) continue;
      await tx
        .update(retainerCharges)
        .set({ status: 'cancelled' })
        .where(and(eq(retainerCharges.id, charge.id), eq(retainerCharges.status, 'pending')));
      await recordAudit(tx, {
        actor,
        action: 'retainer_charge.cancelled',
        entityType: 'retainer_charge',
        entityId: charge.id,
        before: { status: 'pending' },
        after: {
          status: 'cancelled',
          cycle: charge.cycle,
          kind: charge.kind,
          amountMinor: charge.amountMinor,
          retainerId,
        },
      });
      cancelled += 1;
    }
    return cancelled;
  }

  /** E2: an early termination fee of the current cycle, due at once (its draft follows, C4). */
  async createTerminationFee(
    tx: Transaction,
    retainerId: string,
    cycle: ChargeCycle,
    today: CalendarDate,
    termination: { feeMinor: number; reason: string },
    actor: AuditActor | null,
  ): Promise<void> {
    const [created] = await tx
      .insert(retainerCharges)
      .values({
        retainerId,
        cycleNumber: cycle.number,
        cycleStart: cycle.start,
        kind: 'termination_fee',
        amountMinor: termination.feeMinor,
      })
      .returning({ id: retainerCharges.id });
    if (!created) throw new Error('Charge insert returned no row');
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.created',
      entityType: 'retainer_charge',
      entityId: created.id,
      after: {
        cycle: cycle.number,
        kind: 'termination_fee',
        amountMinor: termination.feeMinor,
        reason: termination.reason,
        retainerId,
      },
    });
    await this.runDue(tx, retainerId, today, actor);
  }

  /**
   * C2: an open-ended cycle's `monthly` charge at the retainer's fee, when the fee is > 0 and the
   * cycle has none yet (a term cycle has its schedule's).
   */
  async createMonthly(
    tx: Transaction,
    retainerId: string,
    cycle: ChargeCycle,
    feeMinor: number | null,
    actor: AuditActor | null,
  ): Promise<void> {
    if (!feeMinor || feeMinor <= 0) return;
    const [created] = await tx
      .insert(retainerCharges)
      .values({
        retainerId,
        cycleNumber: cycle.number,
        cycleStart: cycle.start,
        kind: 'monthly',
        amountMinor: feeMinor,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) return;
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.created',
      entityType: 'retainer_charge',
      entityId: created.id,
      after: {
        cycle: cycle.number,
        kind: created.kind,
        amountMinor: created.amountMinor,
        retainerId,
      },
    });
  }

  /**
   * C2 for a fee set after the cycle opened without one (F05 M4 "fee missing"): the open cycle
   * gets its charge at the new fee, due at once, as if it had opened with it.
   */
  async chargeOpenCycle(
    tx: Transaction,
    retainer: { id: string; startDate: CalendarDate },
    today: CalendarDate,
    feeMinor: number | null,
    actor: AuditActor | null,
  ): Promise<void> {
    const [cycle] = await tx
      .select({ number: retainerCycles.number })
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainer.id), eq(retainerCycles.status, 'open')))
      .orderBy(desc(retainerCycles.number))
      .limit(1);
    if (!cycle?.number) return;
    const start = cyclePeriod(retainer.startDate, cycle.number).periodStart;
    await this.createMonthly(tx, retainer.id, { number: cycle.number, start }, feeMinor, actor);
    await this.runDue(tx, retainer.id, today, actor);
  }

  /**
   * F05C B3: a past cycle of a backdated retainer gets its `monthly` charge: the term's schedule
   * amount (created with the term) or the fee, none for no amount. `billed_externally` settles it
   * outside the system at once (it never drafts); `draft_now` leaves it pending, so the caller's
   * `runDue` drafts it. Returns the charged amount, null without a charge.
   */
  async catchUp(
    tx: Transaction,
    retainerId: string,
    cycle: ChargeCycle,
    billing: CatchUpBilling,
    feeMinor: number | null,
    actor: AuditActor | null,
  ): Promise<number | null> {
    await this.createMonthly(tx, retainerId, cycle, feeMinor, actor);
    const [charge] = await tx
      .select({ id: retainerCharges.id, amountMinor: retainerCharges.amountMinor })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.cycleNumber, cycle.number),
          eq(retainerCharges.kind, 'monthly'),
          eq(retainerCharges.status, 'pending'),
        ),
      );
    // B3: a term cycle of 0 bills nothing, as any term cycle of 0.
    if (!charge || charge.amountMinor <= 0) return null;
    if (billing === 'billed_externally') {
      await tx
        .update(retainerCharges)
        .set({ status: 'settled_outside', settleNote: RETAINER_BILLED_OUTSIDE_NOTE })
        .where(eq(retainerCharges.id, charge.id));
      await recordAudit(tx, {
        actor,
        action: 'retainer_charge.settled_outside',
        entityType: 'retainer_charge',
        entityId: charge.id,
        before: { status: 'pending' },
        after: {
          status: 'settled_outside',
          settleNote: RETAINER_BILLED_OUTSIDE_NOTE,
          cycle: cycle.number,
          amountMinor: charge.amountMinor,
          retainerId,
        },
      });
    }
    return charge.amountMinor;
  }

  /** Edge case 12: a retainer with a charge keeps its currency. */
  async hasCharges(tx: Transaction, retainerId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: retainerCharges.id })
      .from(retainerCharges)
      .where(eq(retainerCharges.retainerId, retainerId))
      .limit(1);
    return !!row;
  }

  /**
   * C6 for one cycle, as planned by `planCycleChange`: a free charge changes; a draft's charge
   * changes and the draft follows; an issued cycle gets an `addition` or a `credit` of the
   * difference, due at once (its draft follows, C4). `onward` amounts also move the cycle's base
   * (what a renewal copies, A3, T7); `amendmentId` names the addition or credit's amendment.
   */
  async changeCycle(
    tx: Transaction,
    retainerId: string,
    charge: CycleCharge,
    effect: CycleEffect,
    options: {
      deltaMinor: number;
      onward: boolean;
      amendmentId: string;
      today: CalendarDate;
      actor: AuditActor | null;
    },
  ): Promise<void> {
    const { deltaMinor, onward, actor } = options;
    if (effect.effect === 'addition' || effect.effect === 'credit') {
      if (onward) await this.moveBase(tx, charge.id, deltaMinor);
      const [created] = await tx
        .insert(retainerCharges)
        .values({
          retainerId,
          cycleNumber: charge.cycle.number,
          cycleStart: charge.cycle.start,
          kind: effect.effect,
          amountMinor: deltaMinor,
          amendmentId: options.amendmentId,
        })
        .returning({ id: retainerCharges.id });
      if (!created) throw new Error('Charge insert returned no row');
      await recordAudit(tx, {
        actor,
        action: 'retainer_charge.created',
        entityType: 'retainer_charge',
        entityId: created.id,
        after: {
          cycle: charge.cycle.number,
          kind: effect.effect,
          amountMinor: deltaMinor,
          amendmentId: options.amendmentId,
          retainerId,
        },
      });
      await this.runDue(tx, retainerId, options.today, actor);
      return;
    }
    const amountMinor = charge.amountMinor + deltaMinor;
    await tx
      .update(retainerCharges)
      .set({ amountMinor, updatedAt: new Date() })
      .where(eq(retainerCharges.id, charge.id));
    if (onward) await this.moveBase(tx, charge.id, deltaMinor);
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.amount_changed',
      entityType: 'retainer_charge',
      entityId: charge.id,
      before: { amountMinor: charge.amountMinor },
      after: {
        cycle: charge.cycle.number,
        amountMinor,
        amendmentId: options.amendmentId,
        retainerId,
      },
    });
    if (effect.effect === 'draft_synced') {
      await this.invoices.syncDraft(tx, charge.id, amountMinor, actor);
      return;
    }
    // C6: a due cycle that never drafted (its amount was 0) drafts once its amount is > 0.
    if (charge.dueAt && charge.amountMinor <= 0 && amountMinor > 0) {
      await this.dueHooks.run(tx, {
        chargeId: charge.id,
        retainerId,
        kind: 'monthly',
        cycle: charge.cycle.number,
        amountMinor,
        actor,
      });
    }
  }

  /** A6: a reschedule's new amount for a cycle that no issued invoice bills (C6, base follows). */
  async reschedule(
    tx: Transaction,
    retainerId: string,
    charge: CycleCharge,
    amountMinor: number,
    options: { amendmentId: string; draft: boolean; today: CalendarDate; actor: AuditActor },
  ): Promise<void> {
    const deltaMinor = amountMinor - charge.amountMinor;
    if (deltaMinor === 0) return;
    await this.changeCycle(
      tx,
      retainerId,
      charge,
      {
        cycle: charge.cycle.number,
        effect: options.draft ? 'draft_synced' : 'charge_changed',
        beforeMinor: charge.amountMinor,
        afterMinor: amountMinor,
        invoice: null,
      },
      { ...options, deltaMinor, onward: true },
    );
  }

  /**
   * C5: the retainer's due, pending credits that no live invoice bills, oldest first (what a
   * cycle's draft takes, and what is owed to the client, C9).
   */
  async pendingCredits(
    executor: Database | Transaction,
    retainerId: string,
    tx?: Transaction,
  ): Promise<{ id: string; amountMinor: number }[]> {
    const rows = await executor
      .select({ id: retainerCharges.id, amountMinor: retainerCharges.amountMinor })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.kind, 'credit'),
          eq(retainerCharges.status, 'pending'),
          isNotNull(retainerCharges.dueAt),
        ),
      )
      .orderBy(
        asc(retainerCharges.cycleNumber),
        asc(retainerCharges.createdAt),
        asc(retainerCharges.id),
      );
    if (!tx) return rows;
    const free = [];
    for (const row of rows) if (!(await this.locks.chargeInvoiced(tx, row.id))) free.push(row);
    return free;
  }

  /**
   * C5: a credit larger than what its draft could take keeps `appliedMinor`; the remainder
   * becomes a new pending credit of the same cycle, due at once, split from it.
   */
  async splitCredit(
    tx: Transaction,
    chargeId: string,
    split: { appliedMinor: number; remainderMinor: number },
    actor: AuditActor | null,
  ): Promise<void> {
    const [credit] = await tx
      .update(retainerCharges)
      .set({ amountMinor: split.appliedMinor, updatedAt: new Date() })
      .where(eq(retainerCharges.id, chargeId))
      .returning();
    if (!credit) throw new NotFoundException();
    const [remainder] = await tx
      .insert(retainerCharges)
      .values({
        retainerId: credit.retainerId,
        cycleNumber: credit.cycleNumber,
        cycleStart: credit.cycleStart,
        kind: 'credit',
        amountMinor: split.remainderMinor,
        amendmentId: credit.amendmentId,
        splitFromId: credit.id,
        dueAt: new Date(),
      })
      .returning({ id: retainerCharges.id });
    if (!remainder) throw new Error('Charge insert returned no row');
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.split',
      entityType: 'retainer_charge',
      entityId: credit.id,
      before: { amountMinor: split.appliedMinor + split.remainderMinor },
      after: {
        amountMinor: split.appliedMinor,
        remainderId: remainder.id,
        remainderMinor: split.remainderMinor,
        retainerId: credit.retainerId,
      },
    });
  }

  /**
   * C9: a pending credit that no live invoice bills is marked settled outside the system, with a
   * note (`INVALID_TRANSITION` otherwise).
   */
  async settleOutside(
    tx: Transaction,
    retainerId: string,
    chargeId: string,
    note: string,
    actor: AuditActor,
  ): Promise<void> {
    // G2: the retainer lock orders this with the cycle drafts that take credits (C5).
    await tx
      .select({ id: retainers.id })
      .from(retainers)
      .where(eq(retainers.id, retainerId))
      .for('update');
    const [charge] = await tx
      .select()
      .from(retainerCharges)
      .where(and(eq(retainerCharges.id, chargeId), eq(retainerCharges.retainerId, retainerId)))
      .for('update');
    if (!charge) throw new NotFoundException();
    if (
      charge.kind !== 'credit' ||
      charge.status !== 'pending' ||
      (await this.locks.chargeInvoiced(tx, chargeId))
    ) {
      throw new CodedException(
        409,
        'INVALID_TRANSITION',
        'Only a pending credit that no live invoice bills is settled outside',
      );
    }
    await tx
      .update(retainerCharges)
      .set({ status: 'settled_outside', settleNote: note, updatedAt: new Date() })
      .where(eq(retainerCharges.id, chargeId));
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.settled_outside',
      entityType: 'retainer_charge',
      entityId: chargeId,
      before: { status: 'pending' },
      after: {
        status: 'settled_outside',
        settleNote: note,
        cycle: charge.cycleNumber,
        amountMinor: charge.amountMinor,
        retainerId,
      },
    });
  }

  /** A3, T7: an onward amount moves a term cycle's base (open-ended cycles have none). */
  private async moveBase(tx: Transaction, chargeId: string, deltaMinor: number): Promise<void> {
    const [charge] = await tx
      .select({ baseAmountMinor: retainerCharges.baseAmountMinor })
      .from(retainerCharges)
      .where(eq(retainerCharges.id, chargeId));
    if (charge?.baseAmountMinor == null) return;
    await tx
      .update(retainerCharges)
      .set({ baseAmountMinor: Math.max(0, charge.baseAmountMinor + deltaMinor) })
      .where(eq(retainerCharges.id, chargeId));
  }

  /**
   * C3: the retainer's pending charges that are due on `today` and were never marked (a `monthly`
   * charge from the first day of its cycle, any other kind at once) get `due_at`, then the due
   * hooks run for each, oldest cycle first, in the caller's transaction.
   */
  async runDue(
    tx: Transaction,
    retainerId: string,
    today: CalendarDate,
    actor: AuditActor | null,
  ): Promise<number> {
    const due = await tx
      .select({
        id: retainerCharges.id,
        kind: retainerCharges.kind,
        cycle: retainerCharges.cycleNumber,
        amountMinor: retainerCharges.amountMinor,
      })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.status, 'pending'),
          isNull(retainerCharges.dueAt),
          or(ne(retainerCharges.kind, 'monthly'), lte(retainerCharges.cycleStart, today)),
        ),
      )
      .orderBy(
        asc(retainerCharges.cycleNumber),
        asc(retainerCharges.createdAt),
        asc(retainerCharges.id),
      );
    for (const charge of due) {
      await tx
        .update(retainerCharges)
        .set({ dueAt: new Date() })
        .where(eq(retainerCharges.id, charge.id));
      await this.dueHooks.run(tx, {
        chargeId: charge.id,
        retainerId,
        ...charge,
        actor,
      });
    }
    return due.length;
  }
}
