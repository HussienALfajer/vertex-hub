import { Injectable } from '@nestjs/common';
import type {
  ClientDecision,
  NotificationResolution,
  NotificationType,
} from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import { ClientDirectory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import type { RequestRow } from './approval-items.js';

/** What happened to a request, as its notification says it. */
export type RequestEvent =
  | { type: 'approval_responded'; decision: ClientDecision }
  | { type: 'approval_no_response' }
  | { type: 'approval_expired' }
  | { type: 'approval_opened' }
  | { type: 'approval_completed' };

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

  /** F16 rule B5: closes `types` on the request. */
  async resolve(
    tx: Transaction,
    requestId: string,
    types: readonly NotificationType[],
    outcome: NotificationResolution,
    actorId: string | null,
  ): Promise<void> {
    await this.center.resolve(tx, {
      subject: { type: 'approval_request', id: requestId },
      types,
      outcome,
      actorId,
    });
  }

  /**
   * F16 part C: a request that includes a task or a post answers its "ready to send to the
   * client" notice.
   */
  async resolveSent(
    tx: Transaction,
    sent: { taskIds: readonly string[]; postIds: readonly string[] },
    actorId: string,
  ): Promise<void> {
    const resolve = (type: 'task' | 'post', id: string) =>
      this.center.resolve(tx, {
        subject: { type, id },
        types: [type === 'task' ? 'task_awaiting_client' : 'post_awaiting_client'],
        outcome: 'done',
        actorId,
      });
    for (const id of sent.taskIds) await resolve('task', id);
    for (const id of sent.postIds) await resolve('post', id);
  }
}
