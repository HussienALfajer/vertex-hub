# F06B — Tasks 2.0

Status: Approved · Date: 2026-10-26 · Scope: `docs/product/v2-scope.md` §F06B (and the rules shared by F01C, F06B and F08B) · ADRs: 0013, 0014, 0016, 0017, 0019, 0020, 0037, 0038, 0039, 0041

## Summary
A task in the Hub is one person's piece of work. Real work at the agency is several people's: a campaign needs a copy, a design and a reel, in order, and today that is either one task with a long checklist or several unrelated tasks that nobody connects. Questions about a brief go to WhatsApp and get lost, files are added only after the task exists, and every new task starts from an empty form.

F06B makes a task able to hold **subtasks**: full tasks of their own (department, assignee, due date, status, files, questions) under one parent, run **sequentially**, **in parallel** or in **stages**, with "your turn" when a subtask opens and a handover when a stage ends. Only the parent goes to the client and counts on milestones and retainer lines. It adds **questions** addressed to a person or a department, with reminders after one work day and escalation after two, and moves the task's discussion to rich text with attachments. It adds files at creation (drag, drop and paste) with a built-in viewer, and **smart creation**: a step-by-step wizard with a live preview of the flow, task templates saved from real tasks, a readiness check, acceptance criteria that must be ticked before review, brief fields per department, effort estimates in hours against each person's schedule, a project tree with the bottleneck highlighted, and handovers between stages.

## In scope / out of scope
- In:
  - **Part A, subtasks.**
    - A subtask is a row of `tasks` with a `parent_id`. One level only.
    - Run modes chosen at creation and changeable while the parent is open: `sequential`, `parallel`, `stages`.
    - Order by drag and drop; dependencies written by the system from the mode and the order.
    - Review of subtasks by the parent's assignee and the subtask's department managers; approval delivers a subtask to its parent.
    - The parent's progress; the parent cannot be submitted for review before every subtask is delivered.
    - Reopening chosen subtasks when the client asks for changes on the parent.
    - Handover notes and the handover summary between stages.
    - Cascades from the parent: links, cancel, archive and restore.
    - The Subtasks section with its timeline, and the "subtask of …" badge in lists, on the board and on My tasks.
  - **Part B, questions and discussion.**
    - Questions on a task addressed to a person or a department, with replies, answered and reopened states.
    - Forwarding a department question to a member.
    - Reminders after 24 work hours, escalation after 48 (Fridays and public holidays do not count).
    - Rich text (ADR 0038's editor, with mentions) for comments, questions, replies and the brief; attachments on comments and questions.
    - Turning a question or a comment into a subtask in one action.
    - The "open questions" badge and filter; "Questions waiting for my answer" on My tasks.
    - The discussion section moved near the top of the task page.
  - **Part C, creation.**
    - The creation wizard (basics → subtasks → files → questions → review) with a live flow preview, and a quick save from its first step.
    - Files at creation: drag and drop, pasted screenshots, each marked reference or deliverable, attached when the task is saved.
    - The built-in image and video viewer.
    - The readiness check (assignee on leave, assignee overloaded, due date on a holiday or a Friday, brief missing).
    - Acceptance criteria (the definition of done).
    - Brief fields by department.
    - Effort estimates in hours, and estimated hours against capacity on Workload.
  - **Part D, templates and the tree.**
    - Task templates (a new F07 kind `task`) saved from a task with its subtasks, stages and order, and applied from the wizard.
    - The project tree view with the bottleneck highlighted.
  - The notifications of every part through the F16 engine, and the event audit of the touched modules.
- Out (later or never):
  - Nested subtasks (a subtask with subtasks); moving an existing task under a parent or out of it.
  - Subtasks in F07 project and monthly templates: those templates keep their steps as they are. F08B's tasks at post creation use the subtasks of this spec.
  - Questions on projects, clients and other records: F21 Chat (decided, owner, 2026-10-25).
  - Time tracking: the estimate is an estimate only (v2-scope).
  - Pinpoint comments on images or videos, video thumbnails or transcoding (F10's exclusions stand).
  - Brief fields edited by managers in the app: the fields are fixed per department in the contracts (owner, 2026-10-26).
  - Gantt charts and a dependency graph editor: the tree view shows the flow, it does not edit it.

## Roles and access
No new permission key. Subtasks, questions and files follow the access of their task (v2-scope shared rules). F06's scopes and terms apply: **manage scope** (`tasks.manage` under any scope), **assign scope** (`tasks.manage` under `all`, `department` or `own_clients`), **client scope**.

The **parent's assignee** gains rights over that parent's subtasks only (owner, 2026-10-26). The rights are listed below; they come from the parent, not from a permission.

| Action | Permission | Roles and scope |
|---|---|---|
| See subtasks, stages, questions, attachments, criteria, the tree | `tasks.read` | every active user |
| Create a task with subtasks, files, questions and criteria | `tasks.request` or `tasks.manage` | as F06's create rows; each subtask is checked as its own create (an assignee needs assign scope for the subtask's department, or is the creator in their own department; otherwise it is a request to the department's queue) |
| Add, reorder, cancel subtasks; add, rename, archive stages; change the run mode | `tasks.manage` on the parent, or the parent's assignee | manage scope · the parent's assignee (owner, 2026-10-26) |
| Assign or reassign a subtask | `tasks.manage` (assign scope for the subtask) | as F06 |
| Review a subtask: return it, or approve it (which delivers it) | `tasks.manage` on the subtask, or the parent's assignee | managers of the subtask's department, GMs, Ops · the parent's assignee unless they are the subtask's assignee (owner, 2026-10-26) |
| Reopen chosen subtasks while the parent is in `revisions` | `tasks.work` on the parent, or `tasks.manage` on the parent | the parent's assignee, its department managers · manage scope |
| Write a subtask's handover note | `tasks.work` | the subtask's assignee, its department managers |
| Add, edit, archive acceptance criteria | `tasks.manage` | manage scope (owner, 2026-10-26) |
| Tick acceptance criteria | `tasks.work` or `tasks.manage` | the assignee, department managers, manage scope |
| Set the estimate and the brief fields | as editing the task (F06), or at creation | manage scope, or the creator of a request while it is `new` and unassigned |
| Ask a question | `tasks.read` | every active user |
| Reply to a question | `tasks.read` | every active user |
| Forward a department question to a member | `tasks.read` | managers of the addressed department |
| Mark a question answered | `tasks.read` | the asker at any time; the addressee (for a department question: its managers or the member it was forwarded to) and any reply author once a reply exists |
| Reopen an answered question | `tasks.read` | the asker |
| Turn a question or a comment into a subtask | as "add subtasks" on the task (or on its parent when the task is a subtask) | manage scope · the parent's assignee |
| Attach files to a comment or a question | `tasks.read` | the comment's author |
| Save a task as a template | `tasks.manage` (assign scope) on the task | department managers, account managers (their clients' tasks), GMs, Ops (owner, 2026-10-26); not a project manager alone |
| Apply a task template | `templates.read` | every active user (the created task is checked as any create) |
| Edit or archive a task template | `templates.manage`, or its creator while they keep assign scope in a department of the template | GMs, Ops · the creator |

"Operations manager" (Ops) means the manager of Internal Operations, as in F01, F05 and F06. "GMs" are the holders of the General Manager role.

## Data

Module ownership: `tasks` owns every task table below; `templates` owns the template changes; `files` owns `file_items` and its new role. `tasks` reads schedules, approved leave and public holidays through `hr`'s exported services (F17's `WorkDays` and the leave check used by `ASSIGNEE_ON_LEAVE`); it never reads `hr` tables.

### `tasks` (changed)
| Field | Type | Rules |
|---|---|---|
| `parent_id` | uuid → `tasks.id` | optional, indexed; set at creation and never changed; the parent has no `parent_id` (one level) |
| `position` | integer | subtasks only: order among the parent's non-archived subtasks, dense from 1; null on top-level tasks |
| `stage_id` | uuid → `task_stages.id` | subtasks only, indexed; required while the parent's `run_mode` is `stages`, null otherwise |
| `run_mode` | enum `subtask_run_mode` (`sequential`, `parallel`, `stages`) | top-level tasks only; required once the task has a subtask, null without; default `sequential` in the wizard |
| `brief_doc` | jsonb | optional: the brief as an ADR 0038 rich-text document (paragraphs, headings, bold, italic, lists, links), ≤ 20 000 characters of text; `brief` stays as its plain-text extract (search, emails, notification texts) and is written from it |
| `brief_fields` | jsonb | optional: the department's brief fields (rule C12), validated by the schema of the task's `department`; cleared when the department changes to one with other fields |
| `estimate_minutes` | integer | optional, a multiple of 30, 30–12 000 (0.5–200 hours) |
| `handover_note` | text | subtasks only, optional, ≤ 2000 chars, plain text |

Check constraints:
- a subtask has no `run_mode`, `milestone_id`, `cycle_line_id`, `post_id`, and is of type `work` with `needs_client_approval` false;
- a top-level task has no `position`, `stage_id` or `handover_note`;
- `parent_id <> id`.

Indexes: `(parent_id, position)`.

Existing briefs are copied into `brief_doc` by the migration, one paragraph per line, and the previous release keeps reading `brief` (expand only; no column is dropped).

### `task_stages` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed: the parent |
| `name` | text | required, trimmed, 1–80 chars |
| `position` | integer | dense from 1 |
| timestamps, `archived_at` | | archived = removed; only a stage without non-archived subtasks is archived |

At most 10 non-archived stages per task. Stages stay when the mode leaves `stages`, and come back if it returns.

### `task_dependencies` (changed)
| Field | Type | Rules |
|---|---|---|
| `source` | enum `dependency_source` (`manual`, `run`) | required, default `manual` |

`run` rows are written by the system from the run mode and the order (rule A3), are never edited by hand, and do not count against F06's limit of 10 (which applies to `manual` rows). The primary key stays `(task_id, depends_on_id)`: a manual dependency between two siblings that the run mode also implies is kept as `manual`.

### `task_checklist_items` (changed)
| Field | Type | Rules |
|---|---|---|
| `kind` | enum `checklist_item_kind` (`checklist`, `criterion`) | required, default `checklist` |

Acceptance criteria are rows of kind `criterion`: at most 15 non-archived per task, ordered on their own. The F06 limit of 20 applies to `checklist` rows.

### `task_comments` (changed)
| Field | Type | Rules |
|---|---|---|
| `kind` | enum `task_comment_kind` (`comment`, `question`) | required, default `comment` |
| `body_doc` | jsonb | required for new rows: the rich-text document with mention nodes; `body` stays as its plain-text extract with `@{userId}` tokens, so mentions and the previous release keep working |
| `question_id` | uuid → `task_comments.id` | optional, indexed: set on a reply; points to a `question` of the same task; a reply is never a question |
| `addressed_user_id` | uuid → `users.id` | questions only, indexed: the person asked, or the member a department question was forwarded to |
| `addressed_department` | department code | questions only: set for a department question; kept when it is forwarded |
| `question_status` | enum `question_status` (`open`, `answered`) | questions only, required for them |
| `clock_started_at` | timestamptz | questions only: when it was asked or last reopened; reminders count from it |
| `answered_at`, `answered_by_id` | timestamptz, uuid → `users.id` | set when marked answered, cleared on reopen |
| `converted_task_id` | uuid → `tasks.id` | optional, indexed: the subtask this question or comment was turned into |

Check: a question has `addressed_user_id` or `addressed_department` (or both after a forward) and a status; a comment has neither; a reply has no question fields. Existing comments are copied into `body_doc` by the migration.

### `file_items` (changed, owned by `files`)
- `file_role` gains `attachment` for owner type `task` (the `announcement` value is reused; the role check gains `task` with `attachment`).
- New column `task_comment_id` uuid → `task_comments.id`, indexed: required for a task `attachment`, null otherwise. Attachments are single uploads without versions, like references; at most 10 per comment.

### `work_templates` and steps (changed, owned by `templates`)
- `template_kind` gains `task`.
- `work_templates.run_mode` (`subtask_run_mode`): required for kind `task`, null otherwise.
- `work_templates.created_by_id` already exists; for kind `task` it decides who edits (Roles).
- `work_template_steps.parent_step_id` uuid → `work_template_steps.id`, indexed. A `task` template has exactly one root step (no parent): the task itself. Its other steps are its subtasks and point to it.
- `work_template_steps` gains `brief_doc` (jsonb), `brief_fields` (jsonb), `estimate_minutes`, `criteria` (text[], ≤ 15).
- `work_template_stages` serve the `task` kind's stages as well; `stage_id` is set on sub-steps when the template's mode is `stages`.
- Due days of a `task` template: `due_day` is the work day from the start, as F07. The root's `due_day` is at least that of every sub-step.
- `work_template_assignees` are the defaults per department, as F07, saved only when "keep assignees" is ticked.

At most 30 sub-steps per `task` template.

### Contracts
- `packages/contracts/src/tasks.ts`:
  - `SUBTASK_RUN_MODES`, `TASK_COMMENT_KINDS`, `QUESTION_STATUSES`;
  - the limits: 30 subtasks, 10 stages, 15 criteria, 10 attachments per comment, 20 files at creation, 10 questions at creation;
  - `briefFieldsSchemas` per department (rule C12);
  - the readiness warning schema;
  - the pure functions `runDependencies(mode, subtasks)`, `suggestSubtaskDates(...)`, `subtaskProgress`, `bottleneck(tree)` and `workHoursBetween(from, to, holidays)` (rule B9), with unit tests.
- The rich-text document schema of ADR 0038 gains a mention node (`{ type: 'mention', attrs: { userId } }`), shared by comments and later chat.

## States and rules
F06's status machine and rules stay. What changes is listed here.

### Part A — Subtasks
1. **What a subtask is.** A subtask has its own department, assignee (or its department's queue), due date and time, priority, status, brief, brief fields, estimate, checklist, criteria, files, questions and comments.
   - It takes the parent's client, project and retainer cycle. Those are never set on it directly and follow the parent when the parent's links change (same transaction).
   - It never has a milestone, a cycle line, a post or client approval (decided: only the parent goes to the client and counts, owner, 2026-10-25). F09's medical stage therefore never applies to it.
   - It is always of type `work`. It cannot have subtasks (`SUBTASK_DEPTH`).
   - A parent holds at most 30 non-cancelled subtasks (`LIMIT_REACHED`).
2. **Creating.** Subtasks are created with the parent (the wizard), added later to an open parent, or turned from a question or a comment (rule B11). Each one is checked as its own create:
   - the department's members for the assignee;
   - assign scope, or the creator themself in their own department; otherwise it is a request that lands unassigned in the department's queue (owner, 2026-10-26). Naming an assignee the caller may not assign answers 403, as F06's create does; only applying a template turns such a default assignee into a queue request (edge case 20) (owner, 2026-10-26, at PR 1);
   - F17's leave warning.
   - A subtask cannot be added to a delivered, cancelled or archived parent (`TASK_CLOSED`).
3. **Run modes** (owner, 2026-10-25). The system keeps the parent's subtasks' `run` dependencies equal to what the mode and the order imply:
   - **sequential:** each subtask waits for the one before it in `position` order;
   - **parallel:** no `run` dependencies; all open together;
   - **stages:** stages run in order; every subtask of a stage waits for every subtask of the previous non-empty stage, and subtasks inside a stage run in parallel.

   Waiting uses F06 rule 3: a subtask is blocked while one of the subtasks it waits for is not finished. Cancelled and archived subtasks do not block, so a sequence skips them. A manager may still start a blocked subtask with an override and a reason (F06).
4. **Changing the mode or the order** is allowed while the parent is open (owner, 2026-10-26). The `run` dependencies are rewritten in the same transaction:
   - subtasks already started stay started (F06 edge case 3);
   - a `new` subtask that becomes blocked waits again;
   - one that becomes unblocked opens (rule A6).

   Switching to `stages` puts every subtask in the first stage (one is created, "Stage 1", if there is none). Switching away keeps the stages for later. Reordering takes the whole order, with each subtask's stage (`INVALID_ORDER` when it does not list exactly the non-archived subtasks).
5. **Due dates.** A subtask's due date (and time) is not after its parent's (`INVALID_DATES`).
   - The wizard and "Add subtask" suggest dates in sequence: the work days from today to the parent's due date (Fridays and holidays skipped) are shared in proportion to each subtask's estimate (2 hours without one).
   - Sequential: one after another. Stages: one date per stage. Parallel: the parent's due date minus one work day.
   - Moving the parent's due date before a subtask's is refused with the subtasks listed (`SUBTASK_DUE_AFTER_PARENT`), unless the request carries `moveSubtasks: true`, which sets those subtasks to the parent's new date in the same transaction.
6. **Opening.** When a subtask stops being blocked because subtasks it waited on through `run` dependencies finished, it "opens":
   - sequential: `subtask_turn` to its assignee (or its department's managers when unassigned), with the handover of the subtask before it;
   - stages: `subtask_handover` with the stage's handover summary (rule A12).

   Openings through `manual` dependencies keep F06's `task_opened`.
7. **Review and the end of a subtask.** A subtask goes `new → in_progress → internal_review` as any task.
   - Its reviewers are the managers of its department (F06) and the parent's assignee, unless the parent's assignee is the subtask's own assignee (owner, 2026-10-26).
   - Return writes an internal revision as in F06.
   - **Approve moves it straight to `delivered`** (owner, 2026-10-26): a new transition `internal_review → delivered`, for subtasks only. F10 marks its finals, and its final deliverables show in the parent's Files section under "From subtasks".
   - A delivered subtask leaves its assignee's open work and Workload.
   - The `approved` status and the client transitions are never available on a subtask (`INVALID_TRANSITION`).
8. **The parent waits for its subtasks.** While any non-cancelled, non-archived subtask is not delivered, the parent cannot move to `internal_review` (submit or resubmit) (`SUBTASKS_OPEN`, listing them; owner, 2026-10-26). So it cannot reach the client or be delivered either. The parent itself is otherwise worked as any task: it can be started, its assignee assembles the work, and its checklist and files are its own.
9. **Progress.** The parent shows `subtasks: { delivered, total }`, where `total` counts non-cancelled, non-archived subtasks, and a progress bar.
   - Subtasks never count in F05's `WorkProgress` (project progress, milestones, cycle lines, the deliverables counter) (decided, owner, 2026-10-25). They do count on Workload, My tasks, the board and the lists.
   - When the last subtask is delivered, the parent's assignee gets `subtasks_all_finished` (else its department's managers).
10. **Client changes on the parent** (owner, 2026-10-26). When the parent goes to `revisions`, its Subtasks section offers "Reopen subtasks":
    - the parent's assignee, its department managers or a manage-scope holder picks delivered subtasks and writes a note for each;
    - each picked subtask moves `delivered → in_progress` (F06's internal reopen) with an internal revision carrying the note, and its assignee is told (`task_reopened`);
    - the others stay delivered;
    - new subtasks may also be added. Rule A8 then holds the parent until they are delivered again.

    Reopening or adding a subtask re-arms `subtasks_all_finished`.
11. **Cascades from the parent.**
    - **Cancel:** cancelling the parent cancels its open subtasks with the parent's reason, each audited. Reopening the parent does not reopen them.
    - **Archive and restore:** archiving the parent archives its subtasks with it, and restore restores those it archived. A subtask archived on its own stays archived.
    - **Department and assignee:** the parent's department and assignee changes do not touch its subtasks.
    - **Client and engagement:** a parent whose client or engagement changes moves its subtasks' links with it (rule A1), and their files' client (F10 rule 4).
    - **Project:** a project completed while subtasks are open is refused like any open task (`TASKS_OPEN` lists them). A project cancelled cancels them.
12. **Handover** (owner, 2026-10-26).
    - A subtask's assignee may write a handover note before submitting it for review; it is optional.
    - When a stage ends (every non-cancelled subtask of it delivered), the system builds the **handover summary** and stores it on the stage's audit entry (`task_stage.finished`). The summary lists the stage's delivered subtasks, who did each, their handover notes and their final deliverables.
    - The next stage's subtasks open with `subtask_handover` carrying the summary, and the parent's assignee gets `subtask_stage_finished`.
    - In sequential mode, `subtask_turn` carries the previous subtask's note and final deliverables.
    - The Subtasks section shows each finished stage's summary between the stages.
13. **Lists, board and My tasks.**
    - Subtasks appear as tasks with a "subtask of …" badge linking to the parent.
    - The list gains a "Hide subtasks" toggle (`topLevel=true`) and a parent filter. Neither is on by default, so a person sees their subtasks.
    - Parents show their progress `3/5`.
14. **Overdue subtask holding the next.** The daily job sends `subtask_holding_next` when an overdue open subtask is waited on through `run` dependencies by an open subtask. It goes to the parent's assignee and, informational, to the waiting subtask's assignee.

### Part B — Questions and discussion
1. **Asking.** Every active user may ask a question on a non-archived task in any status (`TASK_ARCHIVED` otherwise). A question is addressed to exactly one person (an active user other than the asker) or one department (`INVALID_ADDRESSEE`). A department question reaches the department's current managers (decided, owner, 2026-10-25). Questions may be asked in the creation wizard; they are created with the task.
2. **Body and attachments.** Comments, questions and replies are rich-text documents (ADR 0038's editor with mentions), 1–4000 characters of text, with up to 10 attachments uploaded through F10 (drag and drop, paste, or the file button). Attachments follow the task's file access and are listed in the comment and in the task's Files section under "In the discussion". The brief uses the same editor (owner, 2026-10-26).
3. **Replies.** Anyone who may comment may reply to a question. A reply is linked to its question and shown under it. Replies to a reply are not threaded: they are replies to the same question.
4. **Answered.** A question is `open` until it is marked answered:
   - by the asker at any time;
   - by the addressee once a reply exists. For a department question the addressee is its managers, or the member it was forwarded to.
   - by the author of any reply (decided, owner, 2026-10-25).

   Marking it answered without any reply is the asker's alone (`QUESTION_NO_REPLY`). Only the asker reopens it (`NOT_QUESTION_ASKER`); reopening restarts its clock.
5. **Forwarding.** A manager of the addressed department may forward a department question to one of its non-archived members (`INVALID_ADDRESSEE`) (owner, 2026-10-26).
   - The member becomes the addressee; the department stays shown.
   - The managers' notification is voided and the member gets `task_question_asked`.
   - The clock is not restarted: reminders and escalation count from the asking.
   - A forwarded question can be forwarded again by the department's managers.
6. **Never blocking.** An open question does not block any transition and does not move any date (decided, owner, 2026-10-25).
7. **Badges and filters.** Tasks carry `openQuestions` (count). The task header, list rows and board cards show an "open question" badge, and the list filters on it (`hasOpenQuestions`). "Questions waiting for my answer" lists open questions addressed to me, or to a department I manage that has not been forwarded to someone else. It is a section on My tasks and a count in `GET /api/me/tasks/summary`.
8. **Reminder and escalation** (decided, owner, 2026-10-25; counting, owner, 2026-10-26).
   - After 24 work hours open, `task_question_reminder` goes to the current addressee (the managers, for a department question not forwarded).
   - After 48 work hours, `task_question_escalated` goes to the managers of the addressee's primary department. An addressee who manages that department, or a department question still with its managers, escalates to the GMs and Ops.
   - Each is sent once per clock. Both are run by F16's minute job (`notifications.timed`) through `timed_reminders` (kinds `question_reminder`, `question_escalation`).
9. **Work hours.** Only work days count: every day except Friday and the public holidays of F17 (all 24 hours of the day). So a question asked on Thursday at 11:00 is reminded on Saturday at 11:00 and escalated on Sunday at 11:00. A holiday added later moves reminders not yet sent. The function is `workHoursBetween` in contracts.
10. **Closing with the task.** When the task is delivered, cancelled or archived, its open questions stay open and visible, and their notifications resolve as void: reminders stop. Reopening the task restarts the clock of its open questions.
11. **Turning into a subtask.** From a question or a comment, "Turn into subtask" opens the add-subtask form prefilled:
    - **title:** the first line of the text, up to 160 characters;
    - **brief:** the body;
    - **department:** the question's department, or the addressee's primary department, else the asker's;
    - **files:** the attachments, copied as references.

    It needs the right to add subtasks (Roles). On a subtask, it adds a sibling under the same parent (one level only).

    The source records `converted_task_id` and shows "Turned into subtask …". A question turned into a subtask is marked answered by the actor, with that link as its answer. The asker and the addressee get `task_question_converted`.
12. **Page layout.** The task page shows, in order: the header, the brief (with its fields), Subtasks, Questions and discussion, then files, criteria, checklist, dependencies, links and revisions (v2-scope).
13. **Mentions** stay as in F06 rule 16: a mention node per user, at most 20, non-archived users; the plain-text extract keeps the `@{userId}` tokens. Editing a comment or a question keeps F06's author rule. A question's addressee cannot be changed by an edit, only by forwarding.

### Part C — Creation
1. **The wizard** (`/tasks/new`, owner, 2026-10-26) has five steps: basics → subtasks → files → questions → review.
   - The basics step holds F06's create form, plus the brief editor, the brief fields of the chosen department, the estimate and "Start from a template".
   - "Create now" on the basics step saves a simple task at once. The readiness check still runs first, as a confirmation dialog when it warns.
   - The other steps are optional. The subtasks step chooses the run mode, the stages and the subtasks, with suggested dates (rule A5).
   - A **live preview** beside the steps (below them on a phone) draws the flow: the parent, its subtasks as lanes by mode (one line for sequential, side by side for parallel, columns for stages), assignees' avatars, dates, and warnings in place.
   - The wizard keeps its draft in the browser while open (local storage), so a reload does not lose it. It is saved to the server only at the end.
2. **One transaction.** Saving creates, in one transaction:
   - the task, its stages and subtasks with their dependencies;
   - criteria and checklist;
   - the held files and the questions with their attachments.

   Every part is validated first, and one failure saves nothing (the error names the part). Notifications are sent after commit, as in F06.
3. **Files at creation.**
   - Files are dragged onto the wizard, pasted (a screenshot from the clipboard becomes `Screenshot <date time>.png`) or chosen.
   - Each is uploaded at once through `POST /api/files/uploads` (F10 rule 1) and held. The wizard shows its progress and lets it be removed.
   - Each is marked **reference** (the default: a moodboard) or **deliverable** (its first version). It may go on the parent or on one of the new subtasks.
   - At most 20 files at creation. F10's limits and blocked types apply, and an upload left unsaved for 24 hours is purged (F10). The wizard warns when its uploads are older than 20 hours.
   - The task page accepts the same drag and drop and paste in its Files section and in the discussion editor.
4. **The viewer.** Images and videos of a task, its subtasks' finals and its discussion open in a built-in viewer:
   - full screen, next and previous across the set, zoom and pan for images;
   - the browser's player for videos, with no transcoding (F10);
   - name, version, role and uploader, with download.

   PDFs keep the browser's viewer, and other files download.
5. **Readiness check.** Before saving, and before assigning or re-dating an existing task, `POST /api/tasks/readiness` returns warnings for the task and each subtask. **Warnings never block** (v2-scope):
   - **assignee on leave:** F17's approved leave on the due date. On save the UI sends `acceptLeave: true` once the person confirms, as F17 rule 17 asks.
   - **assignee overloaded** (owner, 2026-10-26): in the week of the due date (Saturday to Friday), the assignee's estimated hours of open tasks due that week, plus this one, exceed the work hours left in their F17 schedule from today (or the week's start) to the week's end, after approved leave and holidays. Tasks without an estimate count 2 hours. The warning names the hours.
   - **due on a holiday or a Friday**, with the next work day suggested.
   - **brief missing:** no brief text, no brief field filled and no reference file.
   - **no acceptance criteria** on a task that needs client approval (a suggestion, shown last).
6. **Acceptance criteria** (definition of done, owner, 2026-10-26).
   - Up to 15 criteria per task, written by manage-scope holders (or the creator at creation), shown as a list of their own.
   - The assignee or a reviewer ticks them.
   - While any non-archived criterion is unticked, moving to `internal_review` is refused (`CRITERIA_OPEN`, listing them). This covers submit and resubmit.
   - Criteria added after a submission do not move the task back. A return keeps the ticks; the reviewer may untick.
   - The F06 checklist stays non-blocking.
7. **Brief fields by department** (owner, 2026-10-26). They are all optional, fixed in `briefFieldsSchemas`, and shown on the basics step and in the brief section:
   - **Design:** sizes (up to 10, e.g. "1080 × 1350"), colours (up to 10 hex values with swatches), reference links (up to 10).
   - **Photography (photo and video):** length (text, e.g. "30 s"), aspect ratio (`16:9`, `9:16`, `1:1`, `4:5`, `other`), music (≤ 200 chars).
   - **Development:** link (URL), environment (`production`, `staging`, `development`).
   - **Content Management:** platforms (F08's platform list), tone (≤ 200 chars), length (≤ 100 chars).
   - **Marketing:** goal (≤ 300 chars), audience (≤ 300 chars), budget (integer minor units with a currency, ADR 0006).

   Other departments have none. A department change keeps the fields only when the new department is the same kind.
8. **Estimates** are in hours with halves (owner, 2026-10-26). Workload gains, per person and week, **estimated hours** (open tasks due that week; 2 hours for tasks without an estimate, marked as such) against **capacity** (the work hours of their F17 schedule that week, after approved leave and holidays). The bar turns to the warning tone above capacity. Estimates are never compared with actual time.

### Part D — Templates and the tree
1. **Saving a template** (owner, 2026-10-26). "Save as template" on a top-level task, for assign-scope holders, creates a `task` template from:
   - the task's title, brief, brief fields, department, priority, needs client approval, revision limit, estimate, checklist and criteria;
   - its run mode, stages and non-cancelled subtasks in order, with the same fields;
   - each subtask's `due_day` as the work days from the task's creation date to its due date (at least 1), the root's from the parent's due date;
   - the assignees per department as defaults, only when "keep assignees" is ticked.

   Files, questions, comments and client links are not saved. The name is required and unique among non-archived templates (F07).
2. **Applying.** "Start from a template" in the wizard lists the non-archived `task` templates and fills every step. The dates come from a start date (today by default) in work days, skipping Fridays and holidays (F17 rule 1). The default assignees apply where the user may assign; otherwise the subtask goes to its department's queue. Everything stays editable before saving. A run is recorded in F07's `template_runs` (trigger `manual`) with the created tasks.
3. **Editing.** The template page (F07's editor, extended for the `task` kind) edits the root and its sub-steps, their stages and order. Editing a template never changes tasks already created.
4. **The tree view.** The project page's Tasks tab gains a "Tree" mode:
   - milestones, each with its tasks, each parent with its subtasks indented and its run mode shown;
   - "waits for" arrows from F06 dependencies (run and manual), the status and assignee of each, and overdue marks.
   - The **bottleneck** is highlighted: the open, unblocked task on which the most open tasks wait, directly or through others. Ties go to the earliest due date, then the overdue one. Without dependencies there is none.
   - A retainer page's "This month" shows the same tree for the cycle's tasks.

### Notifications, audit and permissions
- Every event above goes through the F16 engine (decided). The table under "Audit, notifications and jobs" lists each type.
- Every state change writes an audit entry in the same transaction (AGENTS.md).

## API
Schemas live in `packages/contracts/src/tasks.ts` (and `templates.ts` for templates). Task responses keep F06's `permissions` and `allowedTransitions`, which gain:
- `canManageSubtasks`, `canReopenSubtasks`, `canEditCriteria`, `canSaveTemplate`;
- for comments: `canAnswer`, `canReopen`, `canForward`, `canConvert`.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/tasks` (changed) | as F06, per part | `createTaskSchema` + `briefDoc`, `briefFields`, `estimateMinutes`, `criteria[]`, `runMode`, `stages[]` (name), `subtasks[]` (title, briefDoc, briefFields, department, assigneeId, dueDate, dueTime, priority, estimateMinutes, stageIndex, checklist[], criteria[], files[]), `files[]` (uploadId, role `reference` or `deliverable`, name?), `questions[]` (bodyDoc, addressedUserId or addressedDepartment, files[]), `templateId?`, `acceptLeave` | `taskDetailSchema` | F06's codes + `ASSIGNEE_ON_LEAVE`, `SUBTASK_DEPTH`, `INVALID_ADDRESSEE`, `UPLOAD_NOT_FOUND`, `FILE_TYPE_BLOCKED`, `LIMIT_REACHED`, `INVALID_DATES` (a subtask after the parent) |
| `GET /api/tasks/:id` (changed) | `tasks.read` | — | + `parent` (id, title, status), `runMode`, `stages[]` (with handover summary when finished), `subtasks[]` (list fields + stage, position, waitingOn, handoverNote), `progress`, `criteria[]`, `briefDoc`, `briefFields`, `estimateMinutes`, `openQuestions` | 404 |
| `GET /api/tasks` (changed) | `tasks.read` | + `parentId`, `topLevel`, `hasOpenQuestions` | items + `parent` (id, title), `progress` (parents), `openQuestions`, `estimateMinutes` | — |
| `PATCH /api/tasks/:id` (changed) | as F06 | + `briefDoc`, `briefFields`, `estimateMinutes`, `moveSubtasks`; links refused on a subtask | `taskDetailSchema` | F06's + `SUBTASK_DUE_AFTER_PARENT`, `INVALID_LINK` (links on a subtask) |
| `POST /api/tasks/:id/status` (changed) | as F06; subtask review also by the parent's assignee | as F06; `delivered` from `internal_review` for subtasks | `taskDetailSchema` | F06's + `SUBTASKS_OPEN`, `CRITERIA_OPEN` |
| `POST /api/tasks/:id/subtasks` | parent: manage scope or its assignee | one subtask as in create, `position?`, `stageId?`, `fromCommentId?` | subtask detail | 403, 404, `TASK_CLOSED`, `SUBTASK_DEPTH`, `LIMIT_REACHED`, `INVALID_DATES`, `INVALID_ASSIGNEE`, `ASSIGNEE_ON_LEAVE`, `TASK_ARCHIVED` |
| `PUT /api/tasks/:id/subtasks/order` | as above | `{ items: [{ id, stageId }] }` | subtasks and stages | 403, 404, `INVALID_ORDER`, `TASK_CLOSED` |
| `PUT /api/tasks/:id/run-mode` | as above | `{ runMode }` | subtasks and stages | 403, 404, `TASK_CLOSED` |
| `POST /api/tasks/:id/stages` · `PATCH …/stages/:stageId` · `POST …/stages/:stageId/archive` | as above | `{ name, position? }` · `{ name?, position? }` · — | stage · stage · 204 | 403, 404, `LIMIT_REACHED`, `STAGE_NOT_EMPTY`, `TASK_CLOSED` |
| `POST /api/tasks/:id/subtasks/reopen` | parent: `tasks.work` or manage scope | `{ items: [{ id, note }] }` (1–30) | `taskDetailSchema` (parent) | 403, 404, `INVALID_TRANSITION` (parent not in `revisions`, or a subtask not delivered) |
| `PUT /api/tasks/:id/handover-note` | `tasks.work` (subtask) | `{ note }` | subtask detail | 403, 404, `INVALID_LINK` (not a subtask), `TASK_ARCHIVED` |
| `POST /api/tasks/:id/criteria` · `PATCH …/criteria/:itemId` · `PUT …/criteria/order` · `POST …/criteria/:itemId/archive` | add, edit, order, archive: manage scope; tick (`done`): `tasks.work` or manage scope | as the checklist endpoints | criterion · list | 403, 404, `LIMIT_REACHED`, `INVALID_ORDER`, `TASK_ARCHIVED` |
| `POST /api/tasks/readiness` | `tasks.request` | a draft: department, assigneeId, dueDate, dueTime, estimateMinutes, has brief, has brief fields, has references, needsClientApproval, `taskId?` (to leave itself out), `subtasks[]` (the same per subtask) | `{ warnings: [{ target (task or subtask index), code, data }] }` | — |
| `GET /api/tasks/:id/comments` (changed) | `tasks.read` | + `kind` (`question`), `status` | items + `kind`, `bodyDoc`, `attachments[]`, `question` (addressee, department, status, answeredBy, answeredAt, forwardedFrom), `replies[]` (for questions), `convertedTask` | 404 |
| `POST /api/tasks/:id/comments` (changed) | `tasks.read` | `{ bodyDoc, questionId?, files[] }` | comment | 404, `INVALID_MENTION`, `TASK_ARCHIVED`, `QUESTION_NOT_FOUND`, `UPLOAD_NOT_FOUND`, `LIMIT_REACHED` |
| `POST /api/tasks/:id/questions` | `tasks.read` | `{ bodyDoc, addressedUserId \| addressedDepartment, files[] }` | comment (question) | 404, `INVALID_ADDRESSEE`, `INVALID_MENTION`, `TASK_ARCHIVED`, `UPLOAD_NOT_FOUND`, `LIMIT_REACHED` |
| `POST /api/tasks/:id/questions/:questionId/answered` · `/reopen` | rule B4 | — | question | 403, 404, `QUESTION_NO_REPLY`, `NOT_QUESTION_ASKER`, `INVALID_TRANSITION` (already in that state) |
| `POST /api/tasks/:id/questions/:questionId/forward` | managers of the addressed department | `{ userId }` | question | 403, 404, `INVALID_ADDRESSEE`, `QUESTION_CLOSED` |
| `PATCH /api/tasks/:id/comments/:commentId` (changed) | as F06 | `{ bodyDoc }` | comment | as F06 |
| `GET /api/me/questions` | session | page; `status` (default `open`) | open questions waiting for my answer (rule B7), each with its task | — |
| `GET /api/me/tasks/summary` (changed) | `tasks.read` | — | + `questionsWaiting` | — |
| `GET /api/tasks/workload` (changed) | `tasks.read` | as F06 | per person + `estimatedMinutes`, `unestimatedCount`, `capacityMinutes` | — |
| `GET /api/tasks/board` (changed) | `tasks.read` | + `topLevel` | cards + `parent`, `progress`, `openQuestions` | — |
| `GET /api/tasks/tree` | `tasks.read` | `projectId` or `retainerCycleId` | milestones (or the cycle) → tasks → subtasks, edges (`run`, `manual`), `bottleneckId` | 404 |
| `POST /api/templates/from-task/:taskId` | assign scope on the task | `{ name, description?, keepAssignees }` | template | 403, 404, `NAME_TAKEN`, `INVALID_LINK` (a subtask) |
| `POST /api/templates/:id/task-draft` | `templates.read` | `{ startDate? }` | the wizard's draft (create payload with dates, assignees the caller may set) | 404, `TEMPLATE_KIND` |
| `PATCH /api/templates/:id` and step endpoints (changed) | `templates.manage` or the creator (Roles) | as F07, + the `task` kind's fields and `parentStepId` | template | F07's + `TEMPLATE_KIND` |

Notes:
- Routes owned by `tasks` call `files`' `FileItems` service to attach held uploads inside their transaction (F10 rule 2). The `task` owner policy answers for the `attachment` role.
- `templates` reads tasks through a new export of `tasks` (`TaskTemplates.snapshot(taskId)`) and creates through the same service as the wizard's save. It never reads task tables.
- New error codes: `SUBTASK_DEPTH`, `SUBTASKS_OPEN`, `SUBTASK_DUE_AFTER_PARENT`, `TASK_CLOSED`, `STAGE_NOT_EMPTY`, `CRITERIA_OPEN`, `INVALID_ADDRESSEE`, `QUESTION_NOT_FOUND`, `QUESTION_NO_REPLY`, `QUESTION_CLOSED`, `NOT_QUESTION_ASKER`, `TEMPLATE_KIND`.

## Screens
All Arabic RTL with logical CSS, `packages/ui` components and tokens, every string through i18next (`tasks.*`, `templates.*`); dates in Asia/Damascus with Latin digits; loading, empty and error states on each.

1. **New task wizard** `/tasks/new` (also from a project, milestone, cycle line, client or a template, with those preset).
   - A step bar: Basics, Subtasks, Files, Questions, Review. On a phone, one step per screen with Next and Back.
   - **Basics:** F06's fields, the brief editor, the department's brief fields, the estimate, "Start from a template", "Create now".
   - **Subtasks:** the run mode (three cards with a small diagram each), stages (add, rename, order), subtasks as rows (title, department, assignee or "department queue", due date suggested, estimate, stage), drag to reorder and a keyboard "Move" menu, "Suggest dates".
   - **Files:** the drop zone and paste hint, one row per file (thumbnail, name, progress, reference or deliverable, which task it goes on, remove).
   - **Questions:** questions with their addressee (a person or a department picker) and attachments.
   - **Review:** a summary of everything, the readiness warnings with a "go to" link each, and Save.
   - The live preview is in a side panel on wide screens and a collapsible panel on phones.
2. **Task page** `/tasks/$taskId` (changed).
   - **Header:** "Subtask of …" link on a subtask; progress `3/5` and bar on a parent; the open-questions badge; "Save as template" in the menu.
   - **Brief:** the rich text and the brief fields.
   - **Subtasks:** the mode, and stages as columns or groups. A timeline lists who works now (in progress), who waits (and for whom) and who is done. Drag to reorder, add, cancel. "Reopen subtasks" appears while the parent is in `revisions`, with a dialog to pick and write the notes. Finished stages' handover summaries sit between the stages.
   - **Questions and discussion:** a filter (All, Open questions), the editor with Ask a question (addressee picker) or Comment, attachments by drag, paste and button, questions with their state, replies under them, and actions (Reply, Mark answered, Reopen, Forward, Turn into subtask).
   - **Files:** drag and drop and paste, plus the "From subtasks" and "In the discussion" groups; the viewer opens on click.
   - **Acceptance criteria:** ticks; the submit button explains `CRITERIA_OPEN` and `SUBTASKS_OPEN` before it is pressed.
   - **Handover note:** on a subtask, before submit.
3. **My tasks** (changed): a "Questions waiting for my answer" section (from `GET /api/me/questions`) after "to review"; rows show the "subtask of …" badge.
4. **Task list and board** (changed): the "subtask of …" badge, the parent's progress, the open-questions badge; filters: hide subtasks, open questions, parent.
5. **Workload** (changed): estimated hours against capacity per person, with the count of tasks without an estimate.
6. **Project Tasks tab** (changed): a List / Tree switch; the tree with the bottleneck highlighted and a legend. The retainer page's "This month" gets the same switch.
7. **Templates** (F07, changed): the kind "Task" in the list and its filter; the editor for the root task and its sub-steps, stages and order; "Saved from …" on templates saved from a task.
8. **Viewer**: a full-screen component in `packages/ui`, reused by tasks, content (F08B) and files.

What roles see differently:
- everyone sees every task, subtask, question and template;
- the actions follow the access table, so plain employees see Reply, Ask and Mark answered (their own questions), and the parent's assignee sees the subtask and review actions on that parent's subtasks;
- "Save as template" shows for assign-scope holders only.

## Audit, notifications and jobs
- **Audit** (entity `task` unless noted; `after` carries `taskId` and, for subtasks, `parentId`):
  - subtasks: `task.created` (a subtask carries `parentId`), `task.run_mode_changed`, `task.subtasks_reordered`, `task.subtasks_reopened` (ids and notes), `task.handover_noted`; F06's `task.status_changed` for every cascade, with the parent's reason;
  - stages: `task_stage.created`, `task_stage.updated`, `task_stage.archived`, `task_stage.finished` (with the handover summary);
  - criteria: `task_checklist_item.*` with `kind`;
  - questions (entity `task_comment`): `task_comment.question_asked`, `task_comment.question_forwarded`, `task_comment.question_answered`, `task_comment.question_reopened`, `task_comment.converted` (with the subtask id);
  - files: F10's file entries for attachments and creation files;
  - readiness: `task.leave_accepted` as F17; other readiness warnings are not audited;
  - templates: `work_template.created` (with `fromTaskId`), and F07's template entries for the `task` kind.
- **Notifications** (F16 engine, the shared rules of v2-scope §4). "Parent's assignee" falls back to the parent's department managers when the parent is unassigned. Followers (F16 rule B12) of a subtask are its own; the parent's assignee follows each of its subtasks automatically.

| Type | Event | Recipients | Pri. | Box | Push | Email | Resolves when / notes |
|---|---|---|---|---|---|---|---|
| `task_assigned` (existing) | a subtask is created with, or changed to, an assignee | new assignee | important | A | on | on | as F16; the text names the parent ("subtask of …") |
| `task_requested` (existing) | a subtask is created without an assignee | managers of its department | important | A | on | — | as F16 · escalates |
| `subtask_turn` | sequential: the subtask before it finished, so it opens (rule A6) | its assignee, else managers of its department | important | A | on | — | it starts; void when cancelled, archived or blocked again · carries the previous subtask's note and finals |
| `subtask_handover` | stages: the previous stage finished, so it opens (rules A6, A12) | each opened subtask's assignee, else managers of its department | important | A | on | — | it starts; void when cancelled, archived or blocked again · carries the handover summary |
| `subtask_stage_finished` | every subtask of a stage is delivered | the parent's assignee | normal | I | on | — | merges per parent and day |
| `subtasks_all_finished` | the last open subtask of a parent is delivered | the parent's assignee | important | A | on | — | the parent moves to `internal_review`, is cancelled or archived; void when a subtask is added or reopened |
| `subtask_holding_next` | daily job: an overdue subtask holds an open subtask through `run` dependencies (rule A14) | the parent's assignee (important, A); the waiting subtask's assignee (normal, I) | important / normal | A / I | on | — | the overdue subtask is delivered, cancelled, archived or re-dated · step 2 added (the parent's department managers, rule B11 of F16) |
| `task_review_requested` ✏️ (existing) | a subtask moves to `internal_review` | managers of its department **+ the parent's assignee** (not the AM) | important | A | on | — | as F16 · escalates |
| `task_reopened` ✏️ (existing) | a cancelled task is reopened, **or a delivered task is reopened** (internal or client, including rule A10) | assignee + creator | normal | I | on | — | |
| `task_question_asked` | a question is asked, or forwarded to a member | the addressee; the managers of the department | important | A | on | — | answered; void for the managers when forwarded, and for everyone when the task is delivered, cancelled or archived · its own timing (rule B8), not F16's daily chain |
| `task_question_answered` | a reply is posted to a question, or someone other than the asker marks it answered | the asker | normal | I | on | — | merges per question |
| `task_question_reminder` | 24 work hours open (rule B8) | the current addressee(s) | important | A | on | — | with the question |
| `task_question_escalated` | 48 work hours open (rule B8) | managers of the addressee's primary department, or GMs + Ops | important | A | on | on | with the question |
| `task_question_converted` | a question or comment is turned into a subtask | the asker or author + the addressee | informational | I | — | — | |
| `task_blocked` | a `new` or `in_progress` task becomes waiting again: a dependency it waits on is reopened, a new dependency is added, or the run mode or order changes (F06 edge case 3, rule A4) | its assignee | informational | I | — | — | merges per task and day · gap found by the event audit |

  None of the new types repeats beyond the rows marked; users may turn each off within the F16 channel policy. First-match order puts the new types after the existing ones in this table's order, with `task_blocked` before `task_progressed`.
- **Event audit of the touched modules** (tasks, templates, files):
  - two gaps are added: a task that becomes blocked again (`task_blocked`), and a delivered task reopened, which notified nobody (`task_reopened` extended);
  - template changes need no notification;
  - every other task, file and template change already has a type in the F16 catalog or is covered by `task_changed`, `task_file_added` or `task_progressed`.
- **Jobs:**
  - `notifications.timed` (minute job) gains the question reminder and escalation (rule B8);
  - `notifications.daily` gains `subtask_holding_next`;
  - `files.purge-uploads` already purges held uploads (F10);
  - no new job or schedule.
- **Deploy:** migrations only (expand). Nothing changes on the server.

## Edge cases
1. **Two people reorder subtasks at once:** the parent's row is locked; the second request gets `INVALID_ORDER` if the set changed, otherwise last write wins; both audited.
2. **A subtask is delivered while its parent is cancelled in another request:** the parent's lock serialises them. A cancel after the delivery leaves it delivered; a delivery after the cancel is refused (`INVALID_TRANSITION`).
3. **Sequential with a cancelled middle subtask:** it no longer blocks (F06), so the next one opens and gets `subtask_turn` naming the last delivered one.
4. **Run mode changed while subtasks run:** started subtasks stay started; `task_blocked` tells the assignee of a `new` subtask that now waits; one that no longer waits opens.
5. **A stage emptied by cancellations:** it counts as finished when its last remaining subtask is delivered. A stage with no subtasks at all is skipped by the run (rule A3).
6. **The parent's assignee is also a subtask's assignee:** they cannot review that subtask; its department managers do (rule A7).
7. **A subtask assigned to a department queue** in sequential mode opens to its department's managers ("your turn" asks them to assign).
8. **The parent is unassigned:** its rights over subtasks fall to manage-scope holders only; parent-assignee notifications go to its department's managers.
9. **The parent moves to another client or project:** subtasks follow (rule A1). A subtask with an assignee no longer in their department keeps F06 edge case 4.
10. **The parent reaches `revisions` from the client after every subtask was delivered and none is reopened:** it can be resubmitted at once (rule A8 holds no subtask).
11. **A dependency from outside the parent** (a manual dependency on another task) still blocks a subtask; the tree shows it.
12. **Reopening the parent from `delivered`:** subtasks stay delivered; "Reopen subtasks" is offered while it is in `revisions`.
13. **A question on a subtask addressed to the parent's assignee** works as any question; the parent page lists open questions of its subtasks in its badge count ("2 open, 1 in subtasks").
14. **The addressee of a question is archived:** archiving a user does not check questions. Their open questions show "addressee archived"; the reminder goes to the managers of their former primary department, and the department's managers may forward it.
15. **A forwarded member leaves the department:** the question stays with them until a manager forwards it again; it is shown with a "not in department" badge.
16. **A holiday is added between a question and its reminder:** the reminder moves later (rule B9); one already sent stays.
17. **The wizard is left half done:** nothing is saved on the server; the draft stays in that browser and held uploads are purged after 24 hours. The draft then shows those files as "expired, upload again".
18. **A pasted image that the browser cannot read** (a copied file reference instead of image data) is ignored with "Nothing to paste".
19. **A template saved from a task whose departments later have no members, or whose default assignee is archived:** applying it puts those subtasks in their department's queue.
20. **A template applied by a plain employee:** subtasks for other people become department requests (rule A2); the employee may assign only themself.
21. **Capacity without a schedule** (an employee file without a schedule, F17): the overload warning is not shown for that person and Workload shows "no schedule".
22. **Old comments and briefs** become rich-text documents by the migration, with their line breaks as paragraphs and mentions as mention nodes. Plain-text extracts are unchanged.
23. **Limits:** 30 subtasks, 10 stages, 15 criteria, 20 files and 10 questions at creation, 10 attachments per comment. At ~20 users the minute job's question check runs on a partial index of open questions.
24. **Permission loss mid-session** (the parent's assignee replaced): the next subtask action answers 403 and the page refreshes.

## Open questions
None. Every decision above was taken by the owner on 2026-10-25 (v2-scope) or 2026-10-26 (this interview), or follows from F06, F07, F10, F16 and F17.

Decisions taken here without a question, approved by the owner with the spec (2026-10-26):
- cancelling a parent cancels its open subtasks;
- a forwarded question's clock is not restarted;
- a question turned into a subtask is marked answered;
- subtasks are shown by default in lists and on the board;
- wizard drafts stay only in the browser.

## Acceptance
- Owner, step by step in the browser (A: Design manager, B: a designer, C: a content writer, D: the client's account manager, a member of Marketing):
  1. As D, open New task: a wizard. On Basics choose Marketing and assign it to yourself, write the brief with a bulleted list, fill goal and audience, estimate 4 hours. Go to Subtasks: choose Stages; stage 1 "Copy" with a Content subtask for C; stage 2 "Design" with two Design subtasks (one to B, one to the Design queue); press Suggest dates. The preview draws two columns.
  2. Files: drag a moodboard image and paste a screenshot; mark the screenshot as a reference on the Design subtask. Questions: ask the Design department "Which sizes?". Review: a warning says B is on leave on the due date (prepare a leave in F17 first); accept and save. Everything appears on the task page.
  3. As A, see "Questions waiting for my answer"; forward the question to B. As B, reply; the question shows the reply; mark it answered. D sees the answer notification.
  4. As C, open the subtask: write a handover note; submit with an unticked criterion: refused (`CRITERIA_OPEN`); tick it, submit. As D (the parent's assignee), approve it: it becomes delivered. B gets "handover received" with C's note and files; the Design queue's managers get it for the second subtask.
  5. As A, assign the queued subtask; as B, deliver both through review. D gets "all subtasks finished". Try to submit the parent before that: refused (`SUBTASKS_OPEN`).
  6. Submit the parent, send it to the client, record "changes requested". Reopen only B's first subtask with a note: B is told; the others stay delivered.
  7. Switch the parent to Sequential while B works: the order now chains; check the timeline.
  8. Ask B a question and wait (or run the minute job as if a work day later): B gets the reminder; a day later, A gets the escalation. A Friday in between does not count.
  9. Turn a comment into a subtask: the form is prefilled; save; the comment shows the link.
  10. Save the parent as a template with "keep assignees"; start a new task from it: every step is filled with new dates.
  11. Open the project's Tasks tab in Tree mode: the waiting subtask's blocker is highlighted as the bottleneck.
  12. Open Workload: estimated hours against capacity, with tasks without an estimate counted.
  13. Open the audit log and find the run mode change, the reorder, the reopen, the forward and the template.
- Tests:
  - Unit (contracts):
    - `runDependencies` for the three modes, with cancelled and empty stages;
    - `suggestSubtaskDates` across Fridays and holidays;
    - `workHoursBetween` across Fridays, holidays and midnight in Asia/Damascus;
    - `bottleneck`;
    - the brief field schemas, the rich-text mention node, the create schema limits, the readiness warnings schema.
  - API (`apps/api/test/task-subtasks.test.ts`, `task-questions.test.ts`, `task-creation.test.ts`, `task-templates.test.ts`, `task-tree.test.ts`; the changed F06 suites):
    - every endpoint for success, 401, 403 and out of scope: an employee reordering another parent's subtasks; the parent's assignee reviewing their own subtask; a non-manager forwarding; a non-asker reopening; a project manager saving a template;
    - each error code; rules A1–A14, B1–B13, C1–C8 and D1–D4;
    - the one-transaction create (one bad part saves nothing);
    - subtasks excluded from `WorkProgress`; the cascades;
    - the minute job's reminder and escalation timing, idempotent;
    - each notification's recipients, never the actor, resolution and voiding;
    - audit entries in the same transaction;
    - the migration of old briefs and comments.
  - Web unit: the wizard draft in local storage, the paste handler, the preview layout per mode.
  - E2E with RTL screenshots (`apps/web/e2e/screens.spec.ts`): every wizard step and the preview in each mode, the task page with subtasks (timeline, stages, handover summary), questions (open, answered, forwarded), the reopen dialog, the viewer (image and video), My tasks with questions waiting, the list and board badges, Workload with hours, the project tree with the bottleneck, the task template editor. One E2E flow: create with stages → hand over → deliver subtasks → parent to the client → reopen one subtask.
