# F06 — Task engine and workflow

Status: Approved · Date: 2026-09-29 · Scope: `docs/product/v1-scope.md` §F06 (and A03; A06, A07, A08 build on it) · ADRs: 0007, 0013, 0014, 0015, 0016

## Summary
Work at the agency is requested and tracked in WhatsApp: nobody sees who works on what, deadlines are missed silently, and clients ask for unlimited revisions. F06 makes the task the core unit of work for all ten departments: every piece of work has a department, one assignee, a due date and a status on one shared workflow (`new → in progress → internal review → awaiting client → revisions → approved → delivered`). Anyone can request work from any department and its manager assigns it; tasks link to a client and to a project milestone or retainer cycle line, feeding F05's progress and deliverables counter; dependencies hold a task until the work it needs is approved; client revisions are counted against a limit and the account manager decides what happens past it. Views: My tasks, a filterable list, a board by status and a weekly workload view; each task has a checklist, links and comments with @mentions.

## In scope / out of scope
- In:
  - Tasks: create, edit, assign, reassign, move through the unified statuses, cancel with a reason, reopen, archive (entered by mistake) and restore.
  - Requests between departments: a task created without an assignee lands in the target department's unassigned queue; its manager assigns it. Self-assigned tasks in one's own departments.
  - Links: client (optional; internal agency tasks have none), project and optional milestone, or retainer cycle and optional cycle line.
  - Type `client_request`: logged with the client contact who asked, and in-scope / out-of-scope; out-of-scope creates an F05 extra work item.
  - Flag "needs client approval" that includes or skips the `awaiting_client` step.
  - Dependencies between tasks; a task waiting on unfinished work cannot start (a manager may override with a reason).
  - Revisions: every return to `revisions` is recorded with its source (internal or client); client revisions count against a per-task limit (default 2); past the limit, a pending decision for the account manager (free, or logged as extra work).
  - Checklist items (subtasks), external links (attachments), comments with @mentions.
  - Views: My tasks, task list with filters, board by status, workload this week, task page; Tasks tab on the project page, task counts on retainer lines, Open tasks tab on the client profile.
  - F05 hooks: task counts for progress and the deliverables counter; completing a project with open tasks is refused; cancelling a project cancels its open tasks.
  - F01 hook: a user with open assigned tasks cannot be archived.
  - Permission map changes (Q14 answered below).
- Out (later or never):
  - Sending notifications (assignment, @mention, task opened, revision limit exceeded, due soon, overdue): F14 and A07/A08. F06 lists the events and where they happen; it ships no notification code.
  - Approval links, the medical review step, and the 48 h reminder: F09, A04, A05, A13. Until then client responses are recorded by hand.
  - File uploads, versions and previews: F10. F06 attachments are external links only.
  - Generating tasks from templates: F07. Tasks for each new retainer cycle: A02 (Phase 2).
  - The revision limit taken from the quote: F04 (Phase 3) fills the same field.
  - Rich text in briefs and comments (Tiptap): plain text with line breaks in V1.
  - Multiple assignees, nested subtasks with their own assignee, time tracking, Gantt charts, real-time chat (v1-scope).

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- `tasks.read` becomes `all` for Employee: every active user reads every task, like projects (owner decision). The now redundant `tasks.read` grants of Department Manager (`department`) and Account Manager (`own_clients`) are removed.
- New permission **`tasks.request`**, Employee `all`: create a task without an assignee for any department, or assigned to oneself in one of one's own departments (owner decisions).
- `tasks.work` stays: Employee `assigned` (the task's assignee), Department Manager `department`.
- `tasks.manage` stays: Department Manager `department`, Account Manager `own_clients`, General Manager `all`. New: Internal Operations **manager** `all` (department capability; Q14 answered yes). `assigned` is added for Employee and means **the project manager of the task's project**: they edit, link, review and cancel their project's tasks but do not assign people (owner decision); like everyone, they create requests with `tasks.request`.
- `reports.read`: new department capability for the Internal Operations manager, `all` (Q14). F06 uses it for nothing; F15 builds on it.

### Scopes on tasks
- `department`: the task's department is one the user manages.
- `own_clients`: the task's client has the user as primary account manager.
- `assigned` for `tasks.work`: the user is the task's assignee. For `tasks.manage`: the user is project manager of the task's non-archived project.
- **Manage scope** below means `tasks.manage` covering the task under any scope. **Assign scope** means `tasks.manage` covering it under `all`, `department` or `own_clients` (not `assigned`). **Client scope** means `tasks.manage` under `all` or `own_clients`.

### F06 actions
| Action | Permission | Roles and scope |
|---|---|---|
| See tasks, comments, checklists, links, revisions, all views | `tasks.read` | Every active user: all |
| Create an unassigned task (request) for any department | `tasks.request` | Every active user |
| Create a task assigned to oneself in one's own department | `tasks.request` | Every active user (member of that department) |
| Create a task with any assignee | `tasks.manage` (assign scope for the new task) | General Manager, Operations manager: all · Department Manager: their departments · Account Manager: their clients' tasks |
| Log a client request | `tasks.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Edit title, brief, priority, due date, links to client/project/retainer, dependencies, needs-client-approval, revision limit | `tasks.manage` | manage scope |
| Assign or reassign; move to another department | `tasks.manage` (assign scope) | not the project manager alone |
| Edit and withdraw (cancel) one's own request while it is `new` and unassigned | `tasks.request` | its creator |
| Assignee transitions (start, submit for review, resume after revisions, deliver); tick checklist items; add and remove links | `tasks.work` | the assignee · Department Manager of the task's department |
| Review transitions (return to revisions, send to client, approve without client) | `tasks.manage` | manage scope |
| Record the client's response (approved, changes requested) | `tasks.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Deliver an approved task | `tasks.work` or `tasks.manage` (client scope) | the assignee, department manager, account manager |
| Start a blocked task anyway (override with a reason) | `tasks.manage` (assign scope) | not the project manager alone |
| Cancel, reopen delivered or cancelled tasks | `tasks.manage` | manage scope (client-caused reopen: client scope) |
| Decide on a revision over the limit (free or extra work) | `tasks.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Comment, @mention anyone | `tasks.read` | Every active user |
| Edit or remove one's own comment | `tasks.read` | the comment's author (remove: also scope all) |
| Archive and restore a task; see archived ones | `tasks.manage` (scope all) | General Manager, Operations manager |

"Operations manager" means the manager of Internal Operations, as in F01, F02 and F05.

## Data

Module ownership: a new `tasks` module owns every table below. It reads users and department membership through `auth`'s `UserDirectory`, clients and contacts through `clients`' `ClientDirectory`, and projects, milestones, retainer cycles, cycle lines and extra work through a new service that `projects` exports (`EngagementDirectory`: summaries, open/closed state, and creating or archiving an extra work item linked to a task). It registers into `projects`' `WorkProgress` (task counts, and the project cancel and complete hooks below) and into `auth`'s `ResponsibilityRegistry` (open assigned tasks). `projects` never imports `tasks`.

Dates without a time (`date`) are calendar days in Asia/Damascus. The work week is Saturday to Thursday, Friday is the weekend, and a week starts on Saturday (owner decision, was Q9); `WORK_WEEK` in `packages/contracts` holds it.

### `tasks` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `title` | text | required, trimmed, 1–160 chars |
| `brief` | text | optional, ≤ 5000 chars, plain text |
| `type` | enum `task_type` (`work`, `client_request`) | required, default `work` |
| `department` | department code | required, indexed |
| `assignee_id` | uuid → `users.id` | optional (null = unassigned request), indexed; a non-archived member of `department` |
| `status` | enum `task_status` (`new`, `in_progress`, `internal_review`, `awaiting_client`, `revisions`, `approved`, `delivered`, `cancelled`) | required, default `new`, indexed |
| `priority` | enum `task_priority` (`low`, `normal`, `high`, `urgent`) | required, default `normal` |
| `due_date` | date | required, indexed |
| `due_time` | time | optional; overdue starts after it instead of at the end of the day |
| `client_id` | uuid → `clients.id` | optional, indexed |
| `project_id` | uuid → `projects.id` | optional, indexed; requires `client_id`, the project's client |
| `milestone_id` | uuid → `project_milestones.id` | optional, indexed; a non-archived milestone of `project_id` |
| `retainer_cycle_id` | uuid → `retainer_cycles.id` | optional, indexed; requires `client_id`, the retainer's client; never together with `project_id` (check constraint) |
| `cycle_line_id` | uuid → `retainer_cycle_lines.id` | optional, indexed; a line of `retainer_cycle_id` |
| `needs_client_approval` | boolean | required; default true when `client_id` is set, forced false without a client |
| `revision_limit` | integer | required, 0–20, default 2 (F04 later fills it from the quote) |
| `requested_by_contact_id` | uuid → `client_contacts.id` | `client_request` only, optional; a non-archived contact of the client |
| `requested_on` | date | `client_request` only, required, default today, not in the future |
| `request_scope` | enum `request_scope` (`in_scope`, `out_of_scope`) | `client_request` only, required, default `in_scope` |
| `extra_work_item_id` | uuid → `extra_work_items.id` | set while an out-of-scope request has its extra work item |
| `created_by_id` | uuid → `users.id` | required, from the session |
| `started_at`, `delivered_at` | timestamptz | first move to `in_progress`; latest move to `delivered` (cleared on reopen) |
| `cancelled_at`, `cancel_reason` | timestamptz, text | set when cancelled (reason 1–500 chars), cleared on reopen |
| timestamps, `archived_at` | | archived = entered by mistake: hidden from views and counts, read-only, visible to scope-all holders only |

Composite index `(assignee_id, status, due_date)` for My tasks and workload.

### `task_dependencies`
| Field | Type | Rules |
|---|---|---|
| `task_id` | uuid → `tasks.id` | the waiting task |
| `depends_on_id` | uuid → `tasks.id` | the task it waits for; ≠ `task_id` |
| `created_at`, `created_by_id` | | |

Primary key `(task_id, depends_on_id)`, index on `depends_on_id`. At most 10 per task. Removing a dependency deletes the row (a link, not a business record; audited on the task).

### `task_checklist_items` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed |
| `text` | text | required, trimmed, 1–200 chars |
| `position` | integer | display order, dense from 1 |
| `done_at`, `done_by_id` | timestamptz, uuid → `users.id` | set when ticked, cleared when unticked |
| timestamps, `archived_at` | | archived = removed from the checklist |

At most 20 non-archived items per task.

### `task_links` (business table; attachments before F10)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed |
| `url` | text | required, http(s), ≤ 2048 chars |
| `label` | text | optional, ≤ 120 chars |
| `added_by_id` | uuid → `users.id` | required, from the session |
| timestamps, `archived_at` | | archived = removed |

At most 30 non-archived links per task.

### `task_revisions` (business table, append-only)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed |
| `source` | enum `revision_source` (`internal`, `client`) | required |
| `number` | integer | for `client` revisions: 1, 2, 3… per task; null for `internal` |
| `note` | text | required, trimmed, 1–2000 chars: what must change |
| `contact_id` | uuid → `client_contacts.id` | optional, `client` only: who asked |
| `over_limit` | boolean | `client` only: `number` > the task's `revision_limit` when recorded |
| `decision` | enum `revision_decision` (`free`, `extra_work`) | over-limit only; null while pending |
| `decision_note` | text | required with `free`, 1–300 chars |
| `extra_work_item_id` | uuid → `extra_work_items.id` | set with `extra_work` |
| `decided_by_id`, `decided_at` | uuid, timestamptz | set with the decision |
| `author_id`, `created_at` | | from the session |

Revisions are never edited or removed; a decision is set once. The table has `created_at` and `updated_at` but no `archived_at`.

### `task_comments` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed |
| `author_id` | uuid → `users.id` | required, from the session |
| `body` | text | required, trimmed, 1–4000 chars; mentions stored as `@{userId}` tokens and shown with the user's current name |
| `mentioned_user_ids` | uuid[] | derived from the body on save; ≤ 20 distinct non-archived users |
| `edited_at` | timestamptz | set on edit |
| timestamps, `archived_at` | | archived = removed; shown as "comment removed" in place |

### Links F06 fills in F05
- `WorkProgressSource` counts: `total` = non-archived, non-cancelled tasks; `delivered` = those with status `delivered`; `open` = `total − delivered`. Per project, milestone and cycle line.
- `WorkProgressSource` gains two hooks that `projects` calls inside its own transaction: `openTasks(projectId)` (list for the complete check) and `cancelOpenTasks(tx, projectId, reason, actor)`.
- `responsibilitySchema.type` gains `assignee_of_open_tasks` (one item per task: id, title).

## States and rules

### Task status
```
new ──start (assignee; not blocked, or override)──→ in_progress
in_progress ──submit──→ internal_review
internal_review ──return (note; internal revision)──→ revisions
internal_review ──send to client (needs_client_approval)──→ awaiting_client
internal_review ──approve (no client approval needed)──→ approved
awaiting_client ──client approved (client scope)──→ approved
awaiting_client ──client requested changes (note; client revision +1)──→ revisions
approved ──client requested changes (client scope; client revision +1)──→ revisions
revisions ──resume──→ in_progress | ──resubmit──→ internal_review
approved ──deliver──→ delivered
delivered ──reopen: client caused (client scope; client revision +1)──→ revisions
delivered ──reopen: internal (reason)──→ in_progress
new | in_progress | internal_review | awaiting_client | revisions | approved ──cancel (reason)──→ cancelled
cancelled ──reopen (reason)──→ in_progress, or new when unassigned
(any) ──archive (scope all)──→ archived ──restore──→ same status
```
"Open" means any status except `delivered` and `cancelled`. "Finished" (for dependencies) means `approved` or `delivered`.

### Rules
1. Only the transitions above are allowed (`INVALID_TRANSITION`), each by the roles in the actions table (403 otherwise). A move needing a note or reason without one is refused by validation.
2. `new → in_progress` requires an assignee (`ASSIGNEE_REQUIRED`).
3. **Dependencies.** A task is **blocked** while any of its non-archived, non-cancelled dependencies is not finished. A blocked task cannot start (`TASK_BLOCKED`, listing the dependencies) unless an assign-scope holder starts it with `overrideDependencies` and a reason (audited). Blocked is computed, never stored. Adding a dependency to a task already started shows it as waiting but does not move it back.
4. A dependency must be a non-archived task of the same client, or both tasks without a client (`INVALID_DEPENDENCY`); a task cannot depend on itself or create a cycle (`DEPENDENCY_CYCLE`); at most 10 per task (`LIMIT_REACHED`).
5. **Task opens (A03).** When a task becomes finished or cancelled, each task that depended on it and is no longer blocked is "opened": the event in "Audit, notifications and jobs" fires for its assignee (or its department's manager when unassigned).
6. **Assignee.** The assignee must be a non-archived member (primary or secondary) of the task's department (`INVALID_ASSIGNEE`); an `invited` user qualifies. `tasks.request` holders may set only themselves, in a department they belong to. Moving a task to another department keeps the assignee only if they belong to it, else clears it (the task joins the new department's unassigned queue; an `in_progress` task without an assignee keeps its status). Reopening a delivered or cancelled task whose assignee has since been archived is refused (`INVALID_ASSIGNEE`: reassign it first); restoring an archived open task whose assignee has been archived returns it to the department queue.
7. **Links.** A cycle of an archived retainer is refused with `RETAINER_ARCHIVED`. `client_id` must be a non-archived client with status `active` or `paused` when set or changed (`CLIENT_ARCHIVED`, `CLIENT_ENDED`). A project must be non-archived and `planned`, `active` or `on_hold` (`PROJECT_CLOSED`, `PROJECT_ARCHIVED`); a milestone `pending` (`MILESTONE_DONE`); a retainer cycle `open` (`CYCLE_CLOSED`); each must belong to the task's client or project (`INVALID_LINK`). Existing links are kept when the linked record later closes.
8. **Needs client approval** is forced false without a client. Turning it off while `awaiting_client` is refused (`INVALID_TRANSITION`); record the client's response first.
9. **Revisions.** Each move to `revisions` writes a `task_revisions` row. `internal` returns are recorded and shown but never count against the limit. `client` revisions get the next `number`; the task's **client revision count** is the number of client revisions.
10. **Revision limit.** A client revision with `number` > `revision_limit` is recorded `over_limit`; the task shows "over the revision limit — decision pending" until a client-scope holder decides: `free` (note) or `extra_work`. Work is never blocked. `extra_work` creates an F05 extra work item on the task's project or retainer (title "Revision n: <task title>", requested on today, the revision's contact, logged by the decider) and links it; it is refused without a project or retainer (`NO_ENGAGEMENT`). Lowering or raising the limit later does not change earlier revisions' `over_limit`.
11. **Client requests.** Type `client_request` requires a client. `out_of_scope` requires a project or retainer (`NO_ENGAGEMENT`) and creates, in the same transaction, an extra work item (the task's title and brief, `requested_on`, the contact) linked through `extra_work_item_id`. Switching back to `in_scope` archives that item while it is `unbilled`; once billed or waived the switch is refused (`EXTRA_WORK_BILLED`). An `out_of_scope` request keeps an engagement (`NO_ENGAGEMENT` when an edit removes it); moved to another project or retainer, its unbilled extra work moves with it (archived on the old one, created on the new one, `task.extra_work_moved`), and once billed or waived the move is refused (`EXTRA_WORK_BILLED`) (owner decision 2026-09-30). The type of a task cannot change after creation.
12. **Due dates.** A task is **overdue** when open and `due_date` (with `due_time` if set) has passed in Asia/Damascus. A due date before the linked project's start date is allowed; a due date in the past is allowed only when editing, not when creating (`INVALID_DATES`).
13. **Cancel.** Cancelling needs a reason; a cancelled task leaves progress counts (F05 total) and workload. The creator of an unassigned `new` request may withdraw it (cancel) without manage scope.
14. **Reopen.** Reopening a delivered task removes it from the delivered count of its milestone and cycle line; a closed cycle's frozen count does not change (ADR 0015). A client-caused reopen needs client scope and a note and records a client revision (rules 9–10).
15. **Checklist.** Items are ticked by `tasks.work` or manage-scope holders; they never block a transition (shown as "3/5").
16. **Comments.** Every active user may comment on a non-archived task in any status. Only the author edits their comment; the author or a scope-all holder removes it. Mentioned users must be non-archived (`INVALID_MENTION`).
17. **Read-only.** A task of an archived client, archived project or archived retainer is hidden with it and read-only (`TASK_ARCHIVED`), like the task itself when archived. Restore is the only change on an archived task.

### Changes to F05 rules
- F05 rule 6: completing a project is also refused while it has open tasks (`TASKS_OPEN`, listing them; owner decision).
- Cancelling a project cancels its open tasks in the same transaction with the project's reason (owner decision), each with its own audit entry.
- F05 rule 8 and the milestone `MILESTONE_HAS_OPEN_TASKS` warning now see real counts.
- R7, R8: delivered counts come from tasks linked to the cycle line with status `delivered`.

### Changes to F01
- Archiving a user is refused while they are the assignee of an open, non-archived task (`USER_HAS_RESPONSIBILITIES`, type `assignee_of_open_tasks`).

## API

Schemas live in `packages/contracts/src/tasks.ts` (and `WORK_WEEK` in `dates.ts` or the existing date helpers), reusing the shared list and error schemas. A task outside the caller's read access (archived, for callers without scope all) is a 404. The detail names its lists `checklistItems` and `revisionHistory` (the list item's `checklist` and `revisions` are counts), and adds `readOnly` (rule 17). Task responses carry `permissions` flags (`canEdit`, `canAssign`, `canWork`, `canReview`, `canRecordClientResponse`, `canDecideRevision`, `canCancel`, `canReopen`, `canArchive`) and `allowedTransitions` for the UI.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/tasks` | `tasks.read` | `taskListQuerySchema`: `search` (title), `status[]` (default open), `department[]`, `assigneeId` (or `me`), `unassigned`, `clientId`, `internal` (no client), `projectId`, `milestoneId`, `retainerId`, `cycleLineId`, `type`, `priority[]`, `overdue`, `blocked`, `overLimit`, `dueFrom`, `dueTo`, `createdBy` (`me`), `reviewer` (`me`: under the caller's manage scope, for My tasks' "to review"), `archived` (scope all), `sort` (`dueDate` default, `priority`, `createdAt`, `updatedAt`), `order` | `taskPageSchema`: id, title, type, department, assignee (id, name, archived), status, priority, due date and time, `overdue`, `blocked`, client (id, name), project or retainer (id, name), milestone or cycle line label, checklist `{ done, total }`, client revision count and limit, `overLimitPending` | — |
| `GET /api/tasks/:id` | `tasks.read` | — | `taskDetailSchema`: list fields + brief, links to engagement, `needsClientApproval`, client request fields and extra work item, dependencies (each with status and finished) and dependents, checklist, links, revisions with decisions, created by, timestamps, `cancelReason`, `archivedAt`, `permissions`, `allowedTransitions` | 404 |
| `POST /api/tasks` | `tasks.request` or `tasks.manage` (per actions table) | `createTaskSchema`: title, brief, type, department, assigneeId, priority, dueDate, dueTime, clientId, projectId, milestoneId, retainerCycleId, cycleLineId, needsClientApproval, revisionLimit, dependsOn[], checklist[] (text), links[] (url, label); client request: requestedByContactId, requestedOn, requestScope | `taskDetailSchema` | 403, `INVALID_ASSIGNEE`, `INVALID_LINK`, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `PROJECT_CLOSED`, `PROJECT_ARCHIVED`, `MILESTONE_DONE`, `CYCLE_CLOSED`, `UNKNOWN_CONTACT`, `INVALID_DEPENDENCY`, `INVALID_DATES`, `NO_ENGAGEMENT`, `LIMIT_REACHED` |
| `PATCH /api/tasks/:id` | `tasks.manage` (request creator for own `new` unassigned request) | `updateTaskSchema`: the create fields except type, dependencies, checklist and links (their own endpoints), optional; adding a client turns `needsClientApproval` on unless sent; assigneeId and department (assign scope); requestScope (client scope) | `taskDetailSchema` | 403, 404, `TASK_ARCHIVED`, `INVALID_ASSIGNEE`, `INVALID_LINK`, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `PROJECT_CLOSED`, `MILESTONE_DONE`, `CYCLE_CLOSED`, `UNKNOWN_CONTACT`, `NO_ENGAGEMENT`, `EXTRA_WORK_BILLED`, `INVALID_TRANSITION` (rule 8) |
| `POST /api/tasks/:id/status` | per transition (rule 1) | `taskStatusChangeSchema`: `status`, `note` (return, client changes, reopen, cancel reason), `revisionSource` (reopen from delivered: `client` or `internal`), `contactId` (client response), `overrideDependencies` + `reason` | `taskDetailSchema` | 403, 404, `INVALID_TRANSITION`, `ASSIGNEE_REQUIRED`, `TASK_BLOCKED` (with dependencies), `TASK_ARCHIVED`, `UNKNOWN_CONTACT` |
| `PUT /api/tasks/:id/dependencies` | `tasks.manage` | `{ dependsOn: uuid[] }` | dependency list | 403, 404, `INVALID_DEPENDENCY`, `DEPENDENCY_CYCLE`, `LIMIT_REACHED`, `TASK_ARCHIVED` |
| `POST /api/tasks/:id/checklist` | `tasks.manage` or `tasks.work` | `{ text }` | checklist item | 403, 404, `LIMIT_REACHED`, `TASK_ARCHIVED` |
| `PATCH /api/tasks/:id/checklist/:itemId` | `tasks.manage` or `tasks.work` | `{ text?, done? }` | checklist item | 403, 404 |
| `PUT /api/tasks/:id/checklist/order` | `tasks.manage` or `tasks.work` | `{ ids }` | checklist | 403, 404, `INVALID_ORDER` |
| `POST /api/tasks/:id/checklist/:itemId/archive` | `tasks.manage` or `tasks.work` | — | 204 | 403, 404 |
| `POST /api/tasks/:id/links` · `POST …/links/:linkId/archive` | `tasks.manage` or `tasks.work` | `{ url, label }` · — | link · 204 | 403, 404, `LIMIT_REACHED`, `TASK_ARCHIVED` |
| `POST /api/tasks/:id/revisions/:revisionId/decision` | `tasks.manage` (client scope) | `{ decision, note }` | revision | 403, 404, `NOT_OVER_LIMIT`, `ALREADY_DECIDED`, `NO_ENGAGEMENT` |
| `GET /api/tasks/:id/comments` | `tasks.read` | page (oldest first) | `taskCommentPageSchema`: author, body (null once removed), mentions (id, name, archived), `editedAt`, removed, `canEdit`, `canRemove` | 404 |
| `POST /api/tasks/:id/comments` | `tasks.read` | `{ body }` | comment | 404, `INVALID_MENTION`, `TASK_ARCHIVED` |
| `PATCH /api/tasks/:id/comments/:commentId` · `POST …/archive` | `tasks.read` (author; archive: author or `tasks.manage` scope all) | `{ body }` · — | comment · 204 | 403, 404, `NOT_COMMENT_AUTHOR`, `INVALID_MENTION` (only for users newly mentioned by an edit), `TASK_ARCHIVED` |
| `POST /api/tasks/:id/archive` · `/restore` | `tasks.manage` (scope all) | — | `taskDetailSchema` | 403, 404, `TASK_ARCHIVED` / `TASK_NOT_ARCHIVED` |
| `GET /api/tasks/board` | `tasks.read` | `department[]` (default: the departments the user manages; else all for users with `tasks.manage` scope all or own clients, the General Manager, Operations and account managers; else their own; else all; owner decision 2026-09-30), `assigneeId` (or `me`), `clientId` | the departments shown, and columns per status with tasks (list fields, at most 200 by due date) and the column's `total`; `delivered` holds the last 14 days; `cancelled` is not shown | — |
| `GET /api/tasks/workload` | `tasks.read` | `department[]` (default as the board), `week` (any day of the week; default this week) | the week (Saturday–Friday); per non-archived user of those departments, by name: `overdue`, `dueThisWeek`, `open`, counted over all of the person's open tasks in any department; `unassigned` open tasks per department | — |
| `GET /api/me/tasks/summary` | `tasks.read` | — | counts for My tasks: `overdue`, `today`, `thisWeek` (after today, to Friday), `later`, `waiting` (blocked or awaiting the client), `toReview` (internal review under my manage scope), `requestedByMe` (open, created by me, not assigned to me), `unassignedInMyDepartments` (null for non-managers) | — |

Changes to other modules:
- `projects`: exports `EngagementDirectory` (project, milestone, retainer, cycle and line summaries with state; create and archive an extra work item for a task); `POST /api/projects/:id/status` returns `TASKS_OPEN` (rule above) and cancels open tasks via the hook; project and retainer detail responses carry real task counts.
- `auth`: `USER_HAS_RESPONSIBILITIES` includes `assignee_of_open_tasks`.
- New error codes: `ASSIGNEE_REQUIRED`, `INVALID_ASSIGNEE`, `TASK_BLOCKED`, `INVALID_DEPENDENCY`, `DEPENDENCY_CYCLE`, `INVALID_LINK`, `NO_ENGAGEMENT`, `EXTRA_WORK_BILLED`, `NOT_OVER_LIMIT`, `ALREADY_DECIDED`, `INVALID_MENTION`, `NOT_COMMENT_AUTHOR`, `TASK_ARCHIVED`, `TASK_NOT_ARCHIVED`, `TASKS_OPEN`.

## Screens

All screens: Arabic RTL, strings through i18next (`tasks.*`), dates in Asia/Damascus with Latin digits, loading, empty and error states. Navigation gains "Tasks" for every user, with My tasks, List, Board and Workload under it. Status and priority badges use design-system tokens only.

1. **My tasks** `/tasks` (default) — sections: overdue, due today, this week, later, waiting on others (blocked or awaiting client), to review (tasks in `internal_review` I can review; managers and account managers), unassigned in my departments (managers), requested by me. Each row: title, client, status, priority, due date (overdue badge), checklist, blocked badge. "New task" and "Request work from a department". Empty: "nothing assigned to you". Counts come from `GET /api/me/tasks/summary`; each section loads up to 20 tasks and links to the filtered list when it holds more ("waiting on others" has no list link: the list cannot combine blocked with awaiting the client).
2. **Task list** `/tasks/list` — table with the filters of `GET /api/tasks` kept in the URL: client, department, assignee (incl. "unassigned"), status, priority, type, overdue, blocked, over limit, project/retainer, due range; also "to review" (`reviewer=me`) and "requested by me" (`createdBy=me`) toggles. Sortable columns: due date (default, earliest first) and priority (most urgent first on the first click). Scope all: "Archived" filter.
3. **Board** `/tasks/board` — columns by status (`new` … `delivered`); department filter defaulting as the API does (managed departments, else all for overseers, else the user's own); cards show title, client, assignee avatar, due date, priority, blocked and over-limit badges. Dragging a card is allowed only onto an allowed transition for the user; moves that need input (return, client changes, cancel, override) open a dialog. Keyboard: a "Move to…" menu on each card. Cards carry list fields only: a card's moves come from its task detail, loaded when the drag starts or the menu opens; columns the task may move to are marked during the drag. Board filters (departments, assignee, client) stay in the URL; a column past 200 cards links to the list. Shown in navigation to department managers, account managers, General Manager and Operations manager; reachable by everyone.
4. **Workload** `/tasks/workload` — one row per person of the chosen departments: overdue, due this week, open total, as numbers and a bar; week picker (Saturday to Friday); clicking a number opens the filtered list (overdue: `overdue`; due this week: `dueFrom`/`dueTo` of the week; open: the person). The bar is the person's open tasks against the busiest person, in the danger tone when any are overdue. Per department: unassigned count, linking to the unassigned list.
5. **New task** `/tasks/new` (also from a project, milestone, retainer cycle line or client, with those preset) — mode switch: "Request from a department" (department, no assignee) or "Assign" (assignee picker limited to the department's members and to what the user may assign; plain employees see only themselves); title, brief, priority, due date and optional time, client, project + milestone or retainer + this month's line, needs client approval, revision limit, dependencies (task search), checklist, links. Client request (client-scope users): contact, requested on, in scope / out of scope (out of scope explains the extra work item). On success, opens the task.
6. **Task page** `/tasks/$taskId` — header: title, status, priority, department, assignee (reassign), due date, overdue and blocked badges, client and engagement links, type; status actions from `allowedTransitions` with their dialogs. Sections: brief; dependencies ("waiting on" with status, and "blocks"); checklist; links; revisions (source, number, note, contact, over-limit decision with actions for client-scope users); comments with @mention picker (active users): a "Mention" button inserts `@Name` at the cursor, and only people picked from it are saved as `@{userId}` tokens. Cancelled and archived tasks show a banner. Audit trail link for `audit.read` holders.
7. **Project page** (F05) — new **Tasks** tab: the project's tasks grouped by milestone, with "New task" preset (and "Task for this milestone" on each group, while the project runs); tasks without a milestone come last; the progress bar is shown now. Milestone rows and group counts link to their tasks in the list.
8. **Retainer page** (F05) — "This month" line rows link their task counts to the filtered list and offer "New task for this line".
9. **Client profile** (F02) — new **Open tasks** tab: the client's open tasks, over-limit decisions pending first.

What roles see differently: everyone sees every task; actions follow the actions table; the over-limit decision appears for client-scope users; the board is linked in navigation for managers and account managers only.

## Audit, notifications and jobs
- Checklist, link and comment entries carry `taskId` in `after`; link entries keep the label and the site (host) only, never the full URL, which may hold a share token.
- Audit actions (entity `task` unless noted): `task.created`, `task.updated` (before/after of changed fields), `task.assigned` (assignee before/after), `task.department_changed`, `task.status_changed` (with note, source, override reason), `task.dependencies_updated`, `task.archived`, `task.restored`; `task.revision_decided` (decision, note, extra work item); `task.request_scope_changed`; `task_checklist_item.created` / `updated` / `reordered` / `archived`; `task_link.created` / `archived`; `task_comment.created` / `updated` / `archived` (entity `task_comment`, `after` carries `taskId`). Cancelling a project writes one `task.status_changed` per cancelled task with the project's reason. Extra work items created by F06 write F05's `extra_work.created`.
- Notification events (F14 delivers them; F06 ships none): task assigned or reassigned → new assignee; request created without assignee → the department's managers; @mention → mentioned users; task opened (rule 5, A03) → its assignee, or the department's managers when unassigned; sent to internal review → reviewers (department managers of the task's department, and the client's account manager); client changes requested and revision over the limit (A06) → the client's account manager; due tomorrow (A07) and overdue (A08) → assignee, then the department manager after 24 h.
- Jobs: none. Overdue and blocked are computed at read time.

## Edge cases
1. Two people move the same task at once: the status change runs in a transaction that re-reads the status; the second request gets `INVALID_TRANSITION` and the UI refreshes. Other edits: last write wins, each audited.
2. A dependency cycle across several tasks: checked on every dependency change (`DEPENDENCY_CYCLE`).
3. A dependency is cancelled or archived: it no longer blocks; shown struck through. A finished dependency reopened later: a task already started stays started; a `new` one becomes blocked again.
4. The assignee leaves the department or is archived: archiving is refused while they have open tasks (F01 change); removing a membership is allowed and their tasks in that department keep them as assignee with a "not in department" badge until reassigned.
5. A department manager changes: `department` scope moves at once; a task under review can be reviewed by the new manager.
6. The client's account manager changes: client-scope actions (client response, decisions) move at once.
7. A project completes or is cancelled while tasks are open: completing is refused (`TASKS_OPEN`); cancelling cancels them. A reopened project does not reopen its cancelled tasks. While the project is completed or cancelled, its tasks cannot be reopened or restored (`PROJECT_CLOSED`): reopen the project first (owner decision 2026-09-30).
8. A retainer cycle closes with open tasks: they stay open and linked; delivering them later shows as "delivered after close" (F05 R8). New tasks link to the new cycle's lines.
9. A retainer ends or a project is archived with tasks: ended → tasks stay open and workable; archived → tasks hidden and read-only (rule 17).
10. An out-of-scope client request is cancelled: its unbilled extra work item is archived with it and unlinked (reopening the request does not log it again; switch the scope to in and back to log it anew); a billed or waived item stays.
11. A task without a client needs no client approval and cannot be a client request.
12. Revision limit 0: the first client revision is already over the limit.
13. A due date on a Friday: allowed; the workload week still runs Saturday to Friday.
14. A mention of a user archived after the comment was written: the name still shows, with an "archived" style.
15. Permission loss mid-session (reassigned away, manager changed): the next action returns 403 and the page refreshes.
16. ~20 users and a few thousand tasks a year need no special limits; list `pageSize` rules from ADR 0013 apply. The board caps each column at 200 cards with a "see all in list" link.

## Open questions
- None blocks F06. Q14 (Operations manager across departments) and Q9 (work week) are answered in this spec (owner, 2026-09-29).

## Acceptance
- Owner check in the browser:
  1. As a designer (plain employee), open Tasks → "Request from a department": ask Design for a banner for a client, due in 3 days. It appears as unassigned in Design.
  2. As the Design manager, see it under "unassigned in my departments"; assign it to the designer. Create a second task "Publish banner" for Content, depending on the first.
  3. As the designer, start the first task, tick a checklist item, add a Drive link, submit for internal review. The second task shows "waiting on".
  4. As the Design manager, return it with a note (internal revision, not counted); as the designer resume and resubmit; as the manager send it to the client.
  5. As the client's account manager, record "changes requested" twice and then once more (limit 2): the third shows "over the revision limit — decision pending". Decide "extra work": an extra work item appears on the project.
  6. Record the client's approval: the second task is no longer blocked. Deliver the first task: the project's progress and the milestone's task counts update.
  7. On a retainer, create a task for the "designs" line and deliver it: the counter goes up by one.
  8. Log a client request marked out of scope on a project: an extra work item is created.
  9. Try to complete the project with open tasks: refused, listing them. Cancel the project: its open tasks become cancelled with the reason.
  10. Comment with an @mention; open the board as the Design manager and drag a card; open Workload for this week.
  11. As the Operations manager, reassign a task in any department. As an ordinary employee, see every task without edit actions except your own.
  12. Try to archive the designer while they have open tasks: refused, listing the tasks. Open the audit log and find each change above.
- Tests:
  - Unit (contracts): schemas (limits, client request fields, links rules, `needsClientApproval` forced false without a client); the transition table per role (`allowedTransitions`); blocked computation and cycle detection; overdue with and without `due_time` across midnight in Asia/Damascus; the work week (Saturday start); permission map changes (`tasks.read` all, `tasks.request`, Operations manager `tasks.manage` and `reports.read` all, `tasks.manage` assigned for the project manager).
  - API (`apps/api/test/tasks.test.ts`, `task-status.test.ts`, `task-dependencies.test.ts`, `task-revisions.test.ts`, `task-comments.test.ts`, `task-views.test.ts`): each endpoint for success, 401, 403 and out of scope (an employee assigning someone else or working a task not theirs; a department manager on another department's task; an account manager recording a response on another manager's client; a project manager assigning); each error code; rules 1–17; the F05 changes (counts, `TASKS_OPEN`, cascade cancel, delivered counter, frozen closed cycle); the F01 archive check; audit entries in the same transaction.
  - E2E: request → assign → work → internal return → client changes over limit → approve → deliver, with the dependent task unblocking.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): My tasks, task list, board, workload, new task (request and assign modes), task page (with revisions, checklist, links, comments), project Tasks tab, client Open tasks tab.
