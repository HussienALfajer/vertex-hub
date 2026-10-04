import { Injectable, type OnModuleInit } from '@nestjs/common';
import { lossRejectionReason, quoteDisplayNumber } from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, asc, countDistinct, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/index.js';
import {
  LeadClosedHooks,
  type LeadConversion,
  type LeadLoss,
  LeadQuoteChecks,
  type LeadRef,
} from '../leads/index.js';
import { QuotePdfService } from './quote-pdf.service.js';
import { identity } from './quote-records.js';

type Executor = Database | Transaction;

/**
 * What quotes do when a lead closes and what the pipeline asks about a lead's quotes (spec F03,
 * ADR 0026), registered into the `leads` module so it never imports `quotes`.
 */
@Injectable()
export class LeadQuotes implements OnModuleInit {
  constructor(
    private readonly closedHooks: LeadClosedHooks,
    private readonly checks: LeadQuoteChecks,
    private readonly pdf: QuotePdfService,
  ) {}

  onModuleInit(): void {
    this.closedHooks.register({
      lost: (tx, lead, loss) => this.lost(tx, lead, loss),
      converted: (tx, lead, conversion) => this.converted(tx, lead, conversion),
    });
    this.checks.register({
      hasSentQuote: async (executor, leadId) =>
        this.exists(executor, and(eq(quotes.leadId, leadId), eq(quotes.status, 'sent'))),
      hasLiveQuotes: async (executor, leadId) => this.exists(executor, eq(quotes.leadId, leadId)),
      quoteCounts: (executor, leadIds) => this.counts(executor, leadIds),
    });
  }

  /**
   * Rule 8: every sent or expired quote of the lead is recorded as rejected with the mapped
   * reason, the loss note, today and the caller, whatever their quote permissions.
   */
  private async lost(tx: Transaction, lead: LeadRef, loss: LeadLoss): Promise<string[]> {
    const open = await tx
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.leadId, lead.id),
          inArray(quotes.status, ['sent', 'expired']),
          isNull(quotes.archivedAt),
        ),
      )
      .orderBy(asc(quotes.year), asc(quotes.number), asc(quotes.version))
      .for('update');
    const reason = lossRejectionReason(loss.reason);
    for (const quote of open) {
      await tx
        .update(quotes)
        .set({
          status: 'rejected',
          respondedOn: loss.today,
          responseContactId: null,
          responseNote: loss.note,
          respondedById: loss.actor.id,
          rejectionReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, quote.id));
      await recordAudit(tx, {
        actor: loss.actor,
        action: 'quote.rejected',
        entityType: 'quote',
        entityId: quote.id,
        before: { ...identity(quote), status: quote.status },
        after: {
          ...identity(quote),
          status: 'rejected',
          reason,
          respondedOn: loss.today,
          ...(loss.note ? { note: loss.note } : {}),
          byLeadLoss: true,
        },
      });
    }
    return open.map(quoteDisplayNumber);
  }

  /**
   * Rule 10: the lead's quotes get the client, and the added contact as addressee where they
   * have none; a held PDF becomes a document of the client. Returns the quote numbers moved.
   */
  private async converted(
    tx: Transaction,
    lead: LeadRef,
    conversion: LeadConversion,
  ): Promise<number> {
    const moving = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.leadId, lead.id), isNull(quotes.clientId)))
      .orderBy(asc(quotes.year), asc(quotes.number), asc(quotes.version))
      .for('update');
    for (const quote of moving) {
      const contactId = quote.contactId ?? conversion.contactId;
      const [moved] = await tx
        .update(quotes)
        .set({ clientId: conversion.clientId, contactId, updatedAt: new Date() })
        .where(eq(quotes.id, quote.id))
        .returning();
      if (!moved) throw new Error('The quote was not moved');
      await recordAudit(tx, {
        actor: conversion.actor,
        action: 'quote.updated',
        entityType: 'quote',
        entityId: quote.id,
        before: { ...identity(quote), contactId: quote.contactId },
        after: { ...identity(moved), contactId },
      });
      await this.pdf.attachHeld(tx, moved, conversion.clientId);
    }
    return new Set(
      moving.filter((quote) => !quote.archivedAt).map((quote) => `${quote.year}-${quote.number}`),
    ).size;
  }

  private async exists(executor: Executor, where: SQL | undefined): Promise<boolean> {
    const [row] = await executor
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(where, isNull(quotes.archivedAt)))
      .limit(1);
    return !!row;
  }

  /** Quote numbers per lead, archived versions left out. */
  private async counts(executor: Executor, leadIds: string[]): Promise<Map<string, number>> {
    const rows = await executor
      .select({
        leadId: quotes.leadId,
        value: countDistinct(sql`(${quotes.year}, ${quotes.number})`),
      })
      .from(quotes)
      .where(and(inArray(quotes.leadId, leadIds), isNull(quotes.archivedAt)))
      .groupBy(quotes.leadId);
    return new Map(rows.flatMap((row) => (row.leadId ? [[row.leadId, row.value]] : [])));
  }
}
