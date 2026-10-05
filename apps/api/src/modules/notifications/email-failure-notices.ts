import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type ClientEmailKind,
  clientEmailKindSchema,
  EMAIL_DATA_SCHEMAS,
  type EmailData,
  type NotificationSubjectType,
} from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import { type FailedEmail, Mailer } from '../email/index.js';
import { NotificationCenter } from './notification-center.js';

/**
 * F14 email rule 23: a client email that failed for good notifies its sender with
 * `email_failed`, opening the document (the client for statements, reports and ad emails).
 * Registered with `email`, which imports no module.
 */
@Injectable()
export class EmailFailureNotices implements OnModuleInit {
  constructor(
    private readonly mailer: Mailer,
    private readonly center: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.mailer.onFailure((tx, email) => this.notify(tx, email));
  }

  async notify(tx: Transaction, email: FailedEmail): Promise<void> {
    const kind = clientEmailKindSchema.parse(email.kind);
    const data = EMAIL_DATA_SCHEMAS[kind].parse(email.data);
    const subject = subjectOf(kind, data, email);
    if (!subject) return;
    await this.center.notify(tx, {
      type: 'email_failed',
      recipients: [email.senderId],
      actorId: null,
      subjectType: subject.type,
      subjectId: subject.id,
      data: {
        kind,
        client: data.client,
        document: documentOf(kind, data),
        recipients: email.to.map((recipient) => recipient.name),
      },
    });
  }
}

/** The record the notice opens: the document, or the client. */
function subjectOf(
  kind: ClientEmailKind,
  data: EmailData<ClientEmailKind>,
  email: FailedEmail,
): { type: NotificationSubjectType; id: string } | null {
  if (kind === 'client_receipt' && 'invoiceId' in data) {
    return { type: 'invoice', id: data.invoiceId };
  }
  switch (email.record?.type) {
    case 'quote':
    case 'invoice':
    case 'approval_request':
      return { type: email.record.type, id: email.record.id };
    default:
      return email.clientId ? { type: 'client', id: email.clientId } : null;
  }
}

/** The document's number, or the report's month; null when the email has neither. */
function documentOf(kind: ClientEmailKind, data: EmailData<ClientEmailKind>): string | null {
  if ('quote' in data) return data.quote.number;
  if ('invoice' in data) return data.invoice.number;
  if ('receipt' in data) return data.receipt.number;
  if (kind === 'client_report' && 'month' in data) return data.month;
  return null;
}
