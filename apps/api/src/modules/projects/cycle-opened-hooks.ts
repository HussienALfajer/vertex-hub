import { Injectable } from '@nestjs/common';
import type { CalendarDate } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A retainer cycle that just opened, inside the transaction that opened it. */
export interface CycleOpened {
  cycleId: string;
  retainerId: string;
  /** The business date the cycle opened on. */
  today: CalendarDate;
  /** Null for the daily job. */
  actor: AuditActor | null;
}

export type CycleOpenedHook = (tx: Transaction, event: CycleOpened) => Promise<void>;

/**
 * Lets other modules act when a cycle opens without `projects` importing them (spec F07, rule 16):
 * the `templates` module generates the cycle's tasks. A hook that throws rolls the opening back.
 */
@Injectable()
export class CycleOpenedHooks {
  private readonly hooks: CycleOpenedHook[] = [];

  register(hook: CycleOpenedHook): void {
    this.hooks.push(hook);
  }

  async run(tx: Transaction, event: CycleOpened): Promise<void> {
    for (const hook of this.hooks) await hook(tx, event);
  }
}
