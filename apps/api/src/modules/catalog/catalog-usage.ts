import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';

/** A catalog service or package whose use outside the catalog is asked about. */
export interface CatalogItemRef {
  type: 'service' | 'package';
  id: string;
}

export type CatalogUsageCheck = (tx: Transaction, item: CatalogItemRef) => Promise<boolean>;

/**
 * Lets modules that copy catalog items (`quotes`) tell the catalog an item is in use, so its
 * billing cannot change (`SERVICE_IN_USE`), without `catalog` importing them.
 */
@Injectable()
export class CatalogUsage {
  private readonly checks: CatalogUsageCheck[] = [];

  register(check: CatalogUsageCheck): void {
    this.checks.push(check);
  }

  async isUsed(tx: Transaction, item: CatalogItemRef): Promise<boolean> {
    for (const check of this.checks) if (await check(tx, item)) return true;
    return false;
  }
}
