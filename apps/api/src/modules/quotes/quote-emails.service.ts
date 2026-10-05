import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type EmailHistory,
  type EmailSummary,
  type QuoteEmail,
  quoteSnapshotSchema,
} from '@vertex-hub/contracts';
import { type Database, quotes } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientEmails } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { actorOf, canRead, covers } from './quote-access.js';
import { QuoteRecipients } from './quote-recipients.js';

/**
 * F14 email: a sent quote, or its reminder while it is valid, emailed to the client's contacts
 * with the PDF of the sent version (rules 18 and 20), and the quote's email history.
 */
@Injectable()
export class QuoteEmailsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly recipients: QuoteRecipients,
    private readonly clientEmails: ClientEmails,
    private readonly files: GeneratedFiles,
  ) {}

  /**
   * 404 outside `quotes.read`, 403 without `quotes.manage` over the client, then `QUOTE_NOT_SENT`,
   * `QUOTE_EXPIRED` (reminder), `PDF_NOT_READY` and the client email checks. A lead's quote has
   * no client contacts: `INVALID_RECIPIENT`.
   */
  async send(actor: CurrentUserInfo, id: string, input: QuoteEmail): Promise<EmailSummary> {
    const emailId = await this.db.transaction(async (tx) => {
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id));
      const recipient = quote ? await this.recipients.of(quote, tx) : null;
      if (!quote || !recipient || !canRead(actor, recipient, quote)) {
        throw new NotFoundException();
      }
      if (!covers(actor, 'quotes.manage', recipient)) throw new ForbiddenException();
      if (quote.status !== 'sent') {
        throw new CodedException(409, 'QUOTE_NOT_SENT', 'Only a sent quote is emailed');
      }
      if (input.kind === 'reminder' && (!quote.validUntil || quote.validUntil < businessDate())) {
        throw new CodedException(409, 'QUOTE_EXPIRED', 'The quote is no longer valid');
      }
      if (!quote.clientId || !quote.validUntil) {
        throw new CodedException(409, 'INVALID_RECIPIENT', 'A lead has no client contacts');
      }
      const file =
        quote.pdfStatus === 'ready' && quote.pdfFileItemId
          ? await this.files.latest(quote.pdfFileItemId)
          : null;
      if (!file) throw new CodedException(409, 'PDF_NOT_READY', 'The PDF is not ready yet');
      const snapshot = quoteSnapshotSchema.parse(quote.snapshot);
      const queued = await this.clientEmails.queue(tx, actor, {
        kind: input.kind === 'reminder' ? 'client_quote_reminder' : 'client_quote',
        clientId: quote.clientId,
        recipients: input,
        subject: input.subject,
        message: input.message,
        data: {
          quote: {
            number: snapshot.displayNumber,
            title: snapshot.title,
            currency: snapshot.currency,
            oneOffMinor: snapshot.oneOff.lines.length > 0 ? snapshot.oneOff.netMinor : null,
            monthlyMinor: snapshot.monthly.lines.length > 0 ? snapshot.monthly.netMinor : null,
            validUntil: quote.validUntil,
          },
        },
        attachments: [
          {
            fileName: `${snapshot.displayNumber}.pdf`,
            storageKey: file.storageKey,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
          },
        ],
        record: { type: 'quote', id },
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.emailed',
        entityType: 'quote',
        entityId: id,
        after: { clientId: quote.clientId, email: queued.audit },
      });
      return queued.id;
    });
    return this.clientEmails.summary(emailId);
  }

  /** Screens 5: the quote's emails, newest first. */
  async history(actor: CurrentUserInfo, id: string): Promise<EmailHistory> {
    const [quote] = await this.db.select().from(quotes).where(eq(quotes.id, id));
    const recipient = quote ? await this.recipients.of(quote) : null;
    if (!quote || !recipient || !canRead(actor, recipient, quote)) throw new NotFoundException();
    return this.clientEmails.history({ records: [{ type: 'quote', id }] });
  }
}
