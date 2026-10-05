/*
 * The kinds of F14 email (ADR 0028), their audiences and the summary of a sent email, apart from
 * `emails.ts`, which imports the notifications: the notification catalog (`email_failed`) and the
 * approval requests (F09) use these.
 */

import { z } from 'zod';

export const EMAIL_AUDIENCES = ['staff', 'client'] as const;

export const emailAudienceSchema = z.enum(EMAIL_AUDIENCES).meta({ id: 'EmailAudience' });

export type EmailAudience = z.infer<typeof emailAudienceSchema>;

/** Rule 16: the emails a person sends a client from a document. */
export const CLIENT_EMAIL_KINDS = [
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

export const clientEmailKindSchema = z.enum(CLIENT_EMAIL_KINDS).meta({ id: 'ClientEmailKind' });

export type ClientEmailKind = z.infer<typeof clientEmailKindSchema>;

export const EMAIL_KINDS = [
  'notification_batch',
  'digest',
  'account_activation',
  'password_reset',
  'security_notice',
  'new_device',
  'test',
  ...CLIENT_EMAIL_KINDS,
] as const;

export const emailKindSchema = z.enum(EMAIL_KINDS).meta({ id: 'EmailKind' });

export type EmailKind = z.infer<typeof emailKindSchema>;

/** Who reads each kind: staff emails come from "Vertex Hub", client emails from "Vertex Media". */
export const emailAudienceOf = (kind: EmailKind): EmailAudience =>
  kind.startsWith('client_') ? 'client' : 'staff';

export const EMAIL_STATUSES = ['queued', 'sent', 'failed'] as const;

export const emailStatusSchema = z.enum(EMAIL_STATUSES).meta({ id: 'EmailStatus' });

export type EmailStatus = z.infer<typeof emailStatusSchema>;

export const emailAddressSchema = z
  .object({
    name: z.string().min(1),
    email: z.email(),
    userId: z.uuid().optional(),
    contactId: z.uuid().optional(),
  })
  .meta({ id: 'EmailAddress' });

export type EmailAddress = z.infer<typeof emailAddressSchema>;

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
