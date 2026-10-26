import {
  CHECKLIST_ITEM_KINDS,
  DEPENDENCY_SOURCES,
  QUESTION_STATUSES,
  REQUEST_SCOPES,
  REVISION_DECISIONS,
  REVISION_SOURCES,
  SUBTASK_RUN_MODES,
  TASK_COMMENT_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { approvalItems } from './approvals.js';
import { users } from './auth.js';
import { clientContacts, clients } from './clients.js';
import { archivedAt, id, timestamps } from './columns.js';
import { contentPosts, postClientResponses } from './content.js';
import { departmentCodeEnum } from './department-codes.js';
import { projectMilestones, projects } from './projects.js';
import { extraWorkItems, retainerCycleLines, retainerCycles } from './retainers.js';
import {
  clientDecisionEnum,
  responseChannelEnum,
  reviewOutcomeEnum,
  reviewStageEnum,
} from './reviews.js';

/*
 * Tasks of every department (F06, ADR 0016), owned by the api `tasks` module. Dates without a
 * time are calendar days in Asia/Damascus, read and written as `YYYY-MM-DD`; `due_time` is a time
 * of day there. Review stages, review snapshots and client responses are F09 (ADR 0020); their
 * enums are in `reviews.ts`. A task may produce the media of a post (F08, ADR 0021). A task may
 * hold subtasks, one level deep, run by the parent's run mode through `run` dependencies (F06B,
 * ADR 0041).
 */

export const taskTypeEnum = pgEnum('task_type', TASK_TYPES);

export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);

export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES);

export const requestScopeEnum = pgEnum('request_scope', REQUEST_SCOPES);

export const revisionSourceEnum = pgEnum('revision_source', REVISION_SOURCES);

export const revisionDecisionEnum = pgEnum('revision_decision', REVISION_DECISIONS);

export const subtaskRunModeEnum = pgEnum('subtask_run_mode', SUBTASK_RUN_MODES);

export const dependencySourceEnum = pgEnum('dependency_source', DEPENDENCY_SOURCES);

export const checklistItemKindEnum = pgEnum('checklist_item_kind', CHECKLIST_ITEM_KINDS);

export const taskCommentKindEnum = pgEnum('task_comment_kind', TASK_COMMENT_KINDS);

export const questionStatusEnum = pgEnum('question_status', QUESTION_STATUSES);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    title: text('title').notNull(),
    /** The plain-text extract of `brief_doc`, written from it (search, emails, notifications). */
    brief: text('brief'),
    /** F06B rule C1: the brief as an ADR 0038 rich-text document; null without a brief. */
    briefDoc: jsonb('brief_doc'),
    type: taskTypeEnum('type').notNull().default('work'),
    department: departmentCodeEnum('department').notNull(),
    /** Null while the task waits in its department's unassigned queue. */
    assigneeId: uuid('assignee_id').references(() => users.id),
    status: taskStatusEnum('status').notNull().default('new'),
    /** The stage of `internal_review` (F09 rule 4); null in every other status. */
    reviewStage: reviewStageEnum('review_stage'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    dueTime: time('due_time'),
    clientId: uuid('client_id').references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id),
    retainerCycleId: uuid('retainer_cycle_id').references(() => retainerCycles.id),
    cycleLineId: uuid('cycle_line_id').references(() => retainerCycleLines.id),
    needsClientApproval: boolean('needs_client_approval').notNull(),
    /** What the client reads and approves with the files (F09 rule 7). */
    clientText: text('client_text'),
    /** The pass that put the task in `awaiting_client` or `approved`; kept afterwards. */
    clearedReviewId: uuid('cleared_review_id').references((): AnyPgColumn => taskReviews.id),
    revisionLimit: integer('revision_limit').notNull().default(2),
    requestedByContactId: uuid('requested_by_contact_id').references(() => clientContacts.id),
    requestedOn: date('requested_on', { mode: 'string' }),
    requestScope: requestScopeEnum('request_scope'),
    /** Set while an out-of-scope client request has its extra work item (rule 11). */
    extraWorkItemId: uuid('extra_work_item_id').references(() => extraWorkItems.id),
    /**
     * The post this task produces media for (F08 rule 7), and when it was linked; set and
     * cleared together. The client approves the post, never the linked task.
     */
    postId: uuid('post_id').references((): AnyPgColumn => contentPosts.id),
    postLinkedAt: timestamp('post_linked_at', { withTimezone: true }),
    /** Null for tasks the system created (an automatic template run, F07). */
    createdById: uuid('created_by_id').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /** F06B: the parent of a subtask; set at creation and never changed. */
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id),
    /** Subtasks only: order among the parent's non-archived subtasks, dense from 1. */
    position: integer('position'),
    /** Subtasks only: required while the parent runs by stages, null otherwise. */
    stageId: uuid('stage_id').references((): AnyPgColumn => taskStages.id),
    /** Top-level tasks only: how the subtasks run; set once the task has a subtask. */
    runMode: subtaskRunModeEnum('run_mode'),
    /** Subtasks only: the note handed over to the next ones (rule A12). */
    handoverNote: text('handover_note'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('tasks_parent_id_idx').on(table.parentId, table.position),
    index('tasks_stage_id_idx').on(table.stageId),
    index('tasks_department_idx').on(table.department),
    index('tasks_assignee_id_idx').on(table.assigneeId, table.status, table.dueDate),
    index('tasks_status_idx').on(table.status),
    index('tasks_due_date_idx').on(table.dueDate),
    index('tasks_delivered_at_idx').on(table.deliveredAt),
    index('tasks_client_id_idx').on(table.clientId),
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_milestone_id_idx').on(table.milestoneId),
    index('tasks_retainer_cycle_id_idx').on(table.retainerCycleId),
    index('tasks_cycle_line_id_idx').on(table.cycleLineId),
    index('tasks_requested_by_contact_id_idx').on(table.requestedByContactId),
    index('tasks_extra_work_item_id_idx').on(table.extraWorkItemId),
    index('tasks_created_by_id_idx').on(table.createdById),
    index('tasks_cleared_review_id_idx').on(table.clearedReviewId),
    index('tasks_post_id_idx').on(table.postId, table.postLinkedAt),
    check(
      'tasks_post_check',
      sql`(${table.postId} is null) = (${table.postLinkedAt} is null)
        and (${table.postId} is null
          or (${table.clientId} is not null and not ${table.needsClientApproval}))`,
    ),
    check(
      'tasks_review_stage_check',
      sql`(${table.status} = 'internal_review') = (${table.reviewStage} is not null)`,
    ),
    check('tasks_client_text_check', sql`char_length(${table.clientText}) between 1 and 10000`),
    check(
      'tasks_engagement_check',
      sql`(${table.projectId} is null or ${table.retainerCycleId} is null)
        and ((${table.projectId} is null and ${table.retainerCycleId} is null) or ${table.clientId} is not null)
        and (${table.milestoneId} is null or ${table.projectId} is not null)
        and (${table.cycleLineId} is null or ${table.retainerCycleId} is not null)`,
    ),
    check(
      'tasks_client_approval_check',
      sql`${table.clientId} is not null or not ${table.needsClientApproval}`,
    ),
    check('tasks_revision_limit_check', sql`${table.revisionLimit} between 0 and 20`),
    check(
      'tasks_client_request_check',
      sql`case when ${table.type} = 'client_request'
        then ${table.clientId} is not null and ${table.requestedOn} is not null and ${table.requestScope} is not null
        else ${table.requestedOn} is null and ${table.requestScope} is null
          and ${table.requestedByContactId} is null and ${table.extraWorkItemId} is null end`,
    ),
    check(
      'tasks_cancel_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null and ${table.cancelReason} is not null)`,
    ),
    // F06B: a subtask never goes to the client nor counts on milestones, lines or posts.
    check(
      'tasks_subtask_check',
      sql`case when ${table.parentId} is not null
        then ${table.parentId} <> ${table.id} and ${table.position} >= 1 and ${table.runMode} is null
          and ${table.milestoneId} is null and ${table.cycleLineId} is null and ${table.postId} is null
          and ${table.type} = 'work' and not ${table.needsClientApproval}
        else ${table.position} is null and ${table.stageId} is null and ${table.handoverNote} is null end`,
    ),
    check('tasks_handover_note_check', sql`char_length(${table.handoverNote}) between 1 and 2000`),
  ],
);

/** The stages of a parent run by stages (F06B rule A3); archived = removed, only when empty. */
export const taskStages = pgTable(
  'task_stages',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id),
    name: text('name').notNull(),
    /** Order within the parent, dense from 1 among non-archived stages. */
    position: integer('position').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('task_stages_task_id_idx').on(table.taskId, table.position),
    check('task_stages_name_check', sql`char_length(${table.name}) between 1 and 80`),
  ],
);

/**
 * A task waiting on another (rule 3); a link, removed by deleting the row. `run` rows are the
 * system's (F06B), and a manual dependency the run also implies stays `manual`.
 */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    dependsOnId: uuid('depends_on_id')
      .notNull()
      .references(() => tasks.id),
    /** Null for tasks the system created (an automatic template run, F07). */
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** `run`: written by the system from the parent's run mode and order (F06B rule A3). */
    source: dependencySourceEnum('source').notNull().default('manual'),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnId] }),
    index('task_dependencies_depends_on_id_idx').on(table.dependsOnId),
    index('task_dependencies_created_by_id_idx').on(table.createdById),
    check('task_dependencies_self_check', sql`${table.taskId} <> ${table.dependsOnId}`),
  ],
);

export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    text: text('text').notNull(),
    /** F06B rule C6: an acceptance criterion, ordered and limited apart from the checklist. */
    kind: checklistItemKindEnum('kind').notNull().default('checklist'),
    /** Order within the task and kind, dense from 1 among non-archived items. */
    position: integer('position').notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: uuid('done_by_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('task_checklist_items_task_id_idx').on(table.taskId, table.position),
    index('task_checklist_items_done_by_id_idx').on(table.doneById),
  ],
);

/** External links on a task: its attachments until F10. */
export const taskLinks = pgTable(
  'task_links',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    url: text('url').notNull(),
    label: text('label'),
    addedById: uuid('added_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('task_links_task_id_idx').on(table.taskId),
    index('task_links_added_by_id_idx').on(table.addedById),
  ],
);

/** Every return to `revisions` (rule 9); append-only, an over-limit decision is set once. */
export const taskRevisions = pgTable(
  'task_revisions',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    source: revisionSourceEnum('source').notNull(),
    /** Client revisions only: 1, 2, 3… per task. */
    number: integer('number'),
    note: text('note').notNull(),
    contactId: uuid('contact_id').references(() => clientContacts.id),
    overLimit: boolean('over_limit').notNull().default(false),
    decision: revisionDecisionEnum('decision'),
    decisionNote: text('decision_note'),
    extraWorkItemId: uuid('extra_work_item_id').references(() => extraWorkItems.id),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Null for changes the client asked for through an approval link (F09). */
    authorId: uuid('author_id').references(() => users.id),
    /** The client response on the task's post that caused this client revision (F08 rule 12). */
    postResponseId: uuid('post_response_id').references((): AnyPgColumn => postClientResponses.id),
    ...timestamps(),
  },
  (table) => [
    index('task_revisions_task_id_idx').on(table.taskId),
    /** A response on a post sends a linked task back once (`ALREADY_RETURNED`). */
    uniqueIndex('task_revisions_post_response_unique').on(table.postResponseId, table.taskId),
    index('task_revisions_contact_id_idx').on(table.contactId),
    index('task_revisions_extra_work_item_id_idx').on(table.extraWorkItemId),
    index('task_revisions_decided_by_id_idx').on(table.decidedById),
    index('task_revisions_author_id_idx').on(table.authorId),
    check(
      'task_revisions_source_check',
      sql`case when ${table.source} = 'client' then ${table.number} >= 1
        else ${table.number} is null and ${table.contactId} is null and not ${table.overLimit}
          and ${table.postResponseId} is null end`,
    ),
    check(
      'task_revisions_decision_check',
      sql`(${table.decision} is null or ${table.overLimit})
        and (${table.decision} is null) = (${table.decidedAt} is null)
        and (${table.decision} <> 'free' or ${table.decisionNote} is not null)
        and ((${table.decision} = 'extra_work') = (${table.extraWorkItemId} is not null))`,
    ),
  ],
);

/**
 * The thread of a task (rule 16): comments, questions and their replies (F06B part B, ADR 0041).
 * `body` is the plain-text extract of `body_doc`, with mentions as `@{userId}` tokens.
 */
export const taskComments = pgTable(
  'task_comments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    /** F06B rule B2: the rich-text document with mention nodes; written on every new row. */
    bodyDoc: jsonb('body_doc'),
    /** Derived from the body on save. */
    mentionedUserIds: uuid('mentioned_user_ids').array().notNull().default(sql`'{}'::uuid[]`),
    kind: taskCommentKindEnum('kind').notNull().default('comment'),
    /** A reply: the question of the same task it answers. */
    questionId: uuid('question_id').references((): AnyPgColumn => taskComments.id),
    /** Questions: the person asked, or the member a department question was forwarded to. */
    addressedUserId: uuid('addressed_user_id').references(() => users.id),
    /** Questions: set for a department question; kept when it is forwarded. */
    addressedDepartment: departmentCodeEnum('addressed_department'),
    questionStatus: questionStatusEnum('question_status'),
    /** Questions: when asked or last reopened; reminders count work hours from it (rule B8). */
    clockStartedAt: timestamp('clock_started_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredById: uuid('answered_by_id').references(() => users.id),
    /** The subtask this question or comment was turned into (rule B11). */
    convertedTaskId: uuid('converted_task_id').references(() => tasks.id),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('task_comments_task_id_idx').on(table.taskId, table.createdAt),
    index('task_comments_author_id_idx').on(table.authorId),
    index('task_comments_question_id_idx').on(table.questionId),
    index('task_comments_addressed_user_id_idx').on(table.addressedUserId),
    index('task_comments_answered_by_id_idx').on(table.answeredById),
    index('task_comments_converted_task_id_idx').on(table.convertedTaskId),
    // Edge case 23: the minute job reads the open questions only.
    index('task_comments_open_questions_idx')
      .on(table.clockStartedAt)
      .where(
        sql`${table.kind} = 'question' and ${table.questionStatus} = 'open' and ${table.archivedAt} is null`,
      ),
    check(
      'task_comments_question_check',
      sql`case when ${table.kind} = 'question'
        then (${table.addressedUserId} is not null or ${table.addressedDepartment} is not null)
          and ${table.questionStatus} is not null and ${table.clockStartedAt} is not null
          and ${table.questionId} is null
        else ${table.addressedUserId} is null and ${table.addressedDepartment} is null
          and ${table.questionStatus} is null and ${table.clockStartedAt} is null
          and ${table.answeredAt} is null and ${table.answeredById} is null end`,
    ),
    check(
      'task_comments_answered_check',
      sql`(${table.answeredAt} is null) = (${table.answeredById} is null)
        and (${table.questionStatus} = 'answered') = (${table.answeredAt} is not null)`,
    ),
  ],
);

/**
 * Every pass and return of a review (F09 rule 2); append-only. A pass holds the snapshot it
 * approved: one version per deliverable and the text for the client.
 */
export const taskReviews = pgTable(
  'task_reviews',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    stage: reviewStageEnum('stage').notNull(),
    outcome: reviewOutcomeEnum('outcome').notNull(),
    note: text('note'),
    /** Null only for the system pass when a client stops being healthcare (F09 rule 18). */
    reviewerId: uuid('reviewer_id').references(() => users.id),
    /** Ids of `file_versions`, owned by the files module; empty for a return. */
    versionIds: uuid('version_ids').array().notNull().default(sql`'{}'::uuid[]`),
    clientText: text('client_text'),
    /** Returns only: the revision it wrote. */
    revisionId: uuid('revision_id').references(() => taskRevisions.id),
    ...timestamps(),
  },
  (table) => [
    index('task_reviews_task_id_idx').on(table.taskId, table.createdAt),
    index('task_reviews_reviewer_id_idx').on(table.reviewerId),
    index('task_reviews_revision_id_idx').on(table.revisionId),
    check(
      'task_reviews_outcome_check',
      sql`case when ${table.outcome} = 'returned'
        then ${table.note} is not null and ${table.revisionId} is not null
          and ${table.versionIds} = '{}' and ${table.clientText} is null
        else ${table.revisionId} is null end`,
    ),
  ],
);

/**
 * The client's answers (F09 rules 13–16), from an approval link or recorded by hand, each
 * against the snapshot it answered; append-only.
 */
export const taskClientResponses = pgTable(
  'task_client_responses',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    decision: clientDecisionEnum('decision').notNull(),
    channel: responseChannelEnum('channel').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => clientContacts.id),
    note: text('note'),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => taskReviews.id),
    /** The pending item it closed: always for `link`, when there was one for `manual`. */
    approvalItemId: uuid('approval_item_id').references((): AnyPgColumn => approvalItems.id),
    /** Requested changes only: the client revision it wrote. */
    revisionId: uuid('revision_id').references(() => taskRevisions.id),
    /** Manual responses only. */
    recordedById: uuid('recorded_by_id').references(() => users.id),
    /** Link responses only, kept as evidence. */
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (table) => [
    index('task_client_responses_task_id_idx').on(table.taskId, table.createdAt),
    index('task_client_responses_contact_id_idx').on(table.contactId),
    index('task_client_responses_review_id_idx').on(table.reviewId),
    index('task_client_responses_approval_item_id_idx').on(table.approvalItemId),
    index('task_client_responses_revision_id_idx').on(table.revisionId),
    index('task_client_responses_recorded_by_id_idx').on(table.recordedById),
    check(
      'task_client_responses_channel_check',
      sql`case when ${table.channel} = 'manual'
        then ${table.recordedById} is not null and ${table.ip} is null and ${table.userAgent} is null
        else ${table.recordedById} is null and ${table.approvalItemId} is not null end`,
    ),
    check(
      'task_client_responses_decision_check',
      sql`case when ${table.decision} = 'changes_requested'
        then ${table.note} is not null and ${table.revisionId} is not null
        else ${table.revisionId} is null end`,
    ),
    check('task_client_responses_user_agent_check', sql`char_length(${table.userAgent}) <= 500`),
  ],
);
