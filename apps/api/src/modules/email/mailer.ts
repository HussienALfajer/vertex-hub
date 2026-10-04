import { Injectable } from '@nestjs/common';
import {
  EMAIL_DATA_SCHEMAS,
  EMAIL_SEND_JOB,
  type EmailAddress,
  type EmailAttachment,
  type EmailData,
  type EmailRecordType,
  emailAudienceOf,
  emailSendJobSchema,
  type SendableEmailKind,
} from '@vertex-hub/contracts';
import { emailMessages, type Transaction } from '@vertex-hub/db';
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
  constructor(private readonly jobs: JobQueue) {}

  /**
   * Writes the email and its `email.send` job in `tx`, so both commit or roll back with the
   * change. Returns the email's id.
   */
  async queue<Kind extends SendableEmailKind>(
    tx: Transaction,
    email: QueuedEmail<Kind>,
  ): Promise<string> {
    const data = EMAIL_DATA_SCHEMAS[email.kind].parse(email.data) as Record<string, unknown>;
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
      emailSendJobSchema.parse({ id: row.id, ...fields }),
      { retryLimit, retryDelay, retryBackoff },
    );
    return row.id;
  }
}
