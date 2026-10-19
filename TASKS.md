# TASKS — F05C contract follow-up (branch `chore/post-v1-cleanup`)

Owner approval (2026-10-20): check production first, then set the F05C cycle columns NOT NULL, remove the null fallbacks from the code, and drop the `month` value of `amendment_scope`.

- [x] Production check (read only, `21de8e3` deployed): no null in `retainer_cycles.number`, `retainer_terms.start_cycle/cycles/start_date/end_date`, `retainer_charges.cycle_number/cycle_start`, `retainer_amendments.effective_cycle/effective_date`; no `month` amendment scope
- [x] db: the columns NOT NULL, `month` removed from `amendment_scope`: 0064 (drops the scope check, recreates the enum, NOT NULL) and 0065 (the scope check again), both generated; `db` test (10 passed), drift: none
- [x] api: remove the null fallbacks on those columns and the `month` → `cycle` reads; api typecheck, lint
- [x] Checks: lint, typecheck, test, build, drift (all pass); reviewer: no blocking issues
- [x] Docs: ROADMAP F05C line, schema comments
- [x] PR with auto-merge
