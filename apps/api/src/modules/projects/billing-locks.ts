import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import { CodedException } from '../../core/errors/index.js';

/** What the module that owns invoices answers about projects' billable work (F13, rule 25). */
export interface BillingLockSource {
  /** Whether a live invoice (a draft or a non-void issued one) bills the milestone or item. */
  invoiced(
    tx: Transaction,
    source: { type: 'milestone' | 'extra_work'; id: string },
  ): Promise<boolean>;
  /** Whether the project or retainer has invoices that are not discarded drafts. */
  engagementInvoiced(
    tx: Transaction,
    engagement: { type: 'project' | 'retainer'; id: string },
  ): Promise<boolean>;
}

/**
 * Lets the `invoices` module lock billed work without `projects` importing it (spec F13, rules
 * 24 and 25). Until a source registers, nothing is locked.
 */
@Injectable()
export class BillingLocks {
  private source: BillingLockSource | undefined;

  register(source: BillingLockSource): void {
    this.source = source;
  }

  /** Rule 25: a milestone on a live invoice is not reopened, re-priced or archived. */
  async assertMilestoneFree(tx: Transaction, milestoneId: string): Promise<void> {
    if (await this.source?.invoiced(tx, { type: 'milestone', id: milestoneId })) {
      throw new CodedException(
        409,
        'MILESTONE_INVOICED',
        'The milestone is on a live invoice; discard the draft or void the invoice first',
      );
    }
  }

  /** Whether a live invoice bills the extra work item. */
  async extraWorkInvoiced(tx: Transaction, itemId: string): Promise<boolean> {
    return (await this.source?.invoiced(tx, { type: 'extra_work', id: itemId })) ?? false;
  }

  /** Rule 25: extra work on a live invoice is not archived, waived or re-estimated. */
  async assertExtraWorkFree(tx: Transaction, itemId: string): Promise<void> {
    if (await this.extraWorkInvoiced(tx, itemId)) {
      throw new CodedException(409, 'ALREADY_INVOICED', 'The extra work is on a live invoice', [
        `extra_work:${itemId}`,
      ]);
    }
  }

  /** Rule 24: the currency of an invoiced project or retainer is fixed. */
  async assertCurrencyFree(
    tx: Transaction,
    engagement: { type: 'project' | 'retainer'; id: string },
  ): Promise<void> {
    if (await this.source?.engagementInvoiced(tx, engagement)) {
      throw new CodedException(409, 'CURRENCY_LOCKED', 'The engagement has invoices');
    }
  }
}
