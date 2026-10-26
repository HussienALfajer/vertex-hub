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
  // F17 part B: an opinion's request and an adjustment's ledger row.
  'requestId',
  'ledgerRowId',
  // F01C: the image itself shows on the record; the brand logo version it was cut from.
  'imageId',
  'brandVersionId',
  // F06B: a subtask's parent and stage; a question's people, its replies' question, the subtask
  // it became and an attachment's comment. The brief's text shows a change of its document.
  'parentId',
  'stageId',
  'questionId',
  'addressedUserId',
  'answeredById',
  'subtaskId',
  'taskCommentId',
  'briefDoc',
  // F06B part D: the task a template was saved from.
  'fromTaskId',
]);

/** The fields an entry shows: the changed ones, without links and references to other records. */
export function shownFields(entry: Pick<AuditEntry, 'before' | 'after'>): string[] {
  // The parent's id on a child record's entry is where its link points, not a change.
  return [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ].filter((field) => !LINK_FIELDS.has(field) && !REFERENCE_FIELDS.has(field));
}
