import { type Notification, notificationInbox } from '@vertex-hub/contracts';
import type { Database, notifications, Transaction } from '@vertex-hub/db';
import type { UserDirectory } from '../auth/index.js';

type NotificationRow = typeof notifications.$inferSelect;

/**
 * Notifications as the API and the emails show them, with their actors' and resolvers' current
 * names, and the inbox each shows in for its recipient (F16 rule B6).
 */
export async function notificationResponses(
  rows: NotificationRow[],
  users: UserDirectory,
  executor: Database | Transaction,
): Promise<Notification[]> {
  const people = await users.summaries(
    rows.flatMap((row) => [row.actorId, row.resolvedById].filter((id) => id !== null)),
    executor,
  );
  const person = (id: string | null) => {
    const found = id ? people.get(id) : undefined;
    return found ? { id: found.id, name: found.name } : null;
  };
  return rows.map((row) => {
    return {
      id: row.id,
      type: row.type,
      actor: person(row.actorId),
      subject: { type: row.subjectType, id: row.subjectId },
      data: row.data,
      count: row.count,
      read: row.readAt !== null,
      priority: row.priority,
      box: row.box,
      inbox: notificationInbox({
        recipientId: row.recipientId,
        box: row.box,
        snoozed: row.snoozedUntil !== null,
        resolution: row.resolution,
        resolvedById: row.resolvedById,
      }),
      resolution:
        row.resolution && row.resolvedAt
          ? {
              outcome: row.resolution,
              by: person(row.resolvedById),
              at: row.resolvedAt.toISOString(),
            }
          : null,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } as Notification;
  });
}
