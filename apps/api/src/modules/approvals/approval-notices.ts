import { Injectable } from '@nestjs/common';
import type { ClientDecision } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import { ClientDirectory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import type { RequestRow } from './approval-items.js';

/** What happened to a request, as its notification says it. */
export type RequestEvent =
  | { type: 'approval_responded'; decision: ClientDecision }
  | { type: 'approval_no_response' }
  | { type: 'approval_expired' };

/**
 * The notifications of an approval request (spec F09, "Audit, notifications and jobs"): to the
 * client's account manager at that moment and the request's creator. No user acts in any of
 * them: the client answers, or the hourly job runs.
 */
@Injectable()
export class ApprovalNotices {
  constructor(
    private readonly clients: ClientDirectory,
    private readonly center: NotificationCenter,
  ) {}

  async send(
    tx: Transaction,
    request: Pick<RequestRow, 'id' | 'clientId' | 'contactId' | 'createdById'>,
    event: RequestEvent,
  ): Promise<void> {
    const [client, contacts] = await Promise.all([
      this.clients.summary(request.clientId, tx),
      this.clients.contactSummaries([request.contactId], tx),
    ]);
    if (!client) return;
    const snapshot = { client: client.name, contact: contacts.get(request.contactId)?.name ?? '' };
    await this.center.notify(tx, {
      ...(event.type === 'approval_responded'
        ? { type: event.type, data: { ...snapshot, decision: event.decision } }
        : { type: event.type, data: snapshot }),
      recipients: [client.accountManagerId, request.createdById],
      actorId: null,
      subjectId: request.id,
    });
  }
}
