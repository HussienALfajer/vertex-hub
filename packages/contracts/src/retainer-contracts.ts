import { z } from 'zod';

// Retainer contracts (F05C): the agency's contract settings and the default articles. The
// contracts and annexes themselves arrive with PR 5.

export const CONTRACT_LIMITS = { articles: 40, titleLength: 120, bodyLength: 6000 } as const;

/** Value placeholders: replaced inside the text (K7). */
export const CONTRACT_VALUE_PLACEHOLDERS = [
  'agency_name',
  'client_name',
  'retainer_name',
  'payment_terms_days',
] as const;

/** Block placeholders: each stands on a line of its own and prints a generated table (K7). */
export const CONTRACT_BLOCK_PLACEHOLDERS = ['services', 'term', 'fees'] as const;

export const CONTRACT_PLACEHOLDERS = [
  ...CONTRACT_VALUE_PLACEHOLDERS,
  ...CONTRACT_BLOCK_PLACEHOLDERS,
] as const;

export type ContractPlaceholder = (typeof CONTRACT_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{([^{}\n]*)\}/g;

/** The `{…}` names in a text that are not contract placeholders (`UNKNOWN_PLACEHOLDER`), once each. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(CONTRACT_PLACEHOLDERS);
  const unknown = new Set<string>();
  for (const [, name = ''] of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!known.has(name)) unknown.add(name);
  }
  return [...unknown];
}

/** `<prefix>-<year>-<nnn>`: three digits, more when needed (K4). */
export function formatContractNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(3, '0')}`;
}

// Settings

export const contractNumberPrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2)
      .max(20)
      .regex(/^[A-Z0-9-]+$/),
  );

const settingsFieldsSchema = z.object({
  legalName: z.string().trim().max(120),
  tradeName: z.string().trim().max(120),
  companyType: z.string().trim().max(120),
  registrationNumber: z.string().trim().max(60),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  email: z.string().trim().max(120),
  website: z.string().trim().max(120),
  representativeName: z.string().trim().max(120),
  representativeTitle: z.string().trim().max(120),
  /** Printed under the parties. */
  slogan: z.string().trim().max(200),
  numberPrefix: contractNumberPrefixSchema,
});

/** Needs `catalog.manage`. Every field is plain text (K12). */
export const updateContractSettingsSchema = settingsFieldsSchema
  .partial()
  .meta({ id: 'UpdateContractSettings' });

export type UpdateContractSettings = z.infer<typeof updateContractSettingsSchema>;

export type UpdateContractSettingsInput = z.input<typeof updateContractSettingsSchema>;

export const contractArticleSchema = z
  .object({ id: z.uuid(), title: z.string(), body: z.string() })
  .meta({ id: 'ContractArticle' });

export type ContractArticle = z.infer<typeof contractArticleSchema>;

/**
 * The template's articles in order: an `id` keeps an article, one without is added, one left out
 * is archived. The API refuses more than `CONTRACT_LIMITS.articles` (`LIMIT_REACHED`) and any
 * `{…}` that is not a placeholder (`UNKNOWN_PLACEHOLDER`), so the UI can name them.
 */
export const updateContractArticlesSchema = z
  .object({
    articles: z
      .array(
        z.object({
          id: z.uuid().optional(),
          title: z.string().trim().min(1).max(CONTRACT_LIMITS.titleLength),
          body: z.string().trim().max(CONTRACT_LIMITS.bodyLength),
        }),
      )
      .max(200),
  })
  .meta({ id: 'UpdateContractArticles' });

export type UpdateContractArticles = z.infer<typeof updateContractArticlesSchema>;

export type UpdateContractArticlesInput = z.input<typeof updateContractArticlesSchema>;

export const contractArticlesResponseSchema = z
  .object({ articles: z.array(contractArticleSchema) })
  .meta({ id: 'ContractArticles' });

export type ContractArticlesResponse = z.infer<typeof contractArticlesResponseSchema>;

export const contractSettingsSchema = settingsFieldsSchema
  .extend({
    numberPrefix: z.string(),
    /** The number the next issued contract of this year gets. */
    nextNumber: z.string(),
    articles: z.array(contractArticleSchema),
    updatedAt: z.iso.datetime(),
    updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    canEdit: z.boolean(),
  })
  .meta({ id: 'ContractSettings' });

export type ContractSettings = z.infer<typeof contractSettingsSchema>;
