import { z } from 'zod';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { httpUrlSchema, optionalText, uniqueTexts } from './text.js';
import { phoneSchema } from './users.js';

export const CLIENT_STATUSES = ['active', 'paused', 'ended'] as const;

export const clientStatusSchema = z.enum(CLIENT_STATUSES).meta({ id: 'ClientStatus' });

export type ClientStatus = z.infer<typeof clientStatusSchema>;

export const CLIENT_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'x',
  'linkedin',
  'youtube',
  'snapchat',
  'google_business',
  'website',
  'other',
] as const;

export const clientPlatformSchema = z.enum(CLIENT_PLATFORMS).meta({ id: 'ClientPlatform' });

export type ClientPlatform = z.infer<typeof clientPlatformSchema>;

/** `granted`: admin or editor access through the agency's business account; `pending`: requested. */
export const PLATFORM_ACCESS_STATES = ['granted', 'pending', 'none'] as const;

export const platformAccessSchema = z.enum(PLATFORM_ACCESS_STATES).meta({ id: 'PlatformAccess' });

export type PlatformAccess = z.infer<typeof platformAccessSchema>;

export const NOTE_CHANNELS = ['call', 'meeting', 'whatsapp', 'email', 'other'] as const;

export const noteChannelSchema = z.enum(NOTE_CHANNELS).meta({ id: 'NoteChannel' });

export type NoteChannel = z.infer<typeof noteChannelSchema>;

export const BRAND_FILE_KINDS = ['logo', 'font', 'guidelines', 'other'] as const;

export const REFERENCE_KINDS = ['liked', 'disliked'] as const;

/** Limits of what one client holds (spec F02). */
export const CLIENT_LIMITS = { contacts: 50, platformAccounts: 50 } as const;

// Brand kit

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((hex) => hex.toUpperCase());

const brandFileKindSchema = z.enum(BRAND_FILE_KINDS);

const referenceKindSchema = z.enum(REFERENCE_KINDS);

/** The brand kit as stored and returned. Brand files are links until F10. */
export const brandKitSchema = z
  .object({
    colors: z.array(z.object({ name: z.string().nullable(), hex: z.string() })),
    fonts: z.array(z.string()),
    toneOfVoice: z.string().nullable(),
    forbiddenWords: z.array(z.string()),
    files: z.array(z.object({ kind: brandFileKindSchema, label: z.string(), url: z.string() })),
    references: z.array(
      z.object({ kind: referenceKindSchema, url: z.string(), note: z.string().nullable() }),
    ),
  })
  .meta({ id: 'BrandKit' });

export type BrandKit = z.infer<typeof brandKitSchema>;

/** The brand kit is read and replaced as a whole; missing lists are empty. */
export const updateBrandKitSchema = z
  .object({
    colors: z
      .array(z.object({ name: optionalText(40).default(null), hex: hexColorSchema }))
      .max(20)
      .default([]),
    fonts: uniqueTexts(z.string().trim().min(1).max(60), 10).default([]),
    toneOfVoice: optionalText(2000).default(null),
    forbiddenWords: uniqueTexts(z.string().trim().min(1).max(60), 100).default([]),
    files: z
      .array(
        z.object({
          kind: brandFileKindSchema,
          label: z.string().trim().min(1).max(80),
          url: httpUrlSchema,
        }),
      )
      .max(30)
      .default([]),
    references: z
      .array(
        z.object({
          kind: referenceKindSchema,
          url: httpUrlSchema,
          note: optionalText(300).default(null),
        }),
      )
      .max(50)
      .default([]),
  })
  .meta({ id: 'UpdateBrandKit' });

export type UpdateBrandKit = z.infer<typeof updateBrandKitSchema>;

export type UpdateBrandKitInput = z.input<typeof updateBrandKitSchema>;

// Contacts

const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .nullable()
  .transform((value) => value || null)
  .pipe(z.email().nullable());

const contactFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  jobTitle: optionalText(80),
  phone: phoneSchema,
  email: optionalEmailSchema,
  hasFinalApproval: z.boolean(),
  notes: optionalText(500),
});

export const createContactSchema = contactFieldsSchema
  .partial({ jobTitle: true, phone: true, email: true, hasFinalApproval: true, notes: true })
  .meta({ id: 'CreateContact' });

export type CreateContact = z.infer<typeof createContactSchema>;

export type CreateContactInput = z.input<typeof createContactSchema>;

export const updateContactSchema = contactFieldsSchema.partial().meta({ id: 'UpdateContact' });

export type UpdateContact = z.infer<typeof updateContactSchema>;

export const contactSchema = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    name: z.string(),
    jobTitle: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    hasFinalApproval: z.boolean(),
    notes: z.string().nullable(),
  })
  .meta({ id: 'Contact' });

export type Contact = z.infer<typeof contactSchema>;

// Platform accounts

const platformAccountFieldsSchema = z.object({
  platform: clientPlatformSchema,
  label: optionalText(60),
  url: httpUrlSchema,
  agencyAccess: platformAccessSchema,
  adminNote: optionalText(300),
});

/** `label` names an `other` platform; checked here when both come in one request. */
const labelNamesOtherPlatform = (account: { platform?: ClientPlatform; label?: string | null }) =>
  account.platform !== 'other' || !!account.label;

const labelRequiredIssue = { message: 'An other platform needs a label', path: ['label'] };

export const createPlatformAccountSchema = platformAccountFieldsSchema
  .partial({ label: true, agencyAccess: true, adminNote: true })
  .refine(labelNamesOtherPlatform, labelRequiredIssue)
  .meta({ id: 'CreatePlatformAccount' });

export type CreatePlatformAccount = z.infer<typeof createPlatformAccountSchema>;

export type CreatePlatformAccountInput = z.input<typeof createPlatformAccountSchema>;

/** The service checks the label rule against the stored platform when only one of them changes. */
export const updatePlatformAccountSchema = platformAccountFieldsSchema
  .partial()
  .refine(
    (account) => account.label === undefined || labelNamesOtherPlatform(account),
    labelRequiredIssue,
  )
  .meta({ id: 'UpdatePlatformAccount' });

export type UpdatePlatformAccount = z.infer<typeof updatePlatformAccountSchema>;

export const platformAccountSchema = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    platform: clientPlatformSchema,
    label: z.string().nullable(),
    url: z.string(),
    agencyAccess: platformAccessSchema,
    adminNote: z.string().nullable(),
  })
  .meta({ id: 'PlatformAccount' });

export type PlatformAccount = z.infer<typeof platformAccountSchema>;

// Clients

export const tradeNameSchema = z.string().trim().min(1).max(120);

export const sectorSchema = optionalText(60);

const clientFieldsSchema = z.object({
  tradeName: tradeNameSchema,
  sector: sectorSchema,
  accountManagerId: z.uuid(),
  status: clientStatusSchema,
  isHealthcare: z.boolean(),
});

export const createClientSchema = clientFieldsSchema
  .extend({
    status: clientStatusSchema.default('active'),
    isHealthcare: z.boolean().default(false),
  })
  .partial({ sector: true })
  .meta({ id: 'CreateClient' });

export type CreateClient = z.infer<typeof createClientSchema>;

export type CreateClientInput = z.input<typeof createClientSchema>;

/** `accountManagerId` and `isHealthcare` need `clients.manage` with scope all. */
export const updateClientSchema = clientFieldsSchema.partial().meta({ id: 'UpdateClient' });

export type UpdateClient = z.infer<typeof updateClientSchema>;

export type UpdateClientInput = z.input<typeof updateClientSchema>;

export const clientResponseSchema = z
  .object({
    id: z.uuid(),
    tradeName: z.string(),
    sector: z.string().nullable(),
    status: clientStatusSchema,
    isHealthcare: z.boolean(),
    accountManager: z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }),
    /** A non-archived contact has final-approval authority (rule 9). */
    hasApprovalContact: z.boolean(),
  })
  .meta({ id: 'Client' });

export type ClientResponse = z.infer<typeof clientResponseSchema>;

export const clientDetailResponseSchema = clientResponseSchema
  .extend({
    brandKit: brandKitSchema,
    /** Non-archived contacts, by name. */
    contacts: z.array(contactSchema),
    /** Non-archived platform accounts, in the order they were added. */
    platformAccounts: z.array(platformAccountSchema),
    archivedAt: z.iso.datetime().nullable(),
    /** The caller may edit this client (basics, contacts, brand kit, platform accounts). */
    canManage: z.boolean(),
  })
  .meta({ id: 'ClientDetail' });

export type ClientDetailResponse = z.infer<typeof clientDetailResponseSchema>;

export const CLIENT_SORTS = ['tradeName', 'createdAt'] as const;

export const clientListQuerySchema = pageQuerySchema.extend({
  /** Matches the trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(clientStatusSchema).default(['active', 'paused']),
  accountManagerId: z.uuid().optional(),
  /** Matches case-insensitively. */
  sector: z.string().trim().min(1).max(60).optional(),
  healthcare: queryBooleanSchema.optional(),
  /** `true` lists archived clients only; needs `clients.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(CLIENT_SORTS).default('tradeName'),
  order: sortOrderSchema.default('asc'),
});

export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

export const clientPageSchema = pageSchema(clientResponseSchema).meta({ id: 'ClientPage' });

export type ClientPage = z.infer<typeof clientPageSchema>;

export const sectorListResponseSchema = z.object({ items: z.array(z.string()) }).meta({
  id: 'SectorList',
  description: 'Sectors of clients that are not archived, one spelling per sector, sorted',
});

export type SectorListResponse = z.infer<typeof sectorListResponseSchema>;

// Communication log

/** Five minutes of clock skew between the browser and the server. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const noteOccurredAtSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) <= Date.now() + CLOCK_SKEW_MS, {
    message: 'A note cannot be dated in the future',
  });

const noteFieldsSchema = z.object({
  occurredAt: noteOccurredAtSchema,
  channel: noteChannelSchema,
  contactId: z.uuid().nullable(),
  summary: z.string().trim().min(1).max(2000),
});

/** `occurredAt` defaults to now. */
export const createNoteSchema = noteFieldsSchema
  .partial({ occurredAt: true, contactId: true })
  .meta({ id: 'CreateNote' });

export type CreateNote = z.infer<typeof createNoteSchema>;

export type CreateNoteInput = z.input<typeof createNoteSchema>;

export const updateNoteSchema = noteFieldsSchema.partial().meta({ id: 'UpdateNote' });

export type UpdateNote = z.infer<typeof updateNoteSchema>;

export const noteSchema = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    occurredAt: z.iso.datetime(),
    channel: noteChannelSchema,
    summary: z.string(),
    author: z.object({ id: z.uuid(), name: z.string() }),
    /** Kept when the contact is removed later (rule 10). */
    contact: z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }).nullable(),
    canEdit: z.boolean(),
    canArchive: z.boolean(),
  })
  .meta({ id: 'Note' });

export type Note = z.infer<typeof noteSchema>;

export const noteListQuerySchema = pageQuerySchema.extend({
  channel: noteChannelSchema.optional(),
  contactId: z.uuid().optional(),
  authorId: z.uuid().optional(),
});

export type NoteListQuery = z.infer<typeof noteListQuerySchema>;

export const notePageSchema = pageSchema(noteSchema).meta({
  id: 'NotePage',
  description: 'Notes that are not archived, newest occurredAt first',
});

export type NotePage = z.infer<typeof notePageSchema>;
