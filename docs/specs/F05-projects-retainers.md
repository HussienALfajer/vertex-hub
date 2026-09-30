# F05 — Projects and retainers

Status: Approved · Date: 2026-09-29 · Scope: `docs/product/v1-scope.md` §F05 (and A02, A09) · ADRs: 0006, 0007, 0008, 0013, 0014, 0015

## Summary
The agency sells two kinds of work and tracks neither today: one-off projects (a brand identity, a website) drift without a visible plan, and monthly retainers ("12 designs + 4 reels + a monthly report") are never checked against what was promised. F05 gives each client its projects, with milestones, a project manager, participating departments and a payment installment per milestone, and its retainers, with deliverable lines, a monthly cycle created automatically, a deliverables counter ("designs 9/12") with a "behind" warning, and a log of out-of-scope extra work for separate billing. Tasks (F06) attach to projects and retainer cycles and feed progress and the counter; invoices (F13) are later issued from milestones, retainer fees and extra work.

## In scope / out of scope
- In:
  - Projects: create, edit, archive (for records entered by mistake) and restore; status `planned → active ⇄ on_hold → completed`, and `cancelled`; project manager; participating departments; start and due dates; currency.
  - Milestones: ordered list per project, due date, manual completion with a warning when tasks are open, and an optional installment amount.
  - Retainers: several per client; deliverable lines from a fixed list of kinds (plus "other" with a name); monthly fee; status `active ⇄ paused → ended`; start date and renewal date (a reminder only).
  - Retainer cycles: one per calendar month, created by a daily job (and at once when a retainer starts or resumes mid-month); per-cycle committed quantities that can be edited with a reason; closed automatically at month end with a frozen delivery rate.
  - Deliverables counter: delivered = tasks of the cycle linked to the line and delivered (F06) + manual adjustments with a reason.
  - "Behind" rule for open cycles (shown as a badge; A09 later sends the alert with the same rule).
  - Extra work log on projects and on retainers, with a billing status (`unbilled`, `billed`, `waived`).
  - Money fields (installments, monthly fee, extra work estimates) visible only to users who may read the client's invoices.
  - Screens: project list, new project, project page; retainer list, new retainer, retainer page; "Projects" and "Retainers" tabs on the client profile (F02).
  - The project manager responsibility in F01's archive check.
- Out (later or never):
  - Tasks, task counts, project progress from tasks and automatic counting: F06 (this spec defines the link F06 fills; until F06, task counts are 0).
  - Generating tasks for a new project or for each retainer cycle: F07 and A02 (task part, Phase 2).
  - Published posts counting toward the counter: F08.
  - Invoices from milestones, retainer fees and extra work, and marking them billed automatically: F13 (A02 invoice part, Phase 3).
  - Creating projects or retainers from an accepted quote: F04 and A01.
  - Sent alerts and reminders (behind cycle A09, renewal due, new project manager): F14 and Phase 2.
  - Prorating quantities or fees for a partial first month; automatic carry-over of missing deliverables (owner decisions: both manual).
  - Gantt charts, time tracking, project expenses and margin (F13 optional expenses).

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
One permission pair covers both projects and retainers.
- `projects.read` becomes `all` for Employee, so every active user sees every project and retainer, without money fields (owner decision). The now redundant `projects.read` grants of Department Manager (`department`), Account Manager (`own_clients`) and Finance (`all`) are removed.
- `projects.manage`: General Manager `all` (unchanged); new department capability for the Internal Operations **manager** `all`; Account Manager `own_clients` (new: projects and retainers of clients they are primary account manager of); Employee `assigned` (new: projects the user is project manager of; never retainers). The Department Manager grant (`department`) is removed: department managers read only (owner decision).
- `invoices.read`: new department capability for the Internal Operations manager, `all` (ADR 0007: Operations owns invoicing). F13 builds on it.
- **Money access** on a client's project or retainer means holding `invoices.read` with a scope that covers the client (`all`, or `own_clients` for its account manager). Without it, money fields are omitted from responses and money inputs are refused (403).
- **Scope all** below means `projects.manage` with scope `all` (General Manager, Operations manager). **Client scope** means `all` or `own_clients` covering the client. `assigned` (project manager) is enough only where the table says so.

### F05 actions
| Action | Permission | Roles and scope |
|---|---|---|
| List and open projects, milestones, retainers, cycles, extra work (no money) | `projects.read` | Every active user: all |
| See money fields | `invoices.read` covering the client | General Manager, Finance, Operations manager: all · Account Manager: own_clients |
| Create a project or retainer | `projects.manage` (client scope) | General Manager, Operations manager: all · Account Manager: own_clients |
| Edit project name, description, departments, dates | `projects.manage` | client scope · project manager (assigned) |
| Change the project manager | `projects.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Project status: start, hold, resume, complete | `projects.manage` | client scope · project manager |
| Cancel a project | `projects.manage` (client scope) | not the project manager alone |
| Reopen a completed or cancelled project | `projects.manage` (scope all) | General Manager, Operations manager |
| Add, edit, reorder, remove, complete and reopen milestones | `projects.manage` | client scope · project manager |
| Edit retainer basics, deliverable lines, status | `projects.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Reactivate an ended retainer | `projects.manage` (scope all) | General Manager, Operations manager |
| Edit a cycle's committed quantities, add a line to a cycle, adjust delivered counts | `projects.manage` (client scope) | as above |
| Log and edit extra work (no money) | `projects.manage` | client scope · project manager (on their project) |
| Set money fields: project currency, installments, monthly fee, extra work estimate, billing status | `projects.manage` (client scope) + money access | General Manager, Operations manager · the client's account manager |
| Archive and restore a project or retainer; see archived ones | `projects.manage` (scope all) | General Manager, Operations manager |

"Operations manager" means the manager of Internal Operations, as in F01 and F02.

## Data

Module ownership: the `projects` module owns every table below, for projects and retainers alike. Both share permissions, extra work and the client profile tabs, so the separate `retainers` module listed in `docs/architecture.md` is merged into `projects`. It reads users through `auth`'s `UserDirectory`, clients and contacts through a service that `clients` exports (F05 adds it; `clients/index.ts` exports only the module today), and registers the project manager check in `auth`'s `ResponsibilityRegistry`.

Dates without a time (`date`) are calendar days in Asia/Damascus. Money fields are integer minor units in the record's currency (ADR 0006); `currency` is `currencySchema` (`SYP`, `USD`), a new shared schema in `packages/contracts/src/money.ts`. `SYP` means the new Syrian pound (owner decision, was Q8). Both currencies use 2 decimal places in V1.

### `projects` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `name` | text | required, trimmed, 1–120 chars; unique case-insensitively per client among non-archived projects |
| `description` | text | optional, ≤ 2000 chars |
| `project_manager_id` | uuid → `users.id` | required, indexed |
| `departments` | department code[] | required, 1–10 distinct codes; GIN-indexed for the filter |
| `status` | enum `project_status` (`planned`, `active`, `on_hold`, `completed`, `cancelled`) | required, default `planned`, indexed |
| `start_date` | date | required |
| `due_date` | date | required, ≥ `start_date` |
| `currency` | `currency` enum | required, default `USD`; the currency of every installment and extra work estimate on the project |
| `completed_at` | timestamptz | set when completed, cleared on reopen |
| `cancelled_at`, `cancel_reason` | timestamptz, text | set when cancelled (reason required, 1–500 chars), cleared on reopen |
| timestamps, `archived_at` | | archived = entered by mistake: hidden from lists and pickers, read-only, visible to scope-all holders only |

### `project_milestones` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `project_id` | uuid → `projects.id` | required, indexed |
| `name` | text | required, trimmed, 1–80 chars |
| `position` | integer | required; order within the project, dense from 1 among non-archived milestones |
| `due_date` | date | optional |
| `status` | enum `milestone_status` (`pending`, `done`) | required, default `pending` |
| `done_at`, `done_by_id` | timestamptz, uuid → `users.id` | set when completed, cleared on reopen |
| `installment_minor` | bigint | optional, ≥ 0; in the project's currency; money field |
| timestamps, `archived_at` | | archived = removed from the project (only while `pending`) |

At most 30 non-archived milestones per project. The new-project form offers the suggested set discovery, design, build, test, delivery (names in the UI language), editable before saving.

### `retainers` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `name` | text | required, trimmed, 1–120 chars (e.g. "Social media management"); unique case-insensitively per client among non-archived retainers |
| `departments` | department code[] | required, 1–10 distinct codes |
| `status` | enum `retainer_status` (`active`, `paused`, `ended`) | required, default `active`, indexed |
| `start_date` | date | required; editable only while the retainer has no cycle |
| `renewal_date` | date | optional, > `start_date`; a reminder only (rule R6) |
| `ended_on` | date | set when ended, cleared on reactivation |
| `currency` | `currency` enum | required, default `USD`; currency of the fee and extra work estimates |
| `monthly_fee_minor` | bigint | optional, ≥ 0; money field |
| timestamps, `archived_at` | | archived = entered by mistake, as for projects |

There is no separate owner: the retainer's responsible person is the client's account manager (owner decision).

### `retainer_deliverables` (business table; the retainer's standing lines)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `retainer_id` | uuid → `retainers.id` | required, indexed |
| `kind` | enum `deliverable_kind` (`design`, `reel`, `story`, `post`, `video`, `photo_shoot`, `ad_campaign`, `monthly_report`, `other`) | required. `post` covers single posts and carousels |
| `label` | text | optional, 1–60 chars; required when `kind` is `other` |
| `monthly_quantity` | integer | required, 1–999 |
| `position` | integer | display order |
| timestamps, `archived_at` | | archived = removed from the retainer; future cycles no longer include it |

`(kind, lower(label))` is unique among a retainer's non-archived lines (a null label counts as one value). At most 20 non-archived lines per retainer.

### `retainer_cycles` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `retainer_id` | uuid → `retainers.id` | required |
| `month` | date | required, the first day of the calendar month; unique with `retainer_id` |
| `period_start` | date | required; the 1st, or the day the retainer started or resumed |
| `period_end` | date | required; the last day of the month, or the day the retainer ended |
| `status` | enum `cycle_status` (`open`, `closed`) | required, default `open` |
| `closed_at` | timestamptz | set on close |
| timestamps | | cycles are never archived; they are archived with their retainer |

### `retainer_cycle_lines` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `cycle_id` | uuid → `retainer_cycles.id` | required, indexed |
| `deliverable_id` | uuid → `retainer_deliverables.id` | optional; null for a line added to this cycle only |
| `kind`, `label` | as in `retainer_deliverables` | copied when the cycle is created, so later edits to the retainer do not rewrite history |
| `committed_quantity` | integer | required, 0–999 |
| `delivered_at_close` | integer | set when the cycle closes (rule R8) |
| `position` | integer | display order |

At most 30 lines per cycle; the same uniqueness as the retainer's lines.

### `retainer_cycle_adjustments` (business table, append-only)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `line_id` | uuid → `retainer_cycle_lines.id` | required, indexed |
| `delta` | integer | required, non-zero, −999…999 |
| `reason` | text | required, trimmed, 1–300 chars |
| `author_id` | uuid → `users.id` | required; set from the session |
| `created_at` | timestamptz | |

Adjustments are corrected by a new adjustment, never edited or removed.

### `extra_work_items` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `project_id` / `retainer_id` | uuid → `projects.id` / `retainers.id` | exactly one is set (check constraint); both indexed |
| `title` | text | required, trimmed, 1–160 chars |
| `description` | text | optional, ≤ 2000 chars |
| `requested_on` | date | required, default today; not in the future |
| `requested_by_contact_id` | uuid → `client_contacts.id` | optional; a non-archived contact of the same client when set |
| `estimate_minor` | bigint | optional, ≥ 0; in the project's or retainer's currency; money field |
| `billing_status` | enum `extra_work_billing` (`unbilled`, `billed`, `waived`) | required, default `unbilled`; changes need money access |
| `billing_note` | text | optional, ≤ 300 chars; required for `waived` (why it is free) and for `billed` (the invoice reference, until F13 links invoices) |
| `logged_by_id` | uuid → `users.id` | required; set from the session |
| timestamps, `archived_at` | | archived = entered by mistake: hidden |

### Links F06 fills
F06 adds `project_id`, `milestone_id` (optional), `retainer_cycle_id` and `cycle_line_id` (optional) to tasks. The `projects` module defines a `WorkProgressSource` interface (task counts per project, milestone and cycle line: total non-archived, delivered, open) that the `tasks` module registers into, the same pattern as `ResponsibilityRegistry`, so `projects` never imports `tasks`. Until F06 registers, counts are 0. "Delivered" means F06's `delivered` status.

## States and rules

### Project status
```
planned ──start──→ active ⇄ on_hold
planned | active | on_hold ──cancel (client scope, reason)──→ cancelled
active ──complete (all milestones done)──→ completed
completed | cancelled ──reopen (scope all)──→ active
(any) ──archive (scope all)──→ archived ──restore──→ same status
```

### Retainer status
```
active ⇄ paused
active | paused ──end──→ ended            (sets ended_on = today, closes the open cycle)
ended ──reactivate (scope all)──→ active   (clears ended_on, creates the current month's cycle)
(any) ──archive (scope all)──→ archived ──restore──→ same status
```

### Cycle status
`open → closed`, by the daily job after `period_end`, or at once when the retainer ends. A closed cycle never reopens.

### Project rules
1. A project or retainer is created only for a non-archived client whose status is `active` or `paused` (`CLIENT_ARCHIVED`, `CLIENT_ENDED`).
2. The project manager must be a non-archived user (`INVALID_PROJECT_MANAGER`); an `invited` user qualifies. Changing it requires client scope; the project manager cannot hand the project to someone else.
3. The `assigned` scope of `projects.manage` covers the non-archived projects whose `project_manager_id` is the user. A change of project manager applies on the next request.
4. A user who is project manager of a non-archived `planned`, `active` or `on_hold` project cannot be archived until each such project gets another project manager (`USER_HAS_RESPONSIBILITIES`, type `project_manager_of_project`). Completed and cancelled projects do not block.
5. `due_date` ≥ `start_date` (`INVALID_DATES`). A milestone due date after the project's due date is allowed and shown with a warning.
6. Only the transitions in the diagram are allowed (`INVALID_TRANSITION`). Completing requires every non-archived milestone to be `done` (`MILESTONES_OPEN`, listing them); a project with no milestones may complete.
7. A `completed` or `cancelled` project is read-only, including milestones, extra work and its tasks' reopening or restoring (F06), until reopened (`PROJECT_CLOSED`). An archived project is read-only except restore (`PROJECT_ARCHIVED`).
8. Completing a milestone that has open tasks (F06) is refused with `MILESTONE_HAS_OPEN_TASKS` and the count unless the request confirms; the UI shows the warning and asks. A done milestone can be reopened (F13 will refuse once it is invoiced). Only a `pending` milestone can be removed.
9. Progress: `deliveredTasks / totalTasks` of the project's non-archived tasks, as a whole percentage rounded down, or null with no tasks; shown next to "milestones done/total".
10. A project is overdue when its status is `planned`, `active` or `on_hold` and `due_date` is before today; a milestone is overdue when `pending` with a past due date. Both are shown as badges.

### Retainer rules
- R1. A client may have several retainers, including several active ones.
- R2. The daily cycle job (00:05 Asia/Damascus) is idempotent. For every non-archived retainer of a non-archived client it (a) closes each open cycle whose `period_end` is before today, and (b) when the retainer is `active`, its `start_date` ≤ today and it has no cycle for the current month, creates it. It writes the same cycles a late or repeated run would, so a missed day is caught up on the next run (only the current month is created; past months missed while the worker was down are not back-filled).
- R3. Creating a retainer whose `start_date` ≤ today, resuming a paused retainer, and reactivating an ended one create the current month's cycle at once in the same transaction, if none exists. `period_start` is that day for the first cycle of a mid-month start (and for a cycle opened by resuming or reactivating); later cycles start on the 1st. Moving a retainer's start date to today or earlier (allowed only before its first cycle) opens the cycle at once too. Reactivating in the month the retainer ended keeps that month's closed cycle; the job opens the next month's.
- R4. A new cycle copies the retainer's non-archived lines with their full `monthly_quantity`, including a partial first month (no prorating; owner decision). Quantities are then editable on the cycle.
- R5. Pausing keeps the open cycle until month end; no cycle is created while paused. Ending closes the open cycle at once with `period_end` = today.
- R6. `renewal_date` never changes status or cycles. The UI shows "renewal due" from 30 days before it and "renewal overdue" after it while the retainer is not `ended`. Updating the date clears the badge.
- R7. Delivered count of an open cycle line = F06 tasks linked to the line with status `delivered` + the sum of its adjustments. An adjustment that would make it negative is refused (`NEGATIVE_DELIVERED`). Delivered may exceed committed (shown as over-delivery).
- R8. When a cycle closes, each line's `delivered_at_close` freezes its delivered count. Later deliveries of that cycle's tasks do not change it (the delivery rate of a closed month never changes); they are shown on the closed cycle as "delivered after close".
- R9. Committed quantities, added lines and adjustments are allowed only on an open cycle (`CYCLE_CLOSED`) and each needs a reason. Missing deliverables are not carried over automatically; to compensate, raise the quantity on the next cycle with a reason (owner decision).
- R10. Editing the retainer's lines (add, change quantity, remove) applies from the next cycle; the open cycle is edited separately (R9).
- R11. **Behind** (`isLineBehind`, a pure function in `packages/contracts` reused by A09): on an open cycle of an `active` retainer, with `elapsed` = days from `period_start` to today inclusive ÷ days in the period, a line with `committed_quantity` > 0 is behind when `delivered / committed < elapsed − 0.25`, or when 7 days or fewer remain in the period (today included) and `delivered < committed`. A cycle is behind when any line is behind.
- R12. An `ended` retainer is read-only except reactivation; an archived one except restore (`RETAINER_ENDED`, `RETAINER_ARCHIVED`).
- R13. A retainer's delivery rate for a cycle = Σ min(delivered, committed) ÷ Σ committed over its lines, a whole percentage rounded down (null when nothing is committed). Over-delivery on one line does not hide a shortfall on another.

### Extra work and money rules
- M1. Money fields are omitted from every response for callers without money access, and any request that sets one is refused with 403 for them.
- M2. The currency of a project or retainer can change only while none of its installments, fee or estimates is set (`CURRENCY_LOCKED`); amounts are never converted.
- M3. Extra work can be logged on an `active`, `on_hold` or `planned` project and on an `active` or `paused` retainer. `billing_status` changes need money access; `waived` and `billed` need `billing_note`. Billing stays open on completed and cancelled projects and on ended retainers (work is billed after it is done), but not on archived ones. A request date in the future is refused with `INVALID_DATES`. F13 will set `billed` with an invoice link; until then it is set by hand.
- M4. A retainer without a monthly fee, and an active project whose milestones have no installment, show "fee missing" / "installments missing" to users with money access.

### General
- G1. Every change writes an audit entry in the same transaction; the cycle job writes entries with a null actor.
- G2. Archiving a client (F02) hides its projects and retainers with it: they are read-only, excluded from lists and pickers, and the cycle job skips them. Restoring the client shows them again. F02 does not block archiving on them (archive is for clients entered by mistake).
- G3. A client's status (`paused`, `ended`) does not change its projects or retainers; the client profile shows a warning when an ended client still has active work.

## API

Schemas live in `packages/contracts/src/projects.ts`, `retainers.ts`, `extra-work.ts` and `money.ts`, reusing the shared list and error schemas. Lists take `page` and `pageSize` and return `{ items, total, page, pageSize }`. A record outside the caller's read access (archived, for callers without scope all) is a 404. Detail responses carry `permissions` flags (`canManage`, `canChangeManager`, `canCancel`, `canReopen`, `canArchive`, `canSeeMoney`, `canEditMoney`) for the UI, and a `money` object only when `canSeeMoney`.

### Projects
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/projects` | `projects.read` | `projectListQuerySchema`: `search` (name, client name), `status[]` (default `planned`, `active`, `on_hold`), `clientId`, `projectManagerId`, `department`, `overdue`, `archived` (scope all), `sort` (`dueDate` default, `name`, `createdAt`), `order` | `projectPageSchema`: id, name, client (id, name), project manager (id, name, archived), departments, status, dates, `overdue`, `milestoneProgress { done, total }`, `progress` | — |
| `GET /api/projects/:id` | `projects.read` | — | `projectDetailSchema`: list fields + description, milestones (with `overdue`, task counts, and `installmentMinor` inside `money`), `money { currency, totalMinor }`, `archivedAt`, `permissions` | 404 |
| `POST /api/projects` | `projects.manage` (client scope) | `createProjectSchema`: clientId, name, description, projectManagerId, departments, startDate, dueDate, status (`planned` default or `active`), currency, milestones[] (name, dueDate, installmentMinor) | `projectDetailSchema` | 403, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `INVALID_PROJECT_MANAGER`, `INVALID_DATES`, `PROJECT_NAME_TAKEN`, `LIMIT_REACHED` |
| `PATCH /api/projects/:id` | `projects.manage` | `updateProjectSchema`: name, description, departments, startDate, dueDate; projectManagerId (client scope); currency (money) | `projectDetailSchema` | 403, 404, `PROJECT_CLOSED`, `PROJECT_ARCHIVED`, `INVALID_PROJECT_MANAGER`, `INVALID_DATES`, `PROJECT_NAME_TAKEN`, `CURRENCY_LOCKED` |
| `POST /api/projects/:id/status` | `projects.manage` | `projectStatusChangeSchema`: status, reason (required for `cancelled`), projectManagerId (reopening only, to replace an archived manager; edge case 8) | `projectDetailSchema` | 403, 404, `INVALID_TRANSITION`, `MILESTONES_OPEN`, `PROJECT_ARCHIVED` |
| `POST /api/projects/:id/archive` · `/restore` | `projects.manage` (scope all) | — | `projectDetailSchema` | 403, 404, `PROJECT_ARCHIVED` / `PROJECT_NOT_ARCHIVED`, `PROJECT_NAME_TAKEN`, `CLIENT_ARCHIVED` |
| `POST /api/projects/:id/milestones` | `projects.manage` | `createMilestoneSchema`: name, dueDate, installmentMinor (money) | `milestoneSchema` | 403, 404, `PROJECT_CLOSED`, `PROJECT_ARCHIVED`, `LIMIT_REACHED` |
| `PATCH /api/projects/:id/milestones/:milestoneId` | `projects.manage` | `updateMilestoneSchema` (same, optional) | `milestoneSchema` | 403, 404, `PROJECT_CLOSED`, `PROJECT_ARCHIVED` |
| `PUT /api/projects/:id/milestones/order` | `projects.manage` | `{ ids: uuid[] }`, every non-archived milestone once | milestone list | 403, 404, `PROJECT_CLOSED`, `INVALID_ORDER` |
| `POST /api/projects/:id/milestones/:milestoneId/complete` | `projects.manage` | `{ confirmOpenTasks?: boolean }` | `milestoneSchema` | 403, 404, `PROJECT_CLOSED`, `MILESTONE_DONE`, `MILESTONE_HAS_OPEN_TASKS` (with `openTasks`) |
| `POST /api/projects/:id/milestones/:milestoneId/reopen` | `projects.manage` | — | `milestoneSchema` | 403, 404, `PROJECT_CLOSED`, `MILESTONE_NOT_DONE` |
| `POST /api/projects/:id/milestones/:milestoneId/archive` | `projects.manage` | — | 204 | 403, 404, `PROJECT_CLOSED`, `MILESTONE_DONE` |

### Retainers
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/retainers` | `projects.read` | `retainerListQuerySchema`: `search`, `status[]` (default `active`, `paused`), `clientId`, `accountManagerId`, `department`, `behind`, `renewalDue`, `archived` (scope all), `sort` (`clientName` default, `name`, `renewalDate`), `order` | `retainerPageSchema`: id, name, client (id, name), account manager (id, name), departments, status, renewal date and badge, current cycle summary (`deliveryRate`, `behind`, lines as `kind`, `label`, `delivered`, `committed`) | — |
| `GET /api/retainers/:id` | `projects.read` | — | `retainerDetailSchema`: list fields + start date, `endedOn`, deliverable lines, current cycle (lines with `delivered`, `committed`, `behind`, task counts), `money { currency, monthlyFeeMinor }`, `archivedAt`, `permissions` | 404 |
| `POST /api/retainers` | `projects.manage` (client scope) | `createRetainerSchema`: clientId, name, departments, startDate, renewalDate, currency, monthlyFeeMinor (money), deliverables[] (kind, label, monthlyQuantity) | `retainerDetailSchema` | 403, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `RETAINER_NAME_TAKEN`, `INVALID_DATES`, `DUPLICATE_DELIVERABLE`, `LIMIT_REACHED` |
| `PATCH /api/retainers/:id` | `projects.manage` (client scope) | `updateRetainerSchema`: name, departments, startDate, renewalDate, currency and monthlyFeeMinor (money) | `retainerDetailSchema` | 403, 404, `RETAINER_ENDED`, `RETAINER_ARCHIVED`, `RETAINER_STARTED` (start date with cycles), `INVALID_DATES`, `RETAINER_NAME_TAKEN`, `CURRENCY_LOCKED` |
| `PUT /api/retainers/:id/deliverables` | `projects.manage` (client scope) | `{ lines: { id?, kind, label, monthlyQuantity }[] }`; lines left out are archived | deliverable lines | 403, 404, `RETAINER_ENDED`, `RETAINER_ARCHIVED`, `DUPLICATE_DELIVERABLE`, `LIMIT_REACHED` |
| `POST /api/retainers/:id/status` | `projects.manage` (client scope; reactivation scope all) | `{ status }` | `retainerDetailSchema` | 403, 404, `INVALID_TRANSITION`, `RETAINER_ARCHIVED` |
| `POST /api/retainers/:id/archive` · `/restore` | `projects.manage` (scope all) | — | `retainerDetailSchema` | 403, 404, `RETAINER_ARCHIVED` / `RETAINER_NOT_ARCHIVED`, `RETAINER_NAME_TAKEN`, `CLIENT_ARCHIVED` |
| `GET /api/retainers/:id/cycles` | `projects.read` | page | `cyclePageSchema`, newest first: month, period, status, `deliveryRate`, lines (`delivered`, `committed`, `deliveredAfterClose`) | 404 |
| `GET /api/retainers/:id/cycles/:cycleId` | `projects.read` | — | `cycleDetailSchema`: lines with task counts and adjustments (delta, reason, author, time) | 404 |
| `PATCH /api/retainers/:id/cycles/:cycleId/lines/:lineId` | `projects.manage` (client scope) | `{ committedQuantity, reason }` | `cycleLineSchema` | 403, 404, `CYCLE_CLOSED`, `RETAINER_ENDED`, `RETAINER_ARCHIVED` |
| `POST /api/retainers/:id/cycles/:cycleId/lines` | `projects.manage` (client scope) | `{ kind, label, committedQuantity, reason }` | `cycleLineSchema` | 403, 404, `CYCLE_CLOSED`, `DUPLICATE_DELIVERABLE`, `LIMIT_REACHED` |
| `POST /api/retainers/:id/cycles/:cycleId/lines/:lineId/adjustments` | `projects.manage` (client scope) | `{ delta, reason }` | `cycleLineSchema` | 403, 404, `CYCLE_CLOSED`, `NEGATIVE_DELIVERED`, `LIMIT_REACHED` (100 per line) |

### Extra work
The same five endpoints under `/api/projects/:id/extra-work` and `/api/retainers/:id/extra-work`:

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET …/extra-work` | `projects.read` | `extraWorkListQuerySchema`: `billingStatus[]`, page | `extraWorkPageSchema`, newest `requestedOn` first: title, description, requested on, contact (id, name, archived), logged by, `billingStatus`, `billingNote`, `money { estimateMinor, currency }` | 404 |
| `POST …/extra-work` | `projects.manage` | `createExtraWorkSchema`: title, description, requestedOn, requestedByContactId, estimateMinor (money) | `extraWorkSchema` | 403, 404, `PROJECT_CLOSED` / `RETAINER_ENDED`, `…_ARCHIVED`, `UNKNOWN_CONTACT` |
| `PATCH …/extra-work/:itemId` | `projects.manage` | same fields, optional | `extraWorkSchema` | same |
| `POST …/extra-work/:itemId/billing` | `projects.manage` (client scope) + money access | `{ billingStatus, billingNote }` | `extraWorkSchema` | 403, 404, `BILLING_NOTE_REQUIRED` |
| `POST …/extra-work/:itemId/archive` | `projects.manage` | — | 204 | 403, 404 |

Changes to other modules:
- F01: `POST /api/users/:id/archive` returns `USER_HAS_RESPONSIBILITIES` with `{ type: 'project_manager_of_project', id, name }` items (rule 4); `responsibilitySchema` gains the type.
- F02: `clients` exports a service for `projects`: a client's id, name, status, archived state and account manager, and whether a contact is a non-archived contact of the client. The client profile gains the two tabs below.
- The project manager picker uses the existing `GET /api/users` (non-archived users).

## Screens

All screens: Arabic RTL, strings through i18next (`projects.*`, `retainers.*`), dates in Asia/Damascus with Latin digits, money formatted with its currency, loading, empty and error states. Navigation shows "Projects" and "Retainers" to every user. Money columns and inputs appear only with money access.

1. **Project list** `/projects` — table: name, client, project manager, departments, status badge, due date (overdue badge), milestones done/total, progress bar (hidden until F06 provides tasks). Filters: status (default open statuses), client, project manager, department, overdue; "My projects" toggle (project manager is me). "New project" for users who can create on some client. Scope all: "Archived" filter. Empty: "no projects match" / "no projects yet".
2. **New project** `/projects/new` (also from the client profile with the client preset) — client (picker of active and paused clients the user may manage), name, description, project manager, departments, start and due dates, status (planned or active), currency (money access), milestones editor with the suggested set, a due date and an installment each (money access), showing the total. On success, opens the project.
3. **Project page** `/projects/$projectId` — header: name, client link, status, project manager, departments, dates, overdue badge, progress and milestones done/total; actions by permission: edit (dialog), status actions (start, hold, resume, complete, cancel with reason, reopen), archive / restore. Closed and archived projects show a banner and no edit actions. Tabs (kept in the URL):
   - **Milestones** — ordered list: name, due date (overdue badge), status, done by and when, installment (money access), task counts (F06). Add, edit, reorder (drag and up/down buttons), remove (pending only), complete (with the open-tasks warning), reopen. Total of installments and "installments missing" warning (money access).
   - **Extra work** — list with billing status badges and estimates (money access); log, edit, archive; "mark billed / waived / unbilled" (money access). Empty: "no extra work logged".
   F06 adds a **Tasks** tab.
4. **Retainer list** `/retainers` — rows: client, name, account manager, status, current cycle as compact counters ("designs 9/12 · reels 2/4 · monthly report 0/1"), delivery rate, "behind" badge, renewal badge. Filters: status (default active + paused), client, account manager, department, behind, renewal due; "My clients" toggle for account managers. "New retainer" for users who can create.
5. **New retainer** `/retainers/new` (also from the client profile) — client, name, departments, start date, renewal date, currency and monthly fee (money access), deliverable lines (kind picker with icons, label for "other", monthly quantity). Shows that a start date today or earlier creates this month's cycle with full quantities.
6. **Retainer page** `/retainers/$retainerId` — header: client link, name, status, account manager, departments, start and renewal dates with badge, monthly fee (money access); actions: edit, edit deliverable lines, pause / resume / end (confirmation) / reactivate, archive / restore. Tabs:
   - **This month** — the open cycle: period, days left, delivery rate, one row per line with a progress bar `delivered/committed`, "behind" and "over-delivered" badges, task counts (F06); actions: change committed quantity (reason), add a line for this month (reason), adjust delivered (+/−, reason); adjustments history per line. When there is no open cycle (paused, ended, not started): an explanation instead.
   - **History** — closed cycles newest first: month, delivery rate, per-line `delivered_at_close/committed`, "delivered after close" counts; opens a cycle's detail.
   - **Extra work** — as on the project page.
7. **Client profile** (F02) — new tabs **Projects** (the client's projects, open ones first, with "New project") and **Retainers** (the client's retainers with their current counters and "New retainer"); a warning when an ended client still has active work (G3).

What roles see differently: everyone sees the same pages without money; edit actions follow the actions table; money appears with money access.

## Audit, notifications and jobs
- Audit actions: `project.created`, `project.updated`, `project.project_manager_changed`, `project.status_changed` (with reason), `project.money_updated` (currency), `project.archived`, `project.restored`; `project_milestone.created` / `updated` / `reordered` / `completed` / `reopened` / `archived` (entity `project_milestone`, `after` carries `projectId`); `retainer.created`, `retainer.updated`, `retainer.status_changed`, `retainer.deliverables_updated` (before/after lines), `retainer.money_updated`, `retainer.archived`, `retainer.restored`; `retainer_cycle.created`, `retainer_cycle.closed` (with delivered counts), `retainer_cycle.line_updated`, `retainer_cycle.line_added`, `retainer_cycle.adjusted` (entity `retainer_cycle`, `after` carries `retainerId`); `extra_work.created` / `updated` / `billing_changed` / `archived` (entity `extra_work`, `after` carries `projectId` or `retainerId`). One PATCH that changes several kinds of fields writes one entry per action.
- Money values in audit entries are visible only to readers who also have money access. Every holder of `audit.read` (General Manager, Operations manager) also holds `invoices.read` with scope all, so the audit log shows entries unfiltered; the audit log screen links entries to their project or retainer page. `project_milestone.reordered` writes one entry per moved milestone (`position` before and after).
- Notifications: none (F14 is not built). Later: A09 alerts the account manager and the Operations manager when a cycle is behind (R11); F14 decides renewal-due and new-project-manager notifications.
- Jobs: `retainers.cycles`, pg-boss cron `5 0 * * *` in Asia/Damascus, scheduled by `apps/worker` and worked by the API process, which runs rule R2 through the `projects` module's `RetainerCyclesService` (ADR 0008 as amended for F05: the API knows F06's task counts); idempotent (unique `retainer_id + month`, closes only open cycles).

## Edge cases
1. Two people edit the same project, milestone or retainer: last write wins; each change writes its own audit entry. Two adjustments at once both apply (they are additive).
2. The job runs twice, or the API creates a cycle while the job runs: the unique `(retainer_id, month)` index keeps one cycle; the loser does nothing.
3. The worker is down on the 1st: the next run closes last month's cycles and creates this month's (R2); the closed cycle's counts freeze at that later time, which may include deliveries made after month end. The closed cycle's audit entry records when it closed.
4. A retainer starts on the 31st: its first cycle is one day long with full quantities; the account manager lowers them if agreed (R4).
5. A retainer is paused and resumed in the same month: the same cycle continues. Paused across a whole month: no cycle for that month; history shows the gap.
6. A retainer is ended on the 1st before the job: ending closes the open cycle of the previous month too (every open cycle closes).
7. A deliverable line is removed while the current cycle has it: the cycle keeps its line (R10); tasks linked to it still count.
8. The project manager is archived: refused while they manage an open project (rule 4). A completed or cancelled project may keep an archived project manager, shown with an "archived" badge; reopening requires a valid one (`INVALID_PROJECT_MANAGER`); the reopen request may name a new project manager (owner decision), and the UI asks for one when the current one is archived. Restoring an archived project keeps its manager as it is; an archived one is then replaced with a normal edit.
9. The client's account manager changes: `own_clients` access to its projects and retainers moves at once, like F02.
10. A project manager loses access to a project (changed manager) while editing: the next edit returns 403 and the page refreshes.
11. A user without money access edits a milestone: money fields are neither shown nor sent; the saved installment is kept.
12. Currency change after amounts exist: refused (M2); amounts are never converted.
13. A milestone due date after the project due date: allowed, warned (rule 5).
14. Completing a project with a pending milestone that is no longer needed: remove it first (pending milestones can be removed), then complete.
15. A client is archived with open work: its projects and retainers disappear with it and the job skips them (G2); restoring the client brings them back and the next job run creates the missing current cycle.
16. Dates are compared in Asia/Damascus; a request at 00:30 local time on the 1st already belongs to the new month.
17. ~20 clients, a few dozen projects and retainers, and 12 cycles a year each need no special limits; list `pageSize` rules from ADR 0013 apply.

## Open questions
- None blocks F05. Q8 is resolved: `SYP` with 2 decimals is final (owner, 2026-09-29).
- F06 defines how tasks attach to milestones and cycle lines (the columns listed under "Links F06 fills"), and Q14 (Operations manager across departments) is answered in the F06 spec.

## Acceptance
- Owner check in the browser:
  1. Sign in as the General Manager. Open a client with an account manager.
  2. From the client's **Projects** tab, create a project: a project manager who is an ordinary employee, departments Design and Development, the five suggested milestones with installments in USD. The project opens as `planned` with the total of installments.
  3. Start the project; complete the first milestone; try to complete the project: refused, listing the open milestones.
  4. Sign in as the project manager in a private window: the project is editable (milestones, dates, extra work), but there is no "change project manager", no "cancel" and no money anywhere. Log an extra work item.
  5. Sign in as an ordinary employee: projects and retainers are visible without money and without edit actions.
  6. As the General Manager, try to archive the project manager's user: refused, listing the project.
  7. From the client's **Retainers** tab, create a retainer starting today: 12 designs, 4 reels, 1 monthly report, a monthly fee. This month's cycle appears at once with full quantities.
  8. Adjust designs by +3 with a reason: the counter shows 3/12 and the history of the adjustment; check the "behind" badge follows rule R11 for today's date.
  9. Raise reels to 5 for this month with a reason; pause and resume the retainer; the same cycle continues.
  10. As the account manager, mark the extra work item "waived" with a note; as Finance, see the fee and estimates but no edit actions.
  11. Open the audit log and find each change above.
- Tests:
  - Unit: contract schemas (dates, label required for `other`, duplicate lines, limits, money fields as non-negative integers); `isLineBehind` and delivery rate (R11, R13) at the period edges, partial first month and zero committed; project status transitions; permission map changes (`projects.read` all for every user, `projects.manage` for the Operations manager, the account manager and `assigned`, department manager grant removed, `invoices.read` for the Operations manager).
  - API (`apps/api/test/projects.test.ts`, `project-milestones.test.ts`, `retainers.test.ts`, `retainer-cycles.test.ts`, `extra-work.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; a project manager on someone else's project and on scope-only actions; an employee on manage endpoints; money fields omitted and money writes refused without money access); each error code above; rules 1–10, R2–R13, M1–M4, G2; audit entries written in the same transaction. The cycle service: creation on the 1st, mid-month start, pause across a month, end closes, idempotent re-run, frozen counts after close. `users.test.ts`: rule 4 on archive.
  - Worker: the `retainers.cycles` handler runs the service and is safe to run twice.
  - E2E: create a project with milestones and complete one; create a retainer and adjust a counter.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): project list, new project, project page (milestones, extra work), retainer list, new retainer, retainer page (this month, history), client profile Projects and Retainers tabs, the employee view without money.
