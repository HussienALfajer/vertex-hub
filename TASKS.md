# TASKS — F05C Retainer anniversary cycles and contracts

Spec: `docs/specs/F05C-retainer-anniversary-cycles.md` · ADRs 0030, 0031 (and 0015, 0029 they amend).

PR split (from the spec): PR 1 anniversary cycles · PR 2 backdated start and catch-up · PR 3 cycle reports · PR 4 legal details · PR 5 contracts and annexes. PR 1 changes response shapes that screens of F05/F05B/F04/F15 read, so it carries its web and E2E layers (a PR never leaves `main` broken).

## PR 1 — anniversary cycles (branch `claude/retainer-anniversary-cycles-cbb84j`)

Not in PR 1: the catch-up and start dates before the current cycle (PR 2: until then a start date before today − 1 month + 1 day is `INVALID_DATES`), cycle reports and `retainer_cycle_report_ready` (PR 3), legal details and contracts (PR 4, PR 5).

### 1. contracts
- [x] `retainer-cycles.ts`: `addMonths` (clamped, from the start date), `cyclePeriod`, `cycleAt`, term end date, days left; re-exported from `index.ts`; unit tests (anchors 1, 15, 28, 29, 30, 31; leap years; before the start)
- [x] `retainers.ts`: `renewalDate` removed from create/update inputs; `cycles_from`/`nextCycleStart`, `currentCycle { number, periodStart, periodEnd, daysLeft, termPosition?, termCycles? }` on list and detail; cycles carry `number` (no `month`); terms `startCycle`/`cycles`/`startDate`/`endDate`; charges `cycle`/`periodStart`/`periodEnd`; amendments scope `cycle`|`onward`, `effectiveCycle`, schedule `{ cycle, amountMinor }`, effects by cycle; status change `startNow?`
- [x] `quotes.ts` accept: retainer part without `renewalDate`; start date rule B6
- [x] `reports.ts`: client report retainers section by cycles overlapping the month (R4)
- [x] Error codes: `CYCLE_ALREADY_CHARGED`, `CYCLE_INVOICED`, `INVALID_EFFECTIVE_CYCLE` replace the month codes; `RENEWAL_DATE_FROM_TERM` removed (the renewal date is never sent: strict inputs answer 400); `ar.json` keys
- [x] Gate: `contracts` test, root `typecheck`

### 2. db (`/db-migration`, expand only)
- [x] `retainers.cycles_from`; `retainer_cycles.number` (unique with `retainer_id`), `backdated`, `untracked`, `month` optional
- [x] `retainer_charges.cycle_number`, `cycle_start`, new unique monthly index on `(retainer_id, cycle_number)`; `month` optional; `settled_outside` allowed for `monthly` (used in PR 2, check only)
- [x] `retainer_terms.start_cycle`, `cycles`, `start_date`, `end_date`; old columns optional
- [x] `retainer_amendments.effective_cycle`, `effective_date`, scope `cycle`; `effective_month` optional
- [x] Backfill SQL per spec "Migration" (numbers from `cycleAt`, schedules and effects mapped, `renewal_date` null without an active or scheduled term); SQL reviewed
- [x] Gate: `db` test, migration drift

### 3. api
- [x] Cycle engine on `cyclePeriod`/`cycleAt` (Y1–Y4): create opens the current cycle, ending closes with the end day
- [x] Day-one job `retainers.cycles` in J1 order, idempotent (J2), drafts named by cycle (J3)
- [x] Terms in cycles (T1'–T5'), derived `renewal_date`, renewal 30 days before `end_date`, `retainer_renewal_due` for terms only
- [x] Charges and billing sources by cycle; invoice draft labels (J3)
- [x] Amendments by cycle (A1'–A2')
- [x] Pause / resume / reactivate (P1–P4) with `startNow` and `cycles_from`
- [x] `PATCH` start date only before a cycle or charge (`RETAINER_STARTED`); `renewalDate` refused
- [x] Behind and delivery rate on the period; A09 texts and the short-cycle rule (Y5) in `packages/messages`
- [x] Quote accept (B6, no renewal date); quote renewal hooks by cycle
- [x] F15 client report and dashboard: cycles overlapping the month (R4)
- [x] `db:seed` rewritten to anchored cycles
- [x] Tests: `retainer-cycles`, `retainer-terms`, `retainer-amendments`, `retainers`, `quote-accept`, report tests updated; every PR 1 rule and error code
- [x] Gate: api test files above, `test/architecture.test.ts`, `api` typecheck

- [x] Found while testing: templates contracts (run and retainer template cycle) named the month; worker client report PDF and Excel name each cycle (R4); `cast.onDay` test helper for later cycles

### 4. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`; commit `openapi.json` and `schema.gen.ts`
- [x] Gate: `web` typecheck (runs with the web layer)

### 5. web
- [x] New retainer: start-date note (cycle day / last day of the month), no renewal date, term section in cycles with each cycle's period
- [x] Retainer header and lists: cycle chip (Y6), term chip with end date and "renews on", paused "next cycle starts"
- [x] "This cycle" tab (was "This month"), History by cycle number with period and badges
- [x] Resume / reactivate dialog (P2, P4)
- [x] Contract tab: schedules and amendments by cycle; amendment dialog "this cycle only" / "from cycle N onward"
- [x] Billing tab and invoice picker by cycle; quote accept dialog without renewal date; client report retainers section
- [x] `ar.json`: texts, errors, audit fields
- [x] Gate: `web` typecheck, lint, `web` test

### 6. e2e
- [x] `fixtures.ts` mocks moved to cycles
- [x] Flow spec: the header chip and the resume dialog
- [x] Screenshots light and dark: header with the cycle chip, resume dialog, History
- [x] Gate: `pnpm test:e2e` (374: 372 passed; the F05C P3 test locator fixed, then 12/12; the f15 line-service test failed once under load and passed 3/3 alone); screenshots opened and checked (header with the cycle chip, resume dialog, History, client report)
- [x] Found: task-generation, template and audit texts still said "this month"; now "this cycle" (runs already count on the cycle's period)

### Close PR 1
- [x] Wiring checklist against the diff; docs (spec: backfill by the month's last day, `month` scope kept in the enum, the PR 1 start-date rule: done)
- [x] Full checks through `checker` (lint, typecheck, test, build, migration drift, OpenAPI fresh: all pass; E2E above)
- [x] `reviewer` with the spec; blocking findings fixed (edit dialog start-date check, backfill keeps the month keys, cycle numbers never below 1)
- [ ] Owner acceptance (browser steps); then `/ship`

## PR 2 — backdated start and catch-up (branch `ccr-3689328e-v5jhy8`)

PR 1 is merged (#111). No migration: `retainer_cycles.backdated`/`untracked` and `settled_outside` on `monthly` charges shipped in PR 1. Not in PR 2: cycle reports (PR 3; backdated cycles never get one), legal details and contracts (PR 4, PR 5). The quote accept dialog keeps rule B6 (no backdating there).

### 1. contracts
- [x] `retainers.ts`: `catchUpEntrySchema` (`cycle`, `billing` `billed_externally`|`draft_now`, `delivery` `untracked`|`entered`, `delivered[]` per deliverable line 0–999) and `catchUp[]` (≤ 12) on `createRetainerSchema`; the term may start at cycle 1 with a backdated start (B5)
- [x] Error code `CATCH_UP_REQUIRED`; audit action `retainer.backdated`; `ar.json` keys (error, audit action and fields)
- [x] Unit tests: catch-up schema (B2: entries, choices, delivered counts, limits)
- [x] Gate: `contracts` test, root `typecheck`

### 2. api
- [x] `POST /api/retainers`: start date from today − 12 months (B1); past cycles 1…current − 1 need one complete catch-up entry each (B2, `CATCH_UP_REQUIRED`), money access for it
- [x] B3 billing: `billed_externally` → monthly charge `settled_outside` with the note; `draft_now` → charge due now, drafted at once with the cycle label (J3); amount from the term schedule or the fee; no amount → no charge
- [x] B4 delivery: closed `backdated` cycles, `untracked` (no delivered counts, null rate) or `entered` (frozen `delivered_at_close`); no tasks, no A09, no notifications
- [x] B5 term from cycle 1 that includes the current cycle, created `active` (`INVALID_DATES` otherwise); renewal as usual
- [x] B7 audit: `retainer.created` and one `retainer.backdated` with each cycle's choices and counts
- [x] Tests in `retainers.test.ts` (or `retainer-backdated.test.ts`): B1–B5, B7, edge cases 6 and 7, 403 without money access, the current cycle still opens and drafts as Y3
- [x] Gate: api test files, `test/architecture.test.ts`, `api` typecheck

### 3. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`; commit `openapi.json` and `schema.gen.ts`

### 4. web
- [x] New retainer: start date back to 12 months; a **Past cycles** step for a start before the current cycle: one row per past cycle (number, period, amount), billing (billed outside / draft invoice now), delivery (not tracked / enter delivered, expanding an input per line)
- [x] Term section: may start at cycle 1 on a backdated start, schedule periods per cycle
- [x] History: "backdated" and "not tracked" badges (already in PR 1; checked in the screenshot)
- [x] `ar.json` texts
- [x] Gate: `web` typecheck, lint, `web` test

### 5. e2e
- [x] `fixtures.ts`: backdated create and History mocks
- [x] Flow spec: a backdated retainer with the catch-up
- [x] Screenshots light and dark: new retainer with Past cycles, History with backdated badges
- [x] Gate: f05c and screens specs pass; screenshots opened and checked (new retainer with Past cycles, History with both badges); full `pnpm test:e2e` at close

### Close PR 2
- [x] Wiring checklist against the diff; spec updated (B1's PR 1 note removed, B2 details)
- [x] Full checks through `checker` (lint, typecheck, test, build, OpenAPI fresh; E2E 378 passed); after the review fix: lint, typecheck, test, build, OpenAPI fresh pass, E2E 377/378: `f13-invoices.spec.ts:51` timed out once (5 s) under the full run, then passed 9/9 alone (`--repeat-each=3`); it does not touch retainers
- [x] `reviewer` with the spec; blocking finding fixed (an untracked cycle's lines showed 0 delivered and 0 % in History and the client report; now no count: `delivered` and `percent` null in the report, "—" on screen, PDF and Excel; API test added)
- [x] Owner acceptance (accepted 2026-10-13); PR opened with auto-merge

## PR 3 — cycle reports (branch `claude/charming-hopper-85pv60`)

PR 2 is merged (#112). Ownership: ADR 0027 lets no module import `reports`, so `retainer_cycle_reports`, the cycle report service and its routes belong to `reports` (spec updated: it said `projects` owns every new table); `projects` tells it a cycle closed through a new `CycleClosedHooks` (as `CycleOpenedHooks`). Not in PR 3: legal details and contracts (PR 4, PR 5).

### 1. contracts
- [x] `reports.ts`: `cycleReportSchema` (R2: client, retainer, cycle number and period, `preliminary`, summary, this cycle's lines with committed, frozen delivered, percent and delivery rate; delivered work, published content, shoots, approvals, campaigns and ad budget with `campaigns.read`, next period; no projects), `updateCycleReportSummarySchema`, `cycleReportSnapshotSchema`, `CYCLE_REPORT_LABELS`; monthly report retainers carry `cycleId`; `reportPdfJobSchema` gains kind `cycle_report`; `reports.cycle-report` nudge queue (`jobs.ts`)
- [x] Notification type `retainer_cycle_report_ready` (`clients_projects`, subject `retainer`, mutable) with its data; text and link in `packages/messages`; audit action `retainer_cycle_report.summary_changed` and entity type; `ar.json` keys
- [x] Unit tests (schemas, notification data); gate: `contracts` test, root `typecheck`

### 2. db (`/db-migration`, expand only)
- [x] `retainer_cycle_reports` (`cycle_id` PK → `retainer_cycles.id`, `summary` ≤ 4,000 default empty, `pdf_status`, `storage_key`, `hash`, `size_bytes`, `rendered_at`, `updated_at`, `updated_by_id`); owner `reports` in `TABLE_OWNERS`; natural key in `conventions.test.ts`; `notification_type` enum value
- [x] Gate: `db` test, migration drift

### 3. api
- [x] `projects`: `CycleClosedHooks` run in the closing transaction by the job (J1 step 3, with `backdated` skipped) and by ending (Y4); `EngagementReports` read of one cycle with its retainer and client
- [x] `reports`: `CycleReportService`: R1 (row, queued PDF, one `retainer_cycle_report_ready` to the account manager), R2 (sections over the cycle period), R3 (summary saves audit and mark the PDF outdated; render again on download), `reports.pdf-ready` for kind `cycle_report`
- [x] Controller: `GET …/report`, `/export` (xlsx), `PUT …/report/summary`, `POST` · `GET …/report/pdf`; `reports.read` covering the client, 404 outside
- [x] Tests `retainer-cycle-reports.test.ts`: each endpoint success, 401, 403, out of scope; R1–R3, backdated none, edge cases 3, 5 and 15, idempotent job; gate: api test files, `architecture.test.ts`, `api` typecheck

### 4. worker
- [x] `reports.pdf` kind `cycle_report`: template (Arabic RTL, preliminary mark), worker test with screenshot; gate: `worker` test, typecheck

### 5. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`

### 6. web
- [x] Cycle report page `/retainers/$retainerId/cycles/$cycleId/report` (sections, preliminary badge, summary editor, Download PDF, Export to Excel); "Report" link per closed cycle in History; link from the client's report page; notification link
- [x] `ar.json` texts; gate: `web` typecheck, lint, `web` test

### 7. e2e
- [x] `fixtures.ts` mocks; flow spec: the report from History, summary saved; screenshots light and dark of the cycle report
- [x] Gate: f05c (7/7), f05, f15 and the retainer and report screens (70) pass; screenshots opened and checked (cycle report light and dark, History with the Report links, monthly report with the cycle link); full `pnpm test:e2e` at close

- [x] Found while building: `timestamps()` bumps `updated_at` on every update, so a render changed the report's hash (the summary shows its time); `retainer_cycle_reports.updated_at` is set by summary saves only (no SQL change). `retainers:run-daily` now starts sending jobs, so the report nudge reaches the running dev API. The report sections the two reports share moved to `report-sections.tsx` (web) and shared helpers in the PDF template and Excel builder. `$retainerId.tsx` became `$retainerId/index.tsx` for the nested report route.

### Close PR 3
- [x] Wiring checklist; spec updated (table ownership, `updated_at`, PDF currency by hash, the nudge job); `docs/architecture.md` (`reports`, `CycleClosedHooks`)
- [x] Full checks: lint, typecheck, build, OpenAPI fresh, migration drift, E2E (382 passed); after the last fix lint, typecheck and `pnpm test` (11/11 tasks) pass
- [x] `reviewer` with the spec; blocking findings fixed (no report link for backdated cycles in the monthly report, 403 tests on every endpoint, ADR 0027 amendment; also a send-only script now creates the `reports.cycle-report` queue); tests that delete cycles or read a retainer's inbox adjusted for the report row and notice
- [x] Owner waived acceptance in this session (asked for the PR with auto-merge); PR opened with auto-merge

## PR 4 — legal details
- [ ] Planned when PR 3 is merged

## PR 5 — contracts and annexes
- [ ] Planned when PR 4 is merged
