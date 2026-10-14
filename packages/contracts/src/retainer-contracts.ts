import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { currencySchema, minorAmountSchema } from './money.js';
import { quotePdfStateSchema } from './quotes.js';
import {
  amendmentKindSchema,
  amendmentScopeSchema,
  deliverableKindSchema,
  termEndActionSchema,
} from './retainers.js';

// Retainer contracts (F05C): the agency's contract settings and default articles, the contracts
// of terms and open-ended retainers, and their annexes.

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

export type ContractBlock = (typeof CONTRACT_BLOCK_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{([^{}\n]*)\}/g;

const BLOCK_PATTERN = new RegExp(`\\{(${CONTRACT_BLOCK_PLACEHOLDERS.join('|')})\\}`, 'g');

/** The `{…}` names in a text that are not contract placeholders (`UNKNOWN_PLACEHOLDER`), once each. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(CONTRACT_PLACEHOLDERS);
  const unknown = new Set<string>();
  for (const [, name = ''] of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!known.has(name)) unknown.add(name);
  }
  return [...unknown];
}

/** The value placeholders of an article body replaced by their values (K7); blocks stay. */
export function fillContractValues(
  body: string,
  values: Record<(typeof CONTRACT_VALUE_PLACEHOLDERS)[number], string>,
): string {
  return body.replace(PLACEHOLDER_PATTERN, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name as keyof typeof values] : match,
  );
}

export type ContractBodyPart = { text: string } | { block: ContractBlock };

/**
 * An article body as printed (K7): its text paragraphs, one per non-empty line, and the generated
 * blocks where their placeholders stand. A block always stands on a line of its own; text around
 * it on the same line becomes its own paragraph.
 */
export function contractBodyParts(body: string): ContractBodyPart[] {
  const parts: ContractBodyPart[] = [];
  for (const line of body.split('\n')) {
    let last = 0;
    for (const match of line.matchAll(BLOCK_PATTERN)) {
      const text = line.slice(last, match.index).trim();
      if (text) parts.push({ text });
      parts.push({ block: match[1] as ContractBlock });
      last = match.index + match[0].length;
    }
    const text = line.slice(last).trim();
    if (text) parts.push({ text });
  }
  return parts;
}

/** The blocks no article prints: the issue dialog warns about them, without blocking (K7). */
export function absentContractBlocks(bodies: readonly string[]): ContractBlock[] {
  const present = new Set(
    bodies.flatMap((body) => [...body.matchAll(BLOCK_PATTERN)].map((match) => match[1])),
  );
  return CONTRACT_BLOCK_PLACEHOLDERS.filter((block) => !present.has(block));
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

// Contracts and annexes

export const CONTRACT_KINDS = ['term', 'open_ended'] as const;

export const contractKindSchema = z.enum(CONTRACT_KINDS).meta({ id: 'ContractKind' });

export type ContractKind = z.infer<typeof contractKindSchema>;

export const CONTRACT_STATUSES = ['draft', 'issued', 'signed', 'void'] as const;

export const contractStatusSchema = z.enum(CONTRACT_STATUSES).meta({ id: 'ContractStatus' });

export type ContractStatus = z.infer<typeof contractStatusSchema>;

export const CONTRACT_ANNEX_STATUSES = ['issued', 'signed', 'void'] as const;

export const contractAnnexStatusSchema = z
  .enum(CONTRACT_ANNEX_STATUSES)
  .meta({ id: 'ContractAnnexStatus' });

export type ContractAnnexStatus = z.infer<typeof contractAnnexStatusSchema>;

/** The fields of the two party tables (K6), as `missing[]` names them. */
export const CONTRACT_AGENCY_FIELDS = [
  'legalName',
  'tradeName',
  'companyType',
  'registrationNumber',
  'address',
  'phone',
  'email',
  'website',
  'representativeName',
  'representativeTitle',
] as const;

export const CONTRACT_CLIENT_FIELDS = [
  'signatoryName',
  'fatherName',
  'tradeName',
  'nationalId',
  'registrationNumber',
  'phone',
  'email',
  'address',
  'title',
] as const;

/** K4: issuing needs these; any other empty field prints as a line to fill in by hand. */
export const CONTRACT_REQUIRED_FIELDS = {
  agency: ['legalName', 'tradeName', 'representativeName'],
  client: ['signatoryName'],
} as const satisfies {
  agency: readonly (typeof CONTRACT_AGENCY_FIELDS)[number][];
  client: readonly (typeof CONTRACT_CLIENT_FIELDS)[number][];
};

export const contractMissingFieldSchema = z
  .object({
    party: z.enum(['agency', 'client']),
    field: z.enum([...new Set([...CONTRACT_AGENCY_FIELDS, ...CONTRACT_CLIENT_FIELDS])]),
    /** Issuing is refused until it is filled (`CONTRACT_INCOMPLETE`). */
    required: z.boolean(),
  })
  .meta({ id: 'ContractMissingField' });

export type ContractMissingField = z.infer<typeof contractMissingFieldSchema>;

const partyText = z.string();

export const contractAgencyPartySchema = z.object(
  Object.fromEntries(CONTRACT_AGENCY_FIELDS.map((field) => [field, partyText])) as Record<
    (typeof CONTRACT_AGENCY_FIELDS)[number],
    typeof partyText
  >,
);

export const contractClientPartySchema = z.object({
  ...(Object.fromEntries(
    CONTRACT_CLIENT_FIELDS.filter((field) => field !== 'nationalId').map((field) => [
      field,
      partyText,
    ]),
  ) as Record<Exclude<(typeof CONTRACT_CLIENT_FIELDS)[number], 'nationalId'>, typeof partyText>),
  /** Left out of responses to users without national ID access (edge case 12); in PDFs. */
  nationalId: partyText.optional(),
});

/**
 * The render payload of a contract (K6): frozen at issue in `snapshot`, built live for a draft
 * (K3). Empty strings print as lines to fill in by hand. Value placeholders are filled in the
 * articles; block placeholders stay and print `services`, `term` and `fees`.
 */
export const contractSnapshotSchema = z
  .object({
    /** Null on a draft (printed with a "draft" watermark). */
    displayNumber: z.string().nullable(),
    contractDate: calendarDateSchema,
    agency: contractAgencyPartySchema,
    client: contractClientPartySchema,
    slogan: z.string(),
    articles: z.array(z.object({ number: z.number().int().min(1), title: z.string(), body: z.string() })),
    services: z.object({
      /** The accepted quote's number and its monthly services and packages, when there is one. */
      quote: z
        .object({
          displayNumber: z.string(),
          lines: z.array(
            z.object({
              name: z.string(),
              quantity: z.number().int(),
              items: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
            }),
          ),
        })
        .nullable(),
      deliverables: z.array(
        z.object({
          kind: deliverableKindSchema,
          label: z.string().nullable(),
          quantity: z.number().int().min(0),
          revisionLimit: z.number().int().min(0),
        }),
      ),
    }),
    term: z.object({
      kind: contractKindSchema,
      retainerName: z.string(),
      startDate: calendarDateSchema,
      /** The day of the month cycles start on (1–31; the month's last day when it has fewer). */
      cycleDay: z.number().int().min(1).max(31),
      /** `term` only. */
      cycles: z.number().int().min(1).nullable(),
      endDate: calendarDateSchema.nullable(),
      endAction: termEndActionSchema.nullable(),
    }),
    fees: z.object({
      currency: currencySchema,
      /** `term`: the agreed total and its schedule; `open_ended`: the fee per cycle. */
      agreedTotalMinor: minorAmountSchema.nullable(),
      schedule: z.array(
        z.object({
          cycle: z.number().int().min(1),
          periodStart: calendarDateSchema,
          periodEnd: calendarDateSchema,
          amountMinor: minorAmountSchema,
        }),
      ),
      feeMinor: minorAmountSchema.nullable(),
    }),
  })
  .meta({ id: 'ContractSnapshot' });

export type ContractSnapshot = z.infer<typeof contractSnapshotSchema>;

/** The render payload of an annex (K10), frozen when it is issued. */
export const annexSnapshotSchema = z
  .object({
    annexNumber: z.number().int().min(1),
    contractNumber: z.string(),
    annexDate: calendarDateSchema,
    agency: contractAgencyPartySchema.pick({
      legalName: true,
      tradeName: true,
      representativeName: true,
      representativeTitle: true,
      website: true,
      address: true,
      phone: true,
    }),
    client: contractClientPartySchema.pick({ signatoryName: true, tradeName: true, title: true }),
    amendment: z.object({
      number: z.number().int().min(1),
      kind: amendmentKindSchema.exclude(['quote_renewal']),
      /** Null for a reschedule. */
      scope: amendmentScopeSchema.nullable(),
      effectiveCycle: z.number().int().min(1),
      periodStart: calendarDateSchema,
      periodEnd: calendarDateSchema,
      lines: z.array(
        z.object({
          kind: deliverableKindSchema,
          label: z.string().nullable(),
          quantityDelta: z.number().int(),
          revisionLimit: z.number().int().min(0).nullable(),
        }),
      ),
      currency: currencySchema,
      /** `change`: the fee change per cycle. */
      amountDeltaMinor: z.number().int(),
      /** `reschedule`: the new amount of each cycle. */
      schedule: z
        .array(
          z.object({
            cycle: z.number().int().min(1),
            periodStart: calendarDateSchema,
            periodEnd: calendarDateSchema,
            amountMinor: minorAmountSchema,
          }),
        )
        .nullable(),
      reason: z.string(),
    }),
  })
  .meta({ id: 'AnnexSnapshot' });

export type AnnexSnapshot = z.infer<typeof annexSnapshotSchema>;

const contractPersonSchema = z.object({ id: z.uuid(), name: z.string() });

const contractPdfSchema = z.object({ state: quotePdfStateSchema }).nullable();

const voidedSchema = z
  .object({ at: z.iso.datetime(), reason: z.string() })
  .nullable();

/** A signed copy: the contract's document (F10) holding the scan, downloaded from the file endpoints. */
const signedCopySchema = z
  .object({ signedOn: calendarDateSchema, fileItemId: z.uuid() })
  .nullable();

export const contractAnnexSchema = z
  .object({
    id: z.uuid(),
    contractId: z.uuid(),
    annexNumber: z.number().int().min(1),
    amendment: z.object({ id: z.uuid(), number: z.number().int().min(1) }),
    status: contractAnnexStatusSchema,
    annexDate: calendarDateSchema,
    pdf: contractPdfSchema,
    signed: signedCopySchema,
    voided: voidedSchema,
    issuedBy: contractPersonSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ContractAnnex' });

export type ContractAnnex = z.infer<typeof contractAnnexSchema>;

export const retainerContractSchema = z
  .object({
    id: z.uuid(),
    retainerId: z.uuid(),
    kind: contractKindSchema,
    /** `term` only. */
    term: z
      .object({
        id: z.uuid(),
        number: z.number().int().min(1),
        startCycle: z.number().int().min(1),
        cycles: z.number().int().min(1),
        startDate: calendarDateSchema,
        endDate: calendarDateSchema,
      })
      .nullable(),
    /** The first cycle it covers. */
    startCycle: z.number().int().min(1),
    status: contractStatusSchema,
    /** Set at issue. */
    number: z.string().nullable(),
    contractDate: calendarDateSchema,
    /** The issued PDF; null for drafts. */
    pdf: contractPdfSchema,
    signed: signedCopySchema,
    voided: voidedSchema,
    issuedAt: z.iso.datetime().nullable(),
    issuedBy: contractPersonSchema.nullable(),
    /** K9: the term was edited or cancelled, or applied amendments of its cycles have no annex. */
    changedSinceIssue: z.boolean(),
    /** Oldest first, void ones included. */
    annexes: z.array(contractAnnexSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'RetainerContract' });

export type RetainerContract = z.infer<typeof retainerContractSchema>;

export const retainerContractListSchema = z
  .object({ items: z.array(retainerContractSchema) })
  .meta({ id: 'RetainerContractList', description: 'Contracts, newest first' });

export type RetainerContractList = z.infer<typeof retainerContractListSchema>;

export const retainerContractDetailSchema = retainerContractSchema
  .extend({
    signatoryContact: contractPersonSchema.nullable(),
    /** The contract's own articles in order (edited on a draft, frozen copies once issued). */
    articles: z.array(contractArticleSchema),
    /** What prints: live for a draft (K3), the snapshot once issued. */
    content: contractSnapshotSchema,
    /** Party fields that print empty; a draft cannot issue while a required one is missing. */
    missing: z.array(contractMissingFieldSchema),
    /** Blocks no article prints (K7 warning). */
    absentBlocks: z.array(z.enum(CONTRACT_BLOCK_PLACEHOLDERS)),
    /** The last draft preview; null when none was asked for, and once issued. */
    draftPdf: z
      .object({
        state: quotePdfStateSchema,
        renderedAt: z.iso.datetime().nullable(),
        /** The draft (or what it prints) changed since the preview was rendered. */
        outdated: z.boolean(),
      })
      .nullable(),
    /** Contract managers of the client with money access (Roles). */
    canManage: z.boolean(),
  })
  .meta({ id: 'RetainerContractDetail' });

export type RetainerContractDetail = z.infer<typeof retainerContractDetailSchema>;

/** K1, K2: `termId` for a `term` contract, none for an `open_ended` one. */
export const createContractSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('term'), termId: z.uuid() }),
    z.object({ kind: z.literal('open_ended') }),
  ])
  .meta({ id: 'CreateContract' });

export type CreateContract = z.infer<typeof createContractSchema>;

/**
 * K2: a draft's date, signatory and articles. `articles` replaces the whole list in order; the
 * API refuses more than `CONTRACT_LIMITS.articles` (`LIMIT_REACHED`) and any unknown `{…}`.
 */
export const updateContractSchema = z
  .object({
    contractDate: calendarDateSchema,
    signatoryContactId: z.uuid().nullable(),
    articles: updateContractArticlesSchema.shape.articles,
  })
  .partial()
  .meta({ id: 'UpdateContract' });

export type UpdateContract = z.infer<typeof updateContractSchema>;

export type UpdateContractInput = z.input<typeof updateContractSchema>;

/** K8, K10: voiding an issued or signed contract or annex. */
export const voidContractSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'VoidContract' });

export type VoidContract = z.infer<typeof voidContractSchema>;

/** K5: the signed scan (an upload of the F10 upload endpoint) and the signing date. */
export const signedContractSchema = z
  .object({ signedOn: calendarDateSchema, uploadId: z.uuid() })
  .meta({ id: 'SignedContract' });

export type SignedContract = z.infer<typeof signedContractSchema>;

/** K10: issuing an annex for an applied amendment. */
export const issueAnnexSchema = z
  .object({ annexDate: calendarDateSchema })
  .meta({ id: 'IssueAnnex' });

export type IssueAnnex = z.infer<typeof issueAnnexSchema>;
