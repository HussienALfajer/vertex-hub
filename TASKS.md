# TASKS — F05B Retainer terms, billing schedule and amendments

Spec: `docs/specs/F05B-retainer-terms.md` · ADRs 0006, 0015, 0023, 0024, 0029 · Worktree `D:\vertex-hub-f05b`, each PR on its own branch from `origin/main`, pushed and merged as soon as it is ready (owner decision 2026-10-07). Four PRs, each full stack (the charge switch changes F13's response shapes, so api and web of a slice ship together and `main` stays wired).

## Order (owner decision 2026-10-07)
1. PR 1 merged (#105).
2. PRs 2, 3 and 4, one session each, each merged as soon as it is ready.
3. First production deploy, in its own session: everything on `main` (phases 1–3 and F05B), never deployed before; server commands need approval there. The UI walkthrough fixes (some security-related) are not in it.
4. Resume the UI walkthrough (`D:ertex-hubTASKS.md`, from screen 15). Its 162 uncommitted changes sit on `main` in `D:ertex-hub` (the `fix/ui-walkthrough` branch is still at `406c7b5`): move them to that branch first, merge `main`, and regenerate its migrations 0046 (department names) and 0047 (trade name spaces) after the F05B migrations; mark them applied on the dev database (it already has their effect) and let the test database apply them.
5. Then the contract migration below, and a second deploy.

## PR 1 — `feat/f05b-charges`: charges replace cycles as the billing source (C1–C4, C7, C8, C10)
- [x] contracts: `RETAINER_CHARGE_KINDS`, `RETAINER_CHARGE_STATUSES`, `retainerChargeSchema` (in `invoices.ts`: it carries the invoice), charge list query and page; `INVOICE_SOURCE_TYPES` `retainer_cycle` → `retainer_charge`; `invoice_origin` keeps `cycle_opened` (enum value rename impossible in one migrator transaction, spec updated) + `retainer_amendment`, `retainer_termination`; billable `charges`; audit `retainer_charge.created`, entity `retainer_charge`; `ar.json` keys; unit tests. Moved to PR 3 (first use): negative price for credits, `INVOICE_NEGATIVE`, `invoiceStatus` with total 0
- [x] db (`/db-migration`, 0046 + 0047 backfill, expand only, owner decision): `retainer_charges` + enums; `invoice_lines.retainer_charge_id` (partial unique where `holds_source`), source check counting cycle or charge once; backfill cycles → charges (idempotent, tested in `packages/db/src/migrations.test.ts`); `retainer_cycle_id` kept (dropped after the UI walkthrough, order step 5); conventions exception; drift clean; `db` test 11 passed
- [x] api `projects`: `RetainerCharges` (open-ended charge on cycle open, C2; due marking + `RetainerChargeDueHooks`, C3) in `open()` and the cycles job; `BillingSources` resolves, lists and pages charges (cancelled / settled charges unbillable, C10)
- [x] api `invoices`: drafts from due charges (C4), picker `charges` (C7), release on void / discard unchanged (C8), `GET /api/retainers/:id/billing` with charges, `GET /api/retainers/:id/charges`, F15 revenue split on charge lines, `ALREADY_INVOICED` mapping; tests updated (`invoice-drafts`, `invoices`, `invoice-billing`, `reports`); 9 affected test files pass (135 tests)
- [x] bridge (OpenAPI exported with a placeholder `DATABASE_URL`); web: billable picker, source chips, retainer Billing tab on charges; fixtures; `f13-billing` E2E extended; RTL screenshots of the Billing tab in both themes checked
- [x] wiring checklist; full checks (lint, typecheck, build, OpenAPI and migration drift, test 946 + the fixed `retainers` file 22, E2E 337); reviewer (blocking fixed: a fee set after the month opened charges it, C2; currency locked by charges, edge case 12; a charge not yet due is not billable, C7); dev database migrated (0046, 0047)
- [x] owner acceptance (approved 2026-10-07); PR opened without `/ship` at the owner's request, auto-merge on

## PR 2 — `feat/f05b-terms`: terms, schedule, renewal, ending (T1–T12, E1–E3)
- [ ] contracts: term schemas, `splitEvenly`, schedule validation, `createRetainerSchema.term`, status `termination`, term summary on the retainer, notification `retainer_term_renewed`, `retainer_renewal_due.endAction`, audit `retainer_term.*`, error codes, `ar.json`, `packages/messages` text; unit tests
- [ ] db (`/db-migration`): `retainer_terms` + enums, partial unique indexes; drift
- [ ] api: terms endpoints (list, create, edit, cancel), create retainer with term, `renewal_date` from terms, `RENEWAL_DATE_FROM_TERM`, end with termination fee and cancellations (E1–E3), job steps (start / complete / end / renew, ordered and idempotent), `retainers:run-daily [--date]` script + `AGENTS.md`; tests `retainer-terms.test.ts`, `retainers.test.ts`, `retainer-cycles.test.ts`
- [ ] bridge; web: term section in the new retainer form (schedule editor), header term chip, Contract tab (term cards, schedule table, edit / cancel / add term, end action), end dialog fee, list renewal column; fixtures; E2E + RTL screenshots in both themes
- [ ] wiring checklist, full checks, reviewer, owner acceptance, /ship (merge at once)

## PR 3 — `feat/f05b-amendments`: amendments, approval, reschedule, credits (A1–A9, C5, C6, C9)
- [ ] contracts: amendment schemas, month-effect planner (preview and apply), approval rule, permission `retainers.approve_reduction` (+ `permissions.test.ts`), notifications `retainer_amendment_pending` / `_decided`, audit `retainer_amendment.*`, error codes, `ar.json`, messages; unit tests
- [ ] db (`/db-migration`): `retainer_amendments`, `retainer_amendment_lines`, `retainer_cycle_lines.amendment_id`; drift
- [ ] api: amendments (create, preview, approve, reject, withdraw, list, `GET /api/retainer-amendments`), reschedule, job applies scheduled amendments (A5), draft sync / addition / credit (C6), credits on drafts with split (C5), settle outside (C9), fee lock (A9), `pendingAmendments` / `creditPendingMinor` / `pendingApproval` filter; tests `retainer-amendments.test.ts`, `invoices.test.ts`
- [ ] bridge; web: amendments list, New amendment dialog with live preview, approve / reject / withdraw, reschedule dialog, pending badge and filter, Billing tab credits with "Settle outside", invoice editor credit lines; fixtures; E2E + RTL screenshots
- [ ] wiring checklist, full checks, reviewer, owner acceptance, /ship (merge at once)

## PR 4 — `feat/f05b-quotes`: quotes with a term (Q1–Q3)
- [ ] contracts: `acceptPlanSchema` / `acceptQuoteSchema` retainer `term`; unit tests
- [ ] api: acceptance creates the term (Q1), Renew on a running term (`quote_renewal` amendment, Q2), a quote without a term sets `continue`; tests `quote-accept.test.ts`
- [ ] bridge; web: accept dialog term block and the Renew notice; E2E + screenshots
- [ ] spec and ROADMAP updates, wiring checklist, full checks, reviewer, owner acceptance, /ship (merge at once)
- [ ] then: production deploy in its own session (order step 3)

## After the UI walkthrough — `chore/f05b-drop-cycle-source` (order step 5)
- [ ] contract migration: drop `invoice_lines.retainer_cycle_id` (+ its index and unique index, source check back to three columns, `database-error.filter.ts` mapping), once `fix/ui-walkthrough` is merged and no checkout runs the old code; then a second deploy
