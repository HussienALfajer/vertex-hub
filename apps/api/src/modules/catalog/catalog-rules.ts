import { BadRequestException } from '@nestjs/common';
import {
  type CatalogBilling,
  type CatalogIssue,
  TEMPLATE_KIND_BY_BILLING,
} from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { TemplateDirectory, TemplateSummary } from '../templates/index.js';

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const toActor = (actor: CurrentUserInfo): AuditActor => ({
  id: actor.id,
  name: actor.name,
});

export const toTemplate = (template: TemplateSummary | undefined) =>
  template
    ? { id: template.id, name: template.name, kind: template.kind, archived: template.archived }
    : null;

/** The merged record of a partial update breaks a rule the create schema checks itself. */
export function assertNoIssues(issues: CatalogIssue[]): void {
  if (issues.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'The catalog item breaks a rule',
      details: issues,
    });
  }
}

/**
 * A linked template exists, is not archived (C3) and has the kind the billing needs: a project
 * template for one-off items, a monthly one for monthly items (`INVALID_TEMPLATE`).
 */
export async function assertTemplate(
  templates: TemplateDirectory,
  executor: Database | Transaction,
  templateId: string | null,
  billing: CatalogBilling,
): Promise<void> {
  if (!templateId) return;
  const template = (await templates.summaries([templateId], executor)).get(templateId);
  if (!template || template.archived || template.kind !== TEMPLATE_KIND_BY_BILLING[billing]) {
    throw new CodedException(
      400,
      'INVALID_TEMPLATE',
      'The template is archived, missing or of another kind',
    );
  }
}

/** The fields a partial update names; `undefined` means "unchanged". */
export function definedFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
