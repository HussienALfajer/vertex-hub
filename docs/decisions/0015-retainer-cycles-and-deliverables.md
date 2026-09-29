# 0015 — Retainer cycles and the deliverables counter

Status: Accepted · Date: 2026-09-29

## Context
Retainers are monthly commitments to a counted set of deliverables (v1-scope F05). Success metric 4 requires that no retainer month closes without a known delivery rate. The owner's answers in the F05 spec (`docs/specs/F05-projects-retainers.md`) fix how months, counts and shortfalls behave; later features (F06 tasks, F08 posts, F13 invoices, A02 and A09) build on them.

## Decision
- A retainer has **deliverable lines** of a fixed kind (`design`, `reel`, `story`, `post`, `video`, `photo_shoot`, `ad_campaign`, `monthly_report`, or `other` with a name) and a monthly quantity. A client may have several retainers.
- A **cycle** is one calendar month in Asia/Damascus. A daily, idempotent worker job creates the current month's cycle for each active retainer and closes past ones; starting, resuming or reactivating a retainer creates the current cycle at once. A mid-month start gets a cycle for the rest of the month with full quantities (no prorating).
- A new cycle **copies** the retainer's lines; committed quantities are then edited on the cycle, with a reason. Retainer edits apply from the next cycle.
- **Delivered** = tasks linked to the cycle line that reach `delivered` (F06; F08 posts later) + manual adjustments, each with a reason and author.
- Closing a cycle **freezes** each line's delivered count; later deliveries never change a closed month's delivery rate. Shortfalls are **not carried over** automatically; compensation is an explicit, reasoned quantity increase on a later cycle.
- A line is **behind** when its completion trails the elapsed share of the period by more than 25 points, or when 7 days or fewer remain and it is incomplete. The rule is one pure function in `packages/contracts`, shared by the UI and A09.
- **Money on engagements** (installments, monthly fees, extra work estimates) is shown only to holders of `invoices.read` covering the client; everyone else sees projects and retainers without amounts.

## Consequences
- Monthly reports (F15) read frozen counts, so historical delivery rates never change.
- F06 attaches tasks to cycle lines; `projects` exposes a progress-source interface that `tasks` registers into, so `projects` does not import `tasks`.
- A02 (tasks and invoice for each new cycle) hooks into cycle creation; the job must stay idempotent.
