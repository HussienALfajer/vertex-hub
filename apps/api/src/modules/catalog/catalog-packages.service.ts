import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CatalogBilling,
  type CatalogPackage,
  type CatalogPackageListQuery,
  type CatalogPackagePage,
  type CreateCatalogPackage,
  hasPermission,
  packageIssues,
  type UpdateCatalogPackage,
} from '@vertex-hub/contracts';
import {
  catalogPackageItems,
  catalogPackages,
  catalogServices,
  type Database,
  newId,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { TemplateDirectory } from '../templates/index.js';
import {
  assertNoIssues,
  assertTemplate,
  definedFields,
  escapeLike,
  toActor,
  toTemplate,
} from './catalog-rules.js';

type PackageRow = typeof catalogPackages.$inferSelect;

type ItemInput = { serviceId: string; quantity: number };

type NamedItem = ItemInput & { name: string };

type Executor = Database | Transaction;

/** The fields of a package as the audit log records them; items carry the service name. */
const auditFields = (row: PackageRow, items: NamedItem[]) => ({
  name: row.name,
  description: row.description,
  billing: row.billing,
  priceUsdMinor: row.priceUsdMinor,
  priceSypMinor: row.priceSypMinor,
  templateId: row.templateId,
  items: items.map(({ serviceId, name, quantity }) => ({ serviceId, name, quantity })),
});

/** Catalog packages (F04): services with quantities under one price. */
@Injectable()
export class CatalogPackagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly templates: TemplateDirectory,
  ) {}

  async list(actor: CurrentUserInfo, query: CatalogPackageListQuery): Promise<CatalogPackagePage> {
    if (query.archived && !hasPermission(actor.access, 'catalog.manage')) {
      throw new ForbiddenException();
    }
    const where = and(
      query.archived ? isNotNull(catalogPackages.archivedAt) : isNull(catalogPackages.archivedAt),
      query.billing ? eq(catalogPackages.billing, query.billing) : undefined,
      query.search ? ilike(catalogPackages.name, `%${escapeLike(query.search)}%`) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(catalogPackages)
        .where(where)
        .orderBy(sql`lower(${catalogPackages.name})`, asc(catalogPackages.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(catalogPackages).where(where),
    ]);
    return {
      items: await this.toResponses(this.db, rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Archived packages are seen by `catalog.manage` only; others get 404. */
  async detail(actor: CurrentUserInfo, id: string): Promise<CatalogPackage> {
    const [row] = await this.db.select().from(catalogPackages).where(eq(catalogPackages.id, id));
    if (!row || (row.archivedAt && !hasPermission(actor.access, 'catalog.manage'))) {
      throw new NotFoundException();
    }
    return this.toResponse(this.db, row);
  }

  async create(actor: CurrentUserInfo, input: CreateCatalogPackage): Promise<CatalogPackage> {
    const id = newId();
    return this.db.transaction(async (tx) => {
      await this.assertNameFree(tx, input.name, null);
      await assertTemplate(this.templates, tx, input.templateId, input.billing);
      const names = await this.assertItems(tx, input.items, input.billing);
      const { items, ...fields } = input;
      const [created] = await tx
        .insert(catalogPackages)
        .values({ id, ...fields })
        .returning();
      if (!created) throw new Error('Insert returned no row');
      await this.insertItems(tx, id, items);
      await recordAudit(tx, {
        actor: toActor(actor),
        action: 'catalog_package.created',
        entityType: 'catalog_package',
        entityId: id,
        after: auditFields(created, withNames(items, names)),
      });
      return this.toResponse(tx, created);
    });
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateCatalogPackage,
  ): Promise<CatalogPackage> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.archivedAt) {
        throw new CodedException(409, 'PACKAGE_ARCHIVED', 'The package is archived');
      }
      const before = auditFields(current, await this.itemRows(tx, [id]));
      const merged = { ...before, ...definedFields(input), items: before.items };
      assertNoIssues(packageIssues(merged));
      if (merged.name.toLocaleLowerCase('ar') !== current.name.toLocaleLowerCase('ar')) {
        await this.assertNameFree(tx, merged.name, id);
      }
      const billingChanged = merged.billing !== current.billing;
      if (input.items || billingChanged) {
        const names = await this.assertItems(tx, input.items ?? before.items, merged.billing);
        if (input.items) merged.items = withNames(input.items, names);
      }
      if (billingChanged || merged.templateId !== current.templateId) {
        await assertTemplate(this.templates, tx, merged.templateId, merged.billing);
      }
      const changes = changedFields(before, merged);
      if (!changes) return this.toResponse(tx, current);
      const { items, ...fields } = changes.after;
      const [updated] = await tx
        .update(catalogPackages)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(catalogPackages.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      if (items) {
        await tx.delete(catalogPackageItems).where(eq(catalogPackageItems.packageId, id));
        await this.insertItems(tx, id, items);
      }
      await recordAudit(tx, {
        actor: toActor(actor),
        action: 'catalog_package.updated',
        entityType: 'catalog_package',
        entityId: id,
        ...changes,
      });
      return this.toResponse(tx, updated);
    });
  }

  async setArchived(actor: CurrentUserInfo, id: string, archive: boolean): Promise<CatalogPackage> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (archive && current.archivedAt) {
        throw new CodedException(409, 'PACKAGE_ARCHIVED', 'The package is archived');
      }
      if (!archive && !current.archivedAt) {
        throw new CodedException(409, 'PACKAGE_NOT_ARCHIVED', 'The package is not archived');
      }
      if (!archive) await this.assertNameFree(tx, current.name, id);
      const [updated] = await tx
        .update(catalogPackages)
        .set({ archivedAt: archive ? new Date() : null })
        .where(eq(catalogPackages.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: toActor(actor),
        action: archive ? 'catalog_package.archived' : 'catalog_package.restored',
        entityType: 'catalog_package',
        entityId: id,
        before: { archived: !archive },
        after: { archived: archive },
      });
      return this.toResponse(tx, updated);
    });
  }

  private async lock(tx: Transaction, id: string): Promise<PackageRow> {
    const [row] = await tx
      .select()
      .from(catalogPackages)
      .where(eq(catalogPackages.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  /**
   * Every item is a non-archived service with the package's billing (`INVALID_PACKAGE_ITEM`).
   * The share lock holds the services until the package is saved, so an archive or a billing
   * change of one of them (which locks it for update) waits and then sees the package.
   */
  private async assertItems(
    tx: Transaction,
    items: ItemInput[],
    billing: CatalogBilling,
  ): Promise<Map<string, string>> {
    const ids = items.map((item) => item.serviceId);
    const services = await tx
      .select({
        id: catalogServices.id,
        name: catalogServices.name,
        billing: catalogServices.billing,
        archivedAt: catalogServices.archivedAt,
      })
      .from(catalogServices)
      .where(inArray(catalogServices.id, ids))
      .for('share');
    const valid = new Set(
      services
        .filter((service) => !service.archivedAt && service.billing === billing)
        .map((service) => service.id),
    );
    const invalid = ids.filter((id) => !valid.has(id));
    if (invalid.length > 0) {
      throw new CodedException(
        400,
        'INVALID_PACKAGE_ITEM',
        'A service is missing, archived or has another billing',
        { serviceIds: invalid },
      );
    }
    return new Map(services.map((service) => [service.id, service.name]));
  }

  private async insertItems(tx: Transaction, packageId: string, items: ItemInput[]) {
    await tx.insert(catalogPackageItems).values(
      items.map((item, index) => ({
        id: newId(),
        packageId,
        serviceId: item.serviceId,
        quantity: item.quantity,
        position: index + 1,
      })),
    );
  }

  private async itemRows(executor: Executor, packageIds: string[]) {
    if (packageIds.length === 0) return [];
    return executor
      .select({
        packageId: catalogPackageItems.packageId,
        serviceId: catalogPackageItems.serviceId,
        quantity: catalogPackageItems.quantity,
        name: catalogServices.name,
        department: catalogServices.department,
        deliverableKind: catalogServices.deliverableKind,
        deliverableLabel: catalogServices.deliverableLabel,
        archivedAt: catalogServices.archivedAt,
      })
      .from(catalogPackageItems)
      .innerJoin(catalogServices, eq(catalogServices.id, catalogPackageItems.serviceId))
      .where(inArray(catalogPackageItems.packageId, packageIds))
      .orderBy(asc(catalogPackageItems.packageId), asc(catalogPackageItems.position));
  }

  private async assertNameFree(tx: Transaction, name: string, exceptId: string | null) {
    const [taken] = await tx
      .select({ id: catalogPackages.id })
      .from(catalogPackages)
      .where(
        and(
          sql`lower(${catalogPackages.name}) = lower(${name})`,
          isNull(catalogPackages.archivedAt),
          exceptId ? ne(catalogPackages.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(409, 'PACKAGE_NAME_TAKEN', 'Another package has this name');
    }
  }

  private async toResponse(executor: Executor, row: PackageRow): Promise<CatalogPackage> {
    const [response] = await this.toResponses(executor, [row]);
    if (!response) throw new NotFoundException();
    return response;
  }

  private async toResponses(executor: Executor, rows: PackageRow[]): Promise<CatalogPackage[]> {
    // One after another: a transaction's client runs one query at a time.
    const items = await this.itemRows(
      executor,
      rows.map((row) => row.id),
    );
    const templates = await this.templates.summaries(
      rows.map((row) => row.templateId),
      executor,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      billing: row.billing,
      priceUsdMinor: row.priceUsdMinor,
      priceSypMinor: row.priceSypMinor,
      template: row.templateId ? toTemplate(templates.get(row.templateId)) : null,
      items: items
        .filter((item) => item.packageId === row.id)
        .map(({ packageId: _, archivedAt, ...item }) => ({ ...item, archived: !!archivedAt })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }
}

/** Items as `auditFields` records them, key order included: the audit compares them as JSON. */
const withNames = (items: ItemInput[], names: Map<string, string>): NamedItem[] =>
  items.map(({ serviceId, quantity }) => ({
    serviceId,
    name: names.get(serviceId) ?? '',
    quantity,
  }));
