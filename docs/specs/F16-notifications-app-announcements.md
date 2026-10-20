# F16 — Notifications 2.0, installable app and announcements

Status: Approved · Date: 2026-10-20 · Scope: `docs/product/v2-scope.md` §F16 (and §2) · ADRs: 0008, 0013, 0014, 0018, 0019, 0028, 0032, 0036, 0037, 0038

## Summary
The bell works only while the app is open in a browser tab. A phone in a pocket hears nothing, so the team still pings each other outside the system. Read notifications also stay in the bell after the work behind them is done, so the bell is not a list of what is left to do. And management has no way to tell everyone something and know who read it.

F16 makes the Hub an **installable app** (Android, iPhone, computers) that opens without a connection. It adds **Web Push** to every signed-in device, even with the app closed and the phone locked, and turns notifications into a **complete engine**:
- four priorities;
- channels per type set by management, with each user choosing within those limits;
- two inboxes, "Needs you" and "For your information";
- notifications that close themselves when their work is done;
- "remind me later";
- grouping;
- followers on tasks and posts;
- a general three-step escalation chain;
- reminders at exact times;
- a morning push summary.

A full event audit fills about 50 gaps in the catalog. People can send **announcements** to any audience, with "I have read this" receipts, reminders, scheduling, pinning, attachments, templates and a quick poll, through **one audience picker** that the board, chat and portal reuse later.

## In scope / out of scope
- In:
  - **Part A, the app and push.**
    - Manifest, service worker and icons.
    - An install prompt, and an Arabic iPhone guide.
    - The unread count on the app icon.
    - An offline read-only cache, and an update banner.
    - Web Push subscriptions per signed-in device (F01B), with push on and off per device and a test push.
    - A delivery log.
    - Sessions last 30 days.
    - A push switch per type in the settings.
    - Priorities in the catalog.
  - **Part B, the engine.**
    - Channel policy per type, set by management.
    - Inboxes and self-resolving notifications; snooze; grouping extended.
    - Followers on tasks and posts.
    - The escalation chain.
    - The minute job: exact-time reminders, snooze wake-ups and scheduled announcements.
    - The morning push summary.
    - Immediate email for critical types.
  - **Part C, the catalog.** The new types and recipient changes of "Notification types". The approval link records its first opening (`approval_opened`).
  - **Part D, announcements.**
    - Announcements, receipts and reminders.
    - Scheduling, pinning, attachments (F10) and templates.
    - Polls.
    - The audience resolver and the audience picker.
    - A light rich-text editor.
- Out (later or never):
  - **Quiet hours: never (owner, 2026-10-20).**
  - **External messaging channels (WhatsApp, Telegram): never (owner, 2026-10-20).**
  - Holding back a push while the user is active in the app (owner, 2026-10-20: push is always sent; this changes the v2-scope direction). Reading on one device clears the notification from the others instead (rule A14).
  - Native store apps; SMS.
  - "Share to Vertex Hub" from the phone's gallery (Android only; considered with F21).
  - Reactions on announcements, saved audiences, automatic announcements ("a new colleague joined"): later.
  - Users writing their own notification rules.
  - Followers on records other than tasks and posts.
  - Changing a type's priority from the UI: priorities are fixed in the catalog.
  - Escalation timings set from the UI: they are fixed per type.
  - Notifications to clients (F20 portal).
  - Chat (F21).
  - Opening records offline beyond the cache; editing offline.

## Roles and access
Two new permissions (`packages/contracts/src/permissions.ts`):

| Permission | Granted to |
|---|---|
| `notifications.policy` | General Manager: `all` · Internal Operations manager: `all` |
| `announcements.manage` | General Manager: `all` · Internal Operations manager: `all` · Department Manager: `department` (members of the departments they manage) |

| Action | Permission | Roles and scope |
|---|---|---|
| Own notifications, settings, snooze, push subscription of the current session, test push | session | every active user, own rows only |
| Follow or unfollow a task or post | `tasks.read` / `content.read` covering the record | as F06 / F08 |
| Read and change the channel policy; read the push delivery log | `notifications.policy` | General Manager, Internal Operations manager |
| Write, send, schedule, edit and withdraw own announcements to any audience, with priority normal, important or informational, with or without acknowledgement and a poll | session | every active user (decided, owner, 2026-10-20) |
| Send a **critical** announcement, or **pin** one to the home page | `announcements.manage` covering every resolved recipient | GM, Internal Operations manager: any audience · Department Manager: only when every recipient is a member of a department they manage |
| Withdraw anyone's announcement; read every announcement and its receipts | `announcements.manage` `all` | GM, Internal Operations manager |
| Read an announcement and act on it (acknowledge, vote) | session | its recipients |
| Read the receipts (who read, who acknowledged) and the named votes | session | the author; holders of `announcements.manage` `all` |
| Personal templates | session | every active user, own templates |
| Shared templates (create, edit, archive) | `announcements.manage` `all` | GM, Internal Operations manager; every user reads them |
| Preview an audience (count and names) | session | every active user |

Nothing in a notification grants access. Its link opens the record under the record's own permissions (F14).

## Priorities, inboxes and channels
**Priorities**, fixed per type in the catalog:

| Priority | Meaning | Push default | Push urgency, TTL | Sort and style |
|---|---|---|---|---|
| `critical` | late or blocking; money or a client at risk | **required** | `high`, 24 h | first; red mark |
| `important` | someone must act | on | `high`, 12 h | |
| `normal` | worth knowing soon | on (owner, 2026-10-20) | `normal`, 4 h | |
| `informational` | for the record | off (the user may turn it on) | `low`, 4 h | |

**Inboxes.**
- "Needs you" (`action`) holds the types with a resolution: something the recipient must do.
- "For your information" (`info`) holds the rest.
- "Done" holds what was resolved.
- "Snoozed" holds what waits for its time.

**Channels.** Every type always reaches the app unless the user mutes it (only mutable types can be muted, F14). Push and email follow the policy:
- `required`: on, the user cannot turn it off;
- `on`: on until the user turns it off;
- `off`: off until the user turns it on;
- `unavailable`: never.

The defaults are in the type tables below:
- **R** = required
- **on**
- **—** = off

Management changes push and email modes per type (rule B2). The app channel stays as F14.

## Notification types
The full matrix. All types live in `packages/contracts/src/notifications.ts` with:
- category, subject and `mutable` (as today);
- `priority`;
- `box`: **A** = Needs you, **I** = For your information;
- push and email defaults;
- `resolves` (the events that close it, rule B5);
- `merges` (rule B9);
- `escalation` (rule B11).

"AM" = the client's primary account manager · "PM" = project manager · "managers of X" = the current managers of department X · "GMs" = holders of the General Manager role · "Ops" = managers of Internal Operations · "Finance" = holders of the Finance role · "followers" = rule B12.

The actor is never notified (F14). "Opened" means the notification closes when its recipient opens it.

### Existing types (priority, box, channels and resolution added; ✏️ = recipients change)
| Type | Recipients | Pri. | Box | Push | Email | Resolves when |
|---|---|---|---|---|---|---|
| `task_assigned` | new assignee | important | A | on | on | the task leaves `new`; void when reassigned, cancelled or archived |
| `task_mentioned` | mentioned users | important | A | on | on | opened, or the recipient comments on the task |
| `task_returned` | assignee | important | A | on | — | resubmitted; void when reassigned, cancelled or archived |
| `task_review_requested` | managers of the task's department + AM | important | A | on | — | the task leaves `internal_review` · escalates |
| `task_medical_review_requested` | Medical Consultation members | important | A | on | — | the medical review is recorded or the task leaves the medical stage · escalates |
| `task_awaiting_client` | AM | important | A | on | — | an approval request includes the task, a client response is recorded, or the task leaves `awaiting_client` · escalates |
| `task_over_limit` | AM | important | A | on | — | the revision is decided |
| `approval_responded` | AM + request creator | important | A | on | on | opened · merges per request |
| `approval_no_response` | AM + request creator | important | A | on | — | the client responds, or the link is reissued or revoked |
| `approval_expired` | AM + request creator | important | A | on | — | reissued, revoked, or the request is complete |
| `task_changed` | assignee (previous one when taken away) | normal | I | on | — | · merges per task (new) |
| `task_commented` ✏️ | assignee **+ followers** | normal | I | on | — | · merges per task |
| `task_file_added` ✏️ | assignee **+ followers** | normal | I | on | — | · merges per task |
| `task_requested` | managers of the department | important | A | on | — | the task is assigned, cancelled or archived · escalates |
| `tasks_generated` | each assignee (normal, I); managers of each department with unassigned tasks (important, A) | normal / important | I / A | on | — | managers' notice: every task of the run left unassigned in that department is assigned or closed |
| `task_approved` | assignee | normal | I | on | — | |
| `task_opened` | assignee, else managers of the department | normal | I | on | — | |
| `request_finished` | creator | normal | I | on | — | |
| `post_returned` | responsible | important | A | on | — | resubmitted; void when the responsible changes or the post is cancelled |
| `post_review_requested` | managers of Content Management and Internal Operations + AM | important | A | on | — | the post leaves review · escalates |
| `post_medical_review_requested` | Medical Consultation members | important | A | on | — | the medical review is recorded · escalates |
| `post_awaiting_client` | AM | important | A | on | — | sent for approval, response recorded, or the post leaves the state · escalates |
| `post_assigned` | new responsible | important | A | on | — | submitted for review; void when the responsible changes or the post is cancelled |
| `post_approved` | responsible | normal | I | on | — | |
| `post_task_ready` | responsible | normal | I | on | — | |
| `post_task_unlinked` | responsible | important | A | on | — | a task is linked to the post, or the post is cancelled or archived |
| `shoot_booked`, `shoot_dropped` | crew | normal | I | on | — | |
| `shoot_changed` | crew | important | I | on | — | |
| `meeting_invited`, `meeting_dropped` | people of the meeting | normal | I | on | — | |
| `meeting_changed` | people of the meeting | important | I | on | — | |
| `task_due_soon` | assignee | important | A | on | on | the task is finished, cancelled or archived; void when re-dated |
| `task_overdue` | assignee, else managers of the department | critical | A | R | on | finished, cancelled, archived or re-dated |
| `task_overdue_escalated` | managers of the department | critical | A | R | on | same · step 3 added (rule B11) |
| `task_over_limit_pending` | AM + Ops | critical | A | R | R | the revision is decided |
| `post_publish_today` | responsible | important | A | on | — | published, re-dated, cancelled |
| `post_publish_overdue` | responsible + AM | critical | A | R | on | same · step 2 added |
| `shoot_upcoming` | crew | important | I | on | — | |
| `shoot_not_closed` | lead + creator | important | A | on | — | the shoot is closed, cancelled or archived (owner, 2026-10-20) · step 2 added |
| `meeting_upcoming` | organizer + attendees | normal | I | on | — | |
| `client_account_manager_assigned` | new AM | important | A | on | — | opened |
| `project_manager_assigned` | new PM | important | A | on | — | opened |
| `retainer_renewal_due` | AM | important | A | on | — | the renewal date changes, or the retainer ends or is archived |
| `retainer_behind` | AM + Ops | important (`final`: critical) | A | on (`final`: R) | — | the cycle closes |
| `retainer_term_renewed` | AM | normal | I | on | — | |
| `retainer_cycle_report_ready` | AM | important | A | on | — | opened |
| `retainer_amendment_pending` | GMs | important | A | on | — | approved, rejected, withdrawn or cancelled · step 1 only |
| `retainer_amendment_decided` | creator | normal | I | on | — | |
| `quote_approval_requested` | GMs | important | A | on | — | decided or withdrawn · step 1 only |
| `quote_approval_decided` | requester | important | A | on | — | opened |
| `quote_accepted` ✏️ | AM + managers of the engagement's departments **+ Finance** | normal | I | on | — | |
| `invoice_overdue` | Finance + Ops + AM | critical | A | R | R | paid or voided · step 3 at 14 days overdue |
| `invoice_paid` | AM | normal | I | on | on | |
| `ad_budget_low` | AM + owners of active wallet-funded campaigns | important | A | on | — | the balance is back at or above the threshold · step 2 after 7 days |
| `email_failed` | sender | important | A | on | — | the sender emails the same kind for the same record successfully |
| `lead_assigned` ✏️ | new owner | important | A | on | — | opened |
| `lead_won` ✏️ | owner + AM **+ GMs** | normal | I | on | — | |
| `lead_follow_up_due` | owner | important | A | on | — | a follow-up is recorded, the date moves, or the lead is closed |
| `lead_follow_up_overdue` | owner + managers of General Communication and Marketing | critical | A | R | on | same |

### New types
| Type | Event (module) | Recipients | Pri. | Box | Push | Email | Resolves when / notes |
|---|---|---|---|---|---|---|---|
| `task_reopened` | a cancelled task is reopened (tasks) | assignee + creator | normal | I | on | — | |
| `task_delivered` | a task is delivered (tasks) | PM + AM | informational | I | — | — | after `request_finished` in first-match order |
| `task_revision_decided` | an over-limit revision is decided (tasks) | assignee | informational | I | — | — | with the decision (free, or billed as extra work) |
| `task_progressed` | the task's status moves (tasks) | followers not otherwise told by the same change | normal | I | on | — | merges per task |
| `task_due_shortly` | 2 h before the due date and time of an open, assigned task that has a due time (minute job) | assignee | important | A | on | — | finished, cancelled, archived; void when re-dated |
| `post_published` | a post is published (content) | AM | informational | I | — | — | |
| `post_cancelled` | a post is cancelled (content) | AM + responsible + assignees of its linked tasks | normal | I | on | — | |
| `post_file_added` | a file or version is added to a post (files) | responsible + followers | normal | I | on | — | merges per post |
| `post_progressed` | the post's status moves (content) | followers not otherwise told | normal | I | on | — | merges per post |
| `post_publish_shortly` | 2 h before the publish date and time of an approved or scheduled post with a publish time (minute job) | responsible | important | A | on | — | published, re-dated, cancelled |
| `responsibility_moved` | the holder of a role on a record changes: post responsible, client AM, PM, lead owner, campaign owner, department manager | the previous holder | informational | I | — | — | names the role, the record and the new holder |
| `approval_opened` | the client opens an issued approval link for the first time (approvals) | AM + request creator | informational | I | — | — | needs `approval_requests.first_opened_at` |
| `approval_completed` | every item of a request is answered (approvals) | AM + request creator | normal | I | on | — | |
| `shoot_starting` | 2 h before a scheduled shoot starts (minute job) | crew | important | I | on | — | with the place |
| `meeting_starting` | 15 min before a meeting starts (minute job) | organizer + attendees | important | I | on | — | with a "Join" link when the meeting has one |
| `shoot_completed` | a shoot is closed (calendar) | AM + creator | informational | I | — | — | |
| `client_status_changed` | a client becomes active, paused or ended (clients) | AM + GMs + Ops + Finance | normal | I | on | — | |
| `client_healthcare_changed` | the healthcare flag changes (clients) | Medical Consultation members + managers of Content Management | normal | I | on | — | |
| `lead_lost` | a lead is lost (leads) | owner + GMs + managers of General Communication and Marketing | normal | I | on | — | |
| `quote_expiring` | daily job: a `sent` quote is valid until 3 days from today or sooner, and still valid (quotes) | AM + quote creator | important | A | on | — | accepted, rejected, extended or expired |
| `quote_expired` | the quote expiry job expires a quote | AM + quote creator | normal | I | on | — | |
| `quote_rejected` | a rejection is recorded, or the lead is lost (quotes) | AM + quote creator + GMs | normal | I | on | — | |
| `invoice_draft_created` | an invoice draft is created automatically: milestone, cycle charge, quote deposit (invoices) | Finance + Ops | important | A | on | — | issued, voided or archived · escalates |
| `invoice_due_soon` | daily job: an issued, unpaid invoice is due in 3 days (invoices) | AM + Finance | normal | I | on | — | |
| `payment_recorded` | a payment leaves the invoice partially paid (invoices) | AM | normal | I | on | — | the push text has no amount (rule A9) |
| `payment_voided` | a payment is voided (invoices) | AM + Finance | important | I | on | — | |
| `invoice_voided` | an issued invoice is voided (invoices) | AM + Finance | normal | I | on | — | |
| `ad_deposit_recorded` | an ad deposit is recorded (campaigns) | AM + owners of the wallet's active campaigns | informational | I | — | — | |
| `project_status_changed` | a project's status changes (projects) | AM + PM + managers of the project's departments; + Finance when completed or cancelled | normal | I | on | — | |
| `milestone_completed` | a project milestone is completed (projects) | AM + PM | normal | I | on | — | |
| `extra_work_created` | extra work is created, by hand or from a revision decision (projects) | Finance + AM | normal | I | on | — | |
| `retainer_status_changed` | a retainer is paused, ended (by hand or by its term) or reactivated (projects) | AM + Finance + managers of its departments | normal | I | on | — | |
| `contract_signed` | a retainer contract or annex is marked signed (projects) | AM + GMs + Finance | normal | I | on | — | |
| `contract_voided` | a contract or annex is voided | AM + GMs + Finance | normal | I | on | — | |
| `campaign_assigned` | a campaign is created with, or changed to, an owner (campaigns) | new owner | important | A | on | — | opened |
| `campaign_status_changed` | a campaign's status changes | AM + owner | normal | I | on | — | |
| `campaign_end_passed` | daily job: an active campaign's end date has passed | owner + AM | important | A | on | — | completed, cancelled, or the end date moves · escalates |
| `department_manager_assigned` | a department's manager changes (auth) | new manager | important | A | on | — | opened |
| `member_moved` | a user's departments change (auth) | the user + managers of the departments they left and joined | normal | I | on | — | |
| `member_archived_open_work` | a user with open tasks, posts, leads or campaigns is archived (auth) | managers of their departments (GMs when the user managed it) | important | A | on | — | the daily job finds none of those items left · escalates |
| `security_new_device` | in-app copy of the new-device email (F14 email rule 15) | the user | important | I | on | R (as today) | |
| `security_notice` | in-app copy of the security notice email (F14 email rule 14) | the user | informational | I | — | R (as today) | |
| `push_device_lost` | a device's push subscription was refused for good (rule A13) | the user | informational | I | — | — | |
| `announcement` | an announcement is sent or re-notified (announcements) | its recipients | the announcement's | A with acknowledgement, else I | by priority | — | acknowledged; opened when no acknowledgement; void when withdrawn |
| `announcement_ack_reminder` | daily reminder (rule D8) | recipients who have not acknowledged | important | A | on | — | acknowledged or withdrawn |
| `announcement_ack_summary` | after the third reminder | the author | normal | I | on | — | names how many have not acknowledged |
| `poll_closing` | one day before a poll closes (rule D11) | recipients who have not voted | normal | A | on | — | voted, or the poll closes |
| `poll_results` | a poll closes | the author | informational | I | — | — | |
| `action_reminder` | escalation step 1 (rule B11) | the open recipients of the original | important | A | on | — | with the original |
| `action_escalated` | escalation step 2 | their managers (rule B11) | important | A | on | on | with the original |
| `action_escalated_top` | escalation step 3 | GMs + Ops | critical | A | R | on | with the original |

**First-match order** (F14 rule 2) puts the new types after the existing ones, in this table's order, except:
- `task_progressed` and `post_progressed` come last;
- `task_delivered` comes after `request_finished`.

**Followers vs. the matrix.** The matrix proposed the AM as a follower. The followers decision (owner, 2026-10-20: creator, assignee or responsible, commenters, mentioned, plus manual follow) is narrower and wins. The AM follows a task only by hand.

## Data
Modules: `notifications` (extended), `auth` (sessions), `announcements` (new), `audiences` (new). The tables are in `packages/db/src/schema/notifications.ts`, `announcements.ts` and `auth.ts`. Push and follower tables are not business records: no archive column, no audit. They are listed as exceptions in `packages/db/src/conventions.test.ts`. Announcements and templates are business records.

### `sessions` (changed, `auth`)
Lifetime 30 days, renewed on use (`expiresIn` 30 days, `updateAge` 1 day; owner, 2026-10-20). No column change.

### `push_subscriptions`
| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key |
| `user_id` | uuid → `users.id` | required, cascade |
| `session_id` | uuid → `sessions.id` | required, **unique**, `on delete cascade`: signing a device out, or the session expiring and being removed, deletes its subscription (rule A3) |
| `endpoint` | text | required, unique, ≤ 1000, `https:` only |
| `p256dh`, `auth` | text | required; the browser's public keys |
| `device_label` | text | required; "Chrome · Android" from the user agent that subscribed, copied onto each delivery (settled in A1) |
| `created_at`, `updated_at` | timestamptz | |
| `last_success_at`, `last_failure_at` | timestamptz | optional |
| `failure_count` | integer | default 0; reset on success |

### `push_deliveries`
One row per push sent to a subscription. Purged 30 days after creation.

| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key; also the push's id in the payload |
| `user_id` | uuid → `users.id` | required |
| `subscription_id` | uuid → `push_subscriptions.id` | optional, set null on delete |
| `device_label` | text | required; "Chrome · Android", kept when the subscription goes |
| `kind` | enum (`notification`, `morning_summary`, `test`) | required |
| `notification_id` | uuid → `notifications.id` | optional, set null |
| `status` | enum (`queued`, `sent`, `gone`, `failed`) | required |
| `error` | text | optional, ≤ 500 |
| `created_at`, `sent_at`, `clicked_at` | timestamptz | |

Indexes: `(user_id, created_at desc)`, `(created_at)`.

### `notifications` (changed)
| Field | Type | Constraints |
|---|---|---|
| `priority` | enum `notification_priority` | required; snapshot of the type's priority (`retainer_behind` final and `announcement` take theirs) |
| `box` | enum (`action`, `info`) | required; from the type (`tasks_generated` for managers, `announcement` with acknowledgement: `action`) |
| `resolution_type` | `notification_type` | optional; set for `action` rows: the type whose resolution closes it (itself, or the original type for `action_*`) |
| `resolved_at` | timestamptz | optional |
| `resolved_by_id` | uuid → `users.id` | optional; null for automatic resolution |
| `resolution` | enum (`done`, `void`) | optional, with `resolved_at` |
| `snoozed_until` | timestamptz | optional |

Indexes:
- partial `(recipient_id, updated_at desc) where box = 'action' and resolved_at is null`;
- partial `(snoozed_until) where snoozed_until is not null`;
- `(subject_type, subject_id, resolution_type) where resolved_at is null`, used by `resolve`.

Rows created before F16 are backfilled: `priority` and `box` from the catalog, unresolved. Their `resolution_type` stays null: `resolve` closes them by their own type, and the escalation chain, which reads it, leaves them out (edge case 21; settled in B1).

The escalation snapshot of an `action_*` row is its `data` (`originalType`, `originalData`, `waitingWorkDays`, `waitingOn` names and `waitingOnMore`), as every type's display snapshot is; there is no separate `escalation` column (settled in B1).

### `notification_settings` (changed)
| Field | Type | Constraints |
|---|---|---|
| `push_overrides` | jsonb | required, default `{}`; `{ type: boolean }`, only where the user departs from the policy default |
| `email_overrides` | jsonb | required, default `{}`; replaces `email_types`. The migration turns each saved `email_types` into overrides against the defaults, so saved choices are kept |
| `morning_push` | boolean | required, default true |

`email_types` is no longer read or written from A1 and is dropped in the first release after the F16 deploy (expand, then contract: the previous release still reads it during a deploy or a rollback, and F16 reaches production in one deploy).

### `notification_policies`
One row per type that management changed. No row means the catalog default. Audited (`notification_policy.updated`).

| Field | Type | Constraints |
|---|---|---|
| `type` | `notification_type` | primary key |
| `push` | enum `channel_mode` (`required`, `on`, `off`, `unavailable`) | required |
| `email` | enum `channel_mode` | required |
| `updated_by_id` | uuid → `users.id` | required |
| `updated_at` | timestamptz | |

### `record_followers`
| Field | Type | Constraints |
|---|---|---|
| `subject_type` | enum (`task`, `post`) | required |
| `subject_id` | uuid | required |
| `user_id` | uuid → `users.id` | required, cascade |
| `following` | boolean | required; false = the user unfollowed, so automatic following does not add them back |
| `source` | enum (`auto`, `manual`) | required |
| `created_at`, `updated_at` | timestamptz | |

Primary key `(subject_type, subject_id, user_id)`; index `(user_id)`.

### `timed_reminders`
Idempotency of the minute job. Purged 30 days after `occurs_at`.

| Field | Type | Constraints |
|---|---|---|
| `kind` | enum (`task_due_shortly`, `post_publish_shortly`, `shoot_starting`, `meeting_starting`) | required |
| `subject_id` | uuid | required |
| `occurs_at` | timestamptz | required; the moment the reminder is for |
| `sent_at` | timestamptz | required |

Primary key `(kind, subject_id, occurs_at)`. A moved time is a new key.

### `notification_reminders` (changed)
New kinds:
- `quote_expiring`, `invoice_due_soon`, `campaign_end_passed`;
- `escalation_1`, `escalation_2`, `escalation_3`, keyed by the original (a name-based id of its type and subject, so two originals on one record keep separate keys; settled in B1) and the date it was created;
- `ack_reminder` (per announcement and work day);
- `poll_closing`.

### `approval_requests` (changed, `approvals`)
`first_opened_at` (timestamptz, optional): set by the first load of the public page for the current link. Cleared on reissue.

### `announcements`
| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key |
| `author_id` | uuid → `users.id` | required |
| `title` | text | required, 3–120 |
| `body` | jsonb | required; a TipTap document limited to paragraphs, headings (level 3), bold, italic, bullet and numbered lists and links (`https:` and `mailto:` only); ≤ 10 000 characters of text; validated by `announcementBodySchema` |
| `link_url`, `link_label` | text | optional; `https:` only, ≤ 1000 / ≤ 60 |
| `priority` | enum `notification_priority` | required |
| `requires_ack` | boolean | required; true for every critical announcement |
| `audience` | jsonb | required; `audienceSchema` (Part D) |
| `status` | enum (`draft`, `scheduled`, `sent`, `withdrawn`) | required |
| `scheduled_at` | timestamptz | required when `scheduled`; 5 min to 90 days ahead |
| `sent_at` | timestamptz | set on sending |
| `pinned_until` | date | optional; today to 90 days ahead; needs `announcements.manage` |
| `edited_at`, `renotified_at` | timestamptz | optional |
| `withdrawn_at`, `withdrawn_by_id` | timestamptz, uuid | optional |
| `archived_at` | timestamptz | optional; a discarded draft, or a withdrawn announcement |
| `created_at`, `updated_at` | timestamptz | |

Files: F10 gains owner type `announcement` (a new FK column on `file_items` and its check constraint; roles `attachment`; at most 5 files). Reading follows the announcement; uploading belongs to the author while `draft` or `scheduled`, or when editing.

Settled in D1 (2026-10-20):
- Columns beyond the table above: `unsent_at` (edge case 17: the scheduled send found nobody in the audience, or recipients out of the author's reach; cleared when sent) and `reminded_at` (the author's last "Remind now", rule D8).
- "Active users" (rule D1) are users with a password set who are not archived; invited users receive nothing.
- `POST /api/announcements/:id/send` takes an optional `{ scheduledAt }`: a draft is sent now, or scheduled.
- A sent announcement still changes its pin (`pinned_until`, checked against `announcements.manage` over its recipients); `requires_ack` is locked with the audience and priority.
- A scheduled announcement is checked when scheduled and on each edit (empty audience, reach), and again when the minute job sends it.
- The announcement types sit in a new settings category, "Announcements"; `announcement` and `announcement_ack_reminder` cannot be muted.
- Attachments use the new F10 role `attachment` (owner type `announcement`, no client).

### `announcement_recipients`
Frozen when the announcement is sent (rule D3).

| Field | Type | Constraints |
|---|---|---|
| `announcement_id` | uuid → `announcements.id` | required |
| `user_id` | uuid → `users.id` | required |
| `opened_at` | timestamptz | optional; first opening |
| `acknowledged_at` | timestamptz | optional |
| `reminders_sent` | smallint | default 0, ≤ 3 |

Primary key `(announcement_id, user_id)`; index `(user_id)`.

### Polls: `announcement_polls`, `announcement_poll_options`, `announcement_poll_votes`
- **Poll** (one per announcement, optional): `announcement_id` (primary key), `question` (3–200), `multiple` (boolean), `anonymous` (boolean), `results` (enum `everyone_after_voting`, `author_only`), `closes_at` (timestamptz, optional, 1 hour to 90 days after sending), `closed_at`.
- **Options:** `id`, `announcement_id`, `position`, `label` (1–100); 2–10 per poll.
- **Votes:** `announcement_id`, `option_id`, `user_id`, `created_at`; primary key `(option_id, user_id)`. The voter is stored to keep one vote per person even when the poll is anonymous, and is never returned by the API for an anonymous poll.

### `announcement_templates`
`id`, `owner_id` (uuid, optional; null = shared), `name` (3–60), `title`, `body`, `priority`, `requires_ack`, `link_url`, `link_label`, `archived_at`, timestamps. Audit entries for shared templates only.

Settled in D1b (2026-10-20):
- The poll is written with the announcement (`poll` in the create and update schemas; `null` removes it from a draft or scheduled one). After sending, the existing poll may still change until the first vote; adding or removing one, or changing it after a vote, answers `LOCKED_FIELD`. Changing a poll before any vote replaces its options.
- `closes_at` is checked when the announcement is sent or scheduled (against the send time) and on each edit; a draft keeps any value until then.
- `poll_closing` is sent by the minute job 24 hours before `closes_at` (polls running at least 48 hours), keyed in `notification_reminders` by the poll and the closing date. Closing voids it; a vote closes it for the voter; withdrawing the announcement voids it.
- `poll_results` (`{ title, voters }`) goes to the author when the minute job closes the poll; an author who closes it by hand gets none (the actor is left out, F14 rule 2). Withdrawn announcements keep their poll as it was.
- Results: the author and holders of `announcements.manage` `all` see the counts, and the names for a named poll; recipients see the counts once they voted or the poll closed, when the results are for everyone, never the names. A vote is the caller's whole choice (`PUT`, at least one option) and replaces the previous one.
- `poll_closing` and `poll_results` can be muted.
- Templates: `GET /api/announcement-templates` returns `{ items }`, the caller's personal templates then the shared ones, each by name; a template stays personal or shared; someone else's personal template answers 404, a shared one 403 without `announcements.manage` `all`. Archiving answers the template.

### Contracts
- `notificationPrioritySchema`, `channelModeSchema`.
- `NOTIFICATION_CATALOG` gains `priority`, `box`, `push`, `email` (defaults) and `escalation`; `emailByDefault` goes.
- `audienceSchema`: `{ everyone?: true, departments?: DepartmentCode[], roles?: Role[], users?: uuid[], projects?: uuid[], clients?: uuid[], exclude?: uuid[] }`, at least one source; each list ≤ 200.
- `PUSH_LIMITS`, the jobs below, and the announcement schemas.

## States and rules

### Part A: the installable app and push
**The app**
1. **Manifest** at `/manifest.webmanifest`:
   - `name` "Vertex Hub", `short_name` "Vertex", `lang` `ar`, `dir` `rtl`;
   - `display` `standalone`, `start_url` `/`, `scope` `/`;
   - `theme_color` and `background_color` Vertex Green `#004139`;
   - icons 192, 512 and maskable 512;
   - shortcuts: My tasks, Notifications, New announcement (added with the announcements screens, PR D2).

   The icon files are made from `brand/logo/svg/vertex-mark-*.svg`:
   - `brand/logo/app/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (the mark inside the safe zone on green), `badge-96.png` (a white mark on transparent, for the Android status bar);
   - `apple-touch-icon.png` is regenerated square;
   - `brand/logo/png/icon-192.png` (192×191) is replaced by a square one.

   The build copies them from `brand/`; the app holds no copy.
2. **Service worker** `/sw.js`, built with the web app by vite-plugin-pwa 2.0 (`injectManifest`, Workbox 7.4 precaching; settled in A2). It:
   - precaches the app shell (HTML, JS, CSS, fonts, icons);
   - handles `push` and `notificationclick`;
   - never caches `/api/` responses.

   nginx serves `sw.js` and the manifest with `Cache-Control: no-cache` (the root location already does). The CSP stays: same-origin worker and manifest.
3. **Install.**
   - On Android and on computers, the browser's install prompt is caught and offered through an "Install the app" button. The button is in the user menu, and on a dismissible card on the home page, shown once per device until installed or dismissed for 30 days.
   - On iPhone and iPad, the card opens the **Arabic install guide** (`/install`) with illustrated steps: open in Safari → Share → Add to Home Screen → open from the icon → turn on notifications. It also explains that notifications need the app on the home screen and iOS 16.4 or later.
   - Older iOS versions get "This iPhone is too old for notifications; the app still works in the browser."
   - The installed app hides the card.
4. **Icon badge.** The app sets the badge to the unread count (rule B6), from the stream and on each count fetch, and clears it at 0. The service worker sets it from each push. On platforms without badges, nothing happens.
5. **Offline.**
   - The TanStack Query cache persists in IndexedDB per user for 7 days. Financial data is never persisted: invoices, payments, expenses, quotes, retainer charges and terms with amounts, ad wallets, finance reports and the dashboard's finance section.
   - Offline, the app opens and shows the last loaded data with a banner: "Offline · last updated <time>". Actions that change data are disabled with the hint "Needs a connection", and pages never loaded show "Not available offline".
   - The persisted cache is erased on sign-out, on a refused session, and when another user signs in on the device.
6. **Update.** When a new version is deployed, the open app shows "A new version is available · Refresh". An app opened fresh uses the new version.

**Push**
7. **Turning push on.**
   - Push is per device and needs the user's gesture: "Turn on notifications on this device" on the home card, in the notification settings and in the device row.
   - The app asks the browser's permission, subscribes with the server's VAPID public key, and sends the subscription to `PUT /api/me/push/subscription`. That call stores it on the **current session**, replacing any earlier one of that session (one subscription per device).
   - Refused permission shows how to allow it in the browser's or the phone's settings.
   - "Turn off on this device" unsubscribes and deletes it.
8. **Delivery.**
   - When `notify` stores a notification whose push is on for the recipient (rule B3), it queues one `push.send` job in the same transaction, for that recipient's subscriptions.
   - The payload carries the rendered title and body from `packages/messages`, the link, a tag, the delivery ids, the unread count and the close list (rule A14).
   - The worker encrypts and sends each message with the VAPID private key: urgency and TTL by priority (table above); `requireInteraction` for critical; the tag `subjectType:subjectId:type`, so a newer notice about the same thing replaces the older one on the screen.
   - The worker reports each outcome with `push.result`.
   - Push is sent at any hour (no quiet hours) and whether or not the user is in the app (owner, 2026-10-20).
9. **Lock-screen text.** Pushes show the full text of the notification, except money amounts: a push never contains an amount (owner, 2026-10-20). Types whose bell text holds an amount have a push variant without it in `packages/messages`: `ad_budget_low`, `retainer_amendment_pending`, `payment_recorded`, `payment_voided`. A test asserts that no push text contains a formatted amount.
10. **Opening.** Clicking a push focuses an open window of the app and navigates it, or opens the app at the notification's link. It marks the notification read and records `clicked_at` (`POST /api/me/push/deliveries/:id/click`).
11. **Action buttons**, where the platform shows them (Android, Chrome and Edge on computers; not iPhone): "Open" and "Remind me in an hour" (rule B8). "Remind me" works from the service worker without opening the app. They arrive with snoozing (PR B2); until then a click opens the link (rule A10).
12. **Signed-in devices** (F01B). Each device row shows its push state (on · off · not supported) and the last push delivered. The current device has "Send a test notification" (at most one a minute) and "Turn off on this device". Signing a device out, or signing out of all devices, deletes its subscription with its session.
13. **Dead subscriptions.**
    - A push service answer of 404 or 410 deletes the subscription (`gone`), and the user gets `push_device_lost` naming the device.
    - Other failures retry 3 times with backoff (`failed`). After 10 consecutive failed messages, the subscription is deleted the same way.
14. **Cleared everywhere.** Reading or resolving a notification on one device clears its push from the user's other devices:
    - each push payload carries the tags of up to 20 of the user's notifications read or resolved in the last 24 hours, and the service worker closes those still on the screen;
    - the app does the same for every displayed push when it opens or regains focus.

    A push the platform has already shown is not withdrawn by a silent message: platforms do not allow it.
15. **Delivery log.** Holders of `notifications.policy` see the pushes of the last 30 days, filtered by user, status and date: device, notification text, status, error, sent and clicked times. It is for answering "it did not reach me".
16. **Keys.**
    - `VAPID_PUBLIC_KEY` (API and web, through `GET /api/me/push/config`), `VAPID_PRIVATE_KEY` (worker only) and `VAPID_SUBJECT` (`mailto:info@vertexmedia.pro`), generated once on the server and kept in its `.env`, with fake values in `.env.example`.
    - `PUSH_TRANSPORT` is `webpush` or `log`. `log` is the default outside production and writes the payloads to `.data/push/`.
    - Without keys, the API reports push as unavailable, and the app hides the push controls.

### Part B: the engine
**Channels**
1. **Policy.** Each type has a push mode and an email mode: the catalog default (type tables) or a row in `notification_policies` set by management.
   - The settings screen shows required channels locked on, `unavailable` channels hidden, and `on` / `off` as the user's switch default.
   - The app channel stays as F14: only mutable types can be muted, and a muted type creates nothing, so it pushes and emails nothing.
2. **Changing the policy.** Holders of `notifications.policy` set push and email per type to `required`, `on`, `off` or `unavailable`, or reset it to the default. A change applies to notifications created after it.
   - `required` overrides every user's choice.
   - `unavailable` stops the channel for everyone.
   - `on` and `off` keep the users' overrides and change only the default of those who saved none.
   - Each change writes an audit entry.
3. **Effective channel** for a user, a type and a channel: `required` → on; `unavailable` → off; otherwise the user's override, else the mode (`on` / `off`). Email still follows F14 email rules 3–9 (pending, batching, read-skip, digest), except rule B4.
4. **Critical email.** A critical notification emailed to its recipient is pending with no 10-minute delay and is batched at the next run at any hour and on Fridays (no quiet hours); read-skip still applies. Other types keep F14 email's hours.

**Inboxes and resolution**
5. **Resolving.** The module that completes the work calls `NotificationCenter.resolve(tx, { subject, types, outcome, actorId, recipients? })` inside its transaction. It closes the unresolved `action` rows on that subject whose `resolution_type` is in `types`, for the given recipients or for all. The "Resolves when" column names each type's events; each module calls `resolve` where those events happen.
   - With outcome `done`:
     - the row of the actor, when they are a recipient, gets `resolved_at`, `resolved_by_id` and `read_at` (it moves to "Done");
     - every other recipient's row gets `resolved_at` and `resolved_by_id`, and moves to "For your information" with "Handled by <name>", keeping its read state (owner, 2026-10-20).
   - With outcome `void` (the work no longer applies: reassigned, cancelled, archived, re-dated, withdrawn): every row moves to "Done", read, with "No longer needed".
   - "Opened" types resolve as `done` when their recipient opens them.
   - A resolved row never reopens; a new event creates a new notification.
6. **Lists and counts.**
   - "Needs you": `action`, unresolved, not snoozed.
   - "For your information": `info` rows and rows resolved by someone else.
   - "Done": rows resolved by the recipient or void.
   - "Snoozed".
   - The unread count (bell, app icon, toasts) counts unread, not-snoozed rows in "Needs you" and "For your information". The bell also shows the "Needs you" count.
   - Within a list, critical rows sort first, then by `updated_at`.
7. **No manual "done".** Action rows close only through their events, or by opening for "opened" types, so "Needs you" stays a true list of what is left.
8. **Snooze ("remind me later").**
   - Any unread or "Needs you" row can be snoozed for 1 hour, 3 hours, or until the next work day at 09:00, from the bell, the page or a push button.
   - A snoozed row leaves the lists and the count. The minute job wakes it at its time: unread, `updated_at` now, a toast and a push (if push is on for the type), and `snoozed_until` cleared.
   - Unsnoozing does the same at once.
   - A row resolved while snoozed does not wake. Snoozing does not stop escalation (rule B11).
9. **Grouping.**
   - A new notice merges into the recipient's unread, unresolved row of the same type and subject, as F14 rule 5 does: `count + 1`, the latest actor and data, `updated_at` now, the push replaced through its tag.
   - This covers the types marked "merges": `task_commented`, `task_file_added`, `approval_responded`, `task_changed`, `post_file_added`, `task_progressed`, `post_progressed`.
   - Texts read "5 new comments on <task>".
10. **Toasts** stay as F14 rule 16. Critical ones stay until closed.

**Escalation**
11. **Chain.** For the types marked "escalates", while a row of the original is still unresolved for at least one recipient, the daily job (09:00, work days) sends, once each:
    - **step 1:** one work day after the original was created, `action_reminder` to its open recipients;
    - **step 2:** one work day after step 1, `action_escalated` to the managers of each open recipient's primary department. A recipient who manages that department, or has none, escalates to the GMs. Recipients of the original and of step 1 are left out.
    - **step 3:** two work days after step 2, `action_escalated_top` to the GMs and Ops, minus those who already received a step.

    Each step names the original, how many work days it has waited and who it waits on, and resolves with the original. A step with no one left to receive it is skipped. Changes per type:
    - "step 1 only" (`quote_approval_requested`, `retainer_amendment_pending`: the GMs are the top);
    - "step 2 added" (`post_publish_overdue` → managers of Content Management; `shoot_not_closed` → managers of Photography; `ad_budget_low` after 7 days → Finance);
    - "step 3 added" (`task_overdue_escalated` → GMs + Ops two work days after the escalation; `invoice_overdue` → GMs on the 14th day overdue).

    A step that is "added" without step 1 is timed as in the chain: step 2 two work days after the original, step 3 four (settled in B1), except where a time is named above. The existing escalations (A08, over-limit, lead follow-up, invoice repeats) keep their rules. Idempotent through `notification_reminders` (`escalation_<n>`).

**Followers**
12. **Following.**
    - A task is followed automatically by its creator, its assignee, everyone who comments on it and everyone mentioned in it.
    - A post is followed by its creator, its responsible person, and those who add files to it.
    - Anyone who can read the record can follow or unfollow it by hand. Unfollowing stays: automatic following does not add the user back.
    - Followers get `task_commented`, `task_file_added` and `task_progressed` (posts: `post_file_added`, `post_progressed`), merged, unless the same change already gives them a type ranked earlier.
    - Archived users and the actor are left out.
    - A follower who loses read access (F06 scope) stops receiving.

**Timed reminders and the morning push**
13. **Minute job.** `notifications.timed` (cron `* * * * *`, Asia/Damascus, worked by the API) does four things:
    - runs the timed sources: `meeting_starting` 15 minutes before; `shoot_starting`, `task_due_shortly` and `post_publish_shortly` 2 hours before;
    - wakes snoozed rows;
    - sends scheduled announcements (rule D5);
    - closes polls whose time has come.

    A timed reminder is sent once per `(kind, subject, occurs_at)`. One whose moment has already passed (the job was down, or the item was created less than the lead time before) is skipped. Work days do not apply: a meeting on Friday is reminded on Friday.
14. **Morning push.** At 08:00 on work days, with the digest job, each active user with `morning_push` on and a push subscription gets one push (not a bell row): "3 overdue · 5 due today · 2 need you". Tapping it opens the home page. Nothing is sent when all three counts are 0.

**Changes to F14 that stay**
15. Stored first, pushed second (ADR 0018). Fixed catalog, rendered from type and snapshot. First-match per recipient and subject. The 90-day purge of read rows, which now also deletes resolved rows 90 days after resolution.

### Part C: the catalog
1. Each module emits its new types inside the transaction of the change, with the recipients in the table, and calls `resolve` at the events in "Resolves when". `notifications` still reads no other module's tables. The recipients by role are resolved by the emitting module through the exported services (`UserDirectory`, department managers, role holders).
2. **Approval opened.** The public approval page sets `first_opened_at` on its first load for the current link (not on later loads, not for a revoked or expired link) and emits `approval_opened`. It records nothing else about the client (no IP, no device).
3. **Daily sources added:**
   - `quote_expiring`, owned by quotes; it runs in the daily job, 3 days before `valid_until`;
   - `invoice_due_soon` (invoices);
   - `campaign_end_passed` (campaigns);
   - `member_archived_open_work` resolution (auth asks tasks, content, leads and campaigns for open items through their exported services);
   - escalation (notifications);
   - announcement reminders (announcements).
4. **Responsibility moved.** Every change of a record's holder (post responsible, AM, PM, lead owner, campaign owner, department manager) tells the previous holder with `responsibility_moved`, unless they made the change.
5. **Security copies.** The account emails of F14 rules 14–15 also create `security_new_device` and `security_notice` rows (in the same transaction as the email), so they reach the phone. The email stays required.
6. **Settled in C1** (tasks, content, approvals, calendar, files):
   - Cancelling or archiving a task or a post voids every action row on it, including the types whose column names cancelling among the `done` events (the work no longer applies, rule B5). The rules are `taskResolutions` and `postResolutions` in `packages/contracts/src/resolutions.ts`.
   - A change's resolutions are passed to `notify`, so a row the same change resolves is stored resolved, without push or toast (edge case 9).
   - `approval_completed` is sent in its own `notify` call after the last answer: in the answer's call the first-match order would keep `approval_responded` only.
   - A timed reminder is still sent by a run up to 5 minutes after its send time (`TIMED_REMINDER_GRACE_MINUTES`); later, it is skipped. `task_due_shortly` leaves out approved tasks, which count as finished.
   - Deciding an over-limit revision closes `task_over_limit` and `task_over_limit_pending` on the task and sends `task_revision_decided` to the assignee.
7. **Settled in C1b** (clients, leads, quotes, projects, templates):
   - Archiving a scheduled shoot voids its `shoot_not_closed` (owner, 2026-10-20).
   - A lead's follow-up reminders are `done` when a follow-up is recorded or the lead is won or lost, and `void` when the date moves or the lead is archived.
   - `quote_expiring` is `done` when the quote is accepted, rejected or extended, and `void` when it expires. For a lead's quote, "AM" is the lead's owner.
   - `retainer_amendment_pending` is about the retainer, so it closes once none of the retainer's amendments waits for approval: `done` after a decision, `void` after a withdrawal or cancellation.
   - `retainer_renewal_due` is `done` when the renewal date moves and `void` when the retainer ends or is archived. Closing a cycle voids `retainer_behind`.
   - The managers' `tasks_generated` closes per department: once that department's unassigned tasks of the run are all assigned, cancelled or archived. A manager who still has a department with unassigned tasks of the run keeps it.
   - `contract_signed` is sent once per contract or annex: a new scan of a signed one is not a new signature.
   - `responsibility_moved` covers the post responsible, the account manager, the project manager and the lead owner here; the campaign owner and the department manager come with C1c.
8. **Settled in C1c** (invoices, campaigns, auth, email):
   - Archiving a user stays blocked by open assigned tasks, posts they are responsible for, open leads and managed departments (F01 rule 9, F02 rule 8; owner, 2026-10-20). `member_archived_open_work` therefore covers the open items that do not block archiving (campaigns they own), counted through `auth`'s `ResponsibilityRegistry`. It goes to the managers of the member's departments, else the GMs. The daily job closes it as `done` once no open item is left; restoring the member makes it `void` at once.
   - `invoice_draft_created` is `done` when the draft is issued and `void` when it is discarded. `invoice_overdue` is `done` when the invoice is paid and `void` when it is voided.
   - `invoice_due_soon` is sent once per invoice and due date, for a `sent` or `partially_paid` invoice due today or within three days (a run after missed days still sends it).
   - `payment_recorded` is sent when the invoice stays unpaid after the payment; a payment that pays it in full sends `invoice_paid`.
   - `campaign_end_passed` is sent once per campaign and end date. Completing the campaign or moving its end date makes it `done`; cancelling makes it `void`.
   - `ad_budget_low` is `done` when the balance is back at or above the threshold and `void` when the threshold is removed.
   - `email_failed` closes only for the same email kind (`resolve` matches the snapshot's `kind`).
   - The security copies are stored by `notifications` when `email` queues the account email (`auth` cannot import `notifications`); they are not emailed again, cannot be muted, and show email as required in the settings.
   - `department_manager_assigned` and `responsibility_moved` are not sent when a department's manager is only removed.
   - `member_moved` is sent when the member leaves or joins a department, not when only the primary department changes.

### Part D: announcements and audiences
**Audience**
1. **One resolver.** The `audiences` module exports `AudienceResolver.resolve(tx, audience)`. It returns the active users of the union of its sources, minus `exclude`:
   - `everyone`: all active users;
   - `departments`: their members, primary or not;
   - `roles`: holders, with `department_manager` meaning the managers of any department;
   - `users`;
   - `projects`, each project's team: PM, the client's AM, the assignees of its open tasks, and the managers of its departments;
   - `clients`, each client's team: AM, PMs of its projects not completed or cancelled, the assignees of its open tasks, and the responsible persons of its open posts.

   It reads through the exported services of `auth`, `projects`, `tasks`, `content` and `clients`. The board, chat and portal reuse it.
2. **Picker.** One web component `AudiencePicker` with:
   - chips for each source: Everyone, Departments, Roles, People, Projects, Clients;
   - search;
   - the live count and the names (`POST /api/audiences/preview`, up to 500 names), each name removable (added to `exclude`).

**Announcements**
3. **Sending.** An announcement is written, then sent at once or scheduled.
   - Sending resolves the audience at that moment and freezes it into `announcement_recipients`, minus the author.
   - It sends `announcement` to them in the same transaction, with the announcement's priority and channels by that priority: critical pushes are required, important and normal ones are on, informational ones off.
   - An empty audience refuses (`EMPTY_AUDIENCE`).
   - Critical and pinning are checked against `announcements.manage` for every recipient (`FORBIDDEN_AUDIENCE`). Critical forces `requires_ack`.
4. **Reading.**
   - Opening an announcement sets `opened_at`.
   - "I have read this" sets `acknowledged_at` and resolves its notification and reminders.
   - Without an acknowledgement, opening resolves it.
5. **Scheduled.**
   - A scheduled announcement can be edited or cancelled (back to draft) until it is sent.
   - The minute job sends it at `scheduled_at`, resolving the audience then.
   - An author archived before then: it is not sent and returns to draft.
6. **Critical on opening.** When the app opens or regains focus, the user's unacknowledged critical announcements show one by one in a dialog that closes only with "I have read this". Links and attachments stay usable inside the dialog.
7. **Pinning.** A pinned announcement shows at the top of each recipient's home page until the end of `pinned_until`: newest first, three at most, then "More announcements". A recipient can collapse it for themselves (not unpin it).
8. **Reminders.**
   - For an announcement that requires acknowledgement, the daily job (09:00, work days) sends `announcement_ack_reminder` to recipients who have not acknowledged it. Reminders start the next work day after sending; at most 3 per recipient.
   - After the third round, the author gets `announcement_ack_summary` once.
   - The author can also "Remind those who have not acknowledged now" at most once an hour; these manual reminders do not count toward the 3.
9. **Receipts.** The author and holders of `announcements.manage` `all` see each recipient with opened and acknowledged times, filtered to "Not opened" and "Not acknowledged", and the totals.
10. **Editing and withdrawing.**
    - The author edits the title, body, link and attachments of a sent announcement. It shows "Edited <time>".
    - With "Notify again", the announcement's notification becomes unread with a new push, and acknowledgements are cleared, so everyone acknowledges again.
    - The audience, priority and poll options (once a vote exists) cannot change after sending.
    - The author, or holders of `announcements.manage` `all`, withdraw it: its notifications resolve `void`, it leaves the recipients' lists and home pages, and the author and managers still see it marked "Withdrawn".
    - Withdrawing archives it. Drafts are discarded by archiving.
    - Managers withdraw but do not edit others' announcements.
11. **Polls.**
    - A poll has 2–10 options, single or multiple choice, named or anonymous, and results shown to everyone after they vote or to the author only (the author's choice when creating).
    - Votes can be changed until the poll closes, at `closes_at` or by the author.
    - `poll_closing` goes to non-voters one day before `closes_at`, when the poll runs at least two days.
    - `poll_results` goes to the author at closing.
    - For an anonymous poll, the API never returns who voted for what, to anyone.
12. **Templates.**
    - "Save as template" stores the title, body, priority, acknowledgement and link as a personal template.
    - Holders of `announcements.manage` `all` also save and edit shared templates, visible to everyone.
    - "Start from a template" fills the editor.
    - Templates hold no audience.
13. **Text.** The body is TipTap with the allowed marks only (data). The web renders it with the same schema (no raw HTML). Pushes and emails use the title, plus the body's first 140 characters as plain text.

### Changes to earlier features
- **F01/F01B** (`auth`):
  - sessions last 30 days;
  - the device list shows push state and the test push;
  - department manager and membership changes notify;
  - archiving a user notifies their managers about open work;
  - security emails get in-app copies.
- **F14** (`notifications`): everything in Part B. The settings page gets a push column, policy locks, and the morning-push switch. The bell gets the two inboxes and snooze.
- **F06/F08** (`tasks`, `content`): followers, `resolve` calls, and the new task and post types.
- **F09** (`approvals`): `first_opened_at`, `approval_opened` and `approval_completed`.
- **F10** (`files`): owner type `announcement`; `post_file_added`.
- **F02, F03, F04, F05, F05B, F12, F13** (`clients`, `leads`, `quotes`, `projects`, `campaigns`, `invoices`): the new types and recipient changes above.
- **F15** (home page): the pinned announcements section; the install card.
- **Deploy:** VAPID keys in the server's `.env`; nothing to change in nginx except confirming that `sw.js` and the manifest are served with `no-cache`.

## API
All routes are under the session guard unless a permission is named. Each acts only on the caller's rows where marked "own".

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/me/push/config` | session | — | `{ available, vapidPublicKey }` | — |
| `PUT /api/me/push/subscription` | session (current session) | `{ endpoint, keys: { p256dh, auth } }` | 204 | `PUSH_UNAVAILABLE`, 400 |
| `DELETE /api/me/push/subscription` | session (current session) | — | 204 | — |
| `POST /api/me/push/test` | session | — | 202 | `NO_SUBSCRIPTION`, 429 |
| `POST /api/me/push/deliveries/:id/click` | session (own) | — | 204 | 404 |
| `GET /api/me/sessions` (changed) | session | — | each device + `push: { state, lastDeliveredAt }` | — |
| `GET /api/me/notifications` (changed) | session | + `inbox` (`needs_you`, `fyi`, `done`, `snoozed`) | each row + `priority`, `box`, `inbox`, `resolution` (`done` / `void`, by whom, when), `snoozedUntil`; an escalation step carries its original in `data`; without `inbox`, every row not snoozed | — |
| `GET /api/me/notifications/unread-count` (changed) | session | — | `{ count, needsYou }` | — |
| `POST /api/me/notifications/:id/snooze` | session (own) | `{ for: '1h' \| '3h' \| 'next_work_day' }` | notification | 404, `ALREADY_RESOLVED` |
| `POST /api/me/notifications/:id/unsnooze` | session (own) | — | notification | 404 |
| `GET` / `PUT /api/me/notification-settings` (changed) | session | per type `muted`, `push`, `email`; `digestEnabled`, `morningPush` | settings with each type's `priority`, policy modes and effective values | `NOT_MUTABLE`, `CHANNEL_REQUIRED`, `CHANNEL_UNAVAILABLE` |
| `GET /api/notification-policies` | `notifications.policy` | — | `{ items }`: every type with its default and current push and email modes | 403 |
| `PUT /api/notification-policies/:type` | `notifications.policy` | `{ push, email }` or `{ reset: true }` | the type's policy | 403, 404 |
| `GET /api/push-deliveries` | `notifications.policy` | `userId`, `status`, `from`, `to`, page | page of deliveries | 403 |
| `GET` / `PUT /api/tasks/:id/following` | `tasks.read` covering the task | `{ following }` | `{ following, followers: count }` | 403, 404 |
| `GET` / `PUT /api/content/posts/:id/following` | `content.read` covering the post | same | same | 403, 404 |
| `POST /api/audiences/preview` | session | `audienceSchema` | `{ count, users[] }` (≤ 500: id, name, image, department) | 400 |
| `GET /api/announcements` | session | `view` (`received`, `sent`, `all`: `all` needs `announcements.manage` `all`), `status`, `search`, page | page | 403 |
| `GET /api/announcements/home` | session | — | pinned announcements and unacknowledged critical ones of the caller | — |
| `GET /api/announcements/:id` | recipient, author, or `announcements.manage` `all` | — | announcement, own receipt, poll with results as allowed | 404 |
| `POST /api/announcements` | session | `createAnnouncementSchema` (`send`: `now` \| `schedule` \| `draft`) | announcement | `EMPTY_AUDIENCE`, `FORBIDDEN_AUDIENCE`, 400 |
| `PATCH /api/announcements/:id` | author | `updateAnnouncementSchema` (+ `notifyAgain`) | announcement | `LOCKED_FIELD`, 403, 404 |
| `POST /api/announcements/:id/send` · `/cancel-schedule` | author | — | announcement | `NOT_DRAFT`, `NOT_SCHEDULED` |
| `POST /api/announcements/:id/withdraw` | author, or `announcements.manage` `all` | — | announcement | `ALREADY_WITHDRAWN` |
| `POST /api/announcements/:id/archive` | author (draft only) | — | 204 | `NOT_DRAFT` |
| `POST /api/announcements/:id/acknowledge` | recipient | — | 204 | `NO_ACK_REQUIRED`, 404 |
| `POST /api/announcements/:id/remind` | author | — | `{ reminded }` | `NO_ACK_REQUIRED`, 429 |
| `GET /api/announcements/:id/receipts` | author, or `announcements.manage` `all` | `filter` | recipients with opened and acknowledged times; totals | 403 |
| `PUT /api/announcements/:id/poll/vote` | recipient | `{ optionIds[] }` | poll | `POLL_CLOSED`, `SINGLE_CHOICE`, 404 |
| `POST /api/announcements/:id/poll/close` | author | — | poll | `POLL_CLOSED` |
| `GET` / `POST /api/announcement-templates` · `PATCH` / `POST …/:id/archive` | session (own) / `announcements.manage` `all` (shared) | template schemas | templates | 403 |

Files of an announcement use the F10 routes with owner type `announcement`.

## Screens
1. **Install card and guide.**
   - The card on the home page: "Install Vertex Hub on this device", with "Install" or "How" (iPhone), and "Not now".
   - `/install`: the Arabic guide with illustrated steps for iPhone, Android and computers; the current device's steps first.
   - Phone width first.
2. **Notification switch for the device.**
   - The card "Turn on notifications on this device", on the home page (after install on iPhone) and in settings.
   - States: on (with "Send a test"), off, blocked (with the steps to allow), not supported.
3. **Bell** (changed):
   - tabs "Needs you (n)" and "For your information", 10 rows each;
   - critical rows with the red mark;
   - per row, "Remind me later" (1 h · 3 h · Next work day 09:00);
   - resolved rows in "For your information" show "Handled by Ahmad";
   - links to Done and Snoozed on the page.
4. **Notifications page** `/notifications` (changed):
   - tabs Needs you · For your information · Done · Snoozed;
   - category and unread filters as today;
   - escalation rows show the original, the waiting days and who it waits on.
5. **Notification settings** `/notifications/settings` (changed):
   - per type, three switches (App, Push, Email) with priority chips;
   - locked "Required by management" and hidden unavailable channels;
   - "Turn all on or off" per category and channel;
   - the digest and morning-push switches;
   - this device's push state.
6. **Notification policy** `/admin/notification-policy` (`notifications.policy`):
   - a table of types grouped by category: priority, push mode, email mode (selects), "Changed" badge and "Reset";
   - saves per row with a toast.
   - A second tab, "Push deliveries", is the log (rule A15).
7. **Signed-in devices** (changed): the push state per row; test and turn off on the current device.
8. **Follow button** on the task page and the post page: "Follow" / "Following" with the follower count; a hint shows why the user follows automatically.
9. **Home page** (changed): pinned announcements above the Company section: title, author, time, the first lines, the acknowledgement state; "More announcements".
10. **Critical announcement dialog** (rule D6): full announcement, attachments, and the "I have read this" button. No close button.
11. **Announcements** `/announcements`:
    - tabs Received · Sent by me · All (`announcements.manage` `all`);
    - search; status chips (scheduled, sent, withdrawn);
    - unread and unacknowledged markers;
    - "New announcement".
12. **Announcement page** `/announcements/:id`:
    - title, author, time, priority, "Edited";
    - body; link; attachments (F10 cards); "I have read this";
    - the poll (vote, results as allowed).
    - For the author and managers: receipts (counts, lists, "Remind now"), Edit, Withdraw.
13. **Editor** `/announcements/new` and `/announcements/:id/edit`:
    - title; the rich-text editor (toolbar: bold, italic, heading, lists, link) with a live preview;
    - link; attachments (`UploadControl`);
    - `AudiencePicker`; priority (critical and pin only when allowed, else disabled with the reason);
    - "Require acknowledgement"; poll builder; pin until; send now, schedule (date and time) or save draft;
    - "Start from a template", "Save as template".
    - Leaving with unsaved changes asks for confirmation.
14. **Templates**: a dialog listing personal and shared templates, with rename and archive.

Every screen follows the rules below:
- RTL with logical CSS; texts through i18next (`packages/messages` for notification, push and email texts);
- loading skeletons, empty states, and `LoadError` with retry;
- phone width checked.

Roles see the same screens with their own data; manager-only controls are hidden, and the API enforces them.

## Audit, notifications and jobs
- **Audit:**
  - announcements: `announcement.sent`, `.scheduled`, `.schedule_cancelled`, `.edited` (with `notifyAgain`), `.withdrawn`, `.archived`, `announcement_poll.closed`;
  - shared templates: `announcement_template.created`, `.updated`, `.archived`;
  - `notification_policy.updated` (type, before and after).
  - None for push subscriptions, deliveries, followers, snoozes or reads: they are personal or technical (conventions exceptions).
- **Notifications:** the catalog above.
- **Jobs** (`packages/contracts/src/jobs.ts`):

| Queue | Schedule | Worked by | Does |
|---|---|---|---|
| `push.send` | on demand, retry 3 with backoff | worker | encrypts and sends one notification to the user's subscriptions; reports `push.result` |
| `push.result` | on demand | API | records outcomes, deletes gone subscriptions, emits `push_device_lost` |
| `notifications.timed` | `* * * * *` Asia/Damascus | API | timed reminders, snooze wake-ups, scheduled announcements, poll closing |
| `notifications.daily` (changed) | as today | API | adds the new daily sources, escalation, announcement reminders, purges of resolved rows, `push_deliveries` and `timed_reminders` |
| `email.digest` (changed) | as today | API | also queues the morning pushes |

## Edge cases
1. **Two devices, one user:** both get the push. Reading on one clears it from the other at the next push or when the other opens (rule A14).
2. **Push before install on iPhone:** not possible. The card leads to the guide. A browser tab on iPhone gets in-app toasts only.
3. **The device signs out** (F01B) or its session expires: the subscription goes with the session. A push already queued for it fails as `gone` or is skipped. The device must sign in and turn notifications on again: the browser keeps the permission, so the app re-subscribes silently after sign-in when permission is still granted.
4. **Shared PC (F01B):** user B signs in after user A on the same browser. A's subscription belongs to A's session; B's sign-in creates a new subscription. If A's session is still open, both users' pushes reach that browser; the device list warns about the shared device, as today.
5. **Permission revoked in the phone's settings:** the next push fails, and the subscription is deleted (rule A13). Settings show "blocked".
6. **Payload too large:** body texts are cut to 140 characters and the close list to 20 tags, so a payload stays under 3 KB.
7. **A policy changes to `required` while a user had it off:** later notifications push. The user's override is kept and applies again if the policy goes back to `on` or `off`.
8. **Resolve races:** two managers review the same task at once. The workflow refuses the second change (F06), so only one `resolve` runs. Resolving is idempotent: rows already resolved are untouched.
9. **Notification created and resolved in one transaction** (a manager assigns and starts a task at once): the row is stored resolved. No push or toast is sent for a row resolved before commit.
10. **Snoozed past an escalation:** the escalation still runs. The woken row then shows beside its reminder, both resolving together.
11. **Escalation recipient is the person it waits on** (the GM is also the AM): they are left out of later steps (rule B11).
12. **An archived recipient:** gets nothing new, and their open action rows stay unresolved. `member_archived_open_work` covers the work.
13. **Follower loses access:** stops receiving (rule B12); their follower row stays and applies again if access returns.
14. **Timed reminder for a moved meeting:** the new time is a new key. The old reminder, if already sent, is followed by `meeting_changed`.
15. **The minute job down for an hour:** reminders whose moment passed are skipped. Snoozes and scheduled announcements catch up at the next run.
16. **Audience changes after sending:** recipients are frozen. A new member of a department does not receive an old announcement; an archived recipient stays in the receipts, marked archived.
17. **Scheduled announcement whose audience is empty at send time:** it is not sent and returns to draft. The draft shows "Not sent: nobody in the audience". No notification type is added for it.
18. **Critical announcement for 20 people at once:** 20 rows, one push each. Toasts collapse as F14 rule 16.
19. **Anonymous poll with one voter:** results still show the totals only; the author may infer the voter, which is accepted and noted in the UI hint.
20. **Offline with an expired session:** the cached data shows until the first request is refused, then the cache is erased and the app goes to sign-in.
21. **Old notifications** (before F16) have no resolution history: they are backfilled with priority and box, and stay unresolved until their events next happen or they are read and purged. The first daily run after the deploy runs no escalation for rows created before the deploy.
22. **A user with no push subscription:** push is simply not sent. Email and the app behave as before.

## Open questions
None. Decisions made in this interview (owner, 2026-10-20):
- channel limits per type set by management;
- normal types push by default;
- lock-screen text in full without amounts;
- sessions of 30 days;
- the whole matrix as proposed;
- a three-step escalation by work days;
- automatic and manual followers;
- shared resolution: closed for the actor, "for your information" for the others;
- critical and pinning for management and department managers;
- light rich text;
- offline cache of 7 days without financial data;
- timed reminders (meeting 15 min, shoot 2 h, timed task and post 2 h) and the morning push;
- build order app → engine → catalog → announcements;
- polls configured by the author;
- acknowledgement reminders daily, three times, then the author;
- editing by the author, withdrawing also by management;
- push always, even while the user is active (this changes the "no double alert" line of `v2-scope.md`);
- project and client teams derived automatically;
- shared templates by management, personal ones by everyone.

## Acceptance
- **Owner, in the browser and on phones** (the phone steps after the single F16 deploy; the computer steps in the local checkout as each part is merged):
  1. **A:** On an Android phone, install the app from Chrome; it opens without a browser bar with the Vertex icon. Turn notifications on. From a PC, assign a task to that user: the phone shows the push with the screen locked. The icon shows the unread count. Tap the push: the task opens. Read it on the PC: the push leaves the phone at the next push or opening.
  2. **A:** On an iPhone (iOS 16.4+), follow `/install`, add to the home screen, turn notifications on, and repeat step 1.
  3. **A:** Turn off the Wi-Fi: the app opens with the last data and the offline banner; invoices show "Not available offline".
  4. **A:** In My account, sign out the phone from the PC: the next assignment does not reach the phone.
  5. **B:** As the GM, set `task_commented` push to "required" in the policy. As an employee, the push switch for it is locked on. Snooze a review request for 1 hour; it returns with a push after the hour.
  6. **B:** Submit a task for review: both managers and the AM see it in "Needs you". One manager approves it: it moves to Done for them, and to "For your information" with "Handled by …" for the others. Leave a review request one, two and four work days (set the date with `notifications:run-daily --date`): the reminder, the manager step and the GM and Ops step arrive.
  7. **C:** Record a partial payment, let a quote reach 3 days before expiry, complete a milestone, publish a post, and open an approval link as the client: each recipient in the matrix gets its notification.
  8. **D:** As an employee, send an announcement to the Design department with a poll and acknowledgement: the count and names show before sending; recipients vote and acknowledge; the author sees the receipts. As a department manager, try critical for another department: refused. As the GM, send a critical announcement to everyone, pinned for a week: it opens as a blocking dialog and shows on the home page; non-acknowledgers get reminders on three work days, then the GM gets the summary.
- **Tests:**
  - API, for each endpoint: success, 401, 403, out of scope. For example: critical announcement for a foreign department, policy without permission, someone else's notification 404.
  - Unit:
    - effective channel, rule B3;
    - resolve outcomes and inbox derivation;
    - escalation steps and recipients;
    - followers;
    - timed windows;
    - audience resolution for every source;
    - first-match order of the new types;
    - push payload size and no amounts;
    - body schema sanitizing.
  - Worker: push sending against a fake push service (201, 404, 410, 500 retries), VAPID signing, and the `log` transport.
  - E2E, with RTL screenshots at desktop and phone width:
    - install card and guide;
    - settings with the three channels;
    - bell inboxes and snooze;
    - policy page;
    - follow button;
    - announcement editor, page, receipts, poll, home pin and critical dialog;
    - the offline banner (Playwright offline mode);
    - service worker registration and a push delivered through the `log` transport, displayed via the service worker in Chromium.
- **Delivery** (owner, 2026-10-20: in this order). F16 is deployed to production once, after every part (A–D) is merged, not part by part (owner, 2026-10-20). The drop of `notification_settings.email_types` follows in the first release after that deploy:
  - **A1:** contracts, db, API and worker (push, sessions, priorities in the catalog, push switches).
  - **A2:** the web (manifest, service worker, icons, install, offline, badge, device rows, settings column) and E2E.
  - **B1, B2:** the engine, API then web.
  - **C1, C2:** the catalog, per module. API in one or two PRs, then the web texts and links.
  - **D1, D2:** announcements and audiences, API then web.
