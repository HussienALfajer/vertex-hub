import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A milestone just marked done, inside the transaction that marked it. */
export interface MilestoneDone {
  milestoneId: string;
  projectId: string;
  actor: AuditActor;
}

export type MilestoneDoneHook = (tx: Transaction, event: MilestoneDone) => Promise<void>;

/**
 * Lets other modules act when a milestone is done without `projects` importing them (spec F13,
 * rule 3): the `invoices` module drafts the milestone's installment. A hook that throws rolls the
 * completion back.
 */
@Injectable()
export class MilestoneDoneHooks {
  private readonly hooks: MilestoneDoneHook[] = [];

  register(hook: MilestoneDoneHook): void {
    this.hooks.push(hook);
  }

  async run(tx: Transaction, event: MilestoneDone): Promise<void> {
    for (const hook of this.hooks) await hook(tx, event);
  }
}
