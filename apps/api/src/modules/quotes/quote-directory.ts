import { Inject, Injectable } from '@nestjs/common';
import { type QuoteSection, quoteDisplayNumber } from '@vertex-hub/contracts';
import { type Database, quoteLines, quotes, type Transaction } from '@vertex-hub/db';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { QuoteSettingsService } from './quote-settings.service.js';

/** A priced line of an accepted quote, for the revenue split (F15 rule 14). */
export interface AcceptedQuoteLine {
  section: QuoteSection;
  serviceId: string | null;
  packageId: string | null;
  /** Quantity × unit price, in the quote's currency. */
  totalMinor: number;
}

/**
 * Quotes as other modules may see them (F13): the company details printed on every quote,
 * invoice, receipt and statement, and quote numbers to link to. Never the tables.
 */
@Injectable()
export class QuoteDirectory {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: QuoteSettingsService,
  ) {}

  async companyDetails(executor: Database | Transaction = this.db): Promise<string> {
    return (await this.settings.row(executor)).companyDetails;
  }

  /** `Q-2026-0007 v2` by quote id. */
  async displayNumbers(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await executor
      .select({ id: quotes.id, year: quotes.year, number: quotes.number, version: quotes.version })
      .from(quotes)
      .where(inArray(quotes.id, unique));
    return new Map(rows.map((row) => [row.id, quoteDisplayNumber(row)]));
  }

  /**
   * F15 rule 14: the lines of the accepted quote of each project and retainer, keyed
   * `project:<id>` or `retainer:<id>`; the latest accepted one when a retainer was renewed.
   */
  async acceptedLines(engagements: {
    projectIds: readonly string[];
    retainerIds: readonly string[];
  }): Promise<Map<string, AcceptedQuoteLine[]>> {
    const result = new Map<string, AcceptedQuoteLine[]>();
    const { projectIds, retainerIds } = engagements;
    if (projectIds.length === 0 && retainerIds.length === 0) return result;
    const accepted = await this.db
      .select({ id: quotes.id, projectId: quotes.projectId, retainerId: quotes.retainerId })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, 'accepted'),
          or(
            projectIds.length ? inArray(quotes.projectId, [...projectIds]) : undefined,
            retainerIds.length ? inArray(quotes.retainerId, [...retainerIds]) : undefined,
          ),
        ),
      )
      .orderBy(
        desc(quotes.respondedOn),
        desc(quotes.year),
        desc(quotes.number),
        desc(quotes.version),
      );
    const chosen = new Map<string, string>();
    for (const quote of accepted) {
      for (const key of [
        quote.projectId && `project:${quote.projectId}`,
        quote.retainerId && `retainer:${quote.retainerId}`,
      ]) {
        if (key && !chosen.has(key)) chosen.set(key, quote.id);
      }
    }
    const quoteIds = [...new Set(chosen.values())];
    if (quoteIds.length === 0) return result;
    const lines = await this.db
      .select({
        quoteId: quoteLines.quoteId,
        section: quoteLines.section,
        serviceId: quoteLines.serviceId,
        packageId: quoteLines.packageId,
        quantity: quoteLines.quantity,
        unitPriceMinor: quoteLines.unitPriceMinor,
      })
      .from(quoteLines)
      .where(inArray(quoteLines.quoteId, quoteIds))
      .orderBy(asc(quoteLines.position));
    for (const [key, quoteId] of chosen) {
      result.set(
        key,
        lines
          .filter((line) => line.quoteId === quoteId)
          .map((line) => ({
            section: line.section,
            serviceId: line.serviceId,
            packageId: line.packageId,
            totalMinor: line.quantity * line.unitPriceMinor,
          })),
      );
    }
    return result;
  }
}
