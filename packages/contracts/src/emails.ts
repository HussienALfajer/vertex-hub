/*
 * F14 email (ADR 0028): one outbox, `email_messages`, written by the module that owns the change
 * through `Mailer.queue` and sent by the worker. The catalog of kinds, the row's shapes and the
 * email log.
 */

import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { pageQuerySchema, pageSchema, queryListSchema } from './lists.js';

export const EMAIL_AUDIENCES = ['staff', 'client'] as const;

export const emailAudienceSchema = z.enum(EMAIL_AUDIENCES).meta({ id: 'EmailAudience' });

export type EmailAudience = z.infer<typeof emailAudienceSchema>;

export const EMAIL_KINDS = [
  'notification_batch',
  'digest',
  'account_activation',
  'password_reset',
  'security_notice',
  'new_device',
  'test',
  'client_quote',
  'client_quote_reminder',
  'client_approval_link',
  'client_approval_reminder',
  'client_invoice',
  'client_invoice_reminder',
  'client_receipt',
  'client_statement',
  'client_report',
  'client_ad_receipt',
  'client_ad_budget_low',
] as const;

export const emailKindSchema = z.enum(EMAIL_KINDS).meta({ id: 'EmailKind' });

export type EmailKind = z.infer<typeof emailKindSchema>;

/** Who reads each kind: staff emails come from "Vertex Hub", client emails from "Vertex Media". */
export const emailAudienceOf = (kind: EmailKind): EmailAudience =>
  kind.startsWith('client_') ? 'client' : 'staff';

export const EMAIL_STATUSES = ['queued', 'sent', 'failed'] as const;

export const emailStatusSchema = z.enum(EMAIL_STATUSES).meta({ id: 'EmailStatus' });

export type EmailStatus = z.infer<typeof emailStatusSchema>;

/** The record a client email belongs to; statements, reports and ad budget notices use `client`. */
export const EMAIL_RECORD_TYPES = [
  'quote',
  'invoice',
  'payment',
  'approval_request',
  'client',
  'ad_wallet_entry',
] as const;

export const emailRecordTypeSchema = z.enum(EMAIL_RECORD_TYPES).meta({ id: 'EmailRecordType' });

export type EmailRecordType = z.infer<typeof emailRecordTypeSchema>;

export const EMAIL_LIMITS = {
  to: 10,
  cc: 5,
  subject: 200,
  message: 4000,
  error: 1000,
} as const;

/** Staff emails (notifications, digests, account emails, tests) are deleted after this (rule 25). */
export const STAFF_EMAIL_RETENTION_DAYS = 90;

export const emailAddressSchema = z
  .object({
    name: z.string().min(1),
    email: z.email(),
    userId: z.uuid().optional(),
    contactId: z.uuid().optional(),
  })
  .meta({ id: 'EmailAddress' });

export type EmailAddress = z.infer<typeof emailAddressSchema>;

export const emailAttachmentSchema = z.object({
  fileName: z.string().min(1),
  /** Path under `FILES_ROOT`. */
  storageKey: z.string().min(1),
  sizeBytes: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

/**
 * The template data of each kind, validated when the email is queued and again by the worker.
 * A kind gets its schema with the change that first sends it.
 */
export const EMAIL_DATA_SCHEMAS = {
  /** Rule 26: an administrator checks the configuration. */
  test: z.object({ requestedBy: z.string().min(1) }),
} satisfies Partial<Record<EmailKind, z.ZodType>>;

export type SendableEmailKind = keyof typeof EMAIL_DATA_SCHEMAS;

export type EmailData<Kind extends SendableEmailKind> = z.infer<(typeof EMAIL_DATA_SCHEMAS)[Kind]>;

const personSchema = z.object({ id: z.uuid(), name: z.string() });

export const emailSummarySchema = z
  .object({
    id: z.uuid(),
    kind: emailKindSchema,
    status: emailStatusSchema,
    to: z.array(emailAddressSchema),
    cc: z.array(emailAddressSchema),
    subject: z.string(),
    sender: personSchema.nullable(),
    createdAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable(),
    /** The SMTP error of the last attempt. */
    error: z.string().nullable(),
  })
  .meta({ id: 'EmailSummary', description: 'One email of the outbox' });

export type EmailSummary = z.infer<typeof emailSummarySchema>;

export const emailLogItemSchema = emailSummarySchema
  .extend({
    audience: emailAudienceSchema,
    attempts: z.number().int().min(0),
    record: z.object({ type: emailRecordTypeSchema, id: z.uuid() }).nullable(),
    clientId: z.uuid().nullable(),
  })
  .meta({ id: 'EmailLogItem' });

export type EmailLogItem = z.infer<typeof emailLogItemSchema>;

export const emailListQuerySchema = pageQuerySchema.extend({
  status: queryListSchema(emailStatusSchema).optional(),
  audience: emailAudienceSchema.optional(),
  kind: queryListSchema(emailKindSchema).optional(),
  /** First and last business day (Damascus) of the email's creation, inclusive. */
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  /** Part of a recipient's address or name. */
  search: z.string().trim().min(1).max(200).optional(),
});

export type EmailListQuery = z.infer<typeof emailListQuerySchema>;

export const emailPageSchema = pageSchema(emailLogItemSchema).meta({
  id: 'EmailPage',
  description: 'Emails of the outbox, newest first',
});

export type EmailPage = z.infer<typeof emailPageSchema>;
