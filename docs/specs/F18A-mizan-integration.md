# F18A — Mizan integration (the Hub's side)

Status: Approved · Date: 2026-11-13 · Scope: `docs/product/v2-scope.md` §F18 (plan of 2026-11-13) · ADRs: 0006, 0013, 0018, 0024, 0025, 0028, 0035, 0037, 0043, 0044 · Mizan (read-only, `D:\vertex-mizan`): ADR 0006, 0008, 0014, 0017, 0019; open question Q5; specs S05, S06, S08, S09, S10

## Summary
Vertex Mizan is the agency's ledger and the Hub stays the operational system (ADR 0035). Mizan's `/v1` contract is implemented and deployed. F18A builds everything Mizan's open question Q5 lists for the Hub:
- every financial fact in the Hub becomes an event, written to an outbox in the change's transaction and delivered in order;
- the fields those events need, which the Hub lacks today;
- the closed-period check;
- held and refused events, shown to the General Manager and Finance;
- the daily reconciliation report;
- the opening snapshot as of 2026-09-30 and the replay of every event dated from 2026-10-01.

The Hub keeps working when Mizan is down, and nothing reaches Mizan twice.

## In scope / out of scope
- In:
  - **Required fields:** a service on every invoice line, the department frozen on each line, a service and a deposit flag on installment milestones, and a department on every project expense. Each has suggestions; the existing documents are completed by Finance through a readiness list.
  - **The outbox and its delivery** to `POST /v1/events`, with all twenty `/v1` event types the Hub produces.
  - **The period check** before an action dated in a closed month.
  - **The daily reconciliation** to `POST /v1/reconciliation/daily`.
  - **The opening snapshot** to `POST /v1/opening/snapshot`.
  - **The cutover:** the replay from the books start, after which capture goes live.
  - **The Mizan page** (`/mizan`): overview, events, reconciliation, readiness and the General Manager's actions.
  - **Status badges** on documents with a problem.
  - **Three notifications.**
  - **Notices to the accountant** for the two facts `/v1` cannot carry: a reopened project (Mizan Q16) and a retainer credit settled outside the Hub.
- Out:
  - **The cash box on a payment:** later, when Mizan adds cash boxes to `/v1`; payments carry the method only.
  - **Other features waiting on Mizan's additions:** purchases for clients and profitability shown in the Hub (F18 remainder).
  - **`project.reopened`:** sent once Mizan adds it.
  - **Tax lines:** Hub has none; `taxes[]` is never sent.
  - **Deferred manual lines:** a manual line is never marked `deferred`.
  - **Several companies or several Mizan clients:** the Hub is one company.
  - **Reading Mizan's ledger, inbox or reports** in the Hub, beyond event answers, period states and reconciliation answers.

## Roles and access
| Action | Permission | Roles and scope |
|---|---|---|
| See the Mizan page, events, reconciliation and readiness; see status badges | `mizan.read` (new) | General Manager: all · Finance: all (owner, 2026-11-13) |
| Send the snapshot, run the cutover, rebuild a refused event, retry delivery now, refresh period states | `mizan.manage` (new) | General Manager only (owner, 2026-11-13) |
| Complete the missing services and departments | existing: `invoices.manage` (line services), `projects.manage` (milestone service), `expenses.manage` (expense department) | as today |

The Internal Operations manager's department capabilities do not gain `mizan.*` (owner chose General Manager and Finance only).

## Data

### New tables (module `mizan`, a new api module; ADR 0044)
**`mizan_settings`**: one row, seeded by its migration.

| Column | Type | Notes |
|---|---|---|
| `singleton` | boolean PK | always true |
| `books_start` | date, required | `2026-10-01`; Mizan's books start for Vertex Media (Mizan ADR 0019) |
| `state` | enum `mizan_state` (`setup`, `live`), default `setup` | `live` after the cutover; never back |
| `capture_from` | timestamptz | set by the cutover |
| `cutover_by_id` | uuid → users | |
| `connection` | enum `mizan_connection` (`unknown`, `ok`, `failing`, `unauthorised`), default `unknown` | the last delivery or read's outcome |
| `last_success_at`, `last_failure_at` | timestamptz | |
| `last_error` | text ≤ 500 | the last failure, without the key |
| `failing_notified_at` | timestamptz | rule N2, once per outage |

**`mizan_events`**: the outbox. An event is never deleted or edited, except its delivery columns.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | UUIDv7; the `/v1` event id and its `Idempotency-Key` |
| `seq` | bigint identity, unique | Hub's order |
| `type` | text | a `/v1` type (`MIZAN_EVENT_TYPES`) |
| `version` | integer | 1 |
| `origin` | enum (`live`, `replay`, `rebuild`) | |
| `document_type` | enum (`invoice`, `payment`, `milestone`, `project`, `project_expense`, `ad_wallet_entry`, `ad_spend`, `rate`) | as Mizan's `documentOf()` |
| `document_id` | uuid | the Hub record; for `rate`, the settings entity id |
| `document_ref` | text ≤ 100 | the human number sent (rule E5) |
| `accounting_date` | date | rule E3 |
| `occurred_at` | timestamptz | |
| `payload` | jsonb | as sent |
| `delivery` | enum (`pending`, `delivered`, `refused`, `replaced`) | |
| `attempts` | integer, default 0 | |
| `next_attempt_at`, `last_attempt_at`, `delivered_at` | timestamptz | |
| `last_error` | text ≤ 500 | a transport failure |
| `mizan_status` | text | `posted`, `recorded`, `held`, `resolved`, `dismissed`, or an unknown value as received |
| `hold_reason`, `hold_detail` | text | |
| `inbox_id` | uuid | |
| `entries` | jsonb | `[{ id, fiscal_year, number }]` |
| `http_status` | integer | the refusing answer's status |
| `error_code` | text | the refusing answer's code |
| `error_body` | jsonb | the refusing answer's field errors |
| `replaced_by_id` | uuid → `mizan_events` | |
| `created_by_id` | uuid → users | the actor of the fact; null for jobs and the replay |
| `created_at`, `updated_at` | timestamptz | |

Indexes:
- `(seq)` where `delivery = 'pending'`;
- `(document_type, document_id)`;
- `(accounting_date)`;
- `(delivery, mizan_status)`.

**`mizan_periods`**: `month` text PK (`YYYY-MM`), `state` (`open`, `closed`), `read_at` timestamptz.

**`mizan_reconciliation_days`**:
- `date` date PK;
- `last_report_id` uuid, `last_sent_at` timestamptz;
- `status` text (`matched`, `differences`, `refused`);
- `gaps` integer;
- `differences` jsonb, `totals` jsonb (Mizan's answer as received);
- `error_body` jsonb.

**`mizan_snapshots`**:
- `id` uuid PK (its `Idempotency-Key`);
- `as_of` date;
- `sent_at`, `sent_by_id`;
- `counts` jsonb, `totals` jsonb (what Hub sent);
- `http_status` integer;
- `answer` jsonb.

The body itself is not kept, since it is recomputed on demand.

### Columns added to existing tables
| Table | Column | Notes |
|---|---|---|
| `invoice_lines` | `department` text → `departments.code`, null | frozen at issue from the line's service, and changed with the line's service (rule F2). Backfilled on issued lines from their service's current department |
| `project_milestones` | `service_id` uuid → `catalog_services`, null | required to complete a milestone with an installment above zero (rule F4) |
| `project_milestones` | `is_deposit` boolean, default false | set by A01 on the first-installment milestone. Backfilled `true` on milestones billed by an invoice of origin `quote_accepted` |
| `project_expenses` | `department` text → `departments.code`, null | required on create and edit (rule F5); null only on rows created before F18A until Finance completes them |

`catalog_services`, `retainer_charges`, `extra_work_items` and `projects` are unchanged:
- a retainer charge's cycle end comes from its cycle `(retainer_id, cycle_number)`;
- a void, a done or a completion date is the Asia/Damascus day of its timestamp.

### Contracts (`packages/contracts`)
- **`mizan.ts`:**
  - the `/v1` envelope and the twenty payload schemas, copied from Mizan's `packages/contracts/src/events.ts` (snake_case);
  - the outcome, the period status, the reconciliation report and answer, and the opening snapshot and its answer;
  - `mizanReconciliationAmount()`, as Mizan S08 rule 2;
  - the Hub-side enums;
  - the page's query and row schemas.
- **A contract test** validates Mizan's exported examples (`events-v1`, `reconciliation-example-v1`, `opening-snapshot-example-v1`, vendored under `packages/contracts/test/fixtures/mizan/` with the JSON Schema) against these schemas. Every payload the builders produce is checked against the vendored JSON Schema (Ajv, dev dependency). Refreshing the fixtures is one command, run in `D:\vertex-mizan`, and is documented in the fixtures' README.
- **`permissions.ts`:** `mizan.read` for the General Manager and Finance, scope `all`; `mizan.manage` for the General Manager.
- **Error codes:**
  - `MIZAN_PERIOD_CLOSED`, `INVOICE_LINE_SERVICE_REQUIRED`, `MILESTONE_SERVICE_REQUIRED`, `EXPENSE_DEPARTMENT_REQUIRED`;
  - `MIZAN_NOT_CONFIGURED`, `MIZAN_NOT_READY`, `MIZAN_SNAPSHOT_MISSING`, `MIZAN_ALREADY_LIVE`;
  - `MIZAN_EVENT_NOT_REBUILDABLE`, `MIZAN_UNAVAILABLE`.
- **Notification types:** `mizan_event_refused`, `mizan_delivery_failing`, `mizan_manual_entry_needed` (rules N1–N3).

### Configuration
G1. `MIZAN_API_URL` (`https://mizan.vertexmedia.pro/api` in production) and `MIZAN_API_KEY` in the api's `.env`, validated in `apps/api/src/core/config/env.ts`, never logged.
- **The integration is configured** when both are set.
- **Unconfigured** (development, tests, CI): nothing is captured, checked or sent, the Mizan page says so, and every `mizan.manage` action answers `MIZAN_NOT_CONFIGURED`.
- **A key rotation** replaces the variable and restarts the api; Mizan allows two active keys.

## States and rules

### The fields the events need (owner, 2026-11-13)
F1. **A service on every invoice line.**
- An invoice is not issued while a line has no service (`INVOICE_LINE_SERVICE_REQUIRED`, naming the lines). Drafts may lack one.
- `PUT /api/invoices/:id/services` no longer clears a service.
- **Suggestions** are filled on every draft, automatic or manual, and shown as suggested until Finance confirms by saving or issuing:
  - a milestone or deposit line: the milestone's service;
  - a retainer charge line (monthly, addition, credit, termination fee): the service of the retainer's accepted quote's monthly section when it has one service, else none;
  - an extra work line: none;
  - a manual line: none.

F2. **A line's department** is frozen when the invoice is issued: its service's department at that moment. A later change of the line's service sets the new service's department. A later change of the service's own department in the catalog does not touch issued lines.

F3. **Service changes on issued invoices** stay allowed (`PUT /services`) and each changed line sends `invoice.line_service_changed`. Before the cutover only, the same endpoint may also set a missing service on a **void** invoice's lines, so the replay can send it (rule P1). After the cutover a void invoice's lines are read-only, as today.

F4. **A service on every installment milestone** (owner, 2026-11-13):
- **Required** to complete a milestone whose installment is above zero (`MILESTONE_SERVICE_REQUIRED`). The milestone form asks for it when an installment is set.
- **Suggested:** A01 sets each created milestone's service to the service of the largest one-off line of the accepted quote. The project manager or Finance confirms or changes it on the milestone.
- **Locked while done:** after the cutover, a done milestone's installment and service are locked (`MILESTONE_DONE`). Reopening it (which sends `milestone.reopened`) unlocks them, since `/v1` has no milestone change event.

F5. **A department on every project expense** (owner, 2026-11-13):
- **Required** on create and on any edit (`EXPENSE_DEPARTMENT_REQUIRED`), and must be an active department.
- **Suggested:** the form preselects the project's department when it has one, and lists the project's departments first.

F6. **A deposit** is a milestone with `is_deposit`. Its invoice line is sent with source `deposit`; any other milestone line with source `milestone`, both with `milestone_id`.

F7. **Readiness.** Before the cutover, every document the snapshot or the replay will send must be complete. The readiness list shows each gap with a link to fix it, and the cutover is refused while it is not empty (`MIZAN_NOT_READY`). It lists:
- issued invoices, void included, issued on or after the books start, or included in the snapshot, with a line without a service;
- non-archived project expenses dated on or after the books start without a department;
- installment milestones of non-archived projects without a service.

### Events (Mizan ADR 0006, S05, S06)
E1. **Writing an event.** Each producing module builds its event from its own records and hands it to `MizanOutbox.append(tx, event)` (exported by `mizan/index.ts`), in the transaction of the change. Events are written only while `state` is `live` (rule P6). The table below lists every producer.

| Hub action | Event | Accounting date |
|---|---|---|
| Issue an invoice | `invoice.issued` | `issued_on` |
| Void an invoice | `invoice.voided` | the void day |
| Change a line's service on an issued invoice | `invoice.line_service_changed`, one per changed line | the change day |
| Change an invoice's due date | `invoice.due_date_changed` | the change day |
| Record a payment | `payment.recorded` | `paid_on` |
| Void a payment | `payment.voided` | the void day |
| Complete a milestone with an installment above zero | `milestone.done` | the done day |
| Reopen such a milestone | `milestone.reopened` | the reopen day |
| Complete or cancel a project | `project.completed` / `project.cancelled` | the day |
| Log a project expense | `project_expense.recorded` | `spent_on` |
| Edit it (any field) | `project_expense.changed`, full new state | the edit day |
| Archive it | `project_expense.archived` | the archive day |
| Record a wallet deposit or refund | `ad_wallet.deposited` / `.refunded` | the entry's date |
| Void a wallet entry | `ad_wallet.entry_voided` | the void day |
| Add a spend update to a wallet-funded campaign, spend above zero | `ad_spend.recorded` | `period_end` |
| Edit it | `ad_spend.changed`, full new state | the edit day |
| Archive it | `ad_spend.archived` | the archive day |
| Change the current rate | `rate.changed` | the change day |

E2. **Spend crossing zero:** an edit taking a spend update to zero sends `ad_spend.archived`, and one taking it from zero above zero sends `ad_spend.recorded`, since `/v1` amounts are positive. Edits on a `client_direct` campaign send nothing.

E3. **Accounting dates** follow Mizan S05 rule 13:
- a new document is dated on its own date;
- a void, a change, an archive, a done, a reopen or a completion is dated on the Asia/Damascus day it happens;
- `occurred_at` is the time of the change.

E4. **Payload fields** come from the records:
- **Amounts:** `*_minor` as JSON integers, rates as decimal strings, dates `YYYY-MM-DD`.
- **Dimensions:**
  - **client:** `{ external_id: id, name }`, no code;
  - **contract:** a project or a retainer, with `kind` and `client_external_id`, on invoices that name one and on expenses;
  - **department:** `{ external_id: code, name }`;
  - **service:** `{ external_id: id, name, department }` on invoice lines (the line's frozen department, rule F2), without `department` elsewhere.
- **Invoice lines:**
  - `amount` = quantity × unit price, a credit negative; `description`;
  - `source`: `retainer_charge` with `charge_kind`, `cycle_start` and `cycle_end`, `deposit` or `milestone` with `milestone_id`, `extra_work`, or `manual`;
  - `installment_total` on invoices with a deposit or milestone line: the project's non-archived, non-deposit installments;
  - a credit line also sends its charge's cycle.
- **Payments:** `applied_amount` = `applied_minor`, and `invoice_currency`.
- **Milestones:** `milestone.done` sends the installment, the project's currency and the milestone's service.

E5. **Human numbers** (`document_ref`, sent as `number`):
- **Documents with their own number:** invoices and receipts as printed (`INV-2026-0012`); wallet deposits by their receipt number.
- **Documents without one** get a stable reference from their id: `WR-` (wallet refund), `EXP-` (expense), `ADS-` (spend update), `CMP-` (campaign), `MS-` (milestone), each followed by the first 8 hex characters of the id.

The reference is shown on the Mizan page beside the document's name, so Finance and the accountant can match it.

E6. **Order:** `seq` is assigned at insert. Events written in one transaction keep the order the action produced them (an invoice's issue before anything else). Mizan orders each item's events by arrival (S05 rule 11), so arrival in `seq` order is Hub's order.

### Delivery (outbox to `/v1/events`)
D1. **One loop, in order.** A single loop delivers events in `seq` order, one at a time.
- **Trigger:** the singleton job `mizan.deliver`, queued by each commit that appends events and every minute by the worker's schedule.
- **Where it runs:** the api works the queue, as `invoices.daily`.

D2. **The request:** `POST {MIZAN_API_URL}/v1/events`, with:
- `Authorization: Bearer {MIZAN_API_KEY}`;
- `Idempotency-Key: <id>`;
- the envelope `{ id, type, version, occurred_at, accounting_date, payload }`;
- a 30-second timeout.

D3. **Answers:**

| Answer | `delivery` | Next |
|---|---|---|
| `201` `posted`, `recorded`, `resolved`, `dismissed` | `delivered`, with `mizan_status`, `inbox_id`, `entries` | the next event |
| `202` `held` | `delivered`, `mizan_status` `held`, `hold_reason`, `hold_detail` | the next event; Mizan retries it itself and Hub never resends it |
| `409` `PERIOD_CLOSED` | `delivered`, `mizan_status` `held`, `hold_reason` `PERIOD_CLOSED` | the next event |
| `422`, `413`, any other `409` | `refused`, with the status, code and field errors | the next event (D6); notification N1 |
| `503` `OPENING_NOT_POSTED`, `429` | stays `pending` | the same event after `Retry-After` (default one hour) |
| `401`, `403` | stays `pending`; `connection` `unauthorised` | the same event every 15 minutes; notification N2 |
| other `5xx`, timeout, network error | stays `pending`; `connection` `failing` | the same event after 30 s, 1, 2, 5, 10, 30 minutes, then every 30 minutes |

D4. **Unknown values:** an answer status, hold reason, detail or error code the Hub does not know is stored and shown as received, never a failure (Mizan ADR 0006 "Versioning"). An unknown `2xx` status counts as delivered.

D5. **A pending event blocks every later one.** Nothing is sent past an event without a `2xx` or `4xx` answer.

D6. **A refused event is a Hub defect** and does not block later ones:
- Mizan holds what depends on it (`UNKNOWN_REFERENCE`), and the reconciliation shows the gap.
- **The fix:** once the cause is fixed and deployed, the General Manager rebuilds the event. Hub builds the same type for the same document from its current state, with the same accounting date, under a new id (`origin` `rebuild`), appends it, and marks the refused event `replaced` with a link.
- **Nothing to rebuild:** a document voided or archived since builds nothing, and the rebuild is refused (`MIZAN_EVENT_NOT_REBUILDABLE`). The refused event then stays a gap for the accountant.

D7. **Never sent twice:** a retried request reuses the event's id, so Mizan answers a replay with the same result (Mizan S05 rule 4).

### Closed periods (Mizan ADR 0006 "Periods")
K1. **The refusal:** an action is refused `MIZAN_PERIOD_CLOSED` (`409`, naming the month) when an event it would write has an accounting date in a month Mizan reports closed. In practice that is a new document dated in a closed month: an invoice issued, a payment, a wallet entry, an expense, or a spend update ending there. Changes and voids are dated today (E3). The form shows it on the date field ("الشهر مقفل في ميزان").

K2. **Reading the states:** Hub reads month states from `mizan_periods`. The worker calls `GET /v1/periods/status` for the 24 months ending this month:
- every 15 minutes;
- after a `PERIOD_CLOSED` answer;
- when the General Manager presses "refresh".

A month never read counts as open.

K3. **Mizan unreachable** (owner, 2026-11-13): Hub decides on the last states it read and never waits for Mizan. A month closed since then ends as an event held `PERIOD_CLOSED`, which the accountant posts in the next open period (Mizan S05 rule 15).

K4. **When the check applies:** from the first successful read while configured, before and after the cutover. Months before the books start are closed in Mizan (S10 rule 4), so from then on Hub refuses a new document dated before 2026-10-01.

### Daily reconciliation (Mizan S08, ADR 0017)
C1. **The report** covers one accounting date: every event of `mizan_events` with that `accounting_date` except `replaced` ones, each `{ id, type, amount?, delivery, refusal_code? }`. The totals per type and currency are summed from the same list, and amounts follow `mizanReconciliationAmount()`.

C2. **When it is sent:** the daily job `mizan.reconcile` runs at 00:30 Asia/Damascus while `live`. It sends:
- yesterday's report, even with no events;
- the report of every earlier date on or after the books start that changed since its last report, meaning an event created with that date or one whose `delivery` changed.

A date with an event `pending` for less than an hour waits for the next run.

C3. **Each report** has a new UUIDv7 id as its `Idempotency-Key` and `generated_at` now. Hub stores Mizan's answer (`matched` or `differences`, gaps, differences, totals) on the date's row.

C4. **A refused report** (`422`) keeps the date's previous answer, sets `status` `refused` with the field errors, and sends N1.

C5. **At the cutover**, the reports of every date from the books start to yesterday are sent once the replay events are delivered.

### Opening snapshot (Mizan S10 rule 5, ADR 0019)
S1. **The computation:** the snapshot is as of the eve of the books start (`as_of` 2026-09-30), computed on demand from the current records in one read-only transaction:
- **invoices:**
  - which: issued on or before `as_of` and not voided on or before it, with either an amount outstanding at `as_of` (counting payments dated on or before it and not voided on or before it) or a line whose recognition is unfinished at `as_of` (a retainer charge whose cycle ends after it, or a deposit or milestone line whose milestone was not done by then);
  - with: their lines as `invoice.issued` sends them, the current due date (owner: final state), total and outstanding;
- **credits:** retainer credit lines issued on or before `as_of` on invoices not listed, for a cycle billed by a listed invoice;
- **milestones:** the installment milestones of projects with a listed invoice, and every installment milestone done on or before `as_of` and not billed by then, each with its service, installment, currency and `done_on` when done by `as_of`;
- **wallets:** each client's USD balance at `as_of`, non-zero only, negative allowed. It is deposits minus refunds dated on or before it and not voided on or before it, minus the spend of non-archived updates of wallet-funded campaigns ending on or before it;
- **prior_documents:** every invoice, payment, wallet entry, spend update, project expense and milestone done dated on or before `as_of`, with its date;
- the clients, contracts, services and departments referenced.

S2. **Archived documents** are absent: a discarded draft, an archived expense, an archived spend update.

S3. **Sending:** the General Manager sends it from the Mizan page (owner, 2026-11-13).
- Hub stores its counts, its totals and Mizan's answer.
- It may be sent again until Mizan answers `409 OPENING_POSTED`; each send is computed anew, and the latest counts in Mizan.

### Replay and cutover (Mizan S10 rules 27–28; ADR 0044)
P1. **What the replay sends:** every fact with an accounting date on or after the books start, built from the records as they stand at the cutover (owner, 2026-11-13: each document's final state, not every past edit):
- **Invoices:**
  - every invoice issued since the books start: `invoice.issued` with its current lines and services, then `invoice.voided` if void;
  - every void since the books start of an earlier invoice: `invoice.voided`. Mizan holds it `NEEDS_DECISION` `before_books_start`.
- **Payments:** every payment dated since the books start: `payment.recorded`, then `payment.voided` if void; and every void since then of an earlier payment.
- **Wallet entries:** every deposit or refund dated since the books start, then its void if any; and every void since then of an earlier entry.
- **Spend updates:** every non-archived update of a wallet-funded campaign ending since the books start with spend above zero: `ad_spend.recorded`.
- **Project expenses:** every non-archived expense dated since the books start: `project_expense.recorded`.
- **Milestones:** every installment milestone done now whose done day is since the books start: `milestone.done`.
- **Projects:** every project completed or cancelled now, on a day since the books start: `project.completed` or `.cancelled`.
- **Rates:** every change of the current rate since the books start, from the audit entries `invoice_settings.updated` holding `sypPerUsd`: `rate.changed`.

P2. **Folded history:** edits, archives, reopens and service or due-date changes made before the cutover send no event of their own; the documents' current state holds them.

P3. **Order:** by accounting date, then by the time the fact happened, then by the document's creation. An invoice's issue comes before its payments, and its void after them.

P4. **Ordinary events:** replayed events have `origin` `replay`, and `occurred_at` is the time the fact happened. The period check does not apply to them.

P5. **The cutover** (`POST /api/mizan/cutover`, General Manager). It is refused when:
- the integration is not configured (`MIZAN_NOT_CONFIGURED`);
- `state` is already `live` (`MIZAN_ALREADY_LIVE`);
- readiness is not empty (`MIZAN_NOT_READY`);
- no snapshot was answered `201` or `200` (`MIZAN_SNAPSHOT_MISSING`).

P6. **One transaction** under the lock of `mizan_settings`: it writes the replay events, sets `capture_from` now and `state` `live`.
- Every producer reads `mizan_settings` with a share lock in its own transaction and writes no event unless `live`.
- So no fact is both replayed and captured, and none is missed.
- Facts before the cutover reach Mizan only through the replay or the snapshot.

P7. **After the cutover**, delivery starts at once.
- Until the owner posts the opening in Mizan, every event answers `503 OPENING_NOT_POSTED` and waits (D3).
- The Mizan page shows "waiting for the opening in Mizan".

### Notices for what `/v1` cannot carry (owner, 2026-11-13)
M1. **Reopened project:** reopening a completed or cancelled project stays allowed. While `live`, it sends `mizan_manual_entry_needed` (N3) with the project and the previous state, so the accountant corrects the ledger by a manual entry (Mizan Q16).

M2. **Credit settled outside:** settling a retainer credit outside the system stays allowed. While `live`, it sends N3 with the charge, its amount and the settle note.

### Badges (owner, 2026-11-13)
B1. **Where:** for holders of `mizan.read`, a document shows a badge only when one of its events is:
- held ("معلّق في ميزان", with the reason);
- refused ("رفضه ميزان");
- pending for more than 15 minutes ("لم يُرسَل بعد").

This covers the invoice page, the payment rows, the expense rows, the wallet entries, the spend updates and the milestone rows. The badge links to the event on the Mizan page. Nothing shows when all is well.

## API
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/mizan/overview` | `mizan.read` | — | `mizanOverviewSchema`: configured, state, connection, last success and failure, counts by delivery and Mizan status, oldest pending, snapshot sent, readiness count, period states | — |
| `GET /api/mizan/events` | `mizan.read` | `mizanEventListQuerySchema` (delivery, Mizan status, type, document type, accounting date range, search by reference, cursor) | `mizanEventPageSchema` | — |
| `GET /api/mizan/events/:id` | `mizan.read` | — | `mizanEventSchema` (payload, answer, links to the document and replacement) | `NOT_FOUND` |
| `POST /api/mizan/events/:id/rebuild` | `mizan.manage` | — | `mizanEventSchema` (the new event) | `NOT_FOUND`, `INVALID_TRANSITION` (not refused), `MIZAN_EVENT_NOT_REBUILDABLE`, `MIZAN_NOT_CONFIGURED` |
| `POST /api/mizan/delivery/retry` | `mizan.manage` | — | `204`; clears the backoff and queues `mizan.deliver` | `MIZAN_NOT_CONFIGURED` |
| `POST /api/mizan/periods/refresh` | `mizan.manage` | — | `mizanPeriodsSchema` | `MIZAN_NOT_CONFIGURED`, `MIZAN_UNAVAILABLE` |
| `GET /api/mizan/reconciliation` | `mizan.read` | `{ month }` | `mizanReconciliationMonthSchema`: each day's status, gaps, last sent | — |
| `GET /api/mizan/reconciliation/:date` | `mizan.read` | — | the day's differences and totals as Mizan answered | `NOT_FOUND` |
| `GET /api/mizan/readiness` | `mizan.read` | `{ kind?, cursor }` | `mizanReadinessPageSchema`: kind, document, reference, date, link | — |
| `POST /api/mizan/snapshot` | `mizan.manage` | — | `mizanSnapshotSchema` (counts, totals, Mizan's answer) | `MIZAN_NOT_CONFIGURED`, `MIZAN_UNAVAILABLE`, `INVALID_TRANSITION` (Mizan answered `409 OPENING_POSTED`); a resend after the cutover is allowed |
| `POST /api/mizan/cutover` | `mizan.manage` | — | `mizanOverviewSchema` | `MIZAN_NOT_CONFIGURED`, `MIZAN_ALREADY_LIVE`, `MIZAN_NOT_READY`, `MIZAN_SNAPSHOT_MISSING` |
| `GET /api/mizan/document-states` | `mizan.read` | `{ type, ids[] ≤ 200 }` | the worst state per document for badges | — |

**Changes to existing endpoints:**
- `POST /api/invoices/:id/issue` adds `INVOICE_LINE_SERVICE_REQUIRED` and `MIZAN_PERIOD_CLOSED`.
- `PUT /api/invoices/:id/services` refuses a null service, and accepts void invoices before the cutover (F3).
- **Milestones:**
  - create and edit take `serviceId`;
  - `complete` adds `MILESTONE_SERVICE_REQUIRED`;
  - an edit of a done milestone adds `MILESTONE_DONE` after the cutover.
- **Project expenses:**
  - create and edit take a required `department` (`EXPENSE_DEPARTMENT_REQUIRED`);
  - create adds `MIZAN_PERIOD_CLOSED`.
- **`MIZAN_PERIOD_CLOSED`** is also added to: recording a payment, a wallet entry, and a spend update's add and edit.
- **The OpenAPI document and the web client** are regenerated.

## Screens

### Mizan `/mizan` (nav entry "ميزان", `mizan.read`, after Reports)
- **Header:** the connection state ("متصل", "متعذّر الاتصال منذ …", "المفتاح مرفوض", "غير مُعدّ") and the last successful delivery.
- **Overview tab:**
  - counts: pending, held by reason, refused, delivered today;
  - the oldest pending event's age;
  - the latest reconciliation days with differences;
  - the month states read from Mizan.
- **The cutover steps** (General Manager; shown while `setup`), as a checklist:
  1. readiness empty (with its count and a link);
  2. send the snapshot (button; shows the last send's counts and totals and Mizan's answer, and allows sending again);
  3. start the replay (button, with a confirmation dialog stating that it runs once and capture starts);
  4. "waiting for the opening in Mizan" until the first `201`.
- **Events tab:**
  - **Table:** reference, type in Arabic, accounting date, amount, Hub delivery, Mizan status and reason, attempts.
  - **Filters and search:** the API's filters, and search by reference.
  - **Row drawer:** the payload as readable fields, Mizan's answer, the link to the document, and for a refused event the field errors and "إعادة البناء والإرسال" (General Manager).
  - "إعادة المحاولة الآن" is in the header for the General Manager.
- **Reconciliation tab:** a month calendar of days (matched, differences, refused, not sent yet). A day opens its differences, each with the kind as Mizan names it (an unknown kind is shown as is) and Hub's and Mizan's side.
- **Readiness tab:** grouped by kind (invoice lines without a service, expenses without a department, milestones without a service), each with a link to its document. Empty: "كل المستندات جاهزة".
- **States:**
  - **loading:** skeletons;
  - **unconfigured:** a notice and no tabs except readiness;
  - **error:** the standard error state.

### Changed screens
- **Invoice draft editor:**
  - service required per line, with a "مقترحة" mark on suggested ones;
  - issuing lists the lines without a service;
  - the issued invoice's service dialog no longer offers "none";
  - a void invoice's lines may get a service before the cutover.
- **Milestone form:** a service picker, required when an installment is set and suggested from the quote. Completing without one shows the error.
- **Project expense form:** a required department, suggested from the project.
- **Date fields** of the invoice issue, payment, wallet entry, expense and spend update: the closed-month error.
- **Badges** (B1) on those documents.

## Audit, notifications and jobs
- **Audit** (entity `mizan`):
  - `mizan.snapshot_sent` (counts, totals, answer status);
  - `mizan.cutover` (events written, `capture_from`);
  - `mizan.event_rebuilt` (old and new id);
  - `mizan.delivery_retried`;
  - `mizan.periods_refreshed`.
- **Existing audit entries** gain the new fields: milestone service, expense department, line department.
- **Deliveries** are recorded on the event rows, not in the audit log.
- **Notifications** (category `finance`, to the General Managers and the users with the Finance role, owner 2026-11-13; never to the actor):
  - **N1 `mizan_event_refused`:** an event, a reconciliation report or a snapshot refused by Mizan. Priority high, links to the item.
  - **N2 `mizan_delivery_failing`:** an event pending for more than one hour because Mizan is unreachable or the key is refused. Priority high, once per outage (`failing_notified_at`, cleared by the next success). The resolution notice comes when delivery resumes.
  - **N3 `mizan_manual_entry_needed`:** a project reopened (M1) or a credit settled outside (M2). Priority normal, with the document and the amount; resolved by reading.
- **Jobs** (contracts `jobs.ts`; the worker schedules them, and the api works them as `invoices.daily`):
  - `mizan.deliver`: singleton; queued on commit, and every minute;
  - `mizan.periods`: every 15 minutes;
  - `mizan.reconcile`: `30 0 * * *` Asia/Damascus.
- **Development CLIs** (`mizan:deliver`, `mizan:reconcile [--date]`) run them once and refuse production, as `invoices:run-daily`.

## Edge cases
1. **Mizan down for a day:** actions keep working, events stay pending in order, the period check uses the last states (K3), and N2 is sent once. On recovery the backlog drains in order within the rate limit (600 a minute).
2. **A period closes between the check and the delivery:** Mizan holds the event `PERIOD_CLOSED`, Hub shows it held (D3), and the accountant posts it in the next open month.
3. **The same event delivered twice** (a crash after Mizan answered, before Hub saved): the retry gets the same answer under the same key (D7).
4. **A payment of an invoice whose `invoice.issued` was refused:** Mizan holds the payment `UNKNOWN_REFERENCE`. Rebuilding the invoice's event later releases it.
5. **A void before the cutover of an invoice issued before the books start:** replayed as `invoice.voided`. Mizan holds it `NEEDS_DECISION` `before_books_start` for the accountant (S10 rule 28).
6. **An invoice issued in September and paid in October:** it is in the snapshot with its outstanding at 30 September, and the October payment is replayed and clears it.
7. **A milestone done in September and invoiced in October:** a snapshot milestone (contract asset), and the October `invoice.issued` clears it.
8. **A spend update edited from 50 to 0, and later back to 30:** `ad_spend.archived`, then `ad_spend.recorded` (E2).
9. **A project expense moved to another project of another client:** `project_expense.changed` with the new client and contract.
10. **A service's department changed in the catalog:** issued lines keep their frozen department (F2), new invoices take the new one, and Mizan dates the change (S09).
11. **A rate changed twice in one day:** two `rate.changed` events. Mizan records the later as the day's rate, and an unchanged rate answers `recorded`.
12. **A department archived (F23):** past events keep its code. Mizan keeps the value, and an archived value in Mizan holds the event `NEEDS_DECISION` for the accountant.
13. **Two General Managers press the cutover at once:** the settings lock serialises them, and the second gets `MIZAN_ALREADY_LIVE`.
14. **Edits during the cutover:** a producer waits on the share lock and then writes its event as `live`. Its fact was not in the replay, since the replay read the records before the edit committed.
15. **A key rotated in Mizan:** the old key answers `401`, delivery pauses (D3), N2 is sent, and the variable is replaced and the api restarted.
16. **An unknown hold reason or reconciliation kind:** shown as received (D4).
17. **A refused event whose document was voided since:** the rebuild is refused (D6), and the gap stays for the accountant in Mizan's reconciliation.
18. **The readiness list changing while the snapshot is being sent:** the cutover checks readiness again in its transaction.
19. **Volume:** the replay writes a few thousand events in one transaction (October–November). Delivery takes minutes within Mizan's limit, and one reconciliation report holds at most 5 000 events, far above a day's.

## Open questions
- **For Mizan (recorded here; decided in Mizan's sessions):**
  - an event for a retainer credit settled outside the Hub, until which M2's notice applies;
  - `project.reopened` (Mizan Q16), until which M1's notice applies.

  Neither blocks F18A.
- None for the owner.

## Acceptance

### Owner check (on the dev database with the seed, against a local Mizan with a company whose books start is 2026-10-01 and a Hub API client)
1. As Finance, open an automatic invoice draft: each line shows a suggested service. Issue with one line emptied: refused, naming the line. Set it and issue.
2. Log a project expense without a department: refused. With one: saved.
3. As the General Manager, open `/mizan`: the readiness tab lists the seed's documents without services and departments. Complete them as Finance until it is empty.
4. Send the snapshot: its counts and totals show beside Mizan's answer. In Mizan, the opening draft shows Hub's invoices and wallets.
5. Start the replay: the events tab fills with events, and all wait with "waiting for the opening in Mizan".
6. Post the opening in Mizan, then press "retry now": events become posted, recorded or held. Held ones show their reason, and their documents show the badge.
7. Record a payment today: it reaches Mizan within a minute. Stop Mizan, record another: it stays pending, the page shows "متعذّر الاتصال", and after an hour the notification arrives. Start Mizan: it posts.
8. Close a month in Mizan, refresh the periods, then record a payment dated in it: refused, with the closed-month message.
9. Reopen a completed project: the General Manager and Finance receive the manual-entry notice.
10. Run `mizan:reconcile` for yesterday: the reconciliation tab shows the day matched, and Mizan's reconciliation shows it clean.

### Tests
- **Contracts:** Mizan's examples parse with Hub's schemas, every builder's output validates against the vendored JSON Schema, and `mizanReconciliationAmount()` matches Mizan's example report.
- **API integration:** against a fake Mizan HTTP server in the test process.
  - **Each producer:** writes its event with the right payload and accounting date, writes none before `live` or when unconfigured, and rolls it back with its transaction.
  - **Delivery:** every row of D3; order and D5; D7.
  - **Period check:** K1–K4.
  - **Reconciliation:** C1–C5.
  - **Snapshot:** S1–S2 on fixtures for each case of Mizan S10's scenarios that Hub feeds (edge cases 5–7).
  - **Replay and cutover:** order, folding and the lock (P1–P6, edge cases 13–14).
  - **Rebuild:** D6.
  - **Notices:** M1–M2.
  - **Each endpoint:** success, 401, 403, and `MIZAN_NOT_CONFIGURED`.
- **Unit:** amounts, references (E5), the cycle end, suggestions (F1, F4, F5) and the backoff.
- **E2E and RTL screenshots:**
  - the Mizan page's tabs, as the General Manager and as Finance (no action buttons);
  - the cutover steps;
  - the invoice editor's service requirement;
  - the expense form's department;
  - a badge;
  - the closed-month error.

## PR split (proposed)
1. **The fields** (db, contracts, api, web; independent of Mizan):
   - the line service required to issue, and its suggestions;
   - the frozen line department and its backfill;
   - the milestone service and `is_deposit`, with A01's suggestion and the backfill;
   - the expense department;
   - the forms;
   - the readiness query (an internal read used by PR 5's tab).

   It also improves revenue by service and department in F15 today.
2. **Outbox and delivery:**
   - `mizan_settings`, `mizan_events` and `mizan_periods`;
   - the contracts copy with the vendored fixtures and the JSON Schema test;
   - the env, the delivery loop and its jobs, the period check;
   - the invoice, payment and rate producers.

   Capture stays off (`setup`), so production is unchanged until the cutover.
3. **The other producers:**
   - milestones, projects, project expenses, wallet entries and spend updates;
   - the done-milestone lock;
   - the notices M1–M2 and the notification types N1–N3.
4. **Reconciliation, snapshot and replay:**
   - `mizan_reconciliation_days` and `mizan_snapshots`;
   - the reconcile job, the snapshot builder, the replay builder and the cutover endpoint;
   - tests on fixtures for each case.
5. **The Mizan page and badges:**
   - the endpoints of the page;
   - `/mizan` with its tabs and the cutover steps, and the badges;
   - E2E and screenshots;
   - `docs/ROADMAP.md` marks F18A done.

   The production cutover runs after this PR is deployed, in the phase's deploy session.
