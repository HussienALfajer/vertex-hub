# 0020 — Review snapshots, medical review stage and client approval links

Status: Accepted · Date: 2026-10-01

## Context
F09 (`docs/specs/F09-review-approval.md`) must prove who approved which exact version, keep healthcare content from reaching the client before a medical review (ADR 0007, A13), and let clients approve without an account (v1-scope §F09). ADR 0002 already requires our own signed, hashed, expiring tokens for approval links; ADR 0016 fixes the task statuses; ADR 0019 lets later features refer to file versions by id. The owner decided: every task of a healthcare client that goes to the client passes medical review; one link may carry several tasks of a client with one decision per task; links last 7 days and a decision is final; links are sent by hand (copy, WhatsApp); the client views only, with downloads only for files a browser cannot show; the manual recording of responses stays; only reviewed versions are sent, with a withdraw transition to review newer work; healthcare flag changes apply to work not yet sent.

## Decision
- **Review snapshots.** Every review pass stores the deliverable versions and the client text it approved (`task_reviews`). Only a snapshot is ever sent to the client; a pass is refused if the content changed after the reviewer loaded it (content token). A medical pass approves the internal pass's snapshot unchanged.
- **Medical review is a stage of `internal_review`** (`review_stage` `internal` / `medical` on the task), not a new status. It applies to tasks of healthcare clients that need client approval, is done by holders of `approvals.review_medical` (Medical Consultation members and the General Manager), never by the task's assignee. A new transition `awaiting_client → internal_review` withdraws a task for re-review.
- **Client responses are one record** (`task_client_responses`) whether they come from a link or are recorded by hand, always against a snapshot; an approval marks the snapshot's versions final with source `client`.
- **Approval requests** (`approvals` module) bundle 1–20 ready tasks of one client for one contact with final-approval authority. The token is 32 random bytes shown once; only its SHA-256 is stored; reissuing replaces it. Requests are revoked, never archived. The system sends nothing in V1: the account manager copies the link or opens WhatsApp with a prepared message.
- **Public surface.** `/a/<token>` in the SPA and `/api/public/approvals/...` on the API, with no session, `no-store`, `no-referrer`, `noindex`, and an nginx rate limit. Public file content is served only for snapshot versions of the link's request, through the F10 serving path.
- **Module direction.** `approvals` imports `tasks`, `files`, `clients`, `auth` and `notifications`. `tasks` tells `approvals` about tasks leaving `awaiting_client` through a hook registry it exports; `clients` tells `tasks` about healthcare flag changes the same way.
- **Reminders** come from an hourly `approvals.reminders` job: once 48 hours after a link is issued without a response, and once when it expires with pending items, to the account manager and the request's creator.

## Consequences
- `review_stage`, `client_text` and `cleared_review_id` are added to `tasks`; `revision_source` gains `medical`; `file_final_source` gains `client`; `task_reviews`, `task_client_responses`, `approval_requests` and `approval_items` have no `archived_at` and are listed as exceptions in the conventions test.
- `approvals.review` leaves the permission map; internal review stays on `tasks.manage`.
- F08 adds content calendar posts and month plans as a new item type of the same requests.
- A link forwarded by the client works for whoever holds it until it expires or is revoked; responses record IP and user agent as evidence.
- Email delivery of links and reminders waits on Q5 (Phase 4).
