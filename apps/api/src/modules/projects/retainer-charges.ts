import { Injectable } from '@nestjs/common';
import { type CalendarDate, firstOfMonth } from '@vertex-hub/contracts';
import { retainerCharges, retainerCycles, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { RetainerChargeDueHooks } from './retainer-charge-due-hooks.js';

/**
 * The charges of retainers (spec F05B, ADR 0029): every billable amount of a retainer is a charge
 * that invoices bill. Callers hold the retainer row lock (G2).
 */
@Injectable()
export class RetainerCharges {
  constructor(private readonly dueHooks: RetainerChargeDueHooks) {}

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
