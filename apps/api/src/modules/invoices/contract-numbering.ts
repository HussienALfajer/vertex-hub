import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Database, documentNumbers, type Transaction } from '@vertex-hub/db';
import { and, eq } from 'drizzle-orm';
import { ContractSources } from '../projects/index.js';
import { nextDocumentNumber } from './document-numbers.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';

/**
 * F05C K4, K7: contract numbers come from the same yearly counters as invoice numbers (kind
 * `contract`), and contracts print the invoice settings' payment terms. Registered with
 * `projects`, which cannot import this module.
 */
@Injectable()
export class ContractNumbering implements OnModuleInit {
  constructor(
    private readonly sources: ContractSources,
    private readonly settings: InvoiceSettingsService,
  ) {}

  onModuleInit(): void {
    this.sources.registerNumbering({
      next: (tx, year) => nextDocumentNumber(tx, 'contract', year),
      peek: (executor, year) => this.peek(executor, year),
      paymentTermsDays: async (executor) => (await this.settings.row(executor)).paymentTermsDays,
    });
  }

  private async peek(executor: Database | Transaction, year: number): Promise<number> {
    const [row] = await executor
      .select({ lastNumber: documentNumbers.lastNumber })
      .from(documentNumbers)
      .where(and(eq(documentNumbers.kind, 'contract'), eq(documentNumbers.year, year)));
    return (row?.lastNumber ?? 0) + 1;
  }
}
