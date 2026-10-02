import { Inject, Injectable } from '@nestjs/common';
import { quoteDisplayNumber } from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { QuoteSettingsService } from './quote-settings.service.js';

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
}
