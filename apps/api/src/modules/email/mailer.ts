import { createCipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_ATTACHMENTS_MAX_BYTES,
  EMAIL_DATA_SCHEMAS,
  EMAIL_SECRET_FIELDS,
  EMAIL_SEND_JOB,
  type EmailAddress,
  type EmailAttachment,
  type EmailData,
  type EmailHistory,
  type EmailKind,
  type EmailRecordType,
  type EmailSummary,
  emailAudienceOf,
  emailSendJobSchema,
  REDACTED,
  type SendableEmailKind,
} from '@vertex-hub/contracts';
import { type Database, emailMessages, type Transaction } from '@vertex-hub/db';
import { and, desc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';

export interface QueuedEmail<Kind extends SendableEmailKind> {
  /** Given when the email's id is needed before it is queued (rule 21: its attachment's key). */
  id?: string;
  kind: Kind;
  to: EmailAddress[];
  cc?: EmailAddress[];
  /** The sender's address, for client emails. */
  replyTo?: string | null;
  subject: string;
  /** The editable text of a client email. */
  message?: string | null;
  data: EmailData<Kind>;
  attachments?: EmailAttachment[];
  /** The person who sends it; null for system emails. */
  sender: { id: string; name: string } | null;
  clientId?: string | null;
  record?: EmailRecord | null;
}

export interface EmailRecord {
  type: EmailRecordType;
  id: string;
}

/** Which emails a document's history shows (Screens 5); every given filter applies. */
export interface EmailHistoryFilter {
  /** Emails of any of these records. */
  records?: readonly EmailRecord[];
  clientId?: string;
  kinds?: readonly EmailKind[];
  /** A monthly report's month, from its data (rule 21). */
  month?: string;
}

/** A client email that failed for good (rule 23), as the failure handlers get it. */
export interface FailedEmail {
  id: string;
  kind: EmailKind;
  to: EmailAddress[];
  senderId: string;
  clientId: string | null;
  record: EmailRecord | null;
  data: Record<string, unknown>;
}

/** Runs in the transaction that records the failure. */
export type EmailFailureHandler = (tx: Transaction, email: FailedEmail) => Promise<void>;

type EmailRow = typeof emailMessages.$inferSelect;

/**
 * The outbox (F14 email rule 1, ADR 0028). Modules queue their emails here, inside the
 * transaction of the change; `email` never reads their tables.
 */
@Injectable()
export class Mailer {
  private readonly failureHandlers: EmailFailureHandler[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Rule 23: `notifications` registers how the sender of a failed client email is told, so
   * `email` imports no module.
   */
  onFailure(handler: EmailFailureHandler): void {
    this.failureHandlers.push(handler);
  }

  /** Rule 23: runs the failure handlers in the transaction that records the failure. */
  async failed(tx: Transaction, email: FailedEmail): Promise<void> {
    for (const handler of this.failureHandlers) await handler(tx, email);
  }

  /**
   * Writes the email and its `email.send` job in `tx`, so both commit or roll back with the
   * change. Returns the email's id.
   */
  async queue<Kind extends SendableEmailKind>(
    tx: Transaction,
    email: QueuedEmail<Kind>,
  ): Promise<string> {
    const parsed = EMAIL_DATA_SCHEMAS[email.kind].parse(email.data) as Record<string, unknown>;
    const attachments = email.attachments ?? [];
    const size = attachments.reduce((total, file) => total + file.sizeBytes, 0);
    if (size > EMAIL_ATTACHMENTS_MAX_BYTES) {
      throw new CodedException(409, 'ATTACHMENT_TOO_LARGE', 'The attachments exceed 10 MB');
    }
    const { data, sealed } = this.seal(email.kind, parsed);
    const fields = {
      kind: email.kind,
      to: email.to,
      cc: email.cc ?? [],
      replyTo: email.replyTo ?? null,
      subject: email.subject,
      message: email.message ?? null,
      data,
      attachments,
    };
    const [row] = await tx
      .insert(emailMessages)
      .values({
        ...(email.id ? { id: email.id } : {}),
        ...fields,
        audience: emailAudienceOf(email.kind),
        senderId: email.sender?.id ?? null,
        senderName: email.sender?.name ?? null,
        clientId: email.clientId ?? null,
        recordType: email.record?.type ?? null,
        recordId: email.record?.id ?? null,
      })
      .returning({ id: emailMessages.id });
    if (!row) throw new Error('Email not stored');
    const { queue, retryLimit, retryDelay, retryBackoff } = EMAIL_SEND_JOB;
    await this.jobs.sendInTransaction(
      tx,
      queue,
      emailSendJobSchema.parse({ id: row.id, ...fields, sealed }),
      { retryLimit, retryDelay, retryBackoff },
    );
    return row.id;
  }

  /** One email as its document's history and the dialogs show it. */
  async summary(id: string, executor: Database | Transaction = this.db): Promise<EmailSummary> {
    const [row] = await executor.select().from(emailMessages).where(eq(emailMessages.id, id));
    if (!row) throw new Error(`Email ${id} not found`);
    return emailSummary(row);
  }

  /** Screens 5: a document's emails, newest first. */
  async history(filter: EmailHistoryFilter): Promise<EmailHistory> {
    const filters: (SQL | undefined)[] = [];
    if (filter.records) {
      if (filter.records.length === 0) return { items: [] };
      filters.push(
        or(
          ...filter.records.map((record) =>
            and(eq(emailMessages.recordType, record.type), eq(emailMessages.recordId, record.id)),
          ),
        ),
      );
    }
    if (filter.clientId) filters.push(eq(emailMessages.clientId, filter.clientId));
    if (filter.kinds) filters.push(inArray(emailMessages.kind, [...filter.kinds]));
    if (filter.month) filters.push(sql`${emailMessages.data}->>'month' = ${filter.month}`);
    const rows = await this.db
      .select()
      .from(emailMessages)
      .where(and(...filters))
      .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id));
    return { items: rows.map(emailSummary) };
  }

  /**
   * ADR 0028: token links leave the data, which the row stores, and travel encrypted in the job
   * (AES-256-GCM under `EMAIL_SECRET_KEY`; base64url of IV, tag and ciphertext).
   */
  private seal(
    kind: SendableEmailKind,
    data: Record<string, unknown>,
  ): { data: Record<string, unknown>; sealed: string | null } {
    const fields = EMAIL_SECRET_FIELDS[kind] ?? [];
    if (fields.length === 0) return { data, sealed: null };
    const secrets = Object.fromEntries(fields.map((field) => [field, data[field]]));
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.env.EMAIL_SECRET_KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets)), cipher.final()]);
    return {
      data: { ...data, ...Object.fromEntries(fields.map((field) => [field, REDACTED])) },
      sealed: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url'),
    };
  }
}

export function emailSummary(row: EmailRow): EmailSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    // Written only by `queue`, which validates them.
    to: row.to as EmailAddress[],
    cc: row.cc as EmailAddress[],
    subject: row.subject,
    sender: row.senderId && row.senderName ? { id: row.senderId, name: row.senderName } : null,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    error: row.lastError,
  };
}
