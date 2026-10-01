# 0021 — Content posts: linked tasks, approval of the finished post, counting at publish

Status: Accepted · Date: 2026-10-01

## Context
F08 (`docs/specs/F08-content-calendar.md`) adds the content calendar. The monthly template (ADR 0017) already generates one task per committed deliverable, the deliverables counter (ADR 0015) counts delivered tasks, and F09 (ADR 0020) sends review snapshots of tasks to the client. A post must not duplicate that work, must not be approved twice by the client, and must not count a unit twice. The owner decided: a post links to tasks; the client approves once, the finished post, with one decision per post and a month in one link; a unit counts when the post is published; Content Management members and the client's account manager edit, the Content Management manager or the account manager reviews, everyone reads; a client's change request counts as a revision only when a linked task is sent back; client approval is optional per post, the medical review is not for healthcare clients; after approval the date, time and platforms are free and the content needs a new approval; scheduled and published are marked by hand with optional links; each post has a responsible person who is reminded; posts can be cancelled with a reason; one caption per post.

## Decision
- **The post is the unit of content, the task the unit of production.** A `content` module owns posts. A task carries an optional `post_id`; a post's media is its own files (F10 owner type `post`) plus the final versions of its linked tasks' deliverables. `tasks` owns the column and exposes it through an exported service; it never imports `content`.
- **A linked task is never sent to the client.** Its `needs_client_approval` is forced false; it is approved by its department and waits. It cannot be delivered by hand.
- **The client approves the finished post.** Posts get their own review snapshots (`post_reviews`), medical stage and client responses (`post_client_responses`), mirroring ADR 0020, and are a second item kind of the same approval requests, whose limit rises to 60 items. The medical stage applies to every post of a healthcare client, also without client approval.
- **Revisions are counted on tasks only.** A return moves the post back to production; sending a linked task back after a client response records a client revision on that task (ADR 0016), once per task and response.
- **Counting at publish, once.** Marking a post published delivers its linked tasks in the same transaction, so the existing task count moves then. A post without a counted task may carry a cycle line itself and count when published, through a second progress source in `projects`; a post cannot do both.
- **Publishing is recorded, not done.** Scheduled and published are manual marks with optional per-platform links; published is final in V1.
- **Permissions.** `content.read` for every user; `content.manage` (edit) for Content Management members, the client's account manager, the Operations manager and the General Manager; new `content.review` for the Content Management manager, the account manager, the Operations manager and the General Manager. Sending links and recording responses by hand stay on F09's client scope.

## Consequences
- `tasks` gains `post_id` and refuses client steps and manual delivery on linked tasks; `approval_items` gains `post_id`, `post_review_id` and `post_response_id` with `task_id` optional; `file_owner_type` and `notification_subject` gain `post`.
- The deliverables counter of a retainer whose tasks are linked to posts lags behind production until the posts are published: this is the intended meaning of "delivered" for content.
- The Department Manager role loses its `content.*` grants; the Content Management manager holds them through department capabilities (ADR 0014).
- The monthly client report (F15) can list published posts with their links.
- A separate approval of the month's plan before production, captions per platform and automatic publishing stay out of V1.
