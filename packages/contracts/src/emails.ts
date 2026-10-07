/*
 * F14 email (ADR 0028): one outbox, `email_messages`, written by the module that owns the change
 * through `Mailer.queue` and sent by the worker. The catalog of kinds, the row's shapes and the
 * email log.
 */

import { z } from 'zod';
import {
  businessDate,
  businessTimeOfDay,
  calendarDateSchema,
  isWorkDay,
  timeOfDaySchema,
} from './dates.js';
import { departmentCodeSchema } from './departments.js';
import {
  type EmailKind,
  emailAudienceSchema,
  emailKindSchema,
  emailStatusSchema,
  emailSummarySchema,
} from './email-basics.js';
import { clientStatementQuerySchema } from './invoices.js';
import { pageQuerySchema, pageSchema, queryListSchema } from './lists.js';
import { currencySchema, minorAmountSchema, signedMinorAmountSchema } from './money.js';
import { notificationSchema } from './notifications.js';
import { reportMonthSchema } from './reports.js';

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

export const emailAttachmentSchema = z.object({
  fileName: z.string().min(1),
  /** Path under `FILES_ROOT`. */
  storageKey: z.string().min(1),
  sizeBytes: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

/** Edge case 15: the attachments of one email; more is refused before queueing. */
export const EMAIL_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;

/* Notification emails and the digest (rules 3–12). */

export const NOTIFICATION_EMAIL = {
  /** Rule 3: a notification waits this long before it may be emailed. */
  delayMinutes: 10,
  /** Rule 6: items in one batch email; the rest are counted as "n more". */
  batchItems: 20,
  /** Rule 7: batches go out on work days from `from` until `to`, Damascus time. */
  window: { from: '08:10', to: '20:00' },
  /** Rule 10: tasks in each digest list, and notifications held overnight. */
  digestTasks: 10,
  digestNotifications: 20,
} as const;

/** Rule 7: whether batches may go out at `now` (work days, 08:10 to 20:00 Damascus). */
export function isEmailBatchWindow(now: Date): boolean {
  const time = businessTimeOfDay(now).slice(0, 5);
  const { from, to } = NOTIFICATION_EMAIL.window;
  return isWorkDay(businessDate(now)) && time >= from && time < to;
}

/** A department code and its display name, for the texts that name departments. */
const departmentNamesSchema = z.partialRecord(departmentCodeSchema, z.string());

/** A list cut to its first items, with how many were left out. */
const shortListSchema = <Item extends z.ZodType>(item: Item, max: number) =>
  z.object({ items: z.array(item).max(max), more: z.number().int().min(0) });

/** A task in the digest (rule 10), as the `tasks` digest source gives it. */
export const digestTaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  client: z.string().nullable(),
  dueDate: calendarDateSchema,
  dueTime: timeOfDaySchema.nullable(),
  /** Work is late by this many days; 0 when due today. */
  daysLate: z.number().int().min(0),
});

export type DigestTask = z.infer<typeof digestTaskSchema>;

/** Rule 14: what changed on the account. */
export const SECURITY_CHANGES = [
  'password_changed',
  'two_factor_enabled',
  'two_factor_disabled',
  'two_factor_reset',
  'backup_codes_regenerated',
  'roles_changed',
  'archived',
] as const;

export type SecurityChange = (typeof SECURITY_CHANGES)[number];

/** An activation or reset link (rule 13): its token is sealed in the job and redacted in the row. */
const accountLinkSchema = z.object({
  name: z.string().min(1),
  link: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

/* Client emails (rules 16–23). */

const moneySchema = z.object({ amountMinor: minorAmountSchema, currency: currencySchema });

/** Rule 17: the sender's signature under the message. */
const signatureSchema = z.object({
  name: z.string().min(1),
  title: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.email(),
});

/** What every client email carries: the client's name and the sender's signature. */
const clientEmailDataSchema = z.object({ client: z.string().min(1), signature: signatureSchema });

const quoteFactsSchema = clientEmailDataSchema.extend({
  quote: z.object({
    number: z.string().min(1),
    title: z.string().min(1),
    currency: currencySchema,
    /** The one-off net; null without one-off lines. */
    oneOffMinor: minorAmountSchema.nullable(),
    /** The monthly net, per month; null without monthly lines. */
    monthlyMinor: minorAmountSchema.nullable(),
    validUntil: calendarDateSchema,
  }),
});

const invoiceFactsSchema = clientEmailDataSchema.extend({
  invoice: z.object({
    number: z.string().min(1),
    issuedOn: calendarDateSchema,
    dueOn: calendarDateSchema,
    total: moneySchema,
    /** What is left to pay. */
    balance: moneySchema,
  }),
});

/** Rule 19: the request's contact, message and items; the request's message is the message. */
const approvalFactsSchema = clientEmailDataSchema.extend({
  contact: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
  expiresAt: z.iso.datetime(),
});

/**
 * The template data of each kind, validated when the email is queued and again by the worker.
 * A kind gets its schema with the change that first sends it.
 */
export const EMAIL_DATA_SCHEMAS = {
  /** Rule 26: an administrator checks the configuration. */
  test: z.object({ requestedBy: z.string().min(1) }),
  /** Rules 6–9: the recipient's notifications, newest first. */
  notification_batch: z.object({
    notifications: shortListSchema(notificationSchema, NOTIFICATION_EMAIL.batchItems),
    departments: departmentNamesSchema,
  }),
  /** Rule 10: the morning digest of one work day. */
  digest: z.object({
    date: calendarDateSchema,
    overdue: shortListSchema(digestTaskSchema, NOTIFICATION_EMAIL.digestTasks),
    dueToday: shortListSchema(digestTaskSchema, NOTIFICATION_EMAIL.digestTasks),
    notifications: shortListSchema(notificationSchema, NOTIFICATION_EMAIL.digestNotifications),
    unreadCount: z.number().int().min(0),
    departments: departmentNamesSchema,
  }),
  /** Rule 13: a user created, restored, or sent a new activation link. */
  account_activation: accountLinkSchema.extend({ restored: z.boolean() }),
  /** Rule 13: a reset link from a user manager, or asked for by the user (`requested`). */
  password_reset: accountLinkSchema.extend({ requested: z.boolean() }),
  /** Rule 14: `by` is the user manager who made the change; null when it was the user. */
  security_notice: z.object({
    name: z.string().min(1),
    change: z.enum(SECURITY_CHANGES),
    at: z.iso.datetime(),
    by: z.string().nullable(),
  }),
  /** Rule 15: a sign-in from a browser and system the user had not used. */
  new_device: z.object({
    name: z.string().min(1),
    device: z.string().min(1),
    ip: z.string().nullable(),
    at: z.iso.datetime(),
  }),
  /** Rules 17–18: a sent quote, with its PDF. */
  client_quote: quoteFactsSchema,
  /** Rule 18: a sent quote still valid, with its PDF. */
  client_quote_reminder: quoteFactsSchema,
  /** Rule 19: the approval link of a created or reissued request. */
  client_approval_link: approvalFactsSchema.extend({ link: z.string().min(1) }),
  /** Rule 19: the reminder carries no link; it points to the earlier email. */
  client_approval_reminder: approvalFactsSchema,
  /** Rule 18: an issued invoice, with its PDF. */
  client_invoice: invoiceFactsSchema,
  /** Rule 18: an overdue invoice, with its PDF. */
  client_invoice_reminder: invoiceFactsSchema.extend({ daysOverdue: z.number().int().min(1) }),
  /** Rule 18: the receipt of a payment; `invoiceId` is what a failure notice opens (rule 23). */
  client_receipt: clientEmailDataSchema.extend({
    invoiceId: z.uuid(),
    receipt: z.object({
      number: z.string().min(1),
      invoiceNumber: z.string().min(1),
      paidOn: calendarDateSchema,
      amount: moneySchema,
    }),
  }),
  /** Rule 21: a rendered statement of one currency and period. */
  client_statement: clientEmailDataSchema.extend({
    statement: z.object({
      currency: currencySchema,
      from: calendarDateSchema,
      to: calendarDateSchema,
      outstandingMinor: signedMinorAmountSchema,
    }),
  }),
  /** Rule 21: a rendered monthly client report (F15). */
  client_report: clientEmailDataSchema.extend({ month: reportMonthSchema }),
  /** Rule 18: the receipt of an ad deposit (F12). */
  client_ad_receipt: clientEmailDataSchema.extend({
    receipt: z.object({
      number: z.string().min(1),
      occurredOn: calendarDateSchema,
      amount: moneySchema,
    }),
  }),
  /** Rule 18: the ad wallet is below its threshold (F12 rule 20); amounts in USD. */
  client_ad_budget_low: clientEmailDataSchema.extend({
    balanceMinor: signedMinorAmountSchema,
    thresholdMinor: minorAmountSchema,
  }),
} satisfies Partial<Record<EmailKind, z.ZodType>>;

/**
 * The data fields that hold a token link (ADR 0028): the job carries them encrypted under
 * `EMAIL_SECRET_KEY` and the outbox row keeps `REDACTED` in their place.
 */
export const EMAIL_SECRET_FIELDS: Partial<Record<EmailKind, readonly string[]>> = {
  account_activation: ['link'],
  password_reset: ['link'],
  client_approval_link: ['link'],
};

export const REDACTED = '[redacted]';

export type SendableEmailKind = keyof typeof EMAIL_DATA_SCHEMAS;

export type EmailData<Kind extends SendableEmailKind> = z.infer<(typeof EMAIL_DATA_SCHEMAS)[Kind]>;

/**
 * What a person writes in the "Send by email" dialog (rule 17): the client's contacts with an
 * email, the copies, the subject and the message. The API checks the contacts
 * (`INVALID_RECIPIENT`).
 */
export const clientEmailSchema = z
  .object({
    contactIds: z
      .array(z.uuid())
      .min(1)
      .max(EMAIL_LIMITS.to)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'A contact is chosen once' }),
    /** The client's primary account manager. */
    ccAccountManager: z.boolean().default(true),
    ccMe: z.boolean().default(false),
    subject: z.string().trim().min(1).max(EMAIL_LIMITS.subject),
    /** Plain text with line breaks. */
    message: z.string().trim().min(1).max(EMAIL_LIMITS.message),
  })
  .meta({ id: 'ClientEmail' });

export type ClientEmail = z.infer<typeof clientEmailSchema>;

export type ClientEmailInput = z.input<typeof clientEmailSchema>;

export const quoteEmailSchema = clientEmailSchema
  .extend({ kind: z.enum(['quote', 'reminder']) })
  .meta({ id: 'QuoteEmail' });

export type QuoteEmail = z.infer<typeof quoteEmailSchema>;

export const invoiceEmailSchema = clientEmailSchema
  .extend({ kind: z.enum(['invoice', 'overdue_reminder']) })
  .meta({ id: 'InvoiceEmail' });

export type InvoiceEmail = z.infer<typeof invoiceEmailSchema>;

/** Rule 21: the statement as rendered; its ready PDF is found as the download finds it. */
export const statementEmailSchema = clientEmailSchema
  .extend(clientStatementQuerySchema.shape)
  .meta({ id: 'StatementEmail' });

export type StatementEmail = z.infer<typeof statementEmailSchema>;

/** Rule 21: the monthly report as rendered; its ready PDF is found as the download finds it. */
export const reportEmailSchema = clientEmailSchema
  .extend({ month: reportMonthSchema })
  .meta({ id: 'ReportEmail' });

export type ReportEmail = z.infer<typeof reportEmailSchema>;

export const emailHistorySchema = z
  .object({ items: z.array(emailSummarySchema) })
  .meta({ id: 'EmailHistory', description: "A document's emails, newest first" });

export type EmailHistory = z.infer<typeof emailHistorySchema>;

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
