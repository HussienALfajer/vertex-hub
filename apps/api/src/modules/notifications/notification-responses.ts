import type { Notification } from '@vertex-hub/contracts';
import type { Database, notifications, Transaction } from '@vertex-hub/db';
import type { UserDirectory } from '../auth/index.js';

type NotificationRow = typeof notifications.$inferSelect;

/** Notifications as the API and the emails show them, with their actors' current names. */
export async function notificationResponses(
  rows: NotificationRow[],
  users: UserDirectory,
  executor: Database | Transaction,
): Promise<Notification[]> {
  const actors = await users.summaries(
    rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
    executor,
  );
  return rows.map((row) => {
    const actor = row.actorId ? actors.get(row.actorId) : undefined;
    return {
      id: row.id,
      type: row.type,
      actor: actor ? { id: actor.id, name: actor.name } : null,
      subject: { type: row.subjectType, id: row.subjectId },
      data: row.data,
      count: row.count,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } as Notification;
  });
}
