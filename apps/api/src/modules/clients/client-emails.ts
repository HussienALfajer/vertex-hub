import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ClientEmailKind,
  EmailAddress,
  EmailAttachment,
  EmailData,
  EmailHistory,
  EmailSummary,
} from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import { type ClientEmailData, clientEmailDraft } from '@vertex-hub/messages';
import { CodedException } from '../../core/errors/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { type EmailHistoryFilter, type EmailRecord, Mailer } from '../email/index.js';
import { ClientDirectory } from './client-directory.js';

/** Whom a client email goes to: the dialog's choices (rule 17). */
export interface ClientEmailRecipients {
  contactIds: readonly string[];
  /** The client's primary account manager. */
  ccAccountManager: boolean;
  ccMe: boolean;
}

/** A client email as the document's module gives it. */
export interface ClientEmailRequest<Kind extends ClientEmailKind> {
  /** Given when the attachment's key needs it first (rule 21). */
  id?: string;
  kind: Kind;
  clientId: string;
  recipients: ClientEmailRecipients;
  /** The dialog's subject; approval emails take their template's (rule 19). */
  subject?: string;
  /** The dialog's text, or the approval request's message (rule 19). */
  message: string | null;
  /** The template data; the client's name and the sender's signature are added here. */
  data: Omit<EmailData<Kind>, 'client' | 'signature'>;
  attachments?: EmailAttachment[];
  record: EmailRecord;
}

/** A queued client email, with what the module's audit entry records (rule 22). */
export interface QueuedClientEmail {
  id: string;
  audit: {
    emailId: string;
    kind: ClientEmailKind;
    to: { name: string; email: string }[];
    cc: { name: string; email: string }[];
    subject: string;
  };
}

/**
 * Client emails (F14 email rules 16–23): checks the client and the chosen contacts, copies the
 * account manager and the sender as asked, signs with the sender and queues the email. The
 * document's module checks its own conditions first and audits the email on its record.
 */
@Injectable()
export class ClientEmails {
  constructor(
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly mailer: Mailer,
  ) {}

  /** Rule 18: `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`; a missing client answers 404. */
  async queue<Kind extends ClientEmailKind>(
    tx: Transaction,
    actor: CurrentUserInfo,
    request: ClientEmailRequest<Kind>,
  ): Promise<QueuedClientEmail> {
    const client = await this.clients.summary(request.clientId, tx);
    if (!client) throw new NotFoundException();
    if (client.archived) {
      throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
    }
    const contacts = await this.clients.contacts([...request.recipients.contactIds], tx);
    const to: EmailAddress[] = request.recipients.contactIds.map((id) => {
      const contact = contacts.get(id);
      if (!contact || contact.clientId !== client.id || contact.archived || !contact.email) {
        throw new CodedException(
          409,
          'INVALID_RECIPIENT',
          'Every recipient must be a contact of the client with an email',
        );
      }
      return { name: contact.name, email: contact.email, contactId: contact.id };
    });
    const copied = [
      request.recipients.ccAccountManager ? client.accountManagerId : null,
      request.recipients.ccMe ? actor.id : null,
    ].filter((id): id is string => !!id);
    const mailboxes = await this.users.mailboxes(copied, tx);
    // A sender who is the account manager is copied once.
    const cc: EmailAddress[] = [...new Set(copied)].flatMap((id) => {
      const mailbox = mailboxes.get(id);
      return mailbox ? [{ name: mailbox.name, email: mailbox.email, userId: mailbox.id }] : [];
    });
    const signature = await this.users.signature(actor.id, tx);
    if (!signature) throw new Error('The sender has no account');
    const data = { ...request.data, client: client.name, signature } as EmailData<Kind>;
    const subject =
      request.subject ?? clientEmailDraft({ kind: request.kind, data } as ClientEmailData).subject;
    const id = await this.mailer.queue(tx, {
      id: request.id,
      kind: request.kind,
      to,
      cc,
      replyTo: actor.email,
      subject,
      message: request.message,
      data,
      attachments: request.attachments,
      sender: { id: actor.id, name: actor.name },
      clientId: client.id,
      record: request.record,
    });
    const address = ({ name, email }: EmailAddress) => ({ name, email });
    return {
      id,
      audit: {
        emailId: id,
        kind: request.kind,
        to: to.map(address),
        cc: cc.map(address),
        subject,
      },
    };
  }

  summary(id: string): Promise<EmailSummary> {
    return this.mailer.summary(id);
  }

  /** Screens 5: a document's emails, newest first. */
  history(filter: EmailHistoryFilter): Promise<EmailHistory> {
    return this.mailer.history(filter);
  }
}
