import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type InvoiceOrigin,
  type InvoiceSource,
  invoiceDisplayNumber,
  type RetainerChargeKind,
  takeCredits,
} from '@vertex-hub/contracts';
import { invoiceLines, invoices, type Transaction } from '@vertex-hub/db';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { ClientDirectory } from '../clients/index.js';
import {
  BillingLocks,
  BillingSources,
  type ChargeInvoice,
  ChargeInvoices,
  MilestoneDoneHooks,
  RetainerChargeDueHooks,
  RetainerCharges,
  sourceKey,
} from '../projects/index.js';
import { QuoteAcceptedHooks } from '../quotes/index.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { identity } from './invoices.service.js';

const SOURCE_COLUMNS: Record<InvoiceSource['type'], PgColumn> = {
  milestone: invoiceLines.milestoneId,
  retainer_charge: invoiceLines.retainerChargeId,
  extra_work: invoiceLines.extraWorkItemId,
};

/** The draft a due retainer charge starts (spec F05B C4); a credit drafts nothing (C5). */
const CHARGE_ORIGINS: Record<RetainerChargeKind, Exclude<InvoiceOrigin, 'manual'> | null> = {
  monthly: 'cycle_opened',
  addition: 'retainer_amendment',
  termination_fee: 'retainer_termination',
  credit: null,
};

/**
 * Automatic drafts (spec F13, rules 2–5) inside the transaction of their trigger: the deposit
 * when a quote is accepted, a milestone's installment when it is done, a retainer charge when it
 * becomes due (F05B C4). Also answers `projects`' billing locks (rules 24 and 25).
 */
@Injectable()
export class InvoiceDrafts implements OnModuleInit {
  constructor(
    private readonly clients: ClientDirectory,
    private readonly sources: BillingSources,
    private readonly settings: InvoiceSettingsService,
    private readonly quoteAccepted: QuoteAcceptedHooks,
    private readonly milestoneDone: MilestoneDoneHooks,
    private readonly chargeDue: RetainerChargeDueHooks,
    private readonly locks: BillingLocks,
    private readonly chargeInvoices: ChargeInvoices,
    private readonly charges: RetainerCharges,
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
    this.chargeDue.register(async (tx, event) => {
      const origin = CHARGE_ORIGINS[event.kind];
      if (origin) await this.draft(tx, origin, { type: 'retainer_charge', id: event.chargeId });
    });
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
    this.chargeInvoices.register({
      invoicesOf: (tx, chargeIds) => this.invoicesOf(tx, chargeIds),
      syncDraft: (tx, chargeId, amountMinor, actor) =>
        this.syncDraft(tx, chargeId, amountMinor, actor),
    });
  }

  /** F05B C6: the live invoice of each charge, draft or issued. */
  private async invoicesOf(
    tx: Transaction,
    chargeIds: readonly string[],
  ): Promise<Map<string, ChargeInvoice>> {
    const rows = await tx
      .select({
        chargeId: invoiceLines.retainerChargeId,
        id: invoices.id,
        status: invoices.status,
        year: invoices.year,
        number: invoices.number,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(inArray(invoiceLines.retainerChargeId, [...chargeIds]), invoiceLines.holdsSource));
    return new Map(
      rows.map((row) => [
        row.chargeId ?? '',
        {
          id: row.id,
          displayNumber:
            row.year && row.number
              ? invoiceDisplayNumber({ year: row.year, number: row.number })
              : null,
          issued: row.status !== 'draft',
        },
      ]),
    );
  }

  /**
   * F05B C6: the draft line billing the charge takes the new amount, overwriting a hand-edited
   * price, and the draft's total follows. Credits the draft took from other months that the
   * lower total cannot hold go back to pending, newest line first (C5, C8).
   */
  private async syncDraft(
    tx: Transaction,
    chargeId: string,
    amountMinor: number,
    actor: AuditActor | null,
  ): Promise<void> {
    const [line] = await tx
      .select({ id: invoiceLines.id, invoiceId: invoiceLines.invoiceId })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          eq(invoiceLines.retainerChargeId, chargeId),
          invoiceLines.holdsSource,
          eq(invoices.status, 'draft'),
        ),
      );
    if (!line) return;
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, line.invoiceId))
      .for('update');
    if (!invoice) return;
    await tx
      .update(invoiceLines)
      .set({ unitPriceMinor: amountMinor })
      .where(eq(invoiceLines.id, line.id));
    const lines = await tx
      .select({
        id: invoiceLines.id,
        quantity: invoiceLines.quantity,
        unitPriceMinor: invoiceLines.unitPriceMinor,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
      .orderBy(desc(invoiceLines.position));
    let totalMinor = lines.reduce((sum, row) => sum + row.quantity * row.unitPriceMinor, 0);
    for (const row of lines) {
      if (totalMinor >= 0) break;
      if (row.unitPriceMinor >= 0) continue;
      await tx.delete(invoiceLines).where(eq(invoiceLines.id, row.id));
      totalMinor -= row.quantity * row.unitPriceMinor;
    }
    const [updated] = await tx
      .update(invoices)
      .set({ totalMinor, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id))
      .returning();
    if (!updated) return;
    await recordAudit(tx, {
      actor,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: invoice.id,
      before: { ...identity(invoice), totalMinor: invoice.totalMinor },
      after: { ...identity(updated), totalMinor, syncedChargeId: chargeId },
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
    // C5: a month's draft takes the retainer's pending credits, oldest first, splitting the last.
    const credits =
      origin === 'cycle_opened' && source.engagement.type === 'retainer'
        ? await this.creditLines(tx, source.engagement.id, source.amountMinor)
        : [];
    const totalMinor =
      source.amountMinor + credits.reduce((total, credit) => total + credit.unitPriceMinor, 0);
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
        totalMinor,
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
      retainerChargeId: ref.type === 'retainer_charge' ? ref.id : null,
      extraWorkItemId: ref.type === 'extra_work' ? ref.id : null,
    });
    if (credits.length > 0) {
      await tx.insert(invoiceLines).values(
        credits.map((credit, index) => ({
          invoiceId: row.id,
          position: index + 2,
          description: credit.description,
          quantity: 1,
          unitPriceMinor: credit.unitPriceMinor,
          retainerChargeId: credit.chargeId,
        })),
      );
    }
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
        sources: [
          ref,
          ...credits.map((credit) => ({ type: 'retainer_charge' as const, id: credit.chargeId })),
        ],
        ...(quoteId && { quoteId }),
      },
    });
  }

  /**
   * C5: the credit lines a month's draft of `amountMinor` takes: the retainer's pending credits
   * that no live invoice bills, oldest first, while the total stays ≥ 0; a larger credit is
   * split, its remainder left pending.
   */
  private async creditLines(
    tx: Transaction,
    retainerId: string,
    amountMinor: number,
  ): Promise<{ chargeId: string; description: string; unitPriceMinor: number }[]> {
    const listed = await this.charges.pendingCredits(tx, retainerId, tx);
    if (listed.length === 0) return [];
    // Locked and read again: a credit settled outside meanwhile is no longer taken (C9).
    const resolved = await this.sources.resolve(
      listed.map((credit) => ({ type: 'retainer_charge', id: credit.id })),
      tx,
      { lock: true },
    );
    const pending = listed.flatMap((credit) => {
      const source = resolved.get(sourceKey({ type: 'retainer_charge', id: credit.id }));
      return source && !source.archived
        ? [{ ...credit, amountMinor: source.amountMinor ?? 0 }]
        : [];
    });
    const { taken, split } = takeCredits(amountMinor, pending);
    if (split) await this.charges.splitCredit(tx, split.id, split, null);
    return taken.map((credit) => ({
      chargeId: credit.id,
      description:
        resolved.get(sourceKey({ type: 'retainer_charge', id: credit.id }))?.description ?? '',
      unitPriceMinor: credit.amountMinor,
    }));
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
