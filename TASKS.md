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

## PR 2 — backdated start and catch-up
- [ ] Planned when PR 1 is merged

## PR 3 — cycle reports
- [ ] Planned when PR 2 is merged

## PR 4 — legal details
- [ ] Planned when PR 3 is merged

## PR 5 — contracts and annexes
- [ ] Planned when PR 4 is merged
