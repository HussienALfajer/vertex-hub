# TASKS — Agent rules consistency, CI speed and flaky tests

Owner request (2026-10-28): open PRs without asking, make every instruction file and doc consistent and correct, speed up CI and fix the tests that fail it. Two PRs.

## PR 1 — Agent rules and docs (`chore/agent-rules-consistency`)
- [x] PR policy: commit, push, PR, auto-merge and Auto-fix never asked; acceptance after the PR (`AGENTS.md`, `CLAUDE.md`, `/feature-slice`, `docs/workflow.md`)
- [x] Approvals: the 2026-10-27 full permission everywhere (`AGENTS.md` "Production server", `deploy/CLAUDE.md`, `docs/deployment.md`, `docs/workflow.md`, `/db-migration`, `packages/db/CLAUDE.md`)
- [x] Folder rules match the code: wiring `CurrentUser`, contracts Q13, web locale and money, db `minorAmount()`, api `api:generate`, worker queue names, messages layout, `pnpm verify` in every "Run:" line
- [x] Docs: `docs/architecture.md` (stack, worker and db folders, `health`, ruleset), ROADMAP (scope files, deploys, SEC-01, folder rules, F08B acceptance), README, `.env.example` (every setting; `FILES_ROOT` unset in development), ADR 0003/0015/0029 statuses, resolved questions in the F01, F04, F10, F12 specs, references to both scope files (`AGENTS.md`, `/spec`, the spec template, `docs/workflow.md`)
- [x] Biome hook skips files on another drive; settings allow lists without the redundant entries
- [x] Owner's memory: stale entries removed or corrected (outside the repository)
- [x] checks (documentation and config; CI runs everything), PR with auto-merge

## PR 2 — CI speed and flaky tests (`fix/ci-e2e-speed-flakes`)
- [x] E2E shards in the Playwright container image (no apt install)
- [x] `e2e/f16-push.spec.ts`: pushes carry notifications the mock lists as unread, so the app's rule A14 no longer closes them (old test: 20 of 20 failed with 10 workers; new: 20 of 20 passed)
- [x] `pickOption` in `e2e/test.ts` for the wizard tour (`screens.spec.ts`) and `f06b.spec.ts`: a list that stays hidden to the click is reopened instead of waiting out the timeout
- [x] `apps/api/test/client-contacts.test.ts`: the national ID check looks for the exact values, which no id or timestamp holds
- [x] `docs/testing.md` CI time and setup, `apps/web/CLAUDE.md`
- [x] checks, PR with auto-merge
