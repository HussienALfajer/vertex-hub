/*
 * The `pg_notify` channel between the transactions that store notifications and the API's stream
 * listener (ADR 0018). A payload is `<recipient id>:<notification id>` pairs separated by commas.
 */

export const NOTIFICATIONS_CHANNEL = 'notifications';

/** PostgreSQL refuses payloads of 8000 bytes or more. */
const MAX_PAYLOAD = 7900;

export interface PushedNotification {
  recipientId: string;
  notificationId: string;
}

/** Splits the pairs into payloads under PostgreSQL's limit. */
export function pushPayloads(pairs: readonly PushedNotification[]): string[] {
  const payloads: string[] = [];
  let current = '';
  for (const { recipientId, notificationId } of pairs) {
    const pair = `${recipientId}:${notificationId}`;
    if (current && current.length + pair.length + 1 > MAX_PAYLOAD) {
      payloads.push(current);
      current = '';
    }
    current = current ? `${current},${pair}` : pair;
  }
  if (current) payloads.push(current);
  return payloads;
}

export function parsePayload(payload: string): PushedNotification[] {
  return payload.split(',').flatMap((pair) => {
    const [recipientId, notificationId] = pair.split(':');
    return recipientId && notificationId ? [{ recipientId, notificationId }] : [];
  });
}
