import { Injectable } from '@nestjs/common';
import type { RetainerChargeKind } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A retainer charge that just became due, inside the transaction that marked it (F05B C3). */
export interface RetainerChargeDue {
  chargeId: string;
  retainerId: string;
  kind: RetainerChargeKind;
  /** The retainer cycle the charge belongs to (F05C). */
  cycle: number;
  amountMinor: number;
  /** Null for the daily job. */
  actor: AuditActor | null;
}

export type RetainerChargeDueHook = (tx: Transaction, event: RetainerChargeDue) => Promise<void>;

/**
 * Lets other modules act when a retainer charge becomes due without `projects` importing them
 * (spec F05B C3, C4): the `invoices` module drafts its invoice. A hook that throws rolls the
 * change back.
 */
@Injectable()
export class RetainerChargeDueHooks {
  private readonly hooks: RetainerChargeDueHook[] = [];

  register(hook: RetainerChargeDueHook): void {
    this.hooks.push(hook);
  }

  async run(tx: Transaction, event: RetainerChargeDue): Promise<void> {
    for (const hook of this.hooks) await hook(tx, event);
  }
}
