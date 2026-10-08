import type { AuditEntry } from '@vertex-hub/contracts';

const LINK_FIELDS = new Set([
  'clientId',
  'projectId',
  'retainerId',
  'lineId',
  'fromQuoteId',
  'byQuoteId',
  'ownerType',
  'ownerId',
  'role',
  'shotId',
  'taskId',
  'leadId',
  'campaignId',
  'templateId',
]);

/**
 * Ids of other records the log has no name for (contacts, tasks, posts, cycle lines): an id
 * means nothing to a reader, and the record's own page shows what it points to.
 */
const REFERENCE_FIELDS = new Set([
  'contactId',
  'contactIds',
  'requestedByContactId',
  'itemId',
  'taskIds',
  'postId',
  'shootId',
  'quoteId',
  'amendmentId',
  'milestoneId',
  'retainerCycleId',
  'cycleLineId',
  'extraWorkItemId',
  'revisionId',
  'templateRunId',
  'editingTaskId',
  'fromPostId',
  'interests',
]);

/** The fields an entry shows: the changed ones, without links and references to other records. */
export function shownFields(entry: Pick<AuditEntry, 'before' | 'after'>): string[] {
  // The parent's id on a child record's entry is where its link points, not a change.
  return [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ].filter((field) => !LINK_FIELDS.has(field) && !REFERENCE_FIELDS.has(field));
}
