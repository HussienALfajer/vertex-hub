# F14 — Notifications (in-app)

Status: Approved · Date: 2026-09-29 · Scope: `docs/product/v1-scope.md` §F14, automations A03, A07, A08 (and the in-app side of A06) · ADRs: 0008, 0013, 0014, 0015, 0016, 0017, 0018

## Summary
Work is assigned, reviewed and discussed in the system now, but nobody learns about it unless they open the right page, so the team keeps pinging each other on WhatsApp. F14 adds in-app notifications: a bell with an unread count in the app shell, a live push (Server-Sent Events) with a short toast when something arrives, a full notifications page, and per-user settings to mute the types that do not require action. It delivers the events F02, F05, F06 and F07 already name, plus the reminders of A03 (dependent task opened), A07 (due on the next work day) and A08 (overdue, then escalated to the department managers), and a retainer renewal reminder, from one daily job at 09:00 Damascus time on work days. Email and the daily morning digest come later in their own spec (Phase 4, after Q5).

## In scope / out of scope
- In:
  - Storing notifications per recipient, with a fixed catalog of types (below); marking read, unread, all read.
  - Bell and dropdown in the app shell, `/notifications` page, toast on arrival, live updates over SSE with polling fallback on reconnect and window focus.
  - Per-user mute settings for mutable types; action-required types cannot be muted.
  - Delivering the events of F02 (new account manager), F05 (new project manager, renewal due), F06 (every event in its "Notification events" list) and F07 (one summary per assignee and per department for a template run), plus: comment on my task, my request finished, review result, changes to my task, ready for the client.
  - A03 (task opened), A07 (due on the next work day), A08 (overdue, escalation after one work day) and retainer renewal reminders, from the daily `notifications.daily` job.
  - Purging read notifications 90 days after they were read.
- Out (later or never):
  - Email notifications and the daily morning digest (today's and overdue tasks): Phase 4, own spec, needs Q5 (email provider).
  - Client response through an approval link (A05) and the 48 h approval reminder (A04): F09 adds their types. Until then the account manager records the client's response by hand, and the events below cover it.
  - Invoice paid, invoice overdue (A10), ad budget low (A11), lead follow-up (A12), retainer behind (A09): added with F13, F12, F03 and Phase 2; each adds its type to the catalog.
  - WhatsApp notifications (first V2 item), browser/OS push notifications, sound, mobile push.
  - Watching or following arbitrary tasks; notification rules configured by users; per-type delivery channels (arrives with email).

## Roles and access
Notifications are personal. There is no new permission: every signed-in, non-archived user reads and manages only their own notifications and settings (routes use the session guard, `RequireSession`, and filter by the caller's id). Nothing in a notification grants access: its link opens the record under the record's own permissions (every user reads every task, client, project and retainer today, so links always open).

| Action | Permission | Roles and scope |
|---|---|---|
| List, count, read, mark read/unread, stream own notifications | session | every active user, own notifications only |
| Read and change own mute settings | session | every active user, own settings only |

## Notification types
The catalog lives in `packages/contracts/src/notifications.ts` (`NOTIFICATION_TYPES`, each with its category and whether it can be muted). "Action required" types cannot be muted (owner decision). The actor of a change is never notified of their own change. Archived users are never notified.

| Type | Event (source) | Recipients | Mutable |
|---|---|---|---|
| `task_assigned` | A task is assigned or reassigned to a user, on create or update (F06) | the new assignee | no |
| `task_requested` | A task without assignee is created in a department, or moved to a department without an assignee (F06) | managers of that department | no |
| `tasks_generated` | A template run (F07) creates tasks: one notification per assignee with the count assigned to them, and one per department for the tasks left unassigned, sent to its managers, instead of per-task `task_assigned` / `task_requested` | each assignee; managers of each department with unassigned tasks | no |
| `task_review_requested` | A task moves to `internal_review` (F06) | managers of the task's department and the client's account manager | no |
| `task_returned` | A task moves to `revisions` from internal review or from a recorded client response (F06) | the assignee | no |
| `task_approved` | A task passes internal review (to `awaiting_client` or `approved`), or the client's approval is recorded (F06) | the assignee | yes |
| `task_awaiting_client` | A task moves to `awaiting_client` (F06): ready to send to the client | the client's account manager | no |
| `task_over_limit` | A client revision is recorded over the revision limit (F06 rule 10, A06) | the client's account manager | no |
| `task_opened` | A task stops being blocked because its last open dependency became `approved` or `delivered` (F06 rule 5, A03) | the assignee, or the department's managers when unassigned | yes |
| `task_mentioned` | A comment is created, or edited to add a mention, naming the user (F06 rule 16); only newly added mentions count | the mentioned users | yes |
| `task_commented` | A comment is created on a task (F06) | the assignee, unless they wrote it or are mentioned in it | yes |
| `task_changed` | On a task: the due date or time changes, the task is cancelled or archived, or it is taken away from its assignee (reassigned, moved to a department they are not in) (F06) | the assignee (the previous one when taken away) | yes |
| `request_finished` | A task created by a user who is not its assignee is `delivered` or cancelled (F06) | its creator | yes |
| `task_due_soon` | A07: daily job, the task is due on the next work day (rule 9) | the assignee | yes |
| `task_overdue` | A08: daily job, the task became overdue (rule 10) | the assignee; the department's managers when unassigned | no |
| `task_overdue_escalated` | A08: daily job, still overdue one work day after `task_overdue` (rule 11) | managers of the task's department | no |
| `client_account_manager_assigned` | A client is created with, or changed to, a primary account manager (F02) | the new account manager | no |
| `project_manager_assigned` | A project is created with, or changed to, a project manager (F05) | the new project manager | no |
| `retainer_renewal_due` | Daily job, 30 days before a retainer's renewal date, and again on the date (rule 12) (F05 R6) | the client's account manager | yes |

One change may match several types for one recipient; they get only the first match in this order: `task_assigned`, `task_mentioned`, `task_returned`, `task_review_requested`, `task_awaiting_client`, `task_over_limit`, `task_changed`, `task_commented`, the rest. Example: an @mention of the assignee in a comment on their task is one `task_mentioned`.

## Data
New module `notifications` (`apps/api/src/modules/notifications`), tables in `packages/db/src/schema/notifications.ts`. Notifications are not business records: they are never archived, are purged after reading (rule 13) and write no audit entries; they are listed as exceptions, with this reason, in `packages/db/src/conventions.test.ts`.

### `notifications`
| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key (`id()`) |
| `recipient_id` | uuid → `users.id` | required |
| `type` | enum `notification_type` | required, from the catalog |
| `actor_id` | uuid → `users.id` | optional; null for the daily job and automatic runs |
| `subject_type` | enum `notification_subject` (`task`, `client`, `project`, `retainer`, `template_run`) | required |
| `subject_id` | uuid | required; the record the notification opens |
| `data` | jsonb | required; a display snapshot validated by the type's Zod schema in contracts (e.g. task title, client name, department, old and new due date, count, template name, days to renewal, comment excerpt ≤ 140 chars) |
| `count` | integer | required, default 1, ≥ 1; see rule 5 |
| `read_at` | timestamptz | optional; null = unread |
| `created_at`, `updated_at` | timestamptz | `timestamps()`; `updated_at` moves when a notification is merged (rule 5) |

Indexes: `(recipient_id, updated_at desc)`; partial `(recipient_id) where read_at is null` for the unread count; `(read_at)` for the purge.

The text is not stored: the web app renders each type from `type` + `data` with i18next (Arabic first). The snapshot keeps the text stable if the record changes or is archived.

### `notification_settings`
| Field | Type | Constraints |
|---|---|---|
| `user_id` | uuid → `users.id` | primary key |
| `muted_types` | `notification_type[]` | required, default empty; only mutable types |
| `updated_at` | timestamptz | |

A user without a row has nothing muted.

### `notification_reminders`
Idempotency of the daily job: one row per reminder sent, never purged (small: one row per task per due date per kind).

| Field | Type | Constraints |
|---|---|---|
| `kind` | enum (`due_soon`, `overdue`, `overdue_escalated`, `renewal_due`, `renewal_reached`) | required |
| `subject_id` | uuid | required (task or retainer) |
| `occurrence` | date | required; the task's due date or the retainer's renewal date the reminder was for |
| `sent_on` | date | required; the work day the job sent it |

Unique `(kind, subject_id, occurrence)`.

## States and rules
A notification is **unread** or **read**; the recipient moves it both ways.

1. **Emitting.** A module that owns the change calls `NotificationCenter.notify(tx, { type, recipients, actorId, subject, data })` (exported from `notifications/index.ts`) inside the transaction of the change, with the recipients it resolved. Notifications commit or roll back with the change. `notifications` never reads other modules' tables; `tasks`, `clients` and `projects` import it, never the reverse.
2. **Filtering.** `notify` drops the actor, archived users, duplicate recipients, and recipients who muted the type. When one change produces several types for one recipient, the caller passes them in one call and only the first by the order above is kept.
3. **Muting.** A muted type is not stored at all (no count, no toast, not on the page). Unmuting affects only later events. The settings endpoint refuses non-mutable types (`NOT_MUTABLE`).
4. **Live push.** After commit, PostgreSQL delivers a `pg_notify('notifications', <recipient ids>)` sent inside the same transaction; the API's single listener pushes a `notification` event to that user's open streams (ADR 0018). If no stream is open, the notification waits for the next list or count request.
5. **Merging.** A new `task_commented` for a recipient who already has an unread `task_commented` on the same task updates that one instead: `count + 1`, latest author and excerpt in `data`, `updated_at` now (it moves to the top). No other type merges.
6. **Template runs (F07).** A run sends `tasks_generated` only: per assignee the number of tasks assigned to them, per department the unassigned count to its managers. Automatic cycle runs have no actor, so every assignee is notified, including the account manager if they are an assignee.
7. **Task opened (A03).** Sent when a dependency change or a status change leaves a task in `new` with no open dependency (F06 rule 5), not when a manager overrides the block to start it. A task opened by several dependencies finishing in one transaction gets one notification.
8. **Daily job.** `notifications.daily` runs at 09:00 Asia/Damascus on work days (Saturday–Thursday; cron `0 9 * * 0-4,6`), scheduled by `apps/worker` and worked by the API (ADR 0008). It runs every registered daily source (tasks, retainers), then the purge. Each reminder first inserts its `notification_reminders` row (`on conflict do nothing`) and notifies only if the row was inserted, so a retry or a second run sends nothing twice. Notifications from the job have no actor.
9. **Due soon (A07).** On work day D, every open, non-archived, assigned task whose due date falls after D and on or before the next work day after D (so on Thursday: Friday and Saturday) gets `task_due_soon`, once per `(task, due date)`. A task created or re-dated after that day's run gets no reminder for that date.
10. **Overdue (A08).** On work day D, every open, non-archived task that is overdue at run time (F06 rule 12) with a due date before D gets `task_overdue`, once per `(task, due date)`: to its assignee, or to its department's managers when unassigned.
11. **Escalation (A08).** On work day D, a task still open and overdue whose `overdue` reminder for the current due date was sent on a work day before D gets `task_overdue_escalated` to its department's managers, once per `(task, due date)`. An unassigned task is not escalated (its managers already got `task_overdue`). Changing the due date starts the cycle again for the new date; overdue notices are not repeated otherwise (owner decision).
12. **Renewal (F05 R6).** On work day D, for each retainer that is not `ended` or archived and has a renewal date R: when `R − 30 days ≤ D < R`, `retainer_renewal_due` ("renews in n days") once per `(retainer, R)`; when `R ≤ D`, `retainer_renewal_due` ("renewal date reached") once per `(retainer, R)` (kind `renewal_reached`). Changing R starts again. The recipient is the client's primary account manager.
13. **Retention.** The daily job deletes notifications read more than 90 days ago (owner decision). Unread ones stay. Marking one unread again keeps it.
14. **Recipients by role** use the state at the moment of the change: managers of a department are its current managers (all of them); the client's account manager is the current primary account manager; a task without a client has no account manager recipient.
15. **Display.** The bell shows the unread count (`99+` above 99). A notification opens its subject: a task, client, project or retainer page, or for `tasks_generated` the filtered task list (the run's tasks for that assignee or the department's unassigned queue). Opening it marks it read.
16. **Toasts.** Each `notification` event shows a toast with the rendered text and an "Open" action, for 6 seconds. When more than 3 arrive within 2 seconds (a template run, the daily job), one toast says "n new notifications" and opens the bell. No toast while the notifications page is in front; the list updates instead.

### Changes to earlier features
- **F02** `clients` service: emits `client_account_manager_assigned` on create and on a primary account manager change.
- **F05** `projects` service: emits `project_manager_assigned` on create and on a project manager change; registers the retainer renewal source of the daily job.
- **F06** `tasks` services: emit the task types above at the places F06's "Notification events" names and at the new events (comment, request finished, review result, task changed, awaiting client); register the A07/A08 source of the daily job.
- **F07** runs: emit `tasks_generated` and suppress the per-task `task_assigned` / `task_requested` for tasks they create.
- **App shell** (`apps/web`): bell in the header, before the user menu.
- **Deploy:** the nginx site gets a location for the stream with buffering off (ADR 0018); shipped with the Phase 1 production deploy.

## API
All routes use the session guard; each acts only on the caller's own rows (another user's id answers 404).

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/me/notifications` | session | `notificationListQuerySchema`: `page`, `pageSize` (default 20), `unread` (boolean), `category` (`tasks`, `reminders`, `clients_projects`) | `notificationPageSchema`: id, type, actor (id, name), subject (type, id), data, count, read, createdAt, updatedAt; newest `updated_at` first | — |
| `GET /api/me/notifications/unread-count` | session | — | `{ count }` | — |
| `POST /api/me/notifications/:id/read` | session | — | 204 | 404 |
| `POST /api/me/notifications/:id/unread` | session | — | 204 | 404 |
| `POST /api/me/notifications/read-all` | session | — | `{ updated }` | — |
| `GET /api/me/notifications/stream` | session | — | `text/event-stream`: `notification` events (`{ notification, unreadCount }`), a `: ping` comment every 25 s; the server closes the stream after 15 minutes so the client reconnects and the session is checked again | 401 |
| `GET /api/me/notification-settings` | session | — | `notificationSettingsSchema`: every type with `category`, `mutable`, `muted` | — |
| `PUT /api/me/notification-settings` | session | `updateNotificationSettingsSchema`: `mutedTypes[]` | `notificationSettingsSchema` | `NOT_MUTABLE` |

## Screens
1. **Bell** (app shell header, every page) — icon with the unread count badge. Opens a dropdown with the 10 newest notifications: actor avatar or a system icon for the daily job, rendered text, subject line (client, project), relative time, unread dot; clicking one opens its subject and marks it read. Actions: "Mark all as read", "View all" (`/notifications`), settings icon. Loading: skeleton rows. Empty: "No notifications yet". Error: inline message with retry; the count badge hides on error.
2. **Notifications page** `/notifications` — the same rows, paged (20), with filters: All / Unread, and category (Tasks, Reminders, Clients and projects). Per row: open, mark read/unread. "Mark all as read". Empty per filter ("No unread notifications"). Link to settings.
3. **Notification settings** `/notifications/settings` — types grouped by category, each with a switch "Notify me"; action-required types show a locked, on switch with the hint "Always on: requires action". Saves on change with a toast; error restores the switch.
4. **Toast** — rule 16. Uses the design system toast component.

The stream client lives once in the shell: on `notification` it updates the count and the bell's list in the TanStack Query cache and shows the toast; on reconnect (EventSource retries on its own) and on window focus it refetches the count and the first page. Everything is RTL with logical CSS; all strings through i18next. Every role sees the same screens with their own notifications.

## Audit, notifications and jobs
- Audit: none. Notifications and mute settings are personal and not business records; the business changes that cause them are already audited by their modules.
- Notifications: this feature (catalog above).
- Jobs: `notifications.daily` (`packages/contracts/src/jobs.ts`: queue `notifications.daily`, cron `0 9 * * 0-4,6`, tz `Asia/Damascus`), scheduled by `apps/worker`, worked by the API's `notifications` module, which runs the daily sources registered by `tasks` (A07, A08 and escalation) and `projects` (renewal), then the purge. Idempotent through `notification_reminders` (rule 8).

## Edge cases
1. **First run after launch:** every task already overdue gets one `task_overdue` on the first run and is escalated on the next work day. Accepted: it is the backlog the managers need to see.
2. **Job missed a day** (server down): the next run catches up, since rules 9–12 look at state, not at yesterday. A due-soon reminder whose due date has already passed is skipped; the task goes to overdue instead.
3. **Friday or a non-work-day due date:** reminded on Thursday (rule 9); overdue on Saturday.
4. **Task finished or cancelled before the job runs:** no reminder. Finished after `task_overdue`: no escalation.
5. **Reassigned after `task_overdue`:** the escalation still goes to the managers; the new assignee got `task_assigned`, not a new overdue notice for the same due date.
6. **The actor is the recipient** (a manager assigns a task to themselves, the account manager records a client revision over the limit): no notification; the page they are on shows the state.
7. **Recipient archived later:** their notifications stay until purged or the user is restored; they receive nothing while archived. Their open streams end at the next session check (≤ 15 minutes).
8. **Subject archived later:** the notification still opens it; the page shows it archived. Snapshot text is unchanged.
9. **Muted type unmuted later:** earlier events are not recreated.
10. **Mark read in two tabs at once:** idempotent; both succeed.
11. **Many notifications at once** (a template run of 40 tasks): one `tasks_generated` per assignee and department; toasts collapse (rule 16).
12. **Comment edited:** only mentions added by the edit notify; the edit itself does not notify the assignee.
13. **Department without a manager:** `task_requested`, unassigned `task_overdue` and escalations have no recipient and are skipped; the unassigned queue and workload view still show them.
14. **API restarts with open streams:** clients reconnect and refetch; nothing is lost because notifications are stored before they are pushed.
15. **Two API processes in the future:** each listens on the channel and pushes to its own streams (ADR 0018); nothing changes today (PM2 runs one instance).

## Open questions
- Q5 (email provider) blocks the email and daily digest spec, not this one.
- None block F14 in-app.

## Acceptance
- Owner check in the browser (two users: a department manager M and an employee E in the same department, and an account manager A):
  1. As A, request work from E's department without an assignee → M sees the bell count rise and a toast within seconds, without reloading.
  2. As M, assign the task to E → E gets a toast "assigned to you"; clicking it opens the task and the count drops.
  3. As A, comment with @E and then comment without a mention → E gets one mention and one comment notification; a third comment merges into "2 new comments".
  4. As E, send the task to internal review → M and A get "review requested". As M, return it for revisions → E gets "returned".
  5. As E, open settings, mute comments; try the locked "assigned" switch (cannot turn off). As A, comment again → E gets nothing.
  6. Set a task due on the next work day and run the daily job by hand (`pnpm --filter @vertex-hub/api notifications:run-daily [--date YYYY-MM-DD]`, a dev script like `user:create` that runs the job's handler as if on that date; refused when `NODE_ENV=production`) → E gets "due tomorrow"; run it again → nothing new. Set a due date in the past, run the job → E gets "overdue"; run it with `--date` set to the next work day → M gets the escalation.
  7. Apply a template to a project with E as a default assignee → E gets one notification with the task count.
  8. Mark all as read; filter Unread → empty state.
- Tests:
  - API: every route: success, 401, another user's notification (404); settings `NOT_MUTABLE`; the stream answers `text/event-stream` and delivers a notification committed after it opened.
  - Emitting (integration, per source): each type reaches exactly its recipients; actor, archived and muted recipients are dropped; the first-match order keeps one type per change; rollback of the business change leaves no notification; comment merging; template run sends one per assignee and department and no per-task assigned.
  - Daily job (integration with a fixed clock): A07 on Thursday covers Friday and Saturday; A08 and escalation timing over a Thursday → Saturday → Sunday sequence; changing the due date restarts; running twice sends once; renewal at 30 days and on the date; purge removes only read notifications older than 90 days.
  - Unit: work-day window of rule 9; first-match order; mutable set.
  - Architecture test: `notifications` does not import `tasks`, `clients` or `projects`.
  - E2E with RTL screenshots: bell with dropdown (unread and empty), notifications page, settings page, a toast.
