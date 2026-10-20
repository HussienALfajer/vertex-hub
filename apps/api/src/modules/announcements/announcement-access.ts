import {
  type AnnouncementStatus,
  type NotificationPriority,
  permissionScopes,
  type UserAccess,
} from '@vertex-hub/contracts';
import type { announcementRecipients, announcements } from '@vertex-hub/db';
import type { CurrentUserInfo } from '../auth/index.js';

/*
 * Who reads and changes an announcement (spec F16, "Roles and access"): its author, its
 * recipients while it is sent, and holders of `announcements.manage` `all`, who read every sent
 * or withdrawn one and withdraw it.
 */

export type AnnouncementRow = typeof announcements.$inferSelect;
export type RecipientRow = typeof announcementRecipients.$inferSelect;

/** Holders of `announcements.manage` with scope `all` (GM, Internal Operations manager). */
export const managesAll = (access: UserAccess) =>
  permissionScopes(access, 'announcements.manage').includes('all');

/** Sent or withdrawn: the announcement has recipients and receipts. */
export const wasSent = (status: AnnouncementStatus) => status === 'sent' || status === 'withdrawn';

/** A draft discarded by archiving (rule D10); a withdrawn one is archived too but still shown. */
export const isDiscarded = (row: AnnouncementRow) =>
  row.archivedAt !== null && row.status !== 'withdrawn';

/** Rules D3, D7: critical and pinning need `announcements.manage` covering every recipient. */
export const needsManage = (row: { priority: NotificationPriority; pinnedUntil: string | null }) =>
  row.priority === 'critical' || row.pinnedUntil !== null;

/** Whether `actor` may read the announcement at all; others get 404. */
export function mayRead(
  actor: CurrentUserInfo,
  row: AnnouncementRow,
  receipt: RecipientRow | null,
): boolean {
  if (isDiscarded(row)) return false;
  if (row.authorId === actor.id) return true;
  if (receipt && row.status === 'sent') return true;
  return managesAll(actor.access) && wasSent(row.status);
}

/** What the caller may do with a readable announcement (the service checks each again). */
export function rightsOf(
  actor: CurrentUserInfo,
  row: AnnouncementRow,
  receipt: RecipientRow | null,
) {
  const author = row.authorId === actor.id;
  const manager = managesAll(actor.access);
  return {
    edit: author && row.status !== 'withdrawn',
    withdraw: row.status === 'sent' && (author || manager),
    receipts: wasSent(row.status) && (author || manager),
    acknowledge:
      !!receipt && row.status === 'sent' && row.requiresAck && receipt.acknowledgedAt === null,
  };
}
