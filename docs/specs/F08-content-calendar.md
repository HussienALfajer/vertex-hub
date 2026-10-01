# F08 — Content calendar

Status: Approved · Date: 2026-10-01 · Scope: `docs/product/v1-scope.md` §F08 (builds on A04, A05, A13) · ADRs: 0007, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021

## Summary
The monthly content of each client is planned in spreadsheets and WhatsApp: nobody sees what is published when, which design belongs to which post, or whether the client approved the caption that went out. F08 adds the **post** as the unit of content: type, platforms, caption and hashtags, publish date and time, media, a responsible person and a status from idea to published, shown on a monthly and weekly calendar per client and across all clients. Production stays in tasks: a post links to the design or video tasks that produce its media (the ones the monthly template already generated, or a new one), and the client approves the **finished post** (caption and media together), one decision per post, with a whole month sent in one F09 approval link. Publishing is done by hand on the platforms and marked in the system; marking a post published delivers its linked tasks, so the retainer deliverables counter counts a unit when it is actually published.

## In scope / out of scope
- In:
  - **Posts:** create, edit, duplicate, move through the statuses, cancel with a reason and reopen (owner decision), archive (entered by mistake) and restore.
  - **One caption per post** with one hashtags field, published on every selected platform and counted as one unit (owner decision). A platform that needs a different text gets its own post ("Duplicate").
  - **Linked tasks** (owner decision): a post links to existing tasks of its client (the monthly template's "Design 4", "Reel 2") or creates a new task in a department's queue; the post's media is the final versions of its linked tasks' deliverables plus files uploaded on the post itself. A linked task is never sent to the client on its own.
  - **Review of the post:** internal review by the Content Management manager or the client's account manager (owner decision), with a snapshot of what was approved; the mandatory **medical stage** for healthcare clients, also when the post needs no client approval (owner decision); withdraw for re-review.
  - **Client approval once, on finished posts** (owner decision): posts are a new item type of F09's approval requests; "Send month for approval" puts every ready post of a month in one link; one decision per post, plus "Approve all" on the client page. A per-post flag "needs client approval", on by default (owner decision). Responses by phone or WhatsApp are recorded by hand, as F09.
  - **Changes requested by the client** return the post to production. Fixing the caption is not counted; sending a linked task back for changes records a client revision on that task, counted against its limit (owner decision, F06 rules 9–10).
  - **After approval** (owner decision): publish date, time and platforms change freely (audited); changing the caption or the media needs "Reopen content", which sends the post through review and client approval again.
  - **Scheduled and published by hand**, with an optional link to the published post per platform (owner decision). `approved → published` directly is allowed.
  - **Counting at publish** (owner decision): publishing delivers the linked tasks; a post without a counted task may count directly on a retainer cycle line. A unit never counts twice.
  - **Responsible person per post** (owner decision), reminded on the publish day and, with the account manager, when the date passes without publishing.
  - Screens: Content page (calendar of all clients, My posts), client Content tab (calendar, send month), post page, new post dialog, link-task dialog; changes to Approvals, the request page, the client page and the task page (owner decision: both the per-client and the all-clients views).
  - Permission map changes (below).
- Out (later or never):
  - Automatic publishing or scheduling through platform APIs; reading reach or engagement from the platforms (v1-scope).
  - A separate approval of the month's plan before production (ideas and captions without media): the owner chose one approval, on finished posts.
  - A caption per platform; a revision counter and limit on the post itself (owner decisions).
  - Undoing "published" (edge case 9); drag and drop between calendar days; recurring posts; post templates; a hashtag library.
  - A reminder that a post is still not approved shortly before its publish date; the monthly client report (F15).
  - Sending anything to the client by the system (email: Q5, Phase 4; WhatsApp: V2).

## Roles and access

### Permission map changes (`packages/contracts/src/permissions.ts`)
- `content.read` becomes `all` for Employee: every active user reads every calendar and post, like tasks (owner decision). The now redundant grants of Department Manager (`department`) and Account Manager (`own_clients`) are removed.
- `content.manage` now means **editing posts**. Grants: Account Manager `own_clients` (stays); new department capabilities: Content Management **member** `all` (owner decision) and Internal Operations **manager** `all`; General Manager through `everything`. The Department Manager role grant (`department`) is removed: posts have no department, and the Content Management manager holds the permission as a member.
- New permission **`content.review`** (internal review of posts, archive and restore): Account Manager `own_clients`; department capabilities: Content Management **manager** `all`, Internal Operations **manager** `all`; General Manager through `everything` (owner decision).
- `approvals.review_medical` is unchanged and also covers posts.

### Scopes on posts
- `own_clients`: the post's client has the user as primary account manager.
- **Edit scope:** `content.manage` covering the post. **Review scope:** `content.review` covering the post. **Client scope** is F09's, unchanged: `tasks.manage` under `all` or `own_clients` on the post's client (General Manager, Operations manager, the client's account manager).

### F08 actions
| Action | Permission | Roles and scope |
|---|---|---|
| See calendars, posts, their media, reviews and responses | `content.read` | Every active user: all |
| Create, edit, duplicate a post; change its date, time, platforms, responsible | `content.manage` | Content Management members, General Manager, Operations manager: all · Account Manager: own_clients |
| Add, version and remove the post's own files | `content.manage` | edit scope |
| Link and unlink tasks; create a linked task in a department's queue | `content.manage` | edit scope (the new task is an F06 request: unassigned) |
| Send a linked task back for changes | `content.manage` | edit scope (rule 12) |
| Start production, submit for review, mark scheduled or published, edit published links | `content.manage` | edit scope |
| Cancel with a reason; reopen a cancelled post; reopen the content of an approved post | `content.manage` | edit scope |
| Internal review: pass or return | `content.review` | Content Management manager, General Manager, Operations manager: all · Account Manager: own_clients |
| Medical review: approve or return | `approvals.review_medical` | Medical Consultation members, General Manager; never the post's responsible person |
| Withdraw a post from the client for re-review | `content.review` | review scope |
| Put posts in an approval request; send a month; record a client response by hand | `tasks.manage` (client scope) | General Manager, Operations manager, the client's account manager (F09) |
| Archive and restore a post; see archived ones | `content.review` (scope all) | General Manager, Operations manager, Content Management manager |
| Open the client page and respond | the link's token | the holder of the link (F09) |

"Operations manager" means the manager of Internal Operations, as in F01–F14. The UI hides actions the user cannot take; the API enforces every row.

## Data

Module ownership: a new `content` module owns `content_posts`, `post_reviews` and `post_client_responses`. It imports `tasks` (new exported service `PostTasks`: linkable tasks, link, unlink, create, return for changes, deliver for a post), `files` (`FileVersions`; registers the `post` owner policy), `clients` (`ClientDirectory`; registers into `ClientFlagHooks`), `projects` (`EngagementDirectory`; registers a second `WorkProgressSource` for cycle lines), `auth` (`UserDirectory`; registers into `ResponsibilityRegistry`) and `notifications` (registers a daily source). `approvals` imports `content` (exported `PostApprovals` service: ready posts, snapshots, recording a response inside the request's transaction) and registers into `content`'s exported `PostReviewHooks`, called when a post leaves `awaiting_client`. `tasks` never imports `content`: it tells `content` about linked tasks through a `PostTaskHooks` registry it exports (a linked task became `approved`, was cancelled or archived). The architecture test forbids `tasks`, `files`, `clients` and `projects` from importing `content`, and `content` from importing `approvals`.

Dates without a time are calendar days in Asia/Damascus; weeks start on Saturday (ADR 0016).

### `content_posts` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed; never changes after creation |
| `title` | text | required, trimmed, 1–160 chars: the idea in a line, internal; the default title the client sees |
| `type` | enum `post_type` (`post`, `reel`, `story`, `carousel`) | required |
| `platforms` | `post_platform[]` | required, 1–8 distinct values of `POST_PLATFORMS` (`CLIENT_PLATFORMS` without `website` and `other`) |
| `caption` | text | optional, ≤ 5000 chars, plain text with line breaks |
| `hashtags` | text | optional, ≤ 1000 chars |
| `notes` | text | optional, ≤ 2000 chars: internal brief for the team, never shown to the client |
| `publish_date` | date | required, indexed with `client_id` (`(client_id, publish_date)`) and alone |
| `publish_time` | time | optional |
| `status` | enum `post_status` (`idea`, `in_production`, `internal_review`, `awaiting_client`, `approved`, `scheduled`, `published`, `cancelled`) | required, default `idea`, indexed |
| `review_stage` | enum `review_stage` (`internal`, `medical`; F09's) | set only in `internal_review` (check constraint) |
| `needs_client_approval` | boolean | required, default true |
| `responsible_id` | uuid → `users.id` | required, indexed; default the creator; a non-archived user whose `content.manage` covers the client (`INVALID_RESPONSIBLE`) |
| `cycle_line_id` | uuid → `retainer_cycle_lines.id` | optional, indexed: the line the post counts on directly (rule 16) |
| `cleared_review_id` | uuid → `post_reviews.id` | the pass that put the post in `awaiting_client` or `approved`; kept afterwards |
| `scheduled_at` | timestamptz | set on `scheduled`, cleared on leaving it backwards |
| `published_at`, `published_by_id` | timestamptz, uuid → `users.id` | set on `published`; `published_at` defaults to now and is editable afterwards (not in the future) |
| `published_links` | jsonb | `{ platform, url }[]`, at most one per platform of the post, URL http(s) ≤ 2048 chars; validated by the contract schema; optional (owner decision) |
| `cancelled_at`, `cancel_reason` | timestamptz, text | set when cancelled (reason 1–500 chars), cleared on reopen |
| `created_by_id` | uuid → `users.id` | required, from the session |
| timestamps, `archived_at` | | archived = entered by mistake: hidden from calendars and counts, read-only, visible to scope-all reviewers only |

### Changes to `tasks` (F06, owned by `tasks`)
| Field | Type | Rules |
|---|---|---|
| `post_id` | uuid → `content_posts.id` | optional, indexed: the post this task produces media for; set and cleared only through `PostTasks`; at most 5 non-archived, non-cancelled tasks per post |

`revision_source` values do not change. `task_revisions` gains `post_response_id` (uuid → `post_client_responses.id`, indexed, optional): the client response on the post that caused a client revision (rule 12), unique per `(task_id, post_response_id)`.

### `post_reviews` (business table, append-only, owned by `content`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `post_id` | uuid → `content_posts.id` | required, indexed |
| `stage` | enum `review_stage` | required |
| `outcome` | enum `review_outcome` (`passed`, `returned`; F09's) | required |
| `note` | text | `returned`: required, 1–2000 chars; `passed`: optional, ≤ 2000 |
| `reviewer_id` | uuid → `users.id` | required, from the session, indexed |
| `version_ids` | uuid[] | `passed`: the media snapshot in display order (rule 5); empty for `returned` |
| `caption`, `hashtags` | text | `passed`: the post's values at the pass |
| `type`, `platforms`, `publish_date`, `publish_time` | as on the post | `passed`: what the client is shown beside the content |
| `created_at`, `updated_at` | | never edited; no `archived_at` (append-only, an exception in `packages/db/src/conventions.test.ts` like `task_reviews`) |

### `post_client_responses` (business table, append-only, owned by `content`)
The fields of F09's `task_client_responses` with `post_id` in place of `task_id` and `review_id` → `post_reviews.id`, without `revision_id`: `decision`, `channel`, `contact_id`, `note` (required for `changes_requested`), `approval_item_id`, `recorded_by_id`, `ip`, `user_agent`. Same exception to `archived_at`.

### Changes to `approval_items` (F09, owned by `approvals`)
- `task_id` becomes optional; new `post_id` (uuid → `content_posts.id`, indexed); exactly one of the two is set (check constraint).
- `review_id` and `response_id` become optional for post items, which use new `post_review_id` (→ `post_reviews.id`) and `post_response_id` (→ `post_client_responses.id`), both indexed; the status check accepts either response column.
- A second partial unique index: at most one `pending` item per post.
- `approval_withdrawn_reason` gains `post_moved`.
- The limit per request rises from 20 to **60 items** (a month of posts), tasks and posts together.

### Changes to `files` (F10)
`file_owner_type` gains `post`; `file_items` gains `post_id` (uuid → `content_posts.id`, indexed) under the same owner check constraint, with `client_id` required. Posts hold only `deliverable` items (versions, uploads or links, no final marker use), at most 10 per post. The `post` owner policy answers: visible to every active user; add, version and remove by edit scope while the post is `idea` or `in_production` (`POST_LOCKED` otherwise); client = the post's client; closed when the post is `published`, `cancelled` or archived; "version locked" for the versions of the current snapshot while the post is in the medical stage or `awaiting_client` (`VERSION_SENT`, as F09 edge case 4). The client library (F10 rule 13) does not list post files.

### Changes to `notifications` (F14)
`notification_subject` gains `post`; `NOTIFICATION_REMINDER_KINDS` gains `post_publish_today` and `post_publish_overdue`; the types are listed under "Audit, notifications and jobs".

## States and rules

### Post status
```
idea ──start production (edit scope; automatic when a task is linked or created)──→ in_production
idea | in_production ──submit for review (edit scope)──→ internal_review (stage internal)
internal_review (internal) ──return (review scope; note)──→ in_production
internal_review (internal) ──pass, healthcare client──→ internal_review (stage medical)
internal_review (internal) ──pass, needs client approval──→ awaiting_client
internal_review (internal) ──pass, no client approval──→ approved
internal_review (medical)  ──medical approve──→ awaiting_client, or approved without client approval
internal_review (medical)  ──medical return (note)──→ in_production
internal_review (any)      ──return by review scope (note)──→ in_production
awaiting_client ──withdraw for re-review (review scope; optional note)──→ internal_review (stage internal)
awaiting_client ──client approved (link, or by hand with client scope)──→ approved
awaiting_client ──client requested changes (note)──→ in_production
approved ──mark scheduled (edit scope)──→ scheduled
scheduled ──unschedule (edit scope)──→ approved
approved | scheduled ──mark published (edit scope)──→ published
approved | scheduled ──reopen content (edit scope; reason)──→ in_production
idea | in_production | internal_review | awaiting_client | approved | scheduled ──cancel (edit scope; reason)──→ cancelled
cancelled ──reopen (edit scope)──→ idea, or in_production when it has linked tasks or media
(any) ──archive (review scope all)──→ archived ──restore──→ same status
```
"Open" means any status except `published` and `cancelled`.

### Posts
1. Only the transitions above are allowed (`INVALID_TRANSITION`), each by the roles in the actions table (403 otherwise). A move needing a note or reason without one is refused by validation.
2. **Client.** A post is created for a non-archived client with status `active` or `paused` (`CLIENT_ARCHIVED`, `CLIENT_ENDED`); a retainer is not required. A post of an archived client is hidden with it and read-only (`POST_ARCHIVED`), like an archived post.
3. **Editing.** `caption`, `hashtags`, `type`, the post's own files and its linked tasks change only in `idea` and `in_production` (`POST_LOCKED`). `title`, `notes`, `publish_date`, `publish_time`, `platforms`, `responsible_id`, `needs_client_approval` and `cycle_line_id` change in any open status (owner decision: the date, time and platforms are free after approval); `needs_client_approval` cannot be turned off in the medical stage or `awaiting_client` (`INVALID_TRANSITION`). On a published post only `published_at` and `published_links` change. A publish date in the past is allowed when editing, not when creating (`INVALID_DATES`).
4. **Duplicate** copies title, type, platforms, caption, hashtags, notes, date, time and the flag into a new `idea` post of the same client, with the caller as responsible; no files, tasks, line or history.

### Media and linked tasks
5. **Media.** A post's media, in display order: the latest non-archived version of each of its own non-archived files (by creation), then the final version of each non-archived deliverable of its linked tasks (tasks by link time, deliverables by creation). A linked task's deliverable without a final version is not media.
6. **Linkable.** A task can be linked when it is non-archived, of the post's client, not linked to another post (`TASK_ALREADY_LINKED`), not `delivered` or `cancelled`, and not in the medical stage or `awaiting_client` (`TASK_NOT_LINKABLE`); at most 5 per post (`LIMIT_REACHED`). The dialog offers the client's open unlinked tasks, those of the retainer cycle of the post's publish month first, so the monthly template's tasks are used before a new one is created (ADR 0017).
7. **A linked task** has `needs_client_approval` forced false: the client approves the post, never the task (owner decision). It goes through F06 to `approved` by its own department's review, and F10 rule 9 marks its latest versions final. On a linked task these are refused with `LINKED_TO_POST`: turning `needs_client_approval` on, delivering by hand (`approved → delivered`), recording a client response (`approved → revisions`, F06), and changing the client. Linking a task moves an `idea` post to `in_production`.
8. **Unlink** (in `idea` or `in_production`) clears `post_id` and restores `needs_client_approval` to true when the task is not yet `approved`. Cancelling or archiving a linked task unlinks it (`PostTaskHooks`); the post's responsible is notified.
9. **Create a linked task.** From the post, edit-scope users create an F06 request in a department's queue (default Design; Photography for a reel): title "<type>: <post title>", brief from the post's notes and caption, due date 2 work days before the publish date (not before today), no assignee, linked to the post, and optionally to a cycle line of the client's open cycle of the publish month. The dialog warns when every committed unit of that line already has a task. The department's manager assigns it (F06).

### Review
10. **Submit.** A post is submitted when it has a caption or media (`NOTHING_TO_APPROVE`) and every linked task is `approved` (`POST_TASKS_NOT_READY`, listing them).
11. **Content token and snapshot**, as F09 rules 1–2: the post detail carries `contentToken`, a hash of the media version ids, caption and hashtags; an internal pass sends it and is refused when the content changed (`REVIEW_CONTENT_CHANGED`). Every pass writes a `post_reviews` row with the media versions, caption, hashtags, type, platforms and date; a medical pass copies the internal pass's snapshot. Only a snapshot is sent to the client. Every return writes a `returned` row.
12. **Returns and linked tasks.** A return (internal, medical or by the client) moves the post to `in_production`; the caption and the post's own files are fixed there, uncounted. To change a linked task's work, an edit-scope user sends it back from the post (`approved → revisions`, with a note): after a client response asking for changes it is a **client revision** carrying that response's contact (counted, F06 rules 9–10, A06; once per task per response, `ALREADY_RETURNED`); otherwise it is an `internal` revision (not counted). Allowed only while the post is `in_production`.
13. **Medical stage (A13).** An internal pass of a post of a healthcare client always leads to stage `medical`, whether or not the post needs client approval (owner decision). Only `approvals.review_medical` holders approve or return it, never the post's responsible person (`SELF_REVIEW`); review-scope users may still return or cancel it.
14. **Withdraw for re-review** moves an `awaiting_client` post back to `internal_review` (stage `internal`) and withdraws its pending item (`post_moved`). Not a return.
15. **Reopen content** (owner decision) moves an `approved` or `scheduled` post to `in_production` with a reason; it then needs a new review and, when flagged, a new client approval. The earlier responses stay in its history.

### Publishing and the counter
16. **Counting once** (owner decision, ADR 0015 and 0021). A unit counts on a cycle line through a linked task that carries the line, or through the post's own `cycle_line_id`, never both: setting `cycle_line_id` on a post with a linked task on any cycle line, or linking such a task to a post with `cycle_line_id`, is refused (`POST_COUNTED_BY_TASK`). `cycle_line_id` must be a line of an `open` cycle of a retainer of the post's client when set (`INVALID_LINK`, `CYCLE_CLOSED`). The `content` progress source reports, per line: total = non-archived, non-cancelled posts with that `cycle_line_id`; delivered = those `published`.
17. **Mark scheduled** records that the post was scheduled on the platform's own tool (`scheduled_at`). It needs a `publish_time` (`PUBLISH_TIME_REQUIRED`).
18. **Mark published** needs every linked task `approved` (`POST_TASKS_NOT_READY`) and, in the same transaction: sets `published_at` (given, or now) and `published_by_id`, stores the optional links, and delivers every linked task (`approved → delivered` through `PostTasks`, audited with reason `post_published`). A closed cycle's frozen count does not change (ADR 0015). Published is final in V1.
19. **Cancel** needs a reason; the post stays on the calendar, dimmed, and leaves the counts. Its linked tasks are unlinked and kept as they are, to be used for another post; its pending item is withdrawn (`post_moved`). **Reopen** returns it without its tasks.

### Client approval (F09 with posts)
20. **Ready to send.** A post is ready when it is `awaiting_client`, not archived, has no pending item (an item in an expired request does not block, F09 rule 8), and, for a healthcare client, its `cleared_review_id` is a medical pass (`MEDICAL_REVIEW_REQUIRED`).
21. **Requests** take items `{ taskId }` or `{ postId }`, mixed freely, 1–60 of one client (`TASK_NOT_READY`, new `POST_NOT_READY`, `LIMIT_REACHED`); everything else is F09 rules 9–12. **Send month for approval** on the client calendar opens the new-request dialog with every ready post of that month selected, in publish order.
22. **Approve** moves the post to `approved` in one transaction with the `post_client_responses` row and the item closed; no final markers are written (the linked tasks' versions are already final; the post's own files carry none). **Request changes** needs a note and moves the post to `in_production` (rule 12). A decision is final (`ITEM_ALREADY_DECIDED`, `ITEM_WITHDRAWN`).
23. **Approve all** on the client page approves every pending post item of the request in one transaction, one response per post with the same optional note; task items are never included.
24. **By hand.** A client-scope user records the client's response on an `awaiting_client` post with the contact (`UNKNOWN_CONTACT`), as F09 rule 16: a `manual` response against `cleared_review_id` that closes the pending item.
25. **Leaving `awaiting_client` otherwise** (withdraw, cancel, archive, healthcare flag on without a pending item) withdraws the pending item (`post_moved`); the client page shows "withdrawn by the agency".
26. **Healthcare flag changes**, as F09 rules 18–19, through `ClientFlagHooks`: turned off, posts in the medical stage move to `awaiting_client` or `approved` by their flag, with their internal pass as `cleared_review_id` (audited, reason `healthcare_off`); turned on, `awaiting_client` posts without a pending item move to the medical stage (reason `healthcare_on`).
27. **What the client sees** per post item: the item title, type, platforms, the snapshot's publish date and time, caption, hashtags and media (F09 rule 22: view only), and the status or decision. Never the notes, the responsible person, linked tasks or internal titles of files. Post items are listed in publish order under a "Content plan" heading, after task items.

### Responsible person
28. A user who is the responsible person of open, non-archived posts cannot be archived (`USER_HAS_RESPONSIBILITIES`, type `responsible_for_open_posts`). A responsible person who later loses edit scope (leaves Content Management, stops being the account manager) is kept and shown with a warning; reminders still reach them and the account manager.

## API

Schemas live in `packages/contracts/src/content.ts` (posts, reviews, responses, calendar) and extend `approvals.ts`, `approval-views.ts`, `tasks.ts`, `files.ts` and `notifications.ts`, reusing the shared list and error schemas.

### Content (`content` module)
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/content/calendar` | `content.read` | `contentCalendarQuerySchema`: `from`, `to` (≤ 45 days), `clientId`, `status[]`, `platform`, `type`, `responsible` (`me` or a user id) | `contentCalendarSchema`: posts in the range by date and time (card fields: client, title, type, platforms, date, time, status, review stage, responsible, thumbnail version id, linked task count, overdue flag), and counts by status; not paged, cancelled included | — |
| `GET /api/content/posts` | `content.read` | `postListQuerySchema`: the calendar filters, `q`, `view` (`publish_today`, `overdue`, `to_review`, `returned`), page, pageSize | `postPageSchema` | — |
| `GET /api/me/content/summary` | `content.read` | — | counts for My posts: `publishToday`, `overdue`, `returned` (the caller responsible), `toReview` (null without `content.review`) | — |
| `POST /api/content/posts` | `content.manage` | `createPostSchema`: `clientId`, `title`, `type`, `platforms`, `publishDate`, `publishTime?`, `caption?`, `hashtags?`, `notes?`, `needsClientApproval?`, `responsibleId?`, `cycleLineId?` | `postDetailSchema` | 403, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `INVALID_RESPONSIBLE`, `INVALID_DATES`, `INVALID_LINK`, `CYCLE_CLOSED` |
| `GET /api/content/posts/:id` | `content.read` | — | `postDetailSchema`: the fields, client (name, healthcare flag), media (rule 5, with source: own file or task), linked tasks (id, title, department, assignee, status), cycle line label, `contentToken`, `clearedReview`, `reviewHistory[]`, `clientResponses[]`, `pendingApproval`, `allowedTransitions`, `permissions` (`canEdit`, `canEditContent`, `canReview`, `canMedicalReview`, `canSendForApproval`, `canRecordResponse`, `canArchive`) | 404 |
| `PATCH /api/content/posts/:id` | `content.manage` | `updatePostSchema` (partial; rule 3) | `postDetailSchema` | 403, 404, `POST_LOCKED`, `POST_ARCHIVED`, `INVALID_RESPONSIBLE`, `INVALID_TRANSITION`, `INVALID_LINK`, `CYCLE_CLOSED`, `POST_COUNTED_BY_TASK` |
| `POST /api/content/posts/:id/status` | per transition | `postStatusChangeSchema`: `to`, and per transition `note`, `reason`, `contentToken`, `contactId`, `publishedAt`, `publishedLinks` | `postDetailSchema` | 403, 404, `INVALID_TRANSITION`, `NOTHING_TO_APPROVE`, `POST_TASKS_NOT_READY`, `REVIEW_CONTENT_CHANGED`, `PUBLISH_TIME_REQUIRED`, `UNKNOWN_CONTACT`, `POST_ARCHIVED` |
| `POST /api/content/posts/:id/medical-review` | `approvals.review_medical` | `medicalReviewSchema` (F09) | `postDetailSchema` | 403, 404, `INVALID_TRANSITION`, `SELF_REVIEW`, `POST_ARCHIVED` |
| `POST /api/content/posts/:id/duplicate` | `content.manage` | `{ publishDate? }` | `postDetailSchema` (the new post) | 403, 404, `CLIENT_ARCHIVED`, `CLIENT_ENDED` |
| `POST /api/content/posts/:id/archive` · `/restore` | `content.review` (scope all) | — | 204 · `postDetailSchema` | 403, 404 |
| `GET /api/content/posts/:id/linkable-tasks` | `content.manage` | `q`, `department` | tasks per rule 6 (list fields, cycle line, "this month's cycle" flag), at most 50 | 403, 404 |
| `PUT /api/content/posts/:id/tasks/:taskId` | `content.manage` | — | `postDetailSchema` | 403, 404, `POST_LOCKED`, `TASK_ALREADY_LINKED`, `TASK_NOT_LINKABLE`, `LIMIT_REACHED`, `POST_COUNTED_BY_TASK` |
| `DELETE /api/content/posts/:id/tasks/:taskId` | `content.manage` | — | `postDetailSchema` | 403, 404, `POST_LOCKED` |
| `POST /api/content/posts/:id/tasks` | `content.manage` | `createPostTaskSchema`: `department`, `title?`, `brief?`, `dueDate?`, `cycleLineId?` | `postDetailSchema` | 403, 404, `POST_LOCKED`, `LIMIT_REACHED`, `INVALID_DATES`, `INVALID_LINK`, `CYCLE_CLOSED`, `POST_COUNTED_BY_TASK` |
| `POST /api/content/posts/:id/tasks/:taskId/return` | `content.manage` | `{ note }` | `postDetailSchema` | 403, 404, `INVALID_TRANSITION` (post not `in_production`, task not `approved`), `ALREADY_RETURNED` |

### Changes to `approvals` (F09)
| Method and path | Change |
|---|---|
| `GET /api/approvals/ready` | each client also lists its ready posts (card fields, snapshot summary); `month` filter for "Send month" |
| `POST /api/approvals/requests` | `items[]` are `{ taskId, title? }` or `{ postId, title? }`; limit 60; adds `POST_NOT_READY` (409, `details.postId`) |
| `GET /api/approvals/requests`, `/:id`, `GET /api/clients/:id/approvals` | items carry `kind` (`task`, `post`) and, for posts, the post id and snapshot fields; responses list post responses too |
| `GET /api/public/approvals/:token` | post items carry `kind`, type, platforms, publish date and time, caption, hashtags, files |
| `POST /api/public/approvals/:token/approve-all` | new: `{ note? }` → the updated items (rule 23); 404, 410 |
| public content routes | also serve the versions of post snapshots of the request |

### Changes to earlier features
- **F06** `tasks`: `post_id`; `PostTasks` and `PostTaskHooks`; rule 7's refusals (`LINKED_TO_POST`); the `approved → revisions` return for linked tasks (rule 12, `internal` or `client` source); `taskDetailSchema` and list items gain `postId`; the task list gains the filter `linkedToPost` (boolean).
- **F09** `approvals`: post items as above; the medical queue and Ready to send include posts.
- **F10** `files`: owner type `post`.
- **F05** `projects`: the cycle line counts add the `content` source to the tasks source; no schema change.
- **F01** `auth`: responsibility type `responsible_for_open_posts`.
- **F14** `notifications`: subject `post`, the types and reminder kinds below.

New error codes: `POST_LOCKED`, `POST_ARCHIVED`, `POST_NOT_READY`, `POST_TASKS_NOT_READY`, `POST_COUNTED_BY_TASK`, `LINKED_TO_POST`, `TASK_ALREADY_LINKED`, `TASK_NOT_LINKABLE`, `ALREADY_RETURNED`, `INVALID_RESPONSIBLE`, `PUBLISH_TIME_REQUIRED`. Conflicts with the current state answer 409, as F09.

## Screens
All screens: Arabic RTL, strings through i18next (`content.*`, `approvals.*`, `tasks.*`), dates in Asia/Damascus with Latin digits, weeks from Saturday, `packages/ui` components only, loading, empty and error states.

1. **Content** `/content` — in navigation for every user. Tabs kept in the URL:
   - **Calendar:** month grid (default) or week view, all clients; filters: client, status, platform, type, responsible ("mine"). A post card shows the client, title, type icon, platform icons, time, status badge ("Internal review · Medical" in the medical stage), thumbnail when it has media; overdue posts (rule: open, approved or scheduled, date passed) are marked; cancelled ones are dimmed. Clicking opens the post page. A day with more than 4 posts shows "+n" and opens the day list. Below 768 px the month becomes an agenda list by day. Empty: "No posts in this period". "New post" for edit-scope users.
   - **My posts:** sections with counts from the summary: Publish today, Overdue, Returned to me, Waiting for my review (review scope).
2. **Client Content tab** `/clients/$clientId/content` — the same calendar fixed to the client, with the month's counts by status, "New post", and for client-scope users **"Send month for approval"** (disabled with a hint when no post of the month is ready; the F02 warning when the client has no final-approval contact).
3. **New post** (dialog) — client (fixed from a client tab), title, type, platforms (the client's platform accounts first, then the rest), publish date and time, caption, hashtags, notes, needs client approval, responsible. Validation in place.
4. **Post page** `/content/posts/$postId` — header: client, title, type, status and actions from `allowedTransitions`. Sections: **Content** (caption, hashtags with character counts; "changed after review" mark as F09); **Media** (the post's own files with the F10 upload control and preview dialog, then each linked task's final files marked with the task; "sent to client" / "added after review" marks as F09); **Schedule** (date, time, platforms, responsible, needs client approval, counting line or "counted through <task>"); **Linked tasks** (title, department, assignee, status, open task; "Link a task", "Request a new task", "Send back for changes", unlink); **Client approval** panel (pending link or "Ready to send", as the F09 task panel) and client responses; **Review history**; **Publishing** (scheduled mark, published time and links, editable after publishing). Read-only for users without edit scope. Published and cancelled posts show no content actions.
5. **Link a task** (dialog) — this month's cycle tasks first, search, department filter; second tab "Request a new task" with the defaults of rule 9 and the over-commitment warning.
6. **Approvals** `/approvals` (F09) — Medical review lists posts beside tasks, with a kind badge; Ready to send lists ready posts per client and a "Month" picker; the new-request dialog and the request page show post items (type, platforms, date, caption excerpt, thumbnails).
7. **Client page** `/a/$token` (F09) — post items under "Content plan" in publish order: each card shows date and time, type, platform icons, the media (carousel media as a swipeable strip), caption and hashtags, with "Approve" and "Request changes"; "Approve all" (confirmation with the count) while two or more post items are pending. Phone width first.
8. **Task page** `/tasks/$taskId` (F06) — a "Post" line for a linked task (title, publish date, status, link), and the hint that the client approves it with the post and it is delivered when the post is published; the deliver and client-response actions are hidden.
9. **Retainer page** (F05) — line counts include published posts counted directly; no layout change.

What roles see differently: everyone reads; edit-scope users get the editing and publishing actions; review-scope users the review actions; medical reviewers the medical actions; client-scope users the approval link and manual response actions.

## Audit, notifications and jobs
- **Audit** (entity `post`): `post.created`, `post.updated` (changed fields; caption and hashtags as lengths before and after, not the text), `post.status_changed` (from, to, note or reason; `healthcare_off` / `healthcare_on`), `post.reviewed` (stage, outcome, note, version numbers), `post.client_response_recorded` (decision, channel, contact, note), `post.task_linked`, `post.task_unlinked`, `post.task_returned`, `post.duplicated`, `post.archived`, `post.restored`. Linked tasks write their own F06 entries (`task.status_changed` with reason `post_published` or `post_return`). Approval requests and items audit as F09, with `postId` in place of `taskId`. Link responses are written with no actor and the contact's name, as F09.
- **Notifications** (F14 catalog; subject `post`):
  | Type | Event | Recipients | Mutable |
  |---|---|---|---|
  | `post_assigned` | the responsible person is set to someone other than the actor | the responsible | yes |
  | `post_review_requested` | submit for review | review-scope holders covering the post, except the actor | no |
  | `post_medical_review_requested` | the post enters the medical stage | non-archived members of Medical Consultation, except the responsible | no |
  | `post_returned` | internal or medical return; the client requests changes (link or by hand) | the responsible | no |
  | `post_awaiting_client` | the post becomes ready to send | the client's account manager | no |
  | `post_approved` | approved by the client, or without the client | the responsible | no |
  | `post_task_ready` | a linked task becomes `approved` | the responsible | yes |
  | `post_task_unlinked` | a linked task is cancelled or archived | the responsible | no |
  | `post_publish_today` | daily job, rule below | the responsible | yes |
  | `post_publish_overdue` | daily job, rule below | the responsible and the client's account manager | no |
  `approval_responded`, `approval_no_response` and `approval_expired` (F09) cover post items unchanged. The workflow types go under Tasks in the settings, the two reminders under Reminders. The actor never notifies themselves (F14 rule 2).
- **Jobs:** no new job. `content` registers a source in `notifications.daily` (09:00 Asia/Damascus on work days): `post_publish_today` for `approved` or `scheduled` posts whose publish date is today or a later day before the next work day (a Friday post is announced on Thursday); `post_publish_overdue` for `approved` or `scheduled` posts whose publish date is before today, once per post and publish date. Both idempotent through `notification_reminders` (F14 rule 8).

## Edge cases
1. **Two people edit or move a post at once:** status changes re-read the post in their transaction; a pass with a stale content token is refused; the item row is locked before a response, as F09 edge case 1. Lock order: posts, then tasks, then the request, then its items.
2. **A linked task is reopened after the post was approved:** impossible from the task (`LINKED_TO_POST`); reopen the post's content first, then send the task back from the post.
3. **A linked task gets a new version while the post is in review or with the client:** the task is `approved`, so a new version does not become final until it is approved again; the snapshot is unchanged.
4. **The publish date moves to another month:** the post moves on the calendar; linked tasks keep their cycle lines; a direct `cycle_line_id` is kept (it may belong to the earlier month's open cycle) and can be changed by hand.
5. **The cycle closes before the post is published:** the count is frozen without it (ADR 0015); publishing later delivers the tasks but does not change the closed month.
6. **A post without a retainer or a line:** allowed; it counts nowhere.
7. **A linked task is moved to another client:** refused (`LINKED_TO_POST`).
8. **The client is archived or ended with open posts:** posts become read-only with an archived client; an ended client's posts stay editable so the month can be finished.
9. **Published by mistake:** published is final in V1. A scope-all reviewer archives the post and creates it again (Duplicate); delivered tasks are reopened through F06 when the work must return.
10. **More than 60 ready posts in a month:** "Send month" selects the first 60 in publish order and says so; the rest go in a second link.
11. **A month link with posts decided one by one over several days:** each decision is final on its own; the request completes when no item is pending (F09 rule 15).
12. **The responsible person is the only medical reviewer:** the post waits in the medical stage; the General Manager can review it (F09 edge case 8).
13. **Healthcare flag turned on with approved, unpublished posts:** they stay approved (as F09 rule 19: only work not yet answered goes back).
14. **A carousel with more than 10 files of its own:** refused (`LIMIT_REACHED`); linked tasks' deliverables add to the media beyond that.

## Open questions
- None block F08. The owner decided every question of the interview on 2026-10-01 (recorded in ADR 0021).
- Not asked, chosen as the simplest reading and easy to change before implementation: "Approve all" on the client page (rule 23); the request limit raised to 60 items; "mark scheduled" needs a publish time (rule 17); published is final (edge case 9).
- Q5 (email provider) still gates sending links and reminders by email (Phase 4).

## Implementation notes
Details the implementation settled (PR 1, `feat/f08-content-api`):
- **Overdue** (card flag, My posts, the daily job) means the same everywhere: `approved` or `scheduled` with a publish date before today.
- **`post_review_requested`** goes to the managers of Content Management and Internal Operations and the client's account manager; General Managers are not notified of every submission, as with `task_review_requested`.
- **Calendar counts** ignore the `status` filter, so every status keeps its number while one is selected.
- **An internal pass** is asked for with `to: awaiting_client` (the post needs the client) or `to: approved` (it does not); for a healthcare client either one leads to the medical stage.
- **"Returned to me"** lists `in_production` posts whose latest review or client response sent them back; a post reopened with "Reopen content" is not one.
- **Post files** are locked with `POST_LOCKED` in every status but `idea` and `in_production`, which also covers the snapshot versions under medical review or with the client (`VERSION_SENT` is never reached on a post).
- **Cycle line counts:** `projects`' `WorkProgress` takes extra cycle line sources (`registerCycleLines`) beside the tasks source; a post counted directly adds to the line's `tasks` total and, once published, to its delivered count.
- **A responsible person** must be a non-archived user; reopening a cancelled post whose responsible person was archived since answers `INVALID_RESPONSIBLE`.

Details the implementation settled (PR 2, `feat/f08-content-links-api`):
- **Link time.** `tasks` gains `post_linked_at` beside `post_id` (set and cleared together, check constraint), so rule 5's "tasks by link time" has something to sort by. A check constraint also keeps a linked task with a client and without its own client approval.
- **Shared enums.** `review_stage`, `review_outcome`, `client_decision` and `response_channel` moved to `packages/db/src/schema/reviews.ts` (no migration): `tasks.ts` and `content.ts` now refer to each other's tables. The contract lists of post types and platforms moved to `post-values.ts` for the same reason (`approvals.ts` shows them, `content.ts` imports `approvals.ts`).
- **Linking** a task already linked to the same post changes nothing (the `PUT` is idempotent). A task of another client answers `TASK_NOT_LINKABLE`. Linking and requesting write `post.task_linked`; the automatic start of production writes `post.status_changed` with reason `task_linked`.
- **Unlinking by cancel or archive** (rule 8) restores the task's client approval like a manual unlink, writes `post.task_unlinked` with reason `cancelled` or `archived`, and the notification carries the task title and the reason. A cancelled post writes it with reason `post_cancelled`.
- **A requested task** (rule 9) is created through F06's own create, so its rules hold: an ended client takes no new task (`CLIENT_ENDED`), a past due date answers `INVALID_DATES`. The brief is the post's notes and caption, cut to 5000 characters.
- **Send back** (rule 12): the task is a client revision only while the latest review or client response of the post is the client asking for changes; a second send-back of the same task for the same response answers `ALREADY_RETURNED`, also when the first one was fixed and approved again.
- **Linkable tasks** come at most 50, the publish cycle first (the cycle whose period holds the post's publish date), then by due date, each with `inPublishCycle`.
- **Medical queue.** The post list and calendar take a `reviewStage` filter (`medical` lists the queue of screen 6).
- **Ready posts** carry what their snapshot would send: file count, caption and a thumbnail version. `month` on `GET /api/approvals/ready` filters posts only.
- **Approval items** carry `kind` with `task` or `post` (the other is null); a post item's versions keep the display order of its snapshot. On the client page, task items come first by position, then post items in publish order; a withdrawn post item shows no snapshot.
- **Rule 7 also refuses** giving a linked task a new cycle line (`LINKED_TO_POST`): only linking checks rule 16, so unlink, set the line and link again.
- **Edge case 9:** reopening a delivered linked task (F06) unlinks it from its published post (`post.task_unlinked`, reason `reopened`), so it is delivered by hand again when done.
- **Post files on the client page** carry no name (rule 27: no internal titles of files).
- **Approve all** answers with the post items it decided; an item answered or withdrawn meanwhile is skipped.
- **A client's approval history** merges the responses on tasks and on posts into one list, newest first, each entry with `kind`.
- **A sent post of a client that becomes healthcare** stays with the client (rule 26); if its link is then revoked or expires it is not ready again without a medical pass (`MEDICAL_REVIEW_REQUIRED`): withdraw it for re-review.

## Acceptance
- Owner check in the browser (content writer W and manager CM of Content Management, designer D and Design manager M, the client's account manager A, a Medical Consultation member R; a client C with an active retainer whose cycle has lines design 4 and reel 1 and generated tasks, with a final-approval contact with a phone; a healthcare client H):
  1. As W, open C's Content tab and create three posts for this month (a post, a carousel, a reel) with captions, platforms and dates; they show on the month and week views and on `/content`.
  2. On the first post, "Link a task": pick the generated "Design 1"; the post moves to "in production" and the task page shows the post. On the second, "Request a new task" for Design: it appears in Design's queue; the dialog showed no over-commitment warning.
  3. As D and M, finish and approve "Design 1" (no client step is offered). W is notified; the post's Media shows the final design. Upload an image directly on the third post.
  4. As W, submit the first post; as CM, pass it: it is "awaiting client" and A is notified. As A, on C's Content tab press "Send month for approval": the dialog lists the ready posts; create the link.
  5. Open the link at phone width: the posts appear under "Content plan" with date, platforms, caption and design. Request changes on one with a note, approve the other (or "Approve all").
  6. As W: the returned post is back in production with the client's note. Fix the caption and resubmit (no revision counted), or "Send back for changes" on the linked task: the task is in `revisions` with a client revision counted.
  7. On the approved post, change the publish date: no re-approval. Use "Reopen content": it returns to production and needs approval again.
  8. Mark a post scheduled, then published with an Instagram link: the linked task becomes `delivered` and the retainer line shows one more delivered. A post with a direct line and no task counts the same way when published.
  9. For H, pass a post that needs no client approval: it goes to the medical stage; R approves and it becomes approved. R cannot review a post R is responsible for.
  10. Cancel a post with a reason: it is dimmed on the calendar and its task is free to link to another post. Run the daily job for a date after an approved post's publish date: W and A get the overdue notice once.
- Tests:
  - Unit (contracts): schemas (platform list, limits, notes required for returns, published links); the post transition table; the content token; permission map (`content.read` all, `content.manage` for Content Management members, `content.review` grants).
  - API (`apps/api/test/content-posts.test.ts`, `content-review.test.ts`, `content-tasks.test.ts`, extensions of `approvals.test.ts` and `approvals-public.test.ts`): each route for success, 401, 403 and out of scope (an account manager on another manager's client; a Design member editing a post; a Content member passing a review; a non-member medical review; the responsible person's own medical review); each error code; rules 1–28; publish delivers linked tasks in one transaction (rollback leaves nothing); counting once across the two sources; mixed requests and the 60 limit; approve-all; healthcare flag hooks; the F06 refusals on linked tasks; audit entries in the same transaction.
  - Jobs: the daily source sends each reminder once, announces Friday posts on Thursday, skips published, cancelled and archived posts.
  - Notifications: recipients of each type; `approval_responded` merging with post items.
  - Architecture test: `tasks`, `files`, `clients`, `projects` do not import `content`; `content` does not import `approvals`.
  - E2E: create post → link task → task approved → post review → month link → client approves → publish → task delivered and line count.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): Content calendar (month, week, phone agenda), My posts, client Content tab, new post dialog, post page (each status group, medical stage, linked tasks, publishing), link-task dialog, Approvals with posts, request page with post items, client page with a content plan (phone width), task page with the Post line.
