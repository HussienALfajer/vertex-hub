import { documentNumbers, type Transaction } from '@vertex-hub/db';
import { sql } from 'drizzle-orm';

/**
 * The next invoice or receipt number of the year. The upsert locks the counter row of the kind
 * and year until the transaction ends, so concurrent issues and payments get consecutive numbers
 * (edge case 3).
 */
export async function nextDocumentNumber(
  tx: Transaction,
  kind: 'invoice' | 'receipt',
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
