import { Injectable } from '@nestjs/common';
import {
  type Database,
  type documentNumberKindEnum,
  documentNumbers,
  type Transaction,
} from '@vertex-hub/db';
import { sql } from 'drizzle-orm';
import { InvoiceSettingsService } from './invoice-settings.service.js';

type DocumentNumberKind = (typeof documentNumberKindEnum.enumValues)[number];

/**
 * The next number of the kind and year. The upsert locks the counter row of the kind and year
 * until the transaction ends, so concurrent issues and payments get consecutive numbers
 * (edge case 3).
 */
export async function nextDocumentNumber(
  tx: Transaction,
  kind: DocumentNumberKind,
  year: number,
): Promise<number> {
  const [row] = await tx
    .insert(documentNumbers)
    .values({ kind, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [documentNumbers.kind, documentNumbers.year],
      set: { lastNumber: sql`${documentNumbers.lastNumber} + 1` },
    })
    .returning({ lastNumber: documentNumbers.lastNumber });
  if (!row) throw new Error(`No ${kind} number`);
  return row.lastNumber;
}

/**
 * F13's numbering and current rate for money documents of other modules: the ad deposit receipts
 * of `campaigns` (F12 rules 16 and 19).
 */
@Injectable()
export class DocumentNumbers {
  constructor(private readonly settings: InvoiceSettingsService) {}

  /** The next `AD-<year>-<n>` number, inside the transaction that records the deposit. */
  nextAdDeposit(tx: Transaction, year: number): Promise<number> {
    return nextDocumentNumber(tx, 'ad_deposit', year);
  }

  /** The current rate of the invoice settings (SYP per USD); null until first set. */
  async currentRate(executor: Database | Transaction): Promise<string | null> {
    return (await this.settings.row(executor)).sypPerUsd;
  }
}
