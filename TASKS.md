# TASKS — Test speed (chore/test-speed)

Why and the measurements: report https://claude.ai/artifact/2XVXbE1ni1apsikkARkikz (2026-10-26). One PR.

## Phase 1 — test configuration
- [x] api Vitest: `isolate: false`, `DATABASE_POOL_MAX: '4'` (env var added to the api env schema and `DatabaseModule`)
- [x] `TEST_WORKERS` from `packages/db/src/test-workers.ts` (env, else half the CPUs from 4 to 12), shared with `scripts/setup-local-db.mjs`
- [x] the api global setup creates missing worker databases; advisory lock per suite (`holdTestDatabases`) so a second run waits
- [x] Playwright `trace: 'on-first-retry'`; `test.setTimeout(90_000)` on the attendance and images tours
- [x] measured: api suite 338 s → 69 s (12 workers), full E2E 11.1 min / 75 timeouts → 4.4 min / 0 after the tour timeouts
- note: the approvals flake was already fixed in 865c9f9 (nothing to do)

## Phase 2 — workflow
- [x] `scripts/verify.mjs` + `pnpm verify` (logs in `.verify/`, summary, lock, changed E2E specs, drift checks)
- [x] `.claude/hooks/test-guard.mjs` (PreToolUse Bash) registered in `.claude/settings.json`; `pnpm verify` allowed
- [x] rewrite `.claude/agents/checker.md` around `pnpm verify`
- [x] `AGENTS.md`: commands table (verify, E2E row, db:setup-local note), "How to work", "Context economy", "Finishing a task" step 4 (+ CI failure handling in step 7); add `docs/testing.md` to "Source of truth"
- [x] `CLAUDE.md` Delegation (checker, no edits during runs, Auto-fix after the PR)
- [x] `.claude/skills/feature-slice/SKILL.md` gates (E2E layer = changed specs via `pnpm verify`; one verify with the reviewer, fix, verify once more); `db-migration` step 4
- [x] `docs/workflow.md` (steps 3 and 5, layers table, habit 8); `apps/api/CLAUDE.md` Tests (stale "one at a time"); `apps/web/CLAUDE.md` Run line; `docs/architecture.md` lines 121–122
- [x] new `docs/testing.md`: where each check runs, `pnpm verify`, rules and their enforcement, test databases, E2E policy, CI layout, local machine (Dev Drive/Defender, `max_connections`, stop `pnpm dev`), measurements

## Phase 3 — CI
- [x] `.github/workflows/ci.yml`: drop the "worker databases" psql step (global setup creates them); split Tests into other packages + "API tests" shards 1/2 (`turbo run test --filter=@vertex-hub/api -- --shard=N/2`), add it to the `checks` gate needs
- [x] remote cache wiring: `TURBO_TOKEN` (secret), `TURBO_TEAM`/`TURBO_API` (vars, default `https://vercel.com/api`), `remoteCache.signature` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY`; verified locally that an empty token keeps turbo on the local cache; owner adds the secrets to turn it on
- [x] fix the ci.yml comment "a merge to main replays its pull request's tasks" (GitHub cache scoping: main cannot read PR caches)

## Finish
- [x] `docs/ROADMAP.md` (Phase 0 item), `docs/architecture.md` environments
- [x] `pnpm verify` green (3m 26s with a cold cache, 37 s unchanged); reviewer: five blocking findings fixed (OpenAPI drift fails the run, contracts changes trigger the migration check, the verify lock expires after 30 minutes, `process.env` is put back after each api test file, the TURBO_* secrets reach only the turbo jobs)
- [x] PR with auto-merge; CI runs the new API shards. Owner, when convenient: Dev Drive or Defender exclusions, and the remote cache secrets (`docs/testing.md`)
