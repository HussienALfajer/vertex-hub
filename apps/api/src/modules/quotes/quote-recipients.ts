import { Inject, Injectable } from '@nestjs/common';
import type { Database, Transaction } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';
import { LeadDirectory } from '../leads/index.js';
import { clientRecipient, leadRecipient, type Recipient } from './quote-access.js';
import type { QuoteRow } from './quote-records.js';

type Executor = Database | Transaction;

/** Whom quotes are for: their client, or their lead until it is converted (spec F03). */
@Injectable()
export class QuoteRecipients {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly leads: LeadDirectory,
  ) {}

  async of(
    quote: Pick<QuoteRow, 'clientId' | 'leadId'>,
    executor: Executor = this.db,
  ): Promise<Recipient | null> {
    if (quote.clientId) {
      const client = await this.clients.summary(quote.clientId, executor);
      return client && clientRecipient(client);
    }
    const lead = quote.leadId ? await this.leads.summary(quote.leadId, executor) : null;
    return lead && leadRecipient(lead);
  }

  /** Recipients by quote id. */
  async byQuote(
    rows: Pick<QuoteRow, 'id' | 'clientId' | 'leadId'>[],
    executor: Executor = this.db,
  ): Promise<Map<string, Recipient>> {
    const clients = await this.clients.summaries(
      rows.flatMap((row) => (row.clientId ? [row.clientId] : [])),
      executor,
    );
    const leads = await this.leads.summaries(
      rows.flatMap((row) => (!row.clientId && row.leadId ? [row.leadId] : [])),
      executor,
    );
    const result = new Map<string, Recipient>();
    for (const row of rows) {
      const client = row.clientId ? clients.get(row.clientId) : undefined;
      const lead = !row.clientId && row.leadId ? leads.get(row.leadId) : undefined;
      if (client) result.set(row.id, clientRecipient(client));
      else if (lead) result.set(row.id, leadRecipient(lead));
    }
    return result;
  }
}
