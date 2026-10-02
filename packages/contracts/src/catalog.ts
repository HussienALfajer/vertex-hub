import { z } from 'zod';
import { departmentCodeSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';
import { minorAmountSchema } from './money.js';
import { type DeliverableKind, deliverableKindSchema } from './retainers.js';
import { DEFAULT_REVISION_LIMIT, TASK_LIMITS } from './tasks.js';
import { templateKindSchema } from './templates.js';
import { optionalText } from './text.js';

/*
 * Service catalog (spec F04, ADR 0023): services with a default price, performing department,
 * revision rounds, an optional counted deliverable kind and template, and packages grouping
 * services under one price.
 */

/** `one_off` services are quoted once; `monthly` ones per month and feed retainers. */
export const CATALOG_BILLINGS = ['one_off', 'monthly'] as const;

export const catalogBillingSchema = z.enum(CATALOG_BILLINGS).meta({ id: 'CatalogBilling' });

export type CatalogBilling = z.infer<typeof catalogBillingSchema>;

export const CATALOG_LIMITS = { packageItems: 20, quantity: 999 } as const;

const catalogNameSchema = z.string().trim().min(1).max(120);

/** Which template kind a service or package of a billing may link (`INVALID_TEMPLATE`). */
export const TEMPLATE_KIND_BY_BILLING = {
  one_off: 'project',
  monthly: 'retainer_cycle',
} as const satisfies Record<CatalogBilling, z.infer<typeof templateKindSchema>>;

// Services

const serviceFieldsSchema = z.object({
  name: catalogNameSchema,
  description: optionalText(1000).default(null),
  department: departmentCodeSchema,
  billing: catalogBillingSchema,
  /** Per unit, or per unit per month for monthly services. */
  priceUsdMinor: minorAmountSchema,
  priceSypMinor: minorAmountSchema.nullable().default(null),
  revisionRounds: z
    .number()
    .int()
    .min(0)
    .max(TASK_LIMITS.revisionLimit)
    .default(DEFAULT_REVISION_LIMIT),
  /** Set = the service is counted and becomes a retainer deliverable line (monthly only). */
  deliverableKind: deliverableKindSchema.nullable().default(null),
  deliverableLabel: optionalText(60).default(null),
  templateId: z.uuid().nullable().default(null),
});

type ServiceRuleFields = {
  billing: CatalogBilling;
  deliverableKind: DeliverableKind | null;
  deliverableLabel: string | null;
};

export type CatalogIssue = { path: string[]; message: string };

/**
 * Rule C4 and the billing rules of a service's counted kind. The API runs it again on the merged
 * record of a partial update.
 */
export function serviceIssues(service: ServiceRuleFields): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (service.deliverableKind && service.billing !== 'monthly')
    issues.push({ path: ['deliverableKind'], message: 'Only monthly services are counted' });
  if (service.deliverableKind === 'other' && !service.deliverableLabel)
    issues.push({ path: ['deliverableLabel'], message: 'A counted kind "other" needs a label' });
  if (service.deliverableLabel && !service.deliverableKind)
    issues.push({ path: ['deliverableLabel'], message: 'A label needs a counted kind' });
  return issues;
}

/** A new service. The API checks the name (`SERVICE_NAME_TAKEN`) and the template. */
export const createCatalogServiceSchema = serviceFieldsSchema
  .superRefine((service, ctx) => {
    for (const { path, message } of serviceIssues(service))
      ctx.addIssue({ code: 'custom', path, message });
  })
  .meta({ id: 'CreateCatalogService' });

export type CreateCatalogService = z.infer<typeof createCatalogServiceSchema>;

export type CreateCatalogServiceInput = z.input<typeof createCatalogServiceSchema>;

/** Only the fields to change; the API runs `serviceIssues` on the merged service. */
export const updateCatalogServiceSchema = z
  .object(
    Object.fromEntries(
      Object.entries(serviceFieldsSchema.shape).map(([key, field]) => [
        key,
        field instanceof z.ZodDefault ? field.unwrap().optional() : field.optional(),
      ]),
    ) as {
      [K in keyof typeof serviceFieldsSchema.shape]: z.ZodOptional<
        (typeof serviceFieldsSchema.shape)[K] extends z.ZodDefault<infer T>
          ? T
          : (typeof serviceFieldsSchema.shape)[K]
      >;
    },
  )
  .meta({ id: 'UpdateCatalogService' });

export type UpdateCatalogService = z.infer<typeof updateCatalogServiceSchema>;

const catalogTemplateSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: templateKindSchema,
    archived: z.boolean(),
  })
  .meta({ id: 'CatalogTemplate' });

export const catalogServiceSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    department: departmentCodeSchema,
    billing: catalogBillingSchema,
    priceUsdMinor: minorAmountSchema,
    priceSypMinor: minorAmountSchema.nullable(),
    revisionRounds: z.number().int().min(0),
    deliverableKind: deliverableKindSchema.nullable(),
    deliverableLabel: z.string().nullable(),
    template: catalogTemplateSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'CatalogService' });

export type CatalogService = z.infer<typeof catalogServiceSchema>;

const catalogSearchSchema = z.string().trim().min(1).max(100).optional();

export const catalogServiceListQuerySchema = pageQuerySchema.extend({
  /** Matches the service name. */
  search: catalogSearchSchema,
  billing: catalogBillingSchema.optional(),
  department: departmentCodeSchema.optional(),
  /** `true` lists archived services only; needs `catalog.manage`. */
  archived: queryBooleanSchema.default(false),
});

export type CatalogServiceListQuery = z.infer<typeof catalogServiceListQuerySchema>;

export const catalogServicePageSchema = pageSchema(catalogServiceSchema).meta({
  id: 'CatalogServicePage',
  description: 'Catalog services, by name',
});

export type CatalogServicePage = z.infer<typeof catalogServicePageSchema>;

// Packages

const packageItemInputSchema = z.object({
  serviceId: z.uuid(),
  /** Per month for monthly packages. */
  quantity: z.number().int().min(1).max(CATALOG_LIMITS.quantity),
});

const packageItemsSchema = z
  .array(packageItemInputSchema)
  .min(1)
  .max(CATALOG_LIMITS.packageItems)
  .refine((items) => new Set(items.map((item) => item.serviceId)).size === items.length, {
    message: 'Each service is listed once',
  });

/** The package's fields without defaults, so a partial update changes only what it names. */
const packageFieldsSchema = z.object({
  name: catalogNameSchema,
  description: optionalText(1000),
  billing: catalogBillingSchema,
  /** The package price; per month for monthly packages. */
  priceUsdMinor: minorAmountSchema,
  priceSypMinor: minorAmountSchema.nullable(),
  /** Monthly packages only: a monthly template. */
  templateId: z.uuid().nullable(),
  /** In order; replaced as a whole on save. */
  items: packageItemsSchema,
});

/** A one-off package links no template; its services' templates are used. */
export function packageIssues(pkg: {
  billing: CatalogBilling;
  templateId: string | null;
}): CatalogIssue[] {
  return pkg.billing !== 'monthly' && pkg.templateId
    ? [{ path: ['templateId'], message: 'Only monthly packages link a template' }]
    : [];
}

/**
 * A new package. The API checks the name (`PACKAGE_NAME_TAKEN`), that every service exists, is
 * not archived and has the package's billing (`INVALID_PACKAGE_ITEM`), and the template.
 */
export const createCatalogPackageSchema = packageFieldsSchema
  .extend({
    description: packageFieldsSchema.shape.description.default(null),
    priceSypMinor: packageFieldsSchema.shape.priceSypMinor.default(null),
    templateId: packageFieldsSchema.shape.templateId.default(null),
  })
  .superRefine((pkg, ctx) => {
    for (const { path, message } of packageIssues(pkg))
      ctx.addIssue({ code: 'custom', path, message });
  })
  .meta({ id: 'CreateCatalogPackage' });

export type CreateCatalogPackage = z.infer<typeof createCatalogPackageSchema>;

export type CreateCatalogPackageInput = z.input<typeof createCatalogPackageSchema>;

/** Only the fields to change; `items`, when given, replaces every item. */
export const updateCatalogPackageSchema = packageFieldsSchema
  .partial()
  .meta({ id: 'UpdateCatalogPackage' });

export type UpdateCatalogPackage = z.infer<typeof updateCatalogPackageSchema>;

export const catalogPackageItemSchema = z
  .object({
    serviceId: z.uuid(),
    name: z.string(),
    department: departmentCodeSchema,
    quantity: z.number().int().min(1),
    deliverableKind: deliverableKindSchema.nullable(),
    deliverableLabel: z.string().nullable(),
    /** The service was archived after the package was archived. */
    archived: z.boolean(),
  })
  .meta({ id: 'CatalogPackageItem' });

export type CatalogPackageItem = z.infer<typeof catalogPackageItemSchema>;

export const catalogPackageSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    billing: catalogBillingSchema,
    priceUsdMinor: minorAmountSchema,
    priceSypMinor: minorAmountSchema.nullable(),
    template: catalogTemplateSchema.nullable(),
    items: z.array(catalogPackageItemSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'CatalogPackage' });

export type CatalogPackage = z.infer<typeof catalogPackageSchema>;

export const catalogPackageListQuerySchema = pageQuerySchema.extend({
  /** Matches the package name. */
  search: catalogSearchSchema,
  billing: catalogBillingSchema.optional(),
  /** `true` lists archived packages only; needs `catalog.manage`. */
  archived: queryBooleanSchema.default(false),
});

export type CatalogPackageListQuery = z.infer<typeof catalogPackageListQuerySchema>;

export const catalogPackagePageSchema = pageSchema(catalogPackageSchema).meta({
  id: 'CatalogPackagePage',
  description: 'Catalog packages, by name',
});

export type CatalogPackagePage = z.infer<typeof catalogPackagePageSchema>;
