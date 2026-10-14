import { Injectable, type OnModuleInit } from '@nestjs/common';
import { quoteDisplayNumber, quoteSnapshotSchema } from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, desc, eq } from 'drizzle-orm';
import { ContractSources } from '../projects/index.js';

/**
 * F05C K7 `{services}`: the accepted quote's number and its monthly services and packages, from
 * the sent version's snapshot. Registered with `projects`, which cannot import this module.
 */
@Injectable()
export class QuoteContractServices implements OnModuleInit {
  constructor(private readonly sources: ContractSources) {}

  onModuleInit(): void {
    this.sources.registerQuotes({
      monthlyServices: (executor, ref) => this.monthlyServices(executor, ref),
    });
  }

  private async monthlyServices(
    executor: Database | Transaction,
    ref: { quoteId: string | null; retainerId: string },
  ) {
    const [quote] = await executor
      .select({
        year: quotes.year,
        number: quotes.number,
        version: quotes.version,
        snapshot: quotes.snapshot,
      })
      .from(quotes)
      .where(
        ref.quoteId
          ? eq(quotes.id, ref.quoteId)
          : and(eq(quotes.retainerId, ref.retainerId), eq(quotes.status, 'accepted')),
      )
      .orderBy(
        desc(quotes.respondedOn),
        desc(quotes.year),
        desc(quotes.number),
        desc(quotes.version),
      )
      .limit(1);
    const snapshot = quoteSnapshotSchema.safeParse(quote?.snapshot);
    if (!quote || !snapshot.success) return null;
    return {
      displayNumber: quoteDisplayNumber(quote),
      lines: snapshot.data.monthly.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        items: line.items,
      })),
    };
  }
}
