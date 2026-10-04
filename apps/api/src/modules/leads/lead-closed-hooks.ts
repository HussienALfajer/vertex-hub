import { Injectable } from '@nestjs/common';
import type { CalendarDate, LeadLossReason } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A lead as the hooks see it. */
export interface LeadRef {
  id: string;
  displayName: string;
  ownerId: string;
}

export interface LeadLoss {
  reason: LeadLossReason;
  note: string | null;
  actor: AuditActor;
  today: CalendarDate;
}

/** What a module does when a lead closes; runs inside the transaction that closes it. */
export interface LeadClosedHook {
  /** Rule 8: returns the display numbers of the quotes it recorded as rejected. */
  lost(tx: Transaction, lead: LeadRef, loss: LeadLoss): Promise<string[]>;
}

/**
 * Lets `quotes` act on a lead's loss without `leads` importing it (ADR 0026). Hooks run one at a
 * time: a transaction runs on a single connection.
 */
@Injectable()
export class LeadClosedHooks {
  private readonly hooks: LeadClosedHook[] = [];

  register(hook: LeadClosedHook): void {
    this.hooks.push(hook);
  }

  async lost(tx: Transaction, lead: LeadRef, loss: LeadLoss): Promise<string[]> {
    const rejected: string[] = [];
    for (const hook of this.hooks) rejected.push(...(await hook.lost(tx, lead, loss)));
    return rejected;
  }
}

/** What a module knows about a lead's quotes that the pipeline rules need. */
export interface LeadQuoteCheck {
  /** Rule 5: a latest-version quote of the lead is `sent`. */
  hasSentQuote(executor: Database | Transaction, leadId: string): Promise<boolean>;
  /** Rule 12: the lead has a non-archived quote. */
  hasLiveQuotes(executor: Database | Transaction, leadId: string): Promise<boolean>;
}

/** Lets `quotes` answer the pipeline's questions about a lead's quotes (ADR 0026). */
@Injectable()
export class LeadQuoteChecks {
  private readonly checks: LeadQuoteCheck[] = [];

  register(check: LeadQuoteCheck): void {
    this.checks.push(check);
  }

  async hasSentQuote(executor: Database | Transaction, leadId: string): Promise<boolean> {
    for (const check of this.checks) if (await check.hasSentQuote(executor, leadId)) return true;
    return false;
  }

  async hasLiveQuotes(executor: Database | Transaction, leadId: string): Promise<boolean> {
    for (const check of this.checks) if (await check.hasLiveQuotes(executor, leadId)) return true;
    return false;
  }
}
