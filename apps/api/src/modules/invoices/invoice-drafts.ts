import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { InvoiceOrigin, InvoiceSource } from '@vertex-hub/contracts';
import { invoiceLines, invoices, type Transaction } from '@vertex-hub/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { recordAudit } from '../audit/index.js';
import { ClientDirectory } from '../clients/index.js';
import {
  BillingLocks,
  BillingSources,
  CycleOpenedHooks,
  MilestoneDoneHooks,
  sourceKey,
} from '../projects/index.js';
import { QuoteAcceptedHooks } from '../quotes/index.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { identity } from './invoices.service.js';

const SOURCE_COLUMNS: Record<InvoiceSource['type'], PgColumn> = {
  milestone: invoiceLines.milestoneId,
  retainer_cycle: invoiceLines.retainerCycleId,
  extra_work: invoiceLines.extraWorkItemId,
};

/**
 * Automatic drafts (spec F13, rules 2–5) inside the transaction of their trigger: the deposit
 * when a quote is accepted, a milestone's installment when it is done, a retainer month when its
 * cycle opens. Also answers `projects`' billing locks (rules 24 and 25).
 */
@Injectable()
export class InvoiceDrafts implements OnModuleInit {
  constructor(
    private readonly clients: ClientDirectory,
    private readonly sources: BillingSources,
    private readonly settings: InvoiceSettingsService,
    private readonly quoteAccepted: QuoteAcceptedHooks,
    private readonly milestoneDone: MilestoneDoneHooks,
    private readonly cycleOpened: CycleOpenedHooks,
    private readonly locks: BillingLocks,
  ) {}

  onModuleInit(): void {
    this.quoteAccepted.register(async (tx, event) => {
      const milestoneId = event.project?.firstInstallmentMilestoneId;
      if (!milestoneId) return;
      await this.draft(tx, 'quote_accepted', { type: 'milestone', id: milestoneId }, event.quoteId);
    });
    this.milestoneDone.register((tx, event) =>
      this.draft(tx, 'milestone_done', { type: 'milestone', id: event.milestoneId }),
    );
    this.cycleOpened.register((tx, event) =>
      this.draft(tx, 'cycle_opened', { type: 'retainer_cycle', id: event.cycleId }),
    );
    this.locks.register({
      invoiced: async (tx, source) => (await this.holder(tx, source)) !== null,
      engagementInvoiced: async (tx, engagement) => {
        const column = engagement.type === 'project' ? invoices.projectId : invoices.retainerId;
        // Issued invoices are never archived; an archived draft was discarded and billed nothing.
        const [row] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(column, engagement.id), isNull(invoices.archivedAt)))
          .limit(1);
        return !!row;
      },
    });
  }

  /**
   * Rules 4 and 5: one line for the source's whole amount, in its engagement's currency, with the
   * settings' payment terms and no creator. Skipped without an amount, for archived work or
   * clients, when a live invoice holds the source, and when the same trigger's draft of it was
   * discarded (rule 8).
   */
  private async draft(
    tx: Transaction,
    origin: Exclude<InvoiceOrigin, 'manual'>,
    ref: InvoiceSource,
    quoteId: string | null = null,
  ): Promise<void> {
    const source = (await this.sources.resolve([ref], tx, { lock: true })).get(sourceKey(ref));
    if (!source || source.archived || source.engagement.archived) return;
    if (!source.amountMinor || source.amountMinor <= 0) return;
    const client = await this.clients.summary(source.engagement.clientId, tx);
    if (!client || client.archived) return;
    if ((await this.holder(tx, ref)) || (await this.discarded(tx, origin, ref))) return;
    const settings = await this.settings.row(tx);
    const [row] = await tx
      .insert(invoices)
      .values({
        clientId: client.id,
        projectId: source.engagement.type === 'project' ? source.engagement.id : null,
        retainerId: source.engagement.type === 'retainer' ? source.engagement.id : null,
        quoteId,
        origin,
        currency: source.engagement.currency,
        paymentTermsDays: settings.paymentTermsDays,
        totalMinor: source.amountMinor,
      })
      .returning();
    if (!row) throw new Error('The invoice was not created');
    await tx.insert(invoiceLines).values({
      invoiceId: row.id,
      position: 1,
      description: source.description,
      quantity: 1,
      unitPriceMinor: source.amountMinor,
      milestoneId: ref.type === 'milestone' ? ref.id : null,
      retainerCycleId: ref.type === 'retainer_cycle' ? ref.id : null,
      extraWorkItemId: ref.type === 'extra_work' ? ref.id : null,
    });
    await recordAudit(tx, {
      actor: null,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: row.id,
      after: {
        ...identity(row),
        origin,
        currency: row.currency,
        totalMinor: row.totalMinor,
        sources: [ref],
        ...(quoteId && { quoteId }),
      },
    });
  }

  /** The live invoice holding the source, if any. */
  private async holder(tx: Transaction, ref: InvoiceSource): Promise<string | null> {
    const [line] = await tx
      .select({ invoiceId: invoiceLines.invoiceId })
      .from(invoiceLines)
      .where(and(eq(SOURCE_COLUMNS[ref.type], ref.id), invoiceLines.holdsSource))
      .limit(1);
    return line?.invoiceId ?? null;
  }

  /** Rule 8: a draft of the source by the same trigger was discarded. */
  private async discarded(
    tx: Transaction,
    origin: InvoiceOrigin,
    ref: InvoiceSource,
  ): Promise<boolean> {
    const [line] = await tx
      .select({ id: invoiceLines.id })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          eq(SOURCE_COLUMNS[ref.type], ref.id),
          isNotNull(invoices.archivedAt),
          eq(invoices.origin, origin),
        ),
      )
      .limit(1);
    return !!line;
  }
}
