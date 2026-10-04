import { Inject, Injectable } from '@nestjs/common';
import type {
  CatalogBilling,
  Currency,
  DeliverableKind,
  DepartmentCode,
} from '@vertex-hub/contracts';
import {
  catalogPackageItems,
  catalogPackages,
  catalogServices,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { asc, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

export interface CatalogServiceEntry {
  id: string;
  name: string;
  description: string | null;
  department: DepartmentCode;
  billing: CatalogBilling;
  priceUsdMinor: number;
  priceSypMinor: number | null;
  revisionRounds: number;
  deliverableKind: DeliverableKind | null;
  deliverableLabel: string | null;
  templateId: string | null;
  archived: boolean;
}

export interface CatalogPackageEntry {
  id: string;
  name: string;
  description: string | null;
  billing: CatalogBilling;
  priceUsdMinor: number;
  priceSypMinor: number | null;
  templateId: string | null;
  archived: boolean;
  /** In order, with their services. */
  items: { quantity: number; service: CatalogServiceEntry }[];
}

/** The catalog price of an item in a currency; null when it has none there. */
export function catalogPrice(
  item: { priceUsdMinor: number; priceSypMinor: number | null },
  currency: Currency,
): number | null {
  return currency === 'USD' ? item.priceUsdMinor : item.priceSypMinor;
}

/**
 * Services and packages as quotes copy them (F04): prices, departments, counted kinds, revision
 * rounds and template ids, archived or not. Never the tables.
 */
@Injectable()
export class CatalogDirectory {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async services(
    ids: string[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<string, CatalogServiceEntry>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(catalogServices)
      .where(inArray(catalogServices.id, unique));
    return new Map(rows.map((row) => [row.id, toService(row)]));
  }

  /** Ids and names of the non-archived services and packages, by name (F03 lead interests). */
  async activeNames(): Promise<{
    services: { id: string; name: string }[];
    packages: { id: string; name: string }[];
  }> {
    const pick = { id: catalogServices.id, name: catalogServices.name };
    const [services, packages] = await Promise.all([
      this.db
        .select(pick)
        .from(catalogServices)
        .where(isNull(catalogServices.archivedAt))
        .orderBy(asc(catalogServices.name)),
      this.db
        .select({ id: catalogPackages.id, name: catalogPackages.name })
        .from(catalogPackages)
        .where(isNull(catalogPackages.archivedAt))
        .orderBy(asc(catalogPackages.name)),
    ]);
    return { services, packages };
  }

  async packages(
    ids: string[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<string, CatalogPackageEntry>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(catalogPackages)
      .where(inArray(catalogPackages.id, unique));
    const items = await executor
      .select()
      .from(catalogPackageItems)
      .where(inArray(catalogPackageItems.packageId, unique))
      .orderBy(asc(catalogPackageItems.position));
    const services = await this.services(
      items.map((item) => item.serviceId),
      executor,
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          description: row.description,
          billing: row.billing,
          priceUsdMinor: row.priceUsdMinor,
          priceSypMinor: row.priceSypMinor,
          templateId: row.templateId,
          archived: !!row.archivedAt,
          items: items.flatMap((item) => {
            const service = services.get(item.serviceId);
            return item.packageId === row.id && service
              ? [{ quantity: item.quantity, service }]
              : [];
          }),
        },
      ]),
    );
  }
}

function toService(row: typeof catalogServices.$inferSelect): CatalogServiceEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    department: row.department,
    billing: row.billing,
    priceUsdMinor: row.priceUsdMinor,
    priceSypMinor: row.priceSypMinor,
    revisionRounds: row.revisionRounds,
    deliverableKind: row.deliverableKind,
    deliverableLabel: row.deliverableLabel,
    templateId: row.templateId,
    archived: !!row.archivedAt,
  };
}
