import { NotFoundException } from '@nestjs/common';
import {
  allowedPostTransitions,
  hasPermission,
  isPostContentEditable,
  type Permission,
  type PostPermissions,
  type PostRights,
  type PostState,
  type PostStatus,
  permissionScopes,
  type ReviewStage,
  type UserAccess,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientDirectory, ClientSummary } from '../clients/index.js';

/*
 * Who may read and change a post (spec F08, "Roles and access" and "Scopes on posts").
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** Holds `permission` over every record. */
export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

export type PostRow = typeof contentPosts.$inferSelect;

/** A post with the record that decides access: its client. */
export interface PostAccess extends PostRow {
  client: ClientSummary;
}

/** Archived, or its client is archived (rule 2). */
export const isReadOnly = (post: PostAccess) => !!post.archivedAt || post.client.archived;

/**
 * Loads a post the actor may read, else 404. A read-only post is readable by scope-all holders
 * of `content.review` only. `forUpdate` locks the post row.
 */
export async function readablePost(
  executor: Database | Transaction,
  clients: ClientDirectory,
  actor: CurrentUserInfo,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<PostAccess> {
  const query = executor.select().from(contentPosts).where(eq(contentPosts.id, id));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row || !holdsAll(actor, 'content.read')) throw new NotFoundException();
  const client = await clients.summary(row.clientId, executor);
  if (!client) throw new NotFoundException();
  const post: PostAccess = { ...row, client };
  if (isReadOnly(post) && !holdsAll(actor, 'content.review')) throw new NotFoundException();
  return post;
}

/** Refuses any change but restore on a read-only post (rule 2). */
export function assertPostWritable(post: PostAccess): void {
  if (isReadOnly(post)) {
    throw new CodedException(409, 'POST_ARCHIVED', 'The post or its client is archived');
  }
}

/**
 * Whether a user's `permission` covers the client: scope `all`, or `own_clients` as its primary
 * account manager. Also answers for a user other than the caller (the responsible person).
 */
export function coversClient(
  user: { id: string; access: UserAccess },
  permission: Permission,
  client: Pick<ClientSummary, 'accountManagerId'>,
): boolean {
  const scopes = permissionScopes(user.access, permission);
  return (
    scopes.includes('all') ||
    (scopes.includes('own_clients') && client.accountManagerId === user.id)
  );
}

export function postRights(actor: CurrentUserInfo, client: ClientSummary): PostRights {
  return {
    edit: coversClient(actor, 'content.manage', client),
    review: coversClient(actor, 'content.review', client),
    // F09's client scope, unchanged.
    client: coversClient(actor, 'tasks.manage', client),
  };
}

/** The workflow's view of a post. */
export const postState = (post: PostAccess, hasWork: boolean): PostState => ({
  status: post.status,
  reviewStage: post.reviewStage,
  needsClientApproval: post.needsClientApproval,
  hasWork,
});

/** Rule 13: holders of `approvals.review_medical`, never the post's responsible person. */
export const mayMedicalReview = (actor: CurrentUserInfo, post: PostAccess) =>
  hasPermission(actor.access, 'approvals.review_medical') && post.responsibleId !== actor.id;

/**
 * Rule 20: `awaiting_client`, not archived, and for a healthcare client cleared by a medical
 * pass.
 */
export const isReadyToSend = (post: PostAccess, clearedStage: ReviewStage | null) =>
  post.status === 'awaiting_client' &&
  !post.archivedAt &&
  (!post.client.isHealthcare || clearedStage === 'medical');

/** What the UI shows, and the moves it offers; the API checks each action again. */
export function postPermissions(
  actor: CurrentUserInfo,
  post: PostAccess,
  hasWork: boolean,
  clearedStage: ReviewStage | null,
): { permissions: PostPermissions; allowedTransitions: PostStatus[] } {
  const rights = postRights(actor, post.client);
  const readOnly = isReadOnly(post);
  const canEdit = !readOnly && rights.edit && post.status !== 'cancelled';
  return {
    permissions: {
      canEdit,
      canEditContent: canEdit && isPostContentEditable(post.status),
      canReview: !readOnly && rights.review,
      canMedicalReview:
        !readOnly && post.reviewStage === 'medical' && mayMedicalReview(actor, post),
      canSendForApproval: !readOnly && rights.client && isReadyToSend(post, clearedStage),
      canRecordResponse: !readOnly && rights.client && isReadyToSend(post, clearedStage),
      canArchive: holdsAll(actor, 'content.review'),
    },
    allowedTransitions: readOnly ? [] : allowedPostTransitions(postState(post, hasWork), rights),
  };
}
