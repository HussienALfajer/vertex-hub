import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  CONTRACT_LIMITS,
  type ContractArticle,
  type ContractArticlesResponse,
  type ContractSettings,
  formatContractNumber,
  hasPermission,
  permissionScopes,
  type UpdateContractArticles,
  type UpdateContractSettings,
  unknownPlaceholders,
} from '@vertex-hub/contracts';
import {
  contractArticleTemplates,
  contractSettings,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ContractSources } from './contract-sources.js';
import { actorOf } from './project-access.js';

type SettingsRow = typeof contractSettings.$inferSelect;

/** The audit entity id of the single settings row, which has no id of its own. */
export const CONTRACT_SETTINGS_ENTITY_ID = '01a0e97d-0000-7000-8000-00000000f05c';

const auditFields = (row: SettingsRow) => ({
  legalName: row.legalName,
  tradeName: row.tradeName,
  companyType: row.companyType,
  registrationNumber: row.registrationNumber,
  address: row.address,
  phone: row.phone,
  email: row.email,
  website: row.website,
  representativeName: row.representativeName,
  representativeTitle: row.representativeTitle,
  slogan: row.slogan,
  numberPrefix: row.numberPrefix,
});

/**
 * Contract settings (F05C): the agency's legal details, the number prefix, the slogan and the
 * default articles (K12). Readers hold `projects.manage` and money access in any scope; editors
 * `catalog.manage`.
 */
@Injectable()
export class ContractSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly sources: ContractSources,
  ) {}

  /** The settings row, seeded by its migration; `forUpdate` locks it. */
  async row(
    executor: Database | Transaction = this.db,
    options: { forUpdate?: boolean } = {},
  ): Promise<SettingsRow> {
    const query = executor.select().from(contractSettings);
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new Error('The contract settings row is missing; run the migrations');
    return row;
  }

  /** The template's articles in order. */
  articles(executor: Database | Transaction = this.db): Promise<ContractArticle[]> {
    return executor
      .select({
        id: contractArticleTemplates.id,
        title: contractArticleTemplates.title,
        body: contractArticleTemplates.body,
      })
      .from(contractArticleTemplates)
      .where(isNull(contractArticleTemplates.archivedAt))
      .orderBy(asc(contractArticleTemplates.position), asc(contractArticleTemplates.id));
  }

  async get(actor: CurrentUserInfo): Promise<ContractSettings> {
    assertCanRead(actor);
    return this.toResponse(actor, await this.row(), await this.articles());
  }

  async update(actor: CurrentUserInfo, input: UpdateContractSettings): Promise<ContractSettings> {
    assertCanEdit(actor);
    const row = await this.db.transaction(async (tx) => {
      const current = await this.row(tx, { forUpdate: true });
      const changes = changedFields(auditFields(current), input);
      if (!changes) return current;
      const [updated] = await tx
        .update(contractSettings)
        .set({ ...changes.after, updatedAt: new Date(), updatedById: actor.id })
        .returning();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'contract_settings.updated',
        entityType: 'contract_settings',
        entityId: CONTRACT_SETTINGS_ENTITY_ID,
        before: changes.before,
        after: changes.after,
      });
      return updated ?? current;
    });
    return this.toResponse(actor, row, await this.articles());
  }

  /**
   * Replaces the template (K12): the articles in the given order, kept by id, added without one,
   * archived when left out. Applies to drafts prepared afterwards only.
   */
  async updateArticles(
    actor: CurrentUserInfo,
    input: UpdateContractArticles,
  ): Promise<ContractArticlesResponse> {
    assertCanEdit(actor);
    if (input.articles.length > CONTRACT_LIMITS.articles) {
      throw new CodedException(
        409,
        'LIMIT_REACHED',
        `The template holds at most ${CONTRACT_LIMITS.articles} articles`,
      );
    }
    if (input.articles.some((article) => unknownPlaceholders(article.body).length > 0)) {
      throw new CodedException(
        400,
        'UNKNOWN_PLACEHOLDER',
        'An article names an unknown placeholder',
      );
    }
    const ids = input.articles.flatMap((article) => (article.id ? [article.id] : []));
    if (new Set(ids).size !== ids.length) {
      throw new CodedException(400, 'INVALID_ORDER', 'An article appears twice');
    }
    const articles = await this.db.transaction(async (tx) => {
      // The settings row lock serialises template edits.
      const settings = await this.row(tx, { forUpdate: true });
      const before = await this.articles(tx);
      const known = new Set(before.map((article) => article.id));
      if (ids.some((id) => !known.has(id))) {
        throw new CodedException(400, 'INVALID_ORDER', 'An article is not in the template');
      }
      const kept = new Set(ids);
      const removed = before.filter((article) => !kept.has(article.id)).map(({ id }) => id);
      const now = new Date();
      if (removed.length > 0) {
        await tx
          .update(contractArticleTemplates)
          .set({ archivedAt: now })
          .where(inArray(contractArticleTemplates.id, removed));
      }
      for (const [index, article] of input.articles.entries()) {
        const fields = { position: index + 1, title: article.title, body: article.body };
        if (article.id) {
          await tx
            .update(contractArticleTemplates)
            .set(fields)
            .where(
              and(
                eq(contractArticleTemplates.id, article.id),
                isNull(contractArticleTemplates.archivedAt),
              ),
            );
        } else {
          await tx.insert(contractArticleTemplates).values(fields);
        }
      }
      const after = await this.articles(tx);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await tx
          .update(contractSettings)
          .set({ updatedAt: now, updatedById: actor.id })
          .where(eq(contractSettings.singleton, settings.singleton));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'contract_settings.articles_updated',
          entityType: 'contract_settings',
          entityId: CONTRACT_SETTINGS_ENTITY_ID,
          // Titles in order: bodies are long, and the template's history is the log's only.
          before: { articles: before.map(({ title }) => title) },
          after: { articles: after.map(({ title }) => title) },
        });
      }
      return after;
    });
    return { articles };
  }

  private async toResponse(
    actor: CurrentUserInfo,
    row: SettingsRow,
    articles: ContractArticle[],
  ): Promise<ContractSettings> {
    const users = await this.users.summaries(row.updatedById ? [row.updatedById] : []);
    const updatedBy = row.updatedById ? users.get(row.updatedById) : undefined;
    const year = Number(businessDate().slice(0, 4));
    return {
      ...auditFields(row),
      nextNumber: formatContractNumber(
        row.numberPrefix,
        year,
        await this.sources.numbering.peek(this.db, year),
      ),
      articles,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: updatedBy
        ? { id: updatedBy.id, name: updatedBy.name, imageId: updatedBy.imageId }
        : null,
      canEdit: hasPermission(actor.access, 'catalog.manage'),
    };
  }
}

/**
 * Contract readers (Roles): those who manage retainers, `projects.manage` with client scope (the
 * `assigned` scope every user holds manages projects only), with money access in any scope.
 */
export const canReadContractSettings = (actor: CurrentUserInfo) =>
  permissionScopes(actor.access, 'projects.manage').some(
    (scope) => scope === 'all' || scope === 'own_clients',
  ) && hasPermission(actor.access, 'invoices.read');

function assertCanRead(actor: CurrentUserInfo): void {
  if (!canReadContractSettings(actor)) throw new ForbiddenException();
}

function assertCanEdit(actor: CurrentUserInfo): void {
  if (!hasPermission(actor.access, 'catalog.manage')) throw new ForbiddenException();
}
