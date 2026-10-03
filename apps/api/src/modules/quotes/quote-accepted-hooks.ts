import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A quote just accepted, at the end of the transaction that accepted it (F04 A9). */
export interface QuoteAccepted {
  quoteId: string;
  /** The project made from the one-off section, with the milestone of the first installment. */
  project: { id: string; firstInstallmentMilestoneId: string | null } | null;
  actor: AuditActor;
}

export type QuoteAcceptedHook = (tx: Transaction, event: QuoteAccepted) => Promise<void>;

/**
 * Lets other modules act on an acceptance without `quotes` importing them (spec F13, rule 2): the
 * `invoices` module drafts the deposit. A hook that throws rolls the acceptance back.
 */
@Injectable()
export class QuoteAcceptedHooks {
  private readonly hooks: QuoteAcceptedHook[] = [];

  register(hook: QuoteAcceptedHook): void {
    this.hooks.push(hook);
  }

  async run(tx: Transaction, event: QuoteAccepted): Promise<void> {
    for (const hook of this.hooks) await hook(tx, event);
  }
}
