import { Injectable, NotFoundException } from '@nestjs/common';
import { type CalendarDate, firstOfMonth, type MonthEffect } from '@vertex-hub/contracts';
import {
  type Database,
  retainerCharges,
  retainerCycles,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { BillingLocks } from './billing-locks.js';
import { ChargeInvoices } from './charge-invoices.js';
import { RetainerChargeDueHooks } from './retainer-charge-due-hooks.js';

/**
 * The charges of retainers (spec F05B, ADR 0029): every billable amount of a retainer is a charge
 * that invoices bill. Callers hold the retainer row lock (G2).
 */
@Injectable()
export class RetainerCharges {
  constructor(
    private readonly dueHooks: RetainerChargeDueHooks,
    private readonly locks: BillingLocks,
    private readonly invoices: ChargeInvoices,
  ) {}

  /** T4: a term's `monthly` charges, one per month, its schedule (`base` = the amount). */
  async createTermMonths(
    tx: Transaction,
    retainerId: string,
    termId: string,
    months: { month: CalendarDate; amountMinor: number }[],
  ): Promise<void> {
    if (months.length === 0) return;
    await tx.insert(retainerCharges).values(
      months.map(({ month, amountMinor }) => ({
        retainerId,
        termId,
        month,
        kind: 'monthly' as const,
        amountMinor,
        baseAmountMinor: amountMinor,
      })),
    );
  }

  /**
   * T5: a scheduled term's month gets a new schedule amount (its charge is not due and on no
   * invoice: drafts start in the term's first month).
   */
  async setScheduleAmount(
    tx: Transaction,
    charge: { id: string; month: CalendarDate; amountMinor: number },
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
      after: { month: charge.month, amountMinor, retainerId },
    });
  }

  /**
   * C10: pending charges become `cancelled` unless a live invoice bills them. Returns how many
   * were cancelled.
   */
  async cancel(
    tx: Transaction,
    charges: { id: string; month: CalendarDate; kind: string; amountMinor: number }[],
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
          month: charge.month,
          kind: charge.kind,
          amountMinor: charge.amountMinor,
          retainerId,
        },
      });
      cancelled += 1;
    }
    return cancelled;
  }

  /** E2: an early termination fee of the current month, due at once (its draft follows, C4). */
  async createTerminationFee(
    tx: Transaction,
    retainerId: string,
    today: CalendarDate,
    termination: { feeMinor: number; reason: string },
    actor: AuditActor | null,
  ): Promise<void> {
    const month = firstOfMonth(today);
    const [created] = await tx
      .insert(retainerCharges)
      .values({ retainerId, month, kind: 'termination_fee', amountMinor: termination.feeMinor })
      .returning({ id: retainerCharges.id });
    if (!created) throw new Error('Charge insert returned no row');
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.created',
      entityType: 'retainer_charge',
      entityId: created.id,
      after: {
        month,
        kind: 'termination_fee',
        amountMinor: termination.feeMinor,
        reason: termination.reason,
        retainerId,
      },
    });
    await this.runDue(tx, retainerId, today, actor);
  }

  /**
   * C2: an open-ended month's `monthly` charge at the retainer's fee, when the fee is > 0 and the
   * month has none yet.
   */
  async createMonthly(
    tx: Transaction,
    retainerId: string,
    month: CalendarDate,
    feeMinor: number | null,
    actor: AuditActor | null,
  ): Promise<void> {
    if (!feeMinor || feeMinor <= 0) return;
    const [created] = await tx
      .insert(retainerCharges)
      .values({ retainerId, month, kind: 'monthly', amountMinor: feeMinor })
      .onConflictDoNothing()
      .returning();
    if (!created) return;
    await recordAudit(tx, {
      actor,
      action: 'retainer_charge.created',
      entityType: 'retainer_charge',
      entityId: created.id,
      after: { month, kind: created.kind, amountMinor: created.amountMinor, retainerId },
    });
  }

  /**
   * C2 for a fee set after the month's cycle opened without one (F05 M4 "fee missing"): the
   * cycle's month gets its charge at the new fee, due at once, as if the cycle had opened with it.
   */
  async chargeOpenMonth(
    tx: Transaction,
    retainerId: string,
    today: CalendarDate,
    feeMinor: number | null,
    actor: AuditActor | null,
  ): Promise<void> {
    const month = firstOfMonth(today);
    const [cycle] = await tx
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .where(
        and(
          eq(retainerCycles.retainerId, retainerId),
          eq(retainerCycles.month, month),
          eq(retainerCycles.status, 'open'),
        ),
      );
    if (!cycle) return;
    await this.createMonthly(tx, retainerId, month, feeMinor, actor);
    await this.runDue(tx, retainerId, today, actor);
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
   * C6 for one month, as planned by `planMonthChange`: a free charge changes; a draft's charge
   * changes and the draft follows; an issued month gets an `addition` or a `credit` of the
   * difference, due at once (its draft follows, C4). `onward` amounts also move the month's base
   * (what a renewal copies, A3, T7); `amendmentId` names the addition or credit's amendment.
   */
  async changeMonth(
    tx: Transaction,
    retainerId: string,
    charge: { id: string; month: CalendarDate; amountMinor: number; dueAt: Date | null },
    effect: MonthEffect,
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
          month: charge.month,
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
          month: charge.month,
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
      after: { month: charge.month, amountMinor, amendmentId: options.amendmentId, retainerId },
    });
    if (effect.effect === 'draft_synced') {
      await this.invoices.syncDraft(tx, charge.id, amountMinor, actor);
      return;
    }
    // C6: a due month that never drafted (its amount was 0) drafts once its amount is > 0.
    if (charge.dueAt && charge.amountMinor <= 0 && amountMinor > 0) {
      await this.dueHooks.run(tx, {
        chargeId: charge.id,
        retainerId,
        kind: 'monthly',
        month: charge.month,
        amountMinor,
        actor,
      });
    }
  }

  /** A6: a reschedule's new amount for a month that no issued invoice bills (C6, base follows). */
  async reschedule(
    tx: Transaction,
    retainerId: string,
    charge: { id: string; month: CalendarDate; amountMinor: number; dueAt: Date | null },
    amountMinor: number,
    options: { amendmentId: string; draft: boolean; today: CalendarDate; actor: AuditActor },
  ): Promise<void> {
    const deltaMinor = amountMinor - charge.amountMinor;
    if (deltaMinor === 0) return;
    await this.changeMonth(
      tx,
      retainerId,
      charge,
      {
        month: charge.month,
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
   * month's draft takes, and what is owed to the client, C9).
   */
  async pendingCredits(
    executor: Database | Transaction,
    retainerId: string,
    tx?: Transaction,
  ): Promise<{ id: string; month: CalendarDate; amountMinor: number }[]> {
    const rows = await executor
      .select({
        id: retainerCharges.id,
        month: retainerCharges.month,
        amountMinor: retainerCharges.amountMinor,
      })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.kind, 'credit'),
          eq(retainerCharges.status, 'pending'),
          isNotNull(retainerCharges.dueAt),
        ),
      )
      .orderBy(asc(retainerCharges.month), asc(retainerCharges.createdAt), asc(retainerCharges.id));
    if (!tx) return rows;
    const free = [];
    for (const row of rows) if (!(await this.locks.chargeInvoiced(tx, row.id))) free.push(row);
    return free;
  }

  /**
   * C5: a credit larger than what its draft could take keeps `appliedMinor`; the remainder
   * becomes a new pending credit of the same month, due at once, split from it.
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
        month: credit.month,
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
    // G2: the retainer lock orders this with the month drafts that take credits (C5).
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
        month: charge.month,
        amountMinor: charge.amountMinor,
        retainerId,
      },
    });
  }

  /** A3, T7: an onward amount moves a term month's base (open-ended months have none). */
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
   * charge from the first day of its month, any other kind at once) get `due_at`, then the due
   * hooks run for each, oldest month first, in the caller's transaction.
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
        month: retainerCharges.month,
        amountMinor: retainerCharges.amountMinor,
      })
      .from(retainerCharges)
      .where(
        and(
          eq(retainerCharges.retainerId, retainerId),
          eq(retainerCharges.status, 'pending'),
          isNull(retainerCharges.dueAt),
          or(ne(retainerCharges.kind, 'monthly'), lte(retainerCharges.month, firstOfMonth(today))),
        ),
      )
      .orderBy(asc(retainerCharges.month), asc(retainerCharges.createdAt), asc(retainerCharges.id));
    for (const charge of due) {
      await tx
        .update(retainerCharges)
        .set({ dueAt: new Date() })
        .where(eq(retainerCharges.id, charge.id));
      await this.dueHooks.run(tx, { chargeId: charge.id, retainerId, ...charge, actor });
    }
    return due.length;
  }
}
