import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A quote renewal that just applied with a monthly template, inside the applying transaction. */
export interface QuoteRenewalApplied {
  retainerId: string;
  amendmentId: string;
  /** The monthly template the accept dialog chose (F04 A7). */
  templateId: string;
  /** Null for the daily job. */
  actor: AuditActor | null;
}

export type QuoteRenewalHook = (tx: Transaction, event: QuoteRenewalApplied) => Promise<void>;

/**
 * Lets the `templates` module link a quote renewal's monthly template in the renewal's month (F05B
 * Q2, owner decision 2026-10-07: the template changes with the lines), without `projects`
 * importing it. Runs before the month's cycle opens, so the cycle's tasks come from the new template.
 */
@Injectable()
export class QuoteRenewalHooks {
  private readonly hooks: QuoteRenewalHook[] = [];

  register(hook: QuoteRenewalHook): void {
    this.hooks.push(hook);
  }

  async run(tx: Transaction, event: QuoteRenewalApplied): Promise<void> {
    for (const hook of this.hooks) await hook(tx, event);
  }
}
