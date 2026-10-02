# P2A — Phase 2 automations (A04, A05, A06, A09, A13)

Status: Approved · Date: 2026-10-02 · Scope: `docs/product/v1-scope.md` §5 (A04, A05, A06, A09, A13), §F05, §F06, §F09 · ADRs: 0008, 0013, 0015, 0016, 0018, 0020, 0021

## Summary
Phase 2 lists five fixed automations. Three of them shipped inside the features that own them: the approval link with its 48-hour reminder (A04), the client's response moving the task (A05) and the mandatory medical review for healthcare clients (A13) are F09 and F08. This spec records that and adds what is still missing: the **retainer behind alert** (A09), which tells the account manager and the Operations manager in the last week of a month that a retainer will close short, and a **follow-up on revision decisions** (A06), which reminds them when an over-limit revision has waited two work days for its "free or extra work" decision. Both are reminders of the existing `notifications.daily` job; there is no new screen and no new table.

## In scope / out of scope
- In:
  - **A09:** a `retainer_behind` notification per open cycle when 7 days or fewer remain and a line is incomplete, and one final reminder when 3 days or fewer remain (owner decisions). It lists the lines that are short with delivered, committed and **ready** work (approved but not yet counted; owner decision).
  - **Ready count** on cycle lines: tasks of the line in `approved`, and posts counted directly on the line in `approved` or `scheduled`. Carried by the alert and shown on the retainer page's This month rows.
  - **A06 follow-up:** a `task_over_limit_pending` reminder, once per revision, when its decision is still pending on the second work day after it was recorded, to the account manager and the Operations manager (owner decision).
  - **A04, A05, A13:** recorded as delivered by F09 and F08 (table below), verified again in the acceptance steps. No code change.
- Out (later or never):
  - Changing the "behind" rule or badge (F05 R11, ADR 0015): the badge keeps showing early lag; only the alert is limited to the last week (owner decision).
  - Alerts for cycles that started in the last 7 days of their month (owner decision), and for paused or ended retainers (R11 applies to `active` only).
  - Repeating either reminder daily; reminders to the client; email or WhatsApp delivery (Phase 4, Q5; V2).
  - Blocking work while a revision decision is pending (F06 rule 10: work is never blocked).
  - The revision limit taken from the quote (F04, Phase 3).
  - A revision counter on posts (F08 owner decision).

### Where each automation lives
| ID | Scope text | Delivered by | State |
|---|---|---|---|
| A04 | Work sent to client → approval link; remind after 48 h | F09 rules 8–12 (requests and links), rule 24 and the hourly `approvals.reminders` job (`approval_no_response`), rule 25 (`approval_expired`); posts through F08 rule 21 | done |
| A05 | Client responds → approved, or back to the assignee with revision +1 | F09 rules 13–17 (link and by hand), F06 rules 9–10; posts through F08 rules 12, 23 | done |
| A06 | Revision limit exceeded → account manager decides free or paid | F06 rule 10 (`over_limit`, decision, extra work item), F14 `task_over_limit` at the moment it is recorded | done; this spec adds the follow-up reminder (rules 8–11) |
| A09 | Month end near and retainer behind → alert account manager and operations manager | F05 R11 (`isLineBehind`, badge) | this spec (rules 1–7) |
| A13 | Healthcare content → mandatory medical review before the client | F09 rules 4–5, 8, 18–19; posts through F08 rule 13 | done |

## Roles and access
No permission changes and no new routes. Notifications are personal (F14): each recipient reads their own; the link opens the retainer or task under that record's own permissions.

| Action | Permission | Roles and scope |
|---|---|---|
| Receive `retainer_behind` | — | the client's primary account manager; managers of Internal Operations |
| Receive `task_over_limit_pending` | — | the client's primary account manager; managers of Internal Operations |
| Decide on the revision (unchanged, F06) | `tasks.manage` (client scope) | General Manager, Operations manager, the client's account manager |
| Adjust the cycle (unchanged, F05) | `projects.manage` (client scope) | General Manager, Operations manager, the client's account manager |

"Operations manager" means every current manager of Internal Operations (F14 rule 14). The General Manager is not a recipient unless they hold one of these positions.

## Data
No new table. Changes:

- `notification_type` (enum, `packages/db`, from `NOTIFICATION_TYPES`): adds `task_over_limit_pending`, `retainer_behind`.
- `notification_reminders.kind` (enum, from `NOTIFICATION_REMINDER_KINDS`): adds `over_limit_pending`, `cycle_behind`, `cycle_behind_final`.
- One migration adding the enum values (`/db-migration`); backward compatible, nothing is rewritten.

### Contracts (`packages/contracts`)
- `notifications.ts`:
  | Type | Category | Subject | Mutable | Data |
  |---|---|---|---|---|
  | `task_over_limit_pending` | `reminders` | `task` | no | the task snapshot + `revisionNumber`, `recordedOn` (calendar date) |
  | `retainer_behind` | `reminders` | `retainer` | no | `retainer`, `client`, `periodEnd`, `daysLeft` (1–7), `final` (boolean), `lines[]` (1–30): `kind`, `label`, `delivered`, `committed`, `ready` |
  Order in `NOTIFICATION_TYPES`: `task_over_limit_pending` after `task_overdue_escalated`; `retainer_behind` after `retainer_renewal_due`.
- `retainers.ts`: `BEHIND_ALERT_DAYS = 7`, `BEHIND_FINAL_DAYS = 3`, and a pure function `behindAlert(period, today)` returning `'first'`, `'final'` or `null` from rules 1–3 (period length and days left only; the lines are checked with `isLineBehind`).
- `TaskCounts` gains `ready` (integer ≥ 0); `cycleLineSchema` carries it through its task counts.
- `tasks.ts`: `OVER_LIMIT_REMINDER_WORK_DAYS = 2`.

### Modules
- `projects`: a new daily source `retainer-behind` beside `retainer-renewals` (the pattern to copy: `apps/api/src/modules/projects/retainer-renewals.ts`). It reads cycles and lines (its own tables) and the line counts through `WorkProgress.cycleLines`.
- `tasks`: its `WorkProgressSource` fills `ready` (non-archived tasks in `approved`); a new daily source `over-limit-decisions` beside the A07/A08 source.
- `content`: its `CycleLineCounts` fills `ready` (non-archived posts with `cycle_line_id` in `approved` or `scheduled`).
- No new import between modules: `projects` still does not import `tasks` or `content`.

## States and rules
Neither automation changes a state. Both run inside `notifications.daily` (09:00 Asia/Damascus, work days; F14 rule 8) and are idempotent through `notification_reminders`.

### A09 — retainer behind
1. **Candidates.** On work day D: every `open` cycle of a non-archived, `active` retainer of a non-archived client. `daysLeft` = days from D to `period_end`, D included (as R11).
2. **Short cycles are skipped** (owner decision): a cycle whose period is 7 days or shorter (`period_start` to `period_end` inclusive) sends neither notice. The badge still shows.
3. **Which notice.** `daysLeft` ≤ 3 → the final reminder; otherwise `daysLeft` ≤ 7 → the first alert; otherwise nothing. The thresholds are "or fewer" because the job does not run on Friday or when the server was down; a run that first sees the cycle at 3 days or fewer sends only the final reminder.
4. **Behind.** A notice is sent only when at least one line is behind by `isLineBehind` for D (in this window: `committed` > 0 and `delivered` < `committed`), with `delivered` as the retainer page shows it (F05 R7: delivered tasks, posts counted directly, adjustments). Ready work does not change this (owner decision): the rule is the badge's rule.
5. **Once each.** The first alert is keyed `(cycle_behind, cycle id, period_end)`, the final reminder `(cycle_behind_final, cycle id, period_end)`. A cycle that catches up after the first alert gets no final reminder; one that falls short again later (a delivered task reopened, a quantity raised) gets the final reminder if it is short at 3 days or fewer, but never a second first alert.
6. **Content.** One notification per cycle, subject the retainer, no actor: the retainer and client names, `periodEnd`, `daysLeft`, `final`, and only the lines that are behind, by position, each with `delivered`, `committed` and `ready` (rule 7). Text (Arabic, i18next): "العقد <name> متأخر: بقي n أيام على نهاية الشهر" with the lines as "تصاميم 9/12 (2 جاهزة)"; the final one says it is the last reminder. It opens the retainer page on This month.
7. **Ready.** For a line: non-archived tasks linked to it in status `approved`, plus non-archived posts counted directly on it (F08 rule 16) in `approved` or `scheduled`. A task linked to a post is counted as a task, never twice (F08: a unit never counts twice). Ready is information only; it is not capped at the missing quantity.

### A06 — over-limit decision pending
8. **Candidates.** On work day D: every `task_revisions` row with `over_limit` and no `decision`, of a task that is not archived and not `cancelled`, of a non-archived client, recorded on a calendar day (Asia/Damascus) such that D is the second work day after it or later (`WORK_WEEK`: recorded Sunday → Tuesday; recorded Thursday or Friday → Sunday).
9. **Once.** Keyed `(over_limit_pending, revision id, recorded date)`: one reminder per revision, never repeated (as F14's overdue notices).
10. **Recipients and content.** `task_over_limit_pending`, no actor, subject the task: the task snapshot, the revision number and the day it was recorded. Text: "قرار معلّق منذ <date>: التعديل رقم n تجاوز الحد في <task>". It opens the task page, where the decision is taken (F06). The account manager gets it even when they recorded the revision themselves and so never got `task_over_limit` (F14 edge case 6).
11. **Nothing else changes.** The decision, `NO_ENGAGEMENT` and the "decision pending" marks of F06 stay as they are. Deciding before the run sends nothing.

### Shared
12. **Recipients** are resolved at run time (F14 rule 14): the client's current primary account manager and the current managers of Internal Operations, without duplicates; archived users are dropped by `notify`. With nobody left, the reminder key is still written and nothing is sent.
13. **Not mutable:** both types require action (F14 owner rule) and show locked in the settings under Reminders.

## API
No new route. Changed responses only:

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/retainers/:id` · `GET /api/retainers/:id/cycles/:cycleId` (changed) | `projects.read` | — | cycle lines' task counts gain `ready` | — |
| `GET /api/projects/:id` and milestone counts (changed) | `projects.read` | — | `TaskCounts.ready` (approved tasks); not shown | — |
| `GET /api/me/notifications`, the stream, `GET /api/me/notification-settings` (changed) | session | — | the two new types | — |

After the change: `pnpm build`, `openapi:export`, `api:generate`.

## Screens
No new screen. All strings through i18next, Arabic RTL, Latin digits.

1. **Bell, notifications page, toast** (F14) — render the two types (rules 6, 10) with the system icon; `retainer_behind` shows up to 3 lines and "+n" for more.
2. **Notification settings** — both types appear under Reminders, locked on.
3. **Retainer page, This month** (F05) — a line with `ready` > 0 and `delivered` < `committed` shows "n جاهزة لم تُحتسب بعد" beside its progress bar, so the page explains the same numbers as the alert. No other change; loading, empty and error states as F05.

Every role sees the same; only the recipients of rule 12 get the notifications.

## Audit, notifications and jobs
- **Audit:** none. Reminders change no business record (F14).
- **Notifications:** `retainer_behind`, `task_over_limit_pending` (catalog above).
- **Jobs:** no new job or schedule. Two new sources of `notifications.daily`: `retainer-behind` (`projects`) and `over-limit-decisions` (`tasks`), each reading candidates, then one transaction per subject with `remindOnce` under the row lock (the retainer for A09, the task for A06), like `retainer-renewals`. `notifications:run-daily --date` runs them in development.

## Edge cases
1. **Job missed days or Friday:** rule 3 looks at the state on D; a cycle first seen at 3 days or fewer gets one notice (the final), not two.
2. **Cycle closes before the run** (retainer ended, month rolled over at 00:05): no notice; closed cycles are never candidates.
3. **Retainer paused in the last week:** no notice while paused; resumed before month end with the same open cycle, it is a candidate again.
4. **Quantity lowered or delivered adjusted after the first alert:** the final reminder follows the state at that run (rule 5).
5. **Client without an account manager, or Internal Operations without a manager:** the other recipients still get it (rule 12).
6. **The account manager changes between the two notices:** each goes to the manager at that run.
7. **A line with `committed` 0, or over-delivered:** never behind (`isLineBehind`).
8. **More than one retainer of a client behind:** one notification per cycle; the toasts collapse (F14 rule 16).
9. **First run after release:** every revision already pending for two work days gets its one reminder, and every open cycle already inside its window gets its notice. Accepted, as F14 edge case 1.
10. **Revision decided, or its task cancelled or archived, between reading candidates and the transaction:** re-read under the lock; nothing is sent.
11. **A delivered task with a pending decision:** still reminded; the decision is a billing matter and outlives delivery.
12. **Posts scheduled for the last days of the month:** the line is behind until they are published (ADR 0021); the alert shows them as ready.

## Open questions
- None block this spec. Owner decisions of 2026-10-02: A09 alerts only in the last 7 days; one alert plus one final reminder at 3 days; the badge's rule with ready work listed; no alert for cycles started in the last 7 days; A06 reminder after two work days to the account manager and the Operations manager.
- Not asked, chosen as the simplest reading and easy to change before implementation: both types are not mutable; the General Manager is not a recipient; the "ready" hint on the retainer page; one PR (`feat/phase2-automations`).

## Acceptance
- Owner check in the browser (account manager A of client C, Operations manager O, a designer D; C has an active retainer with lines design 4 and reel 1; run the job with `pnpm --filter @vertex-hub/api notifications:run-daily --date <date>`):
  1. With one design delivered and one design task `approved`, run the job for a date 10 days before month end: nothing arrives.
  2. Run it for a date 7 days before month end: A and O get "retainer behind" listing designs 1/4 (1 ready) and reels 0/1; it opens the retainer on This month, where the design line shows "1 ready". Run again for the same date: nothing new.
  3. Run it for a date 3 days before month end: both get the final reminder. Deliver everything (or lower the quantities) before a run instead: no reminder.
  4. Create a retainer starting 5 days before month end: no alert on any run.
  5. As A, record client changes on a task past its limit (limit 0): O sees nothing yet. Run the job for the next work day: nothing. Run it for the second work day: A and O get "decision pending"; it opens the task. Decide; run again: nothing.
  6. In notification settings, both types are under Reminders and locked.
  7. A04, A05, A13 (already accepted with F09 and F08, checked once more): send a task by link and run the hourly job after 48 hours in a test database → `approval_no_response`; the client approves one item and requests changes on another → `approved`, and `revisions` with the counter +1; a healthcare client's task cannot be sent before the medical approval.
- Tests:
  - Unit (contracts): `behindAlert` at 8, 7, 4, 3 and 1 days left, a 7-day and an 8-day period, a February period; the new types in the catalog (category, not mutable, order); the data schemas (line limits).
  - Daily job (integration with a fixed clock, `apps/api/test`): A09 first and final once each, rerun sends nothing, catch-up sends only the final, short cycle skipped, paused, ended, archived retainer and archived client skipped, a cycle that caught up, recipients (account manager and Operations managers, no duplicates, none left); `ready` from approved tasks and from approved or scheduled posts, a task linked to a post counted once. A06: the work-day window over Thursday → Saturday → Sunday, decided, cancelled and archived tasks skipped, once per revision, the account manager who recorded it still reminded.
  - API: `ready` on the retainer detail and cycle lines.
  - Architecture test: unchanged and green (`projects` imports neither `tasks` nor `content`).
  - E2E with RTL screenshots: the notifications page with both types; the retainer This month row with the ready hint.
