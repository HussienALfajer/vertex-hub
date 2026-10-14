import { Injectable } from '@nestjs/common';
import type { CalendarDate } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A retainer cycle that just closed, inside the transaction that closed it. */
export interface CycleClosed {
  cycleId: string;
  retainer: { id: string; name: string; clientId: string };
  number: number;
  periodStart: CalendarDate;
  /** Shortened to the end day when the retainer ended in the cycle (F05C Y4). */
  periodEnd: CalendarDate;
  /** R13 over the frozen counts; null with nothing committed. */
  deliveryRate: number | null;
  /** Null for the daily job. */
  actor: AuditActor | null;
}

export type CycleClosedHook = (tx: Transaction, event: CycleClosed) => Promise<void>;

/**
 * Lets other modules act when a cycle closes, by the job or by ending, without `projects`
 * importing them: the `reports` module prepares the cycle report (spec F05C R1). Backdated cycles
 * are recorded closed and never close here. A hook that throws rolls the closing back.
 */
@Injectable()
export class CycleClosedHooks {
  private readonly hooks: CycleClosedHook[] = [];

  register(hook: CycleClosedHook): void {
    this.hooks.push(hook);
  }

  async run(tx: Transaction, event: CycleClosed): Promise<void> {
    for (const hook of this.hooks) await hook(tx, event);
  }
}
