import { Injectable } from '@nestjs/common';
import { type CalendarDate, firstOfMonth } from '@vertex-hub/contracts';
import { retainerCharges, retainerCycles, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { BillingLocks } from './billing-locks.js';
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
