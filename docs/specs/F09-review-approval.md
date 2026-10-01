# F09 — Internal review and client approval

Status: Approved · Date: 2026-10-01 · Scope: `docs/product/v1-scope.md` §F09, automations A04, A05, A13 · ADRs: 0002, 0007, 0013, 0014, 0016, 0018, 0019, 0020

## Summary
Clients approve work in WhatsApp today: nobody can prove who approved what, which file was approved, or whether a healthcare client's content was checked by a doctor before it went out. F09 closes the review loop. Internal review (F06) now records exactly what it approved: the deliverable versions and the text for the client. For healthcare clients, every task that goes to the client passes a mandatory **medical review** stage before it can be sent. The account manager bundles one or more ready tasks of a client into an **approval link** for a contact with final-approval authority and sends it over WhatsApp; the client opens it without an account, views the work, and approves or requests changes on each task. The response moves the task (A05), marks the approved versions final, and is recorded with who, when and which versions. The account manager is reminded after 48 hours without a response (A04) and told when the link expires.

## In scope / out of scope
- In:
  - **Review snapshots:** every pass of a review records the versions and the client text it approved; only that snapshot goes to the client (owner decision). A pass is refused when the content changed since the reviewer loaded it.
  - **Text for the client** on a task (caption, ad copy, article), reviewed and sent with the files (owner decision).
  - **Medical review (A13):** a `medical` stage inside `internal_review` for every task of a healthcare client that needs client approval (owner decision); medical approve or return with notes; not by the task's assignee (owner decision).
  - **Withdraw for re-review:** a new transition `awaiting_client → internal_review` to send newer work through review again (owner decision).
  - **Approval requests:** several ready tasks of one client in one link, one decision per task (owner decision), for one contact with final-approval authority; valid 7 days; a decision is final (owner decision); revoke and reissue.
  - **Delivery by hand:** copy the link, or open WhatsApp with a prepared message to the contact's phone (owner decision). No email.
  - **The client page:** public, no account, Arabic only (owner decision); view only, with downloads only for files the browser cannot show (owner decision).
  - **Client responses** recorded the same way from the link and by hand: the manual recording of F06 stays for responses by phone or WhatsApp (owner decision), now with the versions answered.
  - The `client` source of the F10 final marker: an approval marks the exact versions sent.
  - **Healthcare flag changes** applied to work not yet sent (owner decision; answers F02 edge case 8).
  - Notifications: medical review requested, client responded, no response after 48 hours (A04), link expired.
  - Screens: Approvals page (medical queue, ready to send, sent requests), new request, request page, client page, and changes to the task page, task list, board, My tasks and the client profile.
- Out (later or never):
  - Email or WhatsApp sending by the system, and reminders sent to the client: Phase 4 (Q5) and V2.
  - Approving content calendar posts and month plans: F08 adds its item type to the same requests.
  - A client portal with login, pinpoint comments on images or videos, side-by-side version comparison (v1-scope).
  - Changing a decision after it is sent; partial decisions inside one task (per deliverable).
  - English or other languages on the client page.
  - Watermarks or download protection beyond not offering a download button.

## Roles and access

### Permission map changes (`packages/contracts/src/permissions.ts`)
- `approvals.review_medical` stays as it is: members (primary or secondary) of Medical Consultation, `all`; the General Manager holds it through `everything` and may also review (owner decision).
- `approvals.review` is removed: internal review is F06's `tasks.manage`, and nothing uses it.
- No other change. Sending, revoking and reissuing links, and recording responses by hand, use F06's **client scope** (`tasks.manage` under `all` or `own_clients`: General Manager, Operations manager, the client's primary account manager).

### F09 actions
| Action | Permission | Roles and scope |
|---|---|---|
| Edit a task's text for the client | `tasks.work` or `tasks.manage` | task workers · manage scope |
| Internal review: pass (send to client, or approve without client) or return | `tasks.manage` | manage scope (as F06) |
| Medical review: approve or return | `approvals.review_medical` | Medical Consultation members, General Manager; never the task's assignee |
| Withdraw a task from the client for re-review | `tasks.manage` | manage scope |
| See tasks ready to send; create an approval request | `tasks.manage` (client scope on every task in it) | General Manager, Operations manager, the client's account manager |
| Reissue or revoke a request's link | `tasks.manage` (client scope on the request's client) | as above |
| Record a client response by hand | `tasks.manage` (client scope) | as above (F06) |
| See requests, items, responses and review history | `tasks.read` | every active user |
| Open the client page and respond | the link's token | the holder of the link |

"Operations manager" means the manager of Internal Operations, as in F01–F14. The UI hides actions the user cannot take; the API enforces every row.

## Data

Module ownership: `tasks` owns the review stage, the review snapshots and the client responses, because they are part of the task workflow. A new `approvals` module owns the requests and items. `approvals` imports `tasks` (exported `TaskApprovals` service: ready tasks, snapshots, recording a response inside the request's transaction), `files` (`FileVersions` for snapshot versions and content), `clients` (`ClientDirectory` for the client and contacts), `auth` (`UserDirectory`) and `notifications`. `tasks` never imports `approvals`: when a task leaves `awaiting_client` by any path, `tasks` calls the hooks registered in its exported `ClientReviewHooks` registry inside its transaction, and `approvals` registers one that withdraws the task's pending item. `clients` gains a `ClientFlagHooks` registry that `tasks` registers into, called in the transaction that changes the healthcare flag (rules 18–19). The architecture test forbids `tasks` from importing `approvals`.

### Changes to `tasks`
| Field | Type | Rules |
|---|---|---|
| `review_stage` | enum `review_stage` (`internal`, `medical`) | set to `internal` on every move to `internal_review`, to `medical` when the internal pass leads to the medical stage; null in every other status (check constraint) |
| `client_text` | text | optional, ≤ 10 000 chars, plain text with line breaks: what the client reads and approves (caption, copy, article) |
| `cleared_review_id` | uuid → `task_reviews.id` | the pass that put the task in `awaiting_client` or `approved`; set on that move, kept afterwards for the record |

`revision_source` gains `medical` (a return by the medical reviewer; never counted against the limit, like `internal`).

### `task_reviews` (business table, append-only, owned by `tasks`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed |
| `stage` | enum `review_stage` | required |
| `outcome` | enum `review_outcome` (`passed`, `returned`) | required |
| `note` | text | `returned`: required, 1–2000 chars; `passed`: optional, ≤ 2000 |
| `reviewer_id` | uuid → `users.id` | required, from the session; null only for the system pass of rule 18 |
| `version_ids` | uuid[] | `passed`: the snapshot, one version per deliverable (rule 2); empty for `returned` |
| `client_text` | text | `passed`: the task's `client_text` at the pass |
| `revision_id` | uuid → `task_revisions.id` | `returned`: the revision it wrote |
| `created_at`, `updated_at` | | never edited; no `archived_at` (append-only history, listed with `task_revisions` as an exception in `packages/db/src/conventions.test.ts`) |

### `task_client_responses` (business table, append-only, owned by `tasks`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `task_id` | uuid → `tasks.id` | required, indexed |
| `decision` | enum `client_decision` (`approved`, `changes_requested`) | required |
| `channel` | enum `response_channel` (`link`, `manual`) | required |
| `contact_id` | uuid → `client_contacts.id` | required: the link's contact, or the contact chosen when recording by hand |
| `note` | text | `changes_requested`: required, 1–2000 chars; `approved`: optional, ≤ 2000 |
| `review_id` | uuid → `task_reviews.id` | required: the snapshot answered (the task's `cleared_review_id` at the time) |
| `approval_item_id` | uuid → `approval_items.id` | `link`: required; `manual`: set when a pending item was closed by it |
| `revision_id` | uuid → `task_revisions.id` | `changes_requested`: the client revision it wrote |
| `recorded_by_id` | uuid → `users.id` | `manual`: required; null for `link` |
| `ip`, `user_agent` | text | `link` only, kept as evidence; `user_agent` ≤ 500 chars |
| `created_at`, `updated_at` | | never edited; no `archived_at` (exception, as above) |

### `approval_requests` (business table, owned by `approvals`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `contact_id` | uuid → `client_contacts.id` | required: a non-archived contact of the client with final-approval authority when created or reissued |
| `message` | text | optional, ≤ 1000 chars: shown to the client at the top of the page |
| `token_hash` | text | required, unique: SHA-256 of the current token (ADR 0002, as password links) |
| `link_issued_at`, `expires_at` | timestamptz | set on create and on reissue; `expires_at` = issue + 7 days (owner decision) |
| `reminded_at`, `expiry_notified_at` | timestamptz | set by the hourly job (rules 15–16), cleared on reissue |
| `revoked_at`, `revoked_by_id` | timestamptz, uuid → `users.id` | set on revoke |
| `completed_at` | timestamptz | set when no item is `pending` any more |
| `created_by_id` | uuid → `users.id` | required, indexed |
| `created_at`, `updated_at` | | no `archived_at`: requests are revoked, never archived (exception, as above) |

**State** (computed, in this order): `revoked` (revoked_at set) · `completed` (completed_at set) · `expired` (now ≥ expires_at) · `open`.

### `approval_items` (business table, owned by `approvals`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `request_id` | uuid → `approval_requests.id` | required, indexed |
| `task_id` | uuid → `tasks.id` | required, indexed; at most one `pending` item per task (partial unique index on `task_id` where `status = 'pending'`) |
| `position` | integer | display order, dense from 1 |
| `title` | text | required, 1–160 chars; defaults to the task's title, editable when creating the request (the client sees it instead of internal wording) |
| `review_id` | uuid → `task_reviews.id` | required: the snapshot sent (the task's `cleared_review_id`) |
| `status` | enum `approval_item_status` (`pending`, `approved`, `changes_requested`, `withdrawn`) | required, default `pending` |
| `response_id` | uuid → `task_client_responses.id` | set with `approved` / `changes_requested` |
| `withdrawn_reason` | enum `approval_withdrawn_reason` (`revoked`, `resent`, `task_moved`) | set with `withdrawn` |
| `closed_at` | timestamptz | set when the item leaves `pending` |
| `created_at`, `updated_at` | | no `archived_at` (exception, as above) |

At most 20 items per request. The versions and text the client sees are the snapshot's (`review_id`), never the task's current ones.

### Changes to `files`
`file_final_source` gains `client`. `FileVersions` gains `markSnapshotFinal(tx, taskId, versionIds)` (rule 13) and read access for the public content routes by version id after `approvals` has checked the token.

## States and rules

### Review
```
internal_review (stage internal) ──pass: needs client approval, healthcare client──→ internal_review (stage medical)
internal_review (stage internal) ──pass: needs client approval──→ awaiting_client
internal_review (stage internal) ──pass: no client approval──→ approved                      (F06)
internal_review (any stage)      ──return (note; internal revision)──→ revisions             (F06)
internal_review (stage medical)  ──medical approve──→ awaiting_client
internal_review (stage medical)  ──medical return (note; medical revision)──→ revisions
awaiting_client                  ──withdraw for re-review (manage scope; optional note)──→ internal_review (stage internal)
awaiting_client                  ──client approved (link or by hand)──→ approved              (F06, A05)
awaiting_client                  ──client requested changes (link or by hand; client revision +1)──→ revisions (F06, A05)
```
The task statuses do not change (ADR 0016); the medical stage is a stage of `internal_review`.

1. **Content token.** The task detail carries `contentToken`, a hash of the latest non-archived version id of each non-archived deliverable and of `client_text`. An internal pass sends the token it was shown; if the content changed since, the pass is refused (`REVIEW_CONTENT_CHANGED`) and the page reloads.
2. **Snapshot.** Every pass writes a `task_reviews` row (`passed`) with the latest version of each non-archived deliverable and the `client_text`. A medical pass copies the snapshot of the internal pass that started the stage: the medical reviewer approves exactly what internal review approved; versions added later are shown as "added after review" and are not part of it. Every return writes a `returned` row with its revision.
3. **Something to approve.** A pass that leads to the client (medical stage or `awaiting_client`) needs at least one deliverable or a non-empty `client_text` (`NOTHING_TO_APPROVE`).
4. **Medical stage (A13).** An internal pass of a task that needs client approval, of a client flagged healthcare, moves it to stage `medical` instead of `awaiting_client`. Only `approvals.review_medical` holders approve or return it there, and never the task's assignee (`SELF_REVIEW`). Manage-scope users may still return it (internal) or cancel it. `needs_client_approval` cannot be turned off during the medical stage (`INVALID_TRANSITION`, like F06 rule 8).
5. **Medical return** writes a `task_revisions` row with source `medical` (not counted) and moves the task to `revisions`; resubmitting goes through internal review again, then medical review again.
6. **Withdraw for re-review.** A manage-scope user moves an `awaiting_client` task back to `internal_review` (stage `internal`), so newer versions or text can be reviewed and sent. Its pending item, if any, is withdrawn (`task_moved`). Not a revision.
7. **Text for the client** is edited by task workers and manage scope while the task is open, like a deliverable. Changes after a pass are not sent until the next pass; the task page marks them "changed after review".

### Approval requests
8. **Ready to send.** A task is ready when it is `awaiting_client`, not archived, has no pending item, and, for a healthcare client, its `cleared_review_id` is a medical pass (`MEDICAL_REVIEW_REQUIRED` otherwise; withdraw it for re-review). A pending item in an `expired` request does not block: adding the task to a new request withdraws the old item (`resent`).
9. **Create.** A client-scope user picks one client, 1–20 ready tasks of it (`TASK_NOT_READY` for any other, `LIMIT_REACHED` above 20), a contact who is a non-archived contact of the client with final-approval authority (`CONTACT_NOT_APPROVER`; F02 rule 9: a client without such a contact cannot be sent anything), an optional message and optional item titles. The client must not be archived (`CLIENT_ARCHIVED`). The response carries the link **once**: `<web origin>/a/<token>`, the token being 32 random bytes in base64url; only its hash is stored.
10. **Sending.** The system sends nothing. The request screen offers "Copy link" and "Send on WhatsApp", which opens `https://wa.me/<contact phone in international digits>?text=<prepared Arabic message with the link>`; without a phone only copying is offered.
11. **Reissue.** On an `open` or `expired` request with pending items, a client-scope user issues a new token: the old link stops working, `expires_at` is now + 7 days, the reminder and expiry notices are cleared, and the new link is shown once. The contact must still qualify (`CONTACT_NOT_APPROVER`). Refused on `revoked` and `completed` requests (`REQUEST_CLOSED`).
12. **Revoke.** A client-scope user revokes an `open` or `expired` request: its pending items are withdrawn (`revoked`), the link answers "no longer valid", and the tasks stay `awaiting_client` and are ready again.

### Client responses (A05)
13. **Approve.** The task moves to `approved` (F06) in one transaction with: a `task_client_responses` row, the item closed `approved`, and the snapshot's versions marked final with source `client` (`FileVersions.markSnapshotFinal`, replacing F10 rule 9 on this path): each snapshot version becomes its deliverable's final version; deliverables not in the snapshot keep their marker.
14. **Request changes.** A note is required. The task moves to `revisions` with a client revision (F06 rules 9–10: counted, over-limit decision pending, A06), the response row and the item closed `changes_requested`.
15. **Final.** A decision cannot be changed (owner decision): a second response on the same item answers `ITEM_ALREADY_DECIDED`; a withdrawn item answers `ITEM_WITHDRAWN`. Each item is decided on its own; the client may decide some now and others later while the link is valid. The request is `completed` when no item is pending.
16. **By hand.** F06's "record the client's response" stays. It now needs a contact of the client (any non-archived contact; the screen suggests those with final approval), records a `manual` response against the task's `cleared_review_id`, closes the task's pending item with it (the client page then shows "recorded by your account manager"), and on approval marks the snapshot final like rule 13. Recording "changes requested" after `approved` (F06) is also a `manual` response against the same snapshot.
17. **Leaving `awaiting_client` otherwise** (withdraw, cancel, archive, healthcare flag on) withdraws the pending item (`task_moved`); the client page shows "withdrawn by the agency". Changing the client of a task with a pending item is refused (`SENT_TO_CLIENT`).

### Healthcare flag changes (owner decision; F02 edge case 8)
18. **Turned off:** in the same transaction, every task of the client in the medical stage moves to `awaiting_client` with its internal pass as `cleared_review_id`, without a medical review; the move is audited with reason `healthcare_off` and the flag's actor.
19. **Turned on:** every task of the client in `awaiting_client` without a pending item moves to `internal_review` stage `medical` (audited, reason `healthcare_on`); tasks with a pending item stay sent, and their links stay valid. Tasks in earlier statuses meet the medical stage at their next pass. A task sent before the flag and later withdrawn or resent needs the medical review (rule 8).

### The link and the client page
20. **Validity.** A link works while its request is `open` or `completed` and not past `expires_at`, the client is not archived, and the contact is not archived and still has final-approval authority. Otherwise: unknown, revoked, or contact or client no longer valid → "this link is not valid" (`APPROVAL_LINK_INVALID`, 404); past expiry → "this link has expired, ask your account manager for a new one" (`APPROVAL_LINK_EXPIRED`, 410). The page never says which case of 404 applies.
21. **What the client sees:** the Vertex brand, the client's trade name, "Hello <contact name>", the account manager's name, the message, the expiry date, and per item: title, the snapshot's text, its files, and the status or the decision with its time and note. Never the task's internal title (unless kept), brief, comments, assignee, department or other tasks.
22. **Files on the page** (owner decision: view only): images show the rendered preview (the original when there is no preview and its type is shown inline, F10 rule 17); PDFs open in the page's viewer; videos play; link versions show "Open link"; files the browser cannot show (F10 rule 17's attachment types) show their name and size with "Download", the only download offered. Every public content response checks the token and that the version belongs to a snapshot of the request, and carries `Cache-Control: no-store`.
23. **Security.** Public routes take no session and set no cookie; tokens are compared by hash; the page and its API answer with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; nginx rate-limits `/api/public/` per IP. The response records the IP and user agent.

### Reminders (A04)
24. **No response.** The hourly `approvals.reminders` job notifies once per issued link (owner decision) when 48 hours have passed since `link_issued_at` and the request is `open` with pending items and no item decided by link since issue: `approval_no_response`. The request page then offers "Send reminder on WhatsApp": a prepared message without the link, to the contact.
25. **Expired.** The same job sends `approval_expired` once when an `expired` request still has pending items. The tasks stay `awaiting_client`; the account manager reissues, creates a new request or records a response by hand.

## API

Schemas live in `packages/contracts/src/approvals.ts` (requests, items, the public page) and `packages/contracts/src/tasks.ts` (review stage, client text, reviews, responses), reusing the shared list and error schemas.

### Tasks (`tasks` module)
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/tasks/:id` (changed) | `tasks.read` | — | `taskDetailSchema` gains `reviewStage`, `clientText`, `contentToken`, `clearedReview` (stage, reviewer, at, versions, text), `reviewHistory[]`, `clientResponses[]` (decision, channel, contact, note, versions, recorded by, at), `pendingApproval` (request id, state, issued, expires); `permissions` gains `canMedicalReview`, `canWithdrawFromClient`, `canEditClientText`, `canSendForApproval` | 404 |
| `GET /api/tasks` (changed) | `tasks.read` | `taskListQuerySchema` gains `reviewStage` (`internal`, `medical`) | list items gain `reviewStage` | — |
| `POST /api/tasks/:id/status` (changed) | per transition | `taskStatusChangeSchema` gains `contentToken` (internal passes) and the withdraw transition (`awaiting_client → internal_review`); client responses need `contactId` | `taskDetailSchema` (a healthcare pass answers `internal_review`, stage `medical`) | F06 codes, `REVIEW_CONTENT_CHANGED`, `NOTHING_TO_APPROVE`, `UNKNOWN_CONTACT` |
| `POST /api/tasks/:id/medical-review` | `approvals.review_medical` | `medicalReviewSchema`: `decision` (`approve`, `return`), `note` (required for `return`) | `taskDetailSchema` | 403, 404, `INVALID_TRANSITION` (not in the medical stage), `SELF_REVIEW`, `TASK_ARCHIVED` |
| `PUT /api/tasks/:id/client-text` | `tasks.work` or `tasks.manage` | `{ clientText }` (empty clears) | `taskDetailSchema` | 403, 404, `TASK_CLOSED`, `TASK_ARCHIVED` |
| `PATCH /api/tasks/:id` (changed) | as F06 | — | — | adds `SENT_TO_CLIENT` (client change with a pending item), `INVALID_TRANSITION` (rule 4) |
| `GET /api/me/tasks/summary` (changed) | `tasks.read` | — | gains `medicalReview` (tasks in the medical stage the caller may review; null without `approvals.review_medical`) and `readyToSend` (null without client scope) | — |

### Approvals (`approvals` module)
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/approvals/ready` | `tasks.manage` (client scope) | `clientId` (optional) | ready tasks (rule 8) under the caller's client scope, grouped by client: task list fields, snapshot summary (file count, has text), healthcare flag, the client's final-approval contacts | — |
| `GET /api/approvals/requests` | `tasks.read` | `approvalRequestListQuerySchema`: `clientId`, `state[]` (default `open`, `expired`), `createdBy` (`me`), page, pageSize | `approvalRequestPageSchema`: client, contact, state, items `{ total, approved, changesRequested, pending }`, issued, expires, reminded, created by | — |
| `GET /api/approvals/requests/:id` | `tasks.read` | — | `approvalRequestDetailSchema`: the list fields, message, items (title, task id and title, status, snapshot versions with thumbnails, text, response), `permissions` (`canReissue`, `canRevoke`), the contact's phone for WhatsApp | 404 |
| `POST /api/approvals/requests` | `tasks.manage` (client scope on the client) | `createApprovalRequestSchema`: `clientId`, `contactId`, `message`, `items[]` (`taskId`, `title?`) | detail + `link` (once) | 403, `CLIENT_ARCHIVED`, `CONTACT_NOT_APPROVER`, `TASK_NOT_READY`, `MEDICAL_REVIEW_REQUIRED`, `LIMIT_REACHED` |
| `POST /api/approvals/requests/:id/reissue` | as above | — | detail + `link` (once) | 403, 404, `REQUEST_CLOSED`, `CONTACT_NOT_APPROVER`, `CLIENT_ARCHIVED` |
| `POST /api/approvals/requests/:id/revoke` | as above | — | detail | 403, 404, `REQUEST_CLOSED` |
| `GET /api/clients/:id/approvals` | `tasks.read` | page | the client's requests (as the list) and its client responses, newest first | 404 |

### Public (`@AllowAnonymous`, rate-limited, no session)
| Method and path | Request | Response | Error codes |
|---|---|---|---|
| `GET /api/public/approvals/:token` | — | `publicApprovalSchema`: client trade name, contact name, account manager name, message, expires, items (id, title, text, files: version id, kind, name, type, size, inline or download, preview available, link URL and label; status, decision note and time, "recorded by your account manager") | `APPROVAL_LINK_INVALID` (404), `APPROVAL_LINK_EXPIRED` (410) |
| `POST /api/public/approvals/:token/items/:itemId/response` | `publicResponseSchema`: `decision` (`approved`, `changes_requested`), `note` | the updated item | 404, 410, `ITEM_ALREADY_DECIDED`, `ITEM_WITHDRAWN` |
| `GET /api/public/approvals/:token/versions/:versionId/content` · `…/preview` · `…/thumbnail` | — | the bytes, as F10 rules 16–17 (`X-Accel-Redirect` in production), `no-store` | 404, 410 |

New error codes: `REVIEW_CONTENT_CHANGED`, `NOTHING_TO_APPROVE`, `SELF_REVIEW`, `MEDICAL_REVIEW_REQUIRED`, `TASK_NOT_READY`, `CONTACT_NOT_APPROVER`, `REQUEST_CLOSED`, `SENT_TO_CLIENT`, `ITEM_ALREADY_DECIDED`, `ITEM_WITHDRAWN`, `APPROVAL_LINK_INVALID`, `APPROVAL_LINK_EXPIRED`, `VERSION_SENT` (from `POST /api/files/versions/:id/archive`, edge case 4). `TASK_CLOSED`, `LIMIT_REACHED`, `CLIENT_ARCHIVED`, `UNKNOWN_CONTACT` exist.

### Changes to earlier features
- **F06** `tasks`: the review stage, snapshots, medical review, withdraw transition, client text, client responses; `ClientReviewHooks`; registers into `clients`' `ClientFlagHooks`; `allowedTransitions` and the permission flags follow rules 1–7.
- **F10** `files`: `client` final source and `markSnapshotFinal`; rule 9 applies only to approvals without the client; the owner policy gains "version locked" for edge case 4.
- **F02** `clients`: `ClientFlagHooks`; the healthcare hint on the client form becomes true (it already promises the medical review).
- **F14** `notifications`: the new types below; subject `approval_request`.

## Screens
All screens: Arabic RTL, strings through i18next (`approvals.*`, `tasks.*`), dates in Asia/Damascus with Latin digits, `packages/ui` components only, loading, empty and error states.

1. **Approvals** `/approvals` — in navigation for medical reviewers and client-scope users. Tabs kept in the URL, each shown only to those who can act on it:
   - **Medical review** (`approvals.review_medical`): tasks in the medical stage, oldest first: title, client, department, assignee, waiting since; opens the task. Empty: "No content waiting for medical review".
   - **Ready to send** (client scope): ready tasks grouped by client, with the snapshot summary; select tasks of one client → "Create approval link". A client without a final-approval contact shows the F02 warning instead of the action. Empty: "Nothing is waiting to be sent to a client".
   - **Sent**: requests with state badge (open, expired, completed, revoked), client, contact, decided x of y, issued and expiry; filters state, client, "created by me". Empty per filter.
2. **New approval request** (dialog from Ready to send or from a task page) — client (fixed), contact picker (final-approval contacts with phone), message, the selected tasks with editable titles and a preview of what the client will see. On success: the link with "Copy link" and "Send on WhatsApp", and the note that the link is shown only now (reissue later if lost).
3. **Request page** `/approvals/requests/$requestId` — header: client, contact, state, issued, expires, reminded; actions (client scope): reissue (shows the new link), revoke (confirmation), "Send reminder on WhatsApp". Items: title (and task link), status and decision with note and time, the snapshot's thumbnails and text. Read-only for everyone else.
4. **Client page** `/a/$token` — outside the app shell, no sign-in, RTL, brand header. The content of rule 21; each item a card with its files (preview dialog of F10 without download, except rule 22) and two buttons: "Approve" (optional note, confirmation that it is final) and "Request changes" (required note). Decided items show the result. Invalid and expired links show their message with the agency name only. Works at phone width first: most clients open it from WhatsApp.
5. **Task page** `/tasks/$taskId` (F06) — new **Text for the client** section (editable per rule 7, with "changed after review"); status shows "Internal review · Medical" in the medical stage with "Approve (medical)" and "Return with notes" for medical reviewers; send-to-client passes the content token; "Withdraw for re-review" on `awaiting_client`; a **Client approval** panel: pending link (request link, contact, sent, expires) or "Ready to send" with "Create approval link", and the history of client responses (decision, channel, contact, note, versions, time); **review history** (stage, outcome, reviewer, note, versions). The Files section marks snapshot versions "sent to client" and newer ones "added after review"; the final badge shows "approved by the client". Recording a response by hand asks for the contact.
6. **Task list, board, My tasks** (F06) — a "Medical" badge on tasks in the medical stage; list filter "medical review"; My tasks gains the sections "Medical review" (medical reviewers) and "Ready to send" (client scope), with counts from the summary.
7. **Client profile** (F02) — new **Approvals** tab: the client's requests and the history of its client responses (instead of mixing them into the hand-written communication log).

What roles see differently: everyone reads requests, responses and review history; medical reviewers get the medical queue and actions; client-scope users get Ready to send and the request actions.

## Audit, notifications and jobs
- **Audit** (entity `task` unless noted): `task.reviewed` (stage, outcome, note, version numbers, has text), `task.status_changed` as F06 (with `reason` `healthcare_off` / `healthcare_on` for rules 18–19), `task.client_text_updated` (length before and after, not the text), `task.client_response_recorded` (decision, channel, contact, note, versions); `approval_request.created` (client, contact, task ids), `approval_request.link_reissued`, `approval_request.revoked`, `approval_item.responded`, `approval_item.withdrawn` (entity `approval_request`, `after` carries `itemId` and `taskId`). Link responses are written with no actor and `actorName` set to the contact's name, `after.via = 'approval_link'`. Tokens and links are never written to the audit log.
- **Notifications** (F14 catalog, rule 2 of F14 applies):
  | Type | Event | Recipients | Mutable |
  |---|---|---|---|
  | `task_medical_review_requested` | a task enters the medical stage (rule 4 or 19) | non-archived members of Medical Consultation, except the assignee | no |
  | `approval_responded` | the client decides an item through the link | the client's account manager and the request's creator; merges per request like `task_commented` (count, latest decision) | no |
  | `approval_no_response` | rule 24 (A04) | the client's account manager and the request's creator | no |
  | `approval_expired` | rule 25 | the same | no |
  Existing types extend: `task_returned` on a medical return and on a link response asking for changes; `task_approved` on a medical approval and on a link approval; `task_awaiting_client` on a medical approval and rule 18; `task_over_limit` from link responses. Order: `task_medical_review_requested` after `task_review_requested`; the `approval_*` types after `task_over_limit`. The new types go under Tasks (responded) and Reminders (no response, expired) in the settings, not mutable.
- **Jobs:** `approvals.reminders`, hourly at minute 15 (`15 * * * *`, Asia/Damascus), scheduled by `apps/worker`, worked by the API (ADR 0008, 0018); rules 24–25, each notice once (the `reminded_at` / `expiry_notified_at` update is the guard).
- **Deploy** (`deploy/`, with the next production deploy): nginx `limit_req` zone `vhapproval` (60 requests per minute per IP, burst 30) on `/api/public/`; `/a/` served by the SPA with `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`; the public content routes use the existing internal files location.

## Edge cases
1. **Two people pass or respond at once:** status changes re-read the task in their transaction (F06 edge case 1); the item row is locked before a response, so a second response gets `ITEM_ALREADY_DECIDED`, and a link response racing a manual one loses with the same code.
2. **The client opens the link after the task was withdrawn, cancelled or recorded by hand:** the item shows "withdrawn by the agency" or the recorded decision.
3. **A version is added while `awaiting_client`:** allowed (F10); not sent; shown "added after review". To send it, withdraw for re-review.
4. **Removing a sent version:** while a task is in the medical stage or `awaiting_client`, the versions of its current snapshot cannot be removed (`VERSION_SENT`; the `task` owner policy answers it to `files`). Withdraw the task for re-review first.
5. **The contact loses final-approval authority or is archived** after the link was sent: the link stops working (rule 20); the account manager reissues for another contact by creating a new request (rule 8 withdraws the old items).
6. **The account manager changes:** client scope moves at once (F06 edge case 6); notifications go to the new account manager and the request's creator.
7. **The client is archived:** links stop working; requests stay readable to scope-all holders with the client.
8. **Medical Consultation has no members, or only the assignee:** the task waits in the medical stage; the General Manager can review it (owner decision), and the Approvals tab shows it to them.
9. **Revision over the limit through the link:** recorded as F06 rule 10; the account manager decides afterwards; the client is not told about limits.
10. **A task in one request is reopened later (`approved → revisions`, F06):** its item stays decided; a new pass and a new request send it again.
11. **A link forwarded to someone else:** whoever holds it can respond as the contact (the scope's "secure link with no account"); the response records IP and user agent, and the account manager can revoke.
12. **Very large videos:** played from the content route with range requests (F10); link versions open the external site.
13. **Healthcare flag toggled twice quickly:** each change applies rules 18–19 to the state at that moment, each audited.
14. **Expired link with all items decided:** shows "expired"; the decisions stay on the request page.

## Open questions
- None block F09. The owner decided every question of the interview on 2026-10-01, including F02's open point (edge case 8: healthcare flag changes, rules 18–19).
- Q5 (email provider) still gates sending links and reminders by email (Phase 4).

## Acceptance
- Owner check in the browser (designer D, Design manager M, the client's account manager A, a Medical Consultation member R, the Operations manager O; a healthcare client H with a final-approval contact with a phone, and a non-healthcare client C):
  1. As D, on a task for C, upload a deliverable and write a caption in "Text for the client"; submit for review. As M, send it to the client: the task is `awaiting_client`; review history shows the pass with v1 and the caption.
  2. Add v2 as D: the Files section shows it "added after review". As M, withdraw for re-review and send again: the snapshot is now v2.
  3. As A, open Approvals → Ready to send, select this task and a second one of C, create a link for the contact; copy it and press "Send on WhatsApp" (WhatsApp opens with the message).
  4. In a private window, open the link at phone width: see both items with preview and caption, no download button for images. Approve the first; request changes on the second with a note. Reload: both are final.
  5. As A: the notifications arrive; task 1 is `approved` with v2 "approved by the client"; task 2 is in `revisions` with a client revision; the request is completed.
  6. On a task for H, pass internal review as M: it goes to "Internal review · Medical"; R gets the notification. As R, return with notes; D resubmits; M passes; R approves: the task is ready to send. On another H task assigned to R, R's medical approval is refused.
  7. Turn off H's healthcare flag as O while another task is in the medical stage: it becomes ready to send. Turn it on again: a ready, unsent task goes back to the medical stage.
  8. Create a link and revoke it: the link says "not valid". Create another, wait or move `expires_at` in a test database: "expired"; the hourly job sends the 48-hour reminder and the expiry notice once.
  9. Record a response by hand on a task with a pending link, choosing the contact: the client page shows "recorded by your account manager".
  10. Open the client's Approvals tab and the audit log: every step above is there, with link responses under the contact's name.
- Tests:
  - Unit (contracts): schemas (notes required for returns and changes, text limit, item limit, titles); the transition table with the medical stage and the withdraw transition; the request state function; the content token; permission map (`approvals.review` gone, `approvals.review_medical` for members and the General Manager).
  - API (`apps/api/test/task-reviews.test.ts`, `approvals.test.ts`, `approvals-public.test.ts`): each route for success, 401, 403 and out of scope (an account manager on another manager's client; a project manager sending a link; a non-member doing a medical review; the assignee doing their own medical review); each error code; rules 1–25; snapshot and final markers in the response transaction (rollback leaves nothing); the partial unique index on pending items; token hashing (the plain token is never stored or logged); public content only for snapshot versions of the link's request, inline vs download per rule 22, `no-store`; healthcare flag hooks; audit entries in the same transaction.
  - Jobs: `approvals.reminders` sends each notice once, not for revoked or completed requests, and again after a reissue.
  - Notifications: recipients, merging of `approval_responded`, the extended existing types.
  - Architecture test: `tasks` does not import `approvals`; `clients` does not import `tasks`.
  - E2E: internal pass → medical pass → create link → client page approve and request changes → task states and final markers.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): Approvals (each tab), new request dialog with the link, request page, client page (open, decided, expired, invalid; phone width), task page with text for the client, medical stage actions, client approval panel and review history; client Approvals tab.
