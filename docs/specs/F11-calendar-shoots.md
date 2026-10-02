# F11 — Unified calendar and shoots

Status: Approved · Date: 2026-10-01 · Scope: `docs/product/v1-scope.md` §F11 · ADRs: 0013, 0014, 0016, 0017, 0018, 0022

## Summary
Shoots are arranged by phone: the crew learns the time and place in WhatsApp, two shoots get the same photographer, nobody knows which shots the client asked for, and the editing work after a shoot is started late or forgotten. F11 adds the **shoot**: a booking with a date and time, location, type, crew (team members and named freelancers, one lead) and a shot list the crew ticks on the day. Every shoot is tied to one Photography **shoot task** (the one a template already generated, or one created with the booking), so the deliverables counter and the task views keep working; **closing** a shoot delivers that task and creates the follow-up **editing task**. F11 also adds **meetings** (with team attendees and the client's contacts) and one **company calendar** at `/calendar` that shows shoots, meetings and key dates (project and milestone due dates, retainer renewals) to everyone. A person booked twice at overlapping times gets a **conflict warning** that can be overridden.

## In scope / out of scope
- In:
  - Shoots: book (from an existing Photography task or with a new shoot task), edit while scheduled, close, cancel with a reason, reopen a cancelled one, archive and restore.
  - Crew: team members (any department) with a role and one lead; external crew as names with a role, not checked for conflicts.
  - Shot list: ordered items with an optional note, ticked by the crew; closing warns about unticked items.
  - Closing: delivers the shoot task; creates one editing task (on by default unless the shoot task already has dependent tasks).
  - Meetings: create, edit, cancel, archive and restore; team attendees and the client's contacts; place or online link.
  - Conflict warnings for team members across scheduled shoots and meetings; saving needs an explicit acknowledgement.
  - Company calendar: month and week views of shoots, meetings and key dates, with filters; an agenda list on phones.
  - Notifications: booked or invited, changed, removed or cancelled; the reminder on the work day before; a shoot not closed after its day.
  - Task page: the Shoot panel on a shoot task and "Book shoot" on open Photography tasks.
- Out (later or never):
  - Equipment inventory and Google Calendar sync (v1-scope).
  - Client confirmation of a shoot, tentative bookings, recurring meetings, an hourly time grid, drag and drop on the calendar (owner choices or simplest reading).
  - Conflict checks for external crew, tasks or posts; travel time between bookings.
  - Meeting minutes: the F02 communication log (`channel: meeting`) stays the place for what was said.
  - Tasks and posts on the company calendar: they keep their own views (owner decision).
  - Invoice due dates on the calendar: F13 adds them as a key date kind.
  - Sending anything to the client or the crew outside the app (email: Q5, Phase 4; WhatsApp: V2).

## Roles and access

### Permission map changes (`packages/contracts/src/permissions.ts`)
- `shoots.read` is renamed **`calendar.read`** and becomes `all` for Employee only: every active user sees every shoot, meeting and key date (owner decision). The now redundant grants of Department Manager and Account Manager are removed.
- `shoots.manage` (book, edit, close, cancel, reopen shoots): Account Manager `own_clients`; new department capabilities: Photography **member** `all` (the Photography manager holds it as a member) and Internal Operations **manager** `all`; General Manager through `everything` (owner decision). The Department Manager role grant (`department`) is removed: shoots belong to Photography, not to a department scope.
- New permission **`meetings.manage`** (edit, cancel meetings): Employee `assigned` (the meeting's organizer), Account Manager `own_clients`, Internal Operations **manager** `all`; General Manager through `everything`. Every active user may create a meeting (owner decision).

### Scopes
- `own_clients` on a shoot or meeting: its client has the user as primary account manager. A shoot or meeting without a client is covered only by `all`.
- `assigned` on a meeting: the user is its organizer.
- **Shoot scope:** `shoots.manage` covering the shoot. **Meeting scope:** `meetings.manage` covering the meeting.
- **Crew** and **lead** are not permissions: being on a shoot's team crew lets a user tick shots; being its lead also lets them close it.

### F11 actions
| Action | Permission | Roles and scope |
|---|---|---|
| See the calendar, shoots, meetings and key dates | `calendar.read` | Every active user: all |
| Book a shoot for a client; edit it, its crew and shot list while scheduled | `shoots.manage` | Photography members, General Manager, Operations manager: all · Account Manager: own_clients |
| Book an internal shoot (no client) | `shoots.manage` (scope all) | Photography members, General Manager, Operations manager |
| Tick and untick shots | `calendar.read` + crew, or shoot scope | team crew of the shoot; shoot scope |
| Close a shoot (and create the editing task) | `shoots.manage`, or lead | shoot scope · the shoot's lead |
| Cancel with a reason; reopen a cancelled shoot | `shoots.manage` | shoot scope |
| Archive and restore a shoot; see archived ones | `shoots.manage` (scope all) | General Manager, Operations manager, Photography members |
| Create a meeting (with or without a client) | `meetings.manage` | Every active user (they become its organizer) |
| Edit or cancel a meeting | `meetings.manage` | the organizer · Account Manager: own_clients · General Manager, Operations manager: all |
| Archive and restore a meeting; see archived ones | `meetings.manage` (scope all) | General Manager, Operations manager |

"Operations manager" means the manager of Internal Operations, as in F01–F14. The UI hides actions the user cannot take; the API enforces every row.

## Data

Module ownership: a new **`calendar`** module (replacing the planned `shoots` module in `docs/architecture.md`) owns every table below and the calendar read model. It imports `tasks` (new exported service `ShootTasks`: bookable tasks, create a shoot task, set its due date, deliver it, create the editing task, list dependents), `clients` (`ClientDirectory`: clients and contacts), `projects` (`EngagementDirectory`, extended with key dates in a range and the engagement summary of a task's links), `auth` (`UserDirectory`; registers into `ResponsibilityRegistry`) and `notifications` (`NotificationCenter`; registers two daily sources). `tasks` never imports `calendar`: it exports a `TaskGuards` registry that `calendar` registers into, asked before a task is cancelled, archived or moved out of Photography (rule 9). The architecture test forbids `tasks`, `clients`, `projects` and `auth` from importing `calendar`.

Times are `timestamptz`, entered and shown in Asia/Damascus. "The shoot's day" is the Damascus date of `starts_at`. Work days are Saturday to Thursday (`WORK_WEEK`, ADR 0016).

### `shoots` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `title` | text | required, trimmed, 1–160 chars |
| `type` | enum `shoot_type` (`product`, `video`, `event`, `people`, `other`) | required (owner decision) |
| `client_id` | uuid → `clients.id` | optional (internal agency shoots have none), indexed; never changes after booking; must equal the shoot task's client |
| `task_id` | uuid → `tasks.id` | required, indexed: the shoot task (rule 4). Partial unique index: one non-archived, non-cancelled shoot per task |
| `starts_at`, `ends_at` | timestamptz | required; `ends_at > starts_at`, at most 72 hours apart (check constraint); index on `(starts_at)` |
| `location` | text | required, 1–300 chars (studio, address, venue) |
| `map_url` | text | optional, http(s) URL ≤ 2048 |
| `brief` | text | optional, ≤ 2000 chars, plain text: what the client wants, references, wardrobe, props |
| `external_crew` | jsonb | `{ name, role, phone? }[]`, at most 10; name 1–80 chars, `role` a `crew_role`, phone normalized like F01; validated by the contract schema |
| `status` | enum `shoot_status` (`scheduled`, `completed`, `cancelled`) | required, default `scheduled`, indexed |
| `completed_at`, `completed_by_id` | timestamptz, uuid → `users.id` | set on close |
| `close_note` | text | optional, ≤ 2000 chars |
| `raw_files_url` | text | optional, http(s) URL ≤ 2048: where the raw footage is (Drive, Dropbox; F10 external links) |
| `editing_task_id` | uuid → `tasks.id` | set when closing created the editing task |
| `cancelled_at`, `cancel_reason` | timestamptz, text | set on cancel (reason 1–500 chars), cleared on reopen |
| `created_by_id` | uuid → `users.id` | required, from the session: the booker |
| timestamps, `archived_at` | | archived = entered by mistake: hidden from the calendar, conflicts and reminders, read-only, visible to scope-all users only |

### `shoot_crew` (link table; exception in `packages/db/src/conventions.test.ts`: "a crew member is added or removed, never archived")
| Field | Type | Rules |
|---|---|---|
| `shoot_id` | uuid → `shoots.id` | required, part of the primary key |
| `user_id` | uuid → `users.id` | required, part of the primary key, indexed; a non-archived user when added |
| `role` | enum `crew_role` (`photographer`, `videographer`, `assistant`, `director`, `other`) | required |
| `is_lead` | boolean | required; partial unique index: one lead per shoot |
| `created_at` | timestamptz | |

A shoot has 1–10 team crew members, exactly one of them the lead.

### `shoot_shots` (exception: "part of its shoot's shot list; removed with the list edit, never archived")
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `shoot_id` | uuid → `shoots.id` | required, indexed |
| `position` | integer | required, unique with `shoot_id` |
| `text` | text | required, 1–300 chars |
| `note` | text | optional, ≤ 500 chars |
| `done_at`, `done_by_id` | timestamptz, uuid → `users.id` | set when ticked, cleared when unticked |
| `created_at`, `updated_at` | | |

At most 100 shots per shoot.

### `meetings` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `title` | text | required, 1–160 chars |
| `client_id` | uuid → `clients.id` | optional, indexed; changeable while scheduled |
| `starts_at`, `ends_at` | timestamptz | required; `ends_at > starts_at`, at most 12 hours apart; index on `(starts_at)` |
| `location` | text | optional, ≤ 300 chars |
| `online_url` | text | optional, http(s) URL ≤ 2048 |
| `agenda` | text | optional, ≤ 2000 chars |
| `organizer_id` | uuid → `users.id` | required, indexed; default the creator; changeable by meeting scope to another non-archived user |
| `status` | enum `meeting_status` (`scheduled`, `cancelled`) | required, default `scheduled` |
| `cancelled_at`, `cancel_reason` | timestamptz, text | set on cancel (reason optional, ≤ 500) |
| `created_by_id` | uuid → `users.id` | required |
| timestamps, `archived_at` | | as shoots |

### `meeting_attendees` and `meeting_contacts` (link tables, exceptions like `shoot_crew`)
- `meeting_attendees`: `meeting_id`, `user_id` (primary key both; user non-archived when added); 0–20 per meeting; the organizer is implicitly attending and is not listed.
- `meeting_contacts`: `meeting_id`, `contact_id` → `client_contacts.id`; 0–10; every contact must belong to the meeting's client (`UNKNOWN_CONTACT`); changing the client requires dropping contacts of the old client in the same request.

### Changes to `notifications` (F14)
`notification_subject` gains `shoot` and `meeting`; `NOTIFICATION_REMINDER_KINDS` gains `shoot_upcoming`, `shoot_not_closed` and `meeting_upcoming`; the types are listed under "Audit, notifications and jobs".

### Changes to `auth` (F01)
`responsibilitySchema.type` gains `lead_of_scheduled_shoots` and `organizer_of_upcoming_meetings` (one item per shoot or meeting: id, title, start).

## States and rules

### Shoot status
```
(book: shoot scope) ──→ scheduled
scheduled ──edit (shoot scope)──→ scheduled
scheduled ──close (shoot scope or lead; now ≥ starts_at)──→ completed
scheduled ──cancel (shoot scope; reason)──→ cancelled
cancelled ──reopen (shoot scope; rule 13)──→ scheduled
(any) ──archive (scope all)──→ archived ──restore──→ same status
```
`completed` is final. Postponing is an edit of the time while `scheduled` (owner decision).

### Meeting status
```
(create: any user) ──→ scheduled ──cancel (meeting scope)──→ cancelled (final; create a new one to rebook)
(any) ──archive (scope all)──→ archived ──restore──→ same status
```
A meeting has no "done" state: it is past once `ends_at` has passed.

### Booking and the shoot task
1. **Booking.** A shoot is booked either from an existing task (`taskId`) or with a new shoot task (`newTask`), never both (`VALIDATION_FAILED`).
2. **Bookable tasks.** An existing task is bookable when it is in Photography, open (not `delivered` or `cancelled`), not archived, not linked to a post (F08 delivers such a task by publishing its post) and not the task of another non-archived, non-cancelled shoot (`TASK_NOT_BOOKABLE`). The shoot takes the task's client; a booking of a task without a client is an internal shoot (scope all).
3. **New shoot task.** Created through `ShootTasks` in the same transaction: title "Shoot: <shoot title>" (localized at render through the stored title), department Photography, `needs_client_approval` false, client = the shoot's client, and the links the booker picks (project and optional milestone, or retainer cycle and optional cycle line, F06 rules apply: `UNKNOWN_*`, closed cycle refused). The assignee is the lead when the lead is a member of Photography, else none (the department queue). It is created by the system on the booker's behalf (no `tasks.request` scope check on the assignee), with an audit entry and the F06 assignment or request notification.
4. **One task, one active shoot.** The shoot task's due date is kept equal to the shoot's day: set at booking and on every time change (an audited task change by the same actor). Its other fields stay editable on the task page.
5. **Conflicts.** For each team crew member, a **conflict** is another non-archived `scheduled` shoot where they are team crew, or a non-archived `scheduled` meeting they organize or attend, whose `[starts_at, ends_at)` overlaps. Booking, editing the time or crew, and reopening return `409 SCHEDULE_CONFLICT` with the conflicts (user, item kind, id, title, times) unless the request carries `acceptConflicts: true` (owner decision: a warning, never a block). The same rule applies to a meeting's organizer and attendees. External crew and archived users are never checked.
6. **Crew.** 1–10 team crew members with a role and exactly one lead (`LEAD_REQUIRED`), any department; external crew 0–10. Adding someone notifies them; removing someone notifies them (rule in notifications). A crew member archived later stays listed, marked, and leaves conflict checks and reminders.
7. **Shot list.** Saved as a whole list (positions renumbered, kept items keep their ids and ticks) by shoot scope while `scheduled`. Ticking and unticking is open to team crew and shoot scope while `scheduled`, on any day. A `completed` or `cancelled` shoot's list is read-only.
8. **Edits** (title, type, time, location, map link, brief, crew, external crew, shot list) only while `scheduled` (`SHOOT_NOT_SCHEDULED`). The client and the shoot task never change after booking.
9. **Task guards.** While a shoot is `scheduled`, its task cannot be cancelled, archived or moved out of Photography through F06 (`TASK_HAS_SHOOT`): cancel the shoot first. Delivering the task by hand is allowed; closing then leaves it as it is.

### Closing
10. **Close** needs `now ≥ starts_at` (`SHOOT_NOT_STARTED`). It sets `completed`, the closer and time, the optional note and raw files link. The response lists unticked shots; the UI warns before confirming but never blocks (owner decision).
11. **The shoot task is delivered** in the same transaction from any open status, through `ShootTasks` (a system transition recorded in the task's history with the note "Shoot closed"), so the deliverables counter counts it when it sits on a `photo_shoot` line (ADR 0015). An already delivered task is left unchanged.
12. **The editing task.** The close request carries `editingTask: null` or `{ title, department, assigneeId?, dueDate, needsClientApproval }`. The dialog defaults: create it, unless the shoot task already has non-cancelled dependent tasks (a template's "First cut", owner decision); title "Editing: <shoot title>"; department Photography; assignee the lead when they belong to the department, else none; due date the close day plus 3 work days; client approval on. The task gets the shoot task's client and its project and milestone, or its retainer cycle **without a cycle line** (the shoot task counts the `photo_shoot` unit; the template's reel or video tasks count theirs); it depends on the shoot task (already finished, so not blocked); the raw files link is added as one of its F06 links; its brief is the shoot's close note. The assignee may be any team crew member who belongs to the department, or none; anyone else needs assign scope on the new task (`INVALID_ASSIGNEE`, 403). The due date must be today or later. `shoots.editing_task_id` records it.

### Cancel and reopen
13. **Cancel** needs a reason; the shoot stays on the calendar, dimmed, and leaves conflicts and reminders. The shoot task stays open and becomes bookable again (rebooking is common); the dialog offers "Also cancel the shoot task" (off by default), which cancels it through F06 with the same reason. **Reopen** returns the shoot to `scheduled` only while its task is still bookable (`TASK_NOT_BOOKABLE`: book a new shoot instead) and runs the conflict check; the task's due date follows the shoot again.

### Meetings
14. Any active user creates a meeting and becomes its organizer; the client, when given, is not archived (`CLIENT_ARCHIVED`). A new organizer is a non-archived user who is not listed as an attendee (`INVALID_ATTENDEE`). Editing (title, client, time, place, link, agenda, organizer, attendees, contacts) and cancelling need meeting scope, only while `scheduled` and not archived (`MEETING_NOT_SCHEDULED`). Conflicts as rule 5.

### Company calendar
15. `GET /api/calendar` returns, for a range of at most 45 days: shoots and meetings overlapping the range (cancelled ones included, flagged), and **key dates** in the range: project due dates (project in an open status), milestone due dates (milestone `pending`, project open), retainer renewal dates (retainer `active` or `paused`). Archived records never appear. Filters: `kinds[]` (`shoot`, `meeting`, `project_due`, `milestone_due`, `renewal`), `clientId`, `userId` (`me` or a user id: shoots where they are team crew, meetings they organize or attend, key dates of projects they manage or clients they are account manager of), `shootType` (narrows the shoots only). Key dates of an archived client stay, with the client marked archived. Each shoot and meeting carries a `conflict` flag when any of its people has a conflict (rule 5).
16. Every user sees everything on the calendar with its details (owner decision).

## API
Schemas live in a new `packages/contracts/src/calendar.ts` (shoots, meetings, calendar, conflicts) and extend `notifications.ts`, `permissions.ts` and `auth` responsibility schemas, reusing the shared list and error schemas.

### Calendar (`calendar` module)
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/calendar` | `calendar.read` | `calendarQuerySchema`: `from`, `to` (≤ 45 days), `kinds[]`, `clientId`, `userId`, `shootType` | `calendarSchema`: `shoots[]` (id, title, type, status, client, starts/ends, location, lead, crew count, conflict), `meetings[]` (id, title, status, client, starts/ends, organizer, attendee count, conflict), `keyDates[]` (kind, date, title, link target id, client); not paged | — |
| `GET /api/calendar/conflicts` | `calendar.read` | `conflictQuerySchema`: `userIds[]` (≤ 30), `startsAt`, `endsAt`, `excludeShootId`, `excludeMeetingId` | `conflictListSchema` | — |
| `GET /api/shoots` | `calendar.read` | `shootListQuerySchema`: `status`, `from`, `to`, `clientId`, `userId`, `taskId`, `q`, `archived` (scope all), page, pageSize | `shootPageSchema` | — |
| `GET /api/shoots/:id` | `calendar.read` | — | `shootDetailSchema`: fields, client, crew with users, external crew, shots, shoot task and editing task summaries, `can` flags | 404 (archived without scope all) |
| `POST /api/shoots` | `shoots.manage` | `createShootSchema`: fields, `crew[]`, `externalCrew[]`, `shots[]`, `taskId` or `newTask` (links), `acceptConflicts` | `shootDetailSchema` | 403, `TASK_NOT_BOOKABLE`, `LEAD_REQUIRED`, `INVALID_CREW` (archived user), `SCHEDULE_CONFLICT`, `LIMIT_REACHED`, F06 link errors |
| `PATCH /api/shoots/:id` | `shoots.manage` | `updateShootSchema` (all fields optional, incl. crew), `acceptConflicts` | `shootDetailSchema` | `SHOOT_NOT_SCHEDULED`, `LEAD_REQUIRED`, `INVALID_CREW`, `SCHEDULE_CONFLICT`, `SHOOT_ARCHIVED` |
| `PUT /api/shoots/:id/shots` | `shoots.manage` | `shotListSchema` (items with optional `id`) | `shootDetailSchema` | `SHOOT_NOT_SCHEDULED`, `LIMIT_REACHED` |
| `POST /api/shoots/:id/shots/:shotId/done` | `calendar.read` + crew, or `shoots.manage` | `{ done: boolean }` | the shot | 403, 404, `SHOOT_NOT_SCHEDULED` |
| `POST /api/shoots/:id/close` | `shoots.manage` or lead | `closeShootSchema`: `note`, `rawFilesUrl`, `editingTask` | `shootDetailSchema` | `SHOOT_NOT_SCHEDULED`, `SHOOT_NOT_STARTED`, `INVALID_ASSIGNEE`, `VALIDATION_FAILED` (due date) |
| `POST /api/shoots/:id/cancel` | `shoots.manage` | `{ reason, cancelTask }` | `shootDetailSchema` | `SHOOT_NOT_SCHEDULED` |
| `POST /api/shoots/:id/reopen` | `shoots.manage` | `{ acceptConflicts }` | `shootDetailSchema` | `SHOOT_NOT_CANCELLED`, `TASK_NOT_BOOKABLE`, `SCHEDULE_CONFLICT` |
| `POST /api/shoots/:id/archive`, `/restore` | `shoots.manage` (all) | — | `shootDetailSchema` | `SHOOT_ARCHIVED`, `SHOOT_NOT_ARCHIVED`, `TASK_NOT_BOOKABLE` (restore of a scheduled shoot whose task was booked again) |
| `GET /api/meetings/:id` | `calendar.read` | — | `meetingDetailSchema` | 404 |
| `POST /api/meetings` | `meetings.manage` | `createMeetingSchema`: fields, `attendeeIds[]`, `contactIds[]`, `acceptConflicts` | `meetingDetailSchema` | `UNKNOWN_CONTACT`, `INVALID_ATTENDEE`, `SCHEDULE_CONFLICT`, `LIMIT_REACHED` |
| `PATCH /api/meetings/:id` | `meetings.manage` | `updateMeetingSchema` | `meetingDetailSchema` | `MEETING_NOT_SCHEDULED`, `UNKNOWN_CONTACT`, `INVALID_ATTENDEE`, `SCHEDULE_CONFLICT` |
| `POST /api/meetings/:id/cancel` | `meetings.manage` | `{ reason? }` | `meetingDetailSchema` | `MEETING_NOT_SCHEDULED` |
| `POST /api/meetings/:id/archive`, `/restore` | `meetings.manage` (all) | — | `meetingDetailSchema` | `MEETING_ARCHIVED`, `MEETING_NOT_ARCHIVED` |

`SCHEDULE_CONFLICT` is a 409 whose details carry the conflict list; every other new code follows ADR 0013's error shape.

### Changes to earlier features
- **F06 `tasks`:** exports `ShootTasks` and the `TaskGuards` registry (rule 9); `POST /api/tasks/:id/status` (cancel), archive and `PATCH` (department change) return `TASK_HAS_SHOOT` when a guard refuses. The status history accepts the system "Shoot closed" delivery.
- **F05 `projects`:** `EngagementDirectory` gains key dates in a range (rule 15).
- **F01 `auth`:** the responsibility check lists scheduled shoots the user leads that start in the future and scheduled meetings they organize that start in the future (`USER_HAS_RESPONSIBILITIES`).
- **F14 `notifications`:** new types, subjects and reminder kinds; settings show a "Calendar" category.

## Screens
1. **Calendar** `/calendar` (navigation entry for everyone) — month grid (default) or week view on `CalendarGrid` (`packages/ui`), weeks starting Saturday. Each day lists its key dates first (all-day chips: "Project due", "Milestone due", "Renewal", each opening its project or retainer), then shoots and meetings by start time: time, title, client, type icon (shoots), lead avatar or organizer, a conflict badge, dimmed when cancelled. A day with more than 4 items shows "+n" and opens the day list. Filters in the URL: kinds, client, person ("Mine" shortcut), shoot type. Below 768 px the month becomes an agenda list by day. Actions: "Book shoot" (shoot scope holders), "New meeting" (everyone). Empty: "Nothing scheduled in this period". Error: the shared retry state.
2. **Book or edit a shoot** `/shoots/new` (optional `?taskId=`) and `/shoots/$shootId/edit` — form: title, type, client (fixed when booking from a task; limited to own clients for account managers; "No client" only for scope all), shoot task (an existing bookable task, or "New shoot task" with project/milestone or retainer cycle/line pickers), date, start and end time, location, map link, brief, team crew (user picker, role, lead radio), external crew rows, shot list rows (add, reorder, remove). Conflicts are checked live (`/api/calendar/conflicts`) and listed under the crew field; saving with conflicts asks for confirmation and sends `acceptConflicts`.
3. **Shoot page** `/shoots/$shootId` — header with status, type, client, time and location (map link), brief, crew and external crew (tap-to-call phones), the shot list with large tick targets for phones and a done counter, the shoot task and editing task links, close note and raw files link once closed, cancel reason when cancelled, and actions by permission: Edit, Close, Cancel, Reopen, Archive/Restore; audit link for `audit.read`.
4. **Close dialog** — unticked shots warning, note, raw files link, "Create editing task" switch with its fields (defaults rule 12; switched off with a hint when the shoot task has dependent tasks).
5. **Cancel dialog** — reason, "Also cancel the shoot task".
6. **Meeting dialog** (create and edit) — title, client, date and times, location, online link, agenda, organizer (meeting scope), attendees (users), client contacts (after a client is picked), live conflicts as screen 2. **Meeting page** `/meetings/$meetingId` — details, attendees, contacts with phones, online link button, Edit and Cancel by permission.
7. **Task page (F06)** — a Shoot panel on a task that has a shoot (status, time, location, lead, link to the shoot page); "Book shoot" on open Photography tasks without an active shoot, for shoot scope holders.
8. **Notifications (F14)** — render the new types; a "Calendar" group in settings.

Every screen: Arabic RTL, logical CSS, strings through i18next, design-system components only; loading skeletons and the shared error state.

## Audit, notifications and jobs
- **Audit** (same transaction): `shoot.created`, `shoot.updated` (changed fields, crew and external crew as before/after), `shoot.shots_changed`, `shoot.shot_ticked` / `shoot.shot_unticked`, `shoot.completed`, `shoot.cancelled`, `shoot.reopened`, `shoot.archived`, `shoot.restored`; `meeting.created`, `meeting.updated`, `meeting.cancelled`, `meeting.archived`, `meeting.restored`. Task changes made through `ShootTasks` write F06's task audit entries. Conflicts accepted on save are recorded in the entry's `after` (`acceptedConflicts`).
- **Notifications** (F14; the actor is never notified of their own action):

| Type | When | To | Mutable |
|---|---|---|---|
| `shoot_booked` | Booked, reopened, or added to the crew later | the team crew added | yes |
| `shoot_changed` | Time, location or lead changed while scheduled | the team crew | yes |
| `shoot_dropped` | Shoot cancelled, or removed from the crew | the crew affected (`cause`: `cancelled` or `removed`) | yes |
| `shoot_upcoming` | Daily job: the last work day before the shoot's day | the team crew | yes |
| `shoot_not_closed` | Daily job: the first work day after the shoot's end day, still scheduled | the lead and the booker | no |
| `meeting_invited` | Created, or added as attendee or organizer later | attendees and the organizer | yes |
| `meeting_changed` | Time, place or link changed | organizer and attendees | yes |
| `meeting_dropped` | Cancelled, or removed | those affected | yes |
| `meeting_upcoming` | Daily job: the last work day before the meeting's day | organizer and attendees | yes |

  Booking and closing also emit the F06 events of the tasks they create or assign (`task_assigned`, `task_requested`).
- **Jobs:** `calendar` registers its daily sources into `notifications.daily` (09:00 Damascus, work days): upcoming shoots and upcoming meetings (kinds `shoot_upcoming`, `meeting_upcoming`; occurrence = the item's day; one source each, so a failing reminder of one kind does not hold back the other) and shoots not closed (kind `shoot_not_closed`; occurrence = the end day; sent by the first run on a work day after it). Archived users get no reminder. A shoot whose reminder day has passed when it is booked or moved gets no reminder: the booking or change notice covers it. A shoot moved to a new day is reminded again for that day.

## Edge cases
1. Two people book the same task at once: the partial unique index lets one win; the other gets `TASK_NOT_BOOKABLE`.
2. Two people edit the same shoot: last write wins per request; the shot list is replaced as a whole, so the later list wins, keeping ticks of items it keeps.
3. A shoot crosses midnight: it belongs to the day it starts; the calendar shows it on that day with its end time.
4. A shoot or meeting booked on a Friday: allowed; the reminder goes on Thursday.
5. The shoot task was delivered by hand before closing: closing leaves it delivered; the editing task still depends on it.
6. The shoot task's cycle is closed when the shoot closes: the delivery shows as "delivered after close" (F05 R8); the editing task links to the same cycle without a line.
7. Project of the shoot task completed or cancelled while the shoot is scheduled: F06's cascade cancel is refused for that task by the guard, so the project cancel lists `TASK_HAS_SHOOT`; cancel the shoot first.
8. The lead is archived: refused while they lead a future scheduled shoot (`USER_HAS_RESPONSIBILITIES`); a past, unclosed shoot can be closed by shoot scope.
9. A client is archived (F02) with scheduled shoots or meetings: they stay; the client shows as archived on the calendar.
10. Permissions change mid-session (an account manager loses a client): the API refuses with 403; the UI refreshes `can` flags on the next load.
11. Limits: 10 team crew, 10 external crew, 100 shots, 20 attendees, 10 contacts, 45-day calendar range, 30 users in a conflict query (`LIMIT_REACHED` or `VALIDATION_FAILED`).
12. Closing creates the editing task in a department where the default assignee is not a member: the dialog shows no default; saving with a non-member is `INVALID_ASSIGNEE`.

## Open questions
- None block F11. The owner decided every question of the interview on 2026-10-01 (recorded in ADR 0022).
- Not asked, chosen as the simplest reading and easy to change before implementation: the 72-hour shoot and 12-hour meeting limits; cancelling a shoot keeps its task open (with an opt-in to cancel it); the shoot task due date follows the shoot; the editing task's default of 3 work days; crew roles (`photographer`, `videographer`, `assistant`, `director`, `other`); `calendar.read` replacing `shoots.read`; no `completed` state for meetings.
- Q5 (email provider) still gates email reminders (Phase 4).

## Acceptance
- Owner check in the browser (photographer P and videographer V of Photography, the Photography manager PM, the client's account manager A, a designer D; a client C with an active retainer whose cycle has a `photo_shoot` line of 1 and its generated "Photo shoot" task; a project with the "Promotional reel" template applied):
  1. As A, open the retainer's "Photo shoot" task and press "Book shoot": fill type product, tomorrow 10:00–13:00, location, crew P (lead, photographer) and V (videographer), a freelancer, and five shots. P and V get `shoot_booked`; the shoot shows on `/calendar` in month and week views and on the task's Shoot panel; the task's due date is tomorrow.
  2. As PM, create a meeting tomorrow 12:00–13:00 with V as attendee and a contact of C: the dialog warns that V is booked; confirm. Both items show the conflict badge.
  3. As A, move the shoot to 09:00–11:00: the warning disappears; P and V get `shoot_changed`.
  4. Run the daily job for today's date: P and V get `shoot_upcoming`, V and PM get `meeting_upcoming`.
  5. On a phone width, as P, open the shoot page and tick four shots. Close it: the dialog warns about one unticked shot and proposes the editing task for P in 3 work days; add a raw files link and confirm. The shoot task is delivered, the retainer's `photo_shoot` counter shows 1/1, and the editing task is in P's My tasks with the raw files link.
  6. Book a shoot from the project's "Shoot" step task, then close it after its start: the editing task switch is off because "First cut" depends on that task.
  7. Book a third shoot with a new shoot task and cancel it with a reason: it is dimmed on the calendar; book it again from the same task. As D, the "Book shoot" and "Close" actions are not shown and the API refuses them.
  8. Run the daily job for the day after a scheduled shoot that was never closed: the lead and the booker get `shoot_not_closed` once.
  9. Calendar filters: "Mine" as P shows only P's shoots and meetings; key dates show the project due date and the retainer renewal.
- Tests:
  - API (`apps/api/test/shoots.test.ts`, `shoot-close.test.ts`, `meetings.test.ts`, `calendar.test.ts`): every endpoint for success, 401, 403 and out of scope (an account manager on another manager's client, an employee booking, a non-crew user ticking, a non-lead employee closing, a non-organizer editing a meeting); each error code; rules 1–16; the guards on F06 cancel, archive and department change; the responsibility check; audit entries in the same transaction; notifications and the two daily sources (idempotent on a second run).
  - Unit: conflict overlap (`[start, end)` boundaries), the reminder day (last work day before, Friday skipped), the editing task defaults (work days, the dependents rule).
  - E2E with RTL screenshots: calendar month, week and phone agenda; booking with a conflict warning; the shoot page shot list at phone width; the close dialog; the meeting dialog.
