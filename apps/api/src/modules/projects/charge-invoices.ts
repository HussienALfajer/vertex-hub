import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** The live invoice that bills a retainer charge. */
export interface ChargeInvoice {
  id: string;
  /** Null on a draft. */
  displayNumber: string | null;
  /** Issued and not void, in any payment state; false for a draft. */
  issued: boolean;
}

/** What the module that owns invoices answers and does for amendments (spec F05B C6). */
export interface ChargeInvoiceSource {
  /** The live invoice of each charge that has one. */
  invoicesOf(tx: Transaction, chargeIds: readonly string[]): Promise<Map<string, ChargeInvoice>>;
  /**
   * C6: the draft line billing the charge takes its new amount and the draft's total follows,
   * overwriting a hand-edited price; audited as `invoice.updated` with the amendment's actor.
   */
  syncDraft(
    tx: Transaction,
    chargeId: string,
    amountMinor: number,
    actor: AuditActor | null,
  ): Promise<void>;
}

/**
 * Lets the `invoices` module answer about the invoices of retainer charges and sync drafts
 * without `projects` importing it (spec F05B C6). Until a source registers, no charge is invoiced.
 */
@Injectable()
export class ChargeInvoices {
  private source: ChargeInvoiceSource | undefined;

  register(source: ChargeInvoiceSource): void {
    this.source = source;
  }

  async of(tx: Transaction, chargeIds: readonly string[]): Promise<Map<string, ChargeInvoice>> {
    if (!this.source || chargeIds.length === 0) return new Map();
    return this.source.invoicesOf(tx, chargeIds);
  }

  async syncDraft(
    tx: Transaction,
    chargeId: string,
    amountMinor: number,
    actor: AuditActor | null,
  ): Promise<void> {
    await this.source?.syncDraft(tx, chargeId, amountMinor, actor);
  }
}
