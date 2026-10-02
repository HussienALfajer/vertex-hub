import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CatalogService,
  type CatalogServiceListQuery,
  type CatalogServicePage,
  type CreateCatalogService,
  hasPermission,
  serviceIssues,
  type UpdateCatalogService,
} from '@vertex-hub/contracts';
import {
  catalogPackageItems,
  catalogPackages,
  catalogServices,
  type Database,
  newId,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, eq, ilike, isNotNull, isNull, ne, sql } from 'drizzle-orm';
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

type ServiceRow = typeof catalogServices.$inferSelect;

/** The fields of a service as the audit log records them. */
const auditFields = (row: Omit<ServiceRow, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'>) => ({
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
});

/** Catalog services (F04): list, create, edit, archive and restore. */
@Injectable()
export class CatalogServicesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly templates: TemplateDirectory,
  ) {}

  async list(actor: CurrentUserInfo, query: CatalogServiceListQuery): Promise<CatalogServicePage> {
    if (query.archived && !hasPermission(actor.access, 'catalog.manage')) {
      throw new ForbiddenException();
    }
    const where = and(
      query.archived ? isNotNull(catalogServices.archivedAt) : isNull(catalogServices.archivedAt),
      query.billing ? eq(catalogServices.billing, query.billing) : undefined,
      query.department ? eq(catalogServices.department, query.department) : undefined,
      query.search ? ilike(catalogServices.name, `%${escapeLike(query.search)}%`) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(catalogServices)
        .where(where)
        .orderBy(sql`lower(${catalogServices.name})`, asc(catalogServices.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(catalogServices).where(where),
    ]);
    return {
      items: await this.toResponses(rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(actor: CurrentUserInfo, input: CreateCatalogService): Promise<CatalogService> {
    const id = newId();
    const row = await this.db.transaction(async (tx) => {
      await this.assertNameFree(tx, input.name, null);
      await assertTemplate(this.templates, tx, input.templateId, input.billing);
      const [created] = await tx
        .insert(catalogServices)
        .values({ id, ...input })
        .returning();
      if (!created) throw new Error('Insert returned no row');
      await recordAudit(tx, {
        actor: toActor(actor),
        action: 'catalog_service.created',
        entityType: 'catalog_service',
        entityId: id,
        after: auditFields(created),
      });
      return created;
    });
    return this.toResponse(row);
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateCatalogService,
  ): Promise<CatalogService> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.archivedAt) {
        throw new CodedException(409, 'SERVICE_ARCHIVED', 'The service is archived');
      }
      const before = auditFields(current);
      const merged = { ...before, ...definedFields(input) };
      assertNoIssues(serviceIssues(merged));
      if (merged.name.toLocaleLowerCase('ar') !== current.name.toLocaleLowerCase('ar')) {
        await this.assertNameFree(tx, merged.name, id);
      }
      if (
        merged.billing !== current.billing &&
        (await this.usedInPackages(tx, id, false)).length > 0
      ) {
        throw new CodedException(409, 'SERVICE_IN_USE', 'The service is used in a package');
      }
      if (input.templateId !== undefined || input.billing !== undefined) {
        if (merged.templateId !== current.templateId || merged.billing !== current.billing) {
          await assertTemplate(this.templates, tx, merged.templateId, merged.billing);
        }
      }
      const changes = changedFields(before, merged);
      if (!changes) return current;
      const [updated] = await tx
        .update(catalogServices)
        .set({ ...changes.after, updatedAt: new Date() })
        .where(eq(catalogServices.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: toActor(actor),
        action: 'catalog_service.updated',
        entityType: 'catalog_service',
        entityId: id,
        ...changes,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async setArchived(actor: CurrentUserInfo, id: string, archive: boolean): Promise<CatalogService> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (archive && current.archivedAt) {
        throw new CodedException(409, 'SERVICE_ARCHIVED', 'The service is archived');
      }
      if (!archive && !current.archivedAt) {
        throw new CodedException(409, 'SERVICE_NOT_ARCHIVED', 'The service is not archived');
      }
      if (archive) {
        const packages = await this.usedInPackages(tx, id, true);
        if (packages.length > 0) {
          throw new CodedException(
            409,
            'SERVICE_IN_PACKAGE',
            'The service is used by active packages',
            { packages },
          );
        }
      } else {
        await this.assertNameFree(tx, current.name, id);
      }
      const [updated] = await tx
        .update(catalogServices)
        .set({ archivedAt: archive ? new Date() : null })
        .where(eq(catalogServices.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: toActor(actor),
        action: archive ? 'catalog_service.archived' : 'catalog_service.restored',
        entityType: 'catalog_service',
        entityId: id,
        before: { archived: !archive },
        after: { archived: archive },
      });
      return updated;
    });
    return this.toResponse(row);
  }

  /** The service's row, locked until the transaction ends; package edits share-lock it. */
  private async lock(tx: Transaction, id: string): Promise<ServiceRow> {
    const [row] = await tx
      .select()
      .from(catalogServices)
      .where(eq(catalogServices.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The packages holding the service, by name; `activeOnly` leaves archived packages out (C1). */
  private async usedInPackages(tx: Transaction, serviceId: string, activeOnly: boolean) {
    return tx
      .selectDistinct({ id: catalogPackages.id, name: catalogPackages.name })
      .from(catalogPackageItems)
      .innerJoin(catalogPackages, eq(catalogPackages.id, catalogPackageItems.packageId))
      .where(
        and(
          eq(catalogPackageItems.serviceId, serviceId),
          activeOnly ? isNull(catalogPackages.archivedAt) : undefined,
        ),
      )
      .orderBy(catalogPackages.name);
  }

  private async assertNameFree(tx: Transaction, name: string, exceptId: string | null) {
    const [taken] = await tx
      .select({ id: catalogServices.id })
      .from(catalogServices)
      .where(
        and(
          sql`lower(${catalogServices.name}) = lower(${name})`,
          isNull(catalogServices.archivedAt),
          exceptId ? ne(catalogServices.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(409, 'SERVICE_NAME_TAKEN', 'Another service has this name');
    }
  }

  private async toResponse(row: ServiceRow): Promise<CatalogService> {
    const [response] = await this.toResponses([row]);
    if (!response) throw new NotFoundException();
    return response;
  }

  private async toResponses(rows: ServiceRow[]): Promise<CatalogService[]> {
    const templates = await this.templates.summaries(rows.map((row) => row.templateId));
    return rows.map((row) => ({
      ...auditFields(row),
      id: row.id,
      template: row.templateId ? toTemplate(templates.get(row.templateId)) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }
}
