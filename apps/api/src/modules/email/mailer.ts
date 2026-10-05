import { createCipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_DATA_SCHEMAS,
  EMAIL_SECRET_FIELDS,
  EMAIL_SEND_JOB,
  type EmailAddress,
  type EmailAttachment,
  type EmailData,
  type EmailRecordType,
  emailAudienceOf,
  emailSendJobSchema,
  REDACTED,
  type SendableEmailKind,
} from '@vertex-hub/contracts';
import { emailMessages, type Transaction } from '@vertex-hub/db';
import { ENV, type Env } from '../../core/config/env.js';
import { JobQueue } from '../../core/jobs/index.js';

export interface QueuedEmail<Kind extends SendableEmailKind> {
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
  record?: { type: EmailRecordType; id: string } | null;
}

/**
 * The outbox (F14 email rule 1, ADR 0028). Modules queue their emails here, inside the
 * transaction of the change; `email` never reads their tables.
 */
@Injectable()
export class Mailer {
  constructor(
    private readonly jobs: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Writes the email and its `email.send` job in `tx`, so both commit or roll back with the
   * change. Returns the email's id.
   */
  async queue<Kind extends SendableEmailKind>(
    tx: Transaction,
    email: QueuedEmail<Kind>,
  ): Promise<string> {
    const parsed = EMAIL_DATA_SCHEMAS[email.kind].parse(email.data) as Record<string, unknown>;
    const { data, sealed } = this.seal(email.kind, parsed);
    const fields = {
      kind: email.kind,
      to: email.to,
      cc: email.cc ?? [],
      replyTo: email.replyTo ?? null,
      subject: email.subject,
      message: email.message ?? null,
      data,
      attachments: email.attachments ?? [],
    };
    const [row] = await tx
      .insert(emailMessages)
      .values({
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
