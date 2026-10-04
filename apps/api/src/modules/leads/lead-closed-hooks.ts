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

export interface LeadConversion {
  clientId: string;
  /** The contact the conversion added, or null. */
  contactId: string | null;
  actor: AuditActor;
}

/** What a module does when a lead closes; runs inside the transaction that closes it. */
export interface LeadClosedHook {
  /** Rule 8: returns the display numbers of the quotes it recorded as rejected. */
  lost(tx: Transaction, lead: LeadRef, loss: LeadLoss): Promise<string[]>;
  /** Rule 10: moves the lead's records to the client; returns how many quotes moved. */
  converted(tx: Transaction, lead: LeadRef, conversion: LeadConversion): Promise<number>;
}

/**
 * Lets `quotes` act on a lead's loss and conversion without `leads` importing it (ADR 0026).
 * Hooks run one at a time: a transaction runs on a single connection.
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

  async converted(tx: Transaction, lead: LeadRef, conversion: LeadConversion): Promise<number> {
    let moved = 0;
    for (const hook of this.hooks) moved += await hook.converted(tx, lead, conversion);
    return moved;
  }
}

/** What a module knows about a lead's quotes that the pipeline rules need. */
export interface LeadQuoteCheck {
  /** Rule 5: a latest-version quote of the lead is `sent`. */
  hasSentQuote(executor: Database | Transaction, leadId: string): Promise<boolean>;
  /** Rule 12: the lead has a non-archived quote. */
  hasLiveQuotes(executor: Database | Transaction, leadId: string): Promise<boolean>;
  /** The board cards and the conversion summary: quote numbers per lead, none archived. */
  quoteCounts(executor: Database | Transaction, leadIds: string[]): Promise<Map<string, number>>;
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

  async quoteCounts(
    executor: Database | Transaction,
    leadIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (leadIds.length === 0) return counts;
    for (const check of this.checks) {
      for (const [leadId, value] of await check.quoteCounts(executor, leadIds)) {
        counts.set(leadId, (counts.get(leadId) ?? 0) + value);
      }
    }
    return counts;
  }
}
